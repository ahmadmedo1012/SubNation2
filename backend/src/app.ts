import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import helmet from "helmet";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import pinoHttp from "pino-http";
import * as Sentry from "@sentry/node";
import { ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import { getCorrelationId } from "./lib/correlation";
import { bodyParserRecovery } from "./lib/body-parser-recovery";
import { logger } from "./lib/logger";
import { verifyUserToken } from "./lib/jwt";
import { createResilientRateLimitStore } from "./lib/rate-limit-store";
import { applyFlashSale } from "./lib/pricing";
// R122 (A3-P1): the /product/:slug shell + share-card lookups ride the
// catalog cache (60 s TTL, generation-bumped by admin CRUD) — they are
// unauthenticated, outside every rate limiter, and were the one route
// family hitting Postgres per request.
import { withCatalogCache } from "./lib/catalog-cache";
import { cloudflareClientIp } from "./middlewares/cloudflareClientIp";
import { correlationMiddleware } from "./middlewares/correlation";
import { instrumentationIsolation } from "./middlewares/instrumentation-isolation";
import { metricsMiddleware } from "./middlewares/metrics";
import router from "./routes";
import seoRouter from "./routes/seo";
import { ErrorCode, createErrorResponse } from "./lib/errors";
import { getConfiguredOrigins, warnLegacySplitOriginEnvAtBoot } from "./lib/origins";

// A7-2 (R116): boot-time hygiene warn on split-era origin env vars
// (VERCEL_FRONTEND_ORIGIN / FRONTEND_ORIGINS). f10bb9b accidentally
// deleted this call together with the www-redirect removal — restored
// in R117 (A1-P3/A3-P5): the folding still happens in
// getConfiguredOrigins(), so the boot signal must survive with it.
warnLegacySplitOriginEnvAtBoot();

const app = express();

function resolveFrontendDist(): string | null {
  const candidates = [
    process.env.FRONTEND_DIST,
    path.resolve(process.cwd(), "../frontend/dist/public"),
    path.resolve(process.cwd(), "frontend/dist/public"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) ?? null;
}

// ── CORS / Allowed Origins ────────────────────────────────────────────────────
// In production restrict to APP_ORIGINS; in dev allow all origins.
const allowedOrigins = getConfiguredOrigins();
const isProduction = process.env.NODE_ENV === "production";

/**
 * F-009 (security audit 004) — CSRF Origin/Referer check is enabled in
 * EVERY environment, not just production. Previously the middleware was
 * gated behind `NODE_ENV === "production"`, which left dev servers
 * accepting cross-origin state-changing requests; a developer running
 * realistic credentials locally and visiting a hostile origin in the
 * same browser was vulnerable.
 *
 * Resolution order for the allow-list:
 *   1. `CSRF_ALLOWED_ORIGINS` (explicit override; comma-separated).
 *   2. `APP_ORIGINS` (the existing CORS allow-list — same trust set).
 *   3. `APP_URL` (single-origin shorthand).
 *   4. Non-production fallback: localhost dev origins so `pnpm dev`
 *      keeps working without operator config. In production the
 *      fallback is empty — see the misconfiguration warning below.
 */
const csrfAllowedOrigins = (() => {
  const fromExplicit = process.env.CSRF_ALLOWED_ORIGINS;
  const fromCors = getConfiguredOrigins().join(",");
  const fromAppUrl = process.env.APP_URL;
  const raw = fromExplicit || fromCors || fromAppUrl || "";
  const parsed = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (parsed.length > 0) return parsed;
  // Dev fallback only. The boot assertion below refuses to start in
  // production when this branch would have been reached.
  if (!isProduction) {
    return [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];
  }
  return [];
})();

// ── SEC-92-01 boot assertion (round-92 B1 security audit) ────────────────────
//
// Historical context: during the Vercel→Render split, production cookies
// shipped SameSite=None (render.yaml set AUTH_COOKIE_SAMESITE=none so the
// Vercel-hosted SPA could call the API cross-site) — the browser attached
// auth_token/admin_token to ANY cross-site request, so the Origin/Referer
// gate built by createCsrfGate() below was the ONLY CSRF barrier, keyed
// off this allow-list. On today's single-origin deployment the cookie is
// SameSite=lax — the gate stays as the CSRF barrier (defense in depth):
// an empty allow-list in production would still be a silent full CSRF
// exposure on wallet/orders/admin surfaces.
//
// Env-var loss at this operator is a DEMONSTRATED failure mode (round-5:
// a Render API PUT wiped DATABASE_URL and took the deploy down), so we
// take the same fail-fast posture as SESSION_SECRET (lib/jwt.ts): boot
// aborts loudly instead of serving traffic without the gate.
// 110-F (R110 — 109-b P3): comment refreshed to the current env shape.
// Production sets APP_ORIGINS (comma-separated allow-list — the primary
// knob, see deploy/env.compose.example) plus APP_URL (single-origin
// shorthand); FRONTEND_ORIGINS / VERCEL_FRONTEND_ORIGIN remain optional
// extras folded in by lib/origins.ts (the pre-Coolify Vercel split stack
// is gone, as is the old scripts/restore_env_vars.json runbook this
// comment used to cite). This assertion only fires when they are lost.
// No secret values are logged.
if (isProduction && csrfAllowedOrigins.length === 0) {
  logger.fatal(
    { category: "security", audit_finding: "SEC-92-01" },
    "CSRF allow-list is EMPTY in production — set CSRF_ALLOWED_ORIGINS (or APP_ORIGINS / APP_URL). " +
      "SameSite=None cookies require the Origin gate; refusing to boot.",
  );
  throw new Error(
    "SEC-92-01: CSRF allow-list is empty in production. Set CSRF_ALLOWED_ORIGINS, APP_ORIGINS or " +
      "APP_URL so the Origin/Referer gate can validate state-changing requests. Refusing to boot " +
      "(fail-fast, same posture as SESSION_SECRET).",
  );
}

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
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), usb=(), payment=(self), midi=(), accelerometer=()",
  );
  next();
});

app.use(
  helmet({
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
        imgSrc: ["'self'", "data:", "https:"],
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
        upgradeInsecureRequests: null,
        // IMPORTANT: Do NOT include a "trusted-types" directive here.
        // Firebase Auth SDK v9+ creates internal Trusted Types policies at runtime
        // ('firebase-auth', 'goog#html', 'gapi#gapi', etc.). If we enumerate an
        // allowlist, any policy name mismatch causes a TypeError that silently
        // breaks the popup flow — the popup completes but getIdToken() returns
        // a garbage/empty value (observed: id_token_length of 4, 14, 18 chars).
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
  }),
);

// Trust the first reverse proxy hop when deployed behind one.
app.set("trust proxy", 1);

// ── ETag policy ─────────────────────────────────────────────────────────────
// Use strong ETags (SHA-1 of response body) instead of the default weak
// ETags. Strong ETags are usable for byte-range conditional requests
// AND save a few bytes of header per response. Both Cloudflare and any
// modern browser handle them transparently.
//
// Express auto-computes the ETag for every response in res.send(). When
// the client sends `If-None-Match: <etag>` and the body hasn't changed,
// Express returns 304 with an empty body, saving the response payload.
// Cache-Control + s-maxage at the route level (see routes/products.ts
// cacheable()) handles edge caching; ETag handles same-client
// revalidation between cache windows.
app.set("etag", "strong");

// ── Cloudflare-aware client-IP resolution ──────────────────────────────────
// When the request flows through Cloudflare (→ Coolify's Traefik → app),
// Express's `trust proxy = 1` resolves req.ip to the edge IP, not the
// real client. cloudflareClientIp() reads the CF-Connecting-IP header
// (which only Cloudflare can set) and overrides req.ip transparently.
//
// Mounted EARLY — before rate-limit-redis, CSRF, pino-http, and the
// route handlers — so every downstream consumer of req.ip sees the
// correct value automatically. No-op when CF isn't in front.
app.use(cloudflareClientIp);

// ── Canonical-host redirect ────────────────────────────────────────────────
// Render's edge already redirects www.subnation.ly → subnation.ly when both
// custom domains are bound to the service.
//
// However, Render auto-binds the service's onrender.com subdomain
// (subnation2.onrender.com) and there's no way to unbind it. Without this
// guard, the legacy host serves the same app as the canonical, creating
// duplicate-content drag for SEO and inconsistent cookies (the canonical
// origin's cookies don't apply to the onrender hostname).
//
// Skips /api/healthz/* so Render's own probes (which always hit the onrender
// hostname internally) never get a 301. Production-only.
// R116: removed www→non-www redirect middleware. Cloudflare/Traefik already
// issues non-www→www (307), so the old 301 created a bidirectional loop.
// The canonical host is now enforced solely by the external proxy layer.

// ── Compression ─────────────────────────────────────────────────────────────
app.use(compression());

// ── CORS ─────────────────────────────────────────────────────────────────────
// Round-97 F2 (A1 finding J-x — "CORS rejection returns 500"): a
// disallowed Origin used to hit the `cors` origin-callback ERROR path
// (`cb(new Error("CORS: origin not allowed"))`) → next(err) → the global
// error handler → 500 + error-level log + a Sentry capture on every
// scanner/probe request. The gate below rejects disallowed origins
// EARLY with a clean 403 (warn-level log only, never the error
// pipeline), mirroring createCsrfGate's exact-origin posture. The
// `cors` middleware after it then only ever sees approved traffic and
// can use its plain array form — no error branch left to reach next(err).
export function createCorsOriginGate(allowedOrigins: string[], production: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    // Same-origin SPA calls and server-to-server clients (Render health
    // probes, gateway callbacks) carry no Origin header — pass through,
    // exactly the old `cb(null, true)` semantics.
    if (typeof origin !== "string" || origin.length === 0) {
      next();
      return;
    }
    if (allowedOrigins.length === 0) {
      // V3-C2: an empty allow-list means REFLECT ANY ORIGIN with
      // credentials — fine in dev, a credential-leaking
      // misconfiguration in production. Fail closed with the same
      // clean 403 (the SEC-92-01 boot assertion already aborts on this
      // misconfiguration; this runtime gate is defense-in-depth).
      if (production) {
        logger.warn(
          { origin, path: req.path, category: "security" },
          "CORS allow-list empty in production — rejecting cross-origin request with 403",
        );
        res.status(403).json(createErrorResponse("الأصل غير مسموح به", ErrorCode.FORBIDDEN));
        return;
      }
      next(); // dev: allow all
      return;
    }
    if (allowedOrigins.includes(origin)) {
      next();
      return;
    }
    logger.warn({ origin, path: req.path }, "CORS: origin not allowed — 403");
    res.status(403).json(createErrorResponse("الأصل غير مسموح به", ErrorCode.FORBIDDEN));
  };
}
app.use(createCorsOriginGate(allowedOrigins, isProduction));

/**
 * R118-B1c (A4 F-5): emit Access-Control-Allow-Credentials ONLY when the
 * request carries an Origin header that the gate above allowed.
 *
 * The `cors` package sets ACAC on EVERY response once `credentials: true`
 * (its configureCredentials runs for preflight and actual requests alike,
 * with no origin-conditional mode) — including the no-Origin responses
 * that dominate real traffic (health probes, same-origin SPA calls,
 * curl). There the header is inert (no ACAO → the browser refuses
 * credentialed reads) but it is scanner-visible misconfig noise and
 * invites future misuse of the flag. So the option is dropped from the
 * `cors` config and the header is set HERE instead, mounted between the
 * origin gate and `cors`:
 *
 *   - no Origin → no ACAC (the F-5 fix; same-origin/server-to-server
 *     traffic never needed it);
 *   - a DISALLOWED Origin never reaches this middleware (the gate 403'd
 *     it above — its response carries no ACAC either);
 *   - an allowed Origin (or any origin in dev's empty-allowlist reflect
 *     mode) → ACAC: true, exactly the previous credentialed-CORS
 *     behaviour for the cross-origin SPA, on BOTH actual requests and
 *     the preflight OPTIONS the `cors` middleware below answers (this
 *     middleware runs first and the header persists on the response).
 */
export function createCorsCredentialsHeader() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.length > 0) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    next();
  };
}
app.use(createCorsCredentialsHeader());
app.use(
  cors({
    // Plain list form — disallowed origins never reach this middleware
    // (the gate above 403'd them), and an absent Origin header never
    // triggers CORS headers (server-to-server/same-origin pass-through).
    // Empty list in dev reflects any origin (previous behaviour).
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    // credentials: REMOVED (R118-B1c, A4 F-5) — see
    // createCorsCredentialsHeader above: ACAC is now emitted only for
    // origin-bearing (i.e. allowlist-passed) requests.
    // 98-F3 (R98-A4 §5): preflight responses carried no
    // Access-Control-Max-Age, so every cross-origin browser request from
    // the Vercel SPA (credentials:"include") paid a fresh OPTIONS
    // round-trip per browser cache window. 10 minutes is the
    // security-neutral cap recommended by MDN (Chrome caps at 2h,
    // Firefox 24h — 600s is the cross-browser floor that all honor);
    // the origin list is static, so caching the preflight cannot pin a
    // stale permission.
    maxAge: 600,
  }),
);

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Use Redis store if available, otherwise fall back to in-memory store.
//
// Key generator: NONE specified — we use express-rate-limit v8's default
// `ipKeyGenerator()` which:
//   1. Is IPv6-safe (uses /64 subnet to prevent address-cycling abuse).
//   2. Reads `req.ip` — which our `cloudflareClientIp` middleware
//      transparently overrides with the real client IP from the
//      CF-Connecting-IP header when behind Cloudflare.
//
// Specifying a custom keyGenerator that handled IPv6 manually triggered
// ERR_ERL_KEY_GEN_IPV6 in production (the library validates that custom
// keyGenerators handle IPv6 correctly). The default is the right tool.
// R2 (round-93 A3): the store used to be built ONCE from the client captured
// at module-eval time — BEFORE server.ts ever called initRedisClient() — so
// the Redis store could never actually engage; and had it engaged, a runtime
// Redis outage would queue every limiter command forever (offline queue)
// hanging EVERY /api request while /healthz stayed green.
//
// Each limiter now gets its own resilient store instance (express-rate-limit
// v8 rejects SHARED instances — ERR_ERL_STORE_REUSE). The store resolves the
// CURRENT ready client per op (lazy engagement + auto-disengage), bounds each
// command with REDIS_COMMAND_TIMEOUT_MS and falls back to in-memory rate
// limiting on timeout/error. With REDIS_URL unset it returns undefined and
// express-rate-limit's default MemoryStore applies — the exact previous
// no-Redis behaviour.
const makeRateLimitStore = (): Store | undefined =>
  process.env.REDIS_URL ? createResilientRateLimitStore() : undefined;

/**
 * Best-effort userId extractor for the rate-limiter.
 *
 * Decodes the auth_token cookie (or Authorization header) and
 * verifies the JWT signature. Returns null when there is no token,
 * the token is the cookie-session sentinel from the SPA's auth
 * hydration probe, the signature is invalid, or the token is
 * expired. Never throws.
 *
 * Verification is HMAC-SHA256 over a ~150-byte payload — sub-
 * millisecond on every modern host. requireUser will repeat the
 * verification later, but doing it here is the cleanest way to
 * route authenticated traffic to the per-user limiter without
 * threading state through middleware.
 */
// Round-3 (8-c §6.1): apiLimiter.skip, userLimiter.skip, userLimiter
// .keyGenerator AND requireUser all call this — up to 4 redundant
// HMAC-SHA256 verifications of the SAME token on every authed request.
// Memoize the result on the request object (per-request lifetime, no
// cross-request cache; null is also cached — "no identity" is stable
// within a request because token extraction is deterministic).
const REQUEST_USER_ID = Symbol("requestUserId");

function getRequestUserId(req: Request): number | null {
  const cached = (req as unknown as Record<symbol, number | null | undefined>)[REQUEST_USER_ID];
  if (cached !== undefined) return cached;

  const token =
    req.cookies?.auth_token ??
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined);
  let userId: number | null = null;
  if (token && token !== "__cookie_session__") {
    const payload = verifyUserToken(token);
    userId = payload?.userId ?? null;
  }
  (req as unknown as Record<symbol, number | null>)[REQUEST_USER_ID] = userId;
  return userId;
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  // 600/min/IP for UNAUTHENTICATED traffic. Bumped from 300 to give
  // headroom for legitimate users behind CGNAT (Libya's mobile
  // carriers extensively share egress IPs); abuse is still capped.
  // Authenticated users are skipped here and limited per-userId by
  // userLimiter instead.
  limit: 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: makeRateLimitStore(),
  // Round-3 (audit §4 #13): without a `message`, express-rate-limit
  // responds with a PLAIN-TEXT "Too many requests." body — the only
  // non-JSON response in the entire /api surface, breaking every
  // client that assumes `r.json()`. userLimiter/authLimiter already
  // had Arabic JSON messages; this brings the last limiter in line.
  message: {
    error: "تم تجاوز الحد الأقصى للطلبات. حاول مرة أخرى بعد دقيقة.",
    code: "RATE_LIMITED",
  },
  skip: (req) => {
    // Skip rate limiting for health checks and static assets.
    // NOTE (round-3 audit): this middleware is mounted at `/api`, so
    // `req.path` is mount-relative — the health routes live at
    // `/healthz*` (NOT "/health", which never matched and made Render
    // probes + admin polling burn the per-IP budget). Fixed alongside
    // the static-asset prefixes which are already mount-relative.
    const path = req.path;
    if (
      path === "/healthz" ||
      path.startsWith("/healthz/") ||
      path === "/health" ||
      path.startsWith("/assets/") ||
      path.startsWith("/static/")
    ) {
      return true;
    }
    // Skip when the caller has a verified user identity — the per-
    // user limiter handles them. Unauthenticated callers fall
    // through and are bound by the IP limit.
    return getRequestUserId(req) !== null;
  },
});

const userLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  // 1200/min/user. Sized for the busiest legitimate page-load
  // pattern (admin dashboards opening multiple polled queries plus
  // user navigation). With this many requests in a minute, the
  // user is either a bot or hitting a regression we should know
  // about — the response message is intentionally non-Arabic-only
  // so logs are searchable.
  limit: 1200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: makeRateLimitStore(),
  // Inverse skip of apiLimiter — only authenticated traffic.
  skip: (req) => getRequestUserId(req) === null,
  keyGenerator: (req) => {
    const userId = getRequestUserId(req);
    return `u:${userId ?? "anon"}`;
  },
  message: {
    error: "تم تجاوز الحد الأقصى للطلبات لهذه الجلسة. حاول مرة أخرى بعد دقيقة.",
    code: "RATE_LIMITED",
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: makeRateLimitStore(),
  skipFailedRequests: false,
  // Counting successes too: OTP send endpoints sit behind these auth
  // limiters, and skipping successes let one IP SMS-bomb unlimited phone
  // numbers as long as each attempt "worked". 10 sends / 15 min / IP is
  // still far above any legitimate login cadence. (96-F1: /api/auth/
  // whatsapp/start moved to whatsappStartAuthLimiter below — CGNAT
  // mitigation — but the same counting policy applies there.)
  skipSuccessfulRequests: false,
  message: { error: "عدد كبير من المحاولات. حاول مجدداً بعد 15 دقيقة.", code: "RATE_LIMITED" },
});

// 96-F1 (R96-A4 §3.4): /api/auth/whatsapp/start gets its own, higher
// IP ceiling as a CGNAT false-lock mitigation. One OTP login already
// costs start+verify against the shared budget; a wrong-code retry
// loop (5-attempt cap) plus a resend exhausts 10/15min quickly — and
// Libya's mobile carriers extensively share egress IPs (see the
// apiLimiter CGNAT note above), so strangers behind the same IP were
// being locked out of LOGIN for 15 minutes. 20/15min for start only;
// the per-phone caps in the OTP orchestration (60 s cooldown, 5/hour,
// 5 attempts) remain the real anti-abuse gate. /verify, admin login
// and every other credential endpoint stay on the strict authLimiter.
const whatsappStartAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: makeRateLimitStore(),
  skipFailedRequests: false,
  skipSuccessfulRequests: false,
  message: { error: "عدد كبير من المحاولات. حاول مجدداً بعد 15 دقيقة.", code: "RATE_LIMITED" },
});

// r4 money-integrity: coupon enumeration guard. /api/coupons/validate
// distinguishes live codes from dead ones via 404/400/200 — under the
// blanket 1200/min/user limiter that is a usable oracle for scraping
// every active coupon code. Legitimate checkout usage is a handful of
// attempts per minute at most (a user pasting a code they received);
// 10/min per user makes enumeration useless while staying far above
// any honest pattern. Keyed per-user via getRequestUserId; anonymous
// callers fall back to the shared IP key (they also must pass
// requireUser inside the route, so the per-user key is the one that
// matters in practice).
//
// SEC-92-04 (round-92): the anonymous fallback previously used raw
// `req.ip`, which (a) triggered express-rate-limit's
// ERR_ERL_KEY_GEN_IPV6 boot warning (custom keyGenerators that read
// req.ip without the ipKeyGenerator helper are rejected by the lib's
// static validation) and (b) keyed anonymous IPv6 callers by their
// FULL address — a /64-owning attacker got a fresh 10/min budget per
// address. ipKeyGenerator() returns the IPv4 as-is and collapses IPv6
// to a /56 subnet, matching the library default the other limiters use.
const couponValidateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: makeRateLimitStore(),
  keyGenerator: (req) => {
    const userId = getRequestUserId(req);
    // SEC-92-04: express-rate-limit 8.4.1's ipKeyGenerator takes the IP
    // STRING (IPv4 passthrough, IPv6 collapsed to a /56 subnet — see
    // dist/index.mjs `function ipKeyGenerator(ip, ipv6Subnet = 56)`).
    // Passing it the raw req.ip string (a) satisfies the library's
    // ERR_ERL_KEY_GEN_IPV6 source validation (custom keyGenerators that
    // read req.ip must delegate to ipKeyGenerator) and (b) makes the
    // anonymous fallback rotation-proof: a /64-owning attacker no longer
    // gets a fresh 10/min budget per individual IPv6 address.
    return userId !== null ? `cu:${userId}` : `cu:ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
  },
  message: {
    error: "عدد كبير من محاولات التحقق من الكوبونات. حاول مرة أخرى بعد دقيقة.",
    code: "RATE_LIMITED",
  },
});

// ── Phase 2 instrumentation pipeline ─────────────────────────────────────────
//
// Order matters:
//   1. correlation — establishes the AsyncLocalStorage context with a UUID v4
//      request id and echoes it back as `x-request-id`. Every downstream
//      middleware can call getCorrelationId().
//   2. instrumentationIsolation — guards downstream middleware so a failure in
//      metrics or pinoHttp can never crash the request handler.
//   3. pinoHttp — bound to the same correlation id via genReqId so log lines
//      carry the request id the caller will see on the response and in Sentry.
//   4. metricsMiddleware — observes http_request_duration_seconds and
//      increments http_requests_total on res.finish.
//
// Additive only — no behaviour change to existing CSP, COOP, scriptSrc,
// scriptSrcAttr, HSTS configuration above.
app.use(correlationMiddleware);
app.use(instrumentationIsolation);

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    // Use the correlation id as the pino-http request id so logs and the
    // x-request-id response header agree. Falls back to a fresh UUID v4 if
    // the correlation context is somehow missing (defensive).
    genReqId: () => getCorrelationId() ?? randomUUID(),
    customAttributeKeys: { reqId: "correlation_id" },
    // Skip request-completed logs for high-frequency, low-information
    // routes. /healthz hit by Render edge probes every 30s and by admin
    // polling at minute cadence; logging them just inflates the log
    // stream without diagnostic value. /api/cwv beacons are similar —
    // many small POSTs per page-load.
    autoLogging: {
      ignore: (req) => {
        const url = req.url ?? "";
        return (
          url === "/api/healthz" ||
          url.startsWith("/api/healthz/") ||
          url === "/api/cwv" ||
          // R104 (AG8-4): the admin observability family is a pure
          // self-observation of dashboards polling on 15-90 s timers —
          // ~440 log lines/awake-hour per open System tab that say
          // nothing the dashboard itself doesn't already show.
          url.startsWith("/api/admin/observability/")
        );
      },
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(metricsMiddleware);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Defensive recovery for malformed JSON bodies. Catches express.json()
// SyntaxErrors (predominantly bot probes hitting /api/auth/login with
// form-encoded credential-stuffing payloads, plus the occasional
// misconfigured client). Salvages URL-encoded bodies sent with the
// wrong Content-Type, returns clean 400 otherwise. Does NOT capture
// in Sentry — see backend/src/lib/body-parser-recovery.ts.
app.use(bodyParserRecovery);

// ── CSRF Protection for state-changing requests ───────────────────────────────
// Validate Origin/Referer headers for POST/PUT/DELETE/PATCH requests.
//
// Exported as a factory (SEC-92-01) so the exact gate production mounts is
// unit-testable without booting the whole app tree — see
// src/__tests__/csrf-gate.test.ts.
export function createCsrfGate(allowedOrigins: string[], production: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
      const origin = req.headers.origin;
      const referer = req.headers.referer;

      // Skip CSRF check ONLY for endpoints where the browser legitimately omits
      // Origin/Referer:
      //   - /api/cwv: navigator.sendBeacon does not set Origin on most browsers.
      //   - /api/webhook/*: third-party callbacks (Telegram, Stripe-style) sign
      //     their bodies; Origin from a different host is expected.
      //
      // AUD103-3-F1 (r103): /api/auth/firebase/refresh is NO LONGER skipped.
      // The old justification ("rotation of an ALREADY-bound session") was
      // false — the handler at auth.ts requires only a signed Firebase ID
      // token and NO prior session, i.e. it is a session MINT with the exact
      // same shape 98-F3 closed for /api/auth/firebase/session: with
      // SameSite=None production cookies, a hostile page could POST a
      // CORS-simple form carrying the attacker's own ID token and silently
      // bind the victim's browser to the attacker's account. The SPA calls
      // refresh via fetch (firebase-auth.ts), which always sends Origin, so
      // the skip bought nothing for the legitimate client.
      //
      // 98-F3 (R98-A1 P2-3): /api/auth/firebase/session is NO LONGER skipped.
      // It is a session MINT (Set-Cookie of a fresh auth_token), so skipping
      // the gate opened a login-CSRF window: a hostile page could POST a form
      // (CORS-simple request, no preflight) carrying the attacker's own
      // Firebase ID token and silently log the victim into the ATTACKER's
      // account — the victim then tops up the wallet (correct Origin from
      // the real SPA) and deposits real money into an account the attacker
      // controls. The SPA itself always sends Origin on fetch, so the skip
      // bought nothing for the legitimate client. The mint is now gated like
      // every other mutating route (Origin/Referer allow-list + the
      // cookie-without-headers sub-rule below, which also blocks the
      // re-binding variant for already-logged-in victims).
      //
      // Login / register / forgot-password / reset-password / change-password /
      // toggle-password-login / sessions / logout / providers — ALL inside the
      // CSRF gate. SameSite cookies remain the second layer.
      const skipPaths = ["/api/cwv", "/api/webhook"];
      if (skipPaths.some((path) => req.path.startsWith(path))) {
        next();
        return;
      }

      // SEC-92-01 (round-92 B1 audit): does the request carry an
      // ambient-authority cookie? Production cookies are SameSite=None
      // (render.yaml AUTH_COOKIE_SAMESITE=none), so browsers attach
      // auth_token/admin_token to ANY cross-site request — including a
      // plain HTML <form method="POST">, which is a CORS simple request
      // (no preflight) parsed by express.urlencoded above. Origin/Referer
      // are the only client-side signals we can gate such attacks on.
      const hasAuthCookie = Boolean(req.cookies?.auth_token || req.cookies?.admin_token);

      // F-009 (security audit 004) — Origin/Referer check runs in ALL
      // environments. The allowedOrigins list is computed once at module
      // load with sensible dev defaults.
      if (allowedOrigins.length > 0) {
        // Exact-origin comparison only. The previous `startsWith(allowed)`
        // form was a bypass: an attacker origin like `https://subnation.ly
        // .evil.com` (or any subdomain-path prefix) matched the allow-list
        // entry. We normalize by parsing the URL and comparing scheme+
        // host(+port) so trailing slashes/paths on either side don't matter.
        const originAllowed = (candidate: string, allowed: string): boolean => {
          try {
            const c = new URL(candidate);
            const a = new URL(allowed);
            return c.protocol === a.protocol && c.host === a.host;
          } catch {
            return false;
          }
        };

        // SEC-92-01 (2): a cookie-authenticated state-changing request with
        // NEITHER Origin NOR Referer is the classic no-Origin form-POST
        // shape (legacy/embedded browsers omit Origin on cross-site form
        // submissions). Real browser clients always send at least one of
        // the two for same-origin SPA calls, so treat "both absent + auth
        // cookie" as hostile. Headerless non-cookie API clients are still
        // rejected by the isValid check below — unchanged F-009 behavior.
        if (hasAuthCookie && !origin && !referer) {
          logger.warn(
            { path: req.path, hasAdminCookie: Boolean(req.cookies?.admin_token) },
            "CSRF validation failed: auth cookie present but Origin and Referer both absent",
          );
          res.status(403).json(createErrorResponse("طلب غير مصرح", ErrorCode.FORBIDDEN));
          return;
        }

        const isValid =
          (origin && allowedOrigins.some((allowed) => originAllowed(origin, allowed))) ||
          (referer && allowedOrigins.some((allowed) => originAllowed(referer, allowed)));

        if (!isValid) {
          logger.warn({ origin, referer, path: req.path }, "CSRF validation failed");
          res.status(403).json(createErrorResponse("طلب غير مصرح", ErrorCode.FORBIDDEN));
          return;
        }
      } else if (production) {
        // SEC-92-01 (1) — production with no allow-list. This branch
        // previously logged and continued (fail OPEN), which — combined
        // with SameSite=None cookies — silently exposed every
        // cookie-authenticated state-changing route the moment the
        // origins env vars were lost. The boot-time assertion above now
        // aborts the process first; the runtime gate below stays fail-
        // closed as defense-in-depth for any path where the assertion
        // somehow did not run:
        //   - requests WITH an auth cookie → 403 (they carry ambient
        //     authority a cross-site form could abuse);
        //   - requests WITHOUT an auth cookie → pass with a loud operator
        //     log (no ambient authority = no CSRF surface; they must
        //     still present their own credentials at the route).
        if (hasAuthCookie) {
          logger.error(
            { path: req.path, category: "security", audit_finding: "SEC-92-01" },
            "CSRF gate CLOSED: empty allow-list in production and the request carries an auth cookie",
          );
          res.status(403).json({
            error: "طلب غير مصرح — إعداد الحماية غير مكتمل",
            code: "CSRF_CONFIG",
          });
          return;
        }
        logger.error(
          { path: req.path },
          "CSRF middleware has no allow-list in production — set CSRF_ALLOWED_ORIGINS or APP_ORIGINS",
        );
      }
    }
    next();
  };
}

app.use(createCsrfGate(csrfAllowedOrigins, isProduction));

// ── Routes ────────────────────────────────────────────────────────────────────
// Auth limiter applies to login/register only (NOT /me — it's polled frequently)
app.use("/api/auth/firebase/session", authLimiter);
// refresh mints a fresh 30-day JWT from a Firebase ID token — same
// credential-equivalence as the session mint, so it gets the same budget.
app.use("/api/auth/firebase/refresh", authLimiter);
// 98-F3 (R98-A1 P1-1, severity corrected after experimental verification):
// app.use(path, mw) is a PREFIX match. This mount covers POST
// /api/admin/login AND /api/admin/login/verify-2fa (its subpath). The
// explicit "/api/admin/login/verify-2fa" mount that used to live here
// mounted the SAME authLimiter INSTANCE a second time on an overlapping
// prefix — every request to the subpath incremented the SAME key TWICE
// (verified experimentally: 1 request → used=2), silently HALVING the
// real login budget (10/15min acted as 5/15min). Two stronger claims
// from the early audit were experimentally DISPROVEN against
// express-rate-limit 8.4.1: no hard 500 (the library's validation
// wrapper catches its own errors and never re-throws), and not even a
// logged ERR_ERL_DOUBLE_COUNT (the middleware calls
// validations.disable() at the end of every invocation — dist line
// ~974 — so the second mount's wrapper runs with all validations off).
// The double budget burn is the entire defect. The redundant mounts
// for /api/auth/telegram/callback had the identical defect on the
// Telegram redirect login. Prefix mounts alone cover every path below;
// see routes/__tests__/limiter-composition.test.ts for the regression
// guard (pins the double-burn invariant behaviorally).
app.use("/api/admin/login", authLimiter);
// Telegram-Login is a credential-equivalent endpoint (signature-verified
// identity assertion). Apply the same strict limit as admin login to
// keep brute-force resistance consistent across auth surfaces.
// (Same prefix-match rule as above: this single mount covers POST
// /api/auth/telegram, POST /api/auth/telegram/webapp AND GET
// /api/auth/telegram/callback — do not add per-subpath mounts of the
// same instance.)
app.use("/api/auth/telegram", authLimiter);
// 96-F1 (R96-A4 §3.4): split WhatsApp OTP endpoints onto separate
// limiters — start takes the CGNAT-friendly whatsappStartAuthLimiter
// (20/15min), verify keeps the strict authLimiter (10/15min). Mounted
// per-path (NOT a blanket "/api/auth/whatsapp" prefix) so /start is
// never double-limited by the strict budget it was split from. When
// later phases add more /api/auth/whatsapp/* routes, mount them here
// explicitly on the appropriate limiter.
app.use("/api/auth/whatsapp/start", whatsappStartAuthLimiter);
app.use("/api/auth/whatsapp/verify", authLimiter);
// Coupon enumeration guard — must mount BEFORE the generic /api limiters
// so the tighter 10/min budget applies.
app.use("/api/coupons/validate", couponValidateLimiter);
app.use("/api", apiLimiter);
app.use("/api", userLimiter);
app.use("/api", router);

// JSON 404 for unmatched /api/* routes (must come AFTER all /api routers, BEFORE static)
app.use("/api", (_req, res) => {
  // R124 (A7-F4): this 404 shipped with NO Cache-Control while the
  // by-slug product 404 answers s-maxage=60 (products.ts catalogCache).
  // no-store, not the catalog family's s-maxage=60: this fallback also
  // covers authed admin surfaces (the no-store family), and unknown paths
  // a future deploy may turn into real routes must never have a cached
  // 404 shadow them. The body is a static two-field JSON — there is
  // nothing to gain from edge caching.
  res.set("Cache-Control", "no-store");
  res.status(404).json(createErrorResponse("المسار غير موجود", ErrorCode.NOT_FOUND));
});

// ── SEO routes (root-level) ──────────────────────────────────────────────────
// /robots.txt and /sitemap.xml live at the app root, not under /api, so search
// engines crawling the apex find them where they expect.
app.use(seoRouter);

const frontendDist = resolveFrontendDist();

// ── R120-B3 (A7-F3 / A7-F7 / A7-F16): per-route static-shell SEO meta ──────
//
// The SPA fallback below used to send the SAME index.html for every
// route — so the shell's hard-coded `<link rel=canonical
// href="https://subnation.ly/">` told every no-JS crawler (and every
// indexer that reads the raw HTML before rendering) that /category/vpn,
// /product/x, /login… were all duplicates of the HOMEPAGE. Three audit
// findings ride this one shell-rewrite layer:
//
//   A7-F3 (P1): known public routes get their REAL canonical + title +
//               description rewritten into the shell before sending —
//               category pages from the map below, products from the
//               same DB row the share card uses, statics for
//               /flash-sales, /terms, /support.
//   A7-F7 (P2): /product/:slug that misses the DB (unknown / inactive /
//               archived row) now answers 404 — the shell still ships
//               so the SPA's client-side not-found page renders, but
//               crawlers no longer see a 200 "soft 404".
//   A7-F16(P3): auth/transactional/admin families get `noindex,follow`
//               stamped into the static robots meta (mirroring the
//               SPA's NOINDEX_ROUTES + robots.txt Disallow list) and
//               the homepage canonical is STRIPPED (a canonical aiming
//               a noindex page at the homepage is a contradiction).
//   R122 (A7-P1-1): the product shell now prefers the row's DB-backed
//               seo_title / seo_description (operator overrides, the
//               SAME fields the hydrated page renders) over the
//               English brand-only `${name} — SubNation` fallback —
//               raw-HTML and post-render titles finally agree on the
//               45 money pages.
//   R122 (A7-P1-2): unknown public paths and unknown category slugs
//               ALSO get `noindex,follow` — the SPA renders its own
//               noindex 404 surface for exactly these URLs, and the
//               raw shell used to contradict it with index,follow.
//   R122 (A3-P1): the /product/:slug DB lookup behind this layer (and
//               the share card's) is unauthenticated and sits outside
//               every rate limiter — it now rides the catalog cache
//               idiom (60 s TTL, generation-bumped by admin CRUD).
//
// Unknown paths: the homepage canonical is stripped (NO canonical
// beats a lying one) and the robots meta is stamped `noindex,follow`
// (R122 A7-P1-2 — mirrors the SPA's own 404 treatment); the shell stays
// 200 so the SPA's client-side 404 owns the UX.
//
// Safety posture: the shell is read ONCE at boot into memory and every
// rewrite is a pure string op on that snapshot (streaming-safe, and the
// immutable-asset/CSP headers above are untouched — this layer only
// rewrites the HTML document body). Only EXISTING tags are rewritten,
// never inserted, so a stub/test shell without the markers passes
// through byte-identical.
//
// R122 (A7-P2): boot-time comment-balance guard. rewriteOutsideComments
// splits on CLOSED comments only — an unclosed `<!--` in a future shell
// edit turns the whole tail into one "non-comment" segment and the
// title rewriter pairs the COMMENT's `<title>` prose with the real
// closer (the d22f24e incident class: canonical + every og tag deleted
// from /category/* shells, silently). An imbalanced shell now refuses to
// enter the rewrite layer AT ALL (fatal boot log + SPA_SHELL_HTML=null
// → the fallback below serves the UNTOUCHED file) — the site boots with
// baseline meta instead of shipping destructive rewrites.
const SPA_SHELL_HTML = (() => {
  if (!frontendDist) return null;
  try {
    const html = readFileSync(path.join(frontendDist, "index.html"), "utf8");
    // R122 (A7-P2): the d22f24e guard — see the block comment above.
    // Degrade (null) instead of throwing: the API/money surface must
    // survive a cosmetic shell defect; the fatal log + the pinned
    // regression test are the loud half of the contract.
    if (!shellCommentsBalance(html)) {
      const opens = (html.match(/<!--/g) ?? []).length;
      const closes = (html.match(/-->/g) ?? []).length;
      logger.fatal(
        { category: "seo", opens, closes },
        "SPA shell HTML comments are UNBALANCED (<!-- vs -->) — the d22f24e " +
          "rewrite bug class. Serving the UNREWRITTEN shell (baseline meta) " +
          "until the template is fixed; refusing to run the shell rewriter.",
      );
      return null;
    }
    return html;
  } catch {
    return null;
  }
})();

/**
 * R122 (A7-P2): true when the shell's HTML comment delimiters balance.
 * Exported for the regression tests (unit cases + the real shipped
 * frontend/index.html pin). A mismatch means rewriteOutsideComments'
 * split-on-closed-comments would treat comment prose as markup — the
 * d22f24e incident class (see SPA_SHELL_HTML above).
 */
export function shellCommentsBalance(html: string): boolean {
  return (html.match(/<!--/g) ?? []).length === (html.match(/-->/g) ?? []).length;
}

/** Authoritative public origin — the SAME resolution routes/seo.ts and
 * the share card use (APP_URL with the canonical production default). */
function appOrigin(): string {
  return (process.env.APP_URL || "https://subnation.ly").replace(/\/$/, "");
}

/** HTML-escape for text/attribute contexts (title bodies, meta content). */
function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * R120-B3 (A7-F9): the price a share card / shell meta should advertise
 * — the ACTIVE flash-sale price (via lib/pricing.ts, the single source
 * the catalog + checkout apply) when one is live and lower than the
 * list price; the list price otherwise. Mirrors product.tsx's seoPrice
 * rule (sale_price preferred only when it is actually lower).
 */
async function shareDisplayPrice(listPrice: string): Promise<string> {
  const base = Number(listPrice);
  if (!Number.isFinite(base)) return listPrice;
  const { flashSale, basePrice } = await applyFlashSale(base);
  return flashSale && basePrice < base ? basePrice.toFixed(2) : listPrice;
}

/**
 * R120-B3 (A7-F17): assemble the share description INSIDE display
 * limits — body sliced to ~150, price suffix appended, then the WHOLE
 * string clamped to 180 (the old slice(0,180) + suffix could overshoot
 * every card's display budget).
 */
function buildShareDescription(description: string | null, displayPrice: string): string {
  const body = (description ?? "اشتراك رقمي أصلي بالدينار الليبي من SubNation")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  const assembled = `${body} — السعر ${displayPrice} د.ل`;
  return assembled.length <= 180 ? assembled : `${assembled.slice(0, 179)}…`;
}

/**
 * R122 (A7-P2-5): clamp an operator seo_title for the shell, mirroring
 * MetaTags.clamp(text, 60) VERBATIM (frontend/src/components/seo/
 * MetaTags.tsx) so the raw-HTML title and the hydrated title agree on
 * the same 60-char budget. The DB column allows 200; only the DISPLAY
 * is clamped.
 */
function clampSeoTitleForShell(title: string): string {
  return title.length <= 60 ? title : title.slice(0, 59).trim() + "…";
}

/**
 * R122 (A3-P1): the ONE cached product lookup behind BOTH no-JS share
 * surfaces — resolveSpaShellMeta's /product/* branch (browser/indexer
 * shells) and the unfurler OG card below. Both used to run their own
 * uncached `SELECT … WHERE slug|id AND is_archived=false` (plus the
 * flash-sale stage for the display price) on every request: these GETs
 * are unauthenticated, sit OUTSIDE every rate limiter (all limiters
 * mount under /api), and the shell's response is no-store — so wire-speed
 * /product/<slug> bursts reached Neon directly. Now the row + display
 * price ride the catalog cache idiom (lib/catalog-cache.ts): 60 s TTL,
 * generation-bumped by admin product/variant/flash-sale/pricing CRUD —
 * the same freshness contract the /api/products detail routes accept
 * (their DTO prices are equally flash-sale-derived at 60 s).
 *
 * Dead-slug misses ARE cached ({ found: false }): the A3 attack rotates
 * unique garbage slugs, and an uncached 404 path would leave that DoS
 * surface fully open. Bounded by the LRU entry/byte budget
 * (lib/cache.ts B6-02) — entries here are ~200 B, so a garbage-slug flood
 * evicts old entries instead of growing memory.
 */
interface ShareSurfaceProduct {
  slug: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: string;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
}

async function lookupProductForShareSurfaces(
  slugOrId: string,
  numeric: number | null,
): Promise<{ found: false } | { found: true; row: ShareSurfaceProduct; displayPrice: string }> {
  // R122 (A3-P1): products.slug is varchar(160) — an over-long slug can
  // NEVER match a row, so answering the miss without a query ALSO keeps
  // attacker-minted multi-KB slugs from becoming LRU KEYS (the byte
  // budget tracks values, not keys). Mirrors the /api/products/by-slug
  // 160-char guard.
  if (numeric === null && slugOrId.length > 160) return { found: false };
  return withCatalogCache(
    "spa-share",
    numeric !== null ? `id:${numeric}` : `slug:${slugOrId}`,
    60,
    async () => {
      const [row] = await db
        .select({
          slug: productsTable.slug,
          name: productsTable.name,
          description: productsTable.description,
          imageUrl: productsTable.imageUrl,
          price: productsTable.price,
          isActive: productsTable.isActive,
          // R122 (A7-P1-1): the operator SEO overrides — same columns the
          // hydrated page renders (frontend/src/pages/product.tsx).
          seoTitle: productsTable.seoTitle,
          seoDescription: productsTable.seoDescription,
        })
        .from(productsTable)
        .where(
          and(
            numeric !== null ? eq(productsTable.id, numeric) : eq(productsTable.slug, slugOrId),
            // Same WHERE half as every public product surface (D2-F4): an
            // archived row can never render a shell or a share card.
            eq(productsTable.isArchived, false),
          ),
        )
        .limit(1);
      if (!row) return { found: false as const };
      // Flash-aware display price folded INTO the cached entry — the
      // 60 s staleness budget matches the share card's own
      // Cache-Control max-age=60 and the detail routes' cached sale_price.
      return { found: true as const, row, displayPrice: await shareDisplayPrice(row.price) };
    },
  );
}

/**
 * Category landing-page meta for the static shell — DUPLICATED from
 * frontend/src/lib/categories.ts (metaTitle / metaDescription verbatim).
 * The backend build cannot import the frontend source (tsc rootDir:
 * "src"), so parity is PINNED by test:
 * src/__tests__/spa-shell-category-parity.test.ts fails when either
 * copy drifts. Keep both files in sync when a category's meta changes.
 * Exported for that parity test.
 */
export const SHELL_CATEGORY_META: Record<string, { metaTitle: string; metaDescription: string }> = {
  streaming: {
    metaTitle: "البث المباشر في ليبيا — Netflix و Disney+ | SubNation",
    metaDescription:
      "اشترِ اشتراكات Netflix و Disney+ و Shahid VIP و Amazon Prime Video بالدينار الليبي. تسليم فوري في طرابلس وبنغازي ومصراتة وكامل ليبيا.",
  },
  music: {
    metaTitle: "اشتراكات الموسيقى في ليبيا — Spotify | SubNation",
    metaDescription:
      "اشترِ اشتراك Spotify Premium وخدمات الموسيقى الأخرى بالدينار الليبي. تسليم فوري، جودة صوت عالية، استماع بدون إعلانات في كامل ليبيا.",
  },
  software: {
    metaTitle: "مفاتيح Windows وبرامج أصلية في ليبيا | SubNation",
    metaDescription:
      "اشترِ مفاتيح Windows 10 و WinRAR و Grammarly و cPanel أصلية بالدينار الليبي. تراخيص دائمة، تفعيل فوري، ضمان استبدال في كامل ليبيا.",
  },
  vpn: {
    metaTitle: "اشتراكات VPN في ليبيا — ExpressVPN | SubNation",
    metaDescription:
      "اشترِ اشتراكات ExpressVPN و CyberGhost و IPVanish و HMA بالدينار الليبي. تسليم فوري، تشفير كامل، خوادم عالمية، تعمل في كامل ليبيا.",
  },
  "ai-tools": {
    metaTitle: "اشتراك ChatGPT Plus في ليبيا | SubNation",
    metaDescription:
      "فعّل ChatGPT Plus و Shopia AI بالدينار الليبي بدون بطاقة دولية. تسليم فوري لبيانات الحساب، وصول كامل للنماذج المتقدمة، دعم في كامل ليبيا.",
  },
  "seo-tools": {
    metaTitle: "أدوات SEO في ليبيا — Ahrefs و Semrush | SubNation",
    metaDescription:
      "اشترِ اشتراكات Ahrefs و Semrush الاحترافية بالدينار الليبي. تحليل روابط وكلمات مفتاحية ومنافسين، فاتورة شهرية أو سنوية، تسليم فوري في ليبيا.",
  },
  education: {
    metaTitle: "اشتراكات Skillshare و Scribd في ليبيا | SubNation",
    metaDescription:
      "اشترِ اشتراكات Skillshare و Scribd الأصلية بالدينار الليبي. آلاف الدورات ومكتبة كتب غير محدودة، تنزيل بدون إنترنت، تسليم فوري في كامل ليبيا.",
  },
};

/**
 * Home shell meta — DUPLICATED from the runtime useSeo block in
 * frontend/src/pages/home.tsx (title + description verbatim).
 * B12-F1 (R127-L9): the shipped index.html baseline is the generic
 * brand-first default («SubNation — سوق الاشتراكات الرقمية» + the
 * R120-B3 catalog description) while the hydrated home page renders
 * this keyword-forward copy — a split title+description signal for
 * every non-rendering engine (the exact class R122 A7-P1-1 closed for
 * /product/*). The backend build cannot import the frontend source
 * (tsc rootDir: "src"), so parity is PINNED by test:
 * src/__tests__/spa-shell-route-parity.test.ts fails when either
 * copy drifts. Exported for that parity test.
 */
export const SHELL_HOME_META: { title: string; description: string } = {
  // The money query leads («سوق الاشتراكات الرقمية في ليبيا»), brand
  // tail, ≤60 chars — the rendered page's exact title.
  title: "سوق الاشتراكات الرقمية في ليبيا | SubNation",
  // Intent-led ~147-char copy: locale inside the first clause, the
  // Arabic brand transliterations users actually type, closing with
  // the three differentiators (LYD, instant delivery, local support).
  description:
    "متجر إلكتروني متخصّص لشراء اشتراكات الخدمات الرقمية في ليبيا — نتفلكس، سبوتيفاي، يوتيوب، ديزني+ وأكثر. الدفع بالدينار الليبي، تسليم فوري، دعم محلي.",
};

/**
 * Static public routes with fixed meta (mirrors each page's useSeo
 * block). Same pinning contract as SHELL_HOME_META above: parity is
 * PINNED by src/__tests__/spa-shell-route-parity.test.ts — keep both
 * sides in sync when a route's meta changes. Exported for that test.
 */
export const SHELL_STATIC_ROUTE_META: Record<string, { title: string; description: string }> = {
  "/flash-sales": {
    title: "عروض فلاش — SubNation",
    // R124 (A10-F3) lengthened the rendered description 53 → 140 chars
    // but shipped frontend-only — B12-F2 (R127-L9): the shell kept
    // serving the pre-R124 copy to every non-rendering engine. Now
    // the runtime builder's copy verbatim.
    description:
      "عروض فلاش بخصومات حقيقية لفترة محدودة على اشتراكات نتفلكس وسبوتيفاي و ChatGPT و VPN — بالدينار الليبي مع تسليم فوري بعد الدفع في كامل ليبيا.",
  },
  "/support": {
    title: "الدعم والأسئلة الشائعة — SubNation",
    description:
      "إجابات حول الدفع وشحن المحفظة والاشتراكات والاسترداد وتسجيل الدخول في SubNation. افتح تذكرة دعم في أي وقت.",
  },
  "/terms": {
    title: "الشروط والأحكام — SubNation",
    description:
      "شروط استخدام منصة SubNation: سياسة الشراء، شحن المحفظة، الاشتراكات الرقمية، والاسترداد.",
  },
};

/**
 * A7-F16: static-shell noindex families — the SAME path families the
 * SPA's NOINDEX_ROUTES (frontend/src/App.tsx) and robots.txt Disallow
 * list cover. `noindex,follow` (not none) so crawlers keep walking
 * outbound links instead of treating them as dangling.
 */
const SHELL_NOINDEX_RES: RegExp[] = [
  /^\/login$/,
  /^\/register$/,
  /^\/forgot-password$/,
  /^\/onboarding(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/cart(\/|$)/,
  /^\/checkout(\/|$)/,
  /^\/wallet(\/|$)/,
  /^\/orders(\/|$)/,
  /^\/loyalty(\/|$)/,
  /^\/referrals(\/|$)/,
  /^\/profile(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/status(\/|$)/,
];

/** Resolved per-route shell meta (exported for the shell-rewrite tests). */
export interface SpaShellMeta {
  /** HTTP status for the shell response (200; 404 for dead product slugs). */
  status: number;
  /** Rewrites <title> + og:title when present. */
  title?: string;
  /** Rewrites meta[name=description] + og:description when present. */
  description?: string;
  /** Absolute canonical URL; `null` STRIPS the link; undefined leaves it. */
  canonical?: string | null;
  /** robots override ("noindex,follow" for auth/admin families). */
  robots?: string;
  /** Absolute og:image URL for product pages (A11-F3b, R126-L6).
   *  Rewrites og:image AND strips the baseline og:image:width/height
   *  (the 1280×720 pair belongs to opengraph.jpg; product art carries
   *  its own per-file dimensions — omitted beats wrong). Undefined
   *  leaves the static og set untouched. */
  ogImage?: string;
}

/**
 * Pure regex helpers — each rewrites ONLY an existing tag (no insertion):
 * the production shell carries every marker (data-rh), while stub/test
 * shells without a marker pass through untouched.
 */
function rewriteMetaTag(
  html: string,
  attr: "name" | "property",
  key: string,
  content: string,
): string {
  const tagRe = new RegExp(`<meta\\b(?=[^>]*\\b${attr}\\s*=\\s*["']${key}["'])[^>]*>`, "i");
  if (!tagRe.test(html)) return html;
  return html.replace(tagRe, (tag) =>
    tag.replace(/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i, `content="${escapeHtmlAttr(content)}"`),
  );
}

function rewriteCanonical(html: string, href: string | null): string {
  const linkRe = /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i;
  if (href === null) return html.replace(linkRe, "");
  if (!linkRe.test(html)) return html;
  return html.replace(linkRe, (tag) =>
    tag.replace(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i, `href="${escapeHtmlAttr(href)}"`),
  );
}

/**
 * A11-F3b (R126-L6): REMOVE an existing meta tag outright (used for the
 * baseline og:image:width/height pair when og:image points at product
 * art — the 1280×720 numbers belong to opengraph.jpg and would be a
 * wrong claim beside a /products/*.webp image; omitted beats wrong).
 * Same marker contract as rewriteMetaTag: no tag, no change.
 */
function removeMetaTag(html: string, attr: "name" | "property", key: string): string {
  const tagRe = new RegExp(`<meta\\b(?=[^>]*\\b${attr}\\s*=\\s*["']${key}["'])[^>]*>\\n?`, "i");
  return html.replace(tagRe, "");
}

/**
 * Apply `rewrite` only to NON-comment segments of the shell (R120 hotfix
 * for the R120-B3 shell rewriter). The production shell carries developer
 * comments that MENTION tag names in prose — e.g. the V3-A1 note
 * "…upsert-by-selector — one <title>, one description, one og set…" sits
 * ~2.6 KB BEFORE the real <title data-rh> tag. A naive
 * /<title\b[^>]*>…<\/title>/ match therefore paired the comment's
 * "<title>" opener with the REAL title's closer and replaced the entire
 * span — deleting the canonical link, every og:/twitter: tag in between
 * and leaving the comment UNCLOSED (9 `<!--` vs 8 `-->` shipped to
 * /category/*). Splitting on comment boundaries makes every rewriter
 * structurally unable to see comment prose as markup.
 */
function rewriteOutsideComments(html: string, rewrite: (segment: string) => string): string {
  // Capture group keeps the comment segments in the split output; map
  // applies the rewriter only to the non-comment parts.
  return html
    .split(/(<!--[\s\S]*?-->)/)
    .map((part) => (part.startsWith("<!--") ? part : rewrite(part)))
    .join("");
}

/**
 * Apply resolved meta to the in-memory shell snapshot (exported for tests).
 * Every tag surgery runs OUTSIDE comments (see rewriteOutsideComments).
 */
export function applySpaShellMeta(html: string, meta: SpaShellMeta): string {
  return rewriteOutsideComments(html, (segment) => {
    let out = segment;
    if (meta.title !== undefined) {
      out = out.replace(
        /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i,
        (_m: string, open: string, _inner: string, close: string) =>
          open + escapeHtmlAttr(meta.title as string) + close,
      );
      out = rewriteMetaTag(out, "property", "og:title", meta.title);
    }
    if (meta.description !== undefined) {
      out = rewriteMetaTag(out, "name", "description", meta.description);
      out = rewriteMetaTag(out, "property", "og:description", meta.description);
    }
    if (meta.robots !== undefined) {
      out = rewriteMetaTag(out, "name", "robots", meta.robots);
    }
    if (meta.ogImage !== undefined) {
      out = rewriteMetaTag(out, "property", "og:image", meta.ogImage);
      // The shipped og:image:width/height pair describes the BASELINE
      // opengraph.jpg — next to product art it would be a wrong
      // dimension claim. Strip (the WhatsApp-proven share card ships
      // og:image without dimension tags too).
      out = removeMetaTag(out, "property", "og:image:width");
      out = removeMetaTag(out, "property", "og:image:height");
    }
    if (meta.canonical !== undefined) {
      out = rewriteCanonical(out, meta.canonical);
    }
    return out;
  });
}

/**
 * Resolve the shell meta for a request path (exported for tests; hits
 * the DB only for /product/*). Trailing slashes are normalized.
 */
export async function resolveSpaShellMeta(pathname: string, origin: string): Promise<SpaShellMeta> {
  const norm = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (norm === "" || norm === "/") {
    // B12-F1 (R127-L9): the static baseline (index.html) ships the
    // generic brand-first default while the hydrated home page renders
    // the keyword-forward copy above — the split meta signal R122
    // (A7-P1-1) eliminated for products. Rewrites <title> + og:title +
    // description + og:description; the static apex canonical,
    // index,follow robots and the og:image set are already correct for
    // "/" and stay untouched (parity-pinned by spa-shell-route-parity).
    return {
      status: 200,
      title: SHELL_HOME_META.title,
      description: SHELL_HOME_META.description,
    };
  }

  const category = /^\/category\/([^/]+)$/.exec(norm);
  if (category) {
    const meta = SHELL_CATEGORY_META[category[1]];
    // Unknown category slug → the SPA renders its noindex 404 surface;
    // unknown-path treatment (no canonical) applies. R122 (A7-P1-2):
    // the raw shell now stamps noindex,follow too — it used to keep the
    // static index,follow and contradict the SPA's own rendered robots.
    return meta
      ? {
          status: 200,
          title: meta.metaTitle,
          description: meta.metaDescription,
          canonical: `${origin}/category/${category[1]}`,
        }
      : { status: 200, canonical: null, robots: "noindex,follow" };
  }

  const product = /^\/product\/([^/]+)$/.exec(norm);
  if (product) {
    let slugOrId: string;
    try {
      slugOrId = decodeURIComponent(product[1] as string);
    } catch {
      return { status: 404, canonical: null };
    }
    const numeric = /^\d+$/.test(slugOrId) ? Number.parseInt(slugOrId, 10) : null;
    // R122 (A3-P1): the cached lookup shared with the share card (see
    // lookupProductForShareSurfaces) — this branch used to run its own
    // uncached query on every unauthenticated, un-rate-limited GET.
    const lookup = await lookupProductForShareSurfaces(slugOrId, numeric);
    // A7-F7: unknown / inactive / archived product slug → real 404 (the
    // shell still ships so the SPA's not-found page renders client-side).
    if (!lookup.found || !lookup.row.isActive) return { status: 404, canonical: null };
    const row = lookup.row;
    // R122 (A7-P1-1 + A7-P2-5): prefer the operator's DB-backed SEO
    // overrides — the SAME fields the hydrated page renders
    // (frontend/src/pages/product.tsx: seo_title?.trim() ? seo_title :
    // fallback, description from seo_description sliced to 160). The
    // raw-HTML title used to be English brand-only on every product page
    // while the rendered page showed the Arabic keyword title — a split
    // title signal for every non-rendering engine. Fallbacks keep the
    // pre-R122 behavior (name — SubNation / price-suffixed share copy).
    const seoTitle = row.seoTitle?.trim() || null;
    const seoDescription = row.seoDescription?.trim() || null;
    // A11-F3b (R126-L6): the row's real art as og:image — indexers and
    // no-JS agents used to see only the generic /opengraph.jpg here
    // (unfurlers were covered by the dedicated share-card route; every
    // other consumer wasn't). The lookup already carries imageUrl, so
    // this costs nothing extra. Absolutized exactly like the share
    // card below: DB rows carry site-relative /products/<slug>.webp;
    // already-absolute URLs (future CDN host) pass through untouched.
    // Null imageUrl keeps the static og set (a generic card beats none).
    const ogImage = row.imageUrl
      ? row.imageUrl.startsWith("http")
        ? row.imageUrl
        : `${origin}${row.imageUrl.startsWith("/") ? "" : "/"}${row.imageUrl}`
      : undefined;
    return {
      status: 200,
      title: seoTitle ? clampSeoTitleForShell(seoTitle) : `${row.name} — SubNation`,
      description: seoDescription
        ? // Mirrors the hydrated page's plain .slice(0, 160) — no price
          // suffix, no ellipsis — so both surfaces tell the same story.
          seoDescription.slice(0, 160)
        : buildShareDescription(row.description, lookup.displayPrice),
      // Prefer the row's canonical slug URL (numeric-id requests get
      // replaceState'd to it client-side — R117 F-4).
      canonical: `${origin}/product/${row.slug ?? slugOrId}`,
      ogImage,
    };
  }

  const staticMeta = SHELL_STATIC_ROUTE_META[norm];
  if (staticMeta) {
    return {
      status: 200,
      title: staticMeta.title,
      description: staticMeta.description,
      canonical: `${origin}${norm}`,
    };
  }

  if (SHELL_NOINDEX_RES.some((re) => re.test(norm))) {
    return { status: 200, canonical: null, robots: "noindex,follow" };
  }

  // Unknown public path: strip the canonical — a homepage canonical on
  // an unknown URL is a duplicate-content lie — and stamp noindex,follow
  // (R122 A7-P1-2): the SPA's client-side 404 owns the UX AND already
  // renders noindex for exactly these URLs; the raw shell keeping the
  // static index,follow contradicted it for every non-rendering engine
  // (an unbounded soft-404 crawl space). 200 stays — the SPA must boot
  // to render the 404 UI.
  return { status: 200, canonical: null, robots: "noindex,follow" };
}

if (frontendDist) {
  // Serve hashed assets with 1-year immutable cache (file names change on rebuild)
  app.use(
    "/assets",
    express.static(path.join(frontendDist, "assets"), {
      maxAge: "1y",
      immutable: true,
    }),
  );

  // Serve other static files (manifest, icons, robots.txt) with short cache
  app.use(
    express.static(frontendDist, {
      maxAge: "1h",
      // B12-F1 (R127-L9): index:false — the DEFAULT directory-index serve
      // made GET / resolve to index.html HERE, so the homepage bypassed
      // the per-route shell rewrite below (resolveSpaShellMeta never saw
      // "/" — its old "homepage shell is already correct" early return
      // was dead code for real traffic, and the raw baseline shipped
      // while every other route got its rewritten meta). Directory
      // requests now fall through to the SPA fallback, which owns ALL
      // html route-serving; the dist root is the only directory with an
      // index.html, so "/" is the one path whose behavior changes.
      // Direct file hits (manifest, icons, robots.txt, and /index.html —
      // the known A11-F6 canonical-consolidation item) are unaffected.
      index: false,
      // A11-F2 (R126-L6): redirect:false — the art directory
      // (frontend/public/products → dist/products) made express.static
      // 301 /products → /products/ on the CATALOG-looking bare path,
      // a +1-RTT double hop for every direct/external hit (and
      // 302+301 from http). With redirects off, a directory hit falls
      // through to the SPA fallback below, which serves the route
      // directly (same shell family /products/ already serves). Real
      // files under /products/<file> are unaffected — only the
      // no-slash DIRECTORY redirect changes.
      redirect: false,
      setHeaders(res, filePath) {
        // HTML, SW, and robots must never be cached aggressively.
        // R104 (AG11-3): registerSW.js (unhashed) joins the no-cache set —
        // a deploy that changed it could otherwise delay SW update
        // registration by up to an hour.
        if (
          filePath.endsWith(".html") ||
          filePath.endsWith("sw.js") ||
          filePath.endsWith("registerSW.js") ||
          filePath.endsWith("robots.txt")
        ) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          return;
        }
        // R104 (AG11-2b): product art (frontend/public/products/*.webp) and
        // the PWA icon set are effectively IMMUTABLE (filenames change on
        // replacement — r102's WebP conversion proved the workflow). They
        // rode the 1h default, forcing an hourly conditional-GET round
        // trip per asset per returning visitor; 30d + SWR matches the
        // service worker's CacheFirst window instead. Hashed workbox-*.js
        // chunks are safe to treat the same (content-hash names).
        if (
          filePath.includes("/products/") ||
          /pwa-.*\.png$/.test(filePath) ||
          /workbox-.*\.js$/.test(filePath)
        ) {
          res.setHeader("Cache-Control", "public, max-age=2592000, stale-while-revalidate=86400");
        }
      },
    }),
  );

  // ── A7 (round-94): dynamic share-card OG for link unfurlers ──────────
  // (The bot predicate lives in the exported isUnfurlerUserAgent /
  // isIndexerUserAgent below; server.ts's boot gate gates the SAME
  // unfurler set — single source.)
  //
  // The SPA fallback below serves the STATIC index.html for every GET —
  // so WhatsApp/Facebook/Telegram/Slack unfurlers (which do NOT run JS)
  // saw the generic site title/description/image for EVERY product link.
  // Product shares are the #1 organic channel in Libya; the card is now
  // real per-product data. Only UNFURLER bot UAs on /product/* get this
  // — humans AND indexing crawlers always get the SPA. Any failure falls
  // through to the SPA fallback (share cards degrade gracefully, the
  // page itself never breaks).
  app.use(async (req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
      next();
      return;
    }
    const match = /^\/product\/([^/]+)\/?$/.exec(req.path);
    const ua = String(req.headers["user-agent"] ?? "");
    // D2-F1 (R111): UNFURLERS ONLY. The R104 predicate also matched
    // googlebot/bingbot/yandexbot/…, so every crawl of /product/* got
    // this ~1KB JS-less card — no JSON-LD, no SPA boot → all
    // Product/FAQ/Breadcrumb structured data was invisible to Google.
    // Indexing crawlers now fall through to the SPA shell below; the
    // explicit isIndexerUserAgent exclusion keeps the split safe even
    // if a token is ever (mistakenly) added to both lists.
    if (!match || isIndexerUserAgent(ua) || !isUnfurlerUserAgent(ua)) {
      next();
      return;
    }
    try {
      const slugOrId = decodeURIComponent(match[1]);
      const numeric = /^\d+$/.test(slugOrId) ? Number.parseInt(slugOrId, 10) : null;
      // R122 (A3-P1): the cached lookup shared with the shell meta layer
      // (lookupProductForShareSurfaces) — this card path is unauthenticated
      // and outside every rate limiter, and a spoofed unfurler UA used to
      // mint a fresh uncached products query per request.
      const lookup = await lookupProductForShareSurfaces(slugOrId, numeric);
      if (!lookup.found || !lookup.row.isActive) {
        next();
        return;
      }
      const product = lookup.row;
      const esc = escapeHtmlAttr;
      const origin = appOrigin();
      const canonical = `${origin}/product/${slugOrId}`;
      // 110-F (R110 — 109-n P2): r103 absolutized og:image in MetaTags but
      // missed this no-JS surface — unfurlers (WhatsApp/Facebook, the
      // dominant share channel in Libya) drop RELATIVE image URLs, so
      // every shared product link unfurled cardless. Absolutize against
      // the SAME origin as the canonical above (APP_URL with the canonical
      // production-domain default — identical to the APP_ORIGIN resolution
      // in routes/seo.ts); DB rows carry site-relative /products/<slug>.webp,
      // already-absolute URLs (future CDN host) pass through untouched.
      const ogImage = product.imageUrl
        ? product.imageUrl.startsWith("http")
          ? product.imageUrl
          : `${origin}${product.imageUrl.startsWith("/") ? "" : "/"}${product.imageUrl}`
        : null;
      // R120-B3 (A7-F9 + A7-F17): prefer the live flash-sale price when
      // one is active (shareDisplayPrice — the same lib/pricing.ts stage
      // the catalog applies) and assemble the description inside display
      // limits (buildShareDescription). R122 (A3-P1): the display price
      // now rides the cached lookup (60 s TTL, admin-CRUD-bumped).
      const desc = buildShareDescription(product.description, lookup.displayPrice);
      const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${esc(product.name)} — SubNation</title>
<meta property="og:type" content="product">
<meta property="og:site_name" content="SubNation">
<meta property="og:title" content="${esc(product.name)} — SubNation">
<meta property="og:description" content="${esc(desc)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(product.name)} — SubNation">
<meta name="twitter:description" content="${esc(desc)}">
</head>
<body>متجرك الرقمي الأول في ليبيا — <a href="${esc(canonical)}">${esc(product.name)}</a></body>
</html>`;
      // Bots re-fetch sparingly; a short edge cache (Cloudflare in front)
      // collapses card-request bursts without ever serving a stale price
      // to humans (humans get the SPA through a different path).
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.setHeader("Content-Language", "ar");
      res.type("html").send(html);
    } catch {
      next();
    }
  });

  app.use(async (req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    // Secondary language signal for crawlers (lang+dir on <html> is the
    // primary; the response header is supplementary). The site is
    // currently Arabic-only — when an English locale ships, swap this
    // to derive from the request path / Accept-Language.
    res.setHeader("Content-Language", "ar");

    // R120-B3 (A7-F3/F7/F16): per-route shell rewrite — see the
    // SPA_SHELL_HTML block above for the full rationale. Degrade to the
    // untouched shell when the boot-time read failed or the /product/*
    // DB lookup hiccups: the SEO meta layer is best-effort and must
    // never take the page down.
    if (!SPA_SHELL_HTML) {
      res.sendFile(path.join(frontendDist, "index.html"));
      return;
    }
    let meta: SpaShellMeta;
    try {
      meta = await resolveSpaShellMeta(req.path, appOrigin());
    } catch {
      meta = { status: 200 };
    }
    res.status(meta.status).type("html").send(applySpaShellMeta(SPA_SHELL_HTML, meta));
  });
}

// ── Sentry Express error handler ────────────────────────────────────────────
//
// Per the official @sentry/node v10 skill, this MUST be registered after all
// routes and BEFORE any custom error-handling middleware. It captures the
// error to Sentry (5xx by default) with the full request context, then
// calls next(err) so our localized handler below still produces the
// Arabic-text user-facing response.
Sentry.setupExpressErrorHandler(app);

/**
 * R120-B3 (A8-F3): map a zod issue array to the MINIMAL client shape —
 * `{ path, code }` pairs only. The full issues (messages, received
 * values) are implementation detail: they used to ride the 400 body
 * verbatim and leak parser internals to any client. The complete detail
 * still reaches operators through the global error handler's
 * `logger.error({ err, … })` line. Exported for the 400-shape regression
 * test (no live route bubbles a ZodError today — every route safeParse's
 * and answers its own 400 — so the branch is pinned at unit level).
 */
export function zodIssuesToClient(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string }>,
): Array<{ path: string; code: string }> {
  return issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join("."),
    code: issue.code,
  }));
}

// ── Global error handler ──────────────────────────────────────────────────────
//
// NOTE: Sentry.setupExpressErrorHandler(app) above has ALREADY captured
// any error reaching this point with full request context + correlation_id.
// We therefore do NOT call captureException here — doing so would double-
// fire every 5xx event and double our Sentry quota burn. This handler is
// purely for shaping the user-facing Arabic error response.
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, req: { method: req.method, url: req.url } }, "Unhandled error");

  if (err instanceof SyntaxError && "status" in err && err.status === 400 && "body" in err) {
    res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  } else if (err instanceof ZodError) {
    // Round-3 (audit §5): zod 3's ZodError exposes `.errors` as a
    // deprecated getter, but matching the class explicitly is the
    // robust shape (zod 4 drops the alias) and avoids accidentally
    // catching arbitrary objects that happen to carry an `errors`
    // property.
    // R120-B3 (A8-F3): the full zod issue array (messages, received
    // values, paths) is implementation detail echoed to clients — map
    // to minimal { path, code } pairs via zodIssuesToClient (exported
    // so the R120 400-shape tests pin the client contract directly).
    // The complete issues stay in the pino log line above
    // (logger.error({ err, … }) carries the whole error object, issues
    // included). No frontend consumer reads details (getErrorMessage
    // keys off code/error/message only).
    res.status(400).json(
      createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA, {
        details: { issues: zodIssuesToClient(err.issues) },
      }),
    );
  } else if (
    err instanceof Error &&
    "errors" in err &&
    Array.isArray((err as { errors?: unknown }).errors)
  ) {
    // R120-B3 (A8-F3): the raw `.errors` passthrough minimized to a
    // count — same rationale as the ZodError branch above (full detail
    // already rode the pino log line at the top of this handler).
    const errorWithErrors = err as { errors?: unknown[] };
    res.status(400).json(
      createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA, {
        details: { count: errorWithErrors.errors?.length ?? 0 },
      }),
    );
  } else {
    res
      .status(500)
      .json(createErrorResponse("خطأ في الخادم. حاول مرة أخرى.", ErrorCode.INTERNAL_ERROR));
  }
});

/**
 * R111 (D2-F1): the R104 (AG6-2) share-bot predicate, SPLIT in two.
 *
 * The unified predicate matched indexing crawlers (googlebot, bingbot,
 * yandexbot, duckduckbot, baiduspider) alongside unfurlers, so every
 * crawl of /product/* received the ~1KB no-JS OG card instead of the
 * SPA shell — no JSON-LD (Product/FAQ/Breadcrumb), no renderable
 * content: all structured data on the money pages was invisible to
 * Google (its Web Rendering Service fetches the same URL and used to
 * get the same card). The two bot classes want OPPOSITE responses:
 *
 *   (a) UNFURLERS — chat/social link-preview fetchers that never
 *       execute JS. They alone get the DB-backed OG share card.
 *   (b) INDEXERS — search-engine crawlers that render JS (Googlebot
 *       via WRS) or index raw HTML. They get the normal SPA shell.
 *
 * Both regexes are case-insensitive over the raw User-Agent.
 * The unfurler list stays a STRICT allowlist — nothing gets the card
 * unless it is a known link-preview fetcher. The indexer list exists
 * so the card middleware can EXCLUDE crawlers explicitly (belt and
 * suspenders against future list drift); its tokens are chosen to
 * never match a normal browser UA — verified against real strings:
 * Googlebot Smartphone is
 * "… (Linux; Android 6.0.1…) … Chrome/120 … Mobile Safari/537.36
 * (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" —
 * matched by `googlebot`, while ordinary Chrome/Safari/Firefox UAs
 * contain none of these tokens.
 *
 * server.ts's boot gate imports the UNFURLER half so the gated set
 * can never drift from the set the OG-card route actually serves
 * (the DB-backed path) — single source, unchanged contract.
 */

/** (a) Link-unfurler bots — the ONLY user agents served the OG card. */
export function isUnfurlerUserAgent(userAgent: string): boolean {
  return /facebookexternalhit|whatsapp|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|pinterestbot|embedly|quora link preview|outbrain|vkshare|vkrobot|showyoubot|citizensinspector/i.test(
    userAgent,
  );
}

/**
 * (b) Indexing crawlers — always served the SPA shell (the OG card
 * would hide every product page from their index).
 */
export function isIndexerUserAgent(userAgent: string): boolean {
  return /googlebot|bingbot|yandexbot|duckduckbot|baiduspider|applebot|petalbot/i.test(userAgent);
}

export default app;
