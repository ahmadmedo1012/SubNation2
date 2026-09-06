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

import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { CartProvider } from "./lib/cart";
import "./index.css";
import { initAnalytics } from "./lib/analytics";
import { getUserAuthToken } from "./lib/auth-token-holder";
import { applyDocumentDirection } from "./lib/direction";
import { initWebVitals } from "./lib/web-vitals";
import { getApiBaseUrl, installApiFetchBridge } from "./lib/api-config";

// Lock document direction synchronously, before React renders. The static
// index.html already declares <html lang="ar" dir="rtl">; this re-affirms
// it so any race between the document parser and our boot path can't leave
// us with a stripped/mirrored direction.
applyDocumentDirection("ar");

// Configure API base URL from Vite env.
// Empty / unset => same-origin (relative /api paths). Set VITE_API_URL to an
// absolute origin (e.g. https://api.example.com) when deploying the frontend
// separately from the backend.
const apiBaseUrl = getApiBaseUrl();
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}
// Round-3 (8-f §1): ONE global bearer-token getter for every orval/customFetch
// request. Backed by the auth-token holder that AuthProvider keeps in sync
// with the session JWT. Returns null when running on cookie auth (the
// httpOnly cookie speaks for itself) — call sites that hand-pass a REAL
// Authorization header still win (customFetch only fills empty/absent).
setAuthTokenGetter(() => getUserAuthToken());
installApiFetchBridge();

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
  // Round-3 (8-a §2 / 8-c 1.2): HelmetProvider removed — SEO moved to
  // direct head management (a006e2c) and zero <Helmet> components remain
  // repo-wide; the wrapper was dead weight in the entry chunk.
  <CartProvider>
    <App />
  </CartProvider>,
);
