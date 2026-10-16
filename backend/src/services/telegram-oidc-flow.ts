/**
 * R154 (P2) — modern Telegram Login via the official OpenID Connect flow.
 *
 * Spec: https://core.telegram.org/bots/telegram-login ("Manual
 * Implementation"). Standard Authorization Code Flow with PKCE (S256):
 *
 *   1. GET https://oauth.telegram.org/auth
 *        ?client_id=<bot id>&redirect_uri=<callback>
 *        &response_type=code&scope=openid%20profile
 *        &state=<random>&code_challenge=<S256(verifier)>&code_challenge_method=S256
 *   2. Telegram redirects back with ?code=&state=
 *   3. POST https://oauth.telegram.org/token (Basic auth client_id:secret)
 *        grant_type=authorization_code&code=...&redirect_uri=...
 *        &client_id=...&code_verifier=...
 *   4. Validate the returned id_token: RS256 via the JWKS endpoint
 *      (https://oauth.telegram.org/.well-known/jwks.json), then
 *      iss === "https://oauth.telegram.org", aud === client_id,
 *      exp/iat timing, nonce match, and the verified `id` claim.
 *
 * Scopes: `openid profile` ONLY — the task forbids requesting the phone
 * scope (registration must not require a phone number or SMS consent) and
 * `telegram:bot_access` is not requested (no documented feature needs
 * post-login bot messaging consent).
 *
 * Identity mapping (deliberate, per the documented claim meanings): the
 * `id` claim is the CLASSIC Telegram user id — the same identifier the
 * legacy widget flow stores in users.telegram_id — so OIDC logins reuse
 * existing accounts through findOrCreateTelegramUser without duplication.
 * The `sub` claim is a DIFFERENT internal identifier and is never used
 * for linkage (mapping `sub` would fork every account).
 *
 * Email: Telegram's `profile` scope provides no email claim — the flow
 * leaves email unset (the UI shows «غير متاح من تيليجرام», never a
 * fabricated address).
 */

import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
} from "node:crypto";
import { getSetting } from "./auth-settings-store";
import { logAuthActivity } from "../lib/auth-activity";
import { logger } from "../lib/logger";
import { getConfiguredOrigins } from "../lib/origins";
import { sanitizeInternalPath } from "../lib/sanitize-internal-path";
import { createUserSession } from "../lib/session";
import { findOrCreateTelegramUser } from "./telegram-auth-flow";
import {
  consumeTelegramOidcState,
  storeTelegramOidcState,
  type TelegramOidcStateValue,
} from "../lib/telegram-oidc-states";
import type { TelegramAuthFields } from "../lib/telegram-auth";

/** Official endpoints (core.telegram.org/bots/telegram-login). */
export const TELEGRAM_OIDC_AUTH_ENDPOINT = "https://oauth.telegram.org/auth";
export const TELEGRAM_OIDC_TOKEN_ENDPOINT = "https://oauth.telegram.org/token";
export const TELEGRAM_OIDC_JWKS_ENDPOINT = "https://oauth.telegram.org/.well-known/jwks.json";
export const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";

/** The only signing algorithm this flow accepts (Telegram's default). */
const REQUIRED_ALG = "RS256";

/** Allowed clock skew for exp/iat checks (the OIDC spec's 5-minute norm). */
const CLOCK_SKEW_SEC = 300;

/** JWKS cache: keys rotate rarely; 1 hour keeps verification offline-tolerant. */
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

export interface TelegramOidcClientConfig {
  clientId: string;
  clientSecret: string;
  /** Absolute callback URL registered as an Allowed URL in BotFather. */
  redirectUri: string;
}

export type TelegramOidcFlowResult =
  | { ok: true; token: string; isNewUser: boolean; redirect: string | null }
  | { ok: false; status: number; reason: string; error: string };

/** Resolved `auth.telegram` settings with OIDC credentials present. */
async function resolveOidcConfig(): Promise<TelegramOidcClientConfig | null> {
  const config = await getSetting("auth.telegram");
  const enabled = !!config.enabled;
  const clientId = typeof config.oidc_client_id === "string" ? config.oidc_client_id.trim() : "";
  const clientSecret =
    typeof config.oidc_client_secret === "string" ? config.oidc_client_secret.trim() : "";
  // OIDC requires the BotFather-issued Client ID + Secret — a different
  // credential from the Bot API token; never substitute one for the other.
  if (!enabled || !clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: "" };
}

/**
 * The callback URL for a request — the request's own origin when it is a
 * configured browser origin (the Coolify single-origin shape), else the
 * first configured origin. The operator registers this exact URL in
 * BotFather → Login Widget → Allowed URLs.
 */
export function resolveOidcCallbackUrl(originHeader: string | undefined): string | null {
  const configured = getConfiguredOrigins();
  if (configured.length === 0) return null;
  const own =
    typeof originHeader === "string" && originHeader.length > 0
      ? originHeader.trim().replace(/\/+$/, "")
      : null;
  const base = own && configured.includes(own) ? own : (configured[0] ?? null);
  if (!base) return null;
  return `${base}/api/auth/telegram/oidc/callback`;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** PKCE pair — verifier 43-128 chars (RFC 7636 §4.1) + S256 challenge. */
export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48)); // 64 chars — inside 43..128
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** 192-bit URL-safe random tokens for state/nonce (OWASP's ≥64-bit floor with margin). */
function randomToken(): string {
  return base64url(randomBytes(24));
}

export interface TelegramOidcStart {
  authorizationUrl: string;
  state: string;
}

/**
 * Start a flow: create {state, verifier, nonce}, persist them bound to the
 * caller's redirect + referral, and return the authorization URL the
 * browser must navigate to. Scopes are pinned to `openid profile` — no
 * phone, no bot access.
 */
export async function startTelegramOidcFlow(input: {
  originHeader: string | undefined;
  redirect: string | null;
  referralCode: string | null;
}): Promise<TelegramOidcStart | { error: "provider_disabled" | "misconfigured_origin" }> {
  const cfg = await resolveOidcConfig();
  if (!cfg) return { error: "provider_disabled" };
  const redirectUri = resolveOidcCallbackUrl(input.originHeader);
  if (!redirectUri) return { error: "misconfigured_origin" };

  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = generatePkcePair();
  const value: TelegramOidcStateValue = {
    verifier,
    nonce,
    redirect: sanitizeInternalPath(input.redirect),
    referralCode: input.referralCode ? input.referralCode.trim().toUpperCase().slice(0, 16) : null,
    createdAt: Date.now(),
  };
  await storeTelegramOidcState(state, value);

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    nonce,
  });
  return {
    authorizationUrl: `${TELEGRAM_OIDC_AUTH_ENDPOINT}?${params.toString()}`,
    state,
  };
}

// ── ID token validation ───────────────────────────────────────────────────────

interface JwtParts {
  header: { alg: string; kid?: string; typ?: string };
  claims: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

function decodeJwt(idToken: string): JwtParts | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  try {
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as {
      alg?: string;
      kid?: string;
      typ?: string;
    };
    const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return {
      header: { alg: String(header?.alg ?? ""), kid: header?.kid, typ: header?.typ },
      claims,
      signingInput: `${headerB64}.${payloadB64}`,
      signature: Buffer.from(signatureB64, "base64url"),
    };
  } catch {
    return null;
  }
}

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

/** Fetch (and cache) Telegram's JWKS. Exported for test injection. */
export async function fetchTelegramJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(TELEGRAM_OIDC_JWKS_ENDPOINT, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/** Test-only: clear the JWKS cache between cases. */
export const __testResetJwksCache = (): void => {
  jwksCache = null;
};

function verifyRs256Signature(jwt: JwtParts, jwk: Jwk): boolean {
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") return false;
  try {
    // Minimal structural JWK (kty/n/e) — satisfies createPublicKey's
    // JsonWebKey input shape without importing DOM-flavored types.
    const key = createPublicKey({
      key: jwk as { kty: string; n: string; e: string; kid?: string },
      format: "jwk",
    });
    return cryptoVerify("RSA-SHA256", Buffer.from(jwt.signingInput, "utf8"), key, jwt.signature);
  } catch {
    return false;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type TelegramOidcVerificationFailure =
  | "malformed_token"
  | "bad_algorithm"
  | "unknown_key"
  | "bad_signature"
  | "wrong_issuer"
  | "wrong_audience"
  | "expired"
  | "issued_in_future"
  | "nonce_mismatch"
  | "missing_id_claim";

export interface TelegramOidcIdentity {
  /** Classic Telegram user id (the users.telegram_id linkage key). */
  telegramId: string;
  displayName: string | null;
  username: string | null;
  photoUrl: string | null;
  /** JWT auth_time equivalent — the token's iat. */
  authDate: number;
}

/**
 * Full ID-token validation: RS256 signature against the official JWKS +
 * every claim check. Returns the verified identity or the specific
 * failure reason (never logged with token contents).
 */
export async function verifyTelegramOidcIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
): Promise<
  | { ok: true; identity: TelegramOidcIdentity }
  | { ok: false; reason: TelegramOidcVerificationFailure }
> {
  const jwt = decodeJwt(idToken);
  if (!jwt) return { ok: false, reason: "malformed_token" };

  // Algorithm pinning — an alg=none / HS256 confusion token dies here.
  if (jwt.header.alg !== REQUIRED_ALG) return { ok: false, reason: "bad_algorithm" };

  const keys = await fetchTelegramJwks();
  const jwk = jwt.header.kid
    ? (keys.find((k) => k.kid === jwt.header.kid) ?? null)
    : (keys[0] ?? null);
  if (!jwk) return { ok: false, reason: "unknown_key" };
  if (!verifyRs256Signature(jwt, jwk)) return { ok: false, reason: "bad_signature" };

  const nowSec = Math.floor(Date.now() / 1000);
  if (jwt.claims.iss !== TELEGRAM_OIDC_ISSUER) return { ok: false, reason: "wrong_issuer" };
  const aud = Array.isArray(jwt.claims.aud) ? jwt.claims.aud[0] : jwt.claims.aud;
  if (aud !== expected.clientId) return { ok: false, reason: "wrong_audience" };
  const exp = typeof jwt.claims.exp === "number" ? jwt.claims.exp : 0;
  if (exp + CLOCK_SKEW_SEC <= nowSec) return { ok: false, reason: "expired" };
  const iat = typeof jwt.claims.iat === "number" ? jwt.claims.iat : 0;
  if (iat > nowSec + CLOCK_SKEW_SEC) return { ok: false, reason: "issued_in_future" };
  // Nonce: replay defense for the implicit-style token re-use — the state
  // store already binds the flow to one code exchange; this re-checks the
  // token against the flow that requested it.
  if (
    typeof jwt.claims.nonce !== "string" ||
    !constantTimeEqual(jwt.claims.nonce, expected.nonce)
  ) {
    return { ok: false, reason: "nonce_mismatch" };
  }

  // The linkage key: `id` is the CLASSIC Telegram user id (the documented
  // profile claim). `sub` is a DIFFERENT internal identifier — never used.
  const idClaim = jwt.claims.id;
  if (typeof idClaim !== "number" || !Number.isSafeInteger(idClaim) || idClaim <= 0) {
    return { ok: false, reason: "missing_id_claim" };
  }

  const given = typeof jwt.claims.given_name === "string" ? jwt.claims.given_name : null;
  const family = typeof jwt.claims.family_name === "string" ? jwt.claims.family_name : null;
  const displayName = [given, family].filter(Boolean).join(" ").trim() || null;

  return {
    ok: true,
    identity: {
      telegramId: String(idClaim),
      displayName: displayName || (typeof jwt.claims.name === "string" ? jwt.claims.name : null),
      username:
        typeof jwt.claims.preferred_username === "string" &&
        jwt.claims.preferred_username.length > 0
          ? jwt.claims.preferred_username
          : null,
      photoUrl: typeof jwt.claims.picture === "string" ? jwt.claims.picture : null,
      authDate: iat,
    },
  };
}

// ── Token exchange + login ───────────────────────────────────────────────────

interface TelegramTokenResponse {
  access_token?: string;
  id_token?: string;
  token_type?: string;
}

/**
 * Complete the flow at the callback: consume the single-use state,
 * exchange the code (PKCE verifier), validate the ID token, find-or-create
 * the account, mint the session. Fail-closed at every step.
 */
export async function completeTelegramOidcLogin(input: {
  code: string;
  state: string;
  originHeader: string | undefined;
  client: { ipAddress: string; userAgent: string };
}): Promise<TelegramOidcFlowResult> {
  const cfg = await resolveOidcConfig();
  if (!cfg) {
    return {
      ok: false,
      status: 503,
      reason: "provider_disabled",
      error: "تسجيل الدخول عبر Telegram غير مفعّل",
    };
  }
  const redirectUri = resolveOidcCallbackUrl(input.originHeader);
  if (!redirectUri) {
    return {
      ok: false,
      status: 503,
      reason: "misconfigured_origin",
      error: "إعداد تسجيل الدخول غير مكتمل",
    };
  }

  const stored = await consumeTelegramOidcState(input.state);
  if (!stored) {
    return {
      ok: false,
      status: 401,
      reason: "oidc_state",
      error: "انتهت صلاحية الجلسة، حاول مجدداً",
    };
  }

  // Token exchange — server-side only; the client secret never reaches
  // the browser. Basic auth per the official docs.
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, "utf8").toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    code_verifier: stored.verifier,
  });
  let tokenRes: Response;
  try {
    tokenRes = await fetch(TELEGRAM_OIDC_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    logger.warn(
      { category: "auth", err: err instanceof Error ? err.message : String(err) },
      "[telegram-oidc] token endpoint unreachable",
    );
    return {
      ok: false,
      status: 502,
      reason: "oidc_token_exchange",
      error: "تعذّر الاتصال بـ Telegram، حاول مجدداً",
    };
  }
  if (!tokenRes.ok) {
    logger.warn(
      { category: "auth", status: tokenRes.status },
      "[telegram-oidc] token exchange rejected",
    );
    return {
      ok: false,
      status: 502,
      reason: "oidc_token_exchange",
      error: "فشل تبادل الرمز مع Telegram، حاول مجدداً",
    };
  }
  const tokens = (await tokenRes.json()) as TelegramTokenResponse;
  if (typeof tokens.id_token !== "string" || tokens.id_token.length === 0) {
    return {
      ok: false,
      status: 502,
      reason: "oidc_missing_id_token",
      error: "استجابة غير صالحة من Telegram",
    };
  }

  const verification = await verifyTelegramOidcIdToken(tokens.id_token, {
    clientId: cfg.clientId,
    nonce: stored.nonce,
  });
  if (!verification.ok) {
    await logAuthActivity({
      identifier: "tg:oidc_unknown",
      action: "login",
      provider: "telegram",
      success: false,
      failureReason: verification.reason,
      userAgent: input.client.userAgent,
      ipAddress: input.client.ipAddress,
    }).catch((err) => {
      // Non-fatal — the telemetry insert must never fail the refusal.
      logger.warn(
        { category: "auth.telegram", err: err instanceof Error ? err.message : String(err) },
        "logAuthActivity: failed to record telegram-oidc failure",
      );
    });
    logger.warn(
      { category: "auth", reason: verification.reason },
      "[telegram-oidc] ID token validation failed",
    );
    return {
      ok: false,
      status: 401,
      reason: "oidc_invalid_token",
      error: "فشل التحقق من هوية Telegram",
    };
  }
  const identity = verification.identity;

  // Verified OIDC profile → the SAME find-or-create the widget/Mini App
  // flows ride: the classic `id` claim links to users.telegram_id, so an
  // existing Telegram account logs in (no duplicate), and a first-time
  // Telegram user registers without ever being asked for a phone number.
  const fields: TelegramAuthFields = {
    id: identity.telegramId,
    first_name: identity.displayName ?? "",
    last_name: "",
    username: identity.username ?? undefined,
    photo_url: identity.photoUrl ?? undefined,
    auth_date: String(identity.authDate),
    hash: "oidc",
  };
  const { user, isNewUser } = await findOrCreateTelegramUser(
    fields,
    stored.referralCode ?? undefined,
  );

  const { token } = await createUserSession({
    userId: user.id,
    ipAddress: input.client.ipAddress,
    userAgent: input.client.userAgent,
  });

  await logAuthActivity({
    identifier: `tg:${identity.telegramId}`,
    action: isNewUser ? "register" : "login",
    provider: "telegram",
    success: true,
    userAgent: input.client.userAgent,
    ipAddress: input.client.ipAddress,
  }).catch((err) => {
    // Non-fatal — telemetry never fails a successful login.
    logger.warn(
      { category: "auth.telegram", err: err instanceof Error ? err.message : String(err) },
      "logAuthActivity: failed to record telegram-oidc success",
    );
  });

  return { ok: true, token, isNewUser, redirect: stored.redirect };
}

/** Re-exported for the settings route's enabled probe. */
export async function isTelegramOidcConfigured(): Promise<boolean> {
  return (await resolveOidcConfig()) !== null;
}
