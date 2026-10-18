/**
 * R146 (components audit F5) — the Telegram Mini App auto-login contract.
 *
 * The hook silently exchanges window.Telegram.WebApp.initData for a
 * session JWT (POST /api/auth/telegram/webapp) — an auth mint a
 * Telegram user rides straight into buying with, so its risk branches
 * must fail loudly here if a refactor drops one:
 *
 *   • skip-when-token-present — a dropped check re-mints sessions for
 *     already-authenticated users (login churn on every page load);
 *   • the triedRef once-guard — dropped, React StrictMode's double
 *     effect mints twice per mount;
 *   • the ?ref= threading — dropped, referred signups lose attribution;
 *   • the silent-no-op failure contract — a rejection must never toast,
 *     throw, or log (the redirect-flow TelegramLoginButton stays the
 *     fallback).
 */

import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setTokenMock } = vi.hoisted(() => ({ setTokenMock: vi.fn() }));
const { customFetchMock } = vi.hoisted(() => ({ customFetchMock: vi.fn() }));
const authState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: authState.token, setToken: setTokenMock }),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: customFetchMock,
}));

import { useTelegramWebAppAutoLogin } from "../useTelegramWebAppAutoLogin";

/** The initData Telegram injects inside the Mini App WebView. */
const INIT_DATA =
  "query_id=AAF1&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Sub%22%7D&auth_date=1760000000";

function Harness() {
  useTelegramWebAppAutoLogin();
  return null;
}

/** StrictMode double-invokes effects in the dev build — the mount the
 *  once-guard must survive in production Telegram traffic. */
function renderHook() {
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}

beforeEach(() => {
  customFetchMock.mockReset();
  setTokenMock.mockReset();
  authState.token = null;
  // A deep-linked Mini App launch: ?ref= referral + injected initData.
  window.history.replaceState(null, "", "/?ref=wonka");
  (window as unknown as { Telegram?: unknown }).Telegram = { WebApp: { initData: INIT_DATA } };
});

afterEach(() => {
  delete (window as unknown as { Telegram?: unknown }).Telegram;
  window.history.replaceState(null, "", "/");
});

describe("useTelegramWebAppAutoLogin — the silent session mint", () => {
  it("POSTs the initData with the referral code exactly ONCE per mount (StrictMode-safe) and stores the minted token", async () => {
    customFetchMock.mockResolvedValue({ token: "minted-jwt" });
    renderHook();

    await waitFor(() => expect(setTokenMock).toHaveBeenCalledWith("minted-jwt"));
    expect(customFetchMock).toHaveBeenCalledTimes(1);
    expect(customFetchMock).toHaveBeenCalledWith("/api/auth/telegram/webapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // ?ref=wonka threads through uppercased, mirroring the redirect flow.
      body: JSON.stringify({ initData: INIT_DATA, referralCode: "WONKA" }),
    });
  });

  it("never POSTs when a token already exists (no login churn for an authenticated session)", async () => {
    authState.token = "existing-jwt";
    renderHook();

    // Settle every effect + microtask the mount could have scheduled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(customFetchMock).not.toHaveBeenCalled();
    expect(setTokenMock).not.toHaveBeenCalled();
  });

  it("a rejection is a silent no-op — no setToken, no toast surface, nothing logged or thrown", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    customFetchMock.mockRejectedValue(new Error("502 upstream"));
    renderHook();

    await waitFor(() => expect(customFetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
