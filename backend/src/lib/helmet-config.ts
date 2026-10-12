import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";

/**
 * R136 (app.ts decomposition): the Permissions-Policy + helmet CSP/HSTS/COOP
 * security-headers block moved here VERBATIM from app.ts (:136-290), now a
 * pair of factories app.ts wires. The two R136 CSP tightenings (SEC scan
 * F2/F3) live in the directives below, each with its grep evidence.
 */

// ── Security Headers ──────────────────────────────────────────────────────────
//
// Firebase Google Sign-In popup compatibility notes:
//
// 1. COOP must be "same-origin-allow-popups" — allows the popup window to
//    postMessage back to the opener and call window.close() without browser
//    security warnings. "same-origin" would block popup communication entirely.
//
// 2. COEP must be disabled (false) — enabling it would require all sub-resources
//    to opt-in via CORP/COEP headers, which Firebase's CDN resources do not do.
//
// 3. trusted-types CSP directive MUST NOT be used without "require-trusted-types-for"
//    being absent, OR the policy list must include all policies Firebase SDK
//    creates internally. The safest approach is to omit trusted-types entirely
//    since Firebase Auth SDK (v9+) creates its own internal Trusted Types policies
//    ('firebase-auth', 'goog#html', 'gapi#gapi') and the browser will block them
//    if the CSP trusted-types allowlist doesn't exactly match. Omitting the
//    directive entirely lets the browser use its default (permissive) behavior.
//
// 4. frameSrc must include *.firebaseapp.com for the hidden auth iframe that
//    Firebase uses for cross-origin session persistence.
//
// 5. connectSrc must include all Firebase/Google API endpoints.
//
// V3-C1a: helmet v8 dropped its permissionsPolicy middleware — set the
// header directly. Default-deny powerful features the SPA never uses;
// payment=(self) keeps a future Payment Request door open.
export const permissionsPolicyMiddleware = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), usb=(), payment=(self), midi=(), accelerometer=()",
  );
  next();
};

export function createHelmetMiddleware(isProduction: boolean, allowedOrigins: string[]) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          ...(isProduction ? [] : ["'unsafe-inline'", "'unsafe-eval'"]),
          // Google/Firebase auth scripts
          "https://apis.google.com",
          "https://accounts.google.com",
          "https://www.gstatic.com",
          "https://www.googleapis.com",
          "https://*.firebaseapp.com",
          // Firebase Phone Auth uses reCAPTCHA loaded from these origins
          "https://www.google.com",
          "https://www.recaptcha.net",
          // Google Analytics 4 (gtag.js). Loaded by frontend/src/lib/analytics.ts
          // when VITE_GA_TRACKING_ID is set. The host is NOT a subdomain of
          // googleapis.com or gstatic.com, so it must be listed explicitly —
          // omitting it causes the loader to be blocked by CSP in production.
          "https://www.googletagmanager.com",
        ],
        // Do NOT set scriptSrcAttr to 'none' — Firebase SDK injects inline
        // event handlers in the popup/iframe auth flow.
        scriptSrcAttr: ["'unsafe-inline'"],
        // R104 (AG11-6): fonts.googleapis/gstatic removed from
        // styleSrc/fontSrc — fonts have been self-hosted via @fontsource
        // (bundled /assets/*.woff2) for many rounds; the two directives
        // allowed a third-party origin nothing uses anymore.
        styleSrc: ["'self'", "'unsafe-inline'"],
        // R136 (SEC F2, app.ts:202): blanket "https:" REMOVED from imgSrc.
        // Evidence (frontend grep, this round):
        //   - No hardcoded external https image URL is rendered as
        //     <img src> anywhere in frontend/src. Telegram's photo_url
        //     appears ONLY in payload comments/interfaces
        //     (TelegramLoginButton.tsx:34, telegram-callback.tsx:45) and
        //     is never rendered; there is no avatar/photoURL/CDN <img>.
        //   - Every <img src> in frontend/src renders DB-driven product
        //     art (site-relative /products/*.webp — R132 L4-F9 verified
        //     all 45 live assets are site-relative) or data: QR payloads
        //     (two-factor-setup.tsx:152, admin/whatsapp.tsx:657), both
        //     covered by 'self' / data:.
        //   - The operator-facing edge (an absolute image_url pasted into
        //     the admin product form, placeholder "https://...") degrades
        //     gracefully: every product-art <img> carries an onError
        //     fallback to the initial-letter/gradient tile
        //     (ProductCard.tsx, ProductMediaSection.tsx,
        //     admin/products.tsx), and the og:image <meta> passthrough
        //     (share surfaces) is not CSP-governed. When a real CDN host
        //     is adopted, add it HERE explicitly — the intended CSP
        //     posture, instead of pre-authorizing the entire https
        //     image namespace for tracking pixels / img-src exfil.
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: [
          "'self'",
          // Firebase Realtime Database & Auth
          "https://*.firebaseio.com",
          "wss://*.firebaseio.com",
          "https://*.firebaseapp.com",
          // Google APIs (token exchange, user info, etc.)
          "https://*.googleapis.com",
          "https://accounts.google.com",
          // Firebase Auth REST API
          "https://identitytoolkit.googleapis.com",
          "https://securetoken.googleapis.com",
          // Sentry ingest (DSNs are public by design — see Sentry docs).
          // Wildcards cover .sentry.io, .ingest.sentry.io, .ingest.de.sentry.io,
          // and Replay's separate sub-domains.
          "https://*.sentry.io",
          "https://*.ingest.sentry.io",
          "https://*.ingest.de.sentry.io",
          "https://*.ingest.us.sentry.io",
          // Google Analytics 4 collect endpoint (region-rotated subdomains
          // such as region1.google-analytics.com). The wildcard covers
          // www.google-analytics.com, region1.google-analytics.com, and the
          // beacon fallback at analytics.google.com — without these, beacons
          // fail with net::ERR_BLOCKED_BY_CSP and traffic never reaches GA.
          "https://*.google-analytics.com",
          "https://*.analytics.google.com",
          "https://*.googletagmanager.com",
          ...(allowedOrigins.length || isProduction
            ? allowedOrigins
            : ["http://localhost:*", "http://127.0.0.1:*"]),
        ],
        // Sentry Session Replay records DOM mutations off the main thread
        // using a Web Worker created from a blob: URL. Without this directive,
        // Replay silently fails to record.
        workerSrc: ["'self'", "blob:"],
        // frameSrc: Firebase uses a hidden iframe at *.firebaseapp.com/__/auth/iframe
        // for cross-origin session persistence. accounts.google.com is the OAuth popup.
        // Phone Auth's reCAPTCHA challenge renders in an iframe under
        // www.google.com/recaptcha (with www.recaptcha.net as the fallback origin
        // for clients in regions where google.com is blocked).
        frameSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://*.firebaseapp.com",
          "https://*.firebase.com",
          "https://www.google.com",
          "https://www.recaptcha.net",
        ],
        objectSrc: ["'none'"],
        // R136 (SEC F3, app.ts:253): the `upgradeInsecureRequests: null`
        // override REMOVED — helmet 8.1's default directive set includes
        // "upgrade-insecure-requests" (verified against the installed
        // package), so removing the null lets the default apply again.
        // Evidence (frontend grep, this round): no http:// subresource
        // exists in frontend/src, index.html or public/ — the only
        // http:// matches are SVG xmlns identifiers (never fetched) and
        // vite.config's dev-only proxy target (not a browser
        // subresource); every "//" occurrence is a validation guard that
        // REJECTS protocol-relative paths. The dev connectSrc
        // http://localhost:* entries are CSP allow-list values, and
        // browsers exempt localhost (potentially trustworthy origin)
        // from upgrading, so local dev is unaffected.
        // IMPORTANT: Do NOT include a "trusted-types" directive here.
        // Firebase Auth SDK v9+ creates internal Trusted Types policies at runtime
        // ('firebase-auth', 'goog#html', 'gapi#gapi', etc.). If we enumerate an
        // allowlist, any policy name mismatch causes a TypeError that silently
        // breaks the popup flow — the popup completes but getIdToken() returns a
        // garbage/empty value (observed: id_token_length of 4, 14, 18 chars).
        // Omitting the directive entirely is the correct, Firebase-compatible approach.
      },
    },
    hsts: {
      // 2 years (HSTS preload list requires ≥1 year; 2 years is the
      // standard preload-list submission). includeSubDomains + preload
      // make the apex eligible for hstspreload.org submission so
      // browsers stop following the http→https redirect cold (saves
      // ~190 ms desktop / ~630 ms mobile per first-visit per
      // PageSpeed). The redirect itself is kept in the upstream
      // Cloudflare/Render edge.
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
    // COEP must be disabled for Firebase popup auth compatibility.
    // Firebase's CDN resources (gstatic.com, googleapis.com) do not send
    // Cross-Origin-Resource-Policy headers, so enabling COEP would block them.
    crossOriginEmbedderPolicy: false,
    // COOP: "same-origin-allow-popups" is the correct value for Firebase popup auth.
    // - "same-origin" would block window.close() and postMessage from the popup
    //   back to the opener, breaking the entire auth flow.
    // - "unsafe-none" would remove cross-origin isolation entirely (too permissive).
    // - "same-origin-allow-popups" allows popups opened by this page to communicate
    //   back while still protecting against cross-origin opener attacks.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    xContentTypeOptions: true,
    xFrameOptions: { action: "sameorigin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
}
