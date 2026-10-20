/**
 * R-140-a — the IMAGE DISCIPLINE regression pin suite (CWV lane:
 * CLS-zero + LCP priority).
 *
 * The image-loading contracts currently live only as attributes and
 * rationale comments in source; this suite turns them into enforced
 * contracts so a future round cannot silently regress the CWV layer:
 *
 *   (a) CLS-zero proof — every <img> carries intrinsic width/height
 *       attrs (1024×1024 = the MEASURED intrinsic of every live
 *       /products/*.webp — all 45 files re-probed with PIL at R174,
 *       when the art was regenerated at 1024×1024; the L4-F9
 *       honest-intrinsic rule holds) OR a fully constrained
 *       CSS box (fixed w-N h-N / aspect-[…] on the tag or its
 *       pinned container string). No auto-sized image box exists.
 *   (b) loading strategy — below-fold content imgs ride
 *       loading="lazy" + decoding="async"; the PDP main image
 *       (ProductMediaSection — the product page's LCP element, per
 *       the R127-B4 live trace) stays EAGER with fetchPriority="high";
 *       three more eager-by-design sites (both QR tiles + the admin
 *       image-URL preview) are REGISTERED exceptions documented
 *       in-source with the «R-140-a … EAGER-LCP» marker.
 *   (c) alt quality — descriptive, never empty on content images
 *       (the `?? ""` / alt="" shapes are retired and guarded), never
 *       redundant (name-in-alt follows the thumb-family idiom the
 *       cart/orders/GlobalSearch thumbs already rode).
 *   (d) srcset reality — the catalog ships exactly ONE rendition per
 *       asset (1024×1024 webp, no @2x/variants in public/products/),
 *       so NO srcset/sizes is invented anywhere; the flagship grid
 *       site documents the measurement in-source.
 *
 * METHOD — SOURCE-scan pins (the money-path-chrome-r139 idiom):
 * readFileSync + string/regex assertions on the shipped source, one
 * describe block per owned surface. No render surface here: the CWV
 * contracts are attribute-level, and the RENDER contracts (fallback
 * tiles, well-swap handlers) are already pinned by the decomposition
 * suites (r135/r136/r137) + admin-whatsapp-decomposition-r137 (the
 * QR alt pin at :202).
 *
 * Comment discipline — ATTRIBUTE pins run on stripComments() output
 * so rationale prose can never mask a regression (a comment saying
 * loading="lazy" is not a loading attr); the EAGER-EXCEPTION pins
 * run on the RAW source instead, because the exception IS the
 * documentation — an eager img without its in-source «R-140-a …
 * EAGER-LCP» marker fails the audit. None of the scanned files
 * carries "//" inside a string literal (the r139 verification
 * idiom), so the line stripper is string-safe; the block stripper
 * runs second for the same reason (see stripComments' docblock).
 *
 * The 14 owned files (the r140-a lane — flash-sales.tsx belongs to
 * agent 140-e and is deliberately absent):
 *   storefront: components/ProductCard.tsx ·
 *     components/product/ProductMediaSection.tsx ·
 *     components/product/RecommendationsSection.tsx ·
 *     components/checkout/CartSummaryAside.tsx · pages/cart.tsx ·
 *     components/orders/OrderRow.tsx (the row moved there from
 *     pages/orders.tsx in R167 F11 wave 2 — the pin follows the
 *     markup) · pages/order-detail.tsx ·
 *     components/home/RecentOrdersStrip.tsx
 *   admin: pages/admin/settings/two-factor-setup.tsx ·
 *     components/admin/layout/GlobalSearch.tsx ·
 *     components/admin/forecast/StockoutRiskPanel.tsx ·
 *     components/admin/whatsapp/WhatsappSessionsList.tsx ·
 *     components/admin/products/ProductEditorCard.tsx ·
 *     components/admin/products/ProductCard.tsx
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * Remove JS/JSX comments so pins read CODE, not prose. LINE comments
 * first, THEN block comments — the r139 line-comments-first craft,
 * load-bearing here: rationale lines like «all 45 /products/*.webp
 * are 450×450» contain the glob `/*.webp`, which a block-first
 * stripper misreads as the opening of a block comment and swallows
 * everything down to the next real block-comment close — including
 * the very attributes this suite pins. Stripping `//` lines first
 * removes the glob-bearing line whole; the `//` stripper only fires
 * at line start or after whitespace, so protocol strings
 * (`placeholder="https://…"`, always preceded by ":") are untouched.
 */
function stripComments(src: string): string {
  return src.replace(/(^|\s)\/\/[^\n]*/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Opening tags of every <img …> in a file. Inline arrow props
 * (`onError={(e) => …}`, the alt-builder IIFE) would end a naive
 * [^>]* scan at the arrow's ">" — neutralizing `=>` first keeps each
 * match inside one tag (the r139 buttonTags idiom).
 */
function imgTags(code: string): string[] {
  return code.replace(/=>/g, "==").match(/<img\b[^>]*>/g) ?? [];
}

/** The in-source eager-exception marker: a registered eager img must
 *  sit beside an «R-140-a … EAGER-LCP» rationale comment (bounded
 *  lazy window — the marker phrase may wrap a few lines down). */
const EAGER_MARKER = /R-140-a[\s\S]{0,600}?EAGER-LCP/;

/** The catalog art's measured intrinsic — every /products/*.webp
 *  (45 files, PIL-probed at R174: the 1024×1024 regeneration). */
const INTRINSIC = ["width={1024}", "height={1024}"];

interface Site {
  /** Source path relative to frontend/ (the r139 read() idiom). */
  file: string;
  /** Eager-by-design: the img deliberately carries NO loading attr;
   *  the RAW source must document why (EAGER_MARKER beside it). */
  eager?: boolean;
  /** CLS proof rides on the CONTAINER (no width/height attrs, no
   *  fixed box on the tag itself) — this exact container string must
   *  exist in the comment-stripped code. */
  containerPin?: string;
}

/** The 14-site registry. Sites without eager/containerPin must pass
 *  the generic rules outright: lazy (or the storefront ladder) +
 *  decoding="async" + width/height attrs + non-empty alt. */
const SITES: Site[] = [
  // ── storefront ──
  { file: "src/components/ProductCard.tsx" },
  { file: "src/components/product/ProductMediaSection.tsx", eager: true },
  { file: "src/components/product/RecommendationsSection.tsx" },
  { file: "src/components/checkout/CartSummaryAside.tsx" },
  { file: "src/pages/cart.tsx" },
  // R167 (F11 wave 2): the orders-list row (its product thumb is the
  // page's only <img>) moved verbatim to components/orders/OrderRow.
  { file: "src/components/orders/OrderRow.tsx" },
  { file: "src/pages/order-detail.tsx" },
  { file: "src/components/home/RecentOrdersStrip.tsx" },
  // ── admin ──
  { file: "src/pages/admin/settings/two-factor-setup.tsx", eager: true },
  { file: "src/components/admin/layout/GlobalSearch.tsx" },
  { file: "src/components/admin/forecast/StockoutRiskPanel.tsx" },
  { file: "src/components/admin/whatsapp/WhatsappSessionsList.tsx", eager: true },
  {
    file: "src/components/admin/products/ProductEditorCard.tsx",
    eager: true,
    // Arbitrary admin-typed URL: no knowable intrinsic → no honest
    // width/height attrs; the fixed w-16 h-16 well owns the CLS proof.
    containerPin:
      "relative w-16 h-16 shrink-0 rounded-xl border border-border/40 bg-muted/60 overflow-hidden",
  },
  { file: "src/components/admin/products/ProductCard.tsx" },
];

/** The 9 catalog-art thumb/grid sites that carry the measured
 *  1024×1024 intrinsic attrs (the thumb family: cart/orders/search/
 *  forecast/admin twins + the recommendations rail). */
const THUMB_FILES = SITES.filter(
  (s) => !s.eager && s.file !== "src/components/ProductCard.tsx",
).map((s) => s.file);

describe("R-140-a — the 14-site audit: every <img> carries the image discipline", () => {
  for (const site of SITES) {
    it(`${site.file}: loading strategy + CLS-zero proof + alt (per <img> tag)`, () => {
      const raw = read(site.file);
      const code = stripComments(raw);
      const tags = imgTags(code);
      // The pin only means something while the file still renders an
      // img — a deleted img fails loudly instead of vacuously passing.
      expect(tags.length).toBeGreaterThanOrEqual(1);

      for (const tag of tags) {
        // ── (b) loading strategy ─────────────────────────────────
        // lazy as a static attr, or the storefront grid's documented
        // above-fold ladder ternary (first 4 eager, rest lazy).
        const hasLazy = tag.includes('loading="lazy"') || /loading=\{[^}]*"lazy"/.test(tag);
        if (!hasLazy) {
          // The ONLY sanctioned escape: a REGISTERED eager site…
          expect(site.eager, "an img without lazy must be a registered eager site").toBe(true);
          // …that carries NO loading attr at all (never a hardcoded
          // loading="eager" — the exception is omission + priority)…
          expect(tag, "eager sites carry no loading attr at all").not.toMatch(/loading=/);
          // …and whose RAW source documents the exception beside the
          // tag (the marker comment IS part of the contract).
          expect(raw, "the eager exception must be documented in-source").toMatch(EAGER_MARKER);
        }
        // decoding off the interaction path — EVERY site, lazy or eager.
        expect(tag, "every img decodes async").toContain('decoding="async"');

        // ── (a) CLS-zero proof ───────────────────────────────────
        const hasDims = tag.includes(INTRINSIC[0]) && tag.includes(INTRINSIC[1]);
        const cn = tag.match(/className="([^"]*)"/)?.[1] ?? "";
        const fixedBox = /\bw-\d+\b/.test(cn) && /\bh-\d+\b/.test(cn);
        const ratioBox = /aspect-\[/.test(cn);
        if (!hasDims && !fixedBox && !ratioBox) {
          // Last sanctioned proof: the box is pinned by the container
          // (registered + string-pinned so layout drift breaks here).
          expect(site.containerPin, "an unconstrained img needs a pinned container").toBeDefined();
          expect(code).toContain(site.containerPin!);
        }

        // ── (c) alt quality ──────────────────────────────────────
        expect(tag, "content images are never unlabeled").toMatch(/alt=/);
        expect(tag, "never the empty-alt cop-out").not.toMatch(/alt=""/);
        // `[^{}]*` keeps the alt-builder IIFE's (name ?? "").trim()
        // normalization out of the guard: the retired shape was a
        // FLAT `alt={expr ?? ""}` attr, and those never nest braces.
        expect(tag, "never the flat empty-alt cop-out").not.toMatch(/alt=\{[^{}]*\?\?\s*""/);
      }
    });
  }

  it("the retired empty-alt shapes are gone from ALL 14 files (comment-stripped — prose can't mask them)", () => {
    // R-140-a: the two pre-round shapes that could render an EMPTY
    // alt on a content image — order-detail's `?? ""` and
    // GlobalSearch's `?? ""` — plus StockoutRiskPanel's bare alt=""
    // and ProductEditorCard's generic «معاينة». File-wide guards so a
    // NEW img can't reintroduce the shape anywhere in the lane.
    for (const site of SITES) {
      const code = stripComments(read(site.file));
      expect(code, site.file).not.toMatch(/\balt=""/);
      expect(code, site.file).not.toMatch(/alt=\{[^{}]*\?\?\s*""/);
    }
  });

  it("no srcset/sizes is invented anywhere — the catalog ships ONE rendition (1024×1024, 45 files, measured)", () => {
    // R-140-a (d): /public/products/*.webp has no @2x/variant files,
    // so a srcSet would fabricate URLs that 404. The measurement is
    // documented at the flagship grid site (pinned below); the guard
    // is lane-wide.
    for (const site of SITES) {
      const code = stripComments(read(site.file));
      expect(code, site.file).not.toMatch(/\bsrcSet\b|\bsrcset\b/);
      expect(code, site.file).not.toMatch(/\bsizes=/);
    }
  });
});

describe("R-140-a — storefront grid (ProductCard): the above-fold LCP ladder + the srcset measurement", () => {
  const PC_CODE = stripComments(read("src/components/ProductCard.tsx"));
  const PC_RAW = read("src/components/ProductCard.tsx");

  it("the documented ladder ships verbatim: first 4 eager, rest lazy; first 2 fetchpriority=high", () => {
    // R132's measured ladder (L4-F9 + the R127-B4 live LCP trace that
    // caught the mobile LCP element at index 1) — frozen so a "make
    // them all lazy" sweep can't trade LCP for bytes, and a "make
    // them all eager" sweep can't trade bytes for nothing.
    expect(PC_CODE).toContain('loading={index < 4 ? "eager" : "lazy"}');
    expect(PC_CODE).toContain('fetchPriority={index < 2 ? "high" : index < 4 ? "auto" : "low"}');
    // The box discipline on the grid flagship: intrinsic attrs match
    // the catalog reality, the aspect-square well pins the layout.
    expect(PC_CODE).toContain("width={1024}");
    expect(PC_CODE).toContain("height={1024}");
    expect(PC_CODE).toContain("relative aspect-square bg-muted/60 overflow-hidden");
  });

  it("alt is DESCRIPTIVE — name + category context with a graceful fallback (never just the name-less glyph)", () => {
    // The alt-builder contract: «<name> — اشتراك <category>», the
    // hasSub de-duplication, and the category-only / generic
    // fallbacks when the name is missing. The same builder ships on
    // the PDP main image (the twin pin below).
    expect(PC_CODE).toContain("const cat = categoryLabel(product.category);");
    expect(PC_CODE).toContain('if (!name) return cat ? `اشتراك ${cat}` : "اشتراك رقمي";');
    expect(PC_CODE).toContain("const hasSub = /اشتراك/.test(name);");
    expect(PC_CODE).toContain('${name} — ${hasSub ? "" : "اشتراك "}${cat}`.trim()');
  });

  it("the srcset decision is MEASURED, not guessed — the in-source document pins the census", () => {
    // R-140-a (d): one rendition per asset (45 × 450×450 webp,
    // re-probed this round) → no srcset. The comment is the
    // contract's paper trail: deleting it (or shipping a srcset)
    // breaks this pin and forces a conscious re-measure.
    expect(PC_RAW).toMatch(/R-140-a[\s\S]{0,400}?NO srcset\/sizes by/);
    // …and the re-measure clause (the wrapped comment's one-line core).
    expect(PC_RAW).toContain("only when a second size actually exists");
  });
});

describe("R-140-a — PDP main image (ProductMediaSection): THE LCP element stays eager + high-priority", () => {
  const PMS_CODE = stripComments(read("src/components/product/ProductMediaSection.tsx"));
  const PMS_RAW = read("src/components/product/ProductMediaSection.tsx");

  it('fetchPriority="high" + NO loading attr + decoding async — the eager-LCP exception, documented', () => {
    // The product page's LCP element (R127-B4 trace): lazy here is a
    // known ~400-800ms mobile LCP regression. The exception must stay
    // REGISTERED — the raw marker comment is asserted by the audit,
    // and the attribute trio is pinned here.
    expect(PMS_CODE).toContain('fetchPriority="high"');
    expect(imgTags(PMS_CODE)[0], "the LCP img must never go lazy").not.toMatch(/loading=/);
    expect(PMS_CODE).toContain('decoding="async"');
    expect(PMS_RAW).toMatch(EAGER_MARKER);
  });

  it("CLS-zero on the biggest image on the page: 1024×1024 intrinsic attrs + the fixed aspect-[16/9] media plane", () => {
    // Honest intrinsic dims (the R132 L4-F9 rule — the old {800} lied
    // to the scanner; R174 regenerated the art at 1024×1024) + the 16:9
    // well that owns the layout box.
    expect(PMS_CODE).toContain("width={1024}");
    expect(PMS_CODE).toContain("height={1024}");
    expect(PMS_CODE).toContain("aspect-[16/9] bg-muted/60 bg-gradient-to-b");
  });

  it("alt matches the grid flagship's descriptive builder (name + category, dir-safe fallbacks)", () => {
    expect(PMS_CODE).toContain("const cat = categoryLabel(product.category);");
    expect(PMS_CODE).toContain('if (!name) return cat ? `اشتراك ${cat}` : "اشتراك رقمي";');
    expect(PMS_CODE).toContain('${name} — ${hasSub ? "" : "اشتراك "}${cat}`.trim()');
  });
});

describe("R-140-a — below-fold catalog thumbs: lazy + async + the measured 1024×1024 intrinsic", () => {
  // The 9 thumb sites (checkout summary · cart lines · orders list ·
  // order detail · home strip · admin search palette · stockout risk
  // rows · admin catalog cards · the PDP recommendations rail). Every
  // fixed-well thumb also gains the honest intrinsic attrs — belt and
  // suspenders: the well pins the box NOW, the attrs keep the
  // aspect-ratio reserve truthful even before Tailwind lands.
  for (const file of THUMB_FILES) {
    it(`${file}: loading="lazy" + decoding="async" + width/height={1024}`, () => {
      const code = stripComments(read(file));
      expect(code).toContain('loading="lazy"');
      expect(code).toContain('decoding="async"');
      expect(code).toContain("width={1024}");
      expect(code).toContain("height={1024}");
      // The lazy + eager split must never coexist on one thumb file.
      expect(code).not.toContain('loading="eager"');
    });
  }
});

describe("R-140-a — alt discipline: the fixed expressions, pinned verbatim", () => {
  it('order-detail: the `?? ""` empty-alt floor is now a descriptive fallback', () => {
    expect(stripComments(read("src/pages/order-detail.tsx"))).toContain(
      'alt={order.product_name || "صورة المنتج"}',
    );
  });

  it("GlobalSearch: same fix — the search-palette thumb can never render an empty alt", () => {
    expect(stripComments(read("src/components/admin/layout/GlobalSearch.tsx"))).toContain(
      'alt={p.name || "صورة منتج"}',
    );
  });

  it('StockoutRiskPanel: the bare alt="" is retired — the thumb rides the name-in-alt family idiom', () => {
    // The cart/orders/GlobalSearch thumbs already ship name-in-alt;
    // the risk row joins them (content image, never decorative-empty).
    expect(stripComments(read("src/components/admin/forecast/StockoutRiskPanel.tsx"))).toContain(
      "alt={row.product_name}",
    );
  });

  it("RecommendationsSection: name with a never-blank fallback (the DTO carries no category to add)", () => {
    expect(stripComments(read("src/components/product/RecommendationsSection.tsx"))).toContain(
      'alt={r.name || "منتج مقترح"}',
    );
  });

  it("ProductEditorCard: the generic «معاينة» alt is now descriptive of what is previewed", () => {
    expect(stripComments(read("src/components/admin/products/ProductEditorCard.tsx"))).toContain(
      'alt="معاينة صورة المنتج"',
    );
  });
});

describe("R-140-a — the four eager exceptions: registered, documented, decode-async, box-pinned", () => {
  const EAGER_SITES = SITES.filter((s) => s.eager);

  it("exactly FOUR registered eager sites — a fifth must consciously extend this registry", () => {
    // The escape hatch stays narrow on purpose: the PDP LCP element,
    // both actionable QR tiles (data: URLs — nothing to defer), and
    // the admin image-URL preview (the load event drives the
    // valid/invalid well-swap the admin is explicitly waiting on).
    expect(EAGER_SITES.map((s) => s.file)).toEqual([
      "src/components/product/ProductMediaSection.tsx",
      "src/pages/admin/settings/two-factor-setup.tsx",
      "src/components/admin/whatsapp/WhatsappSessionsList.tsx",
      "src/components/admin/products/ProductEditorCard.tsx",
    ]);
  });

  it("both QR tiles: data-URL art, fixed square boxes, decoding async (the eager rationale in-source)", () => {
    // 2FA setup QR — the w-32 h-32 tile; no width/height attrs: the
    // qrcode lib's data-URL intrinsic varies with the secret payload.
    const TF_CODE = stripComments(read("src/pages/admin/settings/two-factor-setup.tsx"));
    expect(TF_CODE).toContain('className="w-32 h-32"');
    expect(TF_CODE).toContain('decoding="async"');
    expect(TF_CODE).toContain('alt="رمز الاستجابة السريعة للتحقق بخطوتين"');
    // WhatsApp pairing QR — the w-64 h-64 stage; backend data URL.
    const WA_CODE = stripComments(read("src/components/admin/whatsapp/WhatsappSessionsList.tsx"));
    expect(WA_CODE).toContain('className="w-64 h-64"');
    expect(WA_CODE).toContain('decoding="async"');
    expect(WA_CODE).toContain("alt={`رمز QR لجلسة ${session.name}`}");
  });

  it("the admin image-URL preview: CLS proof on the fixed w-16 h-16 well (no knowable intrinsic → no attrs)", () => {
    // An arbitrary admin-typed URL has no measured intrinsic, so
    // width/height attrs would be fiction; the pinned container
    // string + max-w/max-h containment own the zero-CLS proof.
    const code = stripComments(read("src/components/admin/products/ProductEditorCard.tsx"));
    expect(code).toContain(
      "relative w-16 h-16 shrink-0 rounded-xl border border-border/40 bg-muted/60 overflow-hidden",
    );
    expect(code).toContain('decoding="async"');
  });
});
