import compression from "compression";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import express from "express";
import pinoHttp from "pino-http";
import * as Sentry from "@sentry/node";
import { getCorrelationId } from "./lib/correlation";
import { bodyParserRecovery } from "./lib/body-parser-recovery";
import { logger } from "./lib/logger";
import { ErrorCode, createErrorResponse } from "./lib/errors";
import { getConfiguredOrigins, warnLegacySplitOriginEnvAtBoot } from "./lib/origins";
import {
  createCorsCredentialsHeader,
  createCorsMiddleware,
  createCorsOriginGate,
} from "./lib/cors-gate";
import { createHelmetMiddleware, permissionsPolicyMiddleware } from "./lib/helmet-config";
import {
  apiLimiter,
  authLimiter,
  couponValidateLimiter,
  loyaltyConvertPointsLimiter,
  ordersCreateLimiter,
  userLimiter,
  walletTopupCreateLimiter,
  whatsappStartAuthLimiter,
} from "./lib/rate-limits";
import { globalErrorHandler } from "./lib/error-handler";
import { mountSpaShellRoutes } from "./lib/spa-shell";
import { cloudflareClientIp } from "./middlewares/cloudflareClientIp";
import { correlationMiddleware } from "./middlewares/correlation";
import { instrumentationIsolation } from "./middlewares/instrumentation-isolation";
import { metricsMiddleware } from "./middlewares/metrics";
import router from "./routes";
import { seoRouter } from "./routes/seo";
// R136 (app.ts decomposition): lib/csrf is imported AFTER the route tree so
// its SEC-92-01 boot assertion evaluates with the whole route tree already
// loaded — the exact module-eval order of the pre-R136 app.ts, where the
// assertion sat in the module BODY below the imports. Importing app.ts
// therefore still rejects on the fail-fast path (src/__tests__/
// csrf-gate.test.ts §3 pins that contract).
import { csrfAllowedOrigins, createCsrfGate } from "./lib/csrf";

// ── R136 re-export shim (the R135 contract) ──────────────────────────────────
// Everything the test files + server.ts imported off "../app" before the
// decomposition keeps its name and export shape here — NO existing test
// needed an edit. The implementations live in the lib/ extracts noted
// per name.
//
// R158 (B#5): re-verified the whole shim with a repo-wide grep. LIVE
// importers, all through `await import("../app")` + property access in
// the gate/rewrite suites: createCsrfGate (csrf-gate.test.ts),
// createCorsOriginGate + createCorsCredentialsHeader (cors-origin-gate.
// test.ts), zodIssuesToClient + applySpaShellMeta (spa-shell-rewrite.
// test.ts), isIndexerUserAgent (share-card-bot-split.test.ts),
// shellCommentsBalance (spa-shell-comment-guard.test.ts), plus the
// static-import surface: server.ts (isUnfurlerUserAgent) and the
// route-parity suites (SHELL_*_META). resolveSpaShellMeta and the
// SpaShellMeta type re-export had ZERO importers (the shell consumes
// its own lib/spa-shell definitions directly) and are deleted.
export { createCsrfGate } from "./lib/csrf";
export { createCorsCredentialsHeader, createCorsOriginGate } from "./lib/cors-gate";
export { zodIssuesToClient } from "./lib/error-handler";
export {
  applySpaShellMeta,
  isIndexerUserAgent,
  isUnfurlerUserAgent,
  shellCommentsBalance,
  SHELL_CATEGORY_META,
  SHELL_HOME_META,
  SHELL_STATIC_ROUTE_META,
} from "./lib/spa-shell";

// A7-2 (R116): boot-time hygiene warn on split-era origin env vars
// (VERCEL_FRONTEND_ORIGIN / FRONTEND_ORIGINS). f10bb9b accidentally
// deleted this call together with the www-redirect removal — restored
// in R117 (A1-P3/A3-P5): the folding still happens in
// getConfiguredOrigins(), so the boot signal must survive with it.
warnLegacySplitOriginEnvAtBoot();

const app = express();

// ── CORS / Allowed Origins ────────────────────────────────────────────────────
// In production restrict to APP_ORIGINS; in dev allow all origins.
// (The gate/credentials/cors middlewares themselves live in
// lib/cors-gate.ts — R136 decomposition.)
const allowedOrigins = getConfiguredOrigins();
const isProduction = process.env.NODE_ENV === "production";

// ── Security Headers ──────────────────────────────────────────────────────────
// Permissions-Policy + helmet CSP/HSTS/COOP — lib/helmet-config.ts (R136
// decomposition; carries the R136 CSP tightenings: imgSrc's blanket https:
// dropped, upgrade-insecure-requests left to helmet's default).
app.use(permissionsPolicyMiddleware);
app.use(createHelmetMiddleware(isProduction, allowedOrigins));

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
// lib/cors-gate.ts (R136): origin gate → credentials header → cors().
app.use(createCorsOriginGate(allowedOrigins, isProduction));
app.use(createCorsCredentialsHeader());
app.use(createCorsMiddleware(allowedOrigins));

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
// Additive only — no behaviour change to the security-headers configuration
// (lib/helmet-config.ts above).
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
// lib/csrf.ts (R136): the gate factory + the SEC-92-01 boot assertion (which
// already ran at THIS module's import, above — importing app.ts with an empty
// production allow-list rejects, same as ever).
app.use(createCsrfGate(csrfAllowedOrigins, isProduction));

// ── Routes ────────────────────────────────────────────────────────────────────
// The limiter instances live in lib/rate-limits.ts (R136 decomposition);
// the mount block below is byte-equivalent to the pre-R136 one, plus the
// three R136 money-intent mounts.
//
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
// R136 (SEC scan F1): money-submission intent limiters — POST /api/orders,
// POST /api/wallet/topups and POST /api/loyalty/convert-points previously
// rode ONLY the generic userLimiter (1200/min/user); each now carries a
// tight 12/min per-user budget (see lib/rate-limits.ts for the full
// rationale + the POST-only skip that keeps order-status reads on the
// generic limiters). Mounted path-specific and BEFORE the generic /api
// limiters — the same mount contract as the coupon guard above. The
// route files themselves are untouched: these mounts wrap them.
app.use("/api/orders", ordersCreateLimiter);
app.use("/api/wallet/topups", walletTopupCreateLimiter);
app.use("/api/loyalty/convert-points", loyaltyConvertPointsLimiter);
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

// R176 (SEO): /category/productivity is retired but still records GSC
// impressions (24 in the last 28 days; 122 / 9 clicks in the prior window).
// Its catalog (Windows/Office licensing) lives under /category/software —
// consolidate the old URL there instead of leaving it a 404. This route
// must sit before mountSpaShellRoutes, whose category branch owns 404s.
app.get("/category/productivity", (_req, res) => res.redirect(301, "/category/software"));

// ── SPA shell: static assets + per-route SEO meta + OG cards + fallback ──────
// lib/spa-shell.ts (R136 decomposition) — the shell snapshot, the meta
// constants + rewriters (now with the R136 PERF #10 memoization), the
// immutable-asset/static mounts with their cache headers, the unfurler
// OG-card middleware and the SPA fallback. Mounted HERE at the exact
// position the inline block used to occupy; no-op without a dist.
mountSpaShellRoutes(app);

// ── Sentry Express error handler ────────────────────────────────────────────
//
// Per the official @sentry/node v10 skill, this MUST be registered after all
// routes and BEFORE any custom error-handling middleware. It captures the
// error to Sentry (5xx by default) with the full request context, then
// calls next(err) so our localized handler below still produces the
// Arabic-text user-facing response.
Sentry.setupExpressErrorHandler(app);

// ── Global error handler ──────────────────────────────────────────────────────
// lib/error-handler.ts (R136): purely shapes the user-facing Arabic error
// response — Sentry's handler above already captured the event (no double
// capture here, by design).
app.use(globalErrorHandler);

export default app;
