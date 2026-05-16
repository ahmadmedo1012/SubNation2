import express, { Router, type IRouter } from "express";
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
      res.status(400).json({ error: "invalid_cwv_sample", reason: "empty_body" });
      return;
    }
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "invalid_cwv_sample", reason: "malformed_json" });
      return;
    }
  }

  if (!isCWVSample(body)) {
    res.status(400).json({ error: "invalid_cwv_sample", reason: "schema_mismatch" });
    return;
  }
  const sample = body;

  if (isOverSessionCap(sample.sessionId)) {
    // Silently drop — the client must not retry, but the rate-limit must
    // not be observable as an error.
    res.status(204).end();
    return;
  }

  const labels = {
    name: sample.name,
    route: sample.route,
    viewport: sample.viewportClass,
  };

  safeInc(cwvSamplesTotal, labels);
  safeObserve(cwvSampleValue, labels, sample.value);

  cwvLogger().info(
    {
      cwv: {
        name: sample.name,
        value: sample.value,
        rating: sample.rating,
        route: sample.route,
        viewport: sample.viewportClass,
        connection: sample.connectionType,
      },
    },
    "cwv sample received",
  );

  res.status(204).end();
});

export default router;
