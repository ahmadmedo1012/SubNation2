/**
 * Sentry sidecar — MUST be the very first import of the app entry point.
 *
 * Per the official Sentry React skill (https://github.com/getsentry/sentry-for-ai),
 * `Sentry.init()` has to run before any other code so unhandled errors during
 * boot are captured. We put the init in a dedicated module and `import "./instrument"`
 * at the top of main.tsx.
 *
 * DSN resolution order:
 *   1. Build-time env: import.meta.env.VITE_SENTRY_DSN
 *   2. Hard-coded fallback for the SubNation Sentry project (DSNs are public-by-design,
 *      not secrets — see https://docs.sentry.io/platforms/javascript/configuration/options/#dsn).
 *
 * Replay note: the existing CSP allows the Replay worker (`worker-src 'self' blob:`
 * is added in backend/src/app.ts), and the Sentry ingest origin is on connect-src.
 * Trusted Types remain unset (Firebase compatibility), so Replay's policy is not
 * blocked. If a CSP audit later flags new violations, set
 * `replaysSessionSampleRate: 0` and `replaysOnErrorSampleRate: 0` to disable.
 */

import * as Sentry from "@sentry/react";

const FALLBACK_DSN =
  "https://e2c1152a3dff5af381277e1c57a7ea3e@o4511397349097472.ingest.de.sentry.io/4511397448581200";

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() || FALLBACK_DSN;

const isProduction = import.meta.env.MODE === "production";

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

Sentry.init({
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
    Sentry.browserTracingIntegration(),

    // Session Replay — masks PII by default. Records full sessions only at
    // the configured rate; ALL error sessions are captured.
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Tracing
  tracesSampleRate: isProduction ? 0.1 : 1.0,
  tracePropagationTargets,

  // Session Replay
  replaysSessionSampleRate: isProduction ? 0.1 : 0.0,
  replaysOnErrorSampleRate: 1.0,

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
