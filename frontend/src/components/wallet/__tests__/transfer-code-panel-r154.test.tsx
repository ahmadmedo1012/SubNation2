/**
 * R154 (P1) — the multi-installment TransferCodePanel contract.
 *
 * The Libyana/Madar USSD flow now plans MULTIPLE transfers for totals
 * above the network's single-transfer limit (Libyana 50 LYD — USSD
 * parameter in millimes ×1000; Madar 20 LYD — unscaled). The rendered
 * panel must:
 *
 *   1. show ONE code + one generic dial CTA when the total fits the
 *      limit (the pre-R154 shape — no regression);
 *   2. list every installment separately («التحويل 1 من 2») with its
 *      OWN dial action + copy button when it doesn't, never one
 *      generic button that dials only the first transfer;
 *   3. carry the honest multi-transfer instruction (each code is a
 *      separate transfer; complete all before submitting ONE request);
 *   4. recompute when network/amount change;
 *   5. never render a fictitious code for invalid/empty input.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TransferCodePanel } from "@/components/wallet/TransferCodePanel";
import { RECEIVER_PHONE } from "@/lib/transfer-code";

// The per-installment dial <a> labels («اتصال بالتحويل 1»…).
function dialLinks(): HTMLAnchorElement[] {
  return screen
    .queryAllByRole("link")
    .filter((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);
}

beforeAll(() => {
  // jsdom lacks navigator.clipboard — CopyButton degrades to a failure
  // toast without it; the button still renders (its presence is the pin).
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(cleanup);

describe("R154 — TransferCodePanel single-installment shape (no regression)", () => {
  it("a total within the limit renders ONE code + the generic «تحويل الرصيد» CTA", () => {
    render(<TransferCodePanel network="libyana" amount="10" receiver={RECEIVER_PHONE} />);

    // Libyana preset 10 → ×1000 millimes parameter.
    expect(screen.getByText("*122*218913456789*10000*1#")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "تحويل الرصيد" })).toHaveAttribute(
      "href",
      "tel:*122*218913456789*10000*1%23",
    );
    // No installment chrome on the single-transfer shape.
    expect(screen.queryByText(/التحويل 1 من 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/أكمل جميع التحويلات أولاً/)).not.toBeInTheDocument();
  });

  it("a Madar total within the limit stays UNSCALED", () => {
    render(<TransferCodePanel network="madar" amount="10" receiver={RECEIVER_PHONE} />);
    expect(screen.getByText(`*140*4*1*10*${RECEIVER_PHONE}#`)).toBeInTheDocument();
  });
});

describe("R154 — TransferCodePanel multi-installment shape", () => {
  it("Libyana 100 → two 50-dinar transfers, the SAME ×1000 code twice, each with its own dial", () => {
    render(<TransferCodePanel network="libyana" amount="100" receiver={RECEIVER_PHONE} />);

    // TWO installment rows, numbered.
    expect(screen.getByText("التحويل 1 من 2")).toBeInTheDocument();
    expect(screen.getByText("التحويل 2 من 2")).toBeInTheDocument();
    // The same code appears twice (50 LYD = 50000 millimes each).
    expect(screen.getAllByText("*122*218913456789*50000*1#")).toHaveLength(2);
    // A per-installment dial link for each row.
    const links = dialLinks().filter((a) => a.textContent?.includes("اتصال بالتحويل"));
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "tel:*122*218913456789*50000*1%23");
    }
    // The generic single-transfer CTA is honestly retired.
    expect(screen.queryByRole("link", { name: "تحويل الرصيد" })).not.toBeInTheDocument();
    expect(screen.getByText("أكمل جميع التحويلات أولاً")).toBeInTheDocument();
  });

  it("Libyana 75 → 50 + 25 with the exact remainder code", () => {
    render(<TransferCodePanel network="libyana" amount="75" receiver={RECEIVER_PHONE} />);
    expect(screen.getByText("*122*218913456789*50000*1#")).toBeInTheDocument();
    expect(screen.getByText("*122*218913456789*25000*1#")).toBeInTheDocument();
  });

  it("Madar 50 → 20 + 20 + 10 (three rows, unscaled)", () => {
    render(<TransferCodePanel network="madar" amount="50" receiver={RECEIVER_PHONE} />);
    expect(screen.getByText("التحويل 3 من 3")).toBeInTheDocument();
    expect(screen.getAllByText(`*140*4*1*20*${RECEIVER_PHONE}#`)).toHaveLength(2);
    expect(screen.getByText(`*140*4*1*10*${RECEIVER_PHONE}#`)).toBeInTheDocument();
  });

  it("carries the honest multi-transfer instruction + the aggregate total", () => {
    render(<TransferCodePanel network="madar" amount="40" receiver={RECEIVER_PHONE} />);
    // The instruction: each code is a separate transfer; complete all,
    // then submit ONE request for the aggregate total.
    expect(
      screen.getByText(
        /كل رمز أدناه يمثل تحويلاً مستقلاً. أكمل جميع التحويلات ثم أرسل طلباً واحداً/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("الإجمالي: 40.00 د.ل")).toBeInTheDocument();
  });
});

describe("R154 — TransferCodePanel recomputation + invalid input", () => {
  it("recomputes the plan when the network changes (100 on madar → five 20s, not two 50s)", () => {
    const { rerender } = render(
      <TransferCodePanel network="libyana" amount="100" receiver={RECEIVER_PHONE} />,
    );
    expect(screen.getByText("التحويل 2 من 2")).toBeInTheDocument();

    rerender(<TransferCodePanel network="madar" amount="100" receiver={RECEIVER_PHONE} />);
    expect(screen.getByText("التحويل 5 من 5")).toBeInTheDocument();
    expect(screen.getAllByText(`*140*4*1*20*${RECEIVER_PHONE}#`)).toHaveLength(5);
    expect(screen.queryByText("*122*218913456789*50000*1#")).not.toBeInTheDocument();
  });

  it("never renders a fictitious code for empty / invalid / zero input", () => {
    for (const amount of ["", "abc", "0", "-5"]) {
      const { unmount } = render(
        <TransferCodePanel network="libyana" amount={amount} receiver={RECEIVER_PHONE} />,
      );
      expect(screen.getByText("أدخل المبلغ لإنشاء الرمز تلقائياً")).toBeInTheDocument();
      expect(dialLinks()).toHaveLength(0);
      unmount();
    }
  });
});
