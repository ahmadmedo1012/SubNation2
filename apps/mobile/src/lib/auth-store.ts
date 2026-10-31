import * as SecureStore from "expo-secure-store";

/**
 * Native session storage.
 *
 * The backend mints the 30-day HS256 JWT (`{userId, sessionId}`) into the
 * httpOnly `auth_token` Set-Cookie header on every session-mint endpoint
 * and returns the `__cookie_session__` sentinel in the body (the web's
 * XSS-safe contract). A native HTTP client CAN read Set-Cookie — that is
 * the sanctioned native transport: capture the cookie at mint time, keep
 * the JWT in SecureStore (never AsyncStorage), present it as a Bearer
 * token. Session rows stay revocable server-side (`sessions` table,
 * logout / logout-all-devices / per-device delete), so nothing about the
 * web's revocation model changes.
 */

const TOKEN_KEY = "subnation.auth_token";

export async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    // A SecureStore failure must not crash the app at boot — treat as
    // logged-out and let the user sign in again.
    return null;
  }
}

export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearStoredToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Deleting a missing/failed key is a no-op state-wise.
  }
}

/**
 * Extract the `auth_token` JWT value from a Set-Cookie header value.
 *
 * React Native joins multiple Set-Cookie headers with commas, and the
 * cookie attributes (Expires=Wed, 21 Oct...) can contain commas too —
 * but the JWT itself is base64url+dots only (no `;`, `,`, or whitespace),
 * so the character-class match is exact regardless of what follows.
 */
export function parseAuthTokenFromSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = /(?:^|,\s*)auth_token=([^;,\s]+)/.exec(setCookie);
  const value = match?.[1];
  if (!value || value === "__cookie_session__") return null;
  return value;
}

/**
 * Mint a native session from a session-mint endpoint.
 *
 * POSTs to `path` with the CSRF Origin header, reads the `auth_token`
 * cookie from the response, stores it, and returns it. Throws the parsed
 * error envelope when the mint fails.
 */
export async function mintNativeSession(
  path: string,
  body: unknown,
  apiBaseUrl: string,
): Promise<string> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: apiBaseUrl,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data: { error?: string; code?: string } = text
    ? (JSON.parse(text) as { error?: string; code?: string })
    : {};

  if (!response.ok) {
    const error = new Error(data.error ?? "auth failed") as Error & {
      code?: string;
      status?: number;
    };
    error.code = data.code;
    error.status = response.status;
    throw error;
  }

  // Set-Cookie via RN/expo fetch: `headers.get` returns the joined value.
  const setCookie = response.headers.get("set-cookie");
  const token = parseAuthTokenFromSetCookie(setCookie);
  if (!token) {
    const error = new Error("لم يتم استلام رمز الجلسة من الخادم") as Error & {
      code?: string;
      status?: number;
    };
    error.code = "NO_SESSION_COOKIE";
    error.status = response.status;
    throw error;
  }

  await storeToken(token);
  return token;
}
