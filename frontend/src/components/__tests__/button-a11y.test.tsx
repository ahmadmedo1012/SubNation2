/**
 * J-4 (R142) — the Button primitive's a11y className contract.
 *
 * Button is the app's base interactive primitive and had ZERO behavior
 * tests (census: only two string-content assertions inside admin visual
 * suites). The unpinned surface is exactly J-2's: `focus-visible:
 * outline-none` suppresses the global focus outline, so the ring
 * substitution below is the ONLY keyboard-focus indicator — deleting
 * `focus-visible:ring-2 focus-visible:ring-ring` while keeping
 * `outline-none` makes every button in the app invisible to keyboard
 * users with zero failing tests. The same file pins:
 *
 *   • J-2 (R142): `focus-visible:ring-offset-background` — Tailwind v4's
 *     default `--tw-ring-offset-color` is #fff, so without the offset
 *     token every keyboard-focused Button drew a 1px WHITE halo between
 *     the crimson ring and the dark surface (input.tsx / switch.tsx /
 *     CopilotComposer already carried the token; Button did not).
 *   • J-1 (R128 A1-F2) regression: the destructive variant fills with
 *     the AA `--destructive-surface` channel (white ink = 4.52:1), never
 *     the raw `--destructive` (4.00:1 — the pre-R128 AA fail that
 *     use-confirm/RejectModal regressed in R142-J1/D-5 and got re-fixed).
 *
 * The className-contract pin is the repo's switch-rtl.test.tsx idiom
 * (the class string IS the behavior contract for a pure styling
 * primitive — Tailwind compiles it verbatim).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "@/components/ui/button";

describe("Button — keyboard-focus a11y contract (J-4 / J-2)", () => {
  it("focus-visible: outline suppressed, ring-2 + ring color + background offset token all present", () => {
    render(<Button>اشترِ الآن</Button>);
    const btn = screen.getByRole("button", { name: "اشترِ الآن" });

    // The outline suppression that makes the ring the ONLY indicator…
    expect(btn.className).toContain("focus-visible:outline-none");
    // …the ring itself (deleting either class = invisible focus, the
    // exact unpinned regression this suite exists to catch)…
    expect(btn.className).toContain("focus-visible:ring-2");
    expect(btn.className).toContain("focus-visible:ring-ring");
    // …and the J-2 offset token: the 1px gap must paint the background
    // token, not Tailwind v4's default #fff (the dark-theme white halo).
    expect(btn.className).toContain("focus-visible:ring-offset-background");
  });

  it("the destructive variant rides the AA --destructive-surface channel, never raw --destructive (J-1 pin)", () => {
    render(<Button variant="destructive">إفراغ السلة</Button>);
    const btn = screen.getByRole("button", { name: "إفراغ السلة" });

    // The R128 A1-F2 surface pair (white ink 4.52:1 on the 52% channel)…
    expect(btn.className).toContain("bg-destructive-surface");
    // …and NOT the raw 58% channel (4.00:1 — AA fail) as the FILL. The
    // lookahead tolerates the surface/border/foreground token family.
    expect(btn.className).not.toMatch(/(?<!-)bg-destructive(?![-\w])/);
    // Sanity: the raw channel never appears as the variant's own class
    // either (border/ink tokens use it deliberately and stay allowed).
    expect(buttonVariants({ variant: "destructive" })).not.toMatch(/(?<!-)bg-destructive(?![-\w])/);
  });
});
