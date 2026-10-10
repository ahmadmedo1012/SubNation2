/**
 * R128-A2 (F-4) — the login page's account intent.
 *
 * The guarded account surfaces (wallet/orders/loyalty/referrals — plus
 * order-detail's /order/<id> gate) bounce guests to
 * /login?redirect=<path> with NO context: login's intent system modeled
 * only buy|generic, so a gated wallet visitor got the generic
 * value-chip banner («تسوّق فوري / محفظة آمنة / +50 نقطة») with no line
 * saying WHY they're here — while the buy-intent variant
 * («سجّل دخولك لإكمال شراء «X»») proved the pattern.
 *
 * R128-IMP-1 adds the "account" intent, keyed off the SAME sanitized
 * ?redirect= the success path honors (no new param for five gate pages
 * to learn). Pinned here:
 *   1. each account surface renders its contextual headline (and NOT
 *      the generic chips);
 *   2. a deep-linked order (/order/<id>) reads the orders headline;
 *   3. non-account redirects keep the generic chips (the regression
 *      guard — /support's login CTA must not sprout an account banner);
 *   4. an open-redirect value never reaches the banner logic (the
 *      sanitizeInternalPath guard runs first).
 *
 * Harness: register-return-path.test.tsx's idiom (history.replaceState
 * + heavy auth children mocked at the module boundary).
 */

import { act, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  // event — act() keeps any still-mounted subscriber inside React's test
  // environment (register-return-path.test.tsx's idiom); the path is
  // read synchronously by the page's useMemo.
  act(() => {
    window.history.replaceState({}, "", path);
  });
}

function renderAt(path: string) {
  setPath(path);
  return render(
    <Router>
      <LoginPage />
    </Router>,
  );
}

afterEach(() => {
  setPath("/");
});

describe("LoginPage — the account intent banner (R128-A2 F-4)", () => {
  it.each([
    ["/login?redirect=%2Fwallet", "سجّل دخولك للوصول إلى محفظتك"],
    ["/login?redirect=%2Forders", "سجّل دخولك لمتابعة طلباتك"],
    ["/login?redirect=%2Floyalty", "سجّل دخولك للوصول إلى نقاطك"],
    ["/login?redirect=%2Freferrals", "سجّل دخولك للوصول إلى برنامج الإحالات"],
    // A deep-linked order is the orders surface's detail page.
    ["/login?redirect=%2Forder%2F1042", "سجّل دخولك لمتابعة طلباتك"],
  ])("%s renders the contextual headline", (path, headline) => {
    renderAt(path);
    expect(screen.getByText(headline)).toBeInTheDocument();
    // The generic value chips are replaced by the account banner.
    expect(screen.queryByText("تسوّق فوري")).not.toBeInTheDocument();
    // The banner keeps the buy variant's passwordless sub-line.
    expect(screen.getByText("ثوانٍ معدودة بدون كلمة مرور")).toBeInTheDocument();
  });

  it("a redirect carrying its own query still maps (/wallet?return=… is the wallet surface)", () => {
    renderAt("/login?redirect=" + encodeURIComponent("/wallet?return=/product/netflix-1m"));
    expect(screen.getByText("سجّل دخولك للوصول إلى محفظتك")).toBeInTheDocument();
  });

  it("non-account redirects keep the generic value chips (no banner sprawl)", () => {
    // support's login CTA links /login?redirect=/support — not an
    // account surface; the generic chips are the honest variant there.
    renderAt("/login?redirect=/support");
    expect(screen.getByText("تسوّق فوري")).toBeInTheDocument();
    expect(screen.queryByText(/سجّل دخولك للوصول/)).not.toBeInTheDocument();
  });

  it("an open-redirect value never reaches the banner logic (guard parity with the success path)", () => {
    renderAt("/login?redirect=//evil.com");
    expect(screen.getByText("تسوّق فوري")).toBeInTheDocument();
    expect(screen.queryByText(/سجّل دخولك للوصول/)).not.toBeInTheDocument();
  });

  it("a bare /login keeps the generic chips (the cold prompt is unchanged)", () => {
    renderAt("/login");
    expect(screen.getByText("تسوّق فوري")).toBeInTheDocument();
  });
});
