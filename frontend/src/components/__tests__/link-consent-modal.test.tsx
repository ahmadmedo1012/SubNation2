/**
 * 94-C3 — LinkConsentModal on the AppDialog shell (A3 P1-2).
 *
 * The modal was the last hand-rolled overlay in the storefront auth
 * flow: a fixed div + onClick backdrop with no focus trap, no initial
 * focus move, no focus restore and no body scroll-lock. These tests pin
 * the migration to AppDialog (Radix) through observable behavior:
 *
 *   1. Radix dialog semantics (role/aria-modal) + wired title.
 *   2. Focus lands INSIDE the dialog on open (the trap precondition
 *      the old overlay never had).
 *   3. ESC cancels when idle — and is fully blocked while the link
 *      request is in flight (loading), the guarded-dismiss contract.
 *   4. Buttons call onConfirm / onCancel; the masked identifier keeps
 *      its test id, LTR direction and hint precedence (email > phone).
 *   5. The scroll-lock LAYER mounts while the dialog is open (Radix's
 *      RemoveScroll — the piece that owns body overflow/scroll-lock,
 *      which the old hand-rolled overlay never had).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkConsentModal } from "@/components/LinkConsentModal";

const HINT = { maskedEmail: "j••••@example.com", maskedPhone: "9•••••••78" };

function renderModal(over: Partial<Parameters<typeof LinkConsentModal>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <LinkConsentModal hint={HINT} loading={false} onConfirm={onConfirm} onCancel={onCancel} {...over} />,
  );
  return { onConfirm, onCancel };
}

afterEach(() => {
  // Radix's RemoveScroll mutates document.body — reset between tests
  // so one test's dialog state can't leak into the next.
  document.body.style.pointerEvents = "";
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("LinkConsentModal — AppDialog (Radix) semantics", () => {
  it("renders role=dialog + aria-modal with the wired title/description", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("تأكيد ربط الحساب")).toBeInTheDocument();
    expect(screen.getByText("وجدنا حساباً قائماً يطابق هذه الهوية")).toBeInTheDocument();
  });

  it("moves focus INTO the dialog on open (focus-trap precondition)", async () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("activates Radix's scroll-lock layer while open (body interaction lock)", () => {
    // jsdom has no layout, so the lock's overflow:hidden + scrollbar-gap
    // compensation aren't measurable — but the RemoveScroll layer that
    // owns them IS observable via the body interaction lock it applies.
    // The old hand-rolled overlay never mounted anything like it.
    const { unmount } = render(
      <LinkConsentModal hint={HINT} loading={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(document.body.style.pointerEvents).toBe("none");

    unmount();
    expect(document.body.style.pointerEvents).toBe("");
  });

  it("keeps the masked identifier with its test id and LTR direction (email wins)", () => {
    renderModal();
    const id = screen.getByTestId("link-consent-identifier");
    expect(id).toHaveTextContent("j••••@example.com");
    expect(id).toHaveAttribute("dir", "ltr");
  });

  it("falls back to the masked phone when no email hint exists", () => {
    render(
      <LinkConsentModal
        hint={{ maskedEmail: null, maskedPhone: "9•••••••78" }}
        loading={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("link-consent-identifier")).toHaveTextContent("9•••••••78");
  });
});

describe("LinkConsentModal — guarded dismiss (single-flight loading)", () => {
  it("ESC cancels while idle", async () => {
    const { onCancel } = renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });

  it("ESC is blocked while the link request is in flight", () => {
    const { onCancel } = renderModal({ loading: true });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    // …and the dialog is still there.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("backdrop pointer-down is blocked while loading", () => {
    const { onCancel } = renderModal({ loading: true });
    fireEvent.pointerDown(document.body, { button: 0 });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("the built-in close button is disabled while loading", () => {
    renderModal({ loading: true });
    expect(screen.getByRole("button", { name: "إغلاق" })).toBeDisabled();
  });

  it("confirm/cancel buttons invoke their handlers and honor loading", () => {
    const { onConfirm, onCancel } = renderModal({ loading: true });
    // Both disabled mid-flight — no accidental consent OR abort.
    expect(screen.getByRole("button", { name: /تأكيد الربط|جارٍ الربط/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "إلغاء" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    const { onConfirm: confirmIdle } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الربط" }));
    expect(confirmIdle).toHaveBeenCalledTimes(1);
  });

  it("shows the in-flight state on the confirm action while loading", () => {
    renderModal({ loading: true });
    expect(screen.getByText("جارٍ الربط...")).toBeInTheDocument();
  });
});
