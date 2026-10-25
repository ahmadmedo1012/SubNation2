/**
 * R157-IMPL-B (#1 + #2) — the topup rows' channel + rejection-reason
 * rendering contract.
 *
 * The R157-B audit's two P1 history findings:
 *
 *   1. lypay topups carry payment_network=null, so the rows' old
 *      `payment_network && …` guard rendered NO channel at all for bank
 *      transfers — the label must derive from the DTO's payment_method
 *      (mobile_transfer → network vocabulary + «تحويل موبايل» fallback,
 *      lypay → «LyPay»), on BOTH the history card and the mobile pin.
 *   2. the rejection reason (admin_note) lived only in
 *      TopupWaitingModal and vanished when it closed — the rejected
 *      history row now carries it as a clamped second line.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LatestTopupPin } from "@/components/wallet/LatestTopupPin";
import { TopupHistoryCard } from "@/components/wallet/TopupHistoryCard";
import { formatCount, ORDER_COUNT_FORMS_SUBJECT } from "@/lib/utils";
import type { LatestTopup } from "@/components/wallet/LatestTopupPin";

afterEach(cleanup);

/** A Topup row in the shape useListTopups returns. */
function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    status: "pending",
    amount: 50,
    payment_method: "mobile_transfer",
    payment_network: "libyana",
    admin_note: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

function renderHistory(rows: Array<Record<string, unknown>>) {
  return render(
    <TopupHistoryCard topups={rows as never} loading={false} error={false} onRetry={vi.fn()} />,
  );
}

function renderPin(topup: Record<string, unknown>) {
  return render(<LatestTopupPin topup={topup as unknown as LatestTopup} />);
}

describe("R157 #1 — every topup names its payment channel on both surfaces", () => {
  it("a lypay topup (payment_network null) shows «LyPay» in the history card", () => {
    renderHistory([row({ payment_method: "lypay", payment_network: null })]);
    // The ·-channel span renders "· LyPay" — regex for the substring.
    expect(screen.getByText(/LyPay/)).toBeInTheDocument();
  });

  it("…and in the mobile latest-topup pin", () => {
    renderPin(row({ payment_method: "lypay", payment_network: null }));
    expect(screen.getByText(/LyPay/)).toBeInTheDocument();
  });

  it("mobile_transfer keeps the network vocabulary (ليبيانا) on both surfaces", () => {
    renderHistory([row({ payment_network: "libyana" })]);
    expect(screen.getByText(/ليبيانا/)).toBeInTheDocument();
    cleanup();
    renderPin(row({ payment_network: "libyana" }));
    expect(screen.getByText(/ليبيانا/)).toBeInTheDocument();
  });

  it("mobile_transfer with a null network falls back to «تحويل موبايل»", () => {
    renderHistory([row({ payment_network: null })]);
    expect(screen.getByText(/تحويل موبايل/)).toBeInTheDocument();
  });

  it("a row without payment_method renders NO channel (legacy shape unchanged)", () => {
    renderHistory([row({ payment_method: undefined, payment_network: null })]);
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});

describe("R157 #2 — a rejected topup keeps its admin_note in the history", () => {
  it("renders the note as a line-clamped second line inside the rejected row", () => {
    const { container } = renderHistory([
      row({ status: "rejected", admin_note: "لم نعثر على التحويل المطابق للمبلغ" }),
    ]);
    expect(screen.getByText("لم نعثر على التحويل المطابق للمبلغ")).toBeInTheDocument();
    expect(container.querySelector(".line-clamp-2")).not.toBeNull();
  });

  it("a null-note rejected row keeps the existing shape — no note line", () => {
    const { container } = renderHistory([row({ status: "rejected", admin_note: null })]);
    expect(container.querySelector(".line-clamp-2")).toBeNull();
  });

  it("the note never renders on a non-rejected row", () => {
    const { container } = renderHistory([row({ status: "approved", admin_note: "ملاحظة" })]);
    expect(screen.queryByText("ملاحظة")).not.toBeInTheDocument();
    expect(container.querySelector(".line-clamp-2")).toBeNull();
  });
});

// ── R187 (B-F4): the count chip states what's shown, never a capped-window total ──
describe("R187 B-F4 — the topup-history count chip over the backend's 200-row cap", () => {
  it("a full 200-row window captions «عرض آخر 200 طلب شحن» (the WalletStatementCard honesty idiom)", () => {
    renderHistory(Array.from({ length: 200 }, (_, i) => row({ id: i + 1 })));

    // The backend caps GET /wallet/topups at 200 rows/page and the wallet
    // page loads page 1 only — a full window is TRUNCATED, not the user's
    // total topups. The caption states what's shown.
    expect(screen.getByText("عرض آخر 200 طلب شحن")).toBeInTheDocument();
    // …and the plain-count branch does not render over the capped window.
    expect(screen.queryByText(formatCount(200, ORDER_COUNT_FORMS_SUBJECT))).not.toBeInTheDocument();
  });

  it("a short window keeps the pluralized count (the chip is unchanged below the cap)", () => {
    renderHistory([row({ id: 1 })]);

    expect(screen.getByText(formatCount(1, ORDER_COUNT_FORMS_SUBJECT))).toBeInTheDocument();
    expect(screen.queryByText("عرض آخر 200 طلب شحن")).not.toBeInTheDocument();
  });
});
