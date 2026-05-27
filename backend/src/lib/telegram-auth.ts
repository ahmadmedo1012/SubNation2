/**
 * Telegram Login Widget — payload verification.
 *
 * Pure module. Zero side effects. Zero dependencies on the Express
 * request, the database, Redis, Sentry, or the logger. This makes it
 * trivial to unit test in isolation — see __tests__/telegram-auth.test.ts.
 *
 * Reference: https://core.telegram.org/widgets/login#checking-authorization
 *
 *   secretKey   = SHA256(botToken)
 *   checkString = entries (excluding `hash`), sorted alphabetically,
 *                 joined as `<key>=<value>\n…`
 *   expected    = HMAC-SHA256(secretKey, checkString)
 *   valid       = timingSafeEqual(suppliedHash, expected)
 *
 * The auth_date field is then checked for freshness against
 * TELEGRAM_AUTH_FRESHNESS_SEC. Telegram's official sample uses 86400s
 * (24h). We use 30 minutes — federated session bootstrap doesn't need
 * a wider window, and a tighter window shrinks the replay surface
 * drastically with no UX cost.
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";

/** 30 minutes — production setting. Override via constructor for tests. */
export const TELEGRAM_AUTH_FRESHNESS_SEC = 30 * 60;

/** Stable error codes for verification failures. Logged + counted but
 *  never rendered to the response — see routes/auth-settings.ts where
 *  every reason maps to a single localised user-facing message. */
export type TelegramAuthFailure =
  | "missing_hash"
  | "missing_id"
  | "bad_signature"
  | "stale_auth_date";

export interface TelegramAuthFields {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
}

export type TelegramAuthResult =
  | { ok: true; fields: TelegramAuthFields }
  | { ok: false; reason: TelegramAuthFailure };

interface VerifyOptions {
  /** Override freshness window (test-only). Defaults to TELEGRAM_AUTH_FRESHNESS_SEC. */
  freshnessSec?: number;
  /** Override "now" (test-only). Defaults to current epoch seconds. */
  nowSec?: number;
}

/**
 * Build the data-check string per Telegram spec.
 *
 * Excludes:
 *   - `hash`         — the field being verified
 *   - `referralCode` — our own out-of-band field added by the frontend
 *
 * Skips fields that are `undefined` / `null`.
 */
function buildCheckString(data: Record<string, unknown>): string {
  const entries: string[] = [];
  for (const key of Object.keys(data).sort()) {
    if (key === "hash" || key === "referralCode") continue;
    const value = data[key];
    if (value === undefined || value === null) continue;
    entries.push(`${key}=${String(value)}`);
  }
  return entries.join("\n");
}

/**
 * Verify a Telegram Login Widget payload against the bot token.
 *
 * Returns a discriminated union. On success the caller can rely on
 * `result.fields.id` (string) being safe to use as the lookup key for
 * the `users.telegram_id` column.
 */
export function verifyTelegramAuth(
  data: Record<string, unknown> | null | undefined,
  botToken: string,
  options: VerifyOptions = {},
): TelegramAuthResult {
  if (!data || typeof data !== "object") return { ok: false, reason: "missing_hash" };
  if (!botToken) return { ok: false, reason: "bad_signature" };

  const hash = typeof data.hash === "string" ? data.hash : "";
  if (!hash) return { ok: false, reason: "missing_hash" };
  if (data.id === undefined || data.id === null || data.id === "") {
    return { ok: false, reason: "missing_id" };
  }

  const checkString = buildCheckString(data);
  const secretKey = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(checkString).digest("hex");

  let valid = false;
  try {
    const got = Buffer.from(hash, "hex");
    const want = Buffer.from(expected, "hex");
    if (got.length === want.length && got.length > 0) {
      valid = timingSafeEqual(got, want);
    }
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  const authDate = parseInt(String(data.auth_date ?? "0"), 10);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: "stale_auth_date" };
  }
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const freshness = options.freshnessSec ?? TELEGRAM_AUTH_FRESHNESS_SEC;
  if (nowSec - authDate > freshness) {
    return { ok: false, reason: "stale_auth_date" };
  }

  return {
    ok: true,
    fields: {
      id: String(data.id),
      first_name: typeof data.first_name === "string" ? data.first_name : undefined,
      last_name: typeof data.last_name === "string" ? data.last_name : undefined,
      username: typeof data.username === "string" ? data.username : undefined,
      photo_url: typeof data.photo_url === "string" ? data.photo_url : undefined,
      auth_date: String(authDate),
      hash,
    },
  };
}

/**
 * Test helper — produce a valid widget payload signed with `botToken`.
 *
 * Mirrors the algorithm Telegram uses on its side. The runtime code
 * itself never calls this; it's exported only for the test suite to
 * generate fresh, valid payloads on the fly without storing canned
 * fixtures (which would expire as `auth_date` aged).
 */
export function signTelegramFixture(
  fields: Record<string, string | number>,
  botToken: string,
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    data[k] = String(v);
  }
  const checkString = Object.keys(data)
    .filter((k) => k !== "hash" && k !== "referralCode")
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  data.hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM MINI APP / WEB APP — initData verification
// ─────────────────────────────────────────────────────────────────────────────
// When our website is opened INSIDE the Telegram client (via a t.me/<bot>/<app>
// Mini App link or a bot menu button), Telegram injects a global
// `window.Telegram.WebApp.initData` carrying the user's verified identity.
// The user is already authenticated by Telegram, so we DON'T need to send
// them through the oauth.telegram.org redirect (which is what triggers the
// phone-number prompt for users without an active Telegram web session).
//
// Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// The HMAC algorithm DIFFERS from the Login Widget:
//
//   secretKey   = HMAC_SHA256(key="WebAppData", message=botToken)
//                 (Login Widget uses SHA256(botToken) instead.)
//   checkString = entries (excluding `hash` and `signature`), sorted
//                 alphabetically, joined as `<key>=<value>\n…`
//   expected    = HMAC_SHA256(secretKey, checkString)
//   valid       = timingSafeEqual(suppliedHash, expected)
//
// auth_date freshness uses 24 hours per Telegram's Mini App guidance —
// WebApp sessions are longer-lived than redirect-flow widget logins.

/** 24 hours — Mini App session length per Telegram guidance. */
export const TELEGRAM_WEBAPP_FRESHNESS_SEC = 24 * 60 * 60;

export type TelegramWebAppFailure =
  | "missing_init_data"
  | "missing_hash"
  | "missing_user"
  | "bad_signature"
  | "stale_auth_date";

export interface TelegramWebAppUser {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export type TelegramWebAppResult =
  | { ok: true; user: TelegramWebAppUser; auth_date: string }
  | { ok: false; reason: TelegramWebAppFailure };

interface VerifyWebAppOptions {
  /** Override freshness window (test-only). */
  freshnessSec?: number;
  /** Override "now" (test-only). */
  nowSec?: number;
}

/**
 * Verify a Telegram Mini App `initData` payload against the bot token.
 *
 * `initData` is a URL-encoded query string handed to us by Telegram —
 * exactly the value of `window.Telegram.WebApp.initData` in the SPA.
 * We parse it, verify the HMAC, and return the embedded user object.
 *
 * Returns a discriminated union so the caller can `if (result.ok)` and
 * rely on `result.user.id` (string) being safe for the same lookup path
 * as the redirect-flow `verifyTelegramAuth`.
 */
export function verifyTelegramWebAppData(
  initData: string | null | undefined,
  botToken: string,
  options: VerifyWebAppOptions = {},
): TelegramWebAppResult {
  if (!initData || typeof initData !== "string") {
    return { ok: false, reason: "missing_init_data" };
  }
  if (!botToken) return { ok: false, reason: "bad_signature" };

  // Parse the URL-encoded query string. Order is preserved by URLSearchParams
  // but we re-sort alphabetically below per the spec.
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  if (!hash) return { ok: false, reason: "missing_hash" };

  // Build the data-check string. Telegram excludes both `hash` and the
  // newer `signature` field (added 2024-10 for the Ed25519 path; we
  // verify the HMAC path which remains the canonical one).
  const entries: string[] = [];
  // URLSearchParams::keys() can yield duplicates — dedupe via Set first
  // to keep behaviour predictable across runtimes.
  const seenKeys = new Set<string>();
  const keys: string[] = [];
  for (const k of params.keys()) {
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    keys.push(k);
  }
  keys.sort();
  for (const key of keys) {
    if (key === "hash" || key === "signature") continue;
    entries.push(`${key}=${params.get(key) ?? ""}`);
  }
  const checkString = entries.join("\n");

  // WebApp secret derivation — note the swapped (key, message) order vs the
  // Login Widget. The Telegram docs are explicit on this.
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(checkString).digest("hex");

  let valid = false;
  try {
    const got = Buffer.from(hash, "hex");
    const want = Buffer.from(expected, "hex");
    if (got.length === want.length && got.length > 0) {
      valid = timingSafeEqual(got, want);
    }
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  // Freshness check.
  const authDateRaw = params.get("auth_date") ?? "0";
  const authDate = parseInt(authDateRaw, 10);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, reason: "stale_auth_date" };
  }
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const freshness = options.freshnessSec ?? TELEGRAM_WEBAPP_FRESHNESS_SEC;
  if (nowSec - authDate > freshness) {
    return { ok: false, reason: "stale_auth_date" };
  }

  // The `user` field is itself a JSON string — Telegram nests the user
  // object inside the init-data query string.
  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "missing_user" };
  let userObj: Record<string, unknown>;
  try {
    userObj = JSON.parse(userRaw) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "missing_user" };
  }
  if (userObj.id === undefined || userObj.id === null) {
    return { ok: false, reason: "missing_user" };
  }

  return {
    ok: true,
    auth_date: String(authDate),
    user: {
      id: String(userObj.id),
      first_name: typeof userObj.first_name === "string" ? userObj.first_name : undefined,
      last_name: typeof userObj.last_name === "string" ? userObj.last_name : undefined,
      username: typeof userObj.username === "string" ? userObj.username : undefined,
      photo_url: typeof userObj.photo_url === "string" ? userObj.photo_url : undefined,
      language_code:
        typeof userObj.language_code === "string" ? userObj.language_code : undefined,
    },
  };
}

/**
 * Test helper — produce a valid WebApp `initData` string signed with `botToken`.
 *
 * Mirrors what Telegram's client emits on `window.Telegram.WebApp.initData`.
 * Used only by the test suite; runtime never calls this.
 */
export function signTelegramWebAppFixture(
  fields: {
    user: { id: number | string; first_name?: string; username?: string; photo_url?: string };
    auth_date: number;
    query_id?: string;
  },
  botToken: string,
): string {
  // Build the payload as URL-encoded params per Telegram's spec.
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(fields.user));
  params.set("auth_date", String(fields.auth_date));
  if (fields.query_id) params.set("query_id", fields.query_id);

  // Compute the data-check string the same way verifyTelegramWebAppData does.
  const keys = Array.from(params.keys()).sort();
  const checkString = keys.map((k) => `${k}=${params.get(k) ?? ""}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}
