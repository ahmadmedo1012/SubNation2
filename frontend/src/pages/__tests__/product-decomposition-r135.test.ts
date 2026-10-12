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
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/product.tsx");

describe("R135 (FE-3) — product.tsx decomposition: page stays an orchestration core", () => {
  it("pages/product.tsx stays under the 1,200-line ceiling (was 2,417 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1200);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/product/buy-intent-key",
      "@/components/product/category-presentation",
      "@/components/product/CouponField",
      "@/components/product/CtaBlock",
      "@/components/product/FaqAccordion",
      "@/components/product/OrderSuccessScreen",
      "@/components/product/PriceStockPanel",
      "@/components/product/ProductMediaSection",
      "@/components/product/RecommendationsSection",
      "@/components/product/TrustSignals",
      "@/components/product/VariantSelector",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
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
