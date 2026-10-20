/**
 * R177 — the PDP coupon-affordance band + the validating accessible name.
 *
 * Band (the audit's P2): between sm (640px) and lg (1024px) the PDP had NO
 * coupon surface at all — the mobile coupon block died at `sm:hidden` while
 * the desktop panel CtaBlock (with its own CouponField) only mounts ≥lg. The
 * fix mirrors the R157 buy-affordance law: exactly one coupon affordance at
 * every width — this block <lg, the panel CtaBlock ≥lg, no duplication.
 *
 * Accessible name (the R160 checkout-twin parity): the PDP validate button
 * swapped its text for a spinner mid-request, leaving an unnamed disabled
 * control for screen readers — the checkout CouponCard got the sr-only twin
 * in R160; this pins the PDP twin's presence.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CouponField } from "@/components/product/CouponField";

const BPC_SOURCE = readFileSync(
  resolve(process.cwd(), "src/components/product/BuyPanelColumn.tsx"),
  "utf8",
);

afterEach(cleanup);

describe("R177 — the coupon affordance exists at EVERY width", () => {
  it("the scrollable coupon block is lg:hidden (dies at the desktop panel, not at sm)", () => {
    // The block must carry the <lg visibility, not the old <sm.
    expect(BPC_SOURCE).toContain("order-11 max-lg:mx-5 lg:hidden");
    expect(BPC_SOURCE).not.toContain("order-11 max-lg:mx-5 sm:hidden");
  });

  it("the desktop panel CTA stays hidden lg:block (no duplicate coupon fields ≥lg)", () => {
    expect(BPC_SOURCE).toContain("order-12 max-lg:px-5 hidden lg:block");
  });
});

describe("R177 — the PDP validate button keeps its accessible name mid-request", () => {
  it("the spinner swap carries the sr-only twin (R160 checkout parity)", () => {
    render(
      <CouponField
        couponInput="SAVE10"
        couponResult={null}
        couponError=""
        couponValidating={true}
        token="t"
        onCouponChange={vi.fn()}
        onCouponValidate={vi.fn()}
        onCouponClear={vi.fn()}
      />,
    );

    const validating = screen.getByRole("button");
    expect(validating).toBeDisabled();
    // The sr-only twin names the control while the spinner spins.
    const srTwin = validating.querySelector("span.sr-only");
    expect(srTwin).not.toBeNull();
    expect(srTwin?.textContent).toBe("جارٍ التحقق…");
  });

  it("the clear button carries the aria-label + title twin (hover parity)", () => {
    render(
      <CouponField
        couponInput="SAVE10"
        couponResult={{
          code: "SAVE10",
          discount_amount: 5,
          final_amount: 44,
          type: "fixed",
          value: 5,
          description: null,
        }}
        couponError=""
        couponValidating={false}
        token="t"
        onCouponChange={vi.fn()}
        onCouponValidate={vi.fn()}
        onCouponClear={vi.fn()}
      />,
    );

    const clear = screen.getByRole("button", { name: "إزالة الكوبون" });
    expect(clear).toHaveAttribute("title", "إزالة الكوبون");
  });
});
