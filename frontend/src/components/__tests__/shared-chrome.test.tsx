/**
 * 94-C3 — targeted regressions for the remaining shared-chrome fixes:
 *
 *   • NavigationProgress (A3 P3-2 + P3-10): the bar grows from the
 *     RIGHT (the RTL reading origin), and every scheduled timer —
 *     including the 200ms hide step that used to be untracked — is
 *     cleared when the component unmounts mid-flight.
 *
 * R116-S2: the ui/dialog.tsx close-button describes were REMOVED —
 * the component was deleted (TopupWaitingModal migrated to AppDialog);
 * their contract is pinned in topup-waiting-modal-aria.test.tsx
 * (AppDialog close: 44px hit box + RTL END corner).
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Router, Link } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationProgress } from "@/components/NavigationProgress";

beforeEach(() => {
  // Wouter navigation mutates the shared jsdom URL — reset so each
  // test starts at "/" and its Link click is a real location change
  // (the progress effect early-returns when location is unchanged).
  window.history.pushState({}, "", "/");
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
