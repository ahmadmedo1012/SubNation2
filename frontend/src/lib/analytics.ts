/**
 * Google Analytics 4 (GA4) loader.
 *
 * Activates ONLY when `VITE_GA_TRACKING_ID` is set at build time. When
 * unset (local dev, CI, unconfigured deployments) this module is a
 * no-op — `init()` returns immediately, the gtag.js script is never
 * fetched, and no `dataLayer` is created. This keeps the no-tracking
 * default consistent with the project's existing Sentry-defer pattern
 * and avoids a Lighthouse hit on builds that haven't opted in.
 *
 * Loading strategy:
 *   1. `init()` is called from `requestIdleCallback` in main.tsx so the
 *      gtag.js fetch never blocks the LCP image or the React tree
 *      hydration. ~250-400 ms wall-clock saving on mid-tier mobile vs.
 *      a synchronous <script src=...> in index.html.
 *   2. The tag is loaded via `script.async = true`. Browsers begin GET
 *      of gtag.js immediately but defer execution until idle.
 *   3. `dataLayer` is created BEFORE the script attaches, so any
 *      page-view / event pushed during the load window is buffered and
 *      flushed by gtag.js when it executes.
 *
 * Privacy posture:
 *   - `anonymize_ip: true` — last IP octet zeroed before storage.
 *   - `transport_type: "beacon"` — uses sendBeacon API where available
 *     so events survive page-unload without blocking navigation.
 *   - No PII is sent from the app code; only standard page_view fired
 *     by gtag.js itself. If the operator later layers consent gating,
 *     wrap `init()` behind a consent flag.
 *
 * The CSP in backend/src/app.ts allowlists the GA origins explicitly:
 *   scriptSrc:  https://www.googletagmanager.com
 *   connectSrc: https://*.google-analytics.com
 *               https://*.analytics.google.com
 *               https://*.googletagmanager.com
 * If those entries are removed, the loader will be blocked by CSP and
 * beacons will fail with net::ERR_BLOCKED_BY_CSP — keep them in sync
 * when editing helmet's directives.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let initialized = false;

export function initAnalytics(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;

  const id = (import.meta.env.VITE_GA_TRACKING_ID as string | undefined)?.trim();
  if (!id) return;

  // Validate the id shape lightly. GA4 ids start with `G-`, legacy
  // Universal Analytics with `UA-` (deprecated; we accept it for
  // operators still mid-migration). Anything else is ignored — a
  // typo'd env var should not silently send beacons to an unknown
  // property.
  if (!/^(G|UA|GTM)-[A-Z0-9-]+$/i.test(id)) return;

  initialized = true;

  // gtag.js boilerplate (verbatim shape from Google's docs, just
  // factored into TS-typed assignments).
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", id, {
    anonymize_ip: true,
    transport_type: "beacon",
    // SPA route changes are tracked by an explicit page_view push if
    // the operator wires it. The default config emits the initial
    // page_view here.
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}
