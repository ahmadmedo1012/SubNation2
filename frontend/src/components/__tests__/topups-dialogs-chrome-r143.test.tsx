/**
 * R143 (L2-3 + L2-5) — the topups money-dialog chrome contracts, pinned at
 * the component level.
 *
 * L2-3: J-1 (R142) raised RejectModal's confirm to min-h-11 but its own
 * cancel (h-9) and the whole BulkConfirmModal footer stayed at 36px — a
 * 44px money-path tap target requirement violated twice in the same
 * family, while RejectModal's J-1 comment claimed BulkConfirmModal
 * "already enforce[d]" the floor (false at HEAD). Both footers now ride
 * min-h-11 on every button; these tests render the two components
 * directly (the page-level a11y/behavior contracts live in
 * pages/admin/__tests__/topups-dialogs-a11y.test.tsx — roles, labels,
 * focus trap, guarded dismiss; nothing there pins chrome).
 *
 * L2-5: both note textareas ride the shared Input's focus idiom
 * (focus-visible:ring-2 + ring-ring + ring-offset-background) — the old
 * 1px focus:ring-1 focus:ring-{primary,destructive} composites sat under
 * the 3:1 focus-indicator floor (F3-01's bar).
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkConfirmModal } from "@/components/admin/topups/BulkConfirmModal";
import { RejectModal } from "@/components/admin/topups/RejectModal";

const TOPUP = {
  id: 21,
  amount: 60,
  user_phone: "0917777777",
  status: "pending",
};

afterEach(() => {
  // Radix's RemoveScroll mutates document.body — reset between tests so
  // one dialog's lock state can't leak into the next (link-consent-modal
  // test idiom).
  document.body.style.pointerEvents = "";
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

/** Both footer buttons of a rendered dialog, by visible label. */
function footerButtons(dialog: HTMLElement, cancelLabel: string, confirmLabel: RegExp) {
  const cancel = within(dialog).getByRole("button", { name: cancelLabel });
  const confirm = within(dialog).getByRole("button", { name: confirmLabel });
  return { cancel, confirm };
}

describe("BulkConfirmModal — the 44px money-confirm floor (R143 L2-3)", () => {
  it.each(["approve", "reject"] as const)(
    "action=%s: BOTH footer buttons ride min-h-11 (the h-9 36px stack is gone)",
    (action) => {
      render(
        <BulkConfirmModal
          action={action}
          count={1}
          open
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
          loading={false}
        />,
      );
      const dialog = screen.getByRole("dialog");
      const { cancel, confirm } = footerButtons(
        dialog,
        "إلغاء",
        action === "approve" ? /^موافقة/ : /^رفض/,
      );
      for (const btn of [cancel, confirm]) {
        expect(btn.className).toContain("min-h-11");
        expect(btn.className).not.toMatch(/(^|\s)h-9(\s|$)/);
      }
    },
  );

  it("the reject branch rides variant=destructive (the J-1 AA surface pair, one register with RejectModal)", () => {
    render(
      <BulkConfirmModal
        action="reject"
        count={1}
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        loading={false}
      />,
    );
    const confirm = screen.getByRole("button", { name: /^رفض/ });
    // The destructive variant's token pair — the retired hand-rolled
    // fill (hover:bg-destructive-surface/90 + shadow-destructive/20)
    // must not return.
    expect(confirm.className).toContain("bg-destructive-surface");
    expect(confirm.className).toContain("text-destructive-foreground");
    expect(confirm.className).not.toContain("shadow-destructive/20");
  });

  it("the approve branch keeps the success-surface composition at the floor", () => {
    render(
      <BulkConfirmModal
        action="approve"
        count={1}
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        loading={false}
      />,
    );
    const confirm = screen.getByRole("button", { name: /^موافقة/ });
    expect(confirm.className).toContain("bg-status-success-surface");
    expect(confirm.className).toContain("text-white");
    expect(confirm.className).toContain("min-h-11");
  });

  it("the note textarea rides the shared Input focus idiom (R143 L2-5)", () => {
    render(
      <BulkConfirmModal
        action="approve"
        count={1}
        open
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        loading={false}
      />,
    );
    const note = screen.getByLabelText(/^سبب المعالجة الجماعية/);
    // 2px full-token ring + offset (the input.tsx recipe) — the 1px
    // focus:ring-1 focus:ring-primary composite is banned.
    expect(note.className).toContain("focus-visible:ring-2");
    expect(note.className).toContain("focus-visible:ring-ring");
    expect(note.className).toContain("focus-visible:ring-offset-background");
    expect(note.className).not.toContain("focus:ring-1");
  });

  it("handlers still fire byte-identically (cancel → onCancel; ⌘+Enter → onConfirm with the note)", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <BulkConfirmModal
        action="approve"
        count={1}
        open
        onConfirm={onConfirm}
        onCancel={onCancel}
        loading={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    const note = screen.getByLabelText(/^سبب المعالجة الجماعية/) as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "مطابقة المسائية" } });
    fireEvent.keyDown(note, { ctrlKey: true, key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith("مطابقة المسائية");
  });
});

describe("RejectModal — footer symmetry + the note field's focus idiom (R143 L2-3/L2-5)", () => {
  it("BOTH footer buttons ride min-h-11 (the h-9 cancel asymmetry is gone)", () => {
    render(
      <RejectModal topup={TOPUP} open onConfirm={vi.fn()} onCancel={vi.fn()} loading={false} />,
    );
    const dialog = screen.getByRole("dialog");
    const { cancel, confirm } = footerButtons(dialog, "إلغاء", /تأكيد الرفض/);
    expect(confirm.className).toContain("min-h-11");
    expect(cancel.className).toContain("min-h-11");
    expect(cancel.className).not.toMatch(/(^|\s)h-9(\s|$)/);
    // The confirm keeps the J-1 destructive variant.
    expect(confirm.className).toContain("bg-destructive-surface");
  });

  it("the note textarea rides the shared Input focus idiom (R143 L2-5 — the J-2 callout site)", () => {
    render(
      <RejectModal topup={TOPUP} open onConfirm={vi.fn()} onCancel={vi.fn()} loading={false} />,
    );
    const note = screen.getByLabelText(/^سبب الرفض/);
    expect(note.className).toContain("focus-visible:ring-2");
    expect(note.className).toContain("focus-visible:ring-ring");
    expect(note.className).toContain("focus-visible:ring-offset-background");
    // The retired 1px destructive ring must not return.
    expect(note.className).not.toContain("focus:ring-1");
    expect(note.className).not.toContain("ring-destructive");
  });
});
