// ── Sentry boot deferral ────────────────────────────────────────────
// The Sentry chunk (@sentry/react with Replay + BrowserTracing) is
// ~155 KB gzip — bigger than React itself. Eager-importing it here
// puts a `<link rel="modulepreload">` on the critical path that
// contends with the LCP image bytes and adds ~250 ms TBT on mid-tier
// mobile. lib/boot-sentry installs window error listeners + React
// error-handler buffers SYNCHRONOUSLY (cheap), then schedules the
// Sentry chunk via requestIdleCallback (with a 2 s timeout fallback).
// Boot-window errors are queued and flushed once Sentry loads — none
// are lost. See lib/boot-sentry.ts for full rationale.
import {
  installBootErrorBuffer,
  bufferedReactErrorHandler,
  scheduleSentryBoot,
} from "./lib/boot-sentry";

installBootErrorBuffer();
scheduleSentryBoot();

import { setBaseUrl } from "@workspace/api-client-react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import "./index.css";
import { initAnalytics } from "./lib/analytics";
import { applyDocumentDirection } from "./lib/direction";
import { initWebVitals } from "./lib/web-vitals";

// Lock document direction synchronously, before React renders. The static
// index.html already declares <html lang="ar" dir="rtl">; this re-affirms
// it so any race between the document parser and our boot path can't leave
// us with a stripped/mirrored direction.
applyDocumentDirection("ar");

// Configure API base URL from Vite env.
// Empty / unset => same-origin (relative /api paths). Set VITE_API_URL to an
// absolute origin (e.g. https://api.example.com) when deploying the frontend
// separately from the backend.
const apiBaseUrl = (import.meta.env.VITE_API_URL ?? "").trim();
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

// ── Phase 4: Core Web Vitals — defer past initial paint so the import and
// the very first sample collection cannot delay LCP. requestIdleCallback
// is preferred; setTimeout(…, 0) is a portable fallback.
function scheduleIdle(cb: () => void) {
  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void) => number;
  };
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(cb);
  } else {
    setTimeout(cb, 0);
  }
}

scheduleIdle(() => {
  try {
    initWebVitals({ enabled: true });
  } catch {
    // CWV must never break the app — module boundary catches errors itself.
  }
  // GA4 is initialized on the same idle tick as Web Vitals so the
  // gtag.js fetch never contends with the LCP image. No-op when
  // VITE_GA_TRACKING_ID is unset.
  try {
    initAnalytics();
  } catch {
    // Analytics must never break the app.
  }
});

createRoot(document.getElementById("root")!, {
  // React 19 error capture pattern from the official Sentry React skill.
  // Each callback forwards its error to Sentry while preserving the React
  // default behaviour for the corresponding category.
  //
  // The handler we install here is a BUFFERING WRAPPER from
  // lib/boot-sentry. It queues errors during the brief Sentry-defer
  // window and drains them once @sentry/react finishes loading on idle.
  // Effect: nothing is lost, but Sentry stays off the critical path.
  onUncaughtError: bufferedReactErrorHandler(),
  onCaughtError: bufferedReactErrorHandler(),
  onRecoverableError: bufferedReactErrorHandler(),
}).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
