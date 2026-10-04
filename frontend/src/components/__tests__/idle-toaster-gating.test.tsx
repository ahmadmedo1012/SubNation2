/**
 * A5-5 (R116) — IdleToaster deferred idle mount (App.tsx).
 *
 * The Toaster is mounted via React.lazy on idle: requestIdleCallback
 * when available, a 2 s setTimeout fallback otherwise. Nothing toast-
 * related renders before that window closes — keeping sonner + its
 * five lucide icons off the first-paint critical path. The replay
 * bridge in ui/sonner.tsx (see toaster-lazy-replay.test.tsx) makes
 * the deferral lossless for toasts fired in the window.
 *
 * Kept in a separate file from the replay tests: this suite MOCKS
 * ui/sonner (vi.mock is module-scoped and hoisted across the whole
 * file it lives in — colocating it would stub the replay suite's
 * real-sonner import too).
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toasterStub } = vi.hoisted(() => ({
  toasterStub: vi.fn(() => <div data-testid="toaster-stub" />),
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: toasterStub,
}));

import { IdleToaster } from "@/App";

beforeEach(() => {
  toasterStub.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("IdleToaster — deferred idle mount (A5-5)", () => {
  it("renders nothing until the idle window closes (jsdom: setTimeout fallback)", async () => {
    vi.useFakeTimers();

    // jsdom has no requestIdleCallback → the 2 s setTimeout fallback.
    const { container } = render(<IdleToaster />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("toaster-stub")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByTestId("toaster-stub")).toBeInTheDocument();
  });

  it("unmounting before the window closes cancels the mount (no setState on dead trees)", async () => {
    vi.useFakeTimers();

    const { container, unmount } = render(<IdleToaster />);
    expect(container).toBeEmptyDOMElement();

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    // Cancelled — nothing threw, nothing mounted posthumously.
    expect(document.querySelector("[data-testid='toaster-stub']")).toBeNull();
  });
});
