/**
 * Sentry sidecar — MUST be the very first import of the app entry point.
 *
 * Per the official Sentry React skill (https://github.com/getsentry/sentry-for-ai),
 * `Sentry.init()` has to run before any other code so unhandled errors during
 * boot are captured. We put the init in a dedicated module and `import "./instrument"`
 * at the top of main.tsx (boot-sentry defers THIS module to idle — see
 * src/lib/boot-sentry.ts).
 *
 * DSN resolution order:
 *   1. Build-time env: import.meta.env.VITE_SENTRY_DSN
 *   2. Unset → the SDK is never loaded at all (97-F6 guard in boot-sentry.ts
 *      + the sentryDsnGuardPlugin stub in vite.config.ts).
 *
 * ── A2 F1 (R124): Session Replay is byte-gated + lazy-attached ──────
 *
 * The replay recorder (rrweb: DOM snapshotting, canvas capture, the
 * compression worker — ~⅔ of the old 469 KB vendor-sentry chunk) used to
 * ride the SDK chunk that EVERY visitor idle-loads. It now lives in its
 * own async chunk (src/lib/sentry-replay.ts is the only module that
 * imports the replay integration, so Rollup can tree-shake it out of
 * vendor-sentry) and is fetched ONLY when a session will actually record:
 *
 *   - "session winners" (sticky 10% roll, mirroring the SDK's own
 *     stickySession sampling semantics): attach on SDK boot — this
 *     module already loads on idle, so the winner's replay starts
 *     delayed-on-idle (fetch of the replay chunk + attach).
 *   - everyone else: attach on the FIRST error-level event (beforeSend
 *     hook) in buffer mode — recording starts at that point and the
 *     next error uploads the error replay. Trade-off (documented in
 *     docs/inspection-r124/A2-performance.md F1): pre-error frames are
 *     lost for sessions that were not session-sampled, the same
 *     property Sentry's own lazy-load pattern has.
 *
 * Sampling config: both `replays*SampleRate` options are intentionally
 * 0 — with both rates 0 the integration starts in MANUAL mode
 * (requiresManualStart), and the rolls above + `replay.start()` /
 * `replay.startBuffering()` decide recording. This is Sentry's
 * documented custom-sampling pattern and preserves the observable
 * semantics of the old config (10% session replays, error replays for
 * error sessions) while moving the bytes off the every-visitor path.
 *
 * CSP note: the existing CSP allows the Replay worker
 * (`worker-src 'self' blob:` in backend/src/app.ts) and the Sentry
 * ingest origin is on connect-src. The replay chunk is same-origin
 * (no CDN lazyLoadIntegration — that variant would add a
 * browser.sentry-cdn.com script-src dependency the CSP does not allow).
 */

import {
  browserTracingIntegration,
  captureException,
  captureMessage,
  flush,
  init,
  withScope,
} from "@sentry/react";

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();

const isProduction = import.meta.env.MODE === "production";

if (!dsn) {
  if (isProduction) {
    // Public DSN was previously hard-coded as a fallback. We removed it so
    // each Sentry project's DSN is exclusively env-controlled. Production
    // builds without the env are misconfigured — log loudly so it's caught
    // before traffic exposes the gap.
    console.error(
      "[sentry] VITE_SENTRY_DSN is not set in production. Frontend errors will not be reported.",
    );
  } else {
    console.info("[sentry] VITE_SENTRY_DSN not set — Sentry disabled in dev.");
  }
}

const release =
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() ||
  (import.meta.env.VITE_RELEASE_SHA as string | undefined)?.slice(0, 7) ||
  (isProduction ? "production" : "development");

// Trace propagation targets. Outgoing fetch/XHR to these origins receives
// `sentry-trace` + `baggage` headers so backend Sentry can stitch the trace.
const tracePropagationTargets: (string | RegExp)[] = [
  "localhost",
  /^https?:\/\/127\.0\.0\.1/,
  /^https?:\/\/(?:[a-z0-9-]+\.)?subnation\.ly/i,
];

const appOrigin = (import.meta.env.VITE_APP_ORIGIN as string | undefined)?.trim();
if (appOrigin) {
  try {
    const url = new URL(appOrigin);
    tracePropagationTargets.push(new RegExp(`^${url.protocol}//${url.host.replace(/\./g, "\\.")}`));
  } catch {
    // Ignore malformed VITE_APP_ORIGIN at build time.
  }
}

// ── A2 F1 (R124): replay byte-gating state + rolls ──────────────────────────

const REPLAY_ROLL_STORAGE_KEY = "sn:sentry-replay-roll";

/**
 * Sticky per-tab-session roll deciding whether this session is a replay
 * "winner" (records its whole session). sessionStorage scope mirrors the
 * SDK's own stickySession semantics: one verdict per tab session, not per
 * page load — a reload never re-rolls, so coverage stays at ~10% of
 * sessions instead of drifting toward 10% of page views.
 */
function rollReplaySessionWinner(sampleRate: number): boolean {
  if (sampleRate <= 0) return false;
  try {
    const stored = sessionStorage.getItem(REPLAY_ROLL_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
    const won = Math.random() < sampleRate;
    sessionStorage.setItem(REPLAY_ROLL_STORAGE_KEY, won ? "1" : "0");
    return won;
  } catch {
    // Storage blocked (private mode / quota) — fall back to a per-boot roll.
    return Math.random() < sampleRate;
  }
}

let replayAttached = false;

function attachReplay(mode: "session" | "error"): void {
  replayAttached = true;
  // The ONLY importer of the replay integration lives in this dynamic
  // chunk — vendor-sentry never references the binding, so the rrweb
  // bytes stay out of the every-visitor SDK load. Failure is best-effort:
  // a stale-chunk 404 right after a deploy just means no replay for this
  // session; error capture (the pipeline's core job) is unaffected.
  void import("./lib/sentry-replay")
    .then((m) => m.attachSentryReplay(mode))
    .catch(() => {
      /* best-effort — see above */
    });
}

init({
  dsn,
  environment: import.meta.env.MODE,
  release,

  // Per the user's directive (and the skill default): include IPs / request
  // headers on events so on-call has enough context.
  sendDefaultPii: true,

  integrations: [
    // Browser tracing — names transactions by URL path. Wouter is not on the
    // first-class router list (React Router v5/v6/v7 + TanStack are), but
    // `browserTracingIntegration()` works for any router by URL.
    // (Session Replay is NOT here — see the A2 F1 block at the top of
    // this file: it attaches lazily via ./lib/sentry-replay.)
    browserTracingIntegration(),
  ],

  // Tracing
  tracesSampleRate: isProduction ? 0.1 : 1.0,
  tracePropagationTargets,

  // Session Replay — BOTH rates are deliberately 0: the integration
  // attaches in manual mode (see the A2 F1 block above) and recording is
  // started by attachReplay() with our own sticky roll. Observable
  // sampling semantics match the previous config
  // (replaysSessionSampleRate 0.1 prod / 0 dev, replaysOnErrorSampleRate
  // 1.0): 10% of sessions record fully, error sessions get an
  // error-triggered buffer replay.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // A2 F1: error-triggered lazy attach. The first error-level event of a
  // non-winner session pulls the replay chunk (buffer mode) so the NEXT
  // error — and any later one — carries a replay. The event that armed
  // the attach itself ships without replay context; that is the inherent
  // cost of keeping rrweb bytes off the every-visitor path (A2 F1).
  beforeSend(event) {
    if (!replayAttached && (event.level === "error" || event.level === "fatal")) {
      attachReplay("error");
    }
    return event;
  },

  // Structured logs — `Sentry.logger.info(...)` / `.warn(...)` etc. ship to
  // Sentry's log search and link back to the active span automatically.
  enableLogs: true,

  // Don't blow up the SDK on browser-extension noise.
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    "NetworkError",
    "Network request failed",
    // React StrictMode double-render warning (dev only)
    "Cannot update a component while rendering a different component",
  ],
  denyUrls: [/extensions\//i, /^chrome:\/\//i, /^chrome-extension:\/\//i, /moz-extension:\/\//i],
});

// A2 F1: session winners attach the replay integration as soon as the SDK
// is up (this module is itself the idle-deferred SDK boot, so the winner's
// replay starts delayed-on-idle, exactly the documented lazy-load shape).
const replaySessionWinner = rollReplaySessionWinner(isProduction ? 0.1 : 0);
if (replaySessionWinner) {
  attachReplay("session");
}

// ─────────────────────────────────────────────────────────────────────────────
// Production debug surface.
//
// Modern @sentry/react (v7+) does NOT attach the SDK to `window` by default,
// which is correct for tree-shaking but makes production verification hard:
// operators have no way to confirm init succeeded or to fire a test event
// from DevTools without redeploying.
//
// We attach two controlled handles. DSNs are public-by-design (they're
// embedded in the bundle anyway — see
// https://docs.sentry.io/platforms/javascript/configuration/options/#dsn).
//
//   window.Sentry            — the common debugging callables (NOT the full
//                              SDK namespace: assigning a namespace object
//                              to window defeats tree-shaking and would pin
//                              every export — including the lazy Session
//                              Replay integration — back into the
//                              every-visitor vendor-sentry chunk; A2 F1)
//   window.__sentryTest()    — sends a labelled test event so operators can
//                              verify the Sentry → Discord pipeline end-to-end
//                              from any production browser tab
//   window.__sentryStatus()  — returns whether init ran with a real DSN
//
// To verify in production:
//   1. Open DevTools console on the live site.
//   2. `window.__sentryStatus()` → expect `{ initialized: true, dsn: "https://…@…" }`
//   3. `window.__sentryTest()`   → expect a Sentry event in the dashboard
//                                  AND a Discord notification in the alerts
//                                  channel within ~30s.
// ─────────────────────────────────────────────────────────────────────────────

type SentryDebugSurface = {
  captureException: typeof captureException;
  captureMessage: typeof captureMessage;
  withScope: typeof withScope;
  flush: typeof flush;
};

declare global {
  interface Window {
    Sentry?: SentryDebugSurface;
    __sentryTest?: (label?: string) => string;
    __sentryStatus?: () => {
      initialized: boolean;
      environment: string;
      release: string;
      dsn: string | null;
    };
  }
}

if (typeof window !== "undefined") {
  window.Sentry = { captureException, captureMessage, withScope, flush };

  window.__sentryTest = (label?: string) => {
    const tag = label ?? "manual-debug";
    const eventId = captureMessage(
      `[sentry-test] ${tag} — fired from window.__sentryTest()`,
      "warning",
    );
    return eventId ?? "no-event-id";
  };

  window.__sentryStatus = () => ({
    initialized: !!dsn,
    environment: import.meta.env.MODE,
    release,
    // Show only the public host segment; never the project key. Lets
    // operators verify the right project is targeted without leaking
    // the full DSN to anyone glancing at the screen.
    dsn: dsn ? dsn.replace(/^https:\/\/[^@]+@/, "https://[redacted]@") : null,
  });
}
