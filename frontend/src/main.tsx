// IMPORTANT: This must be the very first import. Sentry.init() in
// instrument.ts has to run before any other code so unhandled errors during
// boot are captured.
import "./instrument";

import { setBaseUrl } from "@workspace/api-client-react";
import { reactErrorHandler } from "@sentry/react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import "./index.css";
import { initWebVitals } from "./lib/web-vitals";

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
});

createRoot(document.getElementById("root")!, {
  // React 19 error capture pattern from the official Sentry React skill.
  // Each callback forwards its error to Sentry while preserving the React
  // default behaviour for the corresponding category.
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
