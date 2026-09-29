/**
 * R115 (welcome-bonus POLICY B, A8 P1) — the honest auth-page promises.
 *
 * The pre-R115 register banner promised «ستُضاف مكافأة ترحيب 5.00 د.ل إلى
 * محفظتك فور إتمام التسجيل» — true only for Google/WhatsApp referrals and
 * permanently FALSE for Telegram. R115 unified every channel to policy B:
 * the referred user's 5 LYD credit AND the referrer's +50 points both land
 * when the friend's FIRST topup is APPROVED (topup.service.ts — the manual
 * approval is the fraud gate). The login value chip's «50 نقطة عند
 * الإحالة» implied points at referral/signup.
 *
 * These tests pin the honest copy on all three pre-auth surfaces:
 *   1. register ?ref= banner: first-approved-topup trigger + the
 *      per-side detail (you: 5.00 د.ل credit, friend: 50 points) — and
 *      the OLD «فور إتمام التسجيل» promise is gone.
 *   2. register no-ref chip: «عند اعتماد أول شحن له».
 *   3. login chip: «+50 نقطة عند أول شحن لصديقك» (not «عند الإحالة»).
 *
 * Heavy auth children (AuthProviders/WhatsAppPhoneSignIn/…) are mocked at
 * the module boundary — this file pins COPY, not the auth machinery.
 */

import { act, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "@/pages/register";
import LoginPage from "@/pages/login";

vi.mock("@/components/AuthErrorBanner", () => ({ AuthErrorBanner: () => null }));
vi.mock("@/components/AuthProviders", () => ({ AuthProviders: () => null }));
vi.mock("@/components/WhatsAppPhoneSignIn", () => ({ WhatsAppPhoneSignIn: () => null }));
vi.mock("@/components/layout/Logo", () => ({ Logo: () => null }));
vi.mock("@/hooks/use-public-auth-providers", () => ({
  usePublicAuthProviders: () => ({ whatsappEnabled: false, whatsappStatus: "disabled" }),
}));

function setPath(path: string) {
  // wouter v3 monkey-patches history.replaceState to dispatch a location
  // event — any still-mounted subscriber re-renders. Wrapping in act()
  // keeps those updates inside React's test environment (no act
  // warnings); the path is read synchronously by the pages' useMemo.
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

describe("RegisterPage — the welcome-bonus promise matches policy B (R115 A8 P1)", () => {
  it("?ref= banner states the FIRST-APPROVED-TOPUP trigger + both rewards, never «فور إتمام التسجيل»", () => {
    renderAt("/register?ref=SNTEST", <RegisterPage />);

    // The honest trigger headline.
    expect(
      screen.getByText("عند أول شحن معتمد عبر كود إحالة تحصل أنت وصديقك على مكافآت"),
    ).toBeInTheDocument();

    // The per-side detail: the registrant's 5.00 د.ل credit…
    expect(screen.getByText("5.00 د.ل")).toBeInTheDocument();
    // …and the referrer's +50 points at the same moment.
    expect(screen.getByText(/ويحصل صديقك على/)).toBeInTheDocument();
    expect(screen.getByText(/عند اعتماد أول شحن لك/)).toBeInTheDocument();

    // The OLD unconditional-at-signup promise must be GONE.
    expect(screen.queryByText(/فور إتمام التسجيل/)).not.toBeInTheDocument();
  });

  it("the no-ref chip conditions the referrer reward on the approved first topup", () => {
    renderAt("/register", <RegisterPage />);

    expect(screen.getByText(/50 نقطة ولاء/)).toBeInTheDocument();
    expect(screen.getByText(/عند اعتماد أول شحن له/)).toBeInTheDocument();
  });
});

describe("LoginPage — the referral value chip is precise (R115 A8 #9)", () => {
  it("reads «+50 نقطة عند أول شحن لصديقك», not the signup-implying «عند الإحالة»", () => {
    renderAt("/login", <LoginPage />);

    expect(screen.getByText("+50 نقطة عند أول شحن لصديقك")).toBeInTheDocument();
    expect(screen.queryByText("50 نقطة عند الإحالة")).not.toBeInTheDocument();
  });
});
