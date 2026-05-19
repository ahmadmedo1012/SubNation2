import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import pinoHttp from "pino-http";
import RedisStore from "rate-limit-redis";
import * as Sentry from "@sentry/node";
import { getCorrelationId } from "./lib/correlation";
import { bodyParserRecovery } from "./lib/body-parser-recovery";
import { logger } from "./lib/logger";
import { verifyUserToken } from "./lib/jwt";
import { getRedisClient } from "./lib/redis-client";
import { cloudflareClientIp } from "./middlewares/cloudflareClientIp";
import { correlationMiddleware } from "./middlewares/correlation";
import { instrumentationIsolation } from "./middlewares/instrumentation-isolation";
import { metricsMiddleware } from "./middlewares/metrics";
import router from "./routes";
import seoRouter from "./routes/seo";

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
const allowedOrigins = process.env.APP_ORIGINS
  ? process.env.APP_ORIGINS.split(",")
      .map((d) => d.trim())
      .filter(Boolean)
  : [];
const isProduction = process.env.NODE_ENV === "production";
const csrfAllowedOrigins = (process.env.APP_ORIGINS || process.env.APP_URL || "")
  .split(",")
  .map((o) => o.trim());

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
        ],
        // Do NOT set scriptSrcAttr to 'none' — Firebase SDK injects inline
        // event handlers in the popup/iframe auth flow.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
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
      maxAge: 31536000,
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
// When the request flows through Cloudflare (→ Render → app), Express's
// `trust proxy = 1` resolves req.ip to Cloudflare's edge IP, not the
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
const LEGACY_HOSTS = new Set(["www.subnation.ly", "subnation2.onrender.com"]);
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
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin (no origin header) and server-to-server calls
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true); // dev: allow all
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("CORS: origin not allowed"));
    },
    credentials: true,
  }),
);

// ── Redis singleton (initialised in server.ts before app.listen) ─────────────
const redisClient = getRedisClient();

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
const rateLimiterStore = redisClient
  ? new RedisStore({
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
      prefix: "rl:",
    })
  : undefined;

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
function getRequestUserId(req: Request): number | null {
  const token =
    req.cookies?.auth_token ??
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined);
  if (!token || token === "__cookie_session__") return null;
  const payload = verifyUserToken(token);
  return payload?.userId ?? null;
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
  store: rateLimiterStore,
  skip: (req) => {
    // Skip rate limiting for health checks and static assets
    const path = req.path;
    if (path === "/health" || path.startsWith("/assets/") || path.startsWith("/static/")) {
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
  store: rateLimiterStore,
  // Inverse skip of apiLimiter — only authenticated traffic.
  skip: (req) => getRequestUserId(req) === null,
  keyGenerator: (req) => {
    const userId = getRequestUserId(req);
    return `u:${userId ?? "anon"}`;
  },
  message: {
    error: "تم تجاوز الحد الأقصى للطلبات لهذه الجلسة. حاول مرة أخرى بعد دقيقة.",
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: rateLimiterStore,
  skipFailedRequests: false,
  skipSuccessfulRequests: true,
  message: { error: "عدد كبير من المحاولات. حاول مجدداً بعد 15 دقيقة." },
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
          url === "/api/cwv"
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
// Validate Origin/Referer headers for POST/PUT/DELETE/PATCH requests
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // Skip CSRF check ONLY for endpoints where the browser legitimately omits
    // Origin/Referer:
    //   - /api/auth/firebase/session, /api/auth/firebase/refresh: Firebase
    //     popup auth round-trips can land here without a valid Referer in
    //     some COOP-isolated configurations. The ID-token signature is the
    //     real auth; Origin is belt+suspenders.
    //   - /api/cwv: navigator.sendBeacon does not set Origin on most browsers.
    //   - /api/webhook/*: third-party callbacks (Telegram, Stripe-style) sign
    //     their bodies; Origin from a different host is expected.
    //   - /health: ops probes from outside the app.
    //
    // Login / register / forgot-password / reset-password / change-password /
    // toggle-password-login / sessions / logout / providers — ALL inside the
    // CSRF gate. SameSite=strict cookies remain the second layer.
    const skipPaths = [
      "/api/auth/firebase/session",
      "/api/auth/firebase/refresh",
      "/api/cwv",
      "/api/webhook",
      "/health",
    ];
    if (skipPaths.some((path) => req.path.startsWith(path))) {
      return next();
    }

    // In production, validate Origin or Referer
    if (process.env.NODE_ENV === "production" && csrfAllowedOrigins.length > 0) {
      const isValid =
        (origin &&
          csrfAllowedOrigins.some((allowed) => origin === allowed || origin.startsWith(allowed))) ||
        (referer && csrfAllowedOrigins.some((allowed) => referer.startsWith(allowed)));

      if (!isValid) {
        logger.warn({ origin, referer, path: req.path }, "CSRF validation failed");
        return res.status(403).json({ error: "طلب غير مصرح" });
      }
    }
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
// Auth limiter applies to login/register only (NOT /me — it's polled frequently)
app.use("/api/auth/firebase/session", authLimiter);
app.use("/api", apiLimiter);
app.use("/api", userLimiter);
app.use("/api", router);

// JSON 404 for unmatched /api/* routes (must come AFTER all /api routers, BEFORE static)
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "المسار غير موجود", code: "NOT_FOUND" });
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
        // HTML, SW, and robots must never be cached aggressively
        if (
          filePath.endsWith(".html") ||
          filePath.endsWith("sw.js") ||
          filePath.endsWith("robots.txt")
        ) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    }),
  );

  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
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
    res.status(400).json({ error: "بيانات غير صالحة" });
  } else if ("errors" in err) {
    const errorWithErrors = err as { errors?: unknown[] };
    res.status(400).json({ error: "بيانات غير صالحة", details: errorWithErrors.errors });
  } else {
    res.status(500).json({ error: "خطأ في الخادم. حاول مرة أخرى." });
  }
});

export default app;
