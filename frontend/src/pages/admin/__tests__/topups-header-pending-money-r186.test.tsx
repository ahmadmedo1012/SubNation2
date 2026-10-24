/**
 * R186 (C-F7) — the topups header's pending MONEY line joins the
 * knownTotal honesty its sibling count line already carries.
 *
 * `pendingTopups` is the page's LOADED-window filter: with a 100-row
 * page and >100 pending topups, the header's count line honestly read
 * «عرض 100 طلب … (الأحدث أولاً)» while the money line 30px away claimed
 * «… د.ل إجمالي قيد الانتظار» — a total the window cannot prove (the
 * 94-C2 honest-counts class the count line itself was fixed for).
 *
 * The money label now derives from `knownTotal` (already a prop): true →
 * «إجمالي قيد الانتظار», false → «قيد الانتظار (ضمن المعروض)».
 * Rendered through the REAL header extract with plain row fixtures.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TopupsHeader } from "@/components/admin/topups/TopupsHeader";
import type { AdminTopupRow } from "@/components/admin/topups/topups-queue-meta";

const PENDING = (id: number, amount: number) =>
  ({
    id,
    amount,
    status: "pending",
    user_phone: "0911111111",
    payment_method: "mobile_transfer",
    created_at: "2026-09-01T10:00:00.000Z",
  }) as AdminTopupRow;

function renderHeader(over: { knownTotal: boolean; pending?: AdminTopupRow[] }) {
  const pending = over.pending ?? [PENDING(11, 50), PENDING(12, 75)];
  render(
    <TopupsHeader
      pendingCount={pending.length}
      knownTotal={over.knownTotal}
      statusFilter=""
      searchActive={false}
      allTopups={pending}
      topups={pending}
      pendingTopups={pending}
    />,
  );
}

describe("TopupsHeader — the pending money line gates on knownTotal (R186 C-F7)", () => {
  it("a PARTIAL window (knownTotal=false) labels the sum «قيد الانتظار (ضمن المعروض)» — never a total it cannot prove", () => {
    renderHeader({ knownTotal: false });
    expect(screen.getByText(/قيد الانتظار \(ضمن المعروض\)/)).toBeInTheDocument();
    expect(screen.queryByText(/إجمالي قيد الانتظار/)).not.toBeInTheDocument();
  });

  it("a provably-complete window (knownTotal=true) keeps the «إجمالي قيد الانتظار» total label", () => {
    renderHeader({ knownTotal: true });
    expect(screen.getByText(/إجمالي قيد الانتظار/)).toBeInTheDocument();
    expect(screen.queryByText(/ضمن المعروض/)).not.toBeInTheDocument();
  });

  it("no pending rows → no money line at all (the zero-signal contract holds)", () => {
    renderHeader({ knownTotal: false, pending: [] });
    expect(screen.queryByText(/قيد الانتظار/)).not.toBeInTheDocument();
  });
});
