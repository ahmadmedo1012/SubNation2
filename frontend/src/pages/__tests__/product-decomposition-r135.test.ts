/**
 * R135 (FE-3) — the product.tsx decomposition contract.
 *
 * The money page was a 2,417-line single component (~14 useState atoms
 * in one function) — the repo's own audit flagged it as the highest
 * re-render blast-radius target ("Decompose the monolithic pages
 * (product.tsx 2417) into subcomponents"). R135 split it into
 * orchestration (pages/product.tsx) + ten verbatim extracts under
 * components/product/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, buy-intent
 * lifecycle) is already pinned by the eight product-* suites plus
 * order-decrypt-failed; this file guards the STRUCTURE so the
 * decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      2,417 lines; the ceiling leaves room to grow without re-ballooning
 *      into the monolith the audit flagged);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = the section silently vanished);
 *   3. state ownership — the cross-section atoms (variant selection,
 *      coupon quartet, order result, purchase receipt, buy pending,
 *      error) stay CENTRALIZED in the page: the R98-01 coupon × variant
 *      generation guard and the 97-F5 buy-intent fingerprint both hinge
 *      on one owner, and the extracts take values + callbacks only.
 *
 * R137 (closing): the round's no-monolith invariant tightened this
 * contract — the page had crept back to 1,058 lines, so the SEO input
 * builder (pure .ts), the outage/404 cards, the breadcrumb row and the
 * buy-panel END column were extracted verbatim (the checkout-r136
 * idiom). The deletion guards now read the page ∪ extracts union (a
 * nested extract owning an import is still a live import — BuyPanelColumn
 * mounts the selector/price/trust/FAQ/coupon/CTA blocks; the sticky-bar
 * CtaBlock twin stays in the page), and the R137 extracts carry their own
 * zero-hook purity pins.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/product.tsx");

/** R137 (closing): the product page SURFACE — page ∪ every module under
 *  components/product/ (verbatim extracts included). Pins follow the
 *  surface: an import that moved INTO a nested extract is still pinned
 *  (a dropped import anywhere in the surface is a vanished section). */
const surface = [
  page,
  ...readdirSync(resolve(process.cwd(), "src/components/product"))
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => read(`src/components/product/${f}`)),
].join("\n");

describe("R135 (FE-3) — product.tsx decomposition: page stays an orchestration core", () => {
  it("pages/product.tsx stays under the 1,000-line ceiling (was 2,417 at decomposition)", () => {
    // R137 (closing): tightened from 1,200 — the tree-wide no-monolith
    // invariant (no frontend source file exceeds 1,000 lines; the page
    // was 1,058 at the tightening and is ~770 after it).
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    // R137 (closing): reads the page ∪ extracts union — the buy-panel
    // mounts (selector/price/trust/FAQ/coupon/desktop CTA) ride inside
    // BuyPanelColumn, and category-presentation is owned by
    // ProductBreadcrumbNav + product-seo. The page still imports
    // CtaBlock itself (the compact sticky-bar twin), CouponField's
    // CouponResult contract and every direct section extract.
    const extracts = [
      "@/components/product/buy-intent-key",
      "@/components/product/category-presentation",
      "@/components/product/CopyField",
      "@/components/product/CouponField",
      "@/components/product/CtaBlock",
      "@/components/product/FaqAccordion",
      "@/components/product/OrderSuccessScreen",
      "@/components/product/PriceStockPanel",
      "@/components/product/ProductMediaSection",
      "@/components/product/RecommendationsSection",
      "@/components/product/TrustSignals",
      "@/components/product/VariantSelector",
      // R137 (closing) additions:
      "@/components/product/BuyPanelColumn",
      "@/components/product/ProductBreadcrumbNav",
      "@/components/product/ProductNotFoundCard",
      "@/components/product/ProductOutageCard",
      "@/components/product/product-seo",
    ];
    for (const specifier of extracts) {
      expect(surface, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the money-path handlers stay IN the page (the extracts render; the page owns the charge)", () => {
    // handleBuyIntent carries the 97-F5 idempotency lifecycle + the
    // R115-I1 pre-buy re-quote; it must never drift into a presentational
    // extract where a stale closure could charge the wrong intent.
    expect(page).toContain("const handleBuyIntent = async () => {");
    expect(page).toContain("const validateCoupon = async () => {");
    // The R98-01 generation counter is the coupon × variant desync guard —
    // it must live beside the state it supersedes, in the page.
    expect(page).toContain("couponGenerationRef.current += 1;");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the price panel, CTA, coupon math and buy-intent all
    // key off the same selection + coupon quartet + order result.
    for (const atom of [
      "const [selectedVariantId, setSelectedVariantId]",
      "const [couponResult, setCouponResult]",
      "const [couponInput, setCouponInput]",
      "const [orderResult, setOrderResult]",
      "const [purchaseSummary, setPurchaseSummary]",
      "const [buyPending, setBuyPending]",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // And the page is typed — no `any` state sneaks back in (the order
    // result rides the generated Order contract).
    expect(page).toContain("useState<Order | null>(null)");
    expect(page).not.toMatch(/useState<any/);
  });

  it("the sticky mobile buy bar wrapper stays in the page (guest/authed geometry is page state)", () => {
    // mobile-nav-clearance.test.tsx (components lane) pins the exact
    // guest-pin string read-only; this pin keeps the bar's two CTA
    // surfaces rendered from the page's own token/keyboard state rather
    // than an extract that would need both threaded back up.
    expect(page).toContain("stickyBarHiddenByKeyboard");
    expect(page).toMatch(/<CtaBlock[\s\S]*?compact\n/);
  });
});

describe("R135 (FE-3) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    const files = [
      "CopyField",
      "CouponField",
      "CtaBlock",
      "FaqAccordion",
      "OrderSuccessScreen",
      "PriceStockPanel",
      "ProductMediaSection",
      "TrustSignals",
      "VariantSelector",
    ];
    for (const name of files) {
      const src = read(`src/components/product/${name}.tsx`);
      expect(src, name).not.toMatch(/useState<.*selectedVariant|useState\(.*couponResult/);
    }
  });

  it("the money helpers module is React-free (pure localStorage lifecycle — importable by any lane)", () => {
    const src = read("src/components/product/buy-intent-key.ts");
    expect(src).not.toMatch(/from "react"|from "lucide-react"/);
    expect(src).toContain("const BUY_KEY_TTL_MS = 10 * 60 * 1000;");
  });
});

describe("R137 (closing) — the new extracts are pure presentational units", () => {
  it("the R137 section extracts are hookless (values + callbacks only — the r136 idiom)", () => {
    // BuyPanelColumn mounts the whole buy panel from page-owned atoms;
    // the cards and the breadcrumb carry zero hooks of their own — no
    // useState/useRef/useEffect/useMemo island can grow in them.
    const files = [
      "BuyPanelColumn",
      "ProductBreadcrumbNav",
      "ProductNotFoundCard",
      "ProductOutageCard",
    ];
    for (const name of files) {
      const src = read(`src/components/product/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the SEO input builder is React-free (pure three-branch argument — importable by any lane)", () => {
    const src = read("src/components/product/product-seo.ts");
    expect(src).not.toMatch(/from "react"|from "lucide-react"/);
    expect(src).toContain("export function productSeoInput(");
    // The verbatim shapes the page's SEO block was pinning follow the
    // surface: the honest 404 branch + the neutral fallback stay live.
    expect(src).toContain('title: "المنتج غير موجود — SubNation"');
    expect(src).toContain('robots: "noindex,follow"');
    expect(src).toContain('title: "SubNation"');
  });
});
