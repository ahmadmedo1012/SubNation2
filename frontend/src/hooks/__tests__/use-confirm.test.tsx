/**
 * A4-F3 (R120-B2) — focus return from the programmatic confirm dialog.
 *
 * useConfirm renders a CONTROLLED AlertDialog with no
 * <AlertDialogTrigger> — Radix therefore has no trigger element to
 * return focus to on close, and document.activeElement landed on
 * <body> (verified live on /cart: ESC after the clear-confirm dropped
 * keyboard users back to the top of the tab order).
 *
 * The fix captures document.activeElement when confirm() opens and
 * returns focus to it on EVERY close path (cancel click, action click,
 * ESC) via the AlertDialogContent onCloseAutoFocus event, guarded by
 * isConnected (an invoker that unmounted mid-dialog must not be
 * .focus()-ed as a detached node).
 *
 * jsdom supports element.focus()/document.activeElement, so the whole
 * contract is pinnable without a browser.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useConfirm } from "@/hooks/use-confirm";

/** Minimal consumer mirroring the real call-sites (cart clear, admin
 *  bulk actions): a trigger button that awaits confirm() + one mounted
 *  <ConfirmDialog />. */
function ConfirmHarness() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [result, setResult] = useState<boolean | null>(null);
  return (
    <div>
      <button
        onClick={async () => {
          const ok = await confirm({
            title: "حذف المنتج؟",
            description: "لا يمكن التراجع عن هذا الإجراء.",
            confirmLabel: "حذف",
            cancelLabel: "إلغاء",
            destructive: true,
          });
          setResult(ok);
        }}
      >
        افتح التأكيد
      </button>
      {result !== null && <span data-testid="confirm-result">{String(result)}</span>}
      <ConfirmDialog />
    </div>
  );
}

/** The invoker UNMOUNTS while the dialog is open (a list re-render or
 *  navigation removes the row that owned the trigger) — the guard must
 *  skip the detached node instead of throwing / focusing nothing. */
function DetachingHarness() {
  const { confirm, ConfirmDialog } = useConfirm();
  const [mounted, setMounted] = useState(true);
  return (
    <div>
      {mounted && (
        <button
          onClick={async () => {
            setMounted(false);
            await confirm({ title: "حذف؟", confirmLabel: "حذف", cancelLabel: "إلغاء" });
          }}
        >
          افتح واختفِ
        </button>
      )}
      <button>بديل</button>
      <ConfirmDialog />
    </div>
  );
}

async function openDialog() {
  const trigger = screen.getByRole("button", { name: "افتح التأكيد" });
  // Keyboard journey: focus BEFORE activating (fireEvent.click does not
  // move focus in jsdom — same as a real click, but the capture happens
  // on activeElement, so pin it explicitly).
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("alertdialog");
  return trigger;
}

describe("useConfirm — focus return to the invoker (A4-F3 / R120-B2)", () => {
  it("cancel returns focus to the trigger that opened the dialog", async () => {
    render(<ConfirmHarness />);
    const trigger = await openDialog();

    // Radix AlertDialog focuses the safe default (إلغاء) on open.
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByTestId("confirm-result")).toHaveTextContent("false");
    // THE FIX: focus is handed back to the invoker, not left on <body>.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("ESC returns focus to the trigger (Radix onOpenChange(false) path)", async () => {
    render(<ConfirmHarness />);
    const trigger = await openDialog();

    // Radix DismissableLayer handles Escape at the document level.
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByTestId("confirm-result")).toHaveTextContent("false");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("confirming (Action) also returns focus — Radix has no trigger of its own here", async () => {
    render(<ConfirmHarness />);
    const trigger = await openDialog();

    fireEvent.click(screen.getByRole("button", { name: "حذف" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByTestId("confirm-result")).toHaveTextContent("true");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("a detached invoker is skipped safely (isConnected guard)", async () => {
    const { unmount } = render(<DetachingHarness />);
    const trigger = screen.getByRole("button", { name: "افتح واختفِ" });
    trigger.focus();
    fireEvent.click(trigger);

    // Dialog opens; the trigger row is gone in the same commit.
    await screen.findByRole("alertdialog");
    expect(trigger.isConnected).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    // No throw, and focus did NOT land on the detached node.
    expect(document.activeElement).not.toBe(trigger);
    // Focus falls to wherever Radix left it (body) — never a dead node.
    expect(document.activeElement).toBe(document.body);
    // The dialog machinery still resolves cleanly for the next confirm.
    expect(screen.getByRole("button", { name: "بديل" })).toBeInTheDocument();
    unmount();
  });

  it("a second confirm after focus return captures the NEW invoker", async () => {
    render(<ConfirmHarness />);
    const trigger = await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    // Re-open from the same trigger — the captured element is refreshed
    // (and focus still lands back on it after the second round).
    fireEvent.click(trigger);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
