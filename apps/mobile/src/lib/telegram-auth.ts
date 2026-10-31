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
 * the app never sees a secret). With `native=1` the backend MUST
 * redirect a SUCCESSFUL auth back to the app's deep link instead of
 * the web's cookie-bounce page:
 *
 *   subnation://auth/callback#token=<30-day JWT>
 *
 * Fragment transport (the token never hits server access logs — the
 * same property Telegram itself relies on for #tgAuthResult). The
 * client ALSO accepts the token as a plain query parameter
 * (subnation://auth/callback?token=<jwt>) for platforms that strip
 * fragments from deep links. A session that returns WITHOUT a token is
 * a user cancellation — callers do nothing.
 */

/** The exact deep-link the backend must redirect native Telegram auth to. */
export const TELEGRAM_AUTH_CALLBACK_URL = "subnation://auth/callback";

/** True when a URL is a Telegram auth callback (token or not). */
export function isTelegramAuthCallback(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith(TELEGRAM_AUTH_CALLBACK_URL);
}

/**
 * Extract the session JWT from a Telegram auth callback URL — accepts
 * the fragment form (#token=) AND the query form (?token=).
 */
export function extractTelegramCallbackToken(url: string | null | undefined): string | null {
  if (!url) return null;
  // Fragment first (the specced transport), then query, then a
  // tolerant last-resort match for link stacks that reorder parts.
  const fragmentIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");
  const parts: string[] = [];
  if (fragmentIndex !== -1) parts.push(url.slice(fragmentIndex + 1));
  if (queryIndex !== -1) {
    const end = fragmentIndex > queryIndex ? fragmentIndex : undefined;
    parts.push(url.slice(queryIndex + 1, end));
  }
  for (const part of parts) {
    const token = new URLSearchParams(part).get("token");
    if (token) return token;
  }
  const loose = /[#&?]token=([^&#\s]+)/.exec(url);
  return loose?.[1] ?? null;
}

/**
 * Start the Telegram OIDC login in the system auth browser
 * (ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android)
 * and resolve the session JWT when the backend redirects back to the
 * app's deep link. Resolves null when the user cancelled (or the
 * redirect carried no token — the login screen's Linking listener is
 * the safety net for the Android race where the auth session resolves
 * `dismiss` before the url event lands). Throws only on transport-level
 * failures (no browser available, malformed URL).
 */
export async function startTelegramOidcLogin(options?: {
  /** Pending referral code — rides the login URL like the web flow. */
  referralCode?: string;
}): Promise<string | null> {
  const login = new URL(`${API_URL}/api/auth/telegram/oidc/login`);
  login.searchParams.set("native", "1");
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
  return extractTelegramCallbackToken(result.url);
}
