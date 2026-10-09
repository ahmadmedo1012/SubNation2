/**
 * R115 (welcome-bonus POLICY B, A8 P1) — the support FAQ stays honest.
 *
 * support.tsx:95's referral answer used to promise «مكافأة ترحيب 5 د.ل
 * تُضاف لمحفظته فور التسجيل» — false for the Telegram channel and, under
 * R115's unified policy B, false for every channel (the referred user's
 * credit lands on their FIRST APPROVED topup). The FAQ backs the FAQPage
 * JSON-LD (Google can downgrade rich results whose answers don't match
 * product behaviour), so the copy is pinned here at the rendered-page
 * level, exactly as the schema rules require.
 *
 * Harness: the support-open-ticket.test.tsx pattern (raw fetch stubbed at
 * the global, auth + toast mocked at the module boundary). The FAQ renders
 * whenever no ticket is selected.
 */

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupportPage from "@/pages/support";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function resLike(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => resLike([])),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SupportPage FAQ — the referral answer matches policy B (R115 A8 P1)", () => {
  it("conditions BOTH rewards on the first APPROVED topup — no «فور التسجيل»", async () => {
    render(
      <Router>
        <SupportPage />
      </Router>,
    );

    // The question renders visibly (JSON-LD parity requirement). findBy
    // (not getBy) so the mount fetches settle inside act() — the support
    // page loads the ticket list on mount and a synchronous assert raced
    // its state update.
    expect(await screen.findByText("هل أحصل على مكافأة عند دعوة أصدقائي؟")).toBeInTheDocument();

    // The answer states the approval trigger and BOTH sides' rewards.
    expect(screen.getByText(/عندما يعتمد فريقنا أول شحن/)).toBeInTheDocument();
    expect(screen.getByText(/مكافأة ترحيب 5 د\.ل تُضاف لمحفظته/)).toBeInTheDocument();
    expect(screen.getByText(/نقاط الولاء قابلة للتحويل/)).toBeInTheDocument();

    // The old at-signup promise must be gone.
    expect(screen.queryByText(/فور التسجيل/)).not.toBeInTheDocument();
  });
});

describe("SupportPage FAQ — the login answer is passwordless-truthful (R123-E4b P1)", () => {
  it("asks how to sign in WITHOUT a password and names Google / Telegram / WhatsApp OTP only", async () => {
    render(
      <Router>
        <SupportPage />
      </Router>,
    );

    // The question renders visibly (Google's schema rule: JSON-LD Q&A
    // must also be visible on the page).
    expect(await screen.findByText("كيف أسجّل الدخول بدون كلمة مرور؟")).toBeInTheDocument();

    // The answer names the three real methods — WhatsApp OTP included,
    // which the old answer omitted entirely.
    expect(
      screen.getByText(
        /الدخول عبر Google أو Telegram أو رمز تحقق يُرسل إلى واتساب — لا حاجة لكلمة مرور/,
      ),
    ).toBeInTheDocument();

    // The platform has NO email login: the old «البريد الإلكتروني
    // وGoogle وTelegram» claim must be gone, and so must the
    // password-recovery framing of the old question (the platform is
    // passwordless — there is nothing to recover; terms §3/§4 state
    // the provider/OTP model).
    expect(screen.queryByText(/البريد الإلكتروني/)).not.toBeInTheDocument();
    expect(screen.queryByText(/نسيت كلمة المرور/)).not.toBeInTheDocument();
  });

  it("the FAQPage JSON-LD carries the same corrected Q&A (single-source parity)", async () => {
    render(
      <Router>
        <SupportPage />
      </Router>,
    );
    await screen.findByText("كيف أسجّل الدخول بدون كلمة مرور؟");

    const scripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ) as HTMLScriptElement[];
    const faqScript = scripts.find((s) => s.textContent?.includes("FAQPage"));
    expect(faqScript).toBeTruthy();

    const ld = JSON.parse(faqScript!.textContent as string) as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    const auth = ld.mainEntity.find((q) => q.name.includes("بدون كلمة مرور"));
    expect(auth).toBeTruthy();
    expect(auth!.acceptedAnswer.text).toContain("Google أو Telegram أو رمز تحقق يُرسل إلى واتساب");
    expect(auth!.acceptedAnswer.text).not.toContain("البريد الإلكتروني");
  });
});
