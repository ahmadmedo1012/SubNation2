/**
 * 96-F5 (R96-M09 + P2-4) — legacy dialog shells on phones.
 *
 * dialog.tsx / alert-dialog.tsx were full-bleed on mobile: `w-full` with
 * no horizontal margin (the card touched both screen edges), rounding
 * applied only ≥sm (sharp corners at 320px), and NO height cap or
 * internal scroll — a long body (TopupWaitingModal's rejected note,
 * long confirm descriptions) pushed the footer buttons below the 568px
 * fold with no way to reach them (Radix locks page scroll).
 *
 * Also pins the 44px (min-h-11) action/cancel buttons — every
 * useConfirm() confirm is a money/destructive decision and 36px was
 * under the app's own touch floor.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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

describe("ui/dialog — 96-F5 (R96-M09) mobile geometry", () => {
  it("keeps 16px side margins, rounds mobile corners, caps and scrolls long content", () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent>
          <DialogTitle className="sr-only">حوار</DialogTitle>
          محتوى الحوار
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    const cls = dialog.className;
    // Width (not max-w) so consumer max-w overrides (TopupWaitingModal's
    // max-w-md) can't reintroduce edge-to-edge bleed.
    expect(cls).toContain("w-[calc(100vw-2rem)]");
    expect(cls).toContain("max-w-lg");
    // Rounded at base; the ≥sm look is unchanged.
    expect(cls).toContain("rounded-2xl");
    expect(cls).toContain("sm:rounded-lg");
    // Height cap + internal scroll mirror AppDialog's contract.
    expect(cls).toContain("max-h-[85dvh]");
    expect(cls).toContain("overflow-y-auto");
  });
});

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

  it("content: same margins / rounding / dvh cap / internal scroll as dialog.tsx", () => {
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
