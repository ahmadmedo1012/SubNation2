/**
 * Core Web Vitals client for the SubNation frontend.
 *
 * - Captures LCP / FCP / INP / CLS / TTFB once per page visit.
 * - Sends each sample as a beacon to POST /api/cwv via navigator.sendBeacon
 *   (with a `fetch keepalive` fallback) and never blocks the UI.
 * - Buffers samples up to 60 s and flushes on visibilitychange / beforeunload.
 * - All exceptions are caught at the module boundary so a CWV bug can never
 *   break the app.
 *
 * v4 API note: web-vitals v4 exports `onCLS / onFCP / onINP / onLCP / onTTFB`.
 * Earlier `getCLS / …` names are removed in v4 — using them throws at module
 * resolve time. This file uses the v4 API exclusively.
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";

// ── Configuration ────────────────────────────────────────────────────────────

const BEACON_ENDPOINT = "/api/cwv";
const MAX_BUFFER_AGE_MS = 60_000;
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 5_000;

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
  if (window.location.hash) {
    return window.location.hash.slice(1) || "/";
  }
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
function toBeaconBody(sample: CWVSample): Blob {
  return new Blob([JSON.stringify(sample)], { type: "application/json" });
}

function sendBeaconSync(sample: CWVSample): boolean {
  try {
    const body = toBeaconBody(sample);
    return navigator.sendBeacon?.(BEACON_ENDPOINT, body) ?? false;
  } catch {
    return false;
  }
}

async function sendBeaconAsync(sample: CWVSample): Promise<boolean> {
  try {
    const response = await fetch(BEACON_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendWithRetry(sample: CWVSample): Promise<boolean> {
  if (sendBeaconSync(sample)) return true;
  if (await sendBeaconAsync(sample)) return true;
  for (let i = 0; i < RETRY_COUNT; i++) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    if (await sendBeaconAsync(sample)) return true;
  }
  return false;
}

// ── Sample buffering ─────────────────────────────────────────────────────────

interface BufferedSample {
  sample: CWVSample;
  timestamp: number;
}

const sampleBuffer: BufferedSample[] = [];

function addToBuffer(sample: CWVSample): void {
  const cutoff = Date.now() - MAX_BUFFER_AGE_MS;
  for (let i = sampleBuffer.length - 1; i >= 0; i--) {
    if (sampleBuffer[i]!.timestamp < cutoff) sampleBuffer.splice(i, 1);
  }
  sampleBuffer.push({ sample, timestamp: Date.now() });
}

async function flushBuffer(): Promise<void> {
  if (sampleBuffer.length === 0) return;
  const samplesToSend = sampleBuffer.splice(0, sampleBuffer.length);
  await Promise.all(
    samplesToSend.map(({ sample }) =>
      sendWithRetry(sample).catch(() => {
        // Swallowed at module boundary — never break the UI.
      }),
    ),
  );
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
    void flushBuffer();
  } catch {
    // Module boundary — never break the UI.
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface InitWebVitalsOptions {
  enabled?: boolean;
  endpoint?: string;
}

/**
 * Initialise CWV collection. Call once at app boot from main.tsx.
 *
 * Defaults to enabled. Pass `{ enabled: false }` to skip (e.g. in dev).
 */
export function initWebVitals(options: InitWebVitalsOptions = {}): void {
  const { enabled = true } = options;
  if (!enabled) return;
  // `endpoint` arg accepted for API parity with design.md §3.1.14;
  // routing remains the constant BEACON_ENDPOINT.

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
