// IMPORTANT: This must be the very first import — Sentry auto-instruments
// Express / HTTP / fs by patching modules at require time. Loading
// `instrument.ts` first ensures handlers registered later in `./app`
// are observable in traces.
import "./instrument";

import { ErrorCode } from "@workspace/error-codes";
import { pool } from "@workspace/db";
import * as Sentry from "@sentry/node";
import { createServer, type Server } from "http";
import express from "express";
import app, { isShareBotUserAgent } from "./app";
import { bootMigrations } from "./lib/boot-migrations";
import { instrumentDbPool } from "./lib/db-instrumentation";
import { assertEncryptionKeyConfigured } from "./lib/encryption";
import { logger } from "./lib/logger";
import { getRedisClient, initRedisClient } from "./lib/redis-client";
import { getIO, initSocket } from "./lib/socket";
import { startWebSchedulers, type WebSchedulerHandle } from "./lib/web-scheduler";
import { logTelegramBootStatus } from "./telegram";

// Slow-query instrumentation. Patches pool.query + pool.connect so
// every database call (including migrations + scheduler jobs) flows
// through the timer. Must run BEFORE any query — install at module
// load, before bootstrap()'s bootMigrations call.
instrumentDbPool(pool);

const rawPort = process.env["PORT"] || process.env["API_PORT"] || "8080";

const DEFAULT_FALLBACK_ATTEMPTS = 25;

// B7-P1-6: hard ceiling for graceful drain — a hung connection must not
// wedge the deploy; the orchestrator SIGKILLs if we overstay.
//
// R107 (migration P2): default raised 10s → 25s and made env-tunable
// (GRACEFUL_SHUTDOWN_TIMEOUT_MS). The documented worst-case in-flight
// request is ~20s (WhatsApp OTP settle wait, server.ts requestTimeout=60s);
// a 10s budget truncated those mid-byte on every restart. Set the Docker/
// Coolify stop grace ABOVE this value (docker stop / stop_grace_period,
// see docker-compose.yml) so the app's own orderly path — pool drain +
// Sentry flush + exit(0) — always wins over SIGKILL.
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS ?? "", 10) || 25_000,
);

// ── B7-P1-8: early-bind readiness gate ───────────────────────────────────
//
// The listener used to bind only AFTER bootstrap (Redis init, migrations —
// up to 2 minutes with the B7-P0-1 write-wait — scheduler start), so
// Render's health probes hit a closed port for the whole window and a
// slow boot was indistinguishable from a dead process. Now the port binds
// FIRST and a gate middleware answers until bootstrap resolves:
//
//   - /api/healthz* → 503 {"status":"starting"} (flips to the real 200
//     handlers once ready) — Render sees "starting", not "dead";
//   - dynamic/DB-backed paths → 503 SERVICE_UNAVAILABLE — business
//     routes must never answer mid-migration (P0-4: never serve on a
//     schema we are still reconciling);
//   - R104 (AG6-2): static + SPA-shell GET/HEAD requests PASS the gate
//     (pure fs reads — see isBootGatedRequest below).
//
// Genuinely-critical migration outcomes still process.exit(1) below —
// the gate only covers the WAITING window, never a broken boot.
let bootReady = false;

function isHealthProbePath(path: string): boolean {
  return path === "/api/healthz" || path.startsWith("/api/healthz/");
}

/**
 * R104 (AG6-2): must this request WAIT for bootReady?
 *
 * Gated (DB-backed or stateful): everything under /api, the Socket.IO
 * handshake (auth middleware hits the DB), sitemap.xml (DB-backed), and
 * the /product/* share-card path for unfurler bots (DB read). Everything
 * else GET/HEAD — hashed assets, product images, manifest/sw/icons, the
 * SPA fallback index.html, robots.txt (static const) — is a pure
 * filesystem read that cannot observe a mid-migration schema and PASSES
 * the gate immediately: on a free-tier deployment (sleep after 15 min
 * idle) the FIRST visitor of every wake used to get a JSON 503 instead
 * of the page shell for the whole boot window (~8-18 s); now the SPA
 * loads instantly and its customFetch boot-gate retry carries the data
 * in the moment the gate opens.
 */
function isBootGatedRequest(req: {
  method?: string;
  path: string;
  headers: Record<string, unknown>;
}): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return true;
  const p = req.path;
  if (p === "/api" || p.startsWith("/api/")) return true;
  if (p.startsWith("/socket.io/")) return true;
  if (p === "/sitemap.xml") return true;
  if (p.startsWith("/product/")) {
    const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "";
    if (isShareBotUserAgent(ua)) return true;
  }
  return false;
}

function buildGatedApp() {
  const gate = express();
  gate.use((req, res, next) => {
    if (bootReady) return next();
    // AG6-5 (R104): machine-readable retry hint for crawlers/monitors.
    res.set("Retry-After", "3");
    if (isHealthProbePath(req.path)) {
      res.status(503).json({ status: "starting" });
      return;
    }
    if (!isBootGatedRequest(req)) {
      // Static/SPA shell — served instantly during boot (see above).
      next();
      return;
    }
    res.status(503).json({
      error: "الخدمة قيد التشغيل، أعد المحاولة بعد لحظات",
      code: ErrorCode.SERVICE_UNAVAILABLE,
    });
  });
  gate.use(app);
  return gate;
}

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: "${value}"`);
  }

  return port;
}

function listen(port: number, remainingAttempts = DEFAULT_FALLBACK_ATTEMPTS): Server {
  const httpServer = createServer(buildGatedApp());
  // 96-F1 (R96-A5 M17): explicit HTTP server timeouts. Node's defaults
  // (requestTimeout 300 s, headersTimeout 60 s) let a dead-mobile-network
  // request hang the socket for minutes; the DB layer alone is capped at
  // 15 s and external gateway calls at 8 s, but nothing bounded a request
  // stuck between middlewares. 60 s / 65 s keeps every legitimate route
  // (worst case: OTP start's 20 s bounded settle wait + send retries)
  // comfortably under the ceiling while dead sockets release fast.
  httpServer.requestTimeout = 60_000;
  httpServer.headersTimeout = 65_000;
  // F6 (R98-A6): Node's default keepAliveTimeout is 5 s while Render's LB
  // holds idle keep-alive sockets ~100 s — the classic close-race (LB
  // reuses a socket the server just closed) yields sporadic 502s. 61 s
  // keeps reuse safe and stays under headersTimeout.
  httpServer.keepAliveTimeout = 61_000;
  initSocket(httpServer);

  httpServer.listen(port, () => {
    const address = httpServer.address();
    const actualPort = typeof address === "object" && address ? address.port : port;

    logger.info({ port: actualPort, ready: bootReady }, "Server listening");
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (
      process.env.NODE_ENV !== "production" &&
      err.code === "EADDRINUSE" &&
      port !== 0 &&
      port < 65535 &&
      remainingAttempts > 0
    ) {
      const nextPort = port + 1;

      logger.warn({ port, nextPort }, "Port in use, trying next port");
      listen(nextPort, remainingAttempts - 1);
      return;
    }

    logger.error({ err, port }, "Error listening on port");
    process.exit(1);
  });

  return httpServer;
}

/** R104 (AG6-4): readiness-blocking core — env fail-fast, Redis init,
 * boot migrations. Returns false when migrations failed in
 * NON-production (production exits inside). Schedulers are started
 * post-ready in main(). */
async function bootstrapCore(): Promise<boolean> {
  // F8 (R98-A6, 98-F5): ENCRYPTION_KEY fail-fast at boot — same posture as
  // SESSION_SECRET (lib/jwt.ts, dev AND prod). Previously the key was only
  // validated lazily at first encrypt/decrypt: a wiped/typo'd key booted
  // GREEN (healthz 200) while every encrypted-field write 500'd per request
  // and every read silently nulled through safeDecrypt. Runs FIRST so a bad
  // key refuses to serve before any Redis/DB/scheduler work. (migrate.ts
  // keeps the key optional by design — hence bootstrap(), not module load.)
  assertEncryptionKeyConfigured();

  // Connect the Redis singleton before app.use(...) runs any code that needs it.
  // In production, failure here degrades to in-memory rate limiting (H12 policy,
  // redis-client.ts); in dev we also fall back silently.
  await initRedisClient();

  // Boot-time schema migrations. Runs ONCE per cluster cold start via a
  // Redis NX EX lock; subsequent instances wait for the leader. All
  // statements in migrate.ts are idempotent (IF NOT EXISTS / IF EXISTS
  // / DROP NOT NULL guards), and transient Neon read-only/connection
  // windows are retried inside bootMigrations (B7-P0-1) before this
  // check ever sees them. On critical failure (anything other than
  // "already exists" or a retried-away transient), production refuses to
  // start — better to surface a deploy-time alert than serve traffic
  // against a half-migrated schema. Operator escape hatch:
  // DISABLE_BOOT_MIGRATIONS=true.
  const migrationResult = await bootMigrations();
  if (!migrationResult.ok) {
    if (process.env.NODE_ENV === "production") {
      logger.error(
        {
          category: "monitoring",
          outcome: migrationResult.outcome,
          err: migrationResult.error,
          code: migrationResult.errorCode,
        },
        "[boot] aborting startup — critical migration failure in production",
      );
      // Sentry already captured the exception inside bootMigrations.
      process.exit(1);
    }
    logger.warn(
      {
        category: "monitoring",
        outcome: migrationResult.outcome,
        err: migrationResult.error,
      },
      "[boot] migration failed in non-production — continuing with degraded schema",
    );
    return false;
  }

  // R104 (AG6-4): startWebSchedulers + logTelegramBootStatus moved to
  // main() as the post-ready tail — the leader election round trips no
  // longer delay the traffic gate.
  //
  // 2026-09-20 (free-infrastructure round): the WhatsApp warm-up loop
  // that used to start here is GONE — the warm-up self-check is now
  // intent-driven (scheduled one-shot per pairing epoch from the first
  // REAL ready observation: a readiness probe or an OTP attempt — see
  // services/openwa.service.ts). Nothing periodic starts at boot
  // anymore; nothing keeps Render/Neon/OpenWA awake on its own.
  return true;
}

// ── B7-P1-6: graceful SIGTERM/SIGINT drain ────────────────────────────────
//
// Previously the handler stopped schedulers and process.exit(0)'d
// immediately — in-flight HTTP responses were cut mid-byte and the DB
// pool was never drained on every Render deploy/restart. Order here:
//   1. release the scheduler leader lock FIRST (the next instance can
//      pick cron/watchers up immediately);
//   2. close Socket.IO (drops WS clients so they don't pin the server);
//   3. httpServer.close() (waits for in-flight requests; idle keep-alive
//      connections are closed proactively);
//   4. pool.end() (drains DB connections);
//   5. Sentry flush;
//   6. exit(0) — with a 10s force-exit timer so a hung step can't wedge
//      the deploy.
function registerShutdown(httpServer: Server, schedulers: WebSchedulerHandle): void {
  let shuttingDown = false;

  const handleSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "[server] received shutdown signal — draining");

    const forceExit = setTimeout(() => {
      logger.warn(
        { timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS },
        "[server] graceful shutdown timed out — forcing exit",
      );
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    forceExit.unref?.();

    // R107 (migration P1): evict idle keep-alive sockets IMMEDIATELY, before
    // any awaited close. io.close() internally awaits httpServer.close(),
    // which never settles while a reverse proxy (traefik/Coolify, Render's
    // edge) holds pooled keep-alive backend connections — the old order
    // (closeIdleConnections only inside step 3, AFTER the io.close() await)
    // deadlocked the drain on exactly those connections until the 10s
    // force-exit fired, skipping pool.end() and the Sentry flush on every
    // restart. A repeating sweeper also catches sockets that go idle AFTER
    // the signal (in-flight requests finishing during the drain window).
    const idleSweeper = setInterval(() => {
      httpServer.closeIdleConnections?.();
    }, 2_000);
    idleSweeper.unref?.();
    httpServer.closeIdleConnections?.();

    void (async () => {
      try {
        // 1. Leader lock release first.
        await schedulers.stop();
      } catch (err) {
        logger.error({ err }, "[server] scheduler stop error during shutdown");
      }

      // 2. Socket.IO transports.
      //    (Drops WS clients so they don't pin the server; also closes the
      //    underlying HTTP server — safe now that idle sockets are gone.)
      try {
        const io = getIO();
        if (io) await new Promise<void>((resolve) => io.close(() => resolve()));
      } catch (err) {
        logger.warn({ err }, "[server] Socket.IO close error during shutdown");
      }

      // 3. In-flight HTTP requests.
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // Idle keep-alive sockets would otherwise hold close() open for
        // their full timeout (Node ≥18.2). The sweeper above keeps this
        // from hanging; this call covers the sub-2s window.
        httpServer.closeIdleConnections?.();
      });

      // 4. DB pool.
      try {
        await pool.end();
      } catch (err) {
        logger.warn({ err }, "[server] pool end error during shutdown");
      }

      // 5. Sentry queue flush.
      try {
        await Sentry.close(2000);
      } catch {
        // best-effort only
      }
    })().finally(() => {
      clearInterval(idleSweeper);
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}

async function main(): Promise<void> {
  // Bind the port BEFORE bootstrap so the health probe sees 503
  // "starting" instead of a connection refused during migrations.
  const httpServer = listen(
    parsePort(rawPort),
    process.env.NODE_ENV === "production" ? 0 : DEFAULT_FALLBACK_ATTEMPTS,
  );

  // R104 (AG6-4): SPLIT the old bootstrap() into a readiness-blocking
  // core and a post-ready tail. Leader election (startWebSchedulers →
  // PG-lease first acquisition = 2 sequential cold-Neon round trips)
  // is NOT required to serve a correct API response — the coordinator
  // already retries acquisition in the background — so the traffic
  // gate no longer waits for it.
  const migrationResult = await bootstrapCore();
  if (!migrationResult) {
    // bootstrapCore already logged/exited for critical production
    // failures; only the non-production degraded path reaches here.
    logger.warn("[boot] continuing with degraded schema (non-production)");
  }

  // Core bootstrap resolved — open the traffic gate NOW.
  bootReady = true;
  logger.info(
    { port: httpServer.address(), category: "monitoring" },
    "[boot] core bootstrap complete — serving traffic",
  );

  // Post-ready tail: schedulers + leader election. Errors here must
  // not kill a serving instance — the coordinator's internal retry
  // loop owns transient failures.
  let schedulers: WebSchedulerHandle;
  try {
    schedulers = await startWebSchedulers(getRedisClient());
  } catch (err) {
    logger.error(
      { err, category: "monitoring" },
      "[boot] scheduler start failed — serving continues without background jobs",
    );
    schedulers = {
      stop: async () => {},
    } as WebSchedulerHandle;
  }

  // Surface Telegram readiness in the boot logs so the operator can
  // confirm notifications will deliver without opening the admin panel.
  // No-op if env is unset — just emits a single info line.
  logTelegramBootStatus();

  registerShutdown(httpServer, schedulers);
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
