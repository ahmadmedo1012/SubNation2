/**
 * Auth Provider Settings Routes
 *
 * Public (mount at /auth):
 *   GET  /providers                    → /api/auth/providers
 *   POST /telegram                     → verify Telegram widget data (callback mode)
 *   GET  /telegram/callback            → verify Telegram widget data (redirect mode,
 *                                          for mobile / in-app browsers where popups
 *                                          + cross-window postMessage are blocked)
 *   GET  /telegram/oidc/login          → R154: start the modern OIDC Authorization
 *                                          Code Flow with PKCE (302 to
 *                                          oauth.telegram.org)
 *   GET  /telegram/oidc/callback       → R154: complete the OIDC flow (state +
 *                                          PKCE + nonce + RS256/JWKS ID-token
 *                                          validation) and mint the session
 *
 * Admin (mount at /admin/settings):
 *   GET   /auth              → list all providers (masked secrets)
 *   PATCH /auth/:id          → update provider config
 *
 * R126-L9 (A3 split plan E): the business logic moved out — the
 * system_settings persistence + masking live in
 * services/auth-settings-store.ts, the Telegram login flows in
 * services/telegram-auth-flow.ts (legacy) + services/telegram-oidc-flow.ts
 * (R154 modern OIDC), and the B1-1 callback CSRF gate in
 * lib/telegram-callback.ts. This file owns transport only: provider
 * metadata, the cache key/middleware, cookies, redirects, and response
 * envelopes. Re-exports below keep the module's import surface
 * (routers + isTelegramCallbackSameOrigin + the provider types)
 * byte-compatible for routes/index.ts and the pinning tests.
 */

import * as Sentry from "@sentry/node";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { writeAuditLog } from "../lib/audit";
import { stringParam } from "../lib/http";
import { getClientInfo } from "../lib/auth-activity";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import {
  getWhatsAppGatewayReadiness,
  isWhatsAppGatewayConfigured,
} from "../services/openwa.service";
import { getAuthCookieOptions } from "../lib/cookie-options";
import { cacheDelete, cacheWrap } from "../lib/cache";
import {
  buildMaskedConfig,
  getAllAuthSettings,
  getSetting,
  upsertSetting,
  type ProviderField,
  type ProviderMeta,
} from "../services/auth-settings-store";
import { handleTelegramAuth, handleTelegramWebAppAuth } from "../services/telegram-auth-flow";
import { completeTelegramOidcLogin, startTelegramOidcFlow } from "../services/telegram-oidc-flow";
import {
  TELEGRAM_CALLBACK_CSRF_ERROR,
  isTelegramCallbackSameOrigin,
  telegramCallbackAllowedOrigins,
} from "../lib/telegram-callback";

// A3 split plan E (R126-L9): the moved predicate stays importable from
// THIS module — routes/index.ts and the pinning test
// (telegram-callback-csrf.test.ts) keep resolving it here.
// (R127-B2 §B.3: the sibling ProviderField/ProviderMeta TYPE re-export
// had zero importers — the types are imported directly from
// auth-settings-store where consumed — and was deleted.)
export { isTelegramCallbackSameOrigin } from "../lib/telegram-callback";

// ── Provider metadata ──────────────────────────────────────────────────────────

// R127-B2 (§B.3): the R126-L9 split left `export` on this module-private
// table — keyword dropped; zero behavior change.
const PROVIDERS: ProviderMeta[] = [
  {
    id: "google",
    label: "Google",
    color: "#4285F4",
    icon: "google",
    auth_type: "client_side",
    description: "تسجيل الدخول عبر Firebase Google (مستحسن)",
    setup_url: "https://console.firebase.google.com/project/_/authentication/providers",
    fields: [
      {
        key: "firebase_enabled",
        label: "Firebase مفعّل",
        isSecret: false,
        placeholder: "true/false",
      },
    ],
  },
  {
    id: "telegram",
    label: "Telegram",
    color: "#2AABEE",
    icon: "telegram",
    // R154 (P2): auth_type stays "widget" for the legacy fallback; the
    // public providers response carries `oidc_enabled` so the SPA switches
    // transports without a new auth_type enum.
    auth_type: "widget",
    description: "تسجيل الدخول عبر Telegram",
    setup_url: "https://core.telegram.org/bots/telegram-login",
    fields: [
      {
        key: "bot_username",
        label: "اسم البوت",
        isSecret: false,
        placeholder: "MyAppBot (بدون @)",
      },
      {
        key: "bot_token",
        label: "Bot Token",
        isSecret: true,
        placeholder: "1234567890:ABC-DEF...",
      },
      {
        key: "oidc_client_id",
        label: "OIDC Client ID (BotFather — Login Widget)",
        isSecret: false,
        optional: true,
        placeholder: "1234567890",
      },
      {
        key: "oidc_client_secret",
        label: "OIDC Client Secret (BotFather — Login Widget)",
        isSecret: true,
        optional: true,
        placeholder: "الصق القيمة من BotFather — لا تُعرض بعد الحفظ",
      },
    ],
  },
  {
    id: "apple",
    label: "Apple",
    color: "#000000",
    icon: "apple",
    auth_type: "client_side",
    description: "Sign In with Apple — يتطلب Apple Developer Program",
    setup_url: "https://developer.apple.com/account/resources/identifiers",
    fields: [
      {
        key: "client_id",
        label: "Services ID (Bundle ID)",
        isSecret: false,
        placeholder: "com.yourapp.signin",
      },
      { key: "team_id", label: "Team ID", isSecret: false, placeholder: "ABCD1234EF" },
      { key: "key_id", label: "Key ID", isSecret: false, placeholder: "ABCDE12345" },
      {
        key: "private_key",
        label: "Private Key (.p8)",
        isSecret: true,
        placeholder: "[REDACTED:ssh_private_key]\n...",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTER  (mount at /auth in index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export const authProviderPublicRouter = Router();

/**
 * 98-F3 (R98-A4 P3-3 — mirror of R97-02): the raw user JWT is no longer
 * returned in the Telegram mint response bodies (POST /telegram,
 * POST /telegram/webapp). The httpOnly `auth_token` cookie each sets is
 * the sole session transport (requireUser reads the cookie first); the
 * body `token` field is kept as this SENTINEL so the SPA's success-check
 * (`if (!json.token)`) and `setToken(...)` keep working — the value is
 * truthy but carries no credential, and the frontend's auth-token-holder
 * filters it out of Authorization headers by exact string match. Same
 * value the boot probe and the other mint routes use (routes/auth.ts,
 * routes/auth-whatsapp.ts). The redirect-mode GET /telegram/callback
 * already ships no token at all (F-010).
 */
const COOKIE_SESSION_SENTINEL = "__cookie_session__";

/**
 * Cache key for the public providers payload (60 s cacheWrap window).
 * R119-B2: the admin PATCH below invalidates this key after every
 * upsertSetting — keep the two references in sync (single constant so a
 * rename can't drift them apart).
 */
const AUTH_PROVIDERS_CACHE_KEY = "auth:providers:settings";

// GET /api/auth/providers
//
// R119-B2 (A5 F-3) — TTL composition of this header, spelled out so the
// next editor doesn't have to re-derive it. The response is served from
// the 60 s cacheWrap window below (origin-side) AND the SPA caches the
// providers module for 60 s (client-side), so today's composed worst
// case for a config change to reach the login page is ≈ 120 s — with
// Cloudflare in DNS-only mode nothing sits between the two. If the edge
// ever goes PROXIED, s-maxage=60 lets Cloudflare answer from cache for
// another 60 s and stale-while-revalidate=300 keeps serving the stale
// body while it revalidates in the background, so the operator-visible
// window would stretch past 2 min. The PATCH invalidation added in
// R119-B2 (A3 F-1) bounds the ORIGIN leg of that staleness: the moment
// an admin save lands, the next cacheWrap read misses and reloads fresh
// — only the SPA's 60 s module cache (and, if proxied, the edge SWR
// window) can still show the old provider buttons after that.
const authProviderCache = (_req: Request, res: Response, next: NextFunction) => {
  res.set("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  next();
};

authProviderPublicRouter.get("/providers", authProviderCache, async (_req, res) => {
  const settings = await cacheWrap(AUTH_PROVIDERS_CACHE_KEY, 60, getAllAuthSettings);

  // Google: fall back to env var if not configured in DB
  const googleConfig = { ...(settings["auth.google"] ?? {}) };
  if (!googleConfig.client_id && process.env.GOOGLE_CLIENT_ID) {
    googleConfig.enabled = true;
    googleConfig.client_id = process.env.GOOGLE_CLIENT_ID;
  }

  // Firebase Google: always include if Firebase is enabled (regardless of GOOGLE_CLIENT_ID)
  const firebaseEnabled = process.env.FIREBASE_AUTH_ENABLED === "true";

  const providers = PROVIDERS.map((meta) => {
    const cfg = meta.id === "google" ? googleConfig : (settings[`auth.${meta.id}`] ?? {});
    const enabled = !!cfg.enabled;
    // "has_config" = at least one non-secret public field is filled
    const hasConfig = meta.fields.some((f) => !f.isSecret && !!cfg[f.key]);

    // Telegram needs a numeric bot_id (the prefix of bot_token) to
    // build the redirect URL on the client. Parse it server-side so
    // we never expose the full bot_token to the browser. The full
    // token stays in the database and is only used by the verify
    // handler to compute the HMAC.
    let bot_id: string | null = null;
    if (meta.id === "telegram" && typeof cfg.bot_token === "string") {
      const prefix = cfg.bot_token.split(":")[0];
      if (/^\d{6,}$/.test(prefix)) bot_id = prefix;
    }

    // R154 (P2): `oidc_enabled` — the modern OIDC transport is live ONLY
    // when the operator configured BotFather's Client ID + Client Secret
    // (a DIFFERENT credential pair from the Bot API token). The SPA
    // switches the Telegram button to /api/auth/telegram/oidc/login when
    // this is true; the legacy widget flow remains the fallback.
    let oidc_enabled = false;
    if (meta.id === "telegram") {
      oidc_enabled =
        !!cfg.enabled &&
        typeof cfg.oidc_client_id === "string" &&
        cfg.oidc_client_id.trim().length > 0 &&
        typeof cfg.oidc_client_secret === "string" &&
        cfg.oidc_client_secret.trim().length > 0;
    }

    return {
      id: meta.id,
      label: meta.label,
      color: meta.color,
      icon: meta.icon,
      auth_type: meta.auth_type,
      enabled,
      has_config: hasConfig,
      // non-secret fields only
      client_id: cfg.client_id ?? null,
      app_id: cfg.app_id ?? null,
      bot_username: cfg.bot_username ?? null,
      bot_id,
      oidc_enabled,
    };
  }).filter((p) => {
    if (!p.enabled || !p.has_config) return false;
    // Telegram is only usable when BOTH bot_username AND a derivable
    // bot_id are present. Skip the entry otherwise — surfacing it
    // would render a button that 404s on click.
    if (p.id === "telegram" && (!p.bot_username || !p.bot_id)) return false;
    return true;
  });

  // Add Firebase Google provider if Firebase is enabled (even without GOOGLE_CLIENT_ID)
  if (firebaseEnabled) {
    const firebaseGoogle = providers.find((p) => p.id === "google");
    if (!firebaseGoogle) {
      providers.push({
        id: "google",
        label: "Google",
        color: "#4285F4",
        icon: "google",
        auth_type: "client_side",
        enabled: true,
        has_config: true,
        client_id: null,
        app_id: null,
        bot_username: null,
        bot_id: null,
        oidc_enabled: false,
      });
    }
  }

  // r95 (honest UX): `whatsapp_enabled` stays config-only (backward
  // compat — button visibility). `whatsapp_status` adds the LIVE
  // pairing state from a 30s-cached gateway probe so clients can hint
  // "قيد الربط مؤقتاً" instead of letting the user fail at code-send.
  // Status strings are the OpenWA lifecycle values (ready/qr_ready/…)
  // or null when the probe fails — never a fabricated "ready".
  //
  // 96-F1 (R96-A4 §1.3C): a paired-but-settling session (the post-link
  // settle / warm-up window behind the "Waiting for this message"
  // incident) now reports the dedicated "settling" value so the login
  // hint can tell the truth during the window. Additive — older clients
  // treat it as just another not-"ready" status.
  //
  // 97-F3 (R97-WA-08 contract, verified — NO server-side softening):
  // "failed" (pairing revoked — permanent until an operator re-pairs)
  // and "qr_ready" (pairing pending a scan) are passed through VERBATIM
  // below. The only values this route ever synthesizes are "ready"
  // (settled + warm) and "settling" (inside the gate window); everything
  // else is the raw gateway lifecycle status (or null when the gateway
  // is unreachable). The FRONTEND owns honest per-status copy (agent
  // 97-F5): failed renders «القناة غير مرتبطة حاليًا — استخدم
  // Google/Telegram» instead of the misleading "قيد الربط مؤقتاً" hint —
  // the backend must never hide a dead channel behind "temporary" wording.
  const readiness = await getWhatsAppGatewayReadiness();

  return res.json({
    providers,
    // Boolean only — never exposes the API key. Clients gate the
    // <WhatsAppPhoneSignIn /> render on this flag.
    whatsapp_enabled: isWhatsAppGatewayConfigured(),
    whatsapp_status: readiness.ready ? "ready" : readiness.settling ? "settling" : readiness.status,
  });
});

// ── Telegram Login (legacy widget) ─────────────────────────────────────────────
//
// Spec: https://core.telegram.org/widgets/login
//
// Two transports are supported, BOTH using the same hash verification:
//
//   POST /api/auth/telegram          (callback mode — desktop, iframe-ok)
//   GET  /api/auth/telegram/callback (redirect mode — mobile, in-app browsers,
//                                      WebView, COOP-strict origins)
//
// Owner setup, in @BotFather:  /setdomain → bot → "subnation.ly"
// Owner setup, in admin UI:    /admin/settings → Telegram → bot_username +
//                                                 bot_token + enable
//
// The hash-verification algorithm itself lives in lib/telegram-auth.ts so
// it can be unit-tested in isolation without standing up Express + the DB.
// The replay-hash store lives in lib/telegram-replay.ts (93-A1 S3) — one
// implementation shared by the widget and Mini App flows, with per-flow
// TTLs that are never shorter than the freshness window they guard and a
// bounded in-memory fallback for the no-Redis production shape.
// The user find-or-create + session-mint flows live in
// services/telegram-auth-flow.ts (R126-L9 split) — the routes below own
// transport only.

// POST /api/auth/telegram (callback mode — primary, called from the
//                          frontend telegram-callback page after it
//                          decodes the redirect fragment)
authProviderPublicRouter.post("/telegram", async (req, res) => {
  try {
    const result = await handleTelegramAuth(
      (req.body as Record<string, unknown>) ?? {},
      getClientInfo(req),
    );
    if (!result.ok) {
      // Round-3 envelope drift fix: `reason` → `code` (keep `reason` for
      // backward compatibility with any client reading the old field).
      // R125-I6 (A8 B-2 documented outlier): this telegram-callback shape
      // deliberately does NOT use createErrorResponse — `code` carries a
      // DYNAMIC service reason (not an ErrorCode member) and the legacy
      // twin `reason` field must stay for old clients; the helper would
      // change the response bytes.
      return res
        .status(result.status)
        .json({ error: result.error, code: result.reason, reason: result.reason });
    }
    // Set httpOnly cookie so the session survives page refresh. Same
    // config as /api/auth/firebase/session (auth.ts line ~915):
    //   sameSite="lax" — required for cross-site OAuth redirect flows;
    //                    "strict" would drop the cookie on the redirect
    //                    back from oauth.telegram.org.
    //   secure — prod only (Render terminates TLS, browser sees https).
    //   maxAge — 30 days, matches the JWT expiry signed in signUserToken.
    res.cookie("auth_token", result.token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
    });
    // 98-F3 (see COOKIE_SESSION_SENTINEL above): sentinel, not the JWT —
    // the httpOnly cookie is the sole session transport.
    return res.json({ token: COOKIE_SESSION_SENTINEL, is_new_user: result.isNewUser });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(
      { category: "auth", err: err instanceof Error ? err.message : String(err) },
      "[telegram-auth] internal error",
    );
    return res.status(500).json(
      createErrorResponse("حدث خطأ، حاول مجدداً", ErrorCode.INTERNAL_ERROR, {
        reason: "server_error",
      }),
    );
  }
});

// POST /api/auth/telegram/webapp (Mini App auto-login)
//
// Called by the SPA when it detects `window.Telegram.WebApp.initData`
// at boot. The user has been authenticated by Telegram itself —
// they NEVER see the oauth.telegram.org phone-number prompt. We
// verify the WebApp HMAC, run the same replay protection as the
// redirect-flow endpoint, and issue the same JWT. Existing public
// web flow (POST /telegram + GET /telegram/callback) is unchanged.
authProviderPublicRouter.post("/telegram/webapp", async (req, res) => {
  try {
    const body = (req.body as Record<string, unknown>) ?? {};
    const initData = typeof body.initData === "string" ? body.initData : "";
    const referralCode =
      typeof body.referralCode === "string"
        ? body.referralCode.trim().toUpperCase().slice(0, 16) || undefined
        : undefined;

    const result = await handleTelegramWebAppAuth(initData, referralCode, getClientInfo(req));
    if (!result.ok) {
      // Round-3 envelope drift fix: `reason` → `code` (old field kept).
      // R125-I6 (A8 B-2 documented outlier): same as the /telegram
      // callback above — dynamic service reason in `code` + the legacy
      // twin `reason` field; createErrorResponse would change bytes.
      return res
        .status(result.status)
        .json({ error: result.error, code: result.reason, reason: result.reason });
    }
    res.cookie("auth_token", result.token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
    });
    // 98-F3 (see COOKIE_SESSION_SENTINEL above): sentinel, not the JWT —
    // the httpOnly cookie is the sole session transport.
    return res.json({ token: COOKIE_SESSION_SENTINEL, is_new_user: result.isNewUser });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(
      { category: "auth", err: err instanceof Error ? err.message : String(err) },
      "[telegram-webapp] internal error",
    );
    return res.status(500).json(
      createErrorResponse("حدث خطأ، حاول مجدداً", ErrorCode.INTERNAL_ERROR, {
        reason: "server_error",
      }),
    );
  }
});

// GET /api/auth/telegram/callback (redirect mode — primary transport)
//
// Telegram redirects here after auth with the signed payload appended
// as URL query params. We verify the same payload as POST mode, then
// set the auth_token httpOnly cookie and 302 the user to /auth/callback
// (no `?token=` — F-010 / security audit 004; the cookie is the sole
// transport now). On failure we 302 to /login with an error code that
// the LoginPage maps to a localised banner.
//
// Cancellation: when the user dismisses the Telegram auth screen
// (closes the tab, taps "Cancel"), Telegram redirects back to
// return_to with NO auth payload. We detect that empty redirect
// here and surface a dedicated `cancelled` reason so the user sees
// "تم إلغاء تسجيل الدخول" instead of the technical "missing_hash".
//
// ── B1-1 (R111, round-111 B1 audit): login-CSRF same-origin gate ──────
//
// This GET was the only session-MINT endpoint outside the CSRF Origin
// gate (createCsrfGate in app.ts is POST/PUT/DELETE/PATCH-only). The
// Telegram payload is signed with the BOT's key — an attacker can mint
// a validly-signed payload for their OWN Telegram account, host it
// behind an <img>/fetch on any page, and the victim's browser silently
// Set-Cookies an auth_token bound to the ATTACKER's account (the exact
// 98-F3 class: the victim then tops up the attacker's wallet).
//
// Chosen fix — server-side same-origin gate, no frontend change needed:
// the CURRENT frontend never sends a browser here with a payload. The
// TelegramLoginButton sets return_to to the SPA route
// /auth/telegram-callback (frontend/src/pages/telegram-callback.tsx),
// which reads the #tgAuthResult fragment (fragments never reach the
// server) and POSTs the payload to /api/auth/telegram — a POST that is
// already behind the CSRF Origin gate. A payload-bearing GET on THIS
// endpoint therefore has no legitimate browser caller today, and
// gating it same-origin breaks nothing in the product.
//
// Verdict rules (fail closed):
//   - `Sec-Fetch-Site` present → allow ONLY `same-origin`. `cross-site`
//     blocks the <img>/link attack; `same-site` is still cross-ORIGIN
//     for our apex/www pair; `none` is attacker-influenceable via a
//     link pasted in a chat/email (the link-click login-CSRF shape), so
//     it blocks too.
//   - No Sec-Fetch-Site (legacy browser / non-browser client) → fall
//     back to Referer: allow only when the Referer origin is in the
//     configured origin allow-list (exact scheme+host+port match, the
//     same comparison createCsrfGate uses — no string-prefix matches).
//   - Neither header → block. Headerless API clients have no ambient
//     browser authority and no business on a browser-redirect endpoint;
//     the POST /api/auth/telegram JSON transport serves them and is
//     gated by the standard CSRF layer.
//
// Blocked requests redirect to /login?error=csrf_blocked (the
// endpoint's failure envelope family — a redirect, never a mint).
//
// UPGRADE PATH (state nonce — the audit's preferred long-term fix):
// issue a signed `state` nonce when the SPA starts Telegram login
// (sessionStorage + a server-side issuance endpoint or a signed
// short-TTL token), append it to the oauth.telegram.org URL, and
// require + validate it here. That would allow re-opening a
// cross-site redirect transport (return_to pointed at this endpoint)
// safely; until such a client exists, same-origin-only is strictly
// tighter and correct.
authProviderPublicRouter.get("/telegram/callback", async (req, res) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    // Telegram never appends `?error=` itself — but if a relay or
    // proxy injected one, forward it transparently.
    if (typeof query.error === "string" && query.error) {
      return res.redirect(`/login?error=${encodeURIComponent(query.error)}`);
    }

    // Empty / cancelled redirect: no signed payload at all.
    if (!query.hash && !query.auth_date) {
      return res.redirect("/login?error=cancelled");
    }

    // B1-1: from here on the request carries a session-MINT payload —
    // apply the same-origin gate before any verification or cookie write.
    if (!isTelegramCallbackSameOrigin(req.headers, telegramCallbackAllowedOrigins())) {
      logger.warn(
        {
          category: "security",
          audit_finding: "B1-1",
          secFetchSite: req.headers["sec-fetch-site"] ?? null,
          referer: req.headers["referer"] ?? null,
        },
        "[telegram-auth] callback session-mint blocked by same-origin CSRF gate",
      );
      return res.redirect(`/login?error=${encodeURIComponent(TELEGRAM_CALLBACK_CSRF_ERROR)}`);
    }

    const { ref, ...rest } = query;
    const payload: Record<string, unknown> = { ...rest };
    if (ref) payload.referralCode = ref;

    const result = await handleTelegramAuth(payload, getClientInfo(req));
    if (!result.ok) {
      return res.redirect(`/login?error=${encodeURIComponent(result.reason)}`);
    }
    // Set httpOnly cookie so the session survives page refresh. The
    // browser carries this cookie on the 302 to /auth/callback and on
    // every subsequent request. Same config as the Firebase session
    // route. F-010 (security audit 004): the JWT is NOT also placed in
    // the redirect query string. Putting it there leaked the token into
    // browser history, the Referer header on the next outbound
    // navigation, and any HTTP-access logs along the path. The cookie
    // is the sole transport now; AuthCallbackPage detects the cookie
    // session via the existing /api/auth/probe endpoint.
    res.cookie("auth_token", result.token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
    });
    return res.redirect("/auth/callback");
  } catch (err) {
    Sentry.captureException(err);
    return res.redirect("/login?error=server_error");
  }
});

// ── R154 (P2): Telegram Login — modern OIDC (Authorization Code + PKCE) ─────
//
// Spec: https://core.telegram.org/bots/telegram-login ("Manual
// Implementation"). This is the flow that makes Telegram registration
// phone-free by design: the requested scopes are `openid profile` — NO
// `phone` (no SMS/phone consent step) and no `telegram:bot_access`.
//
// CSRF/replay model (the B1-1 banner's documented upgrade path, realized):
//   • `state` — server-generated, single-use, stored server-side
//     (lib/telegram-oidc-states.ts, 10-minute TTL) bound to THIS flow's
//     verifier/nonce/redirect/referral. The callback consumes it exactly
//     once; a cross-site attacker cannot forge one.
//   • PKCE S256 — the authorization code is useless without the
//     server-held verifier; code interception dies here.
//   • `nonce` — echoed inside the RS256-signed ID token and re-checked
//     against the flow's stored value.
// The cross-site redirect from oauth.telegram.org is EXPECTED here (the
// state+PKCE+nonce battery is the defense), so the legacy B1-1
// same-origin gate deliberately does not apply to this route pair.
//
// Owner setup (BotFather) — the complete ritual, in order:
//   1. @BotFather → /mybots → the bot → Bot Settings → Web Login. If the
//      screen still shows the LEGACY Login Widget settings, switch it via
//      "Switch to OpenID Connect Login" FIRST — the Client ID/Secret only
//      exist on the new settings page.
//   2. Allowed URLs — add BOTH the exact callback
//      `https://<site-origin>/api/auth/telegram/oidc/callback` AND the
//      site origin itself. Telegram only processes redirects for
//      pre-registered URLs.
//   3. Copy the displayed Client ID + Client Secret into
//      /admin/settings → Telegram. The Client Secret is a SEPARATE
//      BotFather-issued credential — it is NOT the Bot API token and
//      NOT the bot token's suffix; never substitute one for the other.
//      If BotFather regenerates the secret, re-paste the new value.
// A rejected pair surfaces as reason `oidc_invalid_client` (logged with
// Telegram's error code) — check these three steps first.

// GET /api/auth/telegram/oidc/login — start the flow (302 to Telegram).
authProviderPublicRouter.get("/telegram/oidc/login", async (req, res) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const start = await startTelegramOidcFlow({
      originHeader: (req.headers.origin as string | undefined) ?? undefined,
      redirect: typeof query.redirect === "string" ? query.redirect : null,
      referralCode: typeof query.ref === "string" ? query.ref : null,
    });
    if ("error" in start) {
      // provider_disabled | misconfigured_origin — both are honest
      // "not ready" states surfaced on the login page, never a mint.
      return res.redirect(`/login?error=${encodeURIComponent(start.error)}`);
    }
    return res.redirect(start.authorizationUrl);
  } catch (err) {
    Sentry.captureException(err);
    return res.redirect("/login?error=server_error");
  }
});

// GET /api/auth/telegram/oidc/callback — complete the flow.
//
// Telegram redirects here with ?code=&state= on success, ?error= (or
// nothing) on user cancellation. On success: consume the state (single
// use), exchange the code with the PKCE verifier, validate the RS256 ID
// token against the official JWKS (iss/aud/exp/iat/nonce), find-or-create
// the SAME account the legacy flows use (classic `id` claim →
// users.telegram_id — never `sub`, which is a different internal
// identifier), mint the session, set the httpOnly cookie, and 302 to the
// flow's stored post-login path (or the cookie-bounce /auth/callback —
// no token in the URL, F-010 parity).
authProviderPublicRouter.get("/telegram/oidc/callback", async (req, res) => {
  try {
    const query = req.query as Record<string, string | undefined>;

    // Cancellation / provider-reported error: Telegram sends ?error=
    // (or an empty redirect) when the user dismisses the consent screen.
    // R155: the forwarded code was previously SILENT — nothing in the
    // logs ever said why a flow aborted here. Bounded + logged (never
    // free-text: the raw param only rides an encoded redirect anyway).
    if (typeof query.error === "string" && query.error) {
      logger.warn(
        { category: "auth", providerError: query.error.slice(0, 64) },
        "[telegram-oidc] provider redirected back with an error",
      );
      return res.redirect(`/login?error=${encodeURIComponent(query.error)}`);
    }
    const code = typeof query.code === "string" ? query.code : "";
    const state = typeof query.state === "string" ? query.state : "";
    if (!code || !state) {
      return res.redirect("/login?error=cancelled");
    }

    const result = await completeTelegramOidcLogin({
      code,
      state,
      originHeader: (req.headers.origin as string | undefined) ?? undefined,
      client: getClientInfo(req),
    });
    if (!result.ok) {
      return res.redirect(`/login?error=${encodeURIComponent(result.reason)}`);
    }

    // Cookie-first session transport (F-010 parity with every other mint
    // route); the JWT never rides the URL.
    res.cookie("auth_token", result.token, {
      ...getAuthCookieOptions(30 * 24 * 60 * 60 * 1000),
    });
    return res.redirect(result.redirect ?? "/auth/callback");
  } catch (err) {
    Sentry.captureException(err);
    return res.redirect("/login?error=server_error");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTER  (mount at /admin/settings in index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export const authProviderAdminRouter = Router();

// GET /api/admin/settings/auth
authProviderAdminRouter.get("/auth", requireAdmin, async (_req, res) => {
  const settings = await getAllAuthSettings();

  const providers = PROVIDERS.map((meta) => {
    const config = settings[`auth.${meta.id}`] ?? {};
    return {
      id: meta.id,
      label: meta.label,
      icon: meta.icon,
      color: meta.color,
      auth_type: meta.auth_type,
      description: meta.description,
      setup_url: meta.setup_url,
      fields: meta.fields,
      enabled: !!config.enabled,
      config: buildMaskedConfig(meta, config),
    };
  });

  return res.json({ providers });
});

// PATCH /api/admin/settings/auth/:id
//
// A5-11 (round-94): the body used to be read raw — `String(val).trim()`
// stored "[object Object]" for an object-valued bot_token, there was no
// length bound (up to the 1 MB JSON limit), and the route had no audit
// row despite flipping provider enablement + credentials. Values are
// schema-validated per provider field now (strings, bounded), and every
// write is audited (secret values are never logged — keys only).
const MAX_PROVIDER_FIELD_LENGTH: Record<string, number> = {
  // A .p8 private key is multi-line PEM (~1.7 KB); everything else is a
  // short token/identifier.
  private_key: 4000,
};

function providerFieldSchema(field: ProviderField): z.ZodString {
  const max = MAX_PROVIDER_FIELD_LENGTH[field.key] ?? 500;
  // R154 (P2): optional fields (the OIDC credentials) accept "" — the
  // unset state is legal and means "fall back to the legacy flow".
  if (field.optional) return z.string().trim().max(max);
  return z.string().trim().min(1).max(max);
}

function buildProviderPatchSchema(meta: ProviderMeta) {
  const shape: Record<string, z.ZodTypeAny> = { enabled: z.boolean().optional() };
  for (const field of meta.fields) {
    shape[field.key] = providerFieldSchema(field).optional();
  }
  return z.object(shape).strict();
}

authProviderAdminRouter.patch("/auth/:id", requireAdmin, async (req, res) => {
  const meta = PROVIDERS.find((p) => p.id === stringParam(req, "id"));
  if (!meta)
    return res.status(404).json(createErrorResponse("مزود غير موجود", ErrorCode.NOT_FOUND));

  const parse = buildProviderPatchSchema(meta).safeParse(req.body ?? {});
  if (!parse.success) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "قيمة غير صالحة لإعدادات المزود (نصوص فقط ضمن الحدود المسموحة)",
          ErrorCode.INVALID_DATA,
        ),
      );
  }
  const { enabled, ...incoming } = parse.data;

  const key = `auth.${meta.id}`;
  const existing = await getSetting(key);

  const updated: Record<string, unknown> = { ...existing };
  if (typeof enabled === "boolean") updated.enabled = enabled;

  const changedFields: string[] = [];
  for (const field of meta.fields) {
    const val = incoming[field.key];
    if (val === undefined) continue;
    if (field.isSecret && (val === "[SET]" || val === "")) continue;
    // R154 (P2): an EMPTY optional field CLEARS the value (the admin
    // form's "leave it unset" state) instead of storing a blank string
    // the enabled-probe would misread as configured.
    if (field.optional && val === "") {
      delete updated[field.key];
      changedFields.push(field.key);
      continue;
    }
    updated[field.key] = val;
    changedFields.push(field.key);
  }

  await upsertSetting(key, updated);

  // R119-B2 (A3 F-1 / A5 F-1): kill the public providers cache entry the
  // moment the config write lands. GET /api/auth/providers serves this
  // key from a 60 s cacheWrap window, so without this a provider disabled
  // here kept its login button live for up to ~2+ min (60 s origin cache
  // + 60 s SPA module cache) — an operator disabling a compromised
  // provider had to wait the window out while users kept clicking
  // through. cacheDelete is awaited (not fire-and-forget like the audit
  // log below) so the 200 the admin sees implies the invalidation has
  // already happened — same posture as the risk-config PUT awaiting
  // invalidateRiskConfig(). cacheDelete routes every Redis failure into
  // the memory fallback internally (lib/cache.ts), so the .catch is a
  // defensive belt only: a cache hiccup must never fail the operator's
  // save. Worst case on a Redis outage the entry simply lives out its
  // remaining TTL (bounded staleness, the pre-fix behavior).
  await cacheDelete(AUTH_PROVIDERS_CACHE_KEY).catch((err) => {
    logger.warn(
      {
        category: "auth.settings",
        err: err instanceof Error ? err.message : String(err),
      },
      "[auth-settings] providers-cache invalidation failed after PATCH (payload stays stale until TTL expiry)",
    );
  });

  void writeAuditLog(req, "settings.auth_provider.update", "settings", null, {
    provider: meta.id,
    enabled: !!updated.enabled,
    // Keys only — secret VALUES (bot_token / private_key) never enter the
    // audit trail; "[SET]" markers are skipped client-side already.
    fields_changed: changedFields,
  });

  return res.json({
    id: meta.id,
    enabled: !!updated.enabled,
    config: buildMaskedConfig(meta, updated),
  });
});
