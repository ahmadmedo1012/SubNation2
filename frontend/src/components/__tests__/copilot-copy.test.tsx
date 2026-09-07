/**
 * Copilot answer-copy regression (B6-P2-2, component scope).
 *
 * CopilotPanel's answer-card copy button was the only component-scope
 * bypass of the shared `copyToClipboard` helper: raw
 * `navigator.clipboard.writeText` with `// ignore` as the failure
 * handler — on insecure contexts / strict Firefox the copy died
 * silently AND left an unhandled promise rejection.
 *
 * The fix mirrors wallet.tsx's CopyBtn pattern: route through the shared
 * helper and surface the boolean failure as visible feedback. These
 * tests pin both paths via AskAnswer (exported for this purpose).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AskAnswer } from "@/components/admin/copilot/CopilotPanel";
import { copyToClipboard } from "@/lib/utils";

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, copyToClipboard: vi.fn() };
});

beforeEach(() => {
  vi.mocked(copyToClipboard).mockReset();
});

const ANSWER = "المخزون الحالي للمنتج هو 12 اشتراكاً.";

function renderAnswerCard() {
  return render(<AskAnswer answer={ANSWER} toolUses={[]} directExecutions={[]} />);
}

function getCopyButton(): HTMLElement {
  return screen.getByRole("button", { name: "نسخ" });
}

describe("CopilotPanel answer copy — shared helper + failure feedback (B6-P2-2)", () => {
  it("routes the copy through copyToClipboard with the answer text", async () => {
    vi.mocked(copyToClipboard).mockResolvedValue(true);
    renderAnswerCard();

    fireEvent.click(getCopyButton());

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(ANSWER));
    // Success feedback: the button announces the copied state.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "تم النسخ" })).toBeInTheDocument(),
    );
  });

  it("shows visible failure feedback when the shared helper resolves false", async () => {
    // e.g. insecure context or clipboard permission denied — the old
    // implementation swallowed this path (`// ignore`).
    vi.mocked(copyToClipboard).mockResolvedValue(false);
    renderAnswerCard();

    fireEvent.click(getCopyButton());

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledTimes(1));
    const failed = await screen.findByRole("button", { name: "تعذّر النسخ" });
    expect(failed).toBeInTheDocument();
  });

  it("no raw navigator.clipboard call escapes the component on failure", async () => {
    // Belt-and-braces: the helper itself is the only clipboard consumer.
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    vi.mocked(copyToClipboard).mockResolvedValue(false);
    renderAnswerCard();

    fireEvent.click(getCopyButton());
    await screen.findByRole("button", { name: "تعذّر النسخ" });

    expect(writeText).not.toHaveBeenCalled();
  });
});
