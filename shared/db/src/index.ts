import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add it in your host's environment (the Coolify env panel / " +
      "compose .env — or on the legacy Render path: Dashboard → Environment → " +
      "DATABASE_URL with your Neon connection string). If you use a Blueprint with sync: false for this key, " +
      "the value is never read from render.yaml—you must set it on the service manually.",
  );
}

const parsedDatabaseUrl = new URL(databaseUrl);
const sslMode = parsedDatabaseUrl.searchParams.get("sslmode");
const requiresSsl =
  sslMode === "require" ||
  sslMode === "verify-ca" ||
  sslMode === "verify-full" ||
  parsedDatabaseUrl.hostname.endsWith(".neon.tech");
// Default pool sizes:
//   - production: 15  — a SAFETY NET only, for a missing/typo'd
//     DB_POOL_MAX. Production render.yaml pins DB_POOL_MAX=8 (2026-09-20
//     cold-start storm tuning: Neon Free 0.25 CU can't absorb a
//     15-connection burst on a freshly-woken compute). With the Neon
//     pooler the upstream limit is much higher, so this is the
//     per-instance bound.
//   - dev: 10
// The env var DB_POOL_MAX always wins. The default exists only so a
// missing/typo'd env doesn't silently cap us at 5 connections (which
// causes connection-starvation under ~50 concurrent users — that was
// the symptom the May 2026 load test surfaced).
// R104 (AG5-8): production fallback 15 → 8 — matches the deployed
// DB_POOL_MAX pin (render.yaml). A lost/typo'd env var previously
// silently reverted to a 15-connection burst — exactly the cold-start
// connection storm the 2026-09-20 tuning removed. Neon free (0.25 CU)
// queues badly behind 15 concurrent connects.
const poolMax = Number(process.env.DB_POOL_MAX ?? (process.env.NODE_ENV === "production" ? 8 : 10));
const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000);
const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 10_000);

// ── R4 (round-93 A3): server-side statement timeout ─────────────────────────
//
// Previously NOTHING bounded an individual query: pg's
// connectionTimeoutMillis only covers POOL ACQUISITION, and a Neon
// AZ/pooler stall with silent packet drops left each of the 15 clients
// stuck mid-query forever — pool exhausted, every DB-touching request
// hung, liveness still 200 ("green while dead"). pg transmits
// `statement_timeout` as a per-connection startup parameter
// (lib/client.js: getStartupData), so every pooled connection now gets a
// server-side deadline: the query errors out and the client returns to
// the pool instead of pinning it.
//
// Sizing: 15 s is far above every runtime query p95 and above the
// migration statements (ctid-batched DELETEs ≤ 1000 rows, count probes,
// guarded DDL). If a future migration legitimately needs longer, set
// PG_STATEMENT_TIMEOUT_MS higher (or "0" to disable) on the service for
// the deploy — env is read per boot, so a redeploy picks it up.
//
// R127 (B8 F-P2): the startup-packet transport above is a NO-OP on
// Neon — live-probed on both the pooler and direct endpoints: pg 8.20.0
// does send `statement_timeout` in getStartupConf(), but Neon ignores
// that startup parameter and the server session reports
// `statement_timeout = 0`. The post-connect `SET` hook below
// (pool.on("connect")) is therefore the mechanism that actually
// enforces the deadline; the startup packet is kept as a harmless
// belt for non-Neon hosts that do honor it.
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

/**
 * Parse PG_STATEMENT_TIMEOUT_MS. Returns the timeout in ms; 0 = disabled
 * (operator escape hatch for unusually long migrations/queries). Invalid
 * or missing values fall back to the 15 s default. Exported for unit
 * tests (R4).
 */
export function resolveStatementTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_STATEMENT_TIMEOUT_MS;
  return parsed;
}

const statementTimeoutMs = resolveStatementTimeoutMs(process.env.PG_STATEMENT_TIMEOUT_MS);

const poolConfig: pg.PoolConfig & { enableChannelBinding?: boolean } = {
  connectionString: databaseUrl,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 15,
  idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) ? idleTimeoutMillis : 30_000,
  connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis)
    ? connectionTimeoutMillis
    : 10_000,
  // R4 (round-93 A3): server-side statement deadline per pooled
  // connection (see comment above). 0 → omit → no timeout (disabled).
  statement_timeout: statementTimeoutMs > 0 ? statementTimeoutMs : undefined,
  // R4 (round-93 A3): TCP keepalives so a silently-dropped connection
  // (AZ stall / NAT idle timeout) is detected by the OS instead of
  // black-holing the socket until the statement timeout fires. pg maps
  // keepAlive:true + keepAliveInitialDelayMillis to libpq's
  // keepalives=1 / keepalives_idle=30.
  keepAlive: true,
  keepAliveInitialDelayMillis: 30_000,
  ssl: requiresSsl ? { rejectUnauthorized: true } : undefined,
};

if (parsedDatabaseUrl.searchParams.get("channel_binding") === "require") {
  poolConfig.enableChannelBinding = true;
}

export const pool = new Pool(poolConfig);

// ── R117 (A1-P2): dedicated advisory-lock pool ─────────────────────────────
//
// Session-scoped advisory locks (pg_try_advisory_lock) live on the
// connection that took them, so a lock holder occupies its client for the
// WHOLE critical section. The OTP start gate (whatsapp-otp.service.ts)
// spans an external WhatsApp send (~30 s worst case with retries), so
// holders taken from the runtime pool could pin up to `max` runtime
// clients: with the production pin (DB_POOL_MAX=8), eight concurrent OTP
// starts for distinct phones would wedge every start on pool acquisition
// (10 s connectionTimeout → 500s) AND starve the app's entire DB layer
// while the sends were in flight.
//
// This tiny separate pool bounds that occupancy to 2 connections that no
// request path shares. Callers map lock-pool saturation to a busy/retry
// verdict (429-style), never to a runtime 500. connectionTimeoutMillis is
// deliberately short (2 s): under a lock burst the excess callers fail
// fast into the retry path instead of queueing behind holders.
export const lockPool = new Pool({
  ...poolConfig,
  max: 2,
  connectionTimeoutMillis: 2_000,
});

// Same rationale as the runtime pool's handler: an idle lock client killed
// by a Neon suspend / socket reset surfaces here instead of throwing as an
// unhandled EventEmitter 'error' (which would take the process down).
lockPool.on("error", (err) => {
  console.error("[db] PostgreSQL lockPool error", err);
});

// ── R127 (B8 F-P2): post-connect statement_timeout SET ─────────────────────
//
// Neon DROPS the `statement_timeout` startup parameter (live-verified on
// both the -pooler and direct endpoints: the packet is sent but the
// server session reports `statement_timeout = 0`), so the R4 "green while
// dead" pool-pin defense was never actually live — a live-but-stuck query
// pinned its pool client indefinitely (TCP keepalives only catch dead
// sockets, not live-hung queries; idle_in_transaction_session_timeout
// covers only idle-in-tx time, not active execution).
//
// A per-connection `SET statement_timeout` DOES stick through the pooler
// (probe-verified), so every new client of BOTH pools re-asserts it on
// connect. Session homogeneity holds under PgBouncer connection reuse
// because every client of both pools carries the same value. The catch
// swallow is deliberate: a failed SET (e.g. a proxy that rejects session
// commands) must never take the connection down — the query then simply
// runs unbounded, exactly like before this hook.
//
// R128 (B3-F1): the failure is now LOGGED (with the pool identity) via
// the file's own console.error idiom — same justification as the pool
// error handlers below (importing the backend logger from @workspace/db
// inverts the workspace dependency direction). The R127-B8 probe found
// the startup-packet transport had been silently inert for 34 rounds
// precisely because nothing surfaced its failure; a SET that starts
// failing (pooler/policy change, config regression) must not be able to
// return every connection to unbounded queries with zero operator
// signal.
for (const p of [pool, lockPool]) {
  p.on("connect", (client) => {
    if (statementTimeoutMs > 0)
      void client.query(`SET statement_timeout = ${statementTimeoutMs}`).catch((err) => {
        console.error(
          `[db] statement_timeout SET failed on the ${p === pool ? "runtime pool" : "lockPool"} — queries on this connection run unbounded`,
          err,
        );
      });
  });
}

// Exported for unit tests (R4) — the exact config handed to pg.Pool.
export { poolConfig as dbPoolConfig };

// Pool-level errors (idle client killed by a Neon suspend, socket reset,
// DNS/TLS failure) surface here. Logged via console.error DELIBERATELY —
// the pino logger and the neonPoolErrorsTotal counter both live in the
// backend package (backend/src/lib/logger.ts, backend/src/lib/metrics.ts):
// importing either from @workspace/db would invert the workspace
// dependency direction (backend → shared) and create a module cycle
// (backend/src/lib/db-instrumentation.ts imports this pool). The metric
// + Sentry capture ARE wired for this exact pool: the backend's
// instrumentDbPool() (backend/src/lib/db-instrumentation.ts:230-238,
// called at boot in server.ts:25) registers its own "error" listener on
// the same EventEmitter, so every error this handler logs is also
// counted in neonPoolErrorsTotal and captured to Sentry.
pool.on("error", (err) => {
  console.error("[db] PostgreSQL pool error", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
