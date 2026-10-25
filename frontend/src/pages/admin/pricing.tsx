import { useAdminHeaders } from "@/hooks/useAdminHeaders";
import { useConfirm } from "@/hooks/useConfirm";
// R123 (E3 item 1): the dry-run preview fetch rides the session-aware
// wrapper — a mid-work 401 now gets the global «انتهت الجلسة» toast +
// redirect instead of a local «تعذّرت المعاينة» on a page the operator
// is leaving, and adminFetchJson owns the ok-guard + safe parse.
import { AdminSessionExpiredError, adminFetchJson } from "@/lib/admin-session";
// R123 (E3 P3c): see the configDirty guard below.
import { useDirtyGuard } from "@/hooks/useDirtyGuard";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/useToast";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminPricingConfigQueryKey,
  getListAdminProductsQueryKey,
  useGetAdminPricingConfig,
  useRecomputeCatalogPrices,
  useUpdateAdminPricingConfig,
} from "@workspace/api-client-react";
import { SlidersHorizontal } from "lucide-react";
import { formatCount } from "@/lib/utils";
// R187L-F1: the recompute copy rides the shared plural engine — the
// VARIANT/PRODUCT forms families the variants toolbar + products header
// already carry (the frozen «باقة» + the 1/other-only «منتج» ternary
// miscounted few/many/dual on both the success toast and the preview-
// armed confirm).
import { VARIANT_COUNT_FORMS } from "@/components/admin/product-variants/variants-meta";
import { PRODUCT_COUNT_FORMS } from "@/components/admin/products/products-meta";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the page's self-contained subcomponents and
// pure helpers moved to @/components/admin/pricing/* (verbatim moves —
// the money path, the destructive recompute + its confirm gate, every
// state atom and every handler stay HERE; the extracts render the
// byte-identical DOM they rendered inline yesterday). Import surface:
//   • pricing-format / pricing-errors — the page's pure modules (the
//     grouped-money formatters + round2, the backend-Arabic error
//     resolver)
//   • PricingConfigCard — the WRITABLE «إعدادات التسعير العامة» card
//     (rule inputs, formula explainer, save/preview/recompute toolbar —
//     every write stays a page-owned callback passed down as a prop)
//   • RecomputePreviewCard — the R115 dry-run preview (counts + the
//     BEFORE→AFTER sample table; the preview fetch stays HERE)
// R181: the read-only profit/margin calculator simulator (product/
// variant pickers, coupon + referred simulation, risk badges, the
// waterfall, MarginRow tiers, worst-case + guardrails) is retired with
// its POST /api/admin/pricing/calculate endpoint — this page is now
// the pricing SETTINGS screen the live store actually operates.
import type { RecomputeDryRun } from "@/components/admin/pricing/pricing-types";
import { round2 } from "@/components/admin/pricing/pricing-format";
import { describeError } from "@/components/admin/pricing/pricing-errors";
import { PricingConfigCard } from "@/components/admin/pricing/PricingConfigCard";
import { RecomputePreviewCard } from "@/components/admin/pricing/RecomputePreviewCard";

/**
 * Admin pricing settings (إعدادات التسعير)
 *
 * catalog-recon (2026-09-20): the single source of truth for variant
 * pricing — «إعدادات التسعير العامة» (GET/PUT /api/admin/pricing/config
 * + POST /api/admin/pricing/recompute with its two-step dry-run). The
 * read-only profit/margin simulator that used to share this page was
 * retired in R181; everything here writes or previews the REAL rule the
 * catalog prices flow through: cost × (1 + markup%) × rate.
 */

export default function AdminPricingPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("inventory");
  const [, navigate] = useLocation();
  const { toast } = useToast();

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

  // R186 (C-F4): seed the inputs whenever the operator has NOT edited
  // them. The old seed-once ref made a REMOTE rule change (another
  // admin's save → the shared query key refetches) leave an untouched
  // form reading dirty against the live config — save enabled + the
  // beforeunload armed for a form nobody touched, and a save at that
  // moment silently reverted the other admin's rule. "Dirty" now means
  // OPERATOR edits: a pristine form re-seeds to the remote rule; an
  // edited one keeps the operator's draft (the intent the old comment
  // below already documented). A successful save re-seeds through the
  // raw setters, so the next remote change re-adopts cleanly.
  const inputsTouchedRef = useRef(false);
  useEffect(() => {
    if (inputsTouchedRef.current || !pricingConfig) return;
    setRateInput(String(pricingConfig.usd_to_lyd));
    setMarkupInput(String(pricingConfig.markup_percent));
    setCapInput(String(pricingConfig.max_total_discount_pct));
  }, [pricingConfig]);

  // R186 (C-F4): the setters handed to the card mark the operator's
  // edit ownership (the page's own re-seeds above deliberately keep the
  // form "pristine" so a later remote change can re-adopt it).
  const setRateInputT: Dispatch<SetStateAction<string>> = (v) => {
    inputsTouchedRef.current = true;
    setRateInput(v);
  };
  const setMarkupInputT: Dispatch<SetStateAction<string>> = (v) => {
    inputsTouchedRef.current = true;
    setMarkupInput(v);
  };
  const setCapInputT: Dispatch<SetStateAction<string>> = (v) => {
    inputsTouchedRef.current = true;
    setCapInput(v);
  };

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
        // R186 (C-F4): the committed draft is no longer an operator edit
        // — re-arm the re-seed so the NEXT remote rule change re-adopts
        // instead of re-creating the false-dirty window.
        inputsTouchedRef.current = false;
        setRateInput(String(config.usd_to_lyd));
        setMarkupInput(String(config.markup_percent));
        setCapInput(String(config.max_total_discount_pct));
        // R187E-F3: a save changes the RULE, and the file's own contract
        // below says "a preview is a function of the rule" — drop it so
        // the stale old-rule sample can't linger beside the new rule
        // (the input-seeding effect can't do this: the re-seeded strings
        // match the operator's typed values, so it never re-fires).
        setDryRun(null);
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
        // drop any cached admin products list so the catalog surfaces
        // refetch fresh on their next mount.
        void queryClient.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
        if (result.variants_updated > 0) {
          toast({
            title: "أُعيد احتساب أسعار الكتالوج",
            // R187L-F1: formatCount rides both nouns (the shared
            // VARIANT/PRODUCT forms — was «N باقة» + a 1/other-only
            // منتج ternary).
            description: `حُدّثت أسعار ${formatCount(result.variants_updated, VARIANT_COUNT_FORMS)} عبر ${formatCount(result.products_updated, PRODUCT_COUNT_FORMS)}`,
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
        // R148 (3-errcopy): the file's own resolver (the recompute twin
        // above) — network-level English collapses to Arabic via its
        // getErrorMessage fallback instead of landing raw in the toast.
        description: describeError(err),
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
            ? `المعاينة: ${formatCount(dryRun.variants_drifted, VARIANT_COUNT_FORMS)} ستنحرف عبر ${formatCount(dryRun.products_affected, PRODUCT_COUNT_FORMS)}. `
            : "المعاينة: لا تغييرات — كل الأسعار مطابقة للقاعدة الحالية. "
          : ""
      }سيُعاد حساب سعر كل باقة نشطة من تكلفتها بالقاعدة الحالية — بما فيها الأسعار المخصّصة يدويًا — وتُحدّث أسعار العرض تلقائيًا. لا يمكن التراجع بعد التنفيذ.`,
      confirmLabel: "إعادة الاحتساب",
      destructive: true,
    });
    if (!confirmed) return;
    recomputeMutation.mutate(undefined);
  };

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  if (!adminToken) return null;

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="inventory" />;
  }

  return (
    <AdminLayout onRefresh={() => void refetchConfig()}>
      <div className="max-w-4xl mx-auto space-y-5">
        {/* Page-section header (kept narrow — global admin chrome
            comes from AdminLayout above). R181: the simulator is gone —
            the title and subtitle describe the settings screen that
            remains. */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <SlidersHorizontal className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-xl">إعدادات التسعير</h1>
            <p className="text-xs text-muted-foreground">
              قاعدة التسعير العامة للكتالوج: التكلفة × (1 + نسبة الربح) × سعر الصرف.
            </p>
          </div>
        </div>

        {/* ── إعدادات التسعير العامة (WRITES — the page's whole job) ──
            catalog-recon: the single source of truth for variant pricing:
            cost × (1 + markup%) × rate. Saving the rule does NOT touch
            stored prices — the explicit recompute action below does. */}
        <PricingConfigCard
          configLoading={configLoading}
          configLoadError={configLoadError}
          onRetryConfig={() => void refetchConfig()}
          rateInput={rateInput}
          setRateInput={setRateInputT}
          rateValid={rateValid}
          markupInput={markupInput}
          setMarkupInput={setMarkupInputT}
          markupValid={markupValid}
          capInput={capInput}
          setCapInput={setCapInputT}
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
      </div>

      {/* catalog-recon: styled confirm for the bulk recompute action */}
      <ConfirmDialog />
    </AdminLayout>
  );
}
