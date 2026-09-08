/**
 * 93-C7 / C-UX3 (A12 §11.2) — AppDialog shell tests.
 *
 * Pins the three behaviors the unification spec mandates for every
 * form/detail overlay:
 *   1. Radix dialog semantics: role="dialog" + aria-modal, focus lands
 *      INSIDE the dialog on open (focus-trap basics).
 *   2. Loading-guard: `dismissable={false}` blocks ESC, backdrop
 *      pointer-down and the close button; `dismissable` (default)
 *      allows all three.
 *   3. Long-content geometry: the card is capped (max-h) and the BODY
 *      is the scrolling region — header/footer never scroll.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";

function DialogHarness({ dismissable = true }: { dismissable?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      title="حوار تجريبي"
      description="سطر وصفي"
      dismissable={dismissable}
      footer={<button type="button">تأكيد</button>}
    >
      <AppDialogBody>
        <input aria-label="حقل" />
        <p>المحتوى</p>
      </AppDialogBody>
    </AppDialog>
  );
}

function getDialogContent(): HTMLElement {
  return screen.getByRole("dialog");
}

describe("AppDialog — Radix semantics + focus trap basics", () => {
  it("renders role=dialog with aria-modal and wires title/description", () => {
    render(<DialogHarness />);
    const dialog = getDialogContent();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("حوار تجريبي")).toBeInTheDocument();
    expect(screen.getByText("سطر وصفي")).toBeInTheDocument();
  });

  it("moves focus INTO the dialog on open (focus-trap basics)", async () => {
    render(<DialogHarness />);
    const dialog = getDialogContent();
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("the close button carries aria-label=إغلاق and a 44px target (94-C3 A3 P1-3)", () => {
    render(<DialogHarness />);
    const close = screen.getByRole("button", { name: "إغلاق" });
    expect(close).toBeInTheDocument();
    expect(close.className).toContain("h-11 w-11");
    expect(close.className).toContain("touch-target");
  });
});

describe("AppDialog — loading-guard blocks dismissal (A12 F-01 data-loss class)", () => {
  it("ESC does NOT dismiss while dismissable={false}", () => {
    render(<DialogHarness dismissable={false} />);
    expect(getDialogContent()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(getDialogContent()).toBeInTheDocument();
  });

  it("backdrop pointer-down does NOT dismiss while dismissable={false}", () => {
    render(<DialogHarness dismissable={false} />);
    expect(getDialogContent()).toBeInTheDocument();

    // Radix listens for pointerdown OUTSIDE the content — dispatch on
    // document.body (the portal parent of the overlay).
    fireEvent.pointerDown(document.body, { button: 0 });

    expect(getDialogContent()).toBeInTheDocument();
  });

  it("the close button is disabled while dismissable={false}", () => {
    render(<DialogHarness dismissable={false} />);
    expect(screen.getByRole("button", { name: "إغلاق" })).toBeDisabled();
  });

  it("ESC DOES dismiss when dismissable (the guard is only for busy state)", async () => {
    const onOpenChange = vi.fn();
    render(
      <AppDialog open onOpenChange={onOpenChange} title="حوار تجريبي">
        <AppDialogBody>المحتوى</AppDialogBody>
      </AppDialog>,
    );
    expect(getDialogContent()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("AppDialog — long-content geometry (§11.2 rule 5)", () => {
  it("caps the card and scrolls only the body", () => {
    render(<DialogHarness />);
    const dialog = getDialogContent();
    expect(dialog.className).toContain("max-h-[85vh]");

    const body = screen.getByText("المحتوى").parentElement!;
    expect(body.className).toContain("overflow-y-auto");
    // Header (title) and footer live OUTSIDE the scrolling region.
    expect(screen.getByText("حوار تجريبي").closest('[class*="overflow-y-auto"]')).toBeNull();
    expect(
      screen.getByRole("button", { name: "تأكيد" }).closest('[class*="overflow-y-auto"]'),
    ).toBeNull();
  });

  it("renders the mobile bottom-sheet + centered sm card shape", () => {
    render(<DialogHarness />);
    const dialog = getDialogContent();
    expect(dialog.className).toContain("bottom-0");
    expect(dialog.className).toContain("rounded-t-2xl");
    expect(dialog.className).toContain("sm:rounded-2xl");
  });
});
