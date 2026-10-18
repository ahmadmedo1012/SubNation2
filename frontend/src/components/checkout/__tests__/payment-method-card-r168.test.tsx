/**
 * R168-L3 (fix 3) — the insufficient-balance alert carries the topup
 * approval SLA.
 *
 * The alert told the buyer to top up («اشحن المحفظة ثم عُد لإتمام
 * الطلب») but never said approval is human-reviewed — «ثم عُد» read as
 * instant, and a buyer who returns 2 minutes later to a still-pending
 * balance drops off. The ONE canonical SLA sentence (R115 A8 #5 — the
 * same bytes PendingLimitBanner / TopupWaitingModal / the support FAQ
 * carry) now closes the alert.
 *
 * Harness: PaymentMethodCard is props-only (the page computes balance /
 * comparisonTotal) — rendered directly, wouter Router for the Link.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentMethodCard } from "@/components/checkout/PaymentMethodCard";

afterEach(cleanup);

/** The ONE canonical topup-approval SLA (PendingLimitBanner :53-54). */
const TOPUP_SLA = "يُعتمد الشحن عادةً خلال دقائق، وبحد أقصى 30 دقيقة خلال ساعات العمل.";

function renderCard(over: Partial<Parameters<typeof PaymentMethodCard>[0]> = {}) {
  return render(
    <Router>
      <PaymentMethodCard
        balanceLoading={false}
        balance={10}
        balanceError={false}
        insufficient
        comparisonTotal={49}
        {...over}
      />
    </Router>,
  );
}

describe("R168-L3 fix 3 — the insufficient alert names the approval SLA", () => {
  it("insufficient: the verdict + the topup link + the SLA sentence all render", () => {
    renderCard();

    // The R136-era contract still stands (verdict names the missing 39).
    expect(screen.getByText(/رصيد المحفظة غير كافٍ \(الناقص 39\.00 د\.ل\)/)).toBeInTheDocument();
    const topup = screen.getByRole("link", { name: "اشحن المحفظة ثم عُد لإتمام الطلب" });
    expect(topup).toHaveAttribute("href", "/wallet?return=/checkout");
    // …and the new expectation-setting line rides the same alert.
    expect(screen.getByText(TOPUP_SLA)).toBeInTheDocument();
    // In the alert's own register: quieter than the bold verdict (the
    // PendingLimitBanner third-line idiom).
    expect(screen.getByText(TOPUP_SLA).className).toContain("text-2xs");
  });

  it("sufficient balance: no alert, no SLA (nothing to explain)", () => {
    renderCard({ insufficient: false, balance: 200 });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(TOPUP_SLA)).not.toBeInTheDocument();
  });
});
