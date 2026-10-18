import { useAdminHeaders } from "@/hooks/useAdminHeaders";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
// catalog-recon (2026-09-20): per-product variant manager — the admin twin
// of InventoryUploadDialog (same AppDialog shell, toast idioms and
// useConfirm guard). cost_price/sku are intentionally rendered here: this
// surface is requireAdmin-only by route contract (see backend
// routes/admin/product-variants.ts).
// R137 (FE, closing decomposition): the pure helpers (the form seed, the
// variant formatters, the route-specific error resolver, the submit
// validator and the PATCH/POST body builders) moved to
// @/components/admin/product-variants/variants-meta.ts, and the toolbar /
// add-edit form panel / variant rows surfaces to the sibling extracts.
// This file stays the feature's orchestration + shell — the dialog-local
// form atoms, both queries, the three mutations and the confirm-gated
// delete (the GlobalSearch self-contained-feature precedent) — with the
// exact same named export for pages/admin/products.tsx.
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import {
  EMPTY_FORM,
  VARIANT_COUNT_FORMS,
  describeError,
  round2,
  validateVariantForm,
  variantSubmitBodies,
  variantTitle,
} from "@/components/admin/product-variants/variants-meta";
import { VariantsToolbar } from "@/components/admin/product-variants/VariantsToolbar";
import { VariantFormPanel } from "@/components/admin/product-variants/VariantFormPanel";
import { VariantRows } from "@/components/admin/product-variants/VariantRows";
import { formatCount } from "@/lib/utils";
import {
  getListAdminProductVariantsQueryKey,
  type AdminProductVariant,
  useCreateProductVariant,
  useDeleteProductVariant,
  useGetAdminPricingConfig,
  useListAdminProductVariants,
  useUpdateProductVariant,
} from "@workspace/api-client-react";
import { useState } from "react";

interface ProductVariantsDialogProps {
  productId: number;
  productName: string;
  onClose: () => void;
  /** Fires after EVERY variant mutation — the parent invalidates its
   *  admin-products query so the card list (display price = MIN active
   *  variants + embedded variant rows) refreshes. */
  onChanged: () => void;
}

export function ProductVariantsDialog({
  productId,
  productName,
  onClose,
  onChanged,
}: ProductVariantsDialogProps) {
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const headers = useAdminHeaders();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: variants = [],
    isLoading: variantsLoading,
    isError: variantsError,
    refetch: refetchVariants,
  } = useListAdminProductVariants(productId, {
    query: { queryKey: getListAdminProductVariantsQueryKey(productId) },
    request: { headers },
  });

  // Effective rule (rate + markup) for the live expected-price preview.
  // Stale-by-default TanStack semantics refetch it on every dialog mount.
  const { data: pricingConfig } = useGetAdminPricingConfig({
    request: { headers },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
  };

  // After every write: refresh BOTH surfaces — this dialog's variant list
  // and the caller's product list (display price + variant count badges).
  const refreshAfterMutation = () => {
    void refetchVariants();
    onChanged();
  };

  // R168 (L2): surface the additive R167-D tier-price warnings — one
  // "warning" toast per finding AFTER the success toast (the operator
  // reads write-OK → pricing-caution; the toast shim's warning variant
  // auto-dismisses at 8s). Never blocks the write — it already succeeded.
  const toastTierPriceWarnings = (warnings: { message: string }[] | undefined) => {
    for (const w of warnings ?? []) {
      toast({ title: "تنبيه تسعير", description: w.message, variant: "warning" });
    }
  };

  const createMutation = useCreateProductVariant({
    request: { headers },
    mutation: {
      onSuccess(data) {
        refreshAfterMutation();
        resetForm();
        toast({ title: "تمت إضافة الباقة", variant: "success" });
        toastTierPriceWarnings(data?.warnings);
      },
      onError(err: unknown) {
        toast({
          title: "تعذّرت إضافة الباقة",
          description: describeError(err),
          variant: "destructive",
        });
      },
    },
  });
  const updateMutation = useUpdateProductVariant({
    request: { headers },
    mutation: {
      onSuccess(data) {
        refreshAfterMutation();
        resetForm();
        toast({ title: "تم تحديث الباقة", variant: "success" });
        toastTierPriceWarnings(data?.warnings);
      },
      onError(err: unknown) {
        toast({
          title: "تعذّر تحديث الباقة",
          description: describeError(err),
          variant: "destructive",
        });
      },
    },
  });
  const deleteMutation = useDeleteProductVariant({
    request: { headers },
    mutation: {
      onSuccess(data) {
        refreshAfterMutation();
        toast({ title: data?.message ?? "تم حذف الباقة", variant: "success" });
      },
      onError(err: unknown) {
        // 409 = order-linked variant: the backend's own wording must
        // survive («لا يمكن حذف باقة مرتبطة بطلبات سابقة. عطّلها بدلاً
        // من ذلك.») — describeError prefers it over the generic code map.
        toast({
          title: "تعذّر حذف الباقة",
          description: describeError(err),
          variant: "destructive",
        });
      },
    },
  });

  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  const activeCount = variants.filter((v) => v.is_active).length;

  // ── Live pricing preview (cost × (1+markup) × rate) ───────────────────
  const previewCost = parseFloat(form.cost_price);
  const factor = pricingConfig ? 1 + pricingConfig.markup_percent / 100 : null;
  const rate = pricingConfig?.usd_to_lyd ?? null;
  const expectedPrice =
    factor != null && rate != null && Number.isFinite(previewCost)
      ? round2(previewCost * factor * rate)
      : null;

  // ── Form actions ──────────────────────────────────────────────────────
  const startAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setShowForm(true);
  };

  const startEdit = (v: AdminProductVariant) => {
    setEditingId(v.id);
    setForm({
      plan_label: v.plan_label ?? "",
      duration_label: v.duration_label ?? "",
      duration_days: v.duration_days != null ? String(v.duration_days) : "",
      cost_price: String(v.cost_price),
      // Prefill the price ONLY when an explicit override exists (stored ≠
      // engine output) — otherwise leave it empty so a cost edit keeps
      // pricing automatically (the engine default path).
      price_lyd:
        v.computed_price_lyd != null && Math.abs(v.price_lyd - v.computed_price_lyd) >= 0.005
          ? String(v.price_lyd)
          : "",
      sku: v.sku ?? "",
      sort_order: String(v.sort_order ?? 0),
    });
    setFormError(null);
    setShowForm(true);
  };

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    // R137 (closing): the field gates and the PATCH/POST body construction
    // moved verbatim to variants-meta (validateVariantForm /
    // variantSubmitBodies) — same messages, same order, same bodies.
    const validationError = validateVariantForm(form, editingId);
    if (validationError != null) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    const { update, create } = variantSubmitBodies(form);
    if (editingId != null) {
      updateMutation.mutate({ id: productId, variantId: editingId, data: update });
    } else {
      createMutation.mutate({ id: productId, data: create });
    }
  };

  const toggleActive = (v: AdminProductVariant) => {
    updateMutation.mutate({
      id: productId,
      variantId: v.id,
      data: { is_active: !v.is_active },
    });
  };

  const removeVariant = async (v: AdminProductVariant) => {
    const confirmed = await confirm({
      title: "حذف الباقة؟",
      description: `سيُحذف «${variantTitle(v)}» نهائيًا من هذا المنتج.`,
      confirmLabel: "حذف",
      destructive: true,
    });
    if (!confirmed) return;
    deleteMutation.mutate({ id: productId, variantId: v.id });
  };

  return (
    <>
      <AppDialog
        open
        onOpenChange={(o) => {
          if (!o && !busy) onClose();
        }}
        title="باقات المنتج"
        description={
          <span className="flex items-center gap-1.5">
            <span className="truncate">{productName}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {variants.length === 0
                ? "لا باقات"
                : formatCount(variants.length, VARIANT_COUNT_FORMS)}
            </span>
          </span>
        }
        dismissable={!busy}
        size="wide"
        footer={
          <Button
            variant="outline"
            onClick={onClose}
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            إغلاق
          </Button>
        }
      >
        <AppDialogBody className="space-y-4">
          <VariantsToolbar
            total={variants.length}
            activeCount={activeCount}
            busy={busy}
            startAdd={startAdd}
          />

          {/* Add / edit form (shared panel, same idiom as the page's
              product form — one form, two modes) */}
          {showForm && (
            <VariantFormPanel
              form={form}
              setForm={setForm}
              editingId={editingId}
              formError={formError}
              busy={busy}
              previewCost={previewCost}
              factor={factor}
              rate={rate}
              expectedPrice={expectedPrice}
              submitForm={submitForm}
              resetForm={resetForm}
            />
          )}

          {/* Variant rows */}
          <VariantRows
            variants={variants}
            variantsLoading={variantsLoading}
            variantsError={variantsError}
            busy={busy}
            refetchVariants={refetchVariants}
            startAdd={startAdd}
            startEdit={startEdit}
            toggleActive={toggleActive}
            removeVariant={removeVariant}
          />
        </AppDialogBody>
      </AppDialog>
      <ConfirmDialog />
    </>
  );
}
