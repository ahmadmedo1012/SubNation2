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
