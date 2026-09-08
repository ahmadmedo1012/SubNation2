/**
 * 94-C3 — the unified CopyButton (A3 #12 / P2-4 / P3-9 / P3-10 / P1-3).
 *
 * CopyButton is now the single copy lifecycle implementation (idle →
 * copied → failed) — the behavior CopilotPanel's AskAnswer button
 * implements locally. These tests pin:
 *
 *   1. Success and FAILURE feedback via the shared copyToClipboard
 *      helper (the old button silently kept "نسخ" when the clipboard
 *      refused the write).
 *   2. The reset window (1.5s copied / 2s failed) actually resets, and
 *      re-clicking mid-window doesn't leak stacked timers.
 *   3. type="button" — safe inside host forms (previously submitted
 *      them instead of copying).
 *   4. 44px minimum hit box + the text-primary-text token.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "@/components/CopyButton";
import { copyToClipboard } from "@/lib/utils";

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, copyToClipboard: vi.fn() };
});

beforeEach(() => {
  vi.mocked(copyToClipboard).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const TEXT = "SN-1234-ABCD";

function getButton(): HTMLElement {
  return screen.getByRole("button", { name: /نسخ|تم|تعذّر/ });
}

describe("CopyButton — unified copy lifecycle (94-C3 A3 #12)", () => {
  it("announces success: md size shows «تم النسخ», sm shows «تم»", async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(true);

    const { rerender } = render(<CopyButton text={TEXT} size="md" />);
    fireEvent.click(getButton());
    expect(await screen.findByRole("button", { name: "تم النسخ" })).toBeInTheDocument();

    rerender(<CopyButton text={TEXT} />);
    fireEvent.click(getButton());
    expect(await screen.findByRole("button", { name: "تم" })).toBeInTheDocument();
  });

  it("announces failure instead of pretending the copy happened", async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(false);

    render(<CopyButton text={TEXT} size="md" />);
    fireEvent.click(getButton());

    expect(await screen.findByRole("button", { name: "تعذّر النسخ" })).toBeInTheDocument();
    expect(copyToClipboard).toHaveBeenCalledWith(TEXT);
  });

  it("the failure tone rides the destructive token, not raw red hues", async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(false);
    render(<CopyButton text={TEXT} />);
    fireEvent.click(getButton());

    const failed = await screen.findByRole("button", { name: "تعذّر" });
    expect(failed.className).toContain("text-destructive");
    expect(failed.className).not.toMatch(/\b(red|orange|amber|yellow)-\d{3}\b/);
  });

  it("resets to the idle label after the 1.5s window", async () => {
    vi.useFakeTimers();
    vi.mocked(copyToClipboard).mockResolvedValue(true);

    render(<CopyButton text={TEXT} size="md" />);
    fireEvent.click(getButton());
    // Flush the copyToClipboard promise (microtasks — no timers needed).
    await act(async () => {});
    expect(getButton()).toHaveTextContent("تم النسخ");

    await act(async () => {
      vi.advanceTimersByTime(1_600);
    });
    expect(getButton()).toHaveTextContent("نسخ");
  });

  it("re-clicking mid-window doesn't stack reset timers (P3-10)", async () => {
    vi.useFakeTimers();
    vi.mocked(copyToClipboard).mockResolvedValue(true);

    render(<CopyButton text={TEXT} size="md" />);
    fireEvent.click(getButton());
    await act(async () => {});
    expect(getButton()).toHaveTextContent("تم النسخ");
    const timersAfterFirst = vi.getTimerCount();

    // Second click while the first reset window is still pending.
    fireEvent.click(getButton());
    await act(async () => {});
    const timersAfterSecond = vi.getTimerCount();

    // The old timer was cleared — exactly one reset timer survives.
    expect(timersAfterSecond).toBe(timersAfterFirst);

    await act(async () => {
      vi.advanceTimersByTime(1_600);
    });
    expect(getButton()).toHaveTextContent("نسخ");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmounts without leaving a pending reset timer (P3-10)", async () => {
    vi.useFakeTimers();
    vi.mocked(copyToClipboard).mockResolvedValue(true);

    const { unmount } = render(<CopyButton text={TEXT} />);
    fireEvent.click(getButton());
    await act(async () => {});
    expect(getButton()).toHaveTextContent("تم");
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("CopyButton — form-safety + touch/token hygiene (A3 P3-9 / P1-3 / P2-4)", () => {
  it('carries type="button" so a host <form> can\'t be submitted by it', () => {
    render(<CopyButton text={TEXT} />);
    expect(getButton()).toHaveAttribute("type", "button");
  });

  it("keeps a 44px minimum hit box (was ~24×24 in the sm variant)", () => {
    render(<CopyButton text={TEXT} />);
    expect(getButton().className).toContain("min-h-11");
  });

  it("rides the text-primary-text token, not raw text-primary (P2-4)", () => {
    render(<CopyButton text={TEXT} />);
    const cls = getButton().className;
    expect(cls).toContain("text-primary-text");
    expect(cls).not.toMatch(/text-primary(?![-\w])/);
  });
});
