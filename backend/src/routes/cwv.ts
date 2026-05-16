import { Router, type IRouter } from "express";
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

// ── Route handler ────────────────────────────────────────────────────────────

router.post("/cwv", (req, res) => {
  if (!isCWVSample(req.body)) {
    res.status(400).json({ error: "invalid_cwv_sample" });
    return;
  }
  const sample = req.body;

  if (isOverSessionCap(sample.sessionId)) {
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
