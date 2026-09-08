import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { Router, type IRouter, type Request, type Response } from "express";
import { getRedisClient } from "../../lib/redis-client";
import { captureMessage, captureSubsystemException } from "../../lib/sentry";
import { writeAuditLog } from "../../lib/audit";
import { getIO } from "../../lib/socket";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { diagnosticPing } from "../../telegram";
import {
  createWhatsAppSession,
  deleteWhatsAppSession,
  getWhatsAppSessionQr,
  listWhatsAppSessions,
  requestWhatsAppPairCode,
  startWhatsAppSession,
  WhatsAppGatewayError,
} from "../../services/openwa.service";
import { db } from "@workspace/db";
import { inventoryTable, productsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { isEncrypted, safeDecrypt } from "../../lib/encryption";

const router: IRouter = Router();

// ── Event-loop delay monitor ─────────────────────────────────────────────────
//
// Started exactly once at module load (process start). Reports nanoseconds;
// we expose milliseconds. Mean > 100ms or p99 > 1s is symptomatic of a
// blocked event loop.

let eventLoopHistogram: IntervalHistogram | null = null;
try {
  eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
  eventLoopHistogram.enable();
} catch {
  // monitorEventLoopDelay can throw on very old Node — keep null so the
  // diagnostics route still works.
  eventLoopHistogram = null;
}

// ── R93-DATA (round-93): inventory deliverability health ──────────────────────
//
// GET /api/admin/diagnostics/inventory-health
//
// Scans UNSOLD inventory units and reports, per product, how many have
// credentials that cannot be delivered: ciphertext that fails GCM
// authentication with the current ENCRYPTION_KEY (wrong/rotated key at
// load time — live evidence: products 1-12 were seeded 2026-08-25 with a
// different key), or units with no deliverable fields at all. The checkout
// guard refuses to sell such units (INVENTORY_CORRUPT); this endpoint gives
// the operator the full blast radius + re-upload worklist in one call.
//
// Capped at the first 500 unsold rows per product family scan (sequential
// scan over the unsold set — the table is small today; the LIMIT keeps this
// bounded as the catalog grows). The decrypt check is CPU-cheap (GCM verify)
// and never exposes plaintext.
router.get("/inventory-health", requireAdmin, async (_req, res, next) => {
  try {
    const units = (await db
      .select({
        id: inventoryTable.id,
        productId: inventoryTable.productId,
        accountEmail: inventoryTable.accountEmail,
        accountPassword: inventoryTable.accountPassword,
        extraDetails: inventoryTable.extraDetails,
      })
      .from(inventoryTable)
      .where(and(eq(inventoryTable.isSold, false)))
      .limit(500)) as Array<{
      id: number;
      productId: number;
      accountEmail: string | null;
      accountPassword: string | null;
      extraDetails: string | null;
    }>;

    const products = await db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable);
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    const byProduct = new Map<
      number,
      {
        product_id: number;
        product_name: string;
        unsold: number;
        undeliverable: number;
        broken_unit_ids: number[];
      }
    >();
    for (const u of units) {
      let entry = byProduct.get(u.productId);
      if (!entry) {
        entry = {
          product_id: u.productId,
          product_name: nameById.get(u.productId) ?? `#${u.productId}`,
          unsold: 0,
          undeliverable: 0,
          broken_unit_ids: [],
        };
        byProduct.set(u.productId, entry);
      }
      entry.unsold += 1;
      const pwBroken =
        u.accountPassword !== null &&
        isEncrypted(u.accountPassword) &&
        safeDecrypt(u.accountPassword) === null;
      const emBroken =
        u.accountEmail !== null &&
        isEncrypted(u.accountEmail) &&
        safeDecrypt(u.accountEmail) === null;
      // F7 (round-94): extraDetails is encrypted at rest now too — a code
      // product whose code fails GCM is exactly as undeliverable as a
      // broken password (checkout's fieldDeliverable gate refuses the
      // sale on the same condition).
      const exBroken =
        u.extraDetails !== null &&
        isEncrypted(u.extraDetails) &&
        safeDecrypt(u.extraDetails) === null;
      const empty =
        u.accountPassword === null && u.accountEmail === null && u.extraDetails === null;
      if (pwBroken || emBroken || exBroken || empty) {
        entry.undeliverable += 1;
        if (entry.broken_unit_ids.length < 20) entry.broken_unit_ids.push(u.id);
      }
    }

    const items = [...byProduct.values()].sort((a, b) => b.undeliverable - a.undeliverable);
    res.json({
      scanned_unsold: units.length,
      scanned_cap: 500,
      products_with_undeliverable_units: items.filter((i) => i.undeliverable > 0).length,
      items,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", requireAdmin, (_req, res) => {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const redis = getRedisClient();
  const io = getIO();

  const eventLoopLag = eventLoopHistogram
    ? {
        meanMs: eventLoopHistogram.mean / 1e6,
        p50Ms: eventLoopHistogram.percentile(50) / 1e6,
        p95Ms: eventLoopHistogram.percentile(95) / 1e6,
        p99Ms: eventLoopHistogram.percentile(99) / 1e6,
        maxMs: eventLoopHistogram.max / 1e6,
      }
    : null;

  res.json({
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    },
    runtime: {
      uptimeSec: Math.floor(process.uptime()),
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "unknown",
      env: process.env.NODE_ENV ?? "development",
      service: process.env.RENDER_SERVICE_NAME ?? "web",
    },
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    },
    cpu: {
      userMs: Math.round(cpu.user / 1000),
      systemMs: Math.round(cpu.system / 1000),
    },
    eventLoop: eventLoopLag,
    deps: {
      redis: { connected: redis !== null },
      socket: { initialized: io !== null },
    },
    flags: {
      ALERTING_ENABLED: process.env.ALERTING_ENABLED ?? "true",
      METRICS_ENABLED: process.env.METRICS_ENABLED ?? "true",
      NEW_HEALTH_CHECKS_ENABLED: process.env.NEW_HEALTH_CHECKS_ENABLED ?? "true",
      FIREBASE_AUTH_ENABLED: process.env.FIREBASE_AUTH_ENABLED ?? "false",
    },
  });
});

// ── Sentry verification endpoint ─────────────────────────────────────────────
//
// Admin-only. Used post-deploy to confirm the Sentry pipeline is wired
// end-to-end (DSN reachable, beforeSend fires, tags attach, source maps
// resolve, breadcrumbs land). NOT a public endpoint.
//
// Usage:
//   GET /api/admin/diagnostics/sentry-debug
//     → returns the current init snapshot (DSN configured?, env, release,
//       sample rates, process tags). No Sentry event sent.
//
//   GET /api/admin/diagnostics/sentry-debug?mode=message
//     → captureMessage at "error" level. Lands in Sentry's Issues list
//       under the `subnation-backend` project.
//
//   GET /api/admin/diagnostics/sentry-debug?mode=subsystem
//     → captureSubsystemException with subsystem=test. Verifies the
//       grouping/tag pipeline.
//
//   GET /api/admin/diagnostics/sentry-debug?mode=throw
//     → throws — caught by setupExpressErrorHandler → captured + 500
//       response. Verifies the Express integration end-to-end.
router.get("/sentry-debug", requireAdmin, (req, res, next) => {
  const mode = String(req.query.mode ?? "snapshot").toLowerCase();
  const dsnConfigured = Boolean(process.env.SENTRY_DSN);

  if (mode === "throw") {
    // Express's setupExpressErrorHandler captures + flushes; user-
    // facing error message comes from our own error middleware.
    return next(new Error("[sentry-debug] intentional admin-triggered error"));
  }

  if (mode === "message") {
    captureMessage("[sentry-debug] admin-triggered test message", "error");
    return res.json({
      ok: true,
      mode: "message",
      dsnConfigured,
      note: "Look in Sentry Issues for the 'admin-triggered test message' event.",
    });
  }

  if (mode === "subsystem") {
    captureSubsystemException("test", new Error("[sentry-debug] admin-triggered subsystem test"), {
      triggered_by: "diagnostics endpoint",
    });
    return res.json({
      ok: true,
      mode: "subsystem",
      dsnConfigured,
      note: "Look in Sentry — the issue should have subsystem=test tag.",
    });
  }

  // Default: snapshot.
  return res.json({
    ok: true,
    mode: "snapshot",
    sentry: {
      dsnConfigured,
      environment: process.env.NODE_ENV ?? "development",
      release: (process.env.RENDER_GIT_COMMIT ?? "unknown").slice(0, 7),
      tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1 (default)",
      profilesSampleRate: process.env.SENTRY_PROFILES_SAMPLE_RATE ?? "0.1 (default)",
      processTags: {
        instance_id: process.env.RENDER_INSTANCE_ID ?? "local",
        service_id: process.env.RENDER_SERVICE_ID ?? "subnation",
        deploy_id: process.env.RENDER_DEPLOY_ID ?? "dev",
        region: process.env.RENDER_REGION ?? "unknown",
        git_branch: process.env.RENDER_GIT_BRANCH ?? "unknown",
        subsystem: process.env.WORKER_ROLE === "true" ? "worker" : "web",
      },
    },
    usage: {
      throw: "?mode=throw       — triggers a captured exception via Express",
      message: "?mode=message     — sends a captureMessage at error level",
      subsystem: "?mode=subsystem   — sends via captureSubsystemException",
    },
  });
});

// ── WhatsApp session management ─────────────────────────────────────────────
//
// The OpenWA API key is server-only. These admin endpoints proxy the small
// operator surface needed to provision, pair, inspect, and remove a session;
// only an authenticated admin with the `settings` permission reaches them via
// the parent admin router mount.

function whatsappGatewayError(res: Response, err: unknown) {
  if (err instanceof WhatsAppGatewayError) {
    const code =
      err.statusCode === 400
        ? ErrorCode.INVALID_DATA
        : err.statusCode === 404
          ? ErrorCode.NOT_FOUND
          : err.statusCode === 409
            ? ErrorCode.CONFLICT
            : ErrorCode.SERVICE_UNAVAILABLE;
    return res
      .status(err.statusCode)
      .json(createErrorResponse("تعذر تنفيذ عملية جلسة واتساب", code));
  }
  return res
    .status(502)
    .json(createErrorResponse("بوابة واتساب غير متاحة حالياً", ErrorCode.SERVICE_UNAVAILABLE));
}

function sessionIdParam(req: Request): string {
  const value = req.params.id;
  return typeof value === "string" ? value : "";
}

router.get("/whatsapp/sessions", requireAdmin, async (_req, res) => {
  try {
    return res.json({ sessions: await listWhatsAppSessions() });
  } catch (err) {
    return whatsappGatewayError(res, err);
  }
});

router.post("/whatsapp/sessions", requireAdmin, async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const session = await createWhatsAppSession(name);
    void writeAuditLog(req, "whatsapp.session_create", "whatsapp_session", null, {
      sessionId: session.id,
      name: session.name,
    });
    return res.status(201).json({ session });
  } catch (err) {
    return whatsappGatewayError(res, err);
  }
});

router.post("/whatsapp/sessions/:id/start", requireAdmin, async (req, res) => {
  try {
    const session = await startWhatsAppSession(sessionIdParam(req));
    void writeAuditLog(req, "whatsapp.session_start", "whatsapp_session", null, {
      sessionId: session.id,
    });
    return res.json({ session });
  } catch (err) {
    return whatsappGatewayError(res, err);
  }
});

router.post("/whatsapp/sessions/:id/pair-code", requireAdmin, async (req, res) => {
  try {
    const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
    const result = await requestWhatsAppPairCode(sessionIdParam(req), phone);
    void writeAuditLog(req, "whatsapp.session_pair_code", "whatsapp_session", null, {
      sessionId: result.session.id,
    });
    return res.json(result);
  } catch (err) {
    return whatsappGatewayError(res, err);
  }
});

router.get("/whatsapp/sessions/:id/qr", requireAdmin, async (req, res) => {
  try {
    return res.json(await getWhatsAppSessionQr(sessionIdParam(req)));
  } catch (err) {
    return whatsappGatewayError(res, err);
  }
});

router.delete("/whatsapp/sessions/:id", requireAdmin, async (req, res) => {
  try {
    const result = await deleteWhatsAppSession(sessionIdParam(req));
    void writeAuditLog(req, "whatsapp.session_delete", "whatsapp_session", null, {
      sessionId: result.id,
    });
    return res.json(result);
  } catch (err) {
    return whatsappGatewayError(res, err);
  }
});

// ── Telegram diagnostic ping ─────────────────────────────────────────────────
//
// Operator-triggered "is the bot reachable?" check. Sends a real
// message to the configured chat using the same dispatch path as
// production notifications, then echoes the structured result so the
// operator can distinguish:
//
//   - configured=false              env not set; configure first
//   - configured=true, delivered=true  delivery confirmed end-to-end
//   - configured=true, delivered=false errorMessage explains why
//                                     (bad token, chat_not_found,
//                                     network timeout, etc.)
//
// Always returns 200 so the admin UI can render the structured result;
// dispatch failures are not server errors.
router.post("/telegram-test", requireAdmin, async (_req, res) => {
  const result = await diagnosticPing();
  return res.json(result);
});

export { router as adminDiagnosticsRouter };
