/**
 * R123-E4a (P2) — the register half of the funnel return path.
 *
 * A guest on /login?redirect=/checkout (or a product buy-intent link
 * /login?intent=buy&product=X&redirect=/product/Y) who switched to the
 * «حساب جديد» tab used to lose the return path: the tab linked a bare
 * /register, register.tsx rendered its auth surfaces WITHOUT onSuccess
 * and never read ?redirect= — registering always landed on "/" and the
 * checkout/product funnel died.
 *
 * These tests pin the R123-E4a fix, following the login-redirect idiom
 * (register-welcome-copy.test.tsx's harness):
 *   1. login's «حساب جديد» tab + footer link forward the SANITIZED
 *      ?redirect= to /register.
 *   2. An open-redirect value is NOT forwarded (the guard — slash-prefix
 *      + //reject + same-origin, lib/utils sanitizeInternalPath — runs
 *      before the link is built).
 *   3. register threads onSuccess to its auth surfaces — a successful
 *      register navigates to the sanitized target.
 *   4. register's own back-links (tab + footer) forward the redirect to
 *      /login, so switching back doesn't drop the funnel either.
 *
 * L1-1 (R143) re-anchored the no-target rows: handleRegisterSuccess is
 * now wired UNCONDITIONALLY (the orphaned onboarding journey), so a
 * probe click with no explicit target navigates to the returning-user
 * default "/" (and the onboarding cases live in
 * auth-onboarding-journey-r143.test.tsx).
 *
 * Heavy auth children are mocked at the module boundary; AuthProviders
 * becomes a probe that exposes the onSuccess prop (the real component
 * runs the whole Firebase/Telegram machinery — out of scope for the
 * return-path contract).
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "@/pages/register";
import LoginPage from "@/pages/login";

vi.mock("@/components/auth/AuthErrorBanner", () => ({ AuthErrorBanner: () => null }));
vi.mock("@/components/auth/AuthProviders", () => ({
  // The probe: clicking it invokes whatever onSuccess register passed
  // (undefined renders a dead button — exactly the pre-R123 state).
  AuthProviders: ({ onSuccess }: { onSuccess?: () => void }) => (
    <button type="button" data-testid="auth-probe" onClick={onSuccess}>
      probe-register
    </button>
  ),
}));
vi.mock("@/components/auth/WhatsAppPhoneSignIn", () => ({ WhatsAppPhoneSignIn: () => null }));
vi.mock("@/components/layout/Logo", () => ({ Logo: () => null }));
vi.mock("@/hooks/usePublicAuthProviders", () => ({
  usePublicAuthProviders: () => ({ whatsappEnabled: false, whatsappStatus: "disabled" }),
}));

function setPath(path: string) {
  // wouter v3 monkey-patches history.replaceState to dispatch a location
  // event — act() keeps any still-mounted subscriber inside React's test
  // environment (register-welcome-copy.test.tsx's idiom); the path is
  // read synchronously by the pages' useMemo.
  act(() => {
    window.history.replaceState({}, "", path);
  });
}

function renderAt(path: string, ui: React.ReactElement) {
  setPath(path);
  return render(<Router>{ui}</Router>);
}

afterEach(() => {
  setPath("/");
});

describe("LoginPage — the register tab forwards the funnel redirect (R123-E4a P2)", () => {
  it("«حساب جديد» tab + footer link carry the sanitized ?redirect= to /register", () => {
    renderAt("/login?redirect=/checkout", <LoginPage />);

    expect(screen.getByRole("link", { name: "حساب جديد" })).toHaveAttribute(
      "href",
      "/register?redirect=%2Fcheckout",
    );
    expect(screen.getByRole("link", { name: "إنشاء حساب جديد" })).toHaveAttribute(
      "href",
      "/register?redirect=%2Fcheckout",
    );
  });

  it("an open-redirect value is dropped — the tab links a bare /register", () => {
    // Protocol-relative //evil.com passes a startsWith("/") check but
    // fails the sanitizer (same guard semantics as login's own ?redirect=
    // handling — //reject + same-origin).
    renderAt("/login?redirect=//evil.com", <LoginPage />);

    expect(screen.getByRole("link", { name: "حساب جديد" })).toHaveAttribute("href", "/register");
  });
});

describe("RegisterPage — onSuccess threads the return path (R123-E4a P2)", () => {
  it("a successful register navigates to the sanitized ?redirect= target", () => {
    renderAt("/register?redirect=/checkout", <RegisterPage />);

    fireEvent.click(screen.getByTestId("auth-probe"));

    expect(window.location.pathname).toBe("/checkout");
  });

  it("no ?redirect= — the returning-user default: the always-wired handler lands on home (L1-1)", () => {
    // L1-1 (R143): the handler no longer sits inert without a target —
    // onSuccess(token) with no is_new_user (the probe calls it bare) is
    // a RETURNING user, so the default navigation is "/". The
    // brand-new-user arm (/onboarding) is pinned in
    // auth-onboarding-journey-r143.test.tsx.
    renderAt("/register", <RegisterPage />);

    fireEvent.click(screen.getByTestId("auth-probe"));

    expect(window.location.pathname).toBe("/");
  });

  it("an open-redirect target is never navigated to — the guard holds, the default home applies (guard parity with login)", () => {
    renderAt("/register?redirect=//evil.com", <RegisterPage />);

    fireEvent.click(screen.getByTestId("auth-probe"));

    // The sanitizer dropped //evil.com BEFORE the handler ran (the
    // returning-user default above applies) — the open-redirect value
    // never reaches navigate().
    expect(window.location.pathname).toBe("/");
  });

  it("the back-links to /login forward the redirect so the funnel survives switching back", () => {
    renderAt("/register?redirect=/checkout", <RegisterPage />);

    // Tab + footer links both carry the sanitized target back to /login.
    const backLinks = screen.getAllByRole("link", { name: "تسجيل الدخول" });
    expect(backLinks).toHaveLength(2);
    for (const link of backLinks) {
      expect(link).toHaveAttribute("href", "/login?redirect=%2Fcheckout");
    }
  });
});

describe("R146 (audit-frontend-pages F3) — the auth tab links forward ?ref= (referred signups keep attribution)", () => {
  it("login's «حساب جديد» tab + footer link carry ?ref= when it is the only param", () => {
    renderAt("/login?ref=FRIEND12", <LoginPage />);

    expect(screen.getByRole("link", { name: "حساب جديد" })).toHaveAttribute(
      "href",
      "/register?ref=FRIEND12",
    );
    expect(screen.getByRole("link", { name: "إنشاء حساب جديد" })).toHaveAttribute(
      "href",
      "/register?ref=FRIEND12",
    );
  });

  it("login's register links carry redirect AND ref together", () => {
    renderAt("/login?redirect=/checkout&ref=FRIEND12", <LoginPage />);

    expect(screen.getByRole("link", { name: "حساب جديد" })).toHaveAttribute(
      "href",
      "/register?redirect=%2Fcheckout&ref=FRIEND12",
    );
    expect(screen.getByRole("link", { name: "إنشاء حساب جديد" })).toHaveAttribute(
      "href",
      "/register?redirect=%2Fcheckout&ref=FRIEND12",
    );
  });

  it("register's back-links (tab + footer) carry ?ref= back to /login", () => {
    renderAt("/register?ref=FRIEND12", <RegisterPage />);

    const backLinks = screen.getAllByRole("link", { name: "تسجيل الدخول" });
    expect(backLinks).toHaveLength(2);
    for (const link of backLinks) {
      expect(link).toHaveAttribute("href", "/login?ref=FRIEND12");
    }
  });

  it("register's back-links carry redirect AND ref together", () => {
    renderAt("/register?redirect=/checkout&ref=FRIEND12", <RegisterPage />);

    const backLinks = screen.getAllByRole("link", { name: "تسجيل الدخول" });
    for (const link of backLinks) {
      expect(link).toHaveAttribute("href", "/login?redirect=%2Fcheckout&ref=FRIEND12");
    }
  });

  it("no ref → the links stay exactly as R123-E4a built them (no phantom param)", () => {
    renderAt("/login?redirect=/checkout", <LoginPage />);

    expect(screen.getByRole("link", { name: "حساب جديد" })).toHaveAttribute(
      "href",
      "/register?redirect=%2Fcheckout",
    );
  });
});
