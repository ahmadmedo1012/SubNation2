import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync: vi.fn(),
  maybeCompleteAuthSession: vi.fn(),
}));

import {
  __resetTelegramCallbackStateForTests,
  isTelegramAuthCallback,
  settleTelegramCallbackUrl,
  startTelegramOidcLogin,
} from "@/lib/telegram-auth";
import { __resetMobileStores } from "@/test/setup";

/** The auth-session result union (WebBrowserResultType is a nominal enum —
 * string literals need the cast). */
type AuthSessionResult = Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;

/**
 * R192 (security, F-1) — the Telegram native bridge's app-instance nonce:
 * the callback's token is accepted ONLY when the URL's app_nonce matches
 * the pending nonce THIS app instance minted and stored in SecureStore at
 * flow start. A forged deep link (login-CSRF / silent session
 * substitution), a stale/expired flow, and a replayed legitimate callback
 * are all rejected — the token is never handed back to the caller.
 */

const PENDING_NONCE_KEY = "subnation.telegram.pending_nonce";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.sig";
const NONCE = "R192nonceAbCdEfGhIjKlMnOpQrStUv"; // 27 chars, base64url shape

async function seedPendingNonce(nonce: string, ageMs = 0): Promise<void> {
  await SecureStore.setItemAsync(
    PENDING_NONCE_KEY,
    JSON.stringify({ n: nonce, t: Date.now() - ageMs }),
  );
}

async function pendingNonceExists(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PENDING_NONCE_KEY)) !== null;
}

describe("isTelegramAuthCallback", () => {
  it("recognizes the scheme URL with and without fragment/query", () => {
    expect(isTelegramAuthCallback("subnation://auth/callback#token=x")).toBe(true);
    expect(isTelegramAuthCallback("subnation://auth/callback?token=x")).toBe(true);
    expect(isTelegramAuthCallback("subnation://auth/callback")).toBe(true);
  });

  it("rejects foreign URLs, lookalikes, and empties", () => {
    expect(isTelegramAuthCallback(null)).toBe(false);
    expect(isTelegramAuthCallback("https://subnation.ly/auth/callback#token=x")).toBe(false);
    expect(isTelegramAuthCallback("subnation://auth/callback-other#token=x")).toBe(false);
    expect(isTelegramAuthCallback("evil://auth/callback#token=x")).toBe(false);
  });
});

describe("settleTelegramCallbackUrl — the F-1 verification gate", () => {
  beforeEach(() => {
    __resetMobileStores();
    __resetTelegramCallbackStateForTests();
  });

  it("ACCEPTS a callback whose app_nonce matches the pending nonce (and consumes it)", async () => {
    await seedPendingNonce(NONCE);
    const settlement = await settleTelegramCallbackUrl(
      `subnation://auth/callback#token=${JWT}&app_nonce=${NONCE}`,
    );
    expect(settlement).toEqual({ status: "ok", token: JWT });
    expect(await pendingNonceExists()).toBe(false); // single use — consumed
  });

  it("REJECTS an injected callback with NO app_nonce (login-CSRF: never returns the token)", async () => {
    await seedPendingNonce(NONCE);
    const settlement = await settleTelegramCallbackUrl(`subnation://auth/callback#token=${JWT}`);
    expect(settlement).toEqual({ status: "rejected" });
    expect(await pendingNonceExists()).toBe(false); // fail closed + reset
  });

  it("REJECTS an injected callback with a WRONG app_nonce", async () => {
    await seedPendingNonce(NONCE);
    const settlement = await settleTelegramCallbackUrl(
      `subnation://auth/callback#token=${JWT}&app_nonce=attacker-forged-nonce-0001`,
    );
    expect(settlement).toEqual({ status: "rejected" });
  });

  it("REJECTS any token when NO flow is pending (app killed, flow never started)", async () => {
    const settlement = await settleTelegramCallbackUrl(
      `subnation://auth/callback#token=${JWT}&app_nonce=${NONCE}`,
    );
    expect(settlement).toEqual({ status: "rejected" });
  });

  it("REJECTS when the pending flow EXPIRED (10-minute window)", async () => {
    await seedPendingNonce(NONCE, 11 * 60 * 1000);
    const settlement = await settleTelegramCallbackUrl(
      `subnation://auth/callback#token=${JWT}&app_nonce=${NONCE}`,
    );
    expect(settlement).toEqual({ status: "rejected" });
  });

  it("treats a tokenless callback as a cancellation (not an attack)", async () => {
    await seedPendingNonce(NONCE);
    expect(await settleTelegramCallbackUrl("subnation://auth/callback")).toEqual({
      status: "cancelled",
    });
    // A cancellation does NOT burn the pending flow — the user may retry
    // through the still-open browser session.
    expect(await pendingNonceExists()).toBe(true);
  });

  it("ignores URLs that are not Telegram callbacks", async () => {
    expect(await settleTelegramCallbackUrl(null)).toEqual({ status: "ignored" });
    expect(await settleTelegramCallbackUrl("https://subnation.ly/")).toEqual({
      status: "ignored",
    });
  });

  it("idempotent re-delivery: the SAME token is ok twice (the Android double-delivery race)", async () => {
    await seedPendingNonce(NONCE);
    const url = `subnation://auth/callback#token=${JWT}&app_nonce=${NONCE}`;
    expect(await settleTelegramCallbackUrl(url)).toEqual({ status: "ok", token: JWT });
    expect(await settleTelegramCallbackUrl(url)).toEqual({ status: "ok", token: JWT });
  });

  it("a DIFFERENT token after an accepted one stays rejected (replay ≠ re-delivery)", async () => {
    await seedPendingNonce(NONCE);
    const url = `subnation://auth/callback#token=${JWT}&app_nonce=${NONCE}`;
    expect(await settleTelegramCallbackUrl(url)).toEqual({ status: "ok", token: JWT });
    const other = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjk5f9.attacker";
    expect(
      await settleTelegramCallbackUrl(
        `subnation://auth/callback#token=${other}&app_nonce=${NONCE}`,
      ),
    ).toEqual({ status: "rejected" });
  });

  it("accepts the query-param transport too (fragment-stripping link stacks)", async () => {
    await seedPendingNonce(NONCE);
    const settlement = await settleTelegramCallbackUrl(
      `subnation://auth/callback?token=${JWT}&app_nonce=${NONCE}`,
    );
    expect(settlement).toEqual({ status: "ok", token: JWT });
  });
});

describe("startTelegramOidcLogin — the flow start side", () => {
  const openAuthSessionAsync = vi.mocked(WebBrowser.openAuthSessionAsync);

  beforeEach(() => {
    __resetMobileStores();
    __resetTelegramCallbackStateForTests();
    openAuthSessionAsync.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints + persists a pending nonce and carries it on the login URL as app_nonce", async () => {
    openAuthSessionAsync.mockResolvedValue({ type: "dismiss" } as AuthSessionResult); // user cancels
    await startTelegramOidcLogin();

    const loginUrl = openAuthSessionAsync.mock.calls[0]?.[0] as string;
    expect(loginUrl).toContain("/api/auth/telegram/oidc/login?");
    expect(loginUrl).toContain("native=1");
    const appNonce = new URL(loginUrl).searchParams.get("app_nonce");
    expect(appNonce).toBeTruthy();
    expect(appNonce).toMatch(/^[A-Za-z0-9_-]{32}$/); // 24 bytes → 32 base64url chars

    // The SAME nonce is persisted as the pending flow record.
    const raw = await SecureStore.getItemAsync(PENDING_NONCE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).n).toBe(appNonce);
  });

  it("returns the token when the auth session resolves with the matching callback", async () => {
    openAuthSessionAsync.mockImplementation(async (loginUrl: string) => {
      const appNonce = new URL(loginUrl as string).searchParams.get("app_nonce");
      return {
        type: "success",
        url: `subnation://auth/callback#token=${JWT}&app_nonce=${appNonce}`,
      };
    });
    const token = await startTelegramOidcLogin();
    expect(token).toBe(JWT);
    expect(await pendingNonceExists()).toBe(false); // consumed
  });

  it("returns null on user cancellation (pending flow stays armed for retry)", async () => {
    openAuthSessionAsync.mockResolvedValue({ type: "dismiss" } as AuthSessionResult);
    expect(await startTelegramOidcLogin()).toBeNull();
    expect(await pendingNonceExists()).toBe(true);
  });

  it("returns null — NEVER the token — when the session result is an injected callback", async () => {
    await seedPendingNonce(NONCE);
    openAuthSessionAsync.mockResolvedValue({
      type: "success",
      url: `subnation://auth/callback#token=${JWT}`, // no app_nonce — forged
    });
    expect(await startTelegramOidcLogin()).toBeNull();
    expect(await pendingNonceExists()).toBe(false); // cleared — fail closed
  });

  it("FAILS LOUD when the platform RNG is unavailable (no Math.random degradation on auth)", async () => {
    vi.stubGlobal("crypto", {}); // no getRandomValues
    await expect(startTelegramOidcLogin()).rejects.toThrow();
    expect(await pendingNonceExists()).toBe(false); // nothing persisted
  });
});
