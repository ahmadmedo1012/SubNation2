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
    expect(screen.getByText(/نقاط ولاء قابلة للتحويل/)).toBeInTheDocument();

    // The old at-signup promise must be gone.
    expect(screen.queryByText(/فور التسجيل/)).not.toBeInTheDocument();
  });
});
