/**
 * R168-L3 (fix 4) — the complete-failure branch carries support
 * recourse.
 *
 * The non-partial branch («تعذّر إتمام الطلب: … / لم يتم خصم أي
 * مبلغ…») was a dead end: retry was the only path, while the
 * order-detail page gives every completed order a «مشكلة في هذا
 * الطلب؟ تواصل مع الدعم» escape hatch. The banner now mirrors that
 * idiom (no ?ref= — there is no order code to reference yet), styled by
 * its own R151 link recipe (44px floor, error ink) so the two links in
 * one box stay one family.
 *
 * The partial branch keeps its own bookkeeping («راجع طلباتك
 * المنشأة» → /orders) — pinned unchanged here.
 *
 * Harness: OrderErrorBanner is props-only — rendered directly with the
 * terminal branch values the page's handleConfirm sets.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderErrorBanner } from "@/components/checkout/OrderErrorBanner";

afterEach(cleanup);

const SUPPORT_LABEL = "مشكلة في الطلب؟ تواصل مع الدعم";

function renderBanner(over: Partial<Parameters<typeof OrderErrorBanner>[0]> = {}) {
  return render(
    <Router>
      <OrderErrorBanner
        orderError="نفد المخزون"
        partialCount={0}
        walletStateUnknown={false}
        onDismiss={vi.fn()}
        {...over}
      />
    </Router>,
  );
}

describe("R168-L3 fix 4 — support recourse on the complete failure", () => {
  it("non-partial: the support link renders beside the verdict (known wallet state)", () => {
    renderBanner();

    expect(screen.getByText("تعذّر إتمام الطلب: نفد المخزون")).toBeInTheDocument();
    const support = screen.getByRole("link", { name: SUPPORT_LABEL });
    expect(support).toHaveAttribute("href", "/support");
    // The banner's own R151 link recipe — 44px floor, error ink.
    expect(support.className).toContain("min-h-11");
    expect(support.className).toContain("text-status-error");
    // The refund claim still rides this branch (R161-G control).
    expect(screen.getByText(/لم يتم خصم أي مبلغ/)).toBeInTheDocument();
  });

  it("non-partial + unknown wallet state: the claim drops but the escape hatch STAYS", () => {
    renderBanner({ walletStateUnknown: true });

    expect(screen.queryByText(/لم يتم خصم أي مبلغ/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: SUPPORT_LABEL })).toHaveAttribute("href", "/support");
  });

  it("partial: the branch keeps its own bookkeeping — NO support link", () => {
    renderBanner({ partialCount: 2 });

    const orders = screen.getByRole("link", { name: "راجع طلباتك المنشأة" });
    expect(orders).toHaveAttribute("href", "/orders");
    expect(screen.queryByRole("link", { name: SUPPORT_LABEL })).not.toBeInTheDocument();
  });
});
