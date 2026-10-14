/**
 * L1-1 (R143) — the onboarding first-run journey, wired.
 *
 * The /onboarding page (route + POST /api/auth/onboarding/complete + the
 * onboarded_at bounce gate) shipped five months ago, and is_new_user is
 * returned by every session mint (Firebase exchange, WhatsApp verify,
 * Telegram callback) — but NO auth success path consumed it, so a
 * brand-new user landed on "/" and the welcome surface was unreachable
 * (the exact "orphaned journey" L1-1 filed).
 *
 * The wiring contract pinned here (register.tsx + telegram-callback.tsx
 * — the pages side; the components half lives in AuthProviders /
 * WhatsAppPhoneSignIn):
 *   1. register, no ?redirect= + is_new_user → /onboarding;
 *   2. register, no ?redirect= + returning user → /;
 *   3. register, explicit ?redirect= target → the target WINS even for a
 *      brand-new user (onboarding only when the user asked for no
 *      specific page — the checkout/product funnel return path keeps
 *      precedence);
 *   4. telegram-callback, no redirect + is_new_user → /onboarding;
 *   5. telegram-callback, no redirect + returning → /;
 *   6. telegram-callback, explicit ?redirect= → the target wins (the
 *      93-C5 / F-15 funnel contract unchanged).
 *
 * Harness: register-return-path.test.tsx's idiom — the heavy auth
 * children are mocked at the module boundary, AuthProviders becomes a
 * probe that invokes onSuccess(token, isNewUser) on demand;
 * telegram-callback's POST /api/auth/telegram rides a stubbed global
 * fetch returning REAL Response objects (res.json() needs .json()).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "@/pages/register";
import TelegramCallbackPage from "@/pages/telegram-callback";

const setTokenMock = vi.fn();

// The provider's is_new_user threading, controllable per test — the
// real AuthProviders reads it off the session mint's response.
const probeState = { isNewUser: false };

vi.mock("@/components/AuthErrorBanner", () => ({ AuthErrorBanner: () => null }));
vi.mock("@/components/AuthProviders", () => ({
  // The probe (register-return-path's idiom, extended with the L1-1
  // second arg): clicking invokes the page's onSuccess with
  // (token, isNewUser) — the value the provider threads from the
  // session mint (probeState above).
  AuthProviders: ({ onSuccess }: { onSuccess?: (token: string, isNewUser?: boolean) => void }) => (
    <button
      type="button"
      data-testid="auth-probe"
      onClick={() => onSuccess?.("jwt-register", probeState.isNewUser)}
    >
      probe-register
    </button>
  ),
}));
vi.mock("@/components/WhatsAppPhoneSignIn", () => ({ WhatsAppPhoneSignIn: () => null }));
vi.mock("@/components/layout/Logo", () => ({ Logo: () => null }));
vi.mock("@/hooks/use-public-auth-providers", () => ({
  usePublicAuthProviders: () => ({ whatsappEnabled: false, whatsappStatus: "disabled" }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ setToken: setTokenMock, token: null, user: null, ready: true }),
}));

function setPath(path: string) {
  // wouter v3 monkey-patches history.replaceState to dispatch a location
  // event — act() keeps any still-mounted subscriber inside React's test
  // environment (register-return-path.test.tsx's idiom).
  act(() => {
    window.history.replaceState({}, "", path);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenMock.mockClear();
  probeState.isNewUser = false;
  setPath("/");
});

/** Base64url-encode a Telegram payload the way oauth.telegram.org does. */
function tgFragment(data: Record<string, string | number>): string {
  const b64 = btoa(JSON.stringify(data));
  return `#tgAuthResult=${b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

describe("RegisterPage — the onboarding first hop (L1-1)", () => {
  it("a BRAND-NEW user with no redirect target lands on /onboarding", () => {
    setPath("/register");
    render(
      <Router>
        <RegisterPage />
      </Router>,
    );

    // The provider threads is_new_user from the session mint — the L1-1
    // second argument on the page's handleRegisterSuccess.
    probeState.isNewUser = true;
    fireEvent.click(screen.getByTestId("auth-probe"));

    expect(window.location.pathname).toBe("/onboarding");
  });

  it("a RETURNING user with no redirect target lands on home (the default is unchanged)", () => {
    setPath("/register");
    render(
      <Router>
        <RegisterPage />
      </Router>,
    );

    fireEvent.click(screen.getByTestId("auth-probe"));

    expect(window.location.pathname).toBe("/");
  });

  it("an explicit ?redirect= target WINS even for a brand-new user (onboarding never hijacks the funnel)", () => {
    setPath("/register?redirect=/checkout");
    render(
      <Router>
        <RegisterPage />
      </Router>,
    );

    probeState.isNewUser = true;
    fireEvent.click(screen.getByTestId("auth-probe"));

    expect(window.location.pathname).toBe("/checkout");
  });
});

describe("TelegramCallbackPage — the onboarding first hop (L1-1)", () => {
  function stubTelegramMint(body: Record<string, unknown>) {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("a BRAND-NEW user with no redirect target lands on /onboarding", async () => {
    setPath(`/auth/telegram-callback${tgFragment({ id: 42, hash: "sig", auth_date: 1 })}`);
    const fetchMock = stubTelegramMint({ token: "jwt-tg", is_new_user: true });
    render(
      <Router>
        <TelegramCallbackPage />
      </Router>,
    );

    await waitFor(() => expect(setTokenMock).toHaveBeenCalledWith("jwt-tg"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/onboarding");
  });

  it("a RETURNING user with no redirect target lands on home", async () => {
    setPath(`/auth/telegram-callback${tgFragment({ id: 42, hash: "sig", auth_date: 1 })}`);
    stubTelegramMint({ token: "jwt-tg", is_new_user: false });
    render(
      <Router>
        <TelegramCallbackPage />
      </Router>,
    );

    await waitFor(() => expect(setTokenMock).toHaveBeenCalledWith("jwt-tg"));
    expect(window.location.pathname).toBe("/");
  });

  it("an explicit ?redirect= target WINS even for a brand-new user (the 93-C5 / F-15 funnel contract unchanged)", async () => {
    setPath(
      `/auth/telegram-callback?redirect=%2Fcheckout${tgFragment({ id: 42, hash: "sig", auth_date: 1 })}`,
    );
    stubTelegramMint({ token: "jwt-tg", is_new_user: true });
    render(
      <Router>
        <TelegramCallbackPage />
      </Router>,
    );

    await waitFor(() => expect(setTokenMock).toHaveBeenCalledWith("jwt-tg"));
    expect(window.location.pathname).toBe("/checkout");
  });
});
