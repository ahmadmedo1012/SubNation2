/**
 * R138 (visual) — the 404 brand-moment contract.
 *
 * not-found.tsx had zero render pins (only the App route registration
 * and the app-wide nesting/type sweeps reached it); the deep-visual
 * round re-tuned the page, and this file pins what must never silently
 * regress:
 *   • the full-bleed root carries ambient-wash (the orchestrator's
 *     static two-point atmosphere — the same lift GuestHero got this
 *     round; a 404 floats on depth, not on a void);
 *   • the way home rides the canonical R116-S1 CTA recipe (Button
 *     size lg, w-full sm:w-auto) beside the secondary «رجوع» — a 404
 *     without a clear primary exit is a dead end;
 *   • the compass art stays at w-10 (the top of the documented 7–10
 *     empty-state/hero art tier);
 *   • the quick-link chips speak the 138-D quiet-chip vocabulary
 *     (bg-muted/30 + border-border/30 resting, min-h-11 tap floor).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import NotFound from "@/pages/not-found";

function renderPage() {
  return render(
    <Router>
      <NotFound />
    </Router>,
  );
}

describe("NotFound — R138 visual chrome (the 404 brand moment)", () => {
  it("the full-bleed root carries the ambient-wash lift", () => {
    const { container } = renderPage();

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("ambient-wash");
    expect(root.className).toContain("min-h-[calc(100dvh-4rem)]");
  });

  it("the way home rides the canonical CTA (Button lg, w-full sm:w-auto) beside the secondary back", () => {
    renderPage();

    // Button asChild → the Link wears the lg recipe's classes itself.
    const home = screen.getByRole("link", { name: /العودة للرئيسية/ });
    expect(home).toHaveAttribute("href", "/");
    expect(home.className).toContain("h-12");
    expect(home.className).toContain("w-full");
    expect(home.className).toContain("sm:w-auto");
    const back = screen.getByRole("button", { name: /رجوع/ });
    expect(back.className).toContain("h-12");
  });

  it("the compass art sits at w-10 (the 7–10 empty-state art tier) and the quick-links speak the quiet-chip vocabulary", () => {
    const { container } = renderPage();

    const compass = container.querySelector("svg.w-10");
    expect(compass).not.toBeNull();
    expect(compass?.getAttribute("class")).toContain("text-primary/40");

    // The four quick-link chips (المتجر / المحفظة / طلباتي / الدعم).
    const chips = Array.from(container.querySelectorAll("span.inline-flex"));
    expect(chips).toHaveLength(4);
    for (const chip of chips) {
      expect(chip.className).toContain("bg-muted/30");
      expect(chip.className).toContain("border-border/30");
      expect(chip.className).toContain("hover:bg-muted/60");
      // R123-E4b's tap floor still rides under the new vocabulary.
      expect(chip.className).toContain("min-h-11");
    }
  });
});
