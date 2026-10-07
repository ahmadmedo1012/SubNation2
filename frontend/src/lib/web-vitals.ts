/**
 * Core Web Vitals client for the SubNation frontend.
 *
 * - Captures LCP / FCP / INP / CLS / TTFB once per page visit.
 * - R104 (AG2-2, free-tier wake-up economics): buffers ALL samples and
 *   sends ONE combined POST /api/cwv (array body) — flushed on
 *   tab-hide/pagehide or 30 s after the last flush at the latest
 *   sample arrival. The old shape fired one POST PER METRIC
 *   immediately (up to 5 requests per page view, each with its own
 *   2×5 s retry amplification during a cold start — pure wake-up
 *   pressure on the Render free instance for telemetry nobody reads
 *   in real time).
 * - Uses navigator.sendBeacon (with a `fetch keepalive` fallback) and
 *   never blocks the UI.
 * - All exceptions are caught at the module boundary so a CWV bug can never
 *   break the app.
 *
 * v4 API note: web-vitals v4 exports `onCLS / onFCP / onINP / onLCP / onTTFB`.
 * Earlier `getCLS / …` names are removed in v4 — using them throws at module
 * resolve time. This file uses the v4 API exclusively.
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import { apiUrl } from "./api-config";

// ── Configuration ────────────────────────────────────────────────────────────

const BEACON_ENDPOINT = apiUrl("/api/cwv");
const MAX_BUFFER_AGE_MS = 60_000;
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 5_000;
/** R104: a fresh sample arriving this long after the last flush triggers a
 * combined batch send — no timers, purely event-driven. The 5 metric
 * families typically land within the first seconds of a visit, so one
 * page view ≈ one POST. */
const BATCH_WINDOW_MS = 30_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CWVSample {
  name: "LCP" | "FCP" | "INP" | "CLS" | "TTFB";
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  route: string;
  viewportClass: "mobile" | "desktop";
  connectionType?: string;
  sessionId: string;
  timestamp: number;
}

interface NetworkInformation {
  effectiveType?: string;
}

// ── Session helpers ──────────────────────────────────────────────────────────

function getSessionId(): string {
  try {
    const stored = sessionStorage.getItem("cwv_session_id");
    if (stored) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem("cwv_session_id", id);
    return id;
  } catch {
    // sessionStorage may throw in private mode / sandboxed iframes — fall back
    // to a per-call UUID so we still emit something useful.
    return crypto.randomUUID();
  }
}

function getViewportClass(): "mobile" | "desktop" {
  return window.innerWidth <= 768 ? "mobile" : "desktop";
}

function getConnectionType(): string | undefined {
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return conn?.effectiveType;
}

function getCurrentRoute(): string {
  // V3-B7: the router is PATH-based (wouter) — preferring location.hash
  // misattributed /terms#privacy metrics to a phantom "/privacy" route.
  // Drop the hash entirely: it is anchor state, never a route.
  return window.location.pathname || "/";
}

// ── Beacon transmission ──────────────────────────────────────────────────────

/**
 * Serialise the sample for transport. We always send `application/json` so
 * the backend's `express.json()` parser handles the body uniformly across
 * the `sendBeacon` and `fetch keepalive` paths.
 *
 * `navigator.sendBeacon` deduces the request `Content-Type` from the body
 * argument: a plain string becomes `text/plain;charset=UTF-8`, which
 * `express.json()` ignores — leaving `req.body` undefined and the route
 * rejecting every beacon as `400 invalid_cwv_sample`. Wrapping the JSON in
 * a `Blob` with an explicit MIME type fixes that.
 */
function toBeaconBody(samples: CWVSample[]): Blob {
  return new Blob([JSON.stringify(samples)], { type: "application/json" });
}

function sendBeaconSync(samples: CWVSample[]): boolean {
  try {
    const body = toBeaconBody(samples);
    return navigator.sendBeacon?.(BEACON_ENDPOINT, body) ?? false;
  } catch {
    return false;
  }
}

async function sendBeaconAsync(samples: CWVSample[]): Promise<boolean> {
  try {
    const response = await fetch(BEACON_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(samples),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendWithRetry(samples: CWVSample[]): Promise<boolean> {
  if (sendBeaconSync(samples)) return true;
  if (await sendBeaconAsync(samples)) return true;
  for (let i = 0; i < RETRY_COUNT; i++) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    if (await sendBeaconAsync(samples)) return true;
  }
  return false;
}

// ── Sample buffering ─────────────────────────────────────────────────────────

interface BufferedSample {
  sample: CWVSample;
  timestamp: number;
}

const sampleBuffer: BufferedSample[] = [];
let lastFlushAt = 0;
let flushInFlight = false;

function addToBuffer(sample: CWVSample): void {
  const cutoff = Date.now() - MAX_BUFFER_AGE_MS;
  for (let i = sampleBuffer.length - 1; i >= 0; i--) {
    if (sampleBuffer[i]!.timestamp < cutoff) sampleBuffer.splice(i, 1);
  }
  sampleBuffer.push({ sample, timestamp: Date.now() });
}

async function flushBuffer(): Promise<void> {
  if (flushInFlight || sampleBuffer.length === 0) return;
  flushInFlight = true;
  try {
    const samplesToSend = sampleBuffer.splice(0, sampleBuffer.length);
    lastFlushAt = Date.now();
    await sendWithRetry(samplesToSend.map(({ sample }) => sample)).catch(() => {
      // Swallowed at module boundary — never break the UI.
    });
  } finally {
    flushInFlight = false;
  }
}

// ── Rating mapping ───────────────────────────────────────────────────────────

function rate(
  value: number,
  thresholds: { good: number; poor: number },
): "good" | "needs-improvement" | "poor" {
  if (value <= thresholds.good) return "good";
  if (value <= thresholds.poor) return "needs-improvement";
  return "poor";
}

function buildSample(name: "LCP" | "FCP" | "INP" | "CLS" | "TTFB", value: number): CWVSample {
  const sample: CWVSample = {
    name,
    value,
    route: getCurrentRoute(),
    viewportClass: getViewportClass(),
    connectionType: getConnectionType(),
    sessionId: getSessionId(),
    timestamp: Date.now(),
  };

  // web.dev p75 thresholds (https://web.dev/articles/vitals)
  switch (name) {
    case "LCP":
      sample.rating = rate(value, { good: 2500, poor: 4000 });
      break;
    case "FCP":
      sample.rating = rate(value, { good: 1800, poor: 3000 });
      break;
    case "INP":
      sample.rating = rate(value, { good: 200, poor: 500 });
      break;
    case "CLS":
      sample.rating = rate(value, { good: 0.1, poor: 0.25 });
      break;
    // TTFB has no standardised pass/fail rating — left unrated.
  }

  return sample;
}

function collectAndSend(name: CWVSample["name"], value: number): void {
  try {
    addToBuffer(buildSample(name, value));
    // R104 (AG2-2): NO immediate flush — the sample waits in the buffer
    // for its siblings (the 5 metric families land within seconds of
    // each other) and ships as ONE batched POST when either (a) a fresh
    // sample arrives ≥ 30 s after the last flush, or (b) the tab is
    // hidden / the page unloaded (see initWebVitals listeners). No
    // timers: a blind delayed POST could wake an already-sleeping
    // Render instance — flushes are strictly user/metric-event driven.
    if (lastFlushAt === 0) {
      // First batch of the session: OPEN the window instead of flushing
      // (a zero initial would otherwise satisfy any elapsed check).
      lastFlushAt = Date.now();
    } else if (Date.now() - lastFlushAt >= BATCH_WINDOW_MS) {
      void flushBuffer();
    }
  } catch {
    // Module boundary — never break the UI.
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface InitWebVitalsOptions {
  enabled?: boolean;
  endpoint?: string;
  /**
   * R120-B5 (A5-F18): fraction of sessions that collect CWV samples
   * (0 ≤ rate ≤ 1). Decided ONCE per init call — one coin flip for the
   * whole session, never per metric — via Math.random() < sampleRate,
   * so an un-sampled boot skips the web-vitals subscriptions and the
   * visibility/pagehide listeners entirely (zero observer + listener
   * overhead, zero beacons). Defaults to 1.0 — every session collected,
   * the exact pre-R120 behavior until a caller configures otherwise.
   */
  sampleRate?: number;
}

/**
 * Initialise CWV collection. Call once at app boot from main.tsx.
 *
 * Defaults to enabled. Pass `{ enabled: false }` to skip (e.g. in dev).
 */
export function initWebVitals(options: InitWebVitalsOptions = {}): void {
  const { enabled = true, sampleRate = 1 } = options;
  if (!enabled) return;
  // `endpoint` arg accepted for API parity with design.md §3.1.14;
  // routing remains the constant BEACON_ENDPOINT.

  // A5-F18: session-level sampling — clamp defensively (an out-of-range
  // rate must never disable collection by accident; it collects).
  const rate = Number.isFinite(sampleRate) ? Math.min(1, Math.max(0, sampleRate)) : 1;
  // Math.random() ∈ [0, 1) — `x < 1` is always true, so the default 1.0
  // keeps 100% of sessions. One flip per session (init runs once at
  // boot), all-or-nothing: metrics are only meaningful as a complete
  // per-visit set, never per-metric sampling.
  if (Math.random() >= rate) return;

  try {
    onLCP((m) => collectAndSend("LCP", m.value));
    onFCP((m) => collectAndSend("FCP", m.value));
    onINP((m) => collectAndSend("INP", m.value));
    onCLS((m) => collectAndSend("CLS", m.value));
    onTTFB((m) => collectAndSend("TTFB", m.value));
  } catch {
    // web-vitals subscription failure must not break the app.
    return;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushBuffer();
    }
  });

  window.addEventListener(
    "pagehide",
    () => {
      void flushBuffer();
    },
    { capture: true },
  );
}
