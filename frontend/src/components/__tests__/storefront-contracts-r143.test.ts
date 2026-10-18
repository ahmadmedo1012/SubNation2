/**
 * R143 wave-D source-scan contracts — the components-side fixes that
 * don't need a render to pin (the r139 visual-suite idiom: readFileSync
 * + stripComments + exact-string pins). Covers:
 *
 *   • L2-5 — the admin hand-rolled textarea/inline-input family rides
 *     the shared Input's focus idiom (focus-visible:ring-2 + ring-ring +
 *     ring-offset-background); the 1px/low-alpha composites are banned.
 *   • L2-6 — GlobalSearch's combobox row + option buttons carry a
 *     visible focus treatment (outline-none with no replacement was the
 *     finding).
 *   • L3-2 — the three components-side truncation sites ride
 *     dir="auto" (+ text-right, the ProductCard F-1 recipe) so Latin
 *     product names truncate from the correct end.
 *   • L3-4 — the components-side form controls ride the A13-F7
 *     pointer:fine zoom guard instead of bare md:text-sm.
 *   • L2-7 — the alerts type chips' ACTIVE count badge is theme-aware
 *     (no dark-default bg-white/10).
 *
 * Pages-side siblings of each class (orders/flash-sales/profile
 * truncation sites, admin risk-event/enrichment focus rings, the auth
 * cards' /55) belong to the pages lane — see .agents-r143/impl-D.md.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** The r139 suite's comment stripper — rationale prose may NAME retired
 * strings without tripping the bans. */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

describe("R143 (L2-5) — the admin field family rides the shared focus idiom", () => {
  // The input.tsx recipe: focus-visible:outline-none + ring-2 + ring-ring
  // + ring-offset-1 + ring-offset-background. The 1px focus:ring-1 and
  // the low-alpha /25-/30 rings composite below the 3:1 indicator floor
  // (F3-01) — money-path note fields (topup reject/bulk) worst of all.
  const FOCUS_IDIOM = [
    "focus-visible:outline-none",
    "focus-visible:ring-2",
    "focus-visible:ring-ring",
    "focus-visible:ring-offset-1",
    "focus-visible:ring-offset-background",
  ];

  it.each([
    "src/components/admin/products/InlineStockEdit.tsx",
    "src/components/admin/products/ProductEditorCard.tsx",
    "src/components/admin/topups/BulkConfirmModal.tsx",
    "src/components/admin/topups/RejectModal.tsx",
    // R157-C: the shared native-select primitive carries the idiom
    // (the five retired hand-rolled selects converged on it).
    "src/components/ui/select.tsx",
  ])("%s: every focus ring rides the input.tsx idiom", (rel) => {
    const src = stripComments(read(rel));
    for (const token of FOCUS_IDIOM) {
      expect(src, `${rel} lost "${token}"`).toContain(token);
    }
    expect(src, `${rel} still carries the 1px composite`).not.toContain("focus:ring-1");
    expect(src, `${rel} still carries a raw destructive ring`).not.toContain("ring-destructive");
  });

  it("ProductEditorCard's hand-rolled fields ride the idiom (textarea locally + select via the shared primitive)", () => {
    // R157-C: the select moved onto ui/select (which carries the full
    // idiom — pinned in the it.each above); only the textarea remains
    // hand-rolled locally.
    const src = stripComments(read("src/components/admin/products/ProductEditorCard.tsx"));
    // R163: the features[] editor added the second hand-rolled textarea
    // (same R143 L2-5 idiom) — one ring per local field.
    expect(src.match(/focus-visible:ring-2/g)).toHaveLength(2);
    expect(src).toContain("<Select");
  });
});

describe("R143 (L2-6) — GlobalSearch: suppressed outlines have visible replacements", () => {
  const src = read("src/components/admin/layout/GlobalSearch.tsx");

  it("the combobox input row carries the focus-within ring (CopilotComposer's idiom)", () => {
    expect(src).toContain("focus-within:ring-2 focus-within:ring-ring");
    expect(src).toContain("focus-within:ring-offset-1 focus-within:ring-offset-background");
  });

  it("every outline-none option button carries the focus-visible ring (Tab is trapped in the palette)", () => {
    // Three option rows (orders/users/products); each outline-none
    // button gets the button.tsx ring recipe for DIRECT keyboard focus.
    expect(src.match(/focus-visible:ring-2 focus-visible:ring-ring/g)).toHaveLength(3);
    // …and the r139 calm-active fill stays the arrow-key vocabulary.
    expect(src.match(/bg-primary\/15" : "hover:bg-muted\/40"/g)).toHaveLength(3);
  });
});

describe("R143 (L3-2) — components-side truncation sites isolate bidi (dir=auto + text-right)", () => {
  // The ProductCard F-1 recipe: pure-Latin names truncate from the wrong
  // end in an RTL block (the ellipsis eats the brand head — the uniquely
  // identifying token); text-right re-anchors the visual edge.
  it.each([
    { rel: "src/components/home/RecentOrdersStrip.tsx", needle: "order.product_name" },
    { rel: "src/components/product/RecommendationsSection.tsx", needle: "{r.name}" },
    { rel: "src/components/product/ProductBreadcrumbNav.tsx", needle: "{product.name}" },
  ])("$rel: the $needle line truncates under dir=auto", ({ rel, needle }) => {
    const src = stripComments(read(rel));
    const line = src.match(new RegExp(`<[^>]*>[^<]*${needle.replace(/[{}$.]/g, (m) => `\\${m}`)}`));
    expect(line, `${rel}: the ${needle} element was not found`).toBeTruthy();
    // The element itself (h3/div/span opening tag) carries both halves.
    const tag = line![0].slice(0, line![0].indexOf(">"));
    expect(tag).toContain('dir="auto"');
    expect(tag).toContain("truncate");
    expect(tag).toContain("text-right");
  });
});

describe("R143 (L3-4) — components-side fields ride the A13-F7 pointer:fine zoom guard", () => {
  const GUARD = "[@media(min-width:48rem)_and_(pointer:fine)]:text-sm";

  it.each([
    "src/components/product/CouponField.tsx",
    // R157-C: CatalogFiltersBar's sort select moved onto ui/select —
    // the guard rides the primitive now (the call site inherits it).
    "src/components/ui/select.tsx",
    "src/components/support/CreateTicketForm.tsx",
  ])("%s: no bare md:text-sm on the form control", (rel) => {
    const src = stripComments(read(rel));
    expect(src, `${rel} lost the guard`).toContain(GUARD);
    // The bare form re-defeats the guard on iPad-class coarse-pointer
    // viewports (twMerge keeps both — the caller's md: wins).
    expect(src).not.toMatch(/(^|["` ])md:text-sm[" ]/);
  });
});

describe("R143 (L2-7) — the alerts type chips' active badge is theme-aware", () => {
  it("no dark-default bg-white/10 on the count badge; the active twin reads bg-foreground/10", () => {
    const src = stripComments(read("src/components/admin/alerts/AlertsTypeChips.tsx"));
    expect(src).not.toContain("bg-white/10");
    expect(src).toContain('"bg-foreground/10" : "bg-muted/60"');
    // The chip-body severity tuple + aria-pressed wiring are untouched
    // (pinned in admin-comms-promo-visual-r139) — spot-check them here.
    expect(src).toContain("aria-pressed={filter === s.key}");
  });
});
