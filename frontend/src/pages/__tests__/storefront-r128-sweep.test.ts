/**
 * R128-IMP-1 (المظهر round) — the storefront typography/bidi/craft
 * sweep's source-scan umbrella.
 *
 * The round's fixes were mostly one-class/one-attribute changes across
 * the storefront; the render-behavior fixes landed with their own
 * render pins (product-card-r120-regressions' R128 describe,
 * product-cta-mobile-r126's R128 describe, cart-undo-clear's stepper
 * describe, login-account-intent-r128). This file pins the
 * SOURCE-level invariants a render test would only cover incidentally
 * — the storefront-r125-sweep.test.ts pattern: the swept strings and
 * classes can't quietly return.
 *
 * Comments are stripped before every scan (the fix notes legitimately
 * QUOTE the retired classes — only live markup counts).
 *
 * Guards (each mirrors an R128 audit finding):
 *   • A4-F3 — no page h1–h4 overrides the Arabic-safe 1.3 leading
 *             floor (index.css base layer, R96 A6 #5) with
 *             leading-tight; the six storefront h1s that rode 1.25
 *             were fixed in R128-IMP-1.
 *   • A4-F1 — checkout's order-item name truncates under dir="auto"
 *             (cart's it.name twin is render-pinned in
 *             cart-undo-clear; this guards the checkout site).
 *   • A6 P4-4 — product.tsx carries no ✓/emoji text glyph (the
 *             «رصيد كافٍ ✓» line rides lucide Check now).
 *   • A2 §4 — the PDP variant grids ride the page's 12px gap rhythm
 *             (gap-3) and MobileNav's active pill carries the 16%
 *             tint (was a near-invisible 12%).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Strip block comments (JSX `{/* *\/}` included) + full-line `//`
 *  comments — the R128 fix notes quote the retired classes, and only
 *  live markup is the contract. (storefront-r125-sweep idiom.) */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every storefront page (top level only — admin is its own lane).
 * R135 (FE-3): the product page's markup was decomposed into
 * src/components/product/*.tsx — those extracts ARE storefront page
 * surface (they render the money page's h1/h2/h3 today), so they join
 * the scan. Pure-extension: every pre-R135 file keeps being swept. */
/** R136 (parent pre-patch): wallet/checkout/home extract into
 * src/components/<page>/*.tsx this round — existsSync-guarded join,
 * so the sweep covers the extracts from the moment they land (the
 * R135 product-components precedent, generalized). Decomposing
 * agents are FORBIDDEN from editing this file. */
const pageExtracts = (page: string): string[] => {
  const dir = resolve(process.cwd(), `src/components/${page}`);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => `src/components/${page}/${f}`)
    : [];
};

function storefrontPages(): string[] {
  const pages = readdirSync(resolve(process.cwd(), "src/pages"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `src/pages/${f}`);
  const productComponents = readdirSync(resolve(process.cwd(), "src/components/product"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `src/components/product/${f}`);
  const r136Extracts = ["wallet", "checkout", "home"].flatMap((page) => pageExtracts(page));
  return [...pages, ...productComponents, ...r136Extracts];
}

/** R135 (FE-3): the product page surface is now product.tsx + its
 * extracted components under src/components/product/ — the R128 pins
 * below (no ✓ glyph, the lucide Check line, the 12px pill rhythm) must
 * keep guarding the SAME rendered markup wherever it lives. Union of
 * the comment-stripped sources; assertion strength unchanged (the
 * patterns must exist in the surface, and nothing banned may return). */
function productSurfaceSource(): string {
  const files = [
    "src/pages/product.tsx",
    ...readdirSync(resolve(process.cwd(), "src/components/product"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `src/components/product/${f}`),
  ];
  return files.map((f) => stripComments(read(f))).join("\n");
}

describe("storefront R128 sweep — h1–h4 honor the Arabic-safe 1.3 leading floor (A4-F3)", () => {
  it("no storefront page heading overrides the base 1.3 with leading-tight", () => {
    // index.css pins `h1–h4 { line-height: 1.3 }` (Readex Pro's tall
    // ascender/harakat metrics clip at 1.25-class leading); a Tailwind
    // leading-tight utility wins the cascade over the base layer, so
    // the fix was deleting the utility at the six sites that carried
    // it — and this guard keeps it deleted.
    for (const file of storefrontPages()) {
      const src = stripComments(read(file));
      expect(src, file).not.toMatch(/<h[1-4][^>]*\bleading-tight\b/);
    }
  });
});

describe("storefront R128 sweep — bidi isolation on the money-path name truncations (A4-F1)", () => {
  it('checkout\'s it.name line truncates under dir="auto" (Latin names ellipsize at their END)', () => {
    // The catalog is Latin-named; in the RTL block an unisolated
    // truncate cuts the inline-end = the Latin string's BEGINNING.
    // R136 (parent pre-patch): the pin follows the markup — reads the
    // checkout SURFACE (page ∪ components/checkout extracts).
    const src = ["src/pages/checkout.tsx", ...pageExtracts("checkout")]
      .map((f) => stripComments(read(f)))
      .join("\n");
    expect(src).toMatch(/<div[^>]*dir="auto"[^>]*>\s*\{it\.name\}/);
  });
});

describe("storefront R128 sweep — no text-glyph icons on the product page (A6 P4-4)", () => {
  it("the product surface carries no ✓ glyph (the «رصيد كافٍ» line rides lucide Check)", () => {
    // R135 (FE-3): scans the product page surface (product.tsx +
    // components/product/*) — the compact CTA moved to CtaBlock.tsx in
    // the decomposition; the pin follows the markup, same assertions.
    const src = productSurfaceSource();
    expect(src).not.toContain("✓");
    // …and the lucide replacement is live at the compact-bar line.
    expect(src).toMatch(/رصيد كافٍ[\s\S]{0,140}?<Check /);
  });
});

describe("storefront R128 sweep — rhythm + tint polish (A2 §4)", () => {
  it("the PDP variant selector rides the page's 12px gap rhythm (plan row + duration grid)", () => {
    // R135 (FE-3): the selector moved to components/product/
    // VariantSelector.tsx — the pin scans the product surface union.
    const src = productSurfaceSource();
    expect(src).toContain("flex flex-wrap gap-3");
    expect(src).toContain("grid grid-cols-2 gap-3");
  });

  it("MobileNav's active pill carries the 16% primary tint (was the near-invisible 12%)", () => {
    const src = stripComments(read("src/components/layout/MobileNav.tsx"));
    expect(src).toContain("bg-primary/16");
    expect(src).not.toContain("bg-primary/12");
  });
});
