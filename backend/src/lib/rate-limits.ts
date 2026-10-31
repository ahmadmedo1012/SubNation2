import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import type { Request } from "express";
import { verifyUserToken } from "./jwt";
import { createResilientRateLimitStore } from "./rate-limit-store";

/**
 * R136 (app.ts decomposition): the rate-limiting block moved here VERBATIM
 * from app.ts (:442-657) — every limiter keeps its exact windows, keys,
 * skips and Arabic message bodies. The three R136 money-intent limiters
 * (SEC scan F1) join the family at the bottom.
 */

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

export const apiLimiter = rateLimit({
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
    error: "تم تجاوز الحد الأقصى للطلبات. حاول مجدداً بعد دقيقة.",
    code: "RATE_LIMITED",
  },
  skip: (req) => {
    // Skip rate limiting for health checks.
    // NOTE (round-3 audit): this middleware is mounted at `/api`, so
    // `req.path` is mount-relative — the health routes live at
    // `/healthz*` (NOT "/health", which never matched and made Render
    // probes + admin polling burn the per-IP budget).
    // R134 (A1-F6): the dead entries are gone — `/health` (no such
    // route since the round-3 fix) and the `/assets/` + `/static/`
    // prefixes (assets are served at the root, never under /api) could
    // never match a mount-relative path. skip() now lists only paths
    // that exist under this mount.
    const path = req.path;
    if (path === "/healthz" || path.startsWith("/healthz/")) {
      return true;
    }
    // Skip when the caller has a verified user identity — the per-
    // user limiter handles them. Unauthenticated callers fall
    // through and are bound by the IP limit.
    return getRequestUserId(req) !== null;
  },
});

export const userLimiter = rateLimit({
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
    error: "تم تجاوز الحد الأقصى للطلبات لهذه الجلسة. حاول مجدداً بعد دقيقة.",
    code: "RATE_LIMITED",
  },
});

export const authLimiter = rateLimit({
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
export const whatsappStartAuthLimiter = rateLimit({
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
export const couponValidateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: makeRateLimitStore(),
  keyGenerator: (req) => {
    const userId = getRequestUserId(req);
    // SEC-92-04: express-rate-limit 8.4.1's ipKeyGenerator takes the IP
    // STRING (IPv4 passthrough, IPv6 collapsed to a /56 subnet — see
    // dist/index.mjs `function ipKeyGenerator(ip, ipv6SubNet = 56)`).
    // Passing it the raw req.ip string (a) satisfies the library's
    // ERR_ERL_KEY_GEN_IPV6 source validation (custom keyGenerators that
    // read req.ip must delegate to ipKeyGenerator) and (b) makes the
    // anonymous fallback rotation-proof: a /64-owning attacker no longer
    // gets a fresh 10/min budget per individual IPv6 address.
    return userId !== null ? `cu:${userId}` : `cu:ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
  },
  message: {
    error: "عدد كبير من محاولات التحقق من الكوبونات. حاول مجدداً بعد دقيقة.",
    code: "RATE_LIMITED",
  },
});

// ── R136 (SEC scan F1): money-submission intent limiters ──────────────────────
//
// POST /api/orders, POST /api/wallet/topups and POST /api/loyalty/
// convert-points previously rode ONLY the generic userLimiter
// (1200/min/user) — a compromised or scripted session could drive
// wallet topup attempts / order-creation retries / points-conversion
// hammering at wire speed, each landing on money-path validation,
// risk checks and (for topups) Telegram operator notifications.
// Legitimate submission cadence is single-digit attempts per minute
// (a checkout submit, one topup request, one conversion), so 12/min
// per user is far above honest usage while capping scripted bursts.
// Modeled on couponValidateLimiter above (per-user key via
// getRequestUserId; the anonymous fallback delegates to
// ipKeyGenerator per SEC-92-04; each limiter gets its own resilient
// store instance per ERR_ERL_STORE_REUSE). Mounted in app.ts on the
// three exact path prefixes, BEFORE the generic /api limiters — same
// mount contract as the coupon guard.
//
// Method scoping: `app.use("/api/orders", …)` is a PREFIX match that
// also sees GET /api/orders and GET /api/orders/:orderCode (order
// status polling), so each money-intent limiter skips non-POST
// requests — reads keep riding the generic limiters, only the
// money-submission intent burns the tight 12/min budget. (The coupon
// precedent needs no skip because /api/coupons/validate is
// POST-only.)
function createMoneyIntentLimiter(bucket: string, message: string) {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: makeRateLimitStore(),
    skip: (req) => req.method !== "POST",
    keyGenerator: (req) => {
      const userId = getRequestUserId(req);
      return userId !== null
        ? `${bucket}:u:${userId}`
        : `${bucket}:ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
    },
    message: { error: message, code: "RATE_LIMITED" },
  });
}

/** F1: POST /api/orders — order submission (checkout). */
export const ordersCreateLimiter = createMoneyIntentLimiter(
  "orders-create",
  "عدد كبير من محاولات إنشاء الطلبات. حاول مجدداً بعد دقيقة.",
);

/** F1: POST /api/wallet/topups — wallet topup requests. */
export const walletTopupCreateLimiter = createMoneyIntentLimiter(
  "wallet-topup",
  "عدد كبير من محاولات شحن المحفظة. حاول مجدداً بعد دقيقة.",
);

/** F1: POST /api/loyalty/convert-points — points→wallet conversion. */
export const loyaltyConvertPointsLimiter = createMoneyIntentLimiter(
  "loyalty-convert",
  "عدد كبير من محاولات تحويل النقاط. حاول مجدداً بعد دقيقة.",
);

// ── R191 (backend mobile contracts): the push-token registration guard ───────
//
// POST /api/notifications/push-tokens writes a device-registration row per
// call; a scripted client could otherwise mint unbounded rows under the
// blanket userLimiter (1200/min/user). Legitimate cadence is one
// registration per app install + rare re-registrations, so 20/15min per IP
// (the whatsappStartAuthLimiter CGNAT-friendly shape — Libya's mobile
// carriers share egress IPs) is far above honest usage. Mounted in app.ts
// path-specific + POST-only, the money-intent limiter mount contract (reads
// keep riding the generic limiters; DELETE/GET of the same path too).
export const pushTokenRegisterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: makeRateLimitStore(),
  skipFailedRequests: false,
  skipSuccessfulRequests: false,
  skip: (req) => req.method !== "POST",
  message: {
    error: "عدد كبير من محاولات تسجيل الجهاز. حاول مجدداً بعد 15 دقيقة.",
    code: "RATE_LIMITED",
  },
});

// ── R158 (B#6): the support-route per-user limiters ───────────────────────────
//
// V3-C5a: ticket-creation spam guard — the global userLimiter (1200/min)
// was the only ceiling on this route; 5 tickets/hour/user is far above
// any human cadence. Keyed by userId (requireUser has already run when
// the limiter fires), so the express-rate-limit IPv6 keyGenerator
// validation does not apply.
//
// Moved VERBATIM from routes/support.ts (R158 organization round): same
// window, limit, key and Arabic message body — including the DELIBERATE
// absence of a `store` (the in-memory default the route shipped with;
// every limiter mounted in app.ts gets a resilient Redis store instead).
// SEC-92-07: per-user reply limiter, mirroring ticketCreateLimiter —
// 30 replies/hour/user is two orders of magnitude above any honest
// conversation cadence while capping the storage-DoS amplifier (each
// reply is a ticket_replies row + a status update).
import type { AuthenticatedRequest } from "../middlewares/requireUser";

export const ticketCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  // R158 (B#6): the family chrome — every limiter in this home emits
  // the draft-8 standard headers; the route-file locals the definitions
  // moved from predate that contract. Headers only, no limiting change.
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `ticket:${(req as AuthenticatedRequest).userId}`,
  message: {
    error:
      "لقد أنشأت عدداً كافياً من التذاكر في هذه الساعة. انتظر قليلاً أو أضف رداً على تذكرة قائمة.",
    code: "RATE_LIMITED",
  },
});

export const ticketReplyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `ticket-reply:${(req as AuthenticatedRequest).userId}`,
  message: {
    error: "لقد أرسلت عدداً كافياً من الردود في هذه الساعة. انتظر قليلاً قبل المحاولة مجدداً.",
    code: "RATE_LIMITED",
  },
});
