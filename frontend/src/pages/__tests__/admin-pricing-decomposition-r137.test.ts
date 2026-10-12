/**
 * R137 (FE) — the admin/pricing.tsx decomposition contract.
 *
 * The pricing console was a 1,438-line single component (13 useState
 * atoms, 4 effects, the WRITABLE pricing-rule card, the two-step
 * recompute flow with its destructive confirm, the dry-run preview
 * table and the whole read-only economics console inline in one
 * function) — the R136 checkout.tsx precedent (1,665 → 9 extracts)
 * applied here: orchestration (pages/admin/pricing.tsx) + verbatim
 * extracts under components/admin/pricing/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the R125-I3
 * race-guarded calculate loop, the R126-L3 stale-keep banner) is
 * already pinned by the admin/__tests__/pricing-console render suite;
 * this file guards the STRUCTURE so the decomposition cannot silently
 * regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,438 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. money-path ownership — the pricing-rule save (PUT /config), the
 *      destructive catalog recompute (POST /recompute behind its
 *      confirm gate) and the race-guarded calculate loop stay IN the
 *      page: a stale closure in a presentational extract could reprice
 *      the whole catalog on the wrong rule;
 *   4. state ownership — all cross-section atoms stay centralized in
 *      the page (canCalculate spans five of them); the extracts take
 *      values + callbacks only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/pricing.tsx");

describe("R137 (FE) — admin/pricing.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/pricing.tsx stays under the 1,000-line ceiling (was 1,438 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/pricing/pricing-errors",
      "@/components/admin/pricing/pricing-format",
      "@/components/admin/pricing/pricing-types",
      "@/components/admin/pricing/PricingConfigCard",
      "@/components/admin/pricing/RecomputePreviewCard",
      "@/components/admin/pricing/CalculatorInputsCard",
      "@/components/admin/pricing/CalculatorOutputsCard",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
    // MarginRow + the risk maps ride INSIDE CalculatorOutputsCard — pin
    // that consumer too (a dropped import there is the same vanished
    // risk badge / margin tiers, one hop down).
    const outputs = read("src/components/admin/pricing/CalculatorOutputsCard.tsx");
    expect(outputs).toContain('from "@/components/admin/pricing/MarginRow"');
    expect(outputs).toContain('from "@/components/admin/pricing/pricing-risk"');
    expect(outputs).toContain('from "@/components/admin/pricing/pricing-format"');
  });

  it("the write-path handlers stay IN the page (the extracts render; the page owns the mutations)", () => {
    // saveConfig carries the PUT /api/admin/pricing/config body (the
    // rule that prices the whole catalog); previewRecompute carries the
    // raw dry-run fetch (the codegen'd hook can't express ?dry_run=true);
    // recomputeCatalog carries the destructive two-step confirm → POST
    // /recompute; calculate carries the console loop. None may drift
    // into a presentational extract where a stale closure could reprice
    // the catalog on the wrong rule.
    expect(page).toContain("const saveConfig = () => {");
    expect(page).toContain("const previewRecompute = async () => {");
    expect(page).toContain("const recomputeCatalog = async () => {");
    expect(page).toContain("async function calculate() {");
    expect(page).toContain("recomputeMutation.mutate(undefined);");
    // R125-I3 (A2-11): the monotonic seq token — only the response
    // whose seq is still the newest may write the result slot.
    expect(page).toContain("const seq = ++calcSeqRef.current;");
    expect(page).toContain("if (seq !== calcSeqRef.current) return;");
    // catalog-recon: the config seed runs exactly once per loaded rule.
    expect(page).toContain("configSeededRef.current = true;");
    // The mutations themselves (and their invalidateQueries/toast
    // wiring) stay beside the handlers that fire them.
    expect(page).toContain("useUpdateAdminPricingConfig({");
    expect(page).toContain("useRecomputeCatalogPrices({");
    expect(page).toContain("useAdminPricingCalculate({");
    // And the pure helpers the handlers call live in the React-free
    // modules the page imports by name (never duplicated inline).
    expect(read("src/components/admin/pricing/pricing-format.ts")).toContain(
      "export const round2 = (v: number): number => Math.round(v * 100) / 100;",
    );
    expect(read("src/components/admin/pricing/pricing-errors.ts")).toContain(
      "export function describeError(err: unknown): string {",
    );
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the config card's validity gates + configDirty, the
    // calculator's canCalculate gate and the outputs' R126-L3 stale-keep
    // banner all key off the same atoms — canCalculate spans five of
    // them (productId/selectedProduct/customPrice) and configDirty
    // compares three more against the loaded rule.
    for (const atom of [
      'const [productId, setProductId] = useState<number | "custom">("custom");',
      'const [variantId, setVariantId] = useState<number | "">("");',
      'const [customPrice, setCustomPrice] = useState("");',
      'const [customCost, setCustomCost] = useState("");',
      'const [couponCode, setCouponCode] = useState("");',
      "const [simulateReferred, setSimulateReferred] = useState(false);",
      "const [result, setResult] = useState<CalculatorResponse | null>(null);",
      "const [calcError, setCalcError] = useState<string | null>(null);",
      'const [rateInput, setRateInput] = useState("");',
      'const [markupInput, setMarkupInput] = useState("");',
      'const [capInput, setCapInput] = useState("");',
      "const [dryRun, setDryRun] = useState<RecomputeDryRun | null>(null);",
      "const [dryRunLoading, setDryRunLoading] = useState(false);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The refs and the two cluster gates stay with them.
    expect(page).toContain("const configSeededRef = useRef(false);");
    expect(page).toContain("const calcSeqRef = useRef(0);");
    expect(page).toContain("const canCalculate = useMemo(() => {");
    // R123 (E3 P3c): the unsaved pricing RULE is the highest-impact
    // dirty form in the admin — the beforeunload guard rides the page.
    expect(page).toContain("useDirtyGuard(configDirty);");
    // And the page is typed — no `any` state sneaks back in (the
    // calculator result rides the exported CalculatorResponse contract).
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved console markup rides along verbatim (the render-suite pins follow the surface)", () => {
    // The formula explainer + the cap guardrail copy moved to
    // PricingConfigCard.tsx; the BEFORE→AFTER sample table to
    // RecomputePreviewCard.tsx; the auto-variant option + the referred
    // toggle to CalculatorInputsCard.tsx; the risk badge + the stale-
    // keep banner to CalculatorOutputsCard.tsx. pricing-console.test.tsx
    // reads the page ∪ extracts union through the render; these
    // spot-pins keep the verbatim shapes at their new address so the
    // union pins stay meaningful.
    const config = read("src/components/admin/pricing/PricingConfigCard.tsx");
    expect(config).toContain("السعر = التكلفة × (1 + الهامش %) × سعر الصرف");
    expect(config).toContain(
      "سقف الخصم المجمّع (تخفيضات + كوبون) — 50% = خط التعادل عند هامش 100%",
    );
    expect(config).toContain("حفظ الإعدادات لا يغيّر الأسعار المخزّنة");
    const preview = read("src/components/admin/pricing/RecomputePreviewCard.tsx");
    expect(preview).toContain("معاينة إعادة الاحتساب");
    expect(preview).toContain("#{s.variant_id}");
    expect(preview).toContain("عينة أول 25 باقة من أصل");
    const inputs = read("src/components/admin/pricing/CalculatorInputsCard.tsx");
    expect(inputs).toContain("تلقائي — أرخص باقة نشطة");
    expect(inputs).toContain("محاكاة مشتري مُحال");
    expect(inputs).toContain("رمز الكوبون (اختياري)");
    const outputs = read("src/components/admin/pricing/CalculatorOutputsCard.tsx");
    expect(outputs).toContain("data-risk-state={result.risk_state}");
    expect(outputs).toContain("RISK_STATE_TONE[result.risk_state]");
    expect(outputs).toContain("أدخل سعراً أو اختر منتجاً لرؤية الحساب.");
    expect(outputs).toContain(
      "فشل تحديث الحاسبة — النتيجة أدناه من آخر حساب ناجح وقد لا تطابق المدخلات الحالية.",
    );
    const marginRow = read("src/components/admin/pricing/MarginRow.tsx");
    expect(marginRow).toContain('${lyd >= 0 ? "+" : ""}${fmt(lyd)} د.ل');
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a card needs is passed DOWN, so
    // no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the pricing console is how a stale seq/closure
    // could reprice the catalog on the wrong rule.
    const files = [
      "MarginRow",
      "PricingConfigCard",
      "RecomputePreviewCard",
      "CalculatorInputsCard",
      "CalculatorOutputsCard",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/pricing/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the pricing helper modules are React-free (pure formatters/risk maps — importable by any lane)", () => {
    const files = ["pricing-errors", "pricing-format", "pricing-risk", "pricing-types"];
    for (const name of files) {
      const src = read(`src/components/admin/pricing/${name}.ts`);
      expect(src, name).not.toMatch(/from "react"|from "lucide-react"/);
    }
    // R125-I3 (A2-10b): the grouped-money formatter cache — the digit-
    // grouping convention every dinar figure on the console renders
    // through, cached per decimals value.
    expect(read("src/components/admin/pricing/pricing-format.ts")).toContain(
      "const FMT_FORMATTERS = new Map<number, Intl.NumberFormat>();",
    );
    // A5 Part 15: never bare colors — every risk state renders WITH its
    // WHY text from the shared maps + riskExplanation().
    const risk = read("src/components/admin/pricing/pricing-risk.ts");
    expect(risk).toContain("export const RISK_STATE_LABEL: Record<RiskState, string> = {");
    expect(risk).toContain("export const RISK_STATE_TONE: Record<RiskState, string> = {");
    expect(risk).toContain("export function riskExplanation(result: CalculatorResponse): string {");
    // The wire contracts are shared, not re-declared per consumer.
    const types = read("src/components/admin/pricing/pricing-types.ts");
    expect(types).toContain('export type RiskState = "SAFE" | "WATCH" | "THIN" | "LOSS";');
    expect(types).toContain("export interface CalculatorResponse {");
    expect(types).toContain("export interface RecomputeDryRun {");
  });
});
