import { beforeEach, describe, expect, it } from "vitest";

import {
  clearStoredToken,
  getStoredToken,
  parseAuthTokenFromSetCookie,
  storeToken,
} from "@/lib/auth-store";
import { __resetMobileStores } from "@/test/setup";

/**
 * The native session capture — the JWT extraction from joined Set-Cookie
 * headers. This is the auth transport for the whole app: RN joins multiple
 * Set-Cookie values with commas and cookie attributes (Expires=Wed, 21
 * Oct…) embed commas, but the JWT is base64url+dots only — the extraction
 * must be exact regardless of what follows.
 */
describe("parseAuthTokenFromSetCookie", () => {
  it("extracts the token from a single cookie", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.sig";
    expect(parseAuthTokenFromSetCookie(`auth_token=${jwt}; Path=/; HttpOnly`)).toBe(jwt);
  });

  it("extracts from a comma-joined multi-cookie header", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.sig";
    const joined = `other=1; Path=/, auth_token=${jwt}; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`;
    expect(parseAuthTokenFromSetCookie(joined)).toBe(jwt);
  });

  it("returns null for the web sentinel value", () => {
    expect(parseAuthTokenFromSetCookie("auth_token=__cookie_session__; Path=/")).toBeNull();
  });

  it("returns null when absent, empty, or malformed", () => {
    expect(parseAuthTokenFromSetCookie(null)).toBeNull();
    expect(parseAuthTokenFromSetCookie("")).toBeNull();
    expect(parseAuthTokenFromSetCookie("other=1; Path=/")).toBeNull();
    expect(parseAuthTokenFromSetCookie("auth_token=; Path=/")).toBeNull();
  });

  it("does not capture similarly-prefixed names", () => {
    expect(parseAuthTokenFromSetCookie("admin_token=xyz; Path=/")).toBeNull();
    expect(parseAuthTokenFromSetCookie("xauth_token=xyz; Path=/")).toBeNull();
  });
});

describe("SecureStore-backed token storage", () => {
  beforeEach(() => {
    __resetMobileStores();
  });

  it("round-trips store → get → clear", async () => {
    await storeToken("tok-123");
    expect(await getStoredToken()).toBe("tok-123");
    await clearStoredToken();
    expect(await getStoredToken()).toBeNull();
  });

  it("clearing a missing key is a safe no-op", async () => {
    await clearStoredToken();
    expect(await getStoredToken()).toBeNull();
  });
});
