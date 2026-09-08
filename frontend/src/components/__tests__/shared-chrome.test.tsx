/**
 * 94-C3 — targeted regressions for the remaining shared-chrome fixes:
 *
 *   • ui/dialog.tsx close button (A3 P1-3 + P3-14): the shadcn default
 *     was a bare ~16px icon pinned to the physical top-RIGHT — in this
 *     RTL app the title starts at the right edge, so the close belongs
 *     at the opposite corner, and the hit box must clear the 44px
 *     WCAG 2.5.5 floor.
 *   • NavigationProgress (A3 P3-2 + P3-10): the bar grows from the
 *     RIGHT (the RTL reading origin), and every scheduled timer —
 *     including the 200ms hide step that used to be untracked — is
 *     cleared when the component unmounts mid-flight.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Router, Link } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NavigationProgress } from "@/components/NavigationProgress";

beforeEach(() => {
  // Wouter navigation mutates the shared jsdom URL — reset so each
  // test starts at "/" and its Link click is a real location change
  // (the progress effect early-returns when location is unchanged).
  window.history.pushState({}, {}, "/");
});

beforeEach(() => {
  // jsdom's rAF isn't fake-timer aware — bridge it to setTimeout so
  // advancing fake timers also flushes the progress ramp callback.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ui/dialog close button — RTL corner + 44px hit box (A3 P1-3/P3-14)", () => {
  function renderDialog() {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent>
          <DialogTitle className="sr-only">حوار</DialogTitle>
          محتوى الحوار
        </DialogContent>
      </Dialog>,
    );
  }

  it("places the close at the physical LEFT corner (opposite the RTL title origin)", () => {
    renderDialog();
    const close = screen.getByRole("button", { name: "إغلاق" });
    expect(close.className).toContain("left-4");
    expect(close.className).not.toContain("right-4");
  });

  it("gives the close a 44px hit box (was a bare ~16px icon)", () => {
    renderDialog();
    const close = screen.getByRole("button", { name: "إغلاق" });
    expect(close.className).toContain("h-11 w-11");
    expect(close.className).toContain("touch-target");
  });
});

describe("NavigationProgress — RTL growth + full timer cleanup (A3 P3-2/P3-10)", () => {
  it("grows from the right edge (origin-right), not left-to-right", async () => {
    vi.useFakeTimers();
    render(
      <Router>
        <NavigationProgress />
        <Link href="/other">اذهب</Link>
      </Router>,
    );

    // Initially hidden (same location — no route change yet).
    expect(document.querySelector(".origin-right")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "اذهب" }));
    await act(async () => {
      vi.advanceTimersByTime(100); // past the 80ms show delay
    });

    const bar = document.querySelector<HTMLElement>(".origin-right");
    expect(bar).not.toBeNull();
    expect(bar!.className).toContain("origin-right");
    expect(bar!.className).not.toContain("origin-left");
  });

  it("clears ALL timers on unmount — including the untracked 200ms hide step", async () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Router>
        <NavigationProgress />
        <Link href="/other">اذهب</Link>
      </Router>,
    );

    fireEvent.click(screen.getByRole("link", { name: "اذهب" }));
    // Advance past the 600ms complete step: setProgress(100) fires and
    // the 200ms hide timer is scheduled (the previously untracked one).
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(vi.getTimerCount()).toBe(1); // only the hide timer remains

    // Unmount DURING the hide window — the old implementation left
    // this timer running (setState on an unmounted component).
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
