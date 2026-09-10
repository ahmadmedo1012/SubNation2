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
    // 96-F5 (R96-M10): vh → dvh — the cap tracks the dynamic viewport so
    // the iOS URL-bar resize can't push the sheet above the visible top.
    expect(dialog.className).toContain("max-h-[85dvh]");
    expect(dialog.className).not.toContain("max-h-[85vh]");

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

describe("AppDialog — 96-F5 mobile shell hardening (R96-M07 + P2-2b)", () => {
  it("the footer reserves the iOS home-indicator safe area below sm", () => {
    render(<DialogHarness />);
    const footer = screen.getByRole("button", { name: "تأكيد" }).parentElement!;
    // pt-4 + pb-4 baseline, with the safe-area-augmented bottom padding
    // scoped to the mobile sheet only (the ≥sm centered card is unchanged).
    expect(footer.className).toContain("max-sm:pb-[calc(1rem_+_env(safe-area-inset-bottom))]");
    expect(footer.className).toContain("pt-4");
    expect(footer.className).toContain("pb-4");
  });

  it("a footer-less sheet carries the safe-area padding on the card itself", () => {
    render(
      <AppDialog open onOpenChange={vi.fn()} title="حوار بلا تذييل">
        <AppDialogBody>المحتوى</AppDialogBody>
      </AppDialog>,
    );
    const dialog = getDialogContent();
    expect(dialog.className).toContain("max-sm:pb-[env(safe-area-inset-bottom)]");
  });

  it("scrolls a focused field to the sheet's center (keyboard obscuring)", async () => {
    // jsdom has no scrollIntoView — provide the spy the guard requires.
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<DialogHarness />);
      // Drop any mount-time auto-focus call (which element Radix focuses
      // first is an implementation detail — only OUR handler is under test).
      scrollIntoView.mockClear();
      const field = screen.getByRole("textbox", { name: "حقل" });
      // focusin bubbles from the field through the content element.
      fireEvent(field, new window.Event("focusin", { bubbles: true }));
      await waitFor(
        () => {
          expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
        },
        { timeout: 1000 },
      );
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("focusing a BUTTON inside the sheet never scrolls (fields only)", async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<DialogHarness />);
      scrollIntoView.mockClear();
      const close = screen.getByRole("button", { name: "إغلاق" });
      fireEvent(close, new window.Event("focusin", { bubbles: true }));
      // Give the 50ms beat a chance to (wrongly) fire.
      await new Promise((r) => setTimeout(r, 120));
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
