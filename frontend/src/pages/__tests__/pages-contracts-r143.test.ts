/**
 * R143 wave-C source-scan contracts — the pages-side fixes that don't
 * need a render to pin (the r139 visual-suite idiom: readFileSync +
 * stripComments + exact-string pins; the components lane's twin is
 * components/__tests__/storefront-contracts-r143.test.ts). Covers:
 *
 *   • L3-2 — the pages-side truncation sites (orders row name,
 *     flash-sales card name, profile identity row) ride dir="auto" +
 *     text-right (the ProductCard F-1 recipe) so Latin product/display
 *     names truncate from the correct end. R167 (F11 wave 2): the
 *     orders row moved verbatim to components/orders/OrderRow — its
 *     pin follows the markup to the extract's address (the R146
 *     CopyField precedent; the recipe itself is unchanged).
 *   • L2-2 — the auth family (login/register/onboarding) + the PDP's
 *     mobile card-frame carry the r139 resting edge /60; the /55 the
 *     sweep missed must not come back.
 *   • L1-3/L4-1 — the onboarding first-run copy names only stocked
 *     brands (the I-4 truthfulness class: شاهد went unstocked and its
 *     R122-era "verified-live" comment was falsified).
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

describe("R143 (L3-2) — the orders/flash-sales/profile truncation sites isolate bidi (dir=auto + text-right)", () => {
  // The ProductCard F-1 recipe: pure-Latin names truncate from the wrong
  // end in an RTL block (the ellipsis eats the brand head — the uniquely
  // identifying token); text-right re-anchors the visual edge.
  // R167 (F11 wave 2): the orders ROW moved to components/orders/OrderRow
  // — the pin reads the extract (the page kept no truncating element).
  it.each([
    { rel: "src/components/orders/OrderRow.tsx", needle: "order.product_name" },
    { rel: "src/pages/flash-sales.tsx", needle: "product.name" },
    { rel: "src/pages/profile.tsx", needle: "user.display_name" },
  ])("$rel: the $needle element truncates under dir=auto", ({ rel, needle }) => {
    const src = stripComments(read(rel));
    // Anchor on the TRUNCATING element specifically (avatar initials and
    // img alts reference the same fields without truncating).
    const escaped = needle.replace(/[{}$.]/g, (m) => `\\${m}`);
    const line = src.match(new RegExp(`<[^>]*truncate[^>]*>[^<]*${escaped}`));
    expect(line, `${rel}: the ${needle} truncating element was not found`).toBeTruthy();
    // The element itself (h3/div/span opening tag) carries both halves.
    const tag = line![0].slice(0, line![0].indexOf(">"));
    expect(tag).toContain('dir="auto"');
    expect(tag).toContain("truncate");
    expect(tag).toContain("text-right");
  });
});

describe("R143 (L2-2) — the auth family + the PDP mobile frame ride the /60 resting edge", () => {
  it.each([
    "src/pages/login.tsx",
    "src/pages/register.tsx",
    "src/pages/onboarding.tsx",
    "src/pages/product.tsx",
  ])("%s: no border-border/55 anywhere (the r139 sweep's missed sites)", (rel) => {
    expect(stripComments(read(rel)), `${rel} regressed to /55`).not.toContain("border-border/55");
  });

  it("the auth cards actually carry the /60 value (the ban is not vacuous)", () => {
    expect(stripComments(read("src/pages/login.tsx"))).toContain(
      "bg-card border border-border/60 rounded-3xl",
    );
    expect(stripComments(read("src/pages/register.tsx"))).toContain(
      "bg-card border border-border/60 rounded-3xl",
    );
    expect(stripComments(read("src/pages/onboarding.tsx"))).toContain(
      "bg-card border border-border/60 rounded-3xl",
    );
    expect(stripComments(read("src/pages/product.tsx"))).toContain("max-lg:border-border/60");
  });
});

describe("R143 (L1-3/L4-1) — the onboarding copy names only stocked brands (the I-4 class)", () => {
  const src = stripComments(read("src/pages/onboarding.tsx"));

  it("the catalog FeatureRow no longer advertises شاهد (unstocked — the R142 I-4 probe: search=شاهد → 0)", () => {
    expect(src).not.toContain("شاهد");
  });

  it("the replacement brand is the I-4 precedent's verified-live Paramount+", () => {
    expect(src).toContain("باراماونت+");
  });

  it("the stale R122-era verification claim is gone from the source (comments included — it lied about the catalog)", () => {
    // The FULL source (not comment-stripped): the "verified-live in
    // streaming" prose contradicted the live catalog and had to die with
    // the string it justified.
    expect(read("src/pages/onboarding.tsx")).not.toContain("verified-live in streaming");
  });
});

describe("R143 (L2-5, pages side) — the three pages-owned admin fields ride the shared focus idiom", () => {
  // The input.tsx recipe (focus-visible:ring-2 ring-ring + offset) — the
  // components lane swept the topup-modals family; these three pages-side
  // textareas (risk notes, draft edit, rejection reason) were the residue.
  it.each([
    {
      rel: "src/pages/admin/risk-event.tsx",
      retired: "focus:ring-2 focus:ring-primary/30",
    },
    {
      rel: "src/pages/admin/enrichment.tsx",
      retired: "focus:ring-2 focus:ring-primary/30",
    },
  ])("$rel rides the idiom (the $retired sub-floor ring is gone)", ({ rel, retired }) => {
    const src = stripComments(read(rel));
    expect(src, `${rel} still carries the sub-3:1 ring`).not.toContain(retired);
    expect(src).toContain(
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    );
  });

  it("enrichment.tsx: the destructive-tinted rejection ring also retired (/25 alpha)", () => {
    const src = stripComments(read("src/pages/admin/enrichment.tsx"));
    expect(src).not.toContain("focus:ring-destructive/25");
  });
});
