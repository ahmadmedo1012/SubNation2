/**
 * R139 (precision) — the money-path CHROME regression pin suite.
 *
 * The r138 visual recipes currently live only as class strings in source
 * (plus the rationale comments beside them); this suite turns them into
 * enforced contracts so future rounds cannot silently regress the trust
 * surface — the chrome a buyer reads while deciding to pay:
 *
 *   1. receipt rhythm        — components/checkout/CartSummaryAside.tsx
 *      (hairline /20 rules at section boundaries ONLY, the terminal
 *      double-rule above «الإجمالي», emphasis by weight+size — never
 *      color, line amounts tabular-nums)
 *   2. canonical money CTAs  — pages/cart.tsx + checkout/CheckoutCta.tsx
 *      + product/CtaBlock.tsx (R116-S1: size="lg" owns the chrome; no
 *      hand-rolled h-12 + shadow-lg + bg-primary stacks)
 *   3. cart line hierarchy   — pages/cart.tsx (title 600 / price 700 —
 *      the inversion fix; unit price ink, not brand tint)
 *   4. PDP selected pills    — product/VariantSelector.tsx (the tinted
 *      dialect bg-primary/15 + border-primary/30 + text-primary-text; no
 *      shadow on selection states, no solid fill)
 *   5. sticky buy bar        — pages/product.tsx (solid bg-card, no
 *      glass, border-t /35 + .hairline-glow first child, the mirrored
 *      two-layer elevation, z-[45])
 *   6. quiet danger at rest  — pages/cart.tsx (clear trigger rests
 *      text-muted-foreground; severity lives in the confirm dialog)
 *
 * METHOD — SOURCE-scan pins (the checkout-decomposition-r136 /
 * product-card-r120 idiom): readFileSync + string/regex assertions on the
 * shipped source. No render surface here (no query mocking): the RENDER
 * contracts already exist — product-cta-mobile-r126 (pills + sticky bar),
 * cart-undo-clear (undo/confirm/44px floor), checkout-decomposition-r136
 * (structure). This file pins the CHROME those renders wear.
 *
 * Comment discipline — every pin runs on stripComments() output. The r138
 * rationale blocks legitimately NAME the retired strings ("shadow-md→
 * hover:shadow-lg", "the hand-rolled bg-primary/70 fill is gone") so a raw
 * absence check would false-fail on the documentation of the retirement,
 * and a raw PRESENCE check (size="lg") could false-pass on prose. None of
 * the six scanned files carries "//" inside a string literal (verified),
 * so both comment kinds strip safely.
 *
 * Boundary-sensitive pins use precise scoping (the r126 pill idiom):
 * h-12 is asserted absent from PRIMARY money CTAs but sanctioned on
 * variant="outline" row buttons; shadow-md is absent from the selector
 * ENTIRELY while remaining a sanctioned family value elsewhere in the app.
 *
 * The suite pins WHAT SHIPPED at r138 head (8455a7c). Two deliberate
 * non-goals, recorded for the orchestrator (NOT regressions of the r138
 * record — the record scoped itself to the surfaces below):
 *   — cart's EMPTY-state browse CTA («متابعة التسوق», cart.tsx) still
 *     rides the pre-r138 hero chrome (min-h-11 + bg-primary +
 *     shadow-lg shadow-primary/20 + active:scale). r138's in-source claim
 *     names exactly "the three money CTAs below (blocked / authed /
 *     guest)"; the empty-state hero is wave-3 long tail.
 *   — CtaBlock's desktop wallet-recovery outline twin («شحن المحفظة»)
 *     keeps `h-12 text-base` row geometry: variant="outline" secondary
 *     path, documented as kept geometry, not a primary-CTA hand-roll.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * Remove JS/JSX comments so pins read CODE, not prose. `/* … *\/` blocks
 * (JSX rationale comments) and `//` line comments both go; the `//`
 * stripper only fires at line start or after whitespace, so protocol
 * strings (`https://…`, always preceded by ":") and single-slash utility
 * names (border-border/20, bg-primary/15) are untouched.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/gm, "$1");
}

/**
 * Opening tags of every <Button …> in a component. Inline arrow props
 * (`onClick={() => navigate(…)}`) would end a naive [^>]* scan at the
 * arrow's ">" — neutralizing `=>` first keeps each match inside one tag.
 */
function buttonTags(code: string): string[] {
  return code.replace(/=>/g, "==").match(/<Button\b[^>]*>/g) ?? [];
}

const countMatches = (src: string, re: RegExp): number => (src.match(re) ?? []).length;

/** `h-12` as a standalone class token — `min-h-12` (the 2-line growth
 *  guard) must NOT match: the char before h-12 is "-", not space/quote. */
const H_12_TOKEN = /(^|[\s"'])h-12(?=[\s"'])/;

/** `bg-primary` as a SOLID fill token — `bg-primary/15` (the tinted
 *  dialect) must NOT match: the lookahead rejects the "/" continuation. */
const SOLID_BG_PRIMARY = /(^|[\s"'])bg-primary(?![\w/])/;

/** A bare (non-hover-prefixed) `text-status-error` token — at-rest error
 *  ink. `hover:text-status-error` doesn't match: its "text-status-error"
 *  is preceded by ":", not a token boundary. */
const REST_ERROR_INK = /(^|[\s"'])text-status-error(?=[\s"'])/;

const CART_CODE = stripComments(read("src/pages/cart.tsx"));
const SUMMARY_CODE = stripComments(read("src/components/checkout/CartSummaryAside.tsx"));
const CHECKOUT_CTA_CODE = stripComments(read("src/components/checkout/CheckoutCta.tsx"));
const CTA_BLOCK_CODE = stripComments(read("src/components/product/CtaBlock.tsx"));
const VS_CODE = stripComments(read("src/components/product/VariantSelector.tsx"));
const PRODUCT_CODE = stripComments(read("src/pages/product.tsx"));

/** The cart's money-summary window (comment-stripped): the receipt-slip
 *  card through the confirm dialog — the surface the three money CTAs +
 *  the ghost browse twin render on. */
const CART_SUMMARY_WINDOW = (() => {
  const start = CART_CODE.indexOf("rounded-2xl p-5 slide-up");
  return start >= 0 ? CART_CODE.slice(start, CART_CODE.indexOf("<ConfirmDialog", start)) : "";
})();

describe("R138 recipe — CartSummaryAside receipt rhythm (hairlines + weight, the paper slip)", () => {
  it("hairline rules sit at section boundaries ONLY — exactly two border-t border-border/20 rules (items|sums, sums|terminal)", () => {
    // R139 (precision): freezes the r138 receipt-metaphor decision — the
    // slip is ruled at SECTION boundaries only, as hairlines (/20 — the
    // ProductCard internal-divider value; /50 read as a hard edge, not
    // paper). A third rule anywhere on the slip breaks the count; a /50
    // or full-strength border breaks the exact strings.
    expect(SUMMARY_CODE).toContain("border-t border-border/20 pt-3 space-y-1 mb-4");
    expect(SUMMARY_CODE).toContain(
      '<div className="flex items-center justify-between text-base font-bold border-t border-border/20 pt-2">',
    );
    expect(countMatches(SUMMARY_CODE, /border-t border-border\/20/g)).toBe(2);
    // …and NO other top rule of any strength exists on the slip (the
    // count guard covers border-t-2 / border-t border-border style
    // comebacks too — "border-transparent" is excluded by the lookahead).
    expect(countMatches(SUMMARY_CODE, /border-t(?![a-z])/g)).toBe(2);
  });

  it("the items list carries NO rules between rows — the thumbnails structure the rows (6px rhythm, max-h-72 scroll)", () => {
    // R139 (precision): freezes "rules at section boundaries ONLY, never
    // between rows". A per-row border-t (the pre-r138 divider habit)
    // re-introduces the striped-list read the receipt metaphor replaced.
    // The ul string also freezes the r138 rhythm tighten (rows 8→6px,
    // pre-rule gap 16→12px).
    expect(SUMMARY_CODE).toContain('<ul className="space-y-1.5 mb-3 max-h-72 overflow-y-auto">');
    const items = SUMMARY_CODE.match(/<ul[^>]*>[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(items).not.toContain("border-t");
  });

  it("the terminal row owns its rule DIRECTLY above «الإجمالي» — the receipt's double-rule close", () => {
    // R139 (precision): the terminal row itself (not a wrapper) carries
    // the second hairline — the classic receipt emphasis where the total
    // sits behind the section rule plus its own rule. Moving the rule to
    // a wrapper (softening the double-rule close) or deleting it breaks
    // the exact row string pinned here.
    expect(SUMMARY_CODE).toContain(
      '<div className="flex items-center justify-between text-base font-bold border-t border-border/20 pt-2">',
    );
  });

  it("emphasis rides weight+size, NEVER color — the terminal amount span carries no color class (text-primary-text deliberately removed)", () => {
    // R139 (precision): freezes the r138 "weight+size, not color" decision
    // on the slip's terminal. The amount span is bare `tabular-nums` —
    // re-adding text-primary-text (the retired brand tint on the money
    // total) or any status/foreground color token fails the exact-string
    // pin; the scoped negatives keep ANY ink decision out of the row.
    const terminalRow = SUMMARY_CODE.match(
      /<div className="flex items-center justify-between text-base font-bold border-t border-border\/20 pt-2">[\s\S]*?<\/div>/,
    )?.[0];
    expect(terminalRow).toBeDefined();
    expect(terminalRow).toContain(
      '<span className="tabular-nums">{formatCurrency(comparisonTotal)}</span>',
    );
    expect(terminalRow).not.toContain("text-primary");
    expect(terminalRow).not.toContain("text-status-");
    expect(terminalRow).not.toContain("text-foreground");
  });

  it("the weight ladder: line amounts 700+tabular-nums · sums 600 · terminal 700+text-base (money data leads, derived sums sit one step down)", () => {
    // R139 (precision): freezes the r138 ladder — 98-F2 coupon math made
    // the sums DERIVED data and the slip says so typographically: line
    // totals ride 700, sums 600, the terminal re-steps to 700 + the only
    // text-base money on the slip. A sum promoted to 700 or a line
    // demoted to 600 flattens the receipt's read.
    expect(SUMMARY_CODE).toContain('<div className="font-bold tabular-nums text-sm shrink-0">');
    expect(SUMMARY_CODE).toContain(
      '<span className="font-semibold tabular-nums">{formatCurrency(totalLYD)}</span>',
    );
    // The coupon discount keeps its semantic status ink (the
    // discount-reads-positive register) — the ONE color on the slip, and
    // it is status, not emphasis. Pinned so it can't be misread as drift
    // by a future sweep.
    expect(SUMMARY_CODE).toContain(
      '<span className="font-semibold tabular-nums text-status-success">',
    );
  });

  it("the receipt slip rests on the family elevation — border/60 + the two-layer calm shadow (paper lying on the page)", () => {
    // R139 (precision): the r138-B resting recipe on the money summary —
    // the aside reads as a paper slip lying on the page (tight 1px/2px
    // contact line + contained 10px/28px ambient). A shadow-sm comeback
    // or a primary-tinted shadow breaks the exact string; border/60 is
    // the family edge the money path's three cards share.
    expect(SUMMARY_CODE).toContain(
      "bg-card border border-border/60 rounded-2xl p-5 reveal-up shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]",
    );
  });
});

describe('R138 recipe — canonical money CTAs (R116-S1): size="lg" owns the chrome, pages do not hand-roll', () => {
  it('cart.tsx: the three summary money CTAs (blocked / authed / guest) all ride size="lg"', () => {
    // R139 (precision): freezes the r138 retirement of the flat bg-primary
    // + shadow-lg + active:scale hand-rolls on the cart's money CTAs.
    // size="lg" + the default Button variant own every visual token (h-12,
    // text-base, the to-primary/95 gradient + primary border +
    // shadow-md→hover:shadow-lg, press-spring — ui/button.tsx's R116-S1
    // recipe). Each CTA is pinned through its distinctive wiring so a
    // fourth size="lg"-less Button can't slip into the family.
    expect(CART_SUMMARY_WINDOW.length).toBeGreaterThan(0);
    // blocked (stock-gated): disabled + aria-describedby + lg:
    expect(CART_SUMMARY_WINDOW).toMatch(
      /<Button\b[^>]*disabled[^>]*aria-describedby="cart-stock-block-reason"[^>]*size="lg"[^>]*>/,
    );
    // authed: asChild lg into /checkout:
    expect(CART_SUMMARY_WINDOW).toMatch(
      /<Button asChild size="lg" className="w-full">\s*<Link href="\/checkout">/,
    );
    // guest: asChild lg into the login redirect:
    expect(CART_SUMMARY_WINDOW).toMatch(
      /<Button asChild size="lg" className="w-full">\s*<Link href="\/login\?redirect=\/checkout">/,
    );
    // …exactly the three — the ghost «متابعة التسوق» twin is a browse CTA
    // (variant="ghost"), not part of the money family.
    expect(countMatches(CART_SUMMARY_WINDOW, /<Button\b[^>]*size="lg"/g)).toBe(3);
  });

  it("cart.tsx: the money surfaces carry no hand-rolled CTA chrome — and fixed h-12 geometry is gone from the page's code entirely", () => {
    // R139 (precision): the retired vocabulary, scoped where it lived.
    // The summary window keeps shadow/fill/scale overrides off the money
    // card; file-wide, the whole cart page retired fixed h-12 CTA
    // geometry (only rationale prose mentions it now, and prose is
    // stripped). The exact retired login-CTA stack (/25 — not the /20 the
    // empty-state hero carries) is absent from the page's code.
    expect(CART_SUMMARY_WINDOW).not.toContain("shadow-lg");
    expect(CART_SUMMARY_WINDOW).not.toContain("shadow-md");
    expect(CART_SUMMARY_WINDOW).not.toContain("bg-primary");
    expect(CART_SUMMARY_WINDOW).not.toContain("active:scale");
    expect(CART_SUMMARY_WINDOW).not.toMatch(H_12_TOKEN);
    expect(CART_CODE).not.toMatch(H_12_TOKEN);
    expect(CART_CODE).not.toContain("shadow-lg shadow-primary/25");
    // R139 audit note (deliberately NOT pinned): the EMPTY-state browse
    // CTA still rides the pre-r138 hero chrome (bg-primary + shadow-lg
    // shadow-primary/20). The r138 record scoped its retirement to the
    // three money CTAs above — see the file docblock; flagged for the
    // orchestrator's long-tail lane, not this suite's contract.
  });

  it('CheckoutCta: size="lg" + the documented functional guards ONLY — the wrap pins stay, the chrome overrides stay gone', () => {
    // R139 (precision): freezes the r138 visual-audit verification of the
    // checkout CONFIRM CTA — the charge button. size="lg" owns every
    // visual token; the className carries only the 96-F4 wrap guards
    // (whitespace-normal + text-balance + min-h-12 letting the 2-line
    // coupon-state label grow) + the w-full summary-column layout.
    expect(CHECKOUT_CTA_CODE).toMatch(/<Button\b[^>]*size="lg"/);
    expect(CHECKOUT_CTA_CODE).toContain(
      'className="w-full min-h-12 whitespace-normal text-balance leading-snug"',
    );
    // min-h-12 is the documented growth guard — the FIXED h-12 geometry
    // (which clipped the wrapped label) must not return.
    expect(CHECKOUT_CTA_CODE).not.toMatch(H_12_TOKEN);
    // No chrome override on top of the recipe (the button.tsx default
    // variant owns the gradient/shadow family):
    expect(CHECKOUT_CTA_CODE).not.toContain("shadow-lg");
    expect(CHECKOUT_CTA_CODE).not.toContain("shadow-md");
    expect(CHECKOUT_CTA_CODE).not.toContain("bg-primary");
    expect(CHECKOUT_CTA_CODE).not.toContain("hover:bg-primary/90");
  });

  it('CtaBlock: every PRIMARY money CTA rides size="lg" — exactly the four-branch ladder (sold-out / login / verifying / buy)', () => {
    // R139 (precision): freezes the r138 canonical-recipe retirement on
    // the PDP. The four default-variant CTAs (the branch ladder's primary
    // surfaces — availability, auth, balance-load, buy) must all carry
    // size="lg"; a fifth primary CTA without the recipe fails the count
    // and forces a conscious pin update instead of a silent drift.
    const tags = buttonTags(CTA_BLOCK_CODE);
    const primaries = tags.filter(
      (t) => !t.includes('variant="outline"') && !t.includes('variant="ghost"'),
    );
    expect(primaries).toHaveLength(4);
    for (const tag of primaries) {
      expect(tag, tag).toContain('size="lg"');
    }
  });

  it('CtaBlock: h-12 geometry survives ONLY on variant="outline" row buttons — never on a primary money CTA', () => {
    // R139 (precision): the boundary-sensitive pin. r138 removed
    // page-level h-12 from PRIMARY CTAs (size="lg" owns the 48px) while
    // the compact sticky-bar twins keep DOCUMENTED row geometry — h-12 on
    // outline recovery/icon buttons («بدائل», «شحن», the add-to-cart
    // squares, and the desktop wallet «شحن المحفظة» twin that also keeps
    // text-base). An h-12 appearing on a default-variant CTA is the
    // retired hand-roll coming back; this fires before it can ship.
    const tags = buttonTags(CTA_BLOCK_CODE);
    expect(tags.length).toBeGreaterThanOrEqual(4);
    let h12Carriers = 0;
    for (const tag of tags) {
      if (H_12_TOKEN.test(tag)) {
        h12Carriers += 1;
        expect(tag, tag).toContain('variant="outline"');
      }
    }
    // The retirement is real: the outline row-geometry carriers exist
    // (the compact twins), and…
    expect(h12Carriers).toBeGreaterThan(0);
    // …the inverse holds — no primary CTA hand-rolls geometry, fill or
    // shadow on top of the recipe:
    for (const tag of tags.filter((t) => !t.includes('variant="'))) {
      expect(tag, tag).not.toMatch(H_12_TOKEN);
      expect(tag, tag).not.toContain("bg-primary");
      expect(tag, tag).not.toContain("shadow-lg");
      expect(tag, tag).not.toContain("shadow-md");
    }
  });

  it("the retired hand-roll strings are gone from the money-CTA code (comment-stripped — prose can't mask a regression)", () => {
    // R139 (precision): the exact retired stacks the r138 comments name:
    // the login CTA's shadow-lg shadow-primary/25, the flat
    // hover:bg-primary/90 fill, the verifying state's bg-primary/70 dim.
    // CheckoutCta + CtaBlock are fully clean file-wide; cart's guards
    // scope to the money window (its empty-state browse hero legitimately
    // carries the pre-r138 chrome — /20, not the retired /25 stack), so
    // only the /25 combo is file-wide there.
    expect(CHECKOUT_CTA_CODE).not.toContain("shadow-lg");
    expect(CHECKOUT_CTA_CODE).not.toContain("bg-primary");
    expect(CTA_BLOCK_CODE).not.toContain("shadow-lg");
    expect(CTA_BLOCK_CODE).not.toContain("hover:bg-primary/90");
    for (const code of [CART_CODE, CHECKOUT_CTA_CODE, CTA_BLOCK_CODE]) {
      expect(code).not.toContain("shadow-lg shadow-primary/25");
      expect(code).not.toContain("bg-primary/70");
    }
    // And no Button in CtaBlock hand-rolls a primary fill on ANY variant
    // — the bg-primary/8 shortfall info tile is a <div>, not a CTA; the
    // tag-scoped guard draws that line precisely.
    for (const tag of buttonTags(CTA_BLOCK_CODE)) {
      expect(tag, tag).not.toContain("bg-primary");
    }
  });
});

describe("R138 recipe — cart line-item hierarchy (the inversion fix: money leads, the name identifies)", () => {
  it("the line title rides 600 (font-semibold) — the identifier, not the loudest element on the row", () => {
    // R139 (precision): freezes the r138 demotion 700→600. The old
    // font-bold title fought the price for the row's emphasis; the exact
    // string pins the weight + the R124-I4 text-safe hover token together
    // (dir="auto" is pinned separately by the r128 sweeps — no need to
    // double-guard it here).
    expect(CART_CODE).toContain(
      'className="font-semibold text-sm leading-snug truncate group-hover:text-primary-text transition-colors"',
    );
    // Negative guard: the pre-r138 700-title combo must not return.
    expect(CART_CODE).not.toMatch(/font-bold text-sm leading-snug/);
  });

  it("the unit price rides 700 + tabular-nums + INK (text-foreground) — no brand tint on amounts", () => {
    // R139 (precision): freezes both halves of the r138 money-line fix —
    // the weight inversion (price 700 > title 600, so the money is the
    // loudest element) AND the ink decision: the unit price was the money
    // path's last tinted amount; plain foreground matches ProductCard's
    // price and this page's own summary total. The regex ties the exact
    // class string to the `price` binding so a tinted or re-weighted
    // clone can't pass as the unit price.
    expect(CART_CODE).toMatch(
      /<span className="font-bold text-sm tabular-nums text-foreground">\s*\{formatCurrency\(price\)\}/,
    );
  });

  it("the checkout summary's it.name twin speaks the same ladder — 600 name / 700 tabular-nums amount (one funnel, one ladder)", () => {
    // R139 (precision): the r138 comment's cross-page claim ("both pages
    // of the funnel speak one ladder") frozen — the CartSummaryAside line
    // rows mirror cart.tsx's hierarchy so the shopper reads the same
    // emphasis grammar from review to confirm.
    expect(SUMMARY_CODE).toContain('<div dir="auto" className="font-semibold truncate">');
    expect(SUMMARY_CODE).toContain('<div className="font-bold tabular-nums text-sm shrink-0">');
  });

  it("the cart's line rows + summary slip rest on the family elevation (border/60 + the two-layer calm shadow)", () => {
    // R139 (precision): the r138-B resting recipe on the money path's
    // surfaces — stacked line rows shade each other's top edge like paper
    // on paper, and the totals slip reads as the receipt lying over them.
    // A shadow-sm / border/70 / primary-tinted-shadow regression breaks
    // the exact strings; hover stays border-only (a row is line data, not
    // a clickable tile — no hover elevation may be invented either).
    expect(CART_CODE).toContain(
      "bg-card border border-border/60 rounded-xl p-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)] hover:border-border transition-all duration-200 group",
    );
    expect(CART_CODE).toContain(
      "bg-card border border-border/60 rounded-2xl p-5 slide-up shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]",
    );
  });
});

describe("R138 recipe — PDP selected pills (one tinted dialect, no glow on selection states)", () => {
  it("the selected PLAN pill rides the tinted trio: bg-primary/15 + border-primary/30 + text-primary-text", () => {
    // R139 (precision): freezes the r138 convergence — the plan row's
    // selected state was a SOLID bg-primary fill + text-primary-foreground
    // + shadow-md shadow-primary/25; it now speaks the duration row's
    // calm chip dialect (the CatalogFiltersBar / MobileNav family). Both
    // branch strings are pinned: the trio AND the resting twin, which
    // keeps its own border box (the 1px toggle-jitter fix — the border
    // never disappears in either state).
    expect(VS_CODE).toContain('"bg-primary/15 text-primary-text border-primary/30"');
    expect(VS_CODE).toContain(
      '"bg-card text-foreground/80 border-border/50 hover:border-primary/40 hover:text-primary-text"',
    );
  });

  it("the selected DURATION pill rides the same trio (one component, one dialect)", () => {
    // R139 (precision): the duration row's twin — its selected state was
    // a /12 tint + FULL-strength border-primary + shadow-md
    // shadow-primary/15; it retired to the same /15 wash + /30 edge +
    // bold primary-text ink. The resting twin is pinned with its border
    // box too (same no-jitter idiom).
    expect(VS_CODE).toContain('"bg-primary/15 border-primary/30 text-primary-text"');
    expect(VS_CODE).toContain('"bg-card border-border/50 hover:border-primary/40"');
  });

  it("NO pill carries a shadow — the selector's code contains no shadow token of any kind", () => {
    // R139 (precision): the boundary-sensitive negative. shadow-md is a
    // sanctioned family value ELSEWHERE in the app (ProductCard's badge
    // elevation, the Button default variant) but must NEVER ride a
    // SELECTION state — a colored shadow on selected is glow vocabulary,
    // and the r138 contract bans glow halos. File-wide on the
    // comment-stripped selector: no shadow class exists at all.
    expect(VS_CODE).not.toMatch(/shadow/);
  });

  it("no solid bg-primary fill, no text-primary-foreground ink on any pill", () => {
    // R139 (precision): the retired solid-fill dialect. A bare bg-primary
    // token (the lookahead lets bg-primary/15 pass) or the
    // primary-foreground ink pair would re-split the two rows into
    // loud/quiet — exactly the two-dialect bug r138 closed.
    expect(VS_CODE).not.toMatch(SOLID_BG_PRIMARY);
    expect(VS_CODE).not.toContain("text-primary-foreground");
  });

  it("scoped pill templates: both className templates carry the trio, a border in BOTH branches, and no shadow (r126 scoping idiom)", () => {
    // R139 (precision): the scoped extraction — the two pill className
    // templates (plan + duration) are the only min-h-11 surfaces in the
    // selector; asserting on the extracted template (not the whole file)
    // is what lets the "no shadow on SELECTION states" guard stay
    // precise while shadow-md remains legal elsewhere in the app.
    const templates = VS_CODE.match(/className=\{`[\s\S]*?`\}/g) ?? [];
    const pills = templates.filter((t) => t.includes("min-h-11"));
    expect(pills).toHaveLength(2);
    for (const tpl of pills) {
      // the selected trio, inside the template that renders it:
      expect(tpl, "selected trio").toContain("bg-primary/15");
      expect(tpl, "selected trio").toContain("border-primary/30");
      expect(tpl, "selected trio").toContain("text-primary-text");
      // both states carry the border box (no 1px toggle jitter):
      expect(tpl).toMatch(/border-primary\/30/);
      expect(tpl).toMatch(/border-border\/50/);
      // no shadow vocabulary inside the pill chrome:
      expect(tpl).not.toMatch(/shadow/);
    }
  });
});

describe("R138 recipe — the PDP sticky buy bar (premium-checkout-bar chrome, the z-45 layer)", () => {
  it("solid bg-card + border-t border-border/35 + z-[45] — the glass diet on the money bar", () => {
    // R139 (precision): freezes the r138 ① + ② chrome. bg-card/97 +
    // backdrop-blur-xl retired to SOLID bg-card ("no glass" is the
    // round's contract — at 97% the blur was sub-perceptual while an
    // always-mounted bar over scrolling content re-rastered the filter
    // every frame); the /35 content-facing edge matches the
    // Navbar/MobileNav/Footer family; z-[45] preserves the R116 z-scale
    // layer between the bottom nav (40) and modals (50).
    expect(PRODUCT_CODE).toContain(
      "sm:hidden z-[45] bg-card border-t border-border/35 px-4 pt-3 shadow-[0_-1px_2px_rgb(0_0_0/0.3),0_-10px_28px_-14px_rgb(0_0_0/0.4)]",
    );
  });

  it("no glass vocabulary survives in the PDP's code — backdrop-blur / bg-card/9x / shadow-2xl all absent", () => {
    // R139 (precision): the file-wide guard for the retired chrome. The
    // retired strings live on only in the R138 rationale comment
    // ("bg-card/97 + backdrop-blur-xl → SOLID bg-card"), which
    // stripComments removes — so documentation of the retirement can
    // never mask an actual regression.
    expect(PRODUCT_CODE).not.toContain("backdrop-blur");
    expect(PRODUCT_CODE).not.toContain("bg-card/9");
    expect(PRODUCT_CODE).not.toContain("shadow-2xl");
  });

  it("the .hairline-glow utility is the bar's FIRST child, with the CtaBlock twin after it", () => {
    // R139 (precision): freezes the r138 ② decision — the 45-layer buys
    // chrome wears the family's top-edge hairline stack (the exact
    // Navbar/MobileNav/Footer recipe) instead of hand-rolling a firmer
    // border. First-child position matters: the glow must sit at the very
    // top edge, above the CTA content. The no-"<"-between guard proves
    // nothing renders before it (only the rationale comment, which does
    // not render, sits in the gap).
    const barIdx = PRODUCT_CODE.indexOf("sm:hidden z-[45]");
    expect(barIdx).toBeGreaterThanOrEqual(0);
    const glowIdx = PRODUCT_CODE.indexOf('<div className="hairline-glow" />', barIdx);
    expect(glowIdx).toBeGreaterThan(barIdx);
    const tagClose = PRODUCT_CODE.indexOf(">", barIdx);
    expect(tagClose).toBeGreaterThan(barIdx);
    expect(PRODUCT_CODE.slice(tagClose + 1, glowIdx)).not.toContain("<");
    // …and the bar's payload — the compact CtaBlock twin whose primary
    // CTAs ride the canonical size="lg" recipe (pinned above) — follows:
    const ctaIdx = PRODUCT_CODE.indexOf("<CtaBlock", glowIdx);
    expect(ctaIdx).toBeGreaterThan(glowIdx);
  });

  it("the mirrored two-layer elevation (negative offsets, cast UP) replaced the 2xl halo", () => {
    // R139 (precision): freezes the r138 ③ decision — the r138-B resting
    // elevation mirrored for the bottom dock: a tight NEGATIVE contact
    // line + contained negative ambient so the shadow reads as cast onto
    // the content the bar occludes, not a floating-chip halo. The exact
    // negative-offset string is pinned; the upright (card-family)
    // variant must never dock on the bar.
    expect(PRODUCT_CODE).toContain(
      "shadow-[0_-1px_2px_rgb(0_0_0/0.3),0_-10px_28px_-14px_rgb(0_0_0/0.4)]",
    );
    expect(PRODUCT_CODE).not.toContain(
      "shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]",
    );
  });
});

describe("R138 recipe — quiet danger at rest (severity lives in the confirm dialog)", () => {
  it("the clear-cart trigger rests text-muted-foreground — error ink ONLY on hover", () => {
    // R139 (precision): freezes the r138 quiet-danger decision. The
    // trigger rode full status-error ink at REST — red shouting at the
    // top of the page while its per-line twin correctly rested muted. The
    // exact string pins the whole register: muted ink + hover:error tint
    // + the 96-F4 44px floor (min-h-11) + font-bold, on a quiet ghost
    // (not a destructive-variant button).
    const trigger = CART_CODE.match(/<Button\b[^>]*onClick=\{handleClear\}[^>]*>/)?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toContain('variant="ghost"');
    expect(trigger).toContain(
      'className="min-h-11 text-muted-foreground hover:text-status-error hover:bg-status-error/10 font-bold"',
    );
    // Scoped negative: no at-rest error ink on the trigger (the bare
    // token boundary — hover:text-status-error doesn't match).
    expect(trigger).not.toMatch(REST_ERROR_INK);
  });

  it("the per-line trash twin speaks the same register — one destructive family", () => {
    // R139 (precision): the r138 comment's cross-surface claim frozen —
    // the header trigger and the per-line trash rest muted and tint error
    // only on hover. One register for the destructive family; if either
    // surface re-tints at rest the exact strings fire.
    expect(CART_CODE).toContain(
      'className="min-h-11 min-w-11 px-2 rounded-lg hover:bg-status-error/10 text-muted-foreground hover:text-status-error transition-colors press-spring flex items-center justify-center"',
    );
  });

  it("the severity lives in the confirm dialog (destructive: true), not on the trigger", () => {
    // R139 (precision): the paired half of quiet danger — the 96-F4
    // destructive confirm carries the weight (functionally pinned by
    // cart-undo-clear's dialog tests; this freezes the chrome-side
    // coupling). If someone moves severity back onto the trigger, the
    // at-rest ink guard above fires while this still requires the dialog
    // to own the destructive tone.
    expect(CART_CODE).toContain("destructive: true");
  });
});
