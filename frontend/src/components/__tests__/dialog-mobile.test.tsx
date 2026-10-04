/**
 * 96-F5 (R96-M09 + P2-4) — the useConfirm() shell on phones.
 *
 * R116-S2: the legacy ui/dialog.tsx was DELETED (its only consumer,
 * TopupWaitingModal, migrated to the shared AppDialog). The dialog-half
 * of this file's expectations was folded into
 * topup-waiting-modal-aria.test.tsx (AppDialog mobile geometry + 44px
 * actions); this file now pins the alert-dialog half only — it stays a
 * separate component (binary confirmations, different purpose).
 *
 * alert-dialog.tsx used to be full-bleed on mobile: no height cap or
 * internal scroll — a long confirm description pushed the footer
 * buttons below the 568px fold with no way to reach them (Radix locks
 * page scroll). Also pins the 44px (min-h-11) action/cancel buttons —
 * every useConfirm() confirm is a money/destructive decision and 36px
 * was under the app's own touch floor.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

describe("ui/alert-dialog — 96-F5 (R96-M09 + P2-4) geometry + 44px actions", () => {
  function renderConfirm() {
    render(
      <AlertDialog open onOpenChange={vi.fn()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    return screen.getByRole("alertdialog");
  }

  it("content: same margins / rounding / dvh cap / internal scroll contract as the dialog family", () => {
    const dialog = renderConfirm();
    const cls = dialog.className;
    expect(cls).toContain("w-[calc(100vw-2rem)]");
    expect(cls).toContain("rounded-2xl");
    expect(cls).toContain("sm:rounded-lg");
    expect(cls).toContain("max-h-[85dvh]");
    expect(cls).toContain("overflow-y-auto");
  });

  it("action + cancel buttons clear the 44px touch floor", () => {
    renderConfirm();
    const action = screen.getByRole("button", { name: "حذف" });
    const cancel = screen.getByRole("button", { name: "إلغاء" });
    // twMerge drops the base min-h-9 in favor of min-h-11.
    expect(action.className).toContain("min-h-11");
    expect(action.className).not.toContain("min-h-9");
    expect(cancel.className).toContain("min-h-11");
    expect(cancel.className).not.toContain("min-h-9");
  });

  it("cancel keeps 12px separation in the mobile flex-col-reverse footer (was mt-2)", () => {
    renderConfirm();
    const cancel = screen.getByRole("button", { name: "إلغاء" });
    expect(cancel.className).toContain("mt-3");
    expect(cancel.className).toContain("sm:mt-0");
    expect(cancel.className).not.toContain("mt-2");
  });
});
