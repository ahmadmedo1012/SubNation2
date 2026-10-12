/**
 * R136 (FE-2) — the checkout.tsx decomposition contract.
 *
 * The money page was a 1,665-line single component (11 useState atoms,
 * 4 effects, a 325-line per-unit charge loop and every presentational
 * card inline in one function) — the R135 product.tsx precedent
 * (2,417 → 12 extracts) applied here: orchestration
 * (pages/checkout.tsx) + nine verbatim extracts under
 * components/checkout/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the 96-F4
 * per-unit Idempotency-Key lifecycle) is already pinned by the five
 * checkout-* render suites + components/__tests__/route-skeleton-checkout;
 * this file guards the STRUCTURE so the decomposition cannot silently
 * regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,665 lines; the ceiling leaves room to grow without re-ballooning
 *      into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. money-path ownership — handleConfirm (the per-unit charge loop)
 *      and its Idempotency-Key lifecycle (load/persist/clearCheckoutUnitKey)
 *      stay IN the page: a stale closure in a presentational extract
 *      could charge the wrong intent;
 *   4. state ownership — all 11 cross-section atoms stay centralized in
 *      the page (canSubmit spans five of them); the extracts take values
 *      + callbacks only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/checkout.tsx");

describe("R136 (FE-2) — checkout.tsx decomposition: page stays an orchestration core", () => {
  it("pages/checkout.tsx stays under the 1,000-line ceiling (was 1,665 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/checkout/checkout-errors",
      "@/components/checkout/checkout-unit-key",
      "@/components/checkout/coupon-quote",
      "@/components/checkout/live-requote",
      "@/components/checkout/PaymentMethodCard",
      "@/components/checkout/CouponCard",
      "@/components/checkout/OrderErrorBanner",
      "@/components/checkout/CheckoutCta",
      "@/components/checkout/CartSummaryAside",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the money-path handler + its Idempotency-Key lifecycle stay IN the page (the extracts render; the page owns the charge)", () => {
    // handleConfirm carries the 325-line per-unit charge loop — the
    // 96-F4 key lifecycle, the multi-tab live-cart guard and the
    // partial-failure cart-sync. It must never drift into a
    // presentational extract where a stale closure could charge the
    // wrong intent.
    expect(page).toContain("async function handleConfirm() {");
    // The R98-01 generation counter is the coupon × basket desync guard
    // — it must live beside the state it supersedes, in the page.
    expect(page).toContain("couponGenerationRef.current += 1;");
    // 96-F4: the per-unit Idempotency-Key lifecycle — read → persist →
    // clear at the two definitive resolution points (the per-unit HTTP
    // rejection + the cart-sync's accounted successes).
    expect(page).toContain("loadCheckoutUnitKey(it.productId");
    expect(page).toContain("persistCheckoutUnitKey(");
    expect(page).toContain("clearCheckoutUnitKey(it.productId");
    expect(page).toContain("clearCheckoutUnitKey(productId, variantId, unit)");
    // And the lifecycle's implementation lives in the pure module the
    // page imports by name (never duplicated inline).
    const unitKeyModule = read("src/components/checkout/checkout-unit-key.ts");
    expect(unitKeyModule).toContain("export function loadCheckoutUnitKey(");
    expect(unitKeyModule).toContain("export function persistCheckoutUnitKey(");
    expect(unitKeyModule).toContain("export function clearCheckoutUnitKey(");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the balance chip, the coupon math, the summary totals
    // and the canSubmit gate all key off the same atoms — canSubmit
    // spans five of them (token/isEmpty/submitting/insufficient/
    // pricingRecheckInFlight/items).
    for (const atom of [
      "const [coupon, setCoupon] = useState(",
      "const [appliedCoupon, setAppliedCoupon] = useState<",
      "const [couponChecking, setCouponChecking] = useState(",
      "const [couponNotice, setCouponNotice] = useState<string | null>(",
      "const [pricingRecheckInFlight, setPricingRecheckInFlight] = useState(",
      "const [pricesUpdatedNotice, setPricesUpdatedNotice] = useState<string | null>(",
      "const [droppedLineNotices, setDroppedLineNotices] = useState<string[]>(",
      "const [submitting, setSubmitting] = useState(",
      "const [orderError, setOrderError] = useState<string | null>(",
      "const [partialCount, setPartialCount] = useState(",
      "const [submitProgress, setSubmitProgress] = useState<",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The refs and the five-cluster gate stay with them.
    expect(page).toContain("const couponGenerationRef = useRef(0);");
    expect(page).toContain("const quotedProductIdsRef = useRef<Set<number>>(new Set());");
    expect(page).toContain("const abandonedRef = useRef(false);");
    expect(page).toContain("const canSubmit = useMemo(() => {");
    // And the page is typed — no `any` state sneaks back in (the coupon
    // result rides the exported AppliedCoupon contract).
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved money-path markup rides along verbatim (the a4-f1/r128 pins follow the surface)", () => {
    // The empty-state CTA and the dir="auto" it.name rows moved to
    // CartSummaryAside.tsx — storefront-r128-sweep + a4-f1-nesting-sweep
    // read the page ∪ extracts union; these spot-pins keep the verbatim
    // shapes at their new address so the union pins stay meaningful.
    const aside = read("src/components/checkout/CartSummaryAside.tsx");
    expect(aside).toContain("<Button asChild");
    expect(aside).toContain('تصفح المنتجات');
    expect(aside).toMatch(/<div[^>]*dir="auto"[^>]*>\s*\{it\.name\}/);
  });
});

describe("R136 (FE-2) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a card needs is passed DOWN, so
    // no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the money page is how the R98-01-class desync
    // bugs happen.
    const files = [
      "CartSummaryAside",
      "CheckoutCta",
      "CouponCard",
      "OrderErrorBanner",
      "PaymentMethodCard",
    ];
    for (const name of files) {
      const src = read(`src/components/checkout/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the money helpers modules are React-free (pure lifecycle/pricing — importable by any lane)", () => {
    const files = ["checkout-errors", "checkout-unit-key", "coupon-quote", "live-requote"];
    for (const name of files) {
      const src = read(`src/components/checkout/${name}.ts`);
      expect(src, name).not.toMatch(/from "react"|from "lucide-react"/);
    }
    // The 98-F2 retry-token TTL — the durability bound the 96-F4
    // docblock documents.
    expect(read("src/components/checkout/checkout-unit-key.ts")).toContain(
      "const CHECKOUT_KEY_TTL_MS = 10 * 60 * 1000;",
    );
  });
});
