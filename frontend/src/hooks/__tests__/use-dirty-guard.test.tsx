/**
 * 98-F7 (R98-05 — A5 §2) — useDirtyGuard hook tests.
 *
 * Before this hook there was ZERO beforeunload usage in the repo: the
 * long admin forms (settings / products editor / coupons / promotions)
 * guarded their SUBMIT paths but never the LEAVE path — a refresh or
 * tab close mid-edit silently discarded the operator's work.
 *
 * Contract pinned here:
 *
 *   1. Clean state registers NO beforeunload listener (zero overhead /
 *      no prompt on innocent exits).
 *   2. The listener is registered on the clean→dirty transition and
 *      REMOVED on the dirty→clean transition (revert / successful save
 *      disarms the guard — no stale listener leak).
 *   3. While dirty, a beforeunload event is cancelled (preventDefault +
 *      returnValue) so Chromium shows the "unsaved changes" dialog.
 */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";

function Harness({ dirty }: { dirty: boolean }) {
  useDirtyGuard(dirty);
  return <div data-testid="harness">{dirty ? "dirty" : "clean"}</div>;
}

describe("useDirtyGuard — beforeunload lifecycle (98-F7 R98-05)", () => {
  it("registers no listener while clean and arms it on the dirty transition", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    try {
      // Clean mount: no beforeunload registration at all.
      const { rerender } = render(<Harness dirty={false} />);
      expect(addSpy.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(0);

      // Dirty transition: exactly one beforeunload listener added.
      rerender(<Harness dirty={true} />);
      const armed = addSpy.mock.calls.filter(([type]) => type === "beforeunload");
      expect(armed).toHaveLength(1);

      // Back to clean (revert / successful save): the SAME listener is
      // removed — no stale guard keeping the prompt alive forever.
      rerender(<Harness dirty={false} />);
      const removed = removeSpy.mock.calls.filter(([type]) => type === "beforeunload");
      expect(removed).toHaveLength(1);
      // removeEventListener received the exact handler instance it added.
      expect(removed[0]![1]).toBe(armed[0]![1]);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it("does not re-register on dirty→dirty re-renders (stable listener)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    try {
      const { rerender } = render(<Harness dirty={true} />);
      rerender(<Harness dirty={true} />);
      rerender(<Harness dirty={true} />);
      expect(addSpy.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(1);
    } finally {
      addSpy.mockRestore();
    }
  });

  it("cancels the beforeunload event while dirty (the browser prompt fires)", () => {
    const { rerender } = render(<Harness dirty={false} />);
    rerender(<Harness dirty={true} />);

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const preventSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalledTimes(1);
    // jsdom's Event.returnValue getter reflects defaultPrevented (the
    // legacy `e.returnValue = ""` assignment is a real-Chromium-only
    // affordance — observable here as the cancellation itself).
    expect(event.defaultPrevented).toBe(true);

    // Clean again → the same event no longer gets cancelled.
    rerender(<Harness dirty={false} />);
    const after = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const preventAfter = vi.spyOn(after, "preventDefault");
    window.dispatchEvent(after);
    expect(preventAfter).not.toHaveBeenCalled();
  });
});
