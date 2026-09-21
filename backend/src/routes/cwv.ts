import express, { Router, type IRouter } from "express";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { cwvLogger } from "../lib/logger";
import { cwvSampleValue, cwvSamplesTotal, safeInc, safeObserve } from "../lib/metrics";

const router: IRouter = Router();

// ── Lightweight runtime validator ────────────────────────────────────────────
//
// The CWV beacon contract is small and fixed. A hand-rolled guard avoids
// pulling `zod` into backend/package.json as a direct dependency.

interface CWVSample {
  name: "LCP" | "FCP" | "INP" | "CLS" | "TTFB";
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  route: string;
  viewportClass: "mobile" | "desktop";
  connectionType?: string;
  sessionId: string;
  timestamp: number;
}

const CWV_NAMES = new Set(["LCP", "FCP", "INP", "CLS", "TTFB"]);
const CWV_VIEWPORTS = new Set(["mobile", "desktop"]);
const CWV_RATINGS = new Set(["good", "needs-improvement", "poor"]);
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Route-label normalization (SEC-92-05, round-92) ─────────────────────────
//
// The `route` label feeds TWO prom-client series (cwv_samples_total counter
// + cwv_sample_value histogram with 19 buckets). It is fully
// client-controlled; an anonymous attacker POSTing route:"/x"+i used to
// mint an unbounded number of label sets (registry memory growth +
// /api/metrics response bloat = cardinality DoS). Every value that can
// reach the registry is now drawn from THIS bounded table:
//   - exact matches against STATIC_ROUTE_LABELS (the SPA route table from
//     frontend/src/App.tsx),
//   - dynamic routes collapsed to their pattern via DYNAMIC_ROUTE_RULES
//     ("/product/netflix-premium" → "/product/:slug"),
//   - everything else → "other".
// All labels are hardcoded strings well under 64 chars, so the 64-char cap
// holds by construction. The RAW route string still reaches the structured
// cwvLogger line only (bounded at 512 by the validator above).
const STATIC_ROUTE_LABELS = new Set([
  // storefront
  "/",
  "/login",
  "/register",
  "/onboarding",
  "/wallet",
  "/orders",
  "/loyalty",
  "/referrals",
  "/support",
  "/status",
  "/terms",
  "/profile",
  "/cart",
  "/checkout",
  "/flash-sales",
  "/auth/callback",
  "/auth/telegram-callback",
  // admin (frontend/src/App.tsx admin routes)
  "/admin",
  "/admin/login",
  "/admin/topups",
  "/admin/orders",
  "/admin/products",
  "/admin/products/enrichment",
  "/admin/pricing",
  "/admin/users",
  "/admin/settings",
  "/admin/security",
  "/admin/tickets",
  "/admin/referrals",
  "/admin/coupons",
  "/admin/promotions",
  "/admin/alerts",
  "/admin/system",
  "/admin/admins",
  "/admin/risk",
  "/admin/whatsapp",
]);

// Longest-prefix-first so "/admin/risk/events/…" resolves before any
// shorter overlapping rule.
const DYNAMIC_ROUTE_RULES: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: "/admin/risk/events/", label: "/admin/risk/events/:id" },
  { prefix: "/product/", label: "/product/:slug" },
  { prefix: "/category/", label: "/category/:slug" },
  { prefix: "/orders/", label: "/orders/:orderCode" },
];

/** Bounded output: always a table entry or "other" (≤ 64 chars). */
export function normalizeCwvRouteLabel(rawRoute: string): string {
  let route = rawRoute.split("?")[0].split("#")[0].trim();
  // Collapse trailing slashes ("/wallet/" → "/wallet"); keep "/" itself.
  while (route.length > 1 && route.endsWith("/")) {
    route = route.slice(0, -1);
  }
  if (route.length === 0) return "other";
  if (STATIC_ROUTE_LABELS.has(route)) return route;
  for (const rule of DYNAMIC_ROUTE_RULES) {
    if (route.startsWith(rule.prefix)) return rule.label;
  }
  return "other";
}

function isCWVSample(v: unknown): v is CWVSample {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;

  if (typeof o.name !== "string" || !CWV_NAMES.has(o.name)) return false;
  if (typeof o.value !== "number" || !Number.isFinite(o.value) || o.value < 0) return false;
  if (typeof o.route !== "string" || o.route.length < 1 || o.route.length > 512) return false;
  if (typeof o.viewportClass !== "string" || !CWV_VIEWPORTS.has(o.viewportClass)) return false;
  if (typeof o.sessionId !== "string" || !UUID_V4_RE.test(o.sessionId)) return false;
  if (typeof o.timestamp !== "number" || !Number.isInteger(o.timestamp) || o.timestamp <= 0) {
    return false;
  }
  if (o.rating !== undefined && (typeof o.rating !== "string" || !CWV_RATINGS.has(o.rating))) {
    return false;
  }
  if (
    o.connectionType !== undefined &&
    (typeof o.connectionType !== "string" || o.connectionType.length > 32)
  ) {
    return false;
  }
  return true;
}

// ── Per-session cap (30 beacons / minute / sessionId) ────────────────────────

const sessionCaps = new Map<string, { count: number; windowStart: number }>();
const SESSION_WINDOW_MS = 60_000;
const SESSION_CAP = 30;

/** R104 (AG2-2): max samples accepted in one batched POST. The client
 * batches at most the 5 metric families per page view (plus small
 * re-measures); 10 is a defensive ceiling that keeps the 8 KiB body
 * limit meaningful. */
const MAX_BATCH_SAMPLES = 10;

function isOverSessionCap(sessionId: string): boolean {
  const now = Date.now();
  const entry = sessionCaps.get(sessionId);
  if (!entry || now - entry.windowStart >= SESSION_WINDOW_MS) {
    sessionCaps.set(sessionId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > SESSION_CAP;
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_WINDOW_MS;
  for (const [id, entry] of sessionCaps) {
    if (entry.windowStart < cutoff) sessionCaps.delete(id);
  }
}, SESSION_WINDOW_MS).unref?.();

// ── Body parsing (defensive) ─────────────────────────────────────────────────
//
// `navigator.sendBeacon` defaults the Content-Type to `text/plain;charset=UTF-8`
// when called with a plain string body. The top-level `express.json()`
// middleware ignores text/plain bodies, leaving `req.body` undefined and
// every beacon failing validation with 400.
//
// The frontend has been updated to wrap the payload in a `Blob` with
// type:"application/json", which restores the json parser path. We ALSO
// install a route-scoped `express.text()` parser here as a defence in depth
// so that any future caller (third-party script, vendor SDK, retro bug)
// using the default `sendBeacon(url, "<string>")` form still ingests
// successfully.
//
// Limit kept tight (8 KiB) so this route can never be used for large
// payload abuse.
const cwvBodyParser = express.text({
  type: ["text/plain", "application/x-www-form-urlencoded", "application/octet-stream"],
  limit: "8kb",
});

// ── Route handler ────────────────────────────────────────────────────────────

router.post("/cwv", cwvBodyParser, (req, res) => {
  // Normalise: when sent via the defensive text parser above, req.body is
  // a string; JSON.parse it. When sent via express.json() upstream, req.body
  // is already an object.
  let body: unknown = req.body;
  if (typeof body === "string") {
    if (body.length === 0) {
      res.status(400).json(
        createErrorResponse("invalid_cwv_sample", ErrorCode.INVALID_DATA, {
          reason: "empty_body",
        }),
      );
      return;
    }
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json(
        createErrorResponse("invalid_cwv_sample", ErrorCode.INVALID_DATA, {
          reason: "malformed_json",
        }),
      );
      return;
    }
  }

  // R104 (AG2-2 + AG8-3): the frontend now sends ONE batched POST per page
  // view (array of samples, flushed on tab-hide) instead of one POST per
  // metric — 5 requests → 1 on every page view, and no retry amplification
  // during a cold start. Single-sample bodies (the historical shape) stay
  // accepted: normalize both to an array here.
  let samples: unknown[];
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > MAX_BATCH_SAMPLES) {
      res.status(400).json(
        createErrorResponse("invalid_cwv_sample", ErrorCode.INVALID_DATA, {
          reason: "invalid_batch_size",
        }),
      );
      return;
    }
    samples = body;
  } else {
    samples = [body];
  }

  if (!samples.every((s) => isCWVSample(s))) {
    res.status(400).json(
      createErrorResponse("invalid_cwv_sample", ErrorCode.INVALID_DATA, {
        reason: "schema_mismatch",
      }),
    );
    return;
  }
  const batch = samples as CWVSample[];

  // Session cap applies per sample inside the batch (a 5-metric batch
  // consumes 5 of the 30/min budget — same economics as 5 single posts).
  const overCap = batch.find((s) => isOverSessionCap(s.sessionId));
  if (overCap) {
    // Silently drop — the client must not retry, but the rate-limit must
    // not be observable as an error.
    res.status(204).end();
    return;
  }

  for (const sample of batch) {
    // SEC-92-05: the Prometheus label is the NORMALIZED route (bounded table
    // above) — never the raw client string. The raw route (already bounded
    // at 512 by the validator) only reaches the structured log line below.
    const routeLabel = normalizeCwvRouteLabel(sample.route);

    const labels = {
      name: sample.name,
      route: routeLabel,
      viewport: sample.viewportClass,
    };

    safeInc(cwvSamplesTotal, labels);
    safeObserve(cwvSampleValue, labels, sample.value);
  }

  // AG8-3 (R104 log-volume): the per-sample info line was the single
  // largest hot-path log source (~5 lines per page view, duplicating data
  // already in cwv_samples_total / cwv_sample_value). Demoted to debug —
  // the metrics carry the signal; enable LOG_LEVEL=debug to see payloads.
  cwvLogger().debug(
    {
      cwv_batch: batch.map((s) => ({
        name: s.name,
        value: s.value,
        rating: s.rating,
        route: s.route,
        viewport: s.viewportClass,
        connection: s.connectionType,
      })),
    },
    "cwv samples received",
  );

  res.status(204).end();
});

export default router;
