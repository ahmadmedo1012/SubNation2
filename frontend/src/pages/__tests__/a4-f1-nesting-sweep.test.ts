/**
 * A4-F1 sweep completion guard (R120-B7 / reviewer finding).
 *
 * The Button-inside-Link invalid nesting (invalid interactive-in-
 * interactive + a doubled tab stop per CTA) was fixed on the audited
 * surfaces in R120-B1/B2 (cart, Navbar, home, product, login) and the
 * independent R120 review found the sweep had stopped there: 6 live
 * instances remained (checkout empty state, orders empty state,
 * order-detail ×3, StockoutRiskPanel drawer). R120-B7 converted all 6
 * to the established asChild/buttonVariants-on-Link idiom — one anchor,
 * one tab stop, identical styling.
 *
 * This guard scans EVERY source .tsx under src/ (not just the six
 * files) so the class of defect cannot quietly return anywhere: DOM-
 * level pins for the chrome surfaces live in storefront-chrome-r120
 * («zero button descendants inside links»); this is the source-level
 * app-wide net.
 *
 * R122 (A1-P1): the net was blind to NATIVE lowercase button markup —
 * four live customer-site nests survived it (order-detail support link,
 * loyalty referrals CTA, referrals back + loyalty CTA) because the
 * regex only matched the capitalized Button component. The character
 * class now matches both. To keep round-tagged fix COMMENTS that quote
 * the pre-fix shape (a documentation convention this codebase leans
 * on) from tripping the net, block comments are stripped before the
 * match — same semantics as the JSX compiler, which drops them too.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Every non-test .tsx under src/ (tests are excluded — their fixtures
 * legitimately quote the raw pre-fix markup). Same walker as
 * design-system-css.test.ts. */
function collectSourceTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...collectSourceTsx(p));
    } else if (entry.name.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}
const sourceTsxFiles = collectSourceTsx(resolve(process.cwd(), "src"));

/** A <Link …> whose first element child is a <Button …> or a native
 * <button …> — the A4-F1 defect shape. The asChild composition
 * (<Button asChild><Link/>) and buttonVariants-on-Link both pass this
 * net by construction.
 *
 * R122 (A1-P1): the character class now matches the LOWERCASE native
 * button too — four live customer-site nests (order-detail ×1,
 * loyalty ×1, referrals ×2) survived the R120-B7 sweep precisely
 * because this regex only matched the capitalized Button component. */
const LINK_WRAPPING_BUTTON = /<Link[^>]*>\s*<[Bb]utton[\s>]/;

/** R122 (A1-P1): strip block comments before matching — fix comments
 * legitimately quote the pre-fix defect shape (e.g. “was a Button
 * nested inside a Link” written with real angle brackets), and the
 * compiler drops comments anyway, so only comment-free text can carry
 * a live nest. Line comments (`// …`) never contain JSX and are left
 * alone. */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const stripComments = (source: string): string => source.replace(BLOCK_COMMENT, "");

describe("A4-F1 completion — zero Button-inside-Link nesting app-wide (R120-B7)", () => {
  it("no source .tsx nests a <Button> or native <button> as the direct child of a <Link>", () => {
    const offenders: string[] = [];
    for (const f of sourceTsxFiles) {
      const text = stripComments(readFileSync(f, "utf8"));
      if (LINK_WRAPPING_BUTTON.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("the six R120-B7 conversions ride the asChild composition", () => {
    // Spot-pins the exact idiom on the files the reviewer cited — if a
    // future edit reverts one to plain Link>Button, the app-wide net
    // above catches it; these pins document WHERE the idiom lives.
    const pins: Array<[string, string]> = [
      ["pages/checkout.tsx", "تصفح المنتجات"],
      ["pages/orders.tsx", "تصفح الكتالوج"],
      ["pages/order-detail.tsx", "تواصل مع الدعم"],
      ["pages/order-detail.tsx", "تصفح المزيد"],
      ["components/admin/forecast/StockoutRiskPanel.tsx", "فتح في المنتجات"],
    ];
    for (const [rel, label] of pins) {
      const text = readFileSync(resolve(process.cwd(), "src", rel), "utf8");
      expect(text, `${rel} — ${label}`).toMatch(/<Button[^>]*asChild[^>]*>/);
    }
  });
});
