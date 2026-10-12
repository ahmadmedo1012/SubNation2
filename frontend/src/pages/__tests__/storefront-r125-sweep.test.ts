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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Strip block comments (JSX `{/* *\/}` included) + full-line `//`
 *  comments — the R125 fix notes quote the retired classes, and only
 *  live markup is the contract. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// R135 (FE-3): the product page's markup was decomposed into
// src/components/product/*.tsx — the extracted product components join
// the swept list so the B-2 (raw hover:text-primary) and B-6
// (half-alpha fallback ink) nets keep covering the SAME rendered
// markup wherever it lives. Pure-extension: every pre-R135 entry stays.
const PRODUCT_COMPONENTS = readdirSync(resolve(process.cwd(), "src/components/product"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => `src/components/product/${f}`);

// R136 (parent pre-patch): wallet + home decompose into
// src/components/<page>/*.tsx this round — the R135 product-page
// precedent. The pins below follow the markup (page ∪ extracts),
// existsSync-guarded so the union is exactly the page until the
// extracts land: no assertion changes strength mid-wave, and the
// decomposing agents never need to edit this shared file.
const pageExtracts = (page: string): string[] => {
  const dir = resolve(process.cwd(), `src/components/${page}`);
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => `src/components/${page}/${f}`)
    : [];
};
/** Raw (unstripped) page ∪ extracts source — liveLines strips
 * comments itself, so this preserves its exact semantics. */
const pageSurface = (page: string): string =>
  [`src/pages/${page}.tsx`, ...pageExtracts(page)].map((f) => read(f)).join("\n");

const SWEPT_FILES = [
  "src/pages/home.tsx",
  ...pageExtracts("home"),
  "src/pages/category.tsx",
  "src/pages/product.tsx",
  ...PRODUCT_COMPONENTS,
  "src/pages/orders.tsx",
  "src/pages/order-detail.tsx",
  "src/pages/cart.tsx",
  "src/pages/terms.tsx",
  "src/pages/status.tsx",
  "src/pages/wallet.tsx",
  ...pageExtracts("wallet"),
];

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
  // R136 (parent pre-patch): reads the wallet SURFACE (page ∪
  // components/wallet extracts) — the pins follow the markup.
  const wallet = pageSurface("wallet");

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
  // R136 (parent pre-patch): the home/wallet entries read their page
  // SURFACES (page ∪ extracts) — absence pins over the union are
  // strictly stronger, so the craft floor keeps holding wherever the
  // markup lives after the decomposition.
  const sourceFor = (file: string): string =>
    file === "src/pages/home.tsx"
      ? pageSurface("home")
      : file === "src/pages/wallet.tsx"
        ? pageSurface("wallet")
        : read(file);

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
      const hits = liveLines(sourceFor(file), pattern);
      expect(hits, `${file}: ${label} → ${hits.join(" | ")}`).toHaveLength(0);
    }
  });

  it("no rounded-3xl card shell remains on home (24px radius is over the 12–16px band)", () => {
    const hits = liveLines(pageSurface("home"), /rounded-3xl/);
    expect(hits, hits.join(" | ")).toHaveLength(0);
  });

  it("the TrustCard 3-up template is gone from home (one inline strip closes the page)", () => {
    const home = stripComments(pageSurface("home"));
    expect(home).not.toMatch(/import \{ TrustCard \}/);
    // The inline strip carries the same three honest claims.
    expect(home).toContain("تسليم فوري بعد الدفع");
    expect(home).toContain("دفع آمن");
    expect(home).toContain("دعم محلي");
  });
});
