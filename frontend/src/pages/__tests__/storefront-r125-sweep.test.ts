/**
 * R125-I7 (A7 B-2/B-6/B-7/B-9/B-12) — the storefront sweep's
 * source-scan umbrella.
 *
 * The round's P3 batch was mostly one-class consistency fixes across
 * the storefront pages. The render-behavior fixes landed with their
 * own render pins (category-error-state, terms-legal-page,
 * status-page, order-refund-receipt's pending describe,
 * wallet-submit's verb describe, cart-undo-clear's fallback
 * describe, home-secondary-widgets' error describe); this file pins
 * the SOURCE-level invariants a render test would only cover
 * incidentally — the A10 §C-48 pattern ("the storefront sweep's pin
 * pattern"): the swept strings and classes can't quietly return.
 *
 * Comments are stripped before every scan (the fix notes legitimately
 * QUOTE the retired classes — only live markup counts).
 *
 * Guards (each mirrors a computed/measured finding):
 *   • B-2  — no raw `hover:text-primary` (the ~3.76:1 surface token)
 *            as a TEXT hover state on the swept pages (icon-only
 *            hovers legitimately pass the 3:1 non-text floor).
 *   • B-6  — the first-letter fallback glyphs ride full
 *            --muted-foreground (the half-alpha primaries measured
 *            1.62–2.35:1 on their tiles).
 *   • B-7  — StepDot carries no `active` prop (the collapsed legend).
 *   • B-9  — the lypay submit-verb variants are gone.
 *   • B-12 — no >1px colored side stripes and no rounded-3xl card
 *            shells on the swept storefront files.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Strip block comments (JSX `{/* *\/}` included) + full-line `//`
 *  comments — the R125 fix notes quote the retired classes, and only
 *  live markup is the contract. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const SWEPT_FILES = [
  "src/pages/home.tsx",
  "src/pages/category.tsx",
  "src/pages/product.tsx",
  "src/pages/orders.tsx",
  "src/pages/order-detail.tsx",
  "src/pages/cart.tsx",
  "src/pages/terms.tsx",
  "src/pages/status.tsx",
  "src/pages/wallet.tsx",
] as const;

/** Each offending line, for the assertion message. */
function liveLines(src: string, pattern: RegExp): string[] {
  return stripComments(src)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && pattern.test(l));
}

describe("storefront R125 sweep — text hovers ride the text-safe token (A7 B-2)", () => {
  // Raw hover:text-primary (NOT -text/…) as a text hover is sub-AA
  // (3.76:1 on the dark card); the swept pages must ride
  // text-primary-text or a non-color hover feedback. The lookbehind
  // excludes `group-hover:text-primary` — the ICON-only row chevrons
  // A7 explicitly left alone (they pass WCAG 1.4.11's 3:1 non-text
  // floor; only the small-TEXT hover states are the B-2 defect).
  const RAW_TEXT_HOVER = /(?<!group-)hover:text-primary(?![-\w])/;

  it("no raw hover:text-primary remains on the swept storefront pages", () => {
    for (const file of SWEPT_FILES) {
      const hits = liveLines(read(file), RAW_TEXT_HOVER);
      expect(hits, `${file}: ${hits.join(" | ")}`).toHaveLength(0);
    }
  });
});

describe("storefront R125 sweep — fallback glyphs ride --muted-foreground (A7 B-6)", () => {
  it("cart/orders/order-detail/product first-letter fallbacks carry no half-alpha ink", () => {
    const sites: Array<[file: string, gone: RegExp]> = [
      ["src/pages/cart.tsx", /text-primary\/50/],
      ["src/pages/orders.tsx", /text-primary\/50/],
      ["src/pages/order-detail.tsx", /text-primary\/45/],
      ["src/pages/product.tsx", /muted-foreground\/55/],
    ];
    for (const [file, gone] of sites) {
      const hits = liveLines(read(file), gone);
      expect(hits, `${file}: ${hits.join(" | ")}`).toHaveLength(0);
    }
  });
});

describe("storefront R125 sweep — wallet topup legend + verbs (A7 B-7/B-9)", () => {
  const wallet = read("src/pages/wallet.tsx");

  it("StepDot exposes no `active` prop (the collapsed flat legend — no fake progress semantics)", () => {
    // The prop was deleted with its dead inactive branch; a call site
    // passing it again would resurrect the dishonest where-am-I claim.
    const hits = liveLines(wallet, /<StepDot[^>]*\bactive\b/);
    expect(hits, hits.join(" | ")).toHaveLength(0);
  });

  it("the lypay submit-verb variants are gone (one verb pair per action)", () => {
    const hits = liveLines(wallet, /تأكيد طلب الشحن|تأكيد الإرسال/);
    expect(hits, hits.join(" | ")).toHaveLength(0);
  });
});

describe("storefront R125 sweep — craft-floor REFUSE residue (A7 B-12)", () => {
  it("no colored side stripe exceeds 1px on the swept storefront files", () => {
    const sites: Array<[file: string, pattern: RegExp, label: string]> = [
      ["src/pages/home.tsx", /w-\[2(\.\d+)?px\]/, "hero accent stripe >1px"],
      ["src/pages/category.tsx", /w-\[2px\]/, "hero edge stripe >1px"],
      ["src/pages/category.tsx", /border-r-2\b/, "2px heading stripe"],
      ["src/pages/terms.tsx", /border-r-2\b/, "2px heading stripe"],
      ["src/pages/wallet.tsx", /border-l-2\b/, "2px skeleton stripe"],
      ["src/pages/orders.tsx", /border-r-2\b/, "2px skeleton stripe"],
    ];
    for (const [file, pattern, label] of sites) {
      const hits = liveLines(read(file), pattern);
      expect(hits, `${file}: ${label} → ${hits.join(" | ")}`).toHaveLength(0);
    }
  });

  it("no rounded-3xl card shell remains on home (24px radius is over the 12–16px band)", () => {
    const hits = liveLines(read("src/pages/home.tsx"), /rounded-3xl/);
    expect(hits, hits.join(" | ")).toHaveLength(0);
  });

  it("the TrustCard 3-up template is gone from home (one inline strip closes the page)", () => {
    const home = stripComments(read("src/pages/home.tsx"));
    expect(home).not.toMatch(/import \{ TrustCard \}/);
    // The inline strip carries the same three honest claims.
    expect(home).toContain("تسليم فوري بعد الدفع");
    expect(home).toContain("دفع آمن");
    expect(home).toContain("دعم محلي");
  });
});
