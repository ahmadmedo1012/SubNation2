/**
 * R129-B1 (B1-3) — the CopilotPanel tool-trace render pin.
 *
 * R128-A6 (P4-4) swapped the progress feed's emoji/✓/✗ text glyphs for
 * lucide icons AT THE RENDER LAYER (ProgressTraceLine; the string
 * transport kept its shapes) — but nothing pinned it: reverting to the
 * raw-string render stayed green. Pinned here per arm:
 *
 *   • "✓ …" → a Check svg carrying the success ink + the Arabic label
 *     WITHOUT the ✓ glyph (AT reads the label only)
 *   • "✗ …" → an X svg with the destructive ink + clean label
 *   • "🔍 …" (and the other 6 tool emoji) → the tool's lucide icon +
 *     clean label — spot-checked on the search + wrench + fallback arms
 *   • a plain string (no marker) → text-only line, NO svg
 */
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ProgressTraceLine } from "../../components/admin/copilot/CopilotPanel";

function line(text: string): HTMLElement {
  const { container } = render(<ProgressTraceLine line={text} />);
  return container.firstElementChild as HTMLElement;
}

describe("R129-B1: ProgressTraceLine (A6 P4-4) — glyphs render as lucide icons", () => {
  it("status ✓ arm: success Check icon + the label with the glyph stripped", () => {
    const el = line("✓ يقرأ تفاصيل المنتج (2)");
    const svg = el.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class") ?? "").toContain("text-status-success");
    expect(el.textContent).toContain("يقرأ تفاصيل المنتج (2)");
    expect(el.textContent).not.toContain("✓");
  });

  it("status ✗ arm: destructive X icon + the clean label", () => {
    const el = line("✗ تعذّر تحديث المخزون");
    const svg = el.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class") ?? "").toContain("text-destructive");
    expect(el.textContent).toContain("تعذّر تحديث المخزون");
    expect(el.textContent).not.toContain("✗");
  });

  it("tool emoji arm: Search icon for 🔍 + the label without the emoji", () => {
    const el = line("🔍 يبحث عن المنتج");
    const svg = el.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(el.textContent).toContain("يبحث عن المنتج");
    expect(el.textContent).not.toContain("🔍");
  });

  it("unknown-tool fallback arm: 🔧 maps to the Wrench icon", () => {
    const el = line("🔧 some-unknown-tool");
    expect(el.querySelector("svg")).not.toBeNull();
    expect(el.textContent).toContain("some-unknown-tool");
    expect(el.textContent).not.toContain("🔧");
  });

  it("marker-less line: plain text, NO icon injected", () => {
    const el = line("جارٍ التفكير…");
    expect(el.querySelector("svg")).toBeNull();
    expect(el.textContent).toBe("جارٍ التفكير…");
  });

  it("the icons are decorative (aria-hidden) — AT reads the Arabic only", () => {
    for (const text of ["✓ تم", "✗ فشل", "🔍 بحث"]) {
      const el = line(text);
      expect(el.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      cleanup();
    }
  });
});
