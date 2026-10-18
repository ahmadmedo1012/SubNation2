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
 *   4. Validate the returned id_token: signature via the JWKS endpoint
 *      (https://oauth.telegram.org/.well-known/jwks.json) with Telegram's
 *      documented algorithms (RS256 default, ES256/EdDSA selectable under
 *      BotFather → Login Widget → Advanced — the live JWKS advertises one
 *      key per alg, and the token's alg must match its key's), then
 *      iss === "https://oauth.telegram.org", aud === client_id,
 *      exp/iat timing, the nonce WHEN PRESENT (the /auth parameter table
 *      documents no nonce parameter — CSRF/replay ride the single-use
 *      state + PKCE + one-time code), and the verified `id` claim.
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

/** Official endpoints (core.telegram.org/bots/telegram-login).
 * R166-B6: unexported — consumed only inside this module + tests (via
 * `__test` below); routes touch only the flow entry-points. */
const TELEGRAM_OIDC_AUTH_ENDPOINT = "https://oauth.telegram.org/auth";
const TELEGRAM_OIDC_TOKEN_ENDPOINT = "https://oauth.telegram.org/token";
const TELEGRAM_OIDC_JWKS_ENDPOINT = "https://oauth.telegram.org/.well-known/jwks.json";
const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";

/**
 * Telegram's documented ID-token algorithms (core.telegram.org/bots/
 * telegram-login): RS256 default; ES256 and EdDSA selectable under
 * BotFather → Login Widget → Advanced (live-verified: the JWKS carries
 * one key per alg). ES256K is refused — Node verifies no secp256k1, and
 * Telegram rejects the `profile` scope this flow requires when ES256K
 * is selected, so it can never legitimately reach this validator.
 */
const SUPPORTED_ALGS: ReadonlySet<string> = new Set(["RS256", "ES256", "EdDSA"]);

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
function resolveOidcCallbackUrl(originHeader: string | undefined): string | null {
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
function generatePkcePair(): { verifier: string; challenge: string } {
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
    // Not in the /auth documented parameter table (Telegram ignores it
    // today) — sent forward-compatibly; the validator enforces it
    // whenever Telegram echoes one into the id_token.
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
  crv?: string;
  x?: string;
  y?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

/** Fetch (and cache) Telegram's JWKS. Exported for test injection. */
async function fetchTelegramJwks(): Promise<Jwk[]> {
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

/**
 * ES256 JWTs carry the signature as raw r||s (RFC 7515 §3.4); Node
 * verifies DER-encoded ECDSA — convert before crypto.verify.
 */
function joseSignatureToDer(raw: Buffer): Buffer | null {
  if (raw.length !== 64) return null;
  const signedInt = (bytes: Buffer): Buffer | null => {
    let start = 0;
    while (start < bytes.length && bytes[start] === 0) start += 1;
    const value = bytes.subarray(start);
    if (value.length === 0) return null;
    return value[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : Buffer.from(value);
  };
  const r = signedInt(raw.subarray(0, 32));
  const s = signedInt(raw.subarray(32, 64));
  if (!r || !s) return null;
  return Buffer.concat([
    Buffer.from([0x30, 2 + r.length + 2 + s.length]),
    Buffer.from([0x02, r.length]),
    r,
    Buffer.from([0x02, s.length]),
    s,
  ]);
}

/**
 * Signature verification per algorithm, cross-bound to the JWK: a key
 * advertising alg X only verifies a token whose header says X, and the
 * key TYPE must match the algorithm's family (RSA/EC-P256/OKP-Ed25519).
 */
function verifySignature(jwt: JwtParts, jwk: Jwk): boolean {
  if (typeof jwk.alg === "string" && jwk.alg !== jwt.header.alg) return false;
  try {
    const data = Buffer.from(jwt.signingInput, "utf8");
    if (jwt.header.alg === "RS256") {
      if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
        return false;
      }
      const key = createPublicKey({
        key: jwk as { kty: string; n: string; e: string },
        format: "jwk",
      });
      return cryptoVerify("RSA-SHA256", data, key, jwt.signature);
    }
    if (jwt.header.alg === "ES256") {
      if (
        jwk.kty !== "EC" ||
        jwk.crv !== "P-256" ||
        typeof jwk.x !== "string" ||
        typeof jwk.y !== "string"
      ) {
        return false;
      }
      const der = joseSignatureToDer(jwt.signature);
      if (!der) return false;
      const key = createPublicKey({
        key: jwk as { kty: string; crv: string; x: string; y: string },
        format: "jwk",
      });
      return cryptoVerify("sha256", data, key, der);
    }
    // EdDSA — Ed25519 (Node verifies the raw 64-byte JOSE signature).
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
      return false;
    }
    const key = createPublicKey({
      key: jwk as { kty: string; crv: string; x: string },
      format: "jwk",
    });
    return cryptoVerify(null, data, key, jwt.signature);
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

/** Bounded, non-secret claim TYPES for the failure log line (R156: the
 * next live failure must name its exact check — never token VALUES). */
function validationDetail(jwt: JwtParts | null): Record<string, unknown> {
  if (!jwt) return {};
  const type = (v: unknown): string =>
    Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
  return {
    alg: typeof jwt.header.alg === "string" ? jwt.header.alg.slice(0, 16) : undefined,
    kid: typeof jwt.header.kid === "string" ? jwt.header.kid.slice(0, 64) : undefined,
    issType: type(jwt.claims.iss),
    audType: type(jwt.claims.aud),
    noncePresent: typeof jwt.claims.nonce === "string",
    idType: type(jwt.claims.id),
  };
}

/**
 * Full ID-token validation: signature against the official JWKS (every
 * documented, profile-compatible algorithm) + every claim check.
 * Returns the verified identity or the specific failure reason with
 * bounded type-only diagnostics (never token contents).
 */
async function verifyTelegramOidcIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
): Promise<
  | { ok: true; identity: TelegramOidcIdentity }
  | { ok: false; reason: TelegramOidcVerificationFailure; detail?: Record<string, unknown> }
> {
  const jwt = decodeJwt(idToken);
  if (!jwt) return { ok: false, reason: "malformed_token" };
  const fail = (reason: TelegramOidcVerificationFailure) => ({
    ok: false as const,
    reason,
    detail: validationDetail(jwt),
  });

  // Algorithm pinning — an alg=none / HS256 confusion / ES256K token
  // dies here, before any key lookup.
  if (!SUPPORTED_ALGS.has(jwt.header.alg)) return fail("bad_algorithm");

  const keys = await fetchTelegramJwks();
  // kid-first; a kid-less header falls back to the key advertising the
  // token's own alg (the live JWKS sets alg on every key).
  const jwk = jwt.header.kid
    ? (keys.find((k) => k.kid === jwt.header.kid) ?? null)
    : (keys.find((k) => k.alg === jwt.header.alg) ?? keys[0] ?? null);
  if (!jwk) return fail("unknown_key");
  if (!verifySignature(jwt, jwk)) return fail("bad_signature");

  const nowSec = Math.floor(Date.now() / 1000);
  if (jwt.claims.iss !== TELEGRAM_OIDC_ISSUER) return fail("wrong_issuer");
  const rawAud = Array.isArray(jwt.claims.aud) ? jwt.claims.aud[0] : jwt.claims.aud;
  // The docs' example ships aud as a string; a numeric shape is coerced —
  // the VALUE must equal the configured client id either way.
  const aud = typeof rawAud === "number" ? String(rawAud) : rawAud;
  if (aud !== expected.clientId) return fail("wrong_audience");
  const exp = typeof jwt.claims.exp === "number" ? jwt.claims.exp : 0;
  if (exp + CLOCK_SKEW_SEC <= nowSec) return fail("expired");
  const iat = typeof jwt.claims.iat === "number" ? jwt.claims.iat : 0;
  if (iat > nowSec + CLOCK_SKEW_SEC) return fail("issued_in_future");
  // R156: the /auth parameter table documents NO nonce parameter (and the
  // discovery doc's claims_supported omits it) — the auth-code id_token
  // legitimately arrives nonce-less; CSRF/replay ride the single-use
  // state + PKCE + the one-time code. When Telegram DOES echo one, it
  // must match — fail-closed, never a skip.
  if (
    typeof jwt.claims.nonce === "string" &&
    !constantTimeEqual(jwt.claims.nonce, expected.nonce)
  ) {
    return fail("nonce_mismatch");
  }

  // The linkage key: `id` is the CLASSIC Telegram user id (the documented
  // profile claim) — a positive integer as a number (the docs' example)
  // or its numeric-string form. `sub` is a DIFFERENT internal identifier
  // — never used for linkage.
  const idClaim = jwt.claims.id;
  const telegramId =
    typeof idClaim === "number" && Number.isSafeInteger(idClaim) && idClaim > 0
      ? String(idClaim)
      : typeof idClaim === "string" && /^\d{1,15}$/.test(idClaim)
        ? idClaim
        : null;
  if (!telegramId) return fail("missing_id_claim");

  const given = typeof jwt.claims.given_name === "string" ? jwt.claims.given_name : null;
  const family = typeof jwt.claims.family_name === "string" ? jwt.claims.family_name : null;
  const displayName = [given, family].filter(Boolean).join(" ").trim() || null;

  return {
    ok: true,
    identity: {
      telegramId,
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
  /**
   * OAuth error code. Live-verified against the real endpoint: Telegram
   * reports exchange failures as HTTP 200 + {"error":"invalid_grant" |
   * "invalid_client" | ...} — the HTTP status alone never discriminates,
   * and the error STRING is the only signal separating an
   * operator-fixable credential problem from a code/verifier problem.
   */
  error?: string;
}

/**
 * Bound + sanitize an OAuth error code before it reaches a log line
 * (defensive: a misrouted or hostile endpoint could return anything as
 * the `error` value — never trust it as free text).
 */
function sanitizeTelegramOauthError(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const bounded = raw.trim().slice(0, 64);
  return /^[a-z0-9_]+$/i.test(bounded) ? bounded : null;
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
  // R155: Telegram reports OAuth failures INSIDE a 200 body
  // ({"error":"invalid_grant"} etc. — live-verified), so the body must be
  // read on every response and its error code surfaced. A JSON parse
  // failure (HTML error page, empty body) degrades to the generic
  // exchange rejection — never a crash.
  let tokens: TelegramTokenResponse;
  try {
    tokens = (await tokenRes.json()) as TelegramTokenResponse;
  } catch {
    tokens = {};
  }
  if (!tokenRes.ok || typeof tokens.error === "string") {
    const tgError = sanitizeTelegramOauthError(tokens.error);
    if (tgError === "invalid_client") {
      // The BotFather-issued Client ID/Secret pair was rejected — an
      // operator-configuration failure (wrong/regenerated secret, bot
      // not switched to the OpenID Connect login mode), not a user or
      // protocol failure. Distinct reason so the logs and the login
      // page can say exactly what to fix.
      logger.warn(
        { category: "auth", httpStatus: tokenRes.status, tgError },
        "[telegram-oidc] token exchange rejected the client credentials (invalid_client) — re-check the BotFather OpenID Connect Client ID/Secret and the Allowed URLs",
      );
      return {
        ok: false,
        status: 502,
        reason: "oidc_invalid_client",
        error: "إعداد تسجيل الدخول عبر Telegram غير صحيح، يُرجى مراجعة الإعدادات",
      };
    }
    logger.warn(
      { category: "auth", httpStatus: tokenRes.status, tgError },
      "[telegram-oidc] token exchange rejected",
    );
    return {
      ok: false,
      status: 502,
      reason: "oidc_token_exchange",
      error: "فشل تبادل الرمز مع Telegram، حاول مجدداً",
    };
  }
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
      { category: "auth", reason: verification.reason, ...verification.detail },
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

// R166-B6: `isTelegramOidcConfigured` (a resolveOidcConfig() !== null probe
// whose "settings route" consumer no longer exists — the route computes
// `oidc_enabled` inline from the settings row) is DELETED: zero references
// repo-wide, and keeping it unexported-but-present tripped the unused-var
// lint gate. resolveOidcConfig() remains the module's internal probe.

// ── Test-only surface (R166-B6) ──────────────────────────────────────────────

/**
 * Test-only hooks — the pure OIDC primitives the test suite pins directly
 * (endpoint constants, PKCE generation, ID-token verification). The module's
 * production surface is `startTelegramOidcFlow` + `completeTelegramOidcLogin`
 * (+ their result types) only.
 */
export const __test = {
  TELEGRAM_OIDC_AUTH_ENDPOINT,
  generatePkcePair,
  verifyTelegramOidcIdToken,
};
