/**
 * R168-L3 (fixes 2 + 3) — CtaBlock's conversion-path copy contracts.
 *
 * Fix 2 (guest branch): the login gate said nothing about HOW payment
 * works. The panel now carries ONE quiet line mirroring TrustFooter's
 * step-2 rails («مدار أو ليبيانا أو LyPay» verbatim) in the sold-out
 * branch's helper-line register — desktop panel only; the compact
 * sticky bar stays thumb-sized.
 *
 * Fix 3 (insufficient branch): the topup CTA now carries the ONE
 * canonical approval SLA (PendingLimitBanner / TopupWaitingModal /
 * support-FAQ sentence, R115 A8 #5) so the buyer who leaves to top up
 * knows approval is minutes, not hours.
 *
 * Harness: CtaBlock is props-only (state stays in the page) — rendered
 * directly with the branch ladder's own values; wouter Router wraps it
 * for the useLocation call.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CtaBlock } from "@/components/product/CtaBlock";
import type { Product, User } from "@workspace/api-client-react";

afterEach(cleanup);

const PRODUCT: Product = {
  id: 5,
  slug: null,
  name: "Netflix شهر",
  category: "streaming",
  price: 49,
  price_from: false,
  is_active: true,
  is_available: true,
  stock_count: 5,
  order_count: 0,
  variants: [],
};

const USER: User = {
  id: 7,
  phone: "0912345678",
  wallet_balance: 20,
  loyalty_points: 0,
  loyalty_tier: "bronze",
  lifetime_spend: 0,
};

/** The guest-line copy — TrustFooter's step-2 rails, byte-identical. */
const GUEST_PAYMENT_MODEL = "الدفع من رصيد المحفظة — اشحنها عبر مدار أو ليبيانا أو LyPay";

/** The ONE canonical topup-approval SLA (PendingLimitBanner :53-54). */
const TOPUP_SLA = "يُعتمد الشحن عادةً خلال دقائق، وبحد أقصى 30 دقيقة خلال ساعات العمل.";

function renderCta(over: Partial<Parameters<typeof CtaBlock>[0]> = {}) {
  return render(
    <Router>
      <CtaBlock
        token={null}
        product={PRODUCT}
        displayPrice={49}
        canAfford={false}
        shortfall={29}
        isPending={false}
        onBuy={vi.fn()}
        onLogin={vi.fn()}
        onWallet={vi.fn()}
        {...over}
      />
    </Router>,
  );
}

describe("R168-L3 fix 2 — the guest payment-model line", () => {
  it("the desktop guest panel names the rails (TrustFooter step-2 wording)", () => {
    renderCta({ token: null });

    expect(screen.getByText(GUEST_PAYMENT_MODEL)).toBeInTheDocument();
    // …in the sold-out branch's helper-line register (muted, centered).
    expect(screen.getByText(GUEST_PAYMENT_MODEL).className).toContain("text-muted-foreground");
  });

  it("the compact sticky bar does NOT carry it (thumb-sized bar, no prose)", () => {
    renderCta({ token: null, compact: true });

    expect(screen.queryByText(GUEST_PAYMENT_MODEL)).not.toBeInTheDocument();
  });
});

describe("R168-L3 fix 3 — the topup-approval SLA on the insufficient branch", () => {
  it("the desktop shortfall panel carries the SLA under the topup CTA", () => {
    renderCta({ token: "t", user: USER, canAfford: false, shortfall: 29 });

    expect(screen.getByRole("button", { name: /شحن المحفظة/ })).toBeInTheDocument();
    expect(screen.getByText(TOPUP_SLA)).toBeInTheDocument();
  });

  it("the compact sticky bar does NOT carry it (row geometry stays tight)", () => {
    renderCta({ token: "t", user: USER, canAfford: false, shortfall: 29, compact: true });

    expect(screen.queryByText(TOPUP_SLA)).not.toBeInTheDocument();
  });
});
