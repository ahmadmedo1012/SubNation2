import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
// catalog-recon (2026-09-20): per-product variant manager — the admin twin
// of InventoryUploadDialog (same AppDialog shell, toast idioms and
// useConfirm guard). cost_price/sku are intentionally rendered here: this
// surface is requireAdmin-only by route contract (see backend
// routes/admin/product-variants.ts).
import { AppDialog, AppDialogBody } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { getErrorMessage } from "@/lib/errors";
import { formatCount, formatCurrency } from "@/lib/utils";
import {
  getListAdminProductVariantsQueryKey,
  type AdminProductVariant,
  type CreateVariantBody,
  type UpdateVariantBody,
  useCreateProductVariant,
  useDeleteProductVariant,
  useGetAdminPricingConfig,
  useListAdminProductVariants,
  useUpdateProductVariant,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Edit2,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Plus,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
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

const EMPTY_FORM = {
  plan_label: "",
  duration_label: "",
  duration_days: "",
  cost_price: "",
  price_lyd: "",
  sku: "",
  sort_order: "",
};

/** Same cent-rounding the backend pricing engine applies (round2). */
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** $-money display for the internal USD cost column (admin-only field). */
function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Trim trailing zeros for the live-pricing factor/rate (2, not 2.00). */
function fmtFactor(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** «plan — duration» display title for a variant row. */
function variantTitle(v: { plan_label?: string | null; duration_label?: string | null }): string {
  const parts = [v.plan_label?.trim(), v.duration_label?.trim()].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" — ") : "باقة";
}

// catalog-recon: orval/customFetch rejections carry ApiError { data: { error,
// code } }. getErrorMessage() resolves the shared CODE map first (CONFLICT →
// generic «تعارض في العملية»), which would bury the route-specific wording
// the variant endpoints author — e.g. the order-guarded DELETE 409 («عطّلها
// بدلاً من ذلك»). Prefer the backend's own Arabic message, then fall back.
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

function describeError(err: unknown): string {
  const data = (err as { data?: { error?: string; message?: string } | null }).data;
  const raw = data?.error ?? data?.message;
  if (typeof raw === "string" && raw.trim() && ARABIC_SCRIPT_RE.test(raw)) return raw;
  return getErrorMessage(err);
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

  const createMutation = useCreateProductVariant({
    request: { headers },
    mutation: {
      onSuccess() {
        refreshAfterMutation();
        resetForm();
        toast({ title: "تمت إضافة الباقة", variant: "success" });
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
      onSuccess() {
        refreshAfterMutation();
        resetForm();
        toast({ title: "تم تحديث الباقة", variant: "success" });
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
    const plan = form.plan_label.trim();
    const duration = form.duration_label.trim();
    if (!plan && !duration) {
      setFormError("يجب تحديد اسم الباقة أو المدة على الأقل");
      return;
    }
    const cost = parseFloat(form.cost_price);
    if (!Number.isFinite(cost) || cost < 0.01 || cost > 100_000) {
      setFormError("التكلفة بالدولار مطلوبة (0.01 - 100,000)");
      return;
    }
    const price = form.price_lyd.trim();
    if (editingId != null && price !== "") {
      const p = parseFloat(price);
      if (!Number.isFinite(p) || p < 0.01 || p > 1_000_000) {
        setFormError("السعر غير صالح (0.01 - 1,000,000)");
        return;
      }
    }
    const days = form.duration_days.trim();
    if (days !== "") {
      const d = parseInt(days, 10);
      if (!Number.isFinite(d) || d < 0) {
        setFormError("أيام المدة يجب أن تكون رقمًا موجبًا");
        return;
      }
    }
    const sort = form.sort_order.trim();
    if (sort !== "") {
      const s = parseInt(sort, 10);
      if (!Number.isFinite(s) || s < 0) {
        setFormError("الترتيب يجب أن يكون رقمًا موجبًا");
        return;
      }
    }
    setFormError(null);

    if (editingId != null) {
      // PATCH semantics: cost without price_lyd → engine repricing; an
      // empty sku string clears it (backend ignores non-string sku).
      const data: UpdateVariantBody = {
        plan_label: plan || null,
        duration_label: duration || null,
        cost_price: round2(cost),
        duration_days: days !== "" ? parseInt(days, 10) : null,
        sku: form.sku.trim(),
        sort_order: sort !== "" ? parseInt(sort, 10) : 0,
      };
      if (price !== "") data.price_lyd = round2(parseFloat(price));
      updateMutation.mutate({ id: productId, variantId: editingId, data });
    } else {
      // POST: price always derives from cost via the engine (no override
      // from the add form — the live preview above shows it pre-save).
      const data: CreateVariantBody = {
        plan_label: plan || null,
        duration_label: duration || null,
        cost_price: round2(cost),
        duration_days: days !== "" ? parseInt(days, 10) : null,
        sku: form.sku.trim() || null,
        sort_order: sort !== "" ? parseInt(sort, 10) : 0,
      };
      createMutation.mutate({ id: productId, data });
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
                : formatCount(variants.length, {
                    one: "باقة",
                    two: "باقتان",
                    few: "باقات",
                    many: "باقة",
                    other: "باقة",
                  })}
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
          {/* Toolbar: counts + add entry point */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground flex items-center gap-2 min-w-0">
              <span className="shrink-0">
                {formatCount(variants.length, {
                  one: "باقة",
                  two: "باقتان",
                  few: "باقات",
                  many: "باقة",
                  other: "باقة",
                })}
              </span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" aria-hidden="true" />
              <span className="shrink-0">{activeCount} نشطة</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" aria-hidden="true" />
              {/* Display-price rule so the operator understands why the
                  product card price moves after variant edits. */}
              <span className="truncate">سعر عرض المنتج = أرخص باقة نشطة</span>
            </div>
            <Button
              size="sm"
              onClick={startAdd}
              disabled={busy}
              className="h-8 text-xs bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform"
            >
              <Plus className="w-3.5 h-3.5 ml-1" /> إضافة باقة
            </Button>
          </div>

          {/* Add / edit form (shared panel, same idiom as the page's
              product form — one form, two modes) */}
          {showForm && (
            <div className="bg-muted/15 border border-primary/20 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  {editingId != null ? "تعديل الباقة" : "إضافة باقة جديدة"}
                </h3>
                <button
                  type="button"
                  onClick={resetForm}
                  aria-label="إغلاق نموذج الباقة"
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <form onSubmit={submitForm} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* R125-I3 (A2-4): every form field carries a real htmlFor↔id
                    pair — the R124-I5 label pass covered the pages/ forms
                    but this dialog (the catalog's second-biggest money
                    form, in components/admin/) was outside that sweep. */}
                <div>
                  <Label
                    htmlFor="variant-form-plan-label"
                    className="text-xs font-bold text-muted-foreground mb-1.5 block"
                  >
                    اسم الباقة
                  </Label>
                  <Input
                    id="variant-form-plan-label"
                    value={form.plan_label}
                    onChange={(e) => setForm((f) => ({ ...f, plan_label: e.target.value }))}
                    maxLength={120}
                    placeholder="مثال: Premium 4K"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="variant-form-duration-label"
                    className="text-xs font-bold text-muted-foreground mb-1.5 block"
                  >
                    المدة
                  </Label>
                  <Input
                    id="variant-form-duration-label"
                    value={form.duration_label}
                    onChange={(e) => setForm((f) => ({ ...f, duration_label: e.target.value }))}
                    maxLength={120}
                    placeholder="مثال: شهر واحد"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="variant-form-duration-days"
                    className="text-xs font-bold text-muted-foreground mb-1.5 block"
                  >
                    أيام المدة (اختياري)
                  </Label>
                  <Input
                    id="variant-form-duration-days"
                    type="number"
                    min="0"
                    step="1"
                    value={form.duration_days}
                    onChange={(e) => setForm((f) => ({ ...f, duration_days: e.target.value }))}
                    dir="ltr"
                    placeholder="30"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="variant-form-cost-price"
                    className="text-xs font-bold text-muted-foreground mb-1.5 block"
                  >
                    التكلفة بالدولار ($) *
                  </Label>
                  <Input
                    id="variant-form-cost-price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.cost_price}
                    onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))}
                    required
                    dir="ltr"
                    placeholder="3.99"
                  />
                  <p className="text-3xs mt-1 text-muted-foreground">
                    داخلية للإدارة فقط — لا تظهر للمستخدم.
                  </p>
                </div>
                {editingId != null && (
                  <div>
                    <Label
                      htmlFor="variant-form-price-lyd"
                      className="text-xs font-bold text-muted-foreground mb-1.5 block flex items-center gap-2"
                    >
                      السعر (د.ل)
                      <span className="text-3xs font-normal text-muted-foreground/70">
                        اتركه فارغًا ليُحسب من التكلفة
                      </span>
                    </Label>
                    <Input
                      id="variant-form-price-lyd"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={form.price_lyd}
                      onChange={(e) => setForm((f) => ({ ...f, price_lyd: e.target.value }))}
                      dir="ltr"
                      placeholder={expectedPrice != null ? String(expectedPrice) : "تلقائي"}
                    />
                  </div>
                )}
                <div>
                  <Label
                    htmlFor="variant-form-sku"
                    className="text-xs font-bold text-muted-foreground mb-1.5 block"
                  >
                    SKU (اختياري)
                  </Label>
                  <Input
                    id="variant-form-sku"
                    value={form.sku}
                    onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                    maxLength={160}
                    dir="ltr"
                    placeholder="netflix|1 Month"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="variant-form-sort-order"
                    className="text-xs font-bold text-muted-foreground mb-1.5 block"
                  >
                    الترتيب
                  </Label>
                  <Input
                    id="variant-form-sort-order"
                    type="number"
                    min="0"
                    step="1"
                    value={form.sort_order}
                    onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                    dir="ltr"
                    placeholder="0"
                  />
                </div>

                {/* Live expected price — the engine formula with the
                    CURRENT rule, before any save. */}
                {expectedPrice != null && factor != null && rate != null && (
                  <div className="sm:col-span-2 flex items-center justify-between px-3 py-2.5 bg-primary/8 border border-primary/20 rounded-lg">
                    <span className="text-2xs text-muted-foreground">
                      السعر المتوقع (يُحسب تلقائيًا)
                    </span>
                    <span className="text-xs font-bold text-primary tabular-nums">
                      {fmtUsd(Number.isFinite(previewCost) ? previewCost : 0)} × {fmtFactor(factor)}{" "}
                      × {fmtFactor(rate)} = {formatCurrency(expectedPrice)}
                    </span>
                  </div>
                )}

                {formError && (
                  <p
                    role="alert"
                    className="sm:col-span-2 text-2xs font-bold text-destructive flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {formError}
                  </p>
                )}

                <div className="sm:col-span-2 flex gap-3 justify-end pt-1 border-t border-border/60">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                    disabled={busy}
                    className="h-9 active:scale-[0.97] transition-transform"
                  >
                    إلغاء
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy}
                    className="h-9 bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 ml-1.5 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 ml-1.5" />
                    )}
                    {editingId != null ? "حفظ التعديلات" : "إضافة الباقة"}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Variant rows */}
          {variantsLoading ? (
            <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-xs">جارٍ تحميل الباقات…</span>
            </div>
          ) : variantsError ? (
            <div
              role="alert"
              className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
            >
              <WifiOff className="w-4 h-4 shrink-0" />
              <span className="min-w-0">تعذّر تحميل الباقات</span>
              <button
                type="button"
                onClick={() => void refetchVariants()}
                className="ms-auto text-xs underline underline-offset-2 hover:opacity-80 shrink-0"
              >
                إعادة المحاولة
              </button>
            </div>
          ) : variants.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground border border-dashed border-border/60 rounded-xl">
              <Layers className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-bold mb-1">لا توجد باقات بعد</p>
              <p className="text-xs mb-4">أضف أول باقة ليُسعّر المنتج تلقائيًا من تكلفتها.</p>
              <Button
                size="sm"
                onClick={startAdd}
                className="bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform"
              >
                <Plus className="w-3.5 h-3.5 ml-1" /> إضافة باقة
              </Button>
            </div>
          ) : (
            <div className="bg-card border border-border/55 rounded-xl overflow-x-auto">
              <table className="w-full text-2xs min-w-[680px]">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">
                      الباقة
                    </th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">
                      التكلفة
                    </th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">
                      السعر
                    </th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">
                      المحسوب
                    </th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">
                      SKU
                    </th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">
                      الترتيب
                    </th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">
                      الحالة
                    </th>
                    <th scope="col" className="text-right font-bold px-2 py-1.5">
                      إجراءات
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => {
                    // Engine drift: the stored price no longer matches what
                    // the CURRENT rule would price (yellow alert per spec).
                    const drift =
                      v.computed_price_lyd != null &&
                      Math.abs(v.price_lyd - v.computed_price_lyd) >= 0.005;
                    return (
                      <tr
                        key={v.id}
                        className={`border-t border-border/30 ${
                          !v.is_active ? "opacity-55" : "hover:bg-muted/10"
                        }`}
                      >
                        <td className="px-2 py-2">
                          <div className="font-bold">{variantTitle(v)}</div>
                          {v.duration_days != null && (
                            <div className="text-3xs text-muted-foreground">
                              {formatCount(v.duration_days, {
                                one: "يوم",
                                two: "يومان",
                                few: "أيام",
                                many: "يومًا",
                                other: "يوم",
                              })}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 tabular-nums font-mono" dir="ltr">
                          {fmtUsd(v.cost_price)}
                        </td>
                        <td className="px-2 py-2 font-bold tabular-nums">
                          {formatCurrency(v.price_lyd)}
                        </td>
                        <td className="px-2 py-2">
                          {v.computed_price_lyd == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : drift ? (
                            <span
                              className="inline-flex items-center gap-1 text-3xs font-bold text-amber-500 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded tabular-nums"
                              title={`السعر المحسوب بالإعدادات الحالية (${formatCurrency(
                                v.computed_price_lyd,
                              )}) يختلف عن المخزّن — عدّل السعر/التكلفة أو أعد الاحتساب من صفحة التسعير`}
                            >
                              <AlertTriangle className="w-3 h-3" />
                              {formatCurrency(v.computed_price_lyd)}
                            </span>
                          ) : (
                            <span
                              className="text-muted-foreground tabular-nums"
                              title="مطابق للسعر المخزّن"
                            >
                              {formatCurrency(v.computed_price_lyd)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 max-w-[130px]">
                          {v.sku ? (
                            <span
                              className="block truncate font-mono text-3xs text-foreground/80"
                              dir="ltr"
                              title={v.sku}
                            >
                              {v.sku}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">
                          {v.sort_order}
                        </td>
                        <td className="px-2 py-2">
                          {v.is_active ? (
                            <StatusBadge variant="success" size="xs">
                              نشطة
                            </StatusBadge>
                          ) : (
                            <StatusBadge variant="neutral" size="xs">
                              معطّلة
                            </StatusBadge>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(v)}
                              disabled={busy}
                              aria-label={`تعديل باقة ${variantTitle(v)}`}
                              title="تعديل الباقة"
                              className="h-8 min-w-8 px-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleActive(v)}
                              disabled={busy}
                              aria-label={
                                v.is_active
                                  ? `تعطيل باقة ${variantTitle(v)}`
                                  : `تفعيل باقة ${variantTitle(v)}`
                              }
                              title={v.is_active ? "تعطيل الباقة" : "تفعيل الباقة"}
                              className="h-8 min-w-8 px-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                            >
                              {v.is_active ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeVariant(v)}
                              disabled={busy}
                              aria-label={`حذف باقة ${variantTitle(v)}`}
                              title="حذف الباقة"
                              className="h-8 min-w-8 px-2 rounded-lg text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AppDialogBody>
      </AppDialog>
      <ConfirmDialog />
    </>
  );
}
