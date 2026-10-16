/**
 * R153 (Phase D — coverage gap): AuthCallbackPage behavioral tests.
 *
 * The page's three behaviors were previously pinned only by string-level
 * assertions in the decomposition/visual suites — nothing rendered the
 * component and exercised its branches:
 *
 *   1. the happy path bounces to "/" (the F-010 cookie-only contract —
 *      the backend set the httpOnly cookie on the redirect; the probe
 *      seeds the session);
 *   2. a ?auth_error=… arrival bounces to /login?error=… (encoded),
 *      never to "/" — an auth failure must not land the user on the
 *      authed shell's redirect loop;
 *   3. the 12 s hang escape: if the page stays mounted past the
 *      timeout, the destructive «انقطع الاتصال» state paints with the
 *      /login CTA (a permanent silent spinner is the alternative).
 *
 * Harness: the guarded-page suite idiom (Router from wouter + fake
 * timers for the 12 s branch).
 */

import { act, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthCallbackPage from "@/pages/auth-callback";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.history.pushState(null, "", "/");
});

function renderPage() {
  return render(
    <Router>
      <AuthCallbackPage />
    </Router>,
  );
}

describe("AuthCallbackPage — the cookie-bounce contract (R153 behavioral pins)", () => {
  it('a clean arrival (no auth_error) bounces to "/" and paints the spinner state', async () => {
    window.history.pushState(null, "", "/auth/callback");
    renderPage();

    // Flush the mount effect's navigate only — do NOT advance timers
    // (runOnlyPendingTimers would fire the 12 s hang escape early).
    await act(async () => {
      await Promise.resolve();
    });
    expect(window.location.pathname).toBe("/");
    // Pre-timeout: the loading state, not the hang escape.
    expect(screen.getByText("جارٍ تسجيل الدخول…")).toBeTruthy();
    expect(screen.queryByText("انقطع الاتصال أثناء تسجيل الدخول")).toBeNull();
  });

  it('an ?auth_error=… arrival bounces to /login with the encoded error — never to "/"', async () => {
    window.history.pushState(null, "", "/auth/callback?auth_error=oauth_stalled");
    renderPage();

    await act(async () => {
      await Promise.resolve();
    });
    expect(window.location.pathname).toBe("/login");
    expect(window.location.search).toBe("?error=oauth_stalled");
    expect(window.location.pathname).not.toBe("/");
  });

  it("the 12 s hang escape paints the destructive state with the /login CTA", async () => {
    window.history.pushState(null, "", "/auth/callback");
    renderPage();

    // The bounce navigates away, but the failure mode this covers is the
    // SPA transition itself stalling — the component stays mounted.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_500);
    });
    expect(screen.getByText("انقطع الاتصال أثناء تسجيل الدخول")).toBeTruthy();
    const cta = screen.getByRole("link", { name: "العودة لتسجيل الدخول" });
    expect(cta.getAttribute("href")).toBe("/login");
    expect(screen.queryByText("جارٍ تسجيل الدخول…")).toBeNull();
  });
});
