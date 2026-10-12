import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useConfirm } from "@/hooks/use-confirm";
// R123 (E3 item 1): the dry-run preview fetch rides the session-aware
// wrapper — a mid-work 401 now gets the global «انتهت الجلسة» toast +
// redirect instead of a local «تعذّرت المعاينة» on a page the operator
// is leaving, and adminFetchJson owns the ok-guard + safe parse.
import { AdminSessionExpiredError, adminFetchJson } from "@/lib/admin-session";
// R123 (E3 P3c): see the configDirty guard below.
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  type AdminPricingCalculateBody,
  getGetAdminPricingConfigQueryKey,
  getListAdminProductsQueryKey,
  useAdminPricingCalculate,
  useGetAdminPricingConfig,
  useListAdminProducts,
  useRecomputeCatalogPrices,
  useUpdateAdminPricingConfig,
} from "@workspace/api-client-react";
import { Calculator } from "lucide-react";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the page's self-contained subcomponents and
// pure helpers moved to @/components/admin/pricing/* (verbatim moves —
// the money path, the race-guarded calculate loop, the destructive
// recompute + its confirm gate, every state atom and every handler stay
// HERE; the extracts render the byte-identical DOM they rendered inline
// yesterday). Import surface:
//   • pricing-types / pricing-format / pricing-errors — the page's pure
//     modules (the calculate + dry-run wire contracts, the grouped-money
//     formatters + round2, the backend-Arabic error resolver)
//   • PricingConfigCard — the WRITABLE «إعدادات التسعير العامة» card
//     (rule inputs, formula explainer, save/preview/recompute toolbar —
//     every write stays a page-owned callback passed down as a prop)
//   • RecomputePreviewCard — the R115 dry-run preview (counts + the
//     BEFORE→AFTER sample table; the preview fetch stays HERE)
//   • CalculatorInputsCard — the simulator's inputs (product/variant
//     pickers, custom sandbox, coupon, referred toggle; the raw page
//     setters flow down so no input grows its own state island)
//   • CalculatorOutputsCard — the economics console outputs (risk badge
//     + WHY, waterfall, the MarginRow tiers, worst-case, guardrails,
//     warnings — MarginRow + the risk maps ride along inside it)
import type { CalculatorResponse, RecomputeDryRun } from "@/components/admin/pricing/pricing-types";
import { round2 } from "@/components/admin/pricing/pricing-format";
import { describeError } from "@/components/admin/pricing/pricing-errors";
import { PricingConfigCard } from "@/components/admin/pricing/PricingConfigCard";
import { RecomputePreviewCard } from "@/components/admin/pricing/RecomputePreviewCard";
import { CalculatorInputsCard } from "@/components/admin/pricing/CalculatorInputsCard";
import { CalculatorOutputsCard } from "@/components/admin/pricing/CalculatorOutputsCard";

/**
 * Admin Pricing Calculator + global pricing rule
 *
 * catalog-recon (2026-09-20): the page gained a WRITABLE section on top —
 * «إعدادات التسعير العامة» (GET/PUT /api/admin/pricing/config + POST
 * /api/admin/pricing/recompute). Everything below it stays the read-only
 * profit/margin simulator. Talks to POST /api/admin/pricing/calculate
 * which mirrors the live order pipeline (flash sale → coupon → final
 * price) — that part NEVER mutates anything.
 *
 * Inputs (calculator):
 *   - Existing product (picker) → optional VARIANT selector (R115: the
 *     real sellable unit — what checkout charges). Without a variant the
 *     calculator simulates the product's cheapest ACTIVE variant.
 *   - Custom price + cost (manual sandbox)
 *   - Optional coupon code
 *   - "Simulate referred buyer" toggle (subtracts the referral
 *     acquisition cost the API reports — never a frozen constant)
 *
 * Outputs (calculator) — R115 (Part 15) economics console:
 *   - Risk state badge SAFE / WATCH / THIN / LOSS with the WHY text
 *   - Pricing waterfall (list → flash sale → coupon → final)
 *   - Three margin tiers: gross / net (after loyalty) / referral-adjusted
 *   - Worst-case block (deepest allowed stack price + gross +
 *     contribution + referred)
 *   - Guardrails (break-even, program-inclusive safe minimum, max safe
 *     discount %) + the applied config line (incl. the discount cap)
 *   - Loss / low-margin / cap warnings with Arabic explanations
 */

export default function AdminPricingPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("inventory");
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [productId, setProductId] = useState<number | "custom">("custom");
  // R115 (Part 13): the variant selector — the sellable unit checkout
  // actually charges. "" = the product's cheapest ACTIVE variant (the
  // backend's product_id mode, labeled as such in the response).
  const [variantId, setVariantId] = useState<number | "">("");
  const [customPrice, setCustomPrice] = useState("");
  const [customCost, setCustomCost] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [simulateReferred, setSimulateReferred] = useState(false);
  const [result, setResult] = useState<CalculatorResponse | null>(null);
  // R126-L3 (A2-9 stale-keep): a FAILED recalculation keeps the last
  // successful result standing (with an error banner naming it stale)
  // instead of wiping it to the «أدخل سعراً…» placeholder — the auto-
  // recalc effect fires on every input change, so a transient 5xx on
  // one keystroke used to destroy a result the operator was reading
  // and replace it with a claim that no calculation existed at all.
  const [calcError, setCalcError] = useState<string | null>(null);

  const headers = useAdminHeaders();

  // ── catalog-recon: global pricing rule (rate + markup) — READ + WRITE ──
  const queryClient = useQueryClient();
  const { confirm, ConfirmDialog } = useConfirm();

  const {
    data: pricingConfig,
    isLoading: configLoading,
    isError: configLoadError,
    refetch: refetchConfig,
  } = useGetAdminPricingConfig({
    query: { queryKey: getGetAdminPricingConfigQueryKey(), enabled: !!adminToken && canView },
    request: { headers },
  });

  const [rateInput, setRateInput] = useState("");
  const [markupInput, setMarkupInput] = useState("");
  // R115 (policy 7): the combined flash+coupon discount cap (10–95).
  const [capInput, setCapInput] = useState("");

  // Seed the inputs once from the effective rule (later refetches keep the
  // same data identity via structural sharing, so operator edits survive).
  const configSeededRef = useRef(false);
  useEffect(() => {
    if (configSeededRef.current || !pricingConfig) return;
    configSeededRef.current = true;
    setRateInput(String(pricingConfig.usd_to_lyd));
    setMarkupInput(String(pricingConfig.markup_percent));
    setCapInput(String(pricingConfig.max_total_discount_pct));
  }, [pricingConfig]);

  const rateNum = parseFloat(rateInput);
  const markupNum = parseFloat(markupInput);
  const capNum = parseFloat(capInput);
  const rateValid = Number.isFinite(rateNum) && rateNum >= 0.1 && rateNum <= 1000;
  const markupValid = Number.isFinite(markupNum) && markupNum >= 0 && markupNum <= 10_000;
  // Backend bounds (savePricingConfig): INVALID_MAX_TOTAL_DISCOUNT_PCT
  // rejects anything outside 10–95.
  const capValid = Number.isFinite(capNum) && capNum >= 10 && capNum <= 95;
  const configDirty =
    pricingConfig != null &&
    (rateNum !== pricingConfig.usd_to_lyd ||
      markupNum !== pricingConfig.markup_percent ||
      capNum !== pricingConfig.max_total_discount_pct);
  const canSaveConfig = configDirty && rateValid && markupValid && capValid;

  // R123 (E3 P3c): an edited-but-unsaved pricing RULE is the highest-
  // impact dirty form in the admin (it prices the whole catalog) — the
  // same beforeunload guard the other long admin forms ride. configDirty
  // is exact: it compares the parsed inputs against the loaded rule, and
  // a successful save re-seeds the inputs (dirty flips false).
  useDirtyGuard(configDirty);

  // Live formula example — falls back to the loaded rule while a field is
  // empty/invalid so the explainer never shows nonsense numbers.
  const exampleFactor = markupValid
    ? 1 + markupNum / 100
    : pricingConfig
      ? 1 + pricingConfig.markup_percent / 100
      : 2;
  const exampleRate = rateValid ? rateNum : (pricingConfig?.usd_to_lyd ?? 10);
  const examplePrice = round2(5 * exampleFactor * exampleRate);

  const saveConfigMutation = useUpdateAdminPricingConfig({
    request: { headers },
    mutation: {
      onSuccess(config) {
        // Re-seed to the SERVER-rounded values (e.g. 10.999 → 11) and
        // refresh the rule for every other consumer (products page,
        // variant dialog previews) — the config is cached in TanStack.
        setRateInput(String(config.usd_to_lyd));
        setMarkupInput(String(config.markup_percent));
        setCapInput(String(config.max_total_discount_pct));
        void queryClient.invalidateQueries({ queryKey: getGetAdminPricingConfigQueryKey() });
        toast({ title: "تم حفظ إعدادات التسعير", variant: "success" });
      },
      onError(err: unknown) {
        toast({
          title: "تعذّر حفظ الإعدادات",
          description: describeError(err),
          variant: "destructive",
        });
      },
    },
  });

  // ── R115 (Part 15 / A5 P1-1): the two-step recompute ──────────────────
  // Step 1 «معاينة التغييرات» — POST /api/admin/pricing/recompute?dry_run=true
  // (counts + BEFORE→AFTER sample, ZERO writes). The generated
  // useRecomputeCatalogPrices hook exists for the REAL run and is kept
  // for it, but its codegen'd URL builder takes no query params — the
  // dry_run flag needs a raw fetch (the documented hook surface simply
  // can't express it yet).
  const [dryRun, setDryRun] = useState<RecomputeDryRun | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  const recomputeMutation = useRecomputeCatalogPrices({
    request: { headers },
    mutation: {
      onSuccess(result) {
        // Display prices (MIN of active variants) moved on the server —
        // refresh the admin products list this page already holds.
        void queryClient.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
        if (result.variants_updated > 0) {
          toast({
            title: "أُعيد احتساب أسعار الكتالوج",
            description: `حُدّثت أسعار ${result.variants_updated} باقة عبر ${result.products_updated} ${
              result.products_updated === 1 ? "منتج" : "منتجات"
            }`,
            variant: "success",
          });
        } else {
          toast({
            title: "لا تغييرات",
            description: "كل الأسعار مطابقة للقاعدة الحالية",
            variant: "info",
          });
        }
        // The applied run resolves the preview — drop it so a stale
        // BEFORE→AFTER sample can't linger next to post-write reality.
        setDryRun(null);
      },
      onError(err: unknown) {
        toast({
          title: "تعذّر إعادة الاحتساب",
          description: describeError(err),
          variant: "destructive",
        });
      },
    },
  });

  const previewRecompute = async () => {
    setDryRunLoading(true);
    try {
      const data = await adminFetchJson<RecomputeDryRun>(
        "/api/admin/pricing/recompute?dry_run=true",
        {
          method: "POST",
          headers,
        },
      );
      if (typeof data.variants_drifted !== "number" || !Array.isArray(data.sample)) {
        toast({
          title: "تعذّرت المعاينة",
          description: "استجابة غير متوقعة من الخادم",
          variant: "destructive",
        });
        return;
      }
      setDryRun(data);
    } catch (err) {
      // Session expiry already toasted + redirected — stay quiet.
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "تعذّرت المعاينة",
        description: err instanceof Error ? err.message : "تعذّر الاتصال بالخادم",
        variant: "destructive",
      });
    } finally {
      setDryRunLoading(false);
    }
  };

  // A preview is a function of the rule — the moment the operator edits
  // rate/markup the sample is stale. (The cap doesn't affect recompute
  // math, so it deliberately doesn't invalidate the preview.)
  useEffect(() => {
    setDryRun(null);
  }, [rateInput, markupInput]);

  const saveConfig = () => {
    if (!canSaveConfig) return;
    saveConfigMutation.mutate({
      data: {
        usd_to_lyd: round2(rateNum),
        markup_percent: round2(markupNum),
        max_total_discount_pct: round2(capNum),
      },
    });
  };

  // Step 2: the destructive confirm — now armed with the preview counts
  // when the operator ran one (A5 P1-1: the blind bulk mutation sees its
  // impact BEFORE approving it).
  const recomputeCatalog = async () => {
    const confirmed = await confirm({
      title: "إعادة احتساب أسعار الكتالوج؟",
      description: `${
        dryRun
          ? dryRun.variants_drifted > 0
            ? `المعاينة: ${dryRun.variants_drifted} باقة ستنحرف عبر ${dryRun.products_affected} ${
                dryRun.products_affected === 1 ? "منتج" : "منتجات"
              }. `
            : "المعاينة: لا تغييرات — كل الأسعار مطابقة للقاعدة الحالية. "
          : ""
      }سيُعاد حساب سعر كل باقة نشطة من تكلفتها بالقاعدة الحالية — بما فيها الأسعار المخصّصة يدويًا — وتُحدّث أسعار العرض تلقائيًا. لا يمكن التراجع بعد التنفيذ.`,
      confirmLabel: "إعادة الاحتساب",
      destructive: true,
    });
    if (!confirmed) return;
    recomputeMutation.mutate(undefined);
  };

  const { data: products = [] } = useListAdminProducts(undefined, {
    query: {
      queryKey: getListAdminProductsQueryKey(),
      enabled: !!adminToken && canView,
      refetchIntervalInBackground: false,
    },
    request: { headers },
  });

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  const selectedProduct = useMemo(
    () => (productId === "custom" ? null : (products.find((p) => p.id === productId) ?? null)),
    [productId, products],
  );

  // R115 (Part 13): the admin products list embeds the variant rows —
  // no second fetch needed for the selector.
  const selectedVariants = selectedProduct?.variants ?? [];

  const canCalculate = useMemo(() => {
    if (productId !== "custom") return selectedProduct != null;
    return Number.isFinite(parseFloat(customPrice)) && parseFloat(customPrice) >= 0;
  }, [productId, selectedProduct, customPrice]);

  // R115: the calculator rides the generated mutation hook
  // (useAdminPricingCalculate — same customFetch + auth headers path as
  // the config hooks). The response schema is open-ended
  // ({[key: string]: unknown}) in the codegen, so it is cast to the
  // page-local CalculatorResponse contract documented above.
  // R125-I3 (A2-11): race guard — the 300ms debounced auto-recalc and
  // the manual «إعادة الحساب» button share this one mutation; a slow
  // earlier response landing AFTER a newer request used to win
  // setResult (margins disagreeing with the inputs on screen). The
  // monotonic seq token is the referrals fetchSeqRef recipe: every
  // calculate() takes the next number, and only the response whose seq
  // is still the newest may write state. Handling moved off the
  // hook-level callbacks onto mutateAsync so the token can tag the
  // exact request it belongs to.
  const calcSeqRef = useRef(0);
  const calculateMutation = useAdminPricingCalculate({
    request: { headers },
  });
  const loading = calculateMutation.isPending;

  async function calculate() {
    if (!canCalculate) return;
    const body: AdminPricingCalculateBody = {
      coupon_code: couponCode.trim() || undefined,
      simulate_referred: simulateReferred,
    };
    if (productId === "custom") {
      body.price = parseFloat(customPrice);
      const c = customCost.trim();
      if (c !== "") body.cost_price = parseFloat(c);
    } else if (variantId !== "") {
      body.variant_id = variantId;
    } else {
      body.product_id = productId;
    }
    const seq = ++calcSeqRef.current;
    try {
      const data = await calculateMutation.mutateAsync({ data: body });
      // A newer request was issued while this one was in flight — its
      // response owns the result slot; drop the stale one.
      if (seq !== calcSeqRef.current) return;
      setResult(data as unknown as CalculatorResponse);
      setCalcError(null);
    } catch (err: unknown) {
      if (seq !== calcSeqRef.current) return;
      toast({
        title: "خطأ",
        description: describeError(err),
        variant: "destructive",
      });
      // R126-L3 (A2-9 stale-keep): keep the previous result standing —
      // the banner below marks it stale. The old `setResult(null)` was
      // the false-empty half of the finding: a transient gateway error
      // mid-typing collapsed the outputs card to «أدخل سعراً أو اختر
      // منتجاً لرؤية الحساب.» as if the operator had never calculated
      // (the orders/tickets stale-keep precedence, applied here).
      setCalcError(describeError(err));
    }
  }

  // Auto-recalculate when any input changes — ACTUALLY debounced.
  // The previous comment claimed React batching debounced this effect,
  // but batching only coalesces renders, not effect runs: every keystroke
  // fired a full POST /api/admin/pricing/calculate. 300ms of quiet is
  // the standard feel for type-ahead server calls.
  const calculateRef = useRef(calculate);
  calculateRef.current = calculate;
  useEffect(() => {
    if (!canCalculate) return;
    const t = setTimeout(() => calculateRef.current(), 300);
    return () => clearTimeout(t);
  }, [productId, variantId, customPrice, customCost, couponCode, simulateReferred, canCalculate]);

  if (!adminToken) return null;

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="inventory" />;
  }

  return (
    <AdminLayout
      onRefresh={() => {
        void refetchConfig();
        if (canCalculate) void calculate();
      }}
    >
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Page-section header (kept narrow — global admin chrome
            comes from AdminLayout above). */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Calculator className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-xl">التسعير</h1>
            <p className="text-xs text-muted-foreground">
              إعدادات القاعدة العامة + حاسبة أرباح للقراءة فقط تحاكي نظام الطلبات الفعلي.
            </p>
          </div>
        </div>

        {/* ── إعدادات التسعير العامة (WRITES — unlike the calculator) ──
            catalog-recon: the single source of truth for variant pricing:
            cost × (1 + markup%) × rate. Saving the rule does NOT touch
            stored prices — the explicit recompute action below does. */}
        <PricingConfigCard
          configLoading={configLoading}
          configLoadError={configLoadError}
          onRetryConfig={() => void refetchConfig()}
          rateInput={rateInput}
          setRateInput={setRateInput}
          rateValid={rateValid}
          markupInput={markupInput}
          setMarkupInput={setMarkupInput}
          markupValid={markupValid}
          capInput={capInput}
          setCapInput={setCapInput}
          capValid={capValid}
          exampleFactor={exampleFactor}
          exampleRate={exampleRate}
          examplePrice={examplePrice}
          canSaveConfig={canSaveConfig}
          saveConfigPending={saveConfigMutation.isPending}
          onSaveConfig={saveConfig}
          dryRunLoading={dryRunLoading}
          onPreviewRecompute={() => void previewRecompute()}
          recomputePending={recomputeMutation.isPending}
          onRecomputeCatalog={() => void recomputeCatalog()}
        />

        {/* ── R115: the dry-run preview card (Step 1 result) ─────────────
            Counts + the capped BEFORE→AFTER sample straight from
            POST /recompute?dry_run=true — the operator finally sees the
            bulk mutation's impact before approving it (A5 P1-1). */}
        {dryRun && <RecomputePreviewCard dryRun={dryRun} onClosePreview={() => setDryRun(null)} />}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ── INPUTS ─────────────────────────────────────────────── */}
          <CalculatorInputsCard
            productId={productId}
            setProductId={setProductId}
            products={products}
            variantId={variantId}
            setVariantId={setVariantId}
            selectedVariants={selectedVariants}
            customPrice={customPrice}
            setCustomPrice={setCustomPrice}
            customCost={customCost}
            setCustomCost={setCustomCost}
            couponCode={couponCode}
            setCouponCode={setCouponCode}
            simulateReferred={simulateReferred}
            setSimulateReferred={setSimulateReferred}
            result={result}
            onCalculate={calculate}
            canCalculate={canCalculate}
            loading={loading}
          />

          {/* ── OUTPUTS ────────────────────────────────────────────── */}
          <CalculatorOutputsCard result={result} calcError={calcError} />
        </div>

        {/* Footer note */}
        <div className="text-3xs text-muted-foreground text-center pt-2">
          تستخدم الحاسبة منطق نظام الطلبات الفعلي (تخفيضات + كوبونات + ولاء + إحالات). أي تغيير في
          النظام الفعلي يجب أن ينعكس هنا.
        </div>
      </div>

      {/* catalog-recon: styled confirm for the bulk recompute action */}
      <ConfirmDialog />
    </AdminLayout>
  );
}
