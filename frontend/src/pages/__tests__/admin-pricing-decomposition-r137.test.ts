/**
 * R137 (FE) — the admin/pricing.tsx decomposition contract.
 * R181 — re-pinned for the settings-only page: the read-only profit/
 * margin calculator simulator was retired with its POST
 * /api/admin/pricing/calculate endpoint; the page is now the REAL
 * pricing system's operating surface (the WRITABLE pricing-rule card +
 * the two-step recompute flow with its destructive confirm + the
 * dry-run preview table).
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the zero-write
 * dry-run, the destructive confirm) is already pinned by the
 * admin/__tests__/pricing-console render suite; this file guards the
 * STRUCTURE so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core;
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. money-path ownership — the pricing-rule save (PUT /config), the
 *      destructive catalog recompute (POST /recompute behind its
 *      confirm gate) and the raw dry-run fetch stay IN the page: a
 *      stale closure in a presentational extract could reprice the
 *      whole catalog on the wrong rule;
 *   4. state ownership — the cross-section atoms stay centralized in
 *      the page; the extracts take values + callbacks only;
 *   5. R181 retirement pins — the simulator's imports, state atoms,
 *      handlers and helper modules may not silently return.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/pricing.tsx");

describe("R137/R181 (FE) — admin/pricing.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/pricing.tsx stays under the 500-line ceiling (R181 settings-only shape is ~310)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(500);
  });

  it("the page imports every surviving extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/pricing/pricing-errors",
      "@/components/admin/pricing/pricing-format",
      "@/components/admin/pricing/pricing-types",
      "@/components/admin/pricing/PricingConfigCard",
      "@/components/admin/pricing/RecomputePreviewCard",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("R181: the retired simulator's imports and handlers are gone (the retirement cannot silently regress)", () => {
    // The calculator extracts are not imported anywhere on the page…
    for (const specifier of [
      "@/components/admin/pricing/CalculatorInputsCard",
      "@/components/admin/pricing/CalculatorOutputsCard",
      "@/components/admin/pricing/MarginRow",
      "@/components/admin/pricing/pricing-risk",
    ]) {
      expect(page, specifier).not.toContain(`from "${specifier}"`);
    }
    // …the calculate loop and its race-guard token are gone…
    expect(page).not.toContain("async function calculate() {");
    expect(page).not.toContain("calcSeqRef");
    expect(page).not.toContain("useAdminPricingCalculate");
    expect(page).not.toContain("useListAdminProducts(");
    // …and the calculator's state atoms went with them.
    for (const atom of [
      "setProductId",
      "setVariantId",
      "setCustomPrice",
      "setCustomCost",
      "setCouponCode",
      "setSimulateReferred",
      "setResult(",
      "setCalcError",
    ]) {
      expect(page, atom).not.toContain(atom);
    }
  });

  it("the write-path handlers stay IN the page (the extracts render; the page owns the mutations)", () => {
    // saveConfig carries the PUT /api/admin/pricing/config body (the
    // rule that prices the whole catalog); previewRecompute carries the
    // raw dry-run fetch (the codegen'd hook can't express ?dry_run=true);
    // recomputeCatalog carries the destructive two-step confirm → POST
    // /recompute. None may drift into a presentational extract where a
    // stale closure could reprice the catalog on the wrong rule.
    expect(page).toContain("const saveConfig = () => {");
    expect(page).toContain("const previewRecompute = async () => {");
    expect(page).toContain("const recomputeCatalog = async () => {");
    expect(page).toContain("recomputeMutation.mutate(undefined);");
    // catalog-recon: the config seed re-runs while the form is PRISTINE
    // (R186 C-F4: the guard is inputsTouchedRef — a remote rule change
    // re-seeds an untouched form instead of reading it dirty).
    expect(page).toContain("if (inputsTouchedRef.current || !pricingConfig) return;");
    // The mutations themselves (and their invalidateQueries/toast
    // wiring) stay beside the handlers that fire them.
    expect(page).toContain("useUpdateAdminPricingConfig({");
    expect(page).toContain("useRecomputeCatalogPrices({");
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
    // One source: the config card's validity gates + configDirty and the
    // dry-run preview lifecycle all key off the same atoms; configDirty
    // compares the three rule inputs against the loaded rule.
    for (const atom of [
      'const [rateInput, setRateInput] = useState("");',
      'const [markupInput, setMarkupInput] = useState("");',
      'const [capInput, setCapInput] = useState("");',
      "const [dryRun, setDryRun] = useState<RecomputeDryRun | null>(null);",
      "const [dryRunLoading, setDryRunLoading] = useState(false);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The refs stay with them (R186 C-F4: configSeededRef became
    // inputsTouchedRef — dirty means operator-edited, not drifted).
    expect(page).toContain("const inputsTouchedRef = useRef(false);");
    // R123 (E3 P3c): the unsaved pricing RULE is the highest-impact
    // dirty form in the admin — the beforeunload guard rides the page.
    expect(page).toContain("useDirtyGuard(configDirty);");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved markup rides along verbatim (the render-suite pins follow the surface)", () => {
    // The formula explainer + the cap guardrail copy moved to
    // PricingConfigCard.tsx; the BEFORE→AFTER sample table to
    // RecomputePreviewCard.tsx. pricing-console.test.tsx reads the
    // page ∪ extracts union through the render; these spot-pins keep
    // the verbatim shapes at their new address so the union pins stay
    // meaningful.
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
    // R181: the settings title is the page's identity now.
    expect(page).toContain("إعدادات التسعير");
  });
});

describe("R137/R181 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a card needs is passed DOWN, so
    // no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the pricing settings screen is how a stale
    // closure could reprice the catalog on the wrong rule.
    const files = ["PricingConfigCard", "RecomputePreviewCard"];
    for (const name of files) {
      const src = read(`src/components/admin/pricing/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the pricing helper modules are React-free (pure formatters/contracts — importable by any lane)", () => {
    const files = ["pricing-errors", "pricing-format", "pricing-types"];
    for (const name of files) {
      const src = read(`src/components/admin/pricing/${name}.ts`);
      expect(src, name).not.toMatch(/from "react"|from "lucide-react"/);
    }
    // R125-I3 (A2-10b): the grouped-money formatter cache — the digit-
    // grouping convention every dinar figure on the screen renders
    // through, cached per decimals value.
    expect(read("src/components/admin/pricing/pricing-format.ts")).toContain(
      "const FMT_FORMATTERS = new Map<number, Intl.NumberFormat>();",
    );
    // The wire contract is shared, not re-declared per consumer — and
    // R181 retired the calculator's: only the recompute surface remains.
    const types = read("src/components/admin/pricing/pricing-types.ts");
    expect(types).toContain("export interface RecomputeDryRun {");
    // The retired calculator's contracts may not return as EXPORTS (the
    // header's retirement note may name them — history, not code).
    expect(types).not.toContain("export interface CalculatorResponse");
    expect(types).not.toContain("export type RiskState");
  });
});
