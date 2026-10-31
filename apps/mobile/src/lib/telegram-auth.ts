import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

import { API_URL } from "./api";

/**
 * Telegram OIDC sign-in — the native transport (web parity: the
 * TelegramLoginButton's R154 OIDC branch, converted from a top-level
 * browser navigation to an in-app auth browser session).
 *
 * The backend's GET /api/auth/telegram/oidc/login builds the
 * oauth.telegram.org Authorization Code + PKCE URL server-side
 * (state / nonce / verifier live in the backend's single-use store —
 * the app never sees a secret). With `native=1&app_nonce=<n>` the
 * backend MUST redirect a SUCCESSFUL auth back to the app's deep link
 * instead of the web's cookie-bounce page:
 *
 *   subnation://auth/callback#token=<30-day JWT>&app_nonce=<n>
 *
 * Fragment transport (the token never hits server access logs — the
 * same property Telegram itself relies on for #tgAuthResult).
 *
 * R192 (security, F-1) — app-instance binding: BEFORE opening the
 * browser, the app mints a high-entropy nonce, persists it in
 * SecureStore (device-local: an attacker who can only DELIVER deep
 * links can neither read nor write it), and sends it on the login hop.
 * A callback is accepted ONLY when its app_nonce matches the pending
 * one. A forged subnation://auth/callback#token=… from a malicious
 * page (login-CSRF / silent session substitution) carries no matching
 * nonce and is REJECTED — the token is never stored. The pending
 * nonce is consumed on use, so replays of a legitimate callback URL
 * are rejected too. Persistence (not just memory) keeps the cold-start
 * leg working when Android kills the app mid-auth.
 *
 * A session that returns WITHOUT a token is a user cancellation —
 * callers do nothing.
 */

/** The exact deep-link the backend must redirect native Telegram auth to. */
export const TELEGRAM_AUTH_CALLBACK_URL = "subnation://auth/callback";

/** SecureStore slot for the in-flight app-instance nonce (F-1). */
const PENDING_NONCE_KEY = "subnation.telegram.pending_nonce";

/** The pending nonce lives exactly as long as the server state (10 min). */
const PENDING_NONCE_TTL_MS = 10 * 60 * 1000;

/** A consumed callback's token stays idempotent for this long (the
 * documented Android double-delivery: the WebBrowser session result
 * AND the Linking url event can both carry the same redirect). */
const RECENT_ACCEPT_WINDOW_MS = 5 * 60 * 1000;

interface PendingNonceRecord {
  /** The nonce value (base64url, 32 chars). */
  n: string;
  /** Date.now() at mint. */
  t: number;
}

/** Last accepted callback (token digest + time) — idempotent re-delivery. */
let recentAccept: { digest: string; at: number } | null = null;

/** True when a URL is a Telegram auth callback (token or not).
 * Exact-path match: the scheme URL itself or with a fragment/query —
 * never a longer path (subnation://auth/callback-other is NOT ours). */
export function isTelegramAuthCallback(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    url === TELEGRAM_AUTH_CALLBACK_URL ||
    url.startsWith(`${TELEGRAM_AUTH_CALLBACK_URL}#`) ||
    url.startsWith(`${TELEGRAM_AUTH_CALLBACK_URL}?`)
  );
}

/** base64url alphabet — manual encode (Hermes's btoa availability is
 * not guaranteed across every engine/overlay build). */
const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += B64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += B64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Mint a fresh app-instance nonce — 24 CSPRNG bytes, base64url (32
 * chars). FAILS LOUD when the platform RNG is unavailable: the auth
 * path must never degrade to predictable randomness (contrast the
 * idempotency keys' documented bounded-impact fallback).
 */
function generateAppNonce(): string {
  const bytes = new Uint8Array(24);
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("منصة الجهاز لا توفر مولّد أرقام عشوائية آمن");
  }
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function persistPendingNonce(nonce: string): Promise<void> {
  const record: PendingNonceRecord = { n: nonce, t: Date.now() };
  await SecureStore.setItemAsync(PENDING_NONCE_KEY, JSON.stringify(record));
}

async function readPendingNonce(): Promise<PendingNonceRecord | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_NONCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingNonceRecord>;
    if (typeof parsed.n !== "string" || !parsed.n) return null;
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    return { n: parsed.n, t: parsed.t };
  } catch {
    return null;
  }
}

async function clearPendingNonce(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PENDING_NONCE_KEY);
  } catch {
    // Deleting a missing/failed key is a no-op state-wise.
  }
}

/** Stable short digest of a token for the in-memory replay window. */
function tokenDigest(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  }
  return `${token.length}:${hash}`;
}

/** Parse the callback URL's fragment AND query for token/app_nonce. */
function extractCallbackParams(url: string): { token: string | null; appNonce: string | null } {
  const fragmentIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");
  const parts: string[] = [];
  if (fragmentIndex !== -1) parts.push(url.slice(fragmentIndex + 1));
  if (queryIndex !== -1) {
    const end = fragmentIndex > queryIndex ? fragmentIndex : undefined;
    parts.push(url.slice(queryIndex + 1, end));
  }
  let token: string | null = null;
  let appNonce: string | null = null;
  // Fragment first (the specced transport), then query (link stacks that
  // strip fragments). The nonce binding — not the transport — is the
  // security gate; the loose regex of the R191 shape is gone (F-2).
  for (const part of parts) {
    const params = new URLSearchParams(part);
    if (!token) token = params.get("token");
    if (!appNonce) appNonce = params.get("app_nonce");
  }
  return { token, appNonce };
}

export type TelegramCallbackSettlement =
  /** Not a Telegram callback URL — caller does nothing. */
  | { status: "ignored" }
  /** A callback without a token — user cancellation, no credential. */
  | { status: "cancelled" }
  /** Token present but NOT bound to a flow this app instance started
   * (missing/expired/mismatched/consumed nonce) — REJECTED, never store. */
  | { status: "rejected" }
  /** Verified — the flow this app instance started returned its token. */
  | { status: "ok"; token: string };

/**
 * Settle a Telegram auth callback URL — the ONE verification gate both
 * the cold-start route (app/auth/callback.tsx) and the login screen's
 * warm listener share. Verifies + consumes the pending app-instance
 * nonce; idempotent for the same token re-delivered within the recent
 * window (Android's double-delivery race — the second delivery of the
 * SAME redirect is "ok", a different token stays "rejected").
 */
export async function settleTelegramCallbackUrl(
  url: string | null | undefined,
): Promise<TelegramCallbackSettlement> {
  if (!isTelegramAuthCallback(url)) return { status: "ignored" };
  const raw = url as string;
  const { token, appNonce } = extractCallbackParams(raw);
  if (!token) return { status: "cancelled" };

  // Idempotent re-delivery of an already-accepted callback (the
  // Android WebBrowser/Linking double-delivery race).
  if (recentAccept && Date.now() - recentAccept.at < RECENT_ACCEPT_WINDOW_MS) {
    if (recentAccept.digest === tokenDigest(token)) return { status: "ok", token };
  }

  const pending = await readPendingNonce();
  // No pending flow, expired flow, or a nonce that does not match the
  // one this app instance minted → injected or stale. Fail closed.
  if (
    !pending ||
    Date.now() - pending.t > PENDING_NONCE_TTL_MS ||
    !appNonce ||
    appNonce !== pending.n
  ) {
    await clearPendingNonce();
    return { status: "rejected" };
  }

  // Bound to this app instance's flow: consume the nonce (single use)
  // and remember the token digest for the double-delivery window.
  await clearPendingNonce();
  recentAccept = { digest: tokenDigest(token), at: Date.now() };
  return { status: "ok", token };
}

/**
 * Start the Telegram OIDC login in the system auth browser
 * (ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android)
 * and resolve the VERIFIED session JWT when the backend redirects back
 * to the app's deep link. Resolves null when the user cancelled (or the
 * redirect carried no token — the login screen's Linking listener is
 * the safety net for the Android race where the auth session resolves
 * `dismiss` before the url event lands). Resolves null for a REJECTED
 * callback too (injection/stale — never stored); callers that need the
 * distinction call settleTelegramCallbackUrl directly. Throws only on
 * transport-level failures (no browser available, malformed URL, RNG
 * unavailable for the nonce).
 */
export async function startTelegramOidcLogin(options?: {
  /** Pending referral code — rides the login URL like the web flow. */
  referralCode?: string;
}): Promise<string | null> {
  // F-1: mint + persist the app-instance nonce BEFORE the browser opens.
  const appNonce = generateAppNonce();
  await persistPendingNonce(appNonce);

  const login = new URL(`${API_URL}/api/auth/telegram/oidc/login`);
  login.searchParams.set("native", "1");
  login.searchParams.set("app_nonce", appNonce);
  if (options?.referralCode) login.searchParams.set("ref", options.referralCode);

  const result = await WebBrowser.openAuthSessionAsync(
    login.toString(),
    TELEGRAM_AUTH_CALLBACK_URL,
  );

  // iOS contract: once the session resolves, dismiss the Safari auth
  // sheet (a no-op on Android, where the custom tab closes itself on
  // the scheme redirect).
  WebBrowser.maybeCompleteAuthSession();

  if (result.type !== "success") return null;
  const settled = await settleTelegramCallbackUrl(result.url);
  return settled.status === "ok" ? settled.token : null;
}

/** Test-only: reset the in-memory replay window between test cases. */
export function __resetTelegramCallbackStateForTests(): void {
  recentAccept = null;
}
