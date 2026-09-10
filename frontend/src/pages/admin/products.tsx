import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { StockoutRiskPanel } from "@/components/admin/forecast/StockoutRiskPanel";
import { InventoryUploadDialog } from "@/components/admin/InventoryUploadDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// 93-C7 / C-UX2 (A12 B9): product inactive/out-of-stock pills migrate
// from a square rounded/raw-orange tuple to the canonical StatusBadge
// (neutral / low-stock tones on the --status-* tokens).
import { StatusBadge } from "@/components/ui/status-badge";
// 93-C7 / C-UX3 (A12 §1.3 + §11.2): the bulk-archive window.confirm is
// replaced by the shared styled confirm.
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { categoryLabel, formatCurrency } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAdminProductsQueryKey,
  type AdminProduct,
  useCreateProduct,
  useDeleteProduct,
  useListAdminProducts,
  useUpdateProduct,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  Archive,
  CheckCircle,
  CheckSquare,
  Edit2,
  Eye,
  EyeOff,
  Package,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Upload,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

const EMPTY_FORM = {
  name: "",
  description: "",
  image_url: "",
  price: "",
  cost_price: "",
  category: "",
  usage_terms: "",
  is_active: true,
};

const CATEGORY_INITIAL_COLOR: Record<string, string> = {
  streaming: "bg-violet-500/20 text-violet-300",
  music: "bg-emerald-500/20 text-emerald-300",
  gaming: "bg-blue-500/20 text-blue-300",
  productivity: "bg-amber-500/20 text-amber-300",
};

const CATEGORY_OPTIONS = [
  { value: "", label: "اختر الفئة" },
  { value: "streaming", label: "بث مباشر" },
  { value: "music", label: "موسيقى" },
  { value: "gaming", label: "ألعاب" },
  { value: "productivity", label: "إنتاجية" },
];

const CATEGORY_FILTERS = [
  { value: "", label: "الكل" },
  { value: "streaming", label: "بث مباشر" },
  { value: "music", label: "موسيقى" },
  { value: "gaming", label: "ألعاب" },
  { value: "productivity", label: "إنتاجية" },
];

function InlineStockEdit({
  productId,
  current,
  onDone,
}: {
  productId: number;
  current: number;
  onDone: () => void;
}) {
  const jsonHeaders = useAdminHeaders({ json: true });
  const { toast } = useToast();
  const [val, setVal] = useState(String(current));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = parseInt(val);
    if (isNaN(n) || n === current) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      // Stock edits are money-adjacent: a silent catch() here meant a
      // failed save looked identical to a successful one.
      const res = await fetch(`/api/admin/products/${productId}/inventory/set-count`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ count: n }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        // Round-4 (org §6a): route through getErrorMessage so the
        // backend `code` maps to Arabic; raw error/message stay fallback.
        throw new Error(getErrorMessage(err) || `فشل الحفظ (${res.status})`);
      }
      toast({ title: "تم تحديث المخزون", variant: "success" });
    } catch (e) {
      toast({
        title: "تعذّر تحديث المخزون",
        description: e instanceof Error ? e.message : "خطأ غير معروف",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
      onDone();
    }
  };

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        min="0"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onDone();
        }}
        autoFocus
        /* 96-F7 (R96 M8): h-9 input (was w-16 h-6 — a 24px touch target
           for a money-adjacent field). */
        className="w-16 h-9 bg-secondary border border-primary/40 rounded px-1.5 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {/* 96-F7 (R96 M8): the save/cancel controls are now ≥36px tall
         with Arabic TEXT labels («حفظ»/«إلغاء») + gap-2 — the old p-0.5
         icon-only pair (~18px, gap-1) was unmissable under a thumb, and
         Enter/Esc shortcuts don't exist on touch keyboards. Enter/Escape
         still work (the input's onKeyDown above is untouched). */}
      <button
        onClick={save}
        disabled={saving}
        aria-label="حفظ المخزون"
        className="h-9 min-w-9 px-2.5 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-400/10 transition-colors active:scale-95 disabled:opacity-50"
      >
        حفظ
      </button>
      <button
        onClick={onDone}
        aria-label="إلغاء تعديل المخزون"
        className="h-9 min-w-9 px-2.5 rounded-lg text-xs font-bold text-muted-foreground hover:bg-secondary transition-colors active:scale-95"
      >
        إلغاء
      </button>
    </div>
  );
}

export default function AdminProductsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [inventoryDialogProduct, setInventoryDialogProduct] = useState<{
    id: number;
    name: string;
    inventoryCount: number;
  } | null>(null);
  // 94-C2 (A2 P2-3): the GlobalSearch palette deep-links here with
  // ?search= — prefill the box so the operator's query survives the
  // navigation (the catalog search is client-side over the loaded
  // list, so the URL param only needs to seed the initial state).
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get("search") ?? "",
  );
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editingStockId, setEditingStockId] = useState<number | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  // 93-C7 / C-UX3 (A12 F-04): styled confirm for the destructive bulk
  // archive (window.confirm broke theme/RTL and named no count context).
  const { confirm, ConfirmDialog } = useConfirm();

  const headers = useAdminHeaders();

  const {
    data: products = [],
    isLoading,
    // 94-C2 (A2 P1-2): `isError`/`error` were never destructured — a
    // failed load (401/500/network) fell back to data=[] and rendered
    // the «لا توجد منتجات» empty state: a false-empty catalog that
    // survived the round-93 error-card wave (same class as A5 S-2).
    isError,
    error,
    refetch,
  } = useListAdminProducts(undefined, {
    query: {
      queryKey: getListAdminProductsQueryKey(),
      enabled: !!adminToken,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
    request: { headers },
  });

  const loadErrorMessage = isError ? getErrorMessage(error) : null;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });

  const createMutation = useCreateProduct({
    request: { headers },
    mutation: {
      onSuccess() {
        invalidate();
        setShowForm(false);
        setForm({ ...EMPTY_FORM });
        toast({ title: "تمت الإضافة" });
      },
      onError(err: unknown) {
        toast({
          title: "خطأ",
          description: err instanceof Error ? err.message : "فشلت العملية",
          variant: "destructive",
        });
      },
    },
  });
  const updateMutation = useUpdateProduct({
    request: { headers },
    mutation: {
      onSuccess() {
        invalidate();
        setEditingId(null);
        setForm({ ...EMPTY_FORM });
        setShowForm(false);
        toast({ title: "تم التحديث" });
      },
      onError(err: unknown) {
        toast({
          title: "خطأ",
          description: err instanceof Error ? err.message : "فشلت العملية",
          variant: "destructive",
        });
      },
    },
  });
  const deleteMutation = useDeleteProduct({
    request: { headers },
    mutation: {
      onSuccess() {
        invalidate();
        toast({ title: "تمت الأرشفة" });
      },
      onError(err: unknown) {
        toast({
          title: "خطأ",
          description: err instanceof Error ? err.message : "فشلت العملية",
          variant: "destructive",
        });
      },
    },
  });

  // 96-F7 (R96 M9): single-product archive now runs through the same
  // shared styled confirm the bulk archive uses — the old inline
  // Archive/X icon pair (~28px buttons, gap-1) sat directly beside the
  // other card actions, and a 4px thumb slip turned «إلغاء» into an
  // archiving (terminal in this UI). The dialog names the product so
  // the operator knows exactly what is being archived.
  const archiveProduct = async (product: AdminProduct) => {
    const confirmed = await confirm({
      title: "أرشفة المنتج؟",
      description: `سيتم أرشفة «${product.name}» — يُخفى من المتجر وتبقى بياناته ومبيعاته.`,
      confirmLabel: "أرشفة",
      destructive: true,
    });
    if (!confirmed) return;
    deleteMutation.mutate({ id: product.id });
  };

  // Keyboard shortcut: Ctrl+S to save form
  useEffect(() => {
    if (!showForm) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        document
          .getElementById("product-form")
          ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      if (e.key === "Escape") cancelForm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showForm]);

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  if (!adminToken) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: form.name,
      description: form.description || undefined,
      image_url: form.image_url || undefined,
      price: parseFloat(form.price),
      cost_price: form.cost_price ? parseFloat(form.cost_price) : undefined,
      category: form.category || undefined,
      usage_terms: form.usage_terms || undefined,
      is_active: form.is_active,
    };
    if (editingId) updateMutation.mutate({ id: editingId, data });
    else createMutation.mutate({ data });
  };

  const startEdit = (product: AdminProduct) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      description: product.description ?? "",
      image_url: product.image_url ?? "",
      price: String(product.price),
      cost_price:
        (product as { cost_price?: number | null }).cost_price != null
          ? String((product as { cost_price?: number | null }).cost_price)
          : "",
      category: product.category ?? "",
      usage_terms: product.usage_terms ?? "",
      is_active: product.is_active,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const filtered = products.filter((p) => {
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      categoryLabel(p.category).includes(search);
    const matchCategory = !categoryFilter || p.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const lowStockCount = products.filter((p) => p.stock_count === 0 && p.is_active).length;

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((p) => p.id)));
  };

  // 94-C2 (A2 P2-8): the bulk loops now count REAL outcomes (per-item
  // r.ok + parsed failure reasons, isAdminUnauthorized mid-loop) and the
  // success toast only fires when something actually succeeded — the
  // old unconditional «تمت أرشفة 0 منتج» right after the failure toast
  // was a success-toned lie (same class as the topups B5-01 fix).
  const summarizeBulk = (
    verb: string,
    total: number,
    failures: Array<{ id: number; reason: string }>,
  ) => {
    const successCount = total - failures.length;
    if (failures.length > 0) {
      toast({
        title: successCount > 0 ? `${verb} — ${successCount} من ${total}` : "خطأ",
        description: `فشلت ${failures.length} من ${total} — ${failures
          .map((f) => `#${f.id}: ${f.reason}`)
          .join("، ")}`,
        variant: "destructive",
      });
    }
    if (successCount > 0 && failures.length === 0) {
      toast({
        title: `✓ ${verb} ${successCount} ${successCount === 1 ? "منتج" : "منتجات"}`,
        variant: "success",
      });
    }
  };

  const bulkDelete = async () => {
    if (!selectedIds.size) return;
    // 93-C7 / C-UX3: shared styled confirm — native window.confirm left
    // the operator with English browser chrome and no count context.
    const confirmed = await confirm({
      title: "أرشفة المنتجات المحددة؟",
      description: `سيتم أرشفة ${selectedIds.size} منتج — تُخفى من المتجر وتبقى بياناتها ومبيعاتها.`,
      confirmLabel: "أرشفة",
      destructive: true,
    });
    if (!confirmed) return;
    setBulkProcessing(true);
    const failures: Array<{ id: number; reason: string }> = [];
    for (const id of selectedIds) {
      const url = `/api/admin/products/${id}`;
      try {
        const r = await fetch(url, { method: "DELETE", headers });
        // 94-C2 (A2 P2-14): 401 mid-loop = session expiry — stop the
        // loop; the global handler has toasted + redirected.
        if (isAdminUnauthorized(r, url)) return;
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          failures.push({
            id,
            reason: body && (body.error || body.code) ? getErrorMessage(body) : `HTTP ${r.status}`,
          });
          continue;
        }
      } catch (e) {
        failures.push({ id, reason: e instanceof Error ? e.message : "خطأ غير معروف" });
      }
    }
    summarizeBulk("تمت الأرشفة", selectedIds.size, failures);
    setSelectedIds(new Set());
    invalidate();
    setBulkProcessing(false);
  };

  const bulkToggleActive = async (active: boolean) => {
    if (!selectedIds.size) return;
    setBulkProcessing(true);
    const failures: Array<{ id: number; reason: string }> = [];
    for (const id of selectedIds) {
      const p = products.find((pr) => pr.id === id);
      if (!p) continue;
      const url = `/api/admin/products/${id}`;
      try {
        const r = await fetch(url, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: active }),
        });
        // 94-C2 (A2 P2-14): same mid-loop session-expiry guard.
        if (isAdminUnauthorized(r, url)) return;
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          failures.push({
            id,
            reason: body && (body.error || body.code) ? getErrorMessage(body) : `HTTP ${r.status}`,
          });
        }
      } catch (e) {
        failures.push({ id, reason: e instanceof Error ? e.message : "خطأ غير معروف" });
      }
    }
    summarizeBulk(active ? "تم التفعيل" : "تم الإخفاء", selectedIds.size, failures);
    setSelectedIds(new Set());
    invalidate();
    setBulkProcessing(false);
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black mb-0.5">المنتجات</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{products.length} منتج في الكتالوج</span>
              {lowStockCount > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                  {/* 93-C7 / C-UX5 (A11 §1 «{n} نفد مخزونه»): the count
                      before the verb broke the Arabic construction. */}
                  <span className="flex items-center gap-1 text-orange-400 font-bold">
                    <AlertTriangle className="w-3 h-3" />
                    نفد مخزون {lowStockCount} منتج
                  </span>
                </>
              )}
            </div>
          </div>
          <Button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              setForm({ ...EMPTY_FORM });
            }}
            className="bg-primary hover:bg-primary/90 shadow-md shadow-primary/20 h-9 active:scale-[0.97] transition-transform"
          >
            <Plus className="w-4 h-4 ml-1.5" /> منتج جديد
          </Button>
        </div>

        {/* Stockout-risk forecast panel (011-inventory-demand-forecast).
            Self-hides when the cron has never run, when no products are
            at risk, or when the user lacks the inventory scope. */}
        <StockoutRiskPanel />

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/8 border border-primary/20 rounded-2xl animate-in fade-in slide-in-from-top-1 duration-150">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-bold text-primary">{selectedIds.size} منتج محدد</span>
            <div className="flex gap-2 mr-auto flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/10"
                onClick={() => bulkToggleActive(true)}
                disabled={bulkProcessing}
              >
                <Eye className="w-3 h-3" /> تفعيل
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 text-muted-foreground border-border hover:bg-secondary"
                onClick={() => bulkToggleActive(false)}
                disabled={bulkProcessing}
              >
                <EyeOff className="w-3 h-3" /> إخفاء
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 text-destructive border-destructive/20 hover:bg-destructive/10"
                onClick={bulkDelete}
                disabled={bulkProcessing}
              >
                <Archive className="w-3 h-3" /> {bulkProcessing ? "جارٍ…" : "أرشفة"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="w-3 h-3 ml-1" /> إلغاء
              </Button>
            </div>
          </div>
        )}

        {/* Create / Edit form */}
        {showForm && (
          <div className="bg-card border border-primary/20 rounded-2xl overflow-hidden shadow-lg shadow-primary/5">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/15">
              <div>
                <h2 className="font-black text-sm">
                  {editingId ? "تعديل المنتج" : "إضافة منتج جديد"}
                </h2>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  <kbd className="font-mono bg-muted/80 border border-border/60 px-1 rounded">
                    ⌘S
                  </kbd>{" "}
                  للحفظ ·
                  <kbd className="font-mono bg-muted/80 border border-border/60 px-1 rounded mr-1">
                    Esc
                  </kbd>{" "}
                  للإغلاق
                </p>
              </div>
              <button
                onClick={cancelForm}
                aria-label="إغلاق النموذج"
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              id="product-form"
              onSubmit={handleSubmit}
              className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              <div>
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                  اسم المنتج *
                </Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="مثال: Netflix Premium"
                />
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                  السعر (د.ل) *
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  required
                  dir="ltr"
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block flex items-center gap-2">
                  سعر التكلفة (د.ل)
                  {/* 96-F7 (R96 A6 #11): 9px → 10px — functional hint
                      text, not decoration. */}
                  <span className="text-[10px] font-normal text-muted-foreground/70">
                    اختياري — للإدارة فقط، لا يظهر للمستخدم
                  </span>
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cost_price}
                  onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))}
                  dir="ltr"
                  placeholder="0.00"
                />
                {form.price && form.cost_price && (
                  <p className="text-[10px] mt-1 text-muted-foreground">
                    {(() => {
                      const p = parseFloat(form.price);
                      const c = parseFloat(form.cost_price);
                      if (!Number.isFinite(p) || !Number.isFinite(c) || p <= 0) return null;
                      const margin = p - c;
                      const pct = (margin / p) * 100;
                      const tone =
                        margin < 0
                          ? "text-destructive"
                          : pct < 10
                            ? "text-amber-500"
                            : "text-emerald-500";
                      return (
                        <span className={tone}>
                          {/* 96-F7 (R96 A6 #18): formatCurrency — the
                              manual toFixed(2) skipped thousands grouping
                              (the established money convention, see
                              utils.ts). */}
                          هامش الربح: {formatCurrency(margin)} ({pct.toFixed(1)}%)
                        </span>
                      );
                    })()}
                  </p>
                )}
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                  الوصف
                </Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="وصف مختصر للمنتج…"
                />
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                  رابط الصورة
                </Label>
                <Input
                  value={form.image_url}
                  onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                  dir="ltr"
                  placeholder="https://..."
                />
                {form.image_url.trim() && (
                  <div className="mt-2 flex items-center gap-2.5">
                    <div className="relative w-16 h-16 shrink-0 rounded-xl border border-border/50 bg-card overflow-hidden">
                      <img
                        src={form.image_url.trim()}
                        alt="معاينة"
                        className="absolute inset-0 m-auto max-w-[74%] max-h-[74%] w-auto h-auto object-contain"
                        onLoad={(e) => {
                          (
                            e.currentTarget.nextElementSibling as HTMLElement | null
                          )?.style.setProperty("display", "none");
                          e.currentTarget.style.display = "block";
                        }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          (
                            e.currentTarget.nextElementSibling as HTMLElement | null
                          )?.style.setProperty("display", "flex");
                        }}
                      />
                      <div
                        style={{ display: "none" }}
                        className="absolute inset-0 items-center justify-center text-[10px] font-bold text-destructive text-center px-1"
                      >
                        رابط غير صالح
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      معاينة كما ستظهر في البطاقة. استخدم صورة شفافة (PNG/SVG) عالية الدقة لأفضل
                      نتيجة.
                    </p>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                  الفئة
                </Label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary h-10"
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs font-bold text-muted-foreground mb-1.5 block">
                  شروط الاستخدام
                </Label>
                <Input
                  value={form.usage_terms}
                  onChange={(e) => setForm((f) => ({ ...f, usage_terms: e.target.value }))}
                  placeholder="ملاحظات مهمة تظهر بعد الشراء…"
                />
              </div>
              <div className="md:col-span-2 flex items-center gap-3 py-1">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="w-4 h-4 accent-primary"
                />
                <Label htmlFor="is_active" className="cursor-pointer text-sm">
                  منتج نشط (ظاهر للمستخدمين)
                </Label>
              </div>
              <div className="md:col-span-2 flex gap-3 justify-end pt-1 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelForm}
                  className="h-9 active:scale-[0.97] transition-transform"
                >
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  className="h-9 bg-primary hover:bg-primary/90 active:scale-[0.97] transition-transform"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  <CheckCircle className="w-4 h-4 ml-1.5" />
                  {editingId ? "حفظ التعديلات" : "إضافة المنتج"}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Filters: search + category */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Select all toggle */}
          {!isLoading && filtered.length > 0 && (
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg hover:bg-secondary"
              title={allFilteredSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
            >
              {allFilteredSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {allFilteredSelected ? "إلغاء الكل" : "تحديد الكل"}
              </span>
            </button>
          )}

          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="بحث في المنتجات…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 h-9 w-52 text-sm"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1 overflow-x-auto scrollbar-none">
            {CATEGORY_FILTERS.map((c) => (
              <button
                key={c.value}
                onClick={() => setCategoryFilter(c.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  categoryFilter === c.value
                    ? "bg-card shadow-sm text-foreground font-bold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {(search || categoryFilter) && (
            <button
              onClick={() => {
                setSearch("");
                setCategoryFilter("");
              }}
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              مسح
            </button>
          )}
          <span className="text-xs text-muted-foreground mr-auto">{filtered.length} منتج</span>
        </div>

        {/* Grid */}
        {/* 94-C2 (A2 P1-2): refresh of an already-rendered catalog
            failed — keep the stale cards, surface the failure inline
            (referrals.tsx banner idiom). */}
        {isError && products.length > 0 && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
          >
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="min-w-0">{loadErrorMessage ?? "تعذّر تحديث قائمة المنتجات"}</span>
            <button
              type="button"
              onClick={() => refetch()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-card border border-border/60 rounded-2xl h-40 skeleton-shimmer"
              />
            ))}
          </div>
        ) : isError && products.length === 0 ? (
          /* 94-C2 (A2 P1-2): a failed load is NOT an empty catalog — the
             referrals.tsx error-card idiom (an outage/expired session
             previously masqueraded as "لا توجد منتجات"). */
          <div className="text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
              <WifiOff className="w-8 h-8 text-status-error/70" />
            </div>
            <p className="font-black text-lg mb-1.5 text-foreground/80">تعذّر تحميل المنتجات</p>
            <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
              {loadErrorMessage ?? "حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"}
            </p>
            <Button
              onClick={() => refetch()}
              className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              إعادة المحاولة
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Package} title="لا توجد منتجات" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((product) => {
              const isSelected = selectedIds.has(product.id);
              return (
                <div
                  key={product.id}
                  className={`bg-card border rounded-2xl overflow-hidden transition-all hover:shadow-lg hover:shadow-black/10 ${
                    isSelected
                      ? "border-primary/40 ring-1 ring-primary/20 shadow-md shadow-primary/5"
                      : !product.is_active
                        ? "opacity-55 border-border/60"
                        : product.stock_count === 0
                          ? "border-orange-500/25"
                          : "border-border/60 hover:border-border"
                  }`}
                >
                  <div className="p-4">
                    {/* Product info */}
                    <div className="flex items-start gap-3 mb-3">
                      {/* Checkbox — 94-C2: aria-label so the icon-only
                          toggle is announced (and reachable by tests). */}
                      <button
                        onClick={() => toggleSelect(product.id)}
                        aria-label={`تحديد ${product.name}`}
                        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary transition-colors"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                      <div
                        className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-border/50 ${!product.image_url ? (CATEGORY_INITIAL_COLOR[product.category ?? ""] ?? "bg-muted") : "bg-muted"}`}
                      >
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-contain p-1.5"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              e.currentTarget.parentElement!.classList.add(
                                CATEGORY_INITIAL_COLOR[product.category ?? ""]?.split(" ")[0] ??
                                  "bg-muted",
                              );
                            }}
                          />
                        ) : (
                          <span className="text-base font-black opacity-70">
                            {product.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm truncate">{product.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {categoryLabel(product.category)}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 items-end shrink-0">
                        {/* 93-C7 / C-UX2 (A12 B9): canonical pills (were a
                            square rounded + raw orange tuple). */}
                        {!product.is_active && (
                          <StatusBadge variant="neutral" size="xs">
                            غير نشط
                          </StatusBadge>
                        )}
                        {product.stock_count === 0 && product.is_active && (
                          <StatusBadge variant="low-stock" size="xs">
                            نفد المخزون
                          </StatusBadge>
                        )}
                      </div>
                    </div>

                    {/* Stats bar — inline stock edit */}
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/25 border border-border/40 rounded-lg mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-primary tabular-nums">
                          {formatCurrency(product.price)}
                        </span>
                        {(() => {
                          const cp = (product as { cost_price?: number | null }).cost_price;
                          if (cp == null) return null;
                          const margin = product.price - cp;
                          const pct = product.price > 0 ? (margin / product.price) * 100 : 0;
                          const tone =
                            margin < 0
                              ? "bg-destructive/15 text-destructive border-destructive/30"
                              : pct < 10
                                ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
                                : "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
                          return (
                            <span
                              /* 96-F7 (R96 A6 #11): 9px → 10px — a
                                  functional money hint (margin %), not
                                  decoration. */
                              className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded border ${tone}`}
                              title={`تكلفة: ${formatCurrency(cp)} / هامش: ${formatCurrency(margin)}`}
                            >
                              {margin >= 0 ? "+" : ""}
                              {pct.toFixed(0)}%
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        {editingStockId === product.id ? (
                          <InlineStockEdit
                            productId={product.id}
                            current={product.stock_count}
                            onDone={() => {
                              setEditingStockId(null);
                              invalidate();
                            }}
                          />
                        ) : (
                          <button
                            onClick={() => setEditingStockId(product.id)}
                            className={`font-bold tabular-nums hover:underline decoration-dashed underline-offset-2 transition-colors ${
                              product.stock_count === 0 ? "text-orange-400" : "text-emerald-400"
                            }`}
                            title="انقر لتعديل المخزون"
                          >
                            {product.stock_count} وحدة
                          </button>
                        )}
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{product.order_count} طلب</span>
                      </div>
                    </div>

                    {/* Actions */}
                    {/* 96-F7 (R96 M9): destructive archive stays visually
                        separated (gap-2 + min-w-9) from the adjacent
                        «رفع مخزون» button, and now opens the shared
                        confirm dialog instead of swapping into the inline
                        Archive/X icon pair. */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-xs active:scale-[0.97] transition-transform"
                        onClick={() => startEdit(product)}
                      >
                        <Edit2 className="w-3 h-3 ml-1" /> تعديل
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-xs text-muted-foreground active:scale-[0.97] transition-transform"
                        onClick={() =>
                          setInventoryDialogProduct({
                            id: product.id,
                            name: product.name,
                            inventoryCount: product.stock_count,
                          })
                        }
                      >
                        <Upload className="w-3 h-3 ml-1" /> رفع مخزون
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`أرشفة ${product.name}`}
                        className="h-8 min-w-9 px-2 border-destructive/15 text-destructive/50 hover:border-destructive/35 hover:text-destructive hover:bg-destructive/8 active:scale-90"
                        onClick={() => void archiveProduct(product)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Inventory upload now happens in a full-screen
                      dialog (see InventoryUploadDialog). The 'رفع مخزون'
                      button above opens it; it gives the operator a
                      preview table, drag-drop file support, and dedup
                      detection before the POST fires. */}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inventory upload dialog (shared mount, opened per-product) */}
      {inventoryDialogProduct && (
        <InventoryUploadDialog
          productId={inventoryDialogProduct.id}
          productName={inventoryDialogProduct.name}
          inventoryCount={inventoryDialogProduct.inventoryCount}
          onClose={() => setInventoryDialogProduct(null)}
          onUploaded={() => {
            setInventoryDialogProduct(null);
            invalidate();
          }}
        />
      )}
      <ConfirmDialog />
    </AdminLayout>
  );
}
