import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import helmet from "helmet";
import { existsSync } from "node:fs";
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
import { cloudflareClientIp } from "./middlewares/cloudflareClientIp";
import { correlationMiddleware } from "./middlewares/correlation";
import { instrumentationIsolation } from "./middlewares/instrumentation-isolation";
import { metricsMiddleware } from "./middlewares/metrics";
import router from "./routes";
import seoRouter from "./routes/seo";
import { ErrorCode, createErrorResponse } from "./lib/errors";
import { getConfiguredOrigins, warnLegacySplitOriginEnvAtBoot } from "./lib/origins";

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
// A7-2 (R116): boot-time warn when split-era origin vars (the retired
// Render/Vercel stack) ride along the single-origin Coolify shape — an
// env block copied from an old runbook silently re-arms the cross-origin
// cookie class. Names only; never a throw.
warnLegacySplitOriginEnvAtBoot();
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
const CANONICAL_HOST = "subnation.ly";
// subnation2.onrender.com was the API origin of the retired Vercel→Render
// split — in that era it had to stay unredirected so API and Socket.IO
// traffic kept working. The split is gone (Render suspended, rollback-only):
// the hostname stays OUT of LEGACY_HOSTS so a Render rollback (if ever
// exercised) keeps working — its health probes hit the onrender hostname
// and must never receive a 301.
const LEGACY_HOSTS = new Set(["www.subnation.ly"]);
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();
  if (req.path === "/api/healthz" || req.path.startsWith("/api/healthz/")) return next();

  const hostname = (req.hostname || "").toLowerCase();
  if (LEGACY_HOSTS.has(hostname)) {
    res.set("Cache-Control", "max-age=86400");
    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  }
  return next();
});

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
app.use(
  cors({
    // Plain list form — disallowed origins never reach this middleware
    // (the gate above 403'd them), and an absent Origin header never
    // triggers CORS headers (server-to-server/same-origin pass-through).
    // Empty list in dev reflects any origin (previous behaviour).
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
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
  res.status(404).json(createErrorResponse("المسار غير موجود", ErrorCode.NOT_FOUND));
});

// ── SEO routes (root-level) ──────────────────────────────────────────────────
// /robots.txt and /sitemap.xml live at the app root, not under /api, so search
// engines crawling the apex find them where they expect.
app.use(seoRouter);

const frontendDist = resolveFrontendDist();

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
      const [product] = await db
        .select({
          name: productsTable.name,
          description: productsTable.description,
          imageUrl: productsTable.imageUrl,
          price: productsTable.price,
          isActive: productsTable.isActive,
        })
        .from(productsTable)
        .where(
          and(
            numeric !== null ? eq(productsTable.id, numeric) : eq(productsTable.slug, slugOrId),
            // D2-F4 (R111): mirror the detail-route WHERE — an archived
            // row can never render a share card, even if a PATCH flips
            // is_active=true back on it (the PATCH-side guard is a
            // sibling fix; live dump today: archived ⇒ is_active=false,
            // so this is latent-hardening, not a live leak).
            eq(productsTable.isArchived, false),
          ),
        )
        .limit(1);
      if (!product || !product.isActive) {
        next();
        return;
      }
      const esc = (s: string) =>
        s
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const origin = (process.env.APP_URL || "https://subnation.ly").replace(/\/$/, "");
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
      const desc =
        (product.description ?? "اشتراك رقمي أصلي بالدينار الليبي من SubNation")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180) + ` — السعر ${product.price} د.ل`;
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

  app.use((req, res, next) => {
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
    res.sendFile(path.join(frontendDist, "index.html"));
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
    res.status(400).json(
      createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA, {
        details: { issues: err.issues },
      }),
    );
  } else if (
    err instanceof Error &&
    "errors" in err &&
    Array.isArray((err as { errors?: unknown }).errors)
  ) {
    const errorWithErrors = err as { errors?: unknown[] };
    res.status(400).json(
      createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA, {
        details: errorWithErrors.errors,
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
