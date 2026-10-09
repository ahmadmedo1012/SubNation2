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
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import {
  Calculator,
  AlertTriangle,
  Eye,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Tag,
  Sparkles,
  Info,
  X,
} from "lucide-react";
import { AdminLayout } from "./layout";

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

type RiskState = "SAFE" | "WATCH" | "THIN" | "LOSS";

interface CalculatorResponse {
  inputs: {
    product_id: number | null;
    product_name: string | null;
    variant_id: number | null;
    variant_label: string | null;
    price_source: "variant" | "product_cheapest_variant" | "manual";
    list_price: number;
    cost_price: number | null;
    cost_usd: number | null;
    coupon_code: string | null;
    simulate_referred: boolean;
  };
  config: {
    usd_to_lyd: number;
    markup_percent: number;
    max_total_discount_pct: number;
  };
  flash_sale: { discount_percent: number; title: string } | null;
  coupon: {
    code: string;
    type: "percentage" | "fixed";
    value: number;
    valid: boolean;
    reason_invalid: string | null;
  } | null;
  pricing: {
    list_price: number;
    base_price: number;
    discount_amount: number;
    final_price: number;
  };
  loyalty: {
    points_earned: number;
    lyd_accrued: number;
    points_per_lyd: number;
  };
  referral_cost: {
    welcome_bonus_lyd: number;
    referrer_points: number;
    referrer_lyd_value: number;
    total_referral_cost_lyd: number;
    trigger?: string;
  };
  margins: {
    gross_lyd: number | null;
    gross_pct: number | null;
    net_lyd: number | null;
    net_pct: number | null;
    referral_adjusted_lyd: number | null;
    referral_adjusted_pct: number | null;
  };
  worst_case: {
    combined_discount_pct: number;
    price: number;
    gross_lyd: number | null;
    contribution_lyd: number | null;
    referred_contribution_lyd: number | null;
  };
  guardrails: {
    break_even_price: number | null;
    safe_min_price_incl_program: number | null;
    max_safe_discount_pct: number | null;
  };
  risk_state: RiskState;
  warnings: Array<{
    severity: "loss" | "low_margin" | "info" | "cap";
    code: string;
    message_ar: string;
  }>;
}

/**
 * R115 (Part 15): the recompute dry-run response — POST
 * /api/admin/pricing/recompute?dry_run=true. Counts + a capped
 * BEFORE→AFTER sample per drifted variant, zero writes.
 */
interface RecomputeDryRun {
  dry_run: true;
  variants_drifted: number;
  products_affected: number;
  sample: Array<{
    variant_id: number;
    product_id: number;
    price_before: number;
    price_after: number;
    delta: number;
  }>;
  usd_to_lyd: number;
  markup_percent: number;
  note: string;
}

/** Arabic labels for the risk states (documented thresholds). */
const RISK_STATE_LABEL: Record<RiskState, string> = {
  SAFE: "آمن",
  WATCH: "تحت المراقبة",
  THIN: "هامش ضعيف",
  LOSS: "خسارة",
};

// Never bare colors (A5 Part 15): each state renders WITH its warning
// text — the tone classes below carry the color, riskExplanation()
// supplies the WHY.
const RISK_STATE_TONE: Record<RiskState, string> = {
  SAFE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  WATCH: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  THIN: "border-orange-500/40 bg-orange-500/10 text-orange-500",
  LOSS: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** The WHY next to the badge — the backend's own Arabic warning when one
 *  matches the state, the threshold explainer otherwise. */
function riskExplanation(result: CalculatorResponse): string {
  switch (result.risk_state) {
    case "LOSS":
      return (
        result.warnings.find((w) => w.severity === "loss")?.message_ar ??
        "البيع تحت التكلفة أو صافي الربح سالب بعد التزامات البرنامج."
      );
    case "THIN":
      return (
        result.warnings.find((w) => w.code === "thin_gross_margin")?.message_ar ??
        "هامش الربح الإجمالي أقل من 5%."
      );
    case "WATCH": {
      const noCost = result.warnings.find((w) => w.code === "no_cost_price");
      if (noCost) return noCost.message_ar;
      return (
        result.warnings.find((w) => w.code === "watch_gross_margin")?.message_ar ??
        "هامش الربح الإجمالي أقل من 15%."
      );
    }
    default:
      return "الهامش الإجمالي ضمن النطاق المريح (15% أو أكثر).";
  }
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

/** Same cent-rounding the backend pricing engine applies (round2). */
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Trim trailing zeros for the formula's factor/rate (2, not 2.00). */
function fmtFactor(n: number): string {
  return String(Number(n.toFixed(2)));
}

// catalog-recon: orval/customFetch rejections carry ApiError { data: { error,
// code } }. getErrorMessage() resolves the shared CODE map first (INVALID_DATA
// → generic), which would bury the route's own Arabic wording (e.g. the
// out-of-range PUT message). Prefer the backend's message, then fall back.
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

function describeError(err: unknown): string {
  const data = (err as { data?: { error?: string; message?: string } | null }).data;
  const raw = data?.error ?? data?.message;
  if (typeof raw === "string" && raw.trim() && ARABIC_SCRIPT_RE.test(raw)) return raw;
  return getErrorMessage(err);
}

function MarginRow({
  label,
  lyd,
  pct,
  hint,
}: {
  label: string;
  lyd: number | null;
  pct: number | null;
  hint?: string;
}) {
  const tone =
    lyd == null
      ? "text-muted-foreground"
      : lyd < 0
        ? "text-destructive"
        : pct != null && pct < 5
          ? "text-amber-500"
          : "text-emerald-500";
  const Icon = lyd == null ? Info : lyd < 0 ? TrendingDown : TrendingUp;
  return (
    <div className="flex items-center justify-between py-2.5 px-3 bg-muted/20 border border-border/40 rounded-lg">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone}`} />
        <div>
          <div className="text-xs font-bold">{label}</div>
          {hint && <div className="text-3xs text-muted-foreground">{hint}</div>}
        </div>
      </div>
      <div className={`tabular-nums text-sm font-bold ${tone}`}>
        {lyd == null ? "—" : `${lyd >= 0 ? "+" : ""}${fmt(lyd)} د.ل`}
        {pct != null && (
          <span className="text-3xs font-normal opacity-75 ml-1">({fmt(pct, 1)}%)</span>
        )}
      </div>
    </div>
  );
}

export default function AdminPricingPage() {
  const { adminToken } = useAuth();
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
    query: { queryKey: getGetAdminPricingConfigQueryKey(), enabled: !!adminToken },
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
      enabled: !!adminToken,
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
  const calculateMutation = useAdminPricingCalculate({
    request: { headers },
    mutation: {
      onSuccess: (data) => {
        setResult(data as unknown as CalculatorResponse);
      },
      onError: (err: unknown) => {
        toast({
          title: "خطأ",
          description: describeError(err),
          variant: "destructive",
        });
        setResult(null);
      },
    },
  });
  const loading = calculateMutation.isPending;

  function calculate() {
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
    calculateMutation.mutate({ data: body });
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
            <h1 className="font-bold text-lg">التسعير</h1>
            <p className="text-xs text-muted-foreground">
              إعدادات القاعدة العامة + حاسبة أرباح للقراءة فقط تحاكي نظام الطلبات الفعلي.
            </p>
          </div>
        </div>

        {/* ── إعدادات التسعير العامة (WRITES — unlike the calculator) ──
            catalog-recon: the single source of truth for variant pricing:
            cost × (1 + markup%) × rate. Saving the rule does NOT touch
            stored prices — the explicit recompute action below does. */}
        <div className="bg-card border border-primary/25 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-sm">إعدادات التسعير العامة</h2>
                <p className="text-3xs text-muted-foreground truncate">
                  القاعدة الموحّدة التي تُشتق منها أسعار الباقات من تكلفتها.
                </p>
              </div>
            </div>
            {configLoading ? (
              <Loader2
                className="w-4 h-4 animate-spin text-muted-foreground shrink-0"
                aria-label="جارٍ تحميل الإعدادات"
              />
            ) : configLoadError ? (
              <button
                type="button"
                onClick={() => void refetchConfig()}
                className="text-xs text-destructive underline underline-offset-2 shrink-0"
              >
                إعادة المحاولة
              </button>
            ) : null}
          </div>

          {configLoadError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-xs font-bold flex items-center gap-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              تعذّر تحميل إعدادات التسعير الحالية
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label
                htmlFor="pricing-config-rate"
                className="text-xs font-bold text-muted-foreground mb-1.5 block"
              >
                سعر الصرف — دينار لكل دولار ($1 =)
              </Label>
              <Input
                id="pricing-config-rate"
                type="number"
                min="0.1"
                max="1000"
                step="0.01"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                dir="ltr"
                placeholder="10"
                disabled={configLoading}
              />
              {rateInput !== "" && !rateValid && (
                <p className="text-3xs text-destructive font-bold mt-1" role="alert">
                  سعر الصرف يجب أن يكون بين 0.1 و 1000
                </p>
              )}
            </div>
            <div>
              <Label
                htmlFor="pricing-config-markup"
                className="text-xs font-bold text-muted-foreground mb-1.5 block"
              >
                الهامش على التكلفة (%)
              </Label>
              <Input
                id="pricing-config-markup"
                type="number"
                min="0"
                max="10000"
                step="1"
                value={markupInput}
                onChange={(e) => setMarkupInput(e.target.value)}
                dir="ltr"
                placeholder="100"
                disabled={configLoading}
              />
              {markupInput !== "" && !markupValid && (
                <p className="text-3xs text-destructive font-bold mt-1" role="alert">
                  الهامش يجب أن يكون بين 0 و 10000
                </p>
              )}
            </div>
            <div>
              <Label
                htmlFor="pricing-config-cap"
                className="text-xs font-bold text-muted-foreground mb-1.5 block"
              >
                سقف الخصم المجمّع (%)
              </Label>
              <Input
                id="pricing-config-cap"
                type="number"
                min="10"
                max="95"
                step="1"
                value={capInput}
                onChange={(e) => setCapInput(e.target.value)}
                dir="ltr"
                placeholder="50"
                disabled={configLoading}
              />
              {capInput !== "" && !capValid && (
                <p className="text-3xs text-destructive font-bold mt-1" role="alert">
                  سقف الخصم يجب أن يكون بين 10 و 95
                </p>
              )}
              {/* R115 (policy 7): the stacking guardrail explainer — one
                  line, the break-even intuition included. */}
              <p className="text-3xs text-muted-foreground mt-1 leading-relaxed">
                سقف الخصم المجمّع (تخفيضات + كوبون) — 50% = خط التعادل عند هامش 100%
              </p>
            </div>
          </div>

          {/* Formula explainer — live numbers so the operator sees the
              effect BEFORE saving (defaults: $5 × 2 × 10 = 100 د.ل). */}
          <div className="flex items-start gap-2.5 p-3 bg-muted/20 border border-border/40 rounded-xl">
            <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-2xs leading-relaxed">
              <span className="font-bold">السعر = التكلفة × (1 + الهامش٪) × سعر الصرف</span>
              <span className="text-muted-foreground">
                {" "}
                — مثال: $5 × {fmtFactor(exampleFactor)} × {fmtFactor(exampleRate)} ={" "}
                {formatCurrency(examplePrice)}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={saveConfig}
              disabled={!canSaveConfig || saveConfigMutation.isPending}
              className="bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform"
            >
              {saveConfigMutation.isPending ? (
                <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
              ) : (
                <Save className="w-4 h-4 ml-1.5" />
              )}
              {saveConfigMutation.isPending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
            </Button>
            {/* Step 1 of the two-step recompute (R115): a ZERO-WRITE
                preview — counts + a BEFORE→AFTER sample — before the
                destructive action is even considered. */}
            <Button
              variant="outline"
              onClick={() => void previewRecompute()}
              disabled={dryRunLoading || recomputeMutation.isPending}
              className="text-amber-500 border-amber-500/25 hover:bg-amber-500/10 active:scale-[0.97] transition-transform"
            >
              {dryRunLoading ? (
                <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
              ) : (
                <Eye className="w-4 h-4 ml-1.5" />
              )}
              {dryRunLoading ? "جارٍ المعاينة…" : "معاينة التغييرات"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void recomputeCatalog()}
              disabled={recomputeMutation.isPending || dryRunLoading}
              className="text-primary border-primary/25 hover:bg-primary/10 active:scale-[0.97] transition-transform"
            >
              {recomputeMutation.isPending ? (
                <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 ml-1.5" />
              )}
              {recomputeMutation.isPending ? "جارٍ الاحتساب…" : "إعادة احتساب أسعار الكتالوج"}
            </Button>
            <p className="basis-full text-3xs text-muted-foreground">
              حفظ الإعدادات لا يغيّر الأسعار المخزّنة — «معاينة التغييرات» تعرض الأثر المتوقع دون
              تعديل أي سعر، و«إعادة احتساب أسعار الكتالوج» هي التي تعيد تسعير كل الباقات من تكاليفها
              بالقاعدة الحالية وتُحدّث أسعار العرض.
            </p>
          </div>
        </div>

        {/* ── R115: the dry-run preview card (Step 1 result) ─────────────
            Counts + the capped BEFORE→AFTER sample straight from
            POST /recompute?dry_run=true — the operator finally sees the
            bulk mutation's impact before approving it (A5 P1-1). */}
        {dryRun && (
          <div className="bg-card border border-amber-500/30 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <Eye className="w-4 h-4 text-amber-500" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-sm">معاينة إعادة الاحتساب</h2>
                  <p className="text-3xs text-muted-foreground truncate">
                    معاينة فقط — لم يُعدّل أي سعر بعد
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDryRun(null)}
                aria-label="إغلاق المعاينة"
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {dryRun.variants_drifted > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted/20 border border-border/40 rounded-xl text-center">
                    <div className="font-bold text-lg tabular-nums text-amber-500">
                      {dryRun.variants_drifted}
                    </div>
                    <div className="text-3xs text-muted-foreground">باقة سينحرف سعرها</div>
                  </div>
                  <div className="p-3 bg-muted/20 border border-border/40 rounded-xl text-center">
                    <div className="font-bold text-lg tabular-nums text-amber-500">
                      {dryRun.products_affected}
                    </div>
                    <div className="text-3xs text-muted-foreground">منتجًا يتأثر</div>
                  </div>
                </div>

                <div className="overflow-x-auto border border-border/50 rounded-xl">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/15 text-muted-foreground">
                        <th className="px-3 py-2 text-right font-semibold">الباقة</th>
                        <th className="px-3 py-2 text-right font-semibold">المنتج</th>
                        <th className="px-3 py-2 text-left font-semibold">السعر الحالي</th>
                        <th className="px-3 py-2 text-left font-semibold">السعر الجديد</th>
                        <th className="px-3 py-2 text-left font-semibold">الفرق</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dryRun.sample.map((s) => (
                        <tr key={s.variant_id} className="border-b border-border/30 last:border-0">
                          <td className="px-3 py-2 tabular-nums" dir="ltr">
                            #{s.variant_id}
                          </td>
                          <td className="px-3 py-2 tabular-nums" dir="ltr">
                            #{s.product_id}
                          </td>
                          <td className="px-3 py-2 tabular-nums" dir="ltr">
                            {fmt(s.price_before)} د.ل
                          </td>
                          <td className="px-3 py-2 tabular-nums font-bold" dir="ltr">
                            {fmt(s.price_after)} د.ل
                          </td>
                          <td
                            className={`px-3 py-2 tabular-nums font-bold ${
                              s.delta >= 0 ? "text-emerald-500" : "text-destructive"
                            }`}
                            dir="ltr"
                          >
                            {s.delta >= 0 ? "+" : ""}
                            {fmt(s.delta)} د.ل
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-3xs text-muted-foreground leading-relaxed">
                  {dryRun.sample.length >= 25
                    ? `عينة أول 25 باقة من أصل ${dryRun.variants_drifted} — `
                    : ""}
                  {dryRun.note} التطبيق الفعلي يتم عبر «إعادة احتساب أسعار الكتالوج» أعلاه.
                </p>
              </>
            ) : (
              <p className="text-2xs text-muted-foreground leading-relaxed">
                كل الأسعار مطابقة للقاعدة الحالية — لا تغييرات عند التطبيق.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* ── INPUTS ─────────────────────────────────────────────── */}
          <div className="bg-card border border-border/55 rounded-2xl p-5 space-y-4">
            <h2 className="font-bold text-sm flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" /> المدخلات
            </h2>

            {/* Product picker */}
            <div>
              <Label
                htmlFor="pricing-calc-product"
                className="text-xs font-bold text-muted-foreground mb-1.5 block"
              >
                المنتج
              </Label>
              <select
                id="pricing-calc-product"
                value={productId === "custom" ? "custom" : String(productId)}
                onChange={(e) => {
                  setProductId(e.target.value === "custom" ? "custom" : Number(e.target.value));
                  // A variant choice belongs to the previous product —
                  // always reset to the auto (cheapest-active) mode.
                  setVariantId("");
                }}
                className="w-full bg-muted/20 border border-border/55 rounded-xl px-3 py-2 text-sm"
              >
                <option value="custom">— سعر مخصّص (للاختبار) —</option>
                {products.map((p) => {
                  const cp = (p as { cost_price?: number | null }).cost_price;
                  return (
                    <option key={p.id} value={p.id}>
                      {/* 96-F7 (R96 A6 #18): formatCurrency — the manual
                          toFixed(2) skipped thousands grouping (the
                          established money convention, see utils.ts). */}
                      {p.name} — {formatCurrency(p.price)}
                      {cp != null ? ` (تكلفة ${formatCurrency(cp)})` : " (تكلفة غير محددة)"}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* R115 (Part 13): the variant selector — the sellable unit
                checkout charges (variant.price_lyd). "" keeps the
                product's cheapest ACTIVE variant (the old product-level
                simulation), now labeled as such by the backend. */}
            {productId !== "custom" && (
              <div>
                <Label
                  htmlFor="pricing-calc-variant"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block"
                >
                  الباقة (الخيار الفعلي عند الدفع)
                </Label>
                <select
                  id="pricing-calc-variant"
                  value={variantId === "" ? "" : String(variantId)}
                  onChange={(e) =>
                    setVariantId(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className="w-full bg-muted/20 border border-border/55 rounded-xl px-3 py-2 text-sm"
                  disabled={selectedVariants.length === 0}
                >
                  <option value="">تلقائي — أرخص باقة نشطة</option>
                  {selectedVariants.map((v) => {
                    const label =
                      [v.plan_label, v.duration_label].filter(Boolean).join(" — ") ||
                      `باقة #${v.id}`;
                    return (
                      <option key={v.id} value={v.id}>
                        {label} — {formatCurrency(v.price_lyd)}
                        {!v.is_active ? " (غير فعّالة)" : ""}
                      </option>
                    );
                  })}
                </select>
                {selectedVariants.length === 0 && (
                  <p className="text-3xs text-amber-500 mt-1">
                    لا باقات لهذا المنتج — اختر منتجًا آخر أو استخدم السعر المخصّص.
                  </p>
                )}
              </div>
            )}

            {/* Custom price + cost (only when "custom") */}
            {productId === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label
                    htmlFor="pricing-calc-price"
                    className="text-xs font-bold text-muted-foreground mb-1.5 block"
                  >
                    السعر (د.ل)
                  </Label>
                  <Input
                    id="pricing-calc-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    placeholder="0.00"
                    dir="ltr"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="pricing-calc-cost"
                    className="text-xs font-bold text-muted-foreground mb-1.5 block"
                  >
                    التكلفة (د.ل)
                  </Label>
                  <Input
                    id="pricing-calc-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={customCost}
                    onChange={(e) => setCustomCost(e.target.value)}
                    placeholder="0.00"
                    dir="ltr"
                  />
                </div>
              </div>
            )}

            {/* Coupon code */}
            <div>
              <Label
                htmlFor="pricing-calc-coupon"
                className="text-xs font-bold text-muted-foreground mb-1.5 block"
              >
                {/* 93-C7 / C-UX5 (A11 top-20 #5): كود/رمز unification —
                    "رمز" is the canonical word for the coupon field
                    (matches admin/coupons.tsx + the backend message). */}
                رمز الكوبون (اختياري)
              </Label>
              <Input
                id="pricing-calc-coupon"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="WELCOME10"
                dir="ltr"
              />
            </div>

            {/* Simulate referred */}
            <div className="flex items-center justify-between p-3 bg-muted/20 border border-border/40 rounded-lg">
              <div>
                <div className="text-xs font-bold">محاكاة مشتري مُحال</div>
                <div className="text-3xs text-muted-foreground">
                  {/* R115: the numbers come from the API response
                      (result.referral_cost) — never a frozen «5 د.ل +
                      0.50» constant; before the first calculation the
                      hint describes the mechanics without inventing
                      values. */}
                  {result
                    ? `يحسم ${fmt(result.referral_cost.welcome_bonus_lyd)} د.ل مكافأة الترحيب + ${fmt(
                        result.referral_cost.referrer_lyd_value,
                      )} د.ل قيمة نقاط المُحيل`
                    : "تُخصم مكافأة الترحيب للمُحال وقيمة نقاط المُحيل من الربح"}
                </div>
              </div>
              <Switch checked={simulateReferred} onCheckedChange={setSimulateReferred} />
            </div>

            <Button onClick={calculate} disabled={!canCalculate || loading} className="w-full">
              {loading ? "جارٍ الحساب…" : "إعادة الحساب"}
            </Button>
          </div>

          {/* ── OUTPUTS ────────────────────────────────────────────── */}
          <div className="bg-card border border-border/55 rounded-2xl p-5 space-y-3">
            <h2 className="font-bold text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> النتائج
            </h2>

            {!result ? (
              <p className="text-xs text-muted-foreground py-8 text-center">
                أدخل سعراً أو اختر منتجاً لرؤية الحساب.
              </p>
            ) : (
              <>
                {/* R115 (Part 15): the risk state badge — NEVER a bare
                    color: the state tone carries the color and the WHY
                    text (backend warning when one matches, threshold
                    explainer otherwise) rides right under it. */}
                <div
                  className={`flex items-start gap-2.5 p-3 border rounded-xl ${RISK_STATE_TONE[result.risk_state]}`}
                  data-risk-state={result.risk_state}
                >
                  {result.risk_state === "LOSS" || result.risk_state === "THIN" ? (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : result.risk_state === "WATCH" ? (
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">
                        {RISK_STATE_LABEL[result.risk_state]}
                      </span>
                      {result.inputs.variant_label && (
                        <span className="text-3xs font-semibold opacity-80 truncate">
                          {result.inputs.variant_label}
                        </span>
                      )}
                    </div>
                    <p className="text-2xs leading-relaxed mt-0.5">{riskExplanation(result)}</p>
                  </div>
                </div>

                {/* Pricing waterfall */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">السعر المعروض</span>
                    <span className="tabular-nums font-bold">
                      {fmt(result.pricing.list_price)} د.ل
                    </span>
                  </div>
                  {result.flash_sale && (
                    <div className="flex justify-between py-1 text-amber-500">
                      <span>↳ تخفيضات الموقع ({result.flash_sale.discount_percent}%)</span>
                      <span className="tabular-nums">{fmt(result.pricing.base_price)} د.ل</span>
                    </div>
                  )}
                  {result.coupon && result.coupon.valid && (
                    <div className="flex justify-between py-1 text-violet-500">
                      <span>
                        ↳ كوبون {result.coupon.code} (
                        {result.coupon.type === "percentage"
                          ? `${result.coupon.value}%`
                          : `−${fmt(result.coupon.value)}`}
                        )
                      </span>
                      <span className="tabular-nums">
                        −{fmt(result.pricing.discount_amount)} د.ل
                      </span>
                    </div>
                  )}
                  {result.coupon && !result.coupon.valid && (
                    <div className="flex justify-between py-1 text-destructive text-3xs">
                      <span>⚠️ كوبون غير صالح</span>
                      <span>{result.coupon.reason_invalid}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 border-t border-border/40 mt-2">
                    <span className="font-bold">السعر النهائي</span>
                    <span className="tabular-nums font-bold text-primary text-base">
                      {fmt(result.pricing.final_price)} د.ل
                    </span>
                  </div>
                </div>

                <div className="border-t border-border/40 pt-3 space-y-2">
                  <MarginRow
                    label="الربح الإجمالي"
                    hint="السعر النهائي ناقص التكلفة"
                    lyd={result.margins.gross_lyd}
                    pct={result.margins.gross_pct}
                  />
                  <MarginRow
                    label="الربح الصافي"
                    hint={`بعد ${result.loyalty.points_earned} نقطة ولاء (~${fmt(result.loyalty.lyd_accrued)} د.ل)`}
                    lyd={result.margins.net_lyd}
                    pct={result.margins.net_pct}
                  />
                  {result.inputs.simulate_referred && (
                    <MarginRow
                      label="الربح بعد تكلفة الإحالة"
                      hint={`بعد ${fmt(result.referral_cost.total_referral_cost_lyd)} د.ل (مكافأة ترحيب + نقاط مُحيل)`}
                      lyd={result.margins.referral_adjusted_lyd}
                      pct={result.margins.referral_adjusted_pct}
                    />
                  )}
                </div>

                {/* R115 (Part 15): the worst-case block — the deepest
                    discount stack the CURRENT config allows (active
                    flash + a coupon up to the remaining cap headroom) on
                    the same cost base. Answers "how bad can an allowed
                    combination get?" before the operator ever creates
                    one. */}
                <div className="border-t border-border/40 pt-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingDown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <h3 className="text-xs font-bold">
                      أسوأ حالة — أعمق خصم مسموح ({result.worst_case.combined_discount_pct}%)
                    </h3>
                  </div>
                  <div className="space-y-1 text-2xs">
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">السعر عند السقف</span>
                      <span className="tabular-nums font-bold" dir="ltr">
                        {fmt(result.worst_case.price)} د.ل
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">الربح الإجمالي</span>
                      <span
                        className={`tabular-nums font-bold ${
                          result.worst_case.gross_lyd == null
                            ? "text-muted-foreground"
                            : result.worst_case.gross_lyd < 0
                              ? "text-destructive"
                              : ""
                        }`}
                        dir="ltr"
                      >
                        {result.worst_case.gross_lyd == null
                          ? "—"
                          : `${result.worst_case.gross_lyd >= 0 ? "+" : ""}${fmt(result.worst_case.gross_lyd)} د.ل`}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">المساهمة بعد نقاط الولاء</span>
                      <span
                        className={`tabular-nums font-bold ${
                          result.worst_case.contribution_lyd == null
                            ? "text-muted-foreground"
                            : result.worst_case.contribution_lyd < 0
                              ? "text-destructive"
                              : ""
                        }`}
                        dir="ltr"
                      >
                        {result.worst_case.contribution_lyd == null
                          ? "—"
                          : `${result.worst_case.contribution_lyd >= 0 ? "+" : ""}${fmt(result.worst_case.contribution_lyd)} د.ل`}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">المساهمة بعد تكلفة الإحالة</span>
                      <span
                        className={`tabular-nums font-bold ${
                          result.worst_case.referred_contribution_lyd == null
                            ? "text-muted-foreground"
                            : result.worst_case.referred_contribution_lyd < 0
                              ? "text-destructive"
                              : ""
                        }`}
                        dir="ltr"
                      >
                        {result.worst_case.referred_contribution_lyd == null
                          ? "—"
                          : `${result.worst_case.referred_contribution_lyd >= 0 ? "+" : ""}${fmt(result.worst_case.referred_contribution_lyd)} د.ل`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* R115 (Part 15): the guardrails block — break-even,
                    the program-inclusive safe minimum, and the max safe
                    discount at the current price. */}
                <div className="border-t border-border/40 pt-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Shield className="w-3.5 h-3.5 text-primary shrink-0" />
                    <h3 className="text-xs font-bold">حدود الأمان</h3>
                  </div>
                  <div className="space-y-1 text-2xs">
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">سعر التعادل (التكلفة)</span>
                      <span className="tabular-nums font-bold" dir="ltr">
                        {result.guardrails.break_even_price == null
                          ? "—"
                          : `${fmt(result.guardrails.break_even_price)} د.ل`}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">
                        الحد الأدنى الآمن (شامل الولاء والإحالة)
                      </span>
                      <span className="tabular-nums font-bold" dir="ltr">
                        {result.guardrails.safe_min_price_incl_program == null
                          ? "—"
                          : `${fmt(result.guardrails.safe_min_price_incl_program)} د.ل`}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">أقصى خصم آمن على السعر الحالي</span>
                      <span className="tabular-nums font-bold" dir="ltr">
                        {result.guardrails.max_safe_discount_pct == null
                          ? "—"
                          : `${fmt(result.guardrails.max_safe_discount_pct, 1)}%`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* R115: the applied config line — the operator sees
                    WHICH rule produced these numbers (incl. the discount
                    cap that bounds the worst-case above). */}
                <p className="text-3xs text-muted-foreground border-t border-border/40 pt-2 leading-relaxed">
                  القاعدة المطبَّقة: 1$ = {fmt(result.config.usd_to_lyd)} د.ل · هامش{" "}
                  {fmtFactor(result.config.markup_percent)}% · سقف الخصم المجمّع{" "}
                  {result.config.max_total_discount_pct}%
                </p>

                {/* Warnings */}
                {result.warnings.length > 0 && (
                  <div className="border-t border-border/40 pt-3 space-y-2">
                    {result.warnings.map((w, i) => {
                      const tone =
                        w.severity === "loss"
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : w.severity === "low_margin"
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                            : w.severity === "cap"
                              ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                              : "border-blue-500/40 bg-blue-500/10 text-blue-400";
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-2 p-2.5 border rounded-lg text-2xs ${tone}`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span className="font-semibold">{w.message_ar}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
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
