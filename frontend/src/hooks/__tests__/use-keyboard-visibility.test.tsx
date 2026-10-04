/**
 * R116-S2 (P2) — useKeyboardVisibility (visualViewport pattern).
 *
 * Pins the detection contract extracted from MobileNav (96-F5 / R96
 * P2-3): a shrink of >120px from the anchored baseline = keyboard
 * visible; growing back re-anchors and clears the flag. jsdom has no
 * window.visualViewport by default — a fake implementing only the
 * surface the hook touches (height + add/removeEventListener) drives
 * both directions.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardVisibility } from "@/hooks/use-keyboard-visibility";

interface FakeViewport {
  height: number;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
}

let listeners: Array<() => void> = [];
let fake: FakeViewport;

function setHeight(height: number) {
  fake.height = height;
  for (const cb of listeners) cb();
}

beforeEach(() => {
  listeners = [];
  fake = {
    height: 800,
    addEventListener: (_type, cb) => listeners.push(cb),
    removeEventListener: (_type, cb) => {
      listeners = listeners.filter((l) => l !== cb);
    },
  };
  vi.stubGlobal("visualViewport", fake);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useKeyboardVisibility — visualViewport detection (R116-S2)", () => {
  it("stays hidden while the viewport shrinks ≤120px (URL bar collapse, not a keyboard)", () => {
    const { result } = renderHook(() => useKeyboardVisibility());
    expect(result.current).toBe(false);

    act(() => setHeight(700)); // −100px: under the threshold
    expect(result.current).toBe(false);
  });

  it("reports visible on a >120px drop (keyboard opened)", () => {
    const { result } = renderHook(() => useKeyboardVisibility());

    act(() => setHeight(620)); // −180px
    expect(result.current).toBe(true);
  });

  it("re-anchors and restores when the viewport grows back", () => {
    const { result } = renderHook(() => useKeyboardVisibility());

    act(() => setHeight(500)); // keyboard up
    expect(result.current).toBe(true);

    act(() => setHeight(800)); // keyboard closed — baseline re-anchored
    expect(result.current).toBe(false);

    // A SECOND keyboard cycle after re-anchoring still detects (the
    // baseline must track the grown-back height, not the original one).
    act(() => setHeight(650));
    expect(result.current).toBe(true);
  });

  it("detaches the resize listener on unmount", () => {
    const { unmount } = renderHook(() => useKeyboardVisibility());
    const attached = listeners.length;
    expect(attached).toBe(1);

    unmount();
    expect(listeners.length).toBe(0);

    // Post-unmount resizes must not touch state (no act warnings).
    setHeight(400);
  });

  it("degrades to false when visualViewport is unavailable (jsdom / old browsers)", () => {
    vi.stubGlobal("visualViewport", undefined);
    const { result } = renderHook(() => useKeyboardVisibility());
    expect(result.current).toBe(false);
  });
});
