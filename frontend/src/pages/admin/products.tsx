import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { EmptyState } from "@/components/admin/EmptyState";
import { StockoutRiskPanel } from "@/components/admin/forecast/StockoutRiskPanel";
import { InventoryUploadDialog } from "@/components/admin/InventoryUploadDialog";
// catalog-recon (2026-09-20): per-product variant manager dialog (plan /
// duration / cost rows + engine pricing preview).
import { ProductVariantsDialog } from "@/components/admin/ProductVariantsDialog";
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
// R123 (E3 item 1): the inline stock edit rides the session-aware wrapper
// (a 401 mid-save now gets the global «انتهت الجلسة» toast + redirect
// instead of a per-row failure toast); the two bulk loops keep their
// mid-loop isAdminUnauthorized shape but now break + try/finally (P3h)
// so the bulk-processing flag always resets.
import { AdminSessionExpiredError, adminFetchJson, isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { categoryLabel, formatCount, formatCurrency } from "@/lib/utils";
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
  Layers,
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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AdminLayout } from "./layout";

const EMPTY_FORM = {
  name: "",
  description: "",
  image_url: "",
  price: "",
  cost_price: "",
  category: "",
  usage_terms: "",
  // R123 (E3 item 2): the operator SEO overrides (backend columns
  // seo_title ≤200 / seo_description ≤320). Empty-by-default for the
  // CREATE path; startEdit seeds the row's LIVE values (R125-I3 — the
  // list payload now carries them). The submit path still omits
  // UNTOUCHED fields (see handleSubmit) as belt-and-suspenders against
  // accidental clears.
  seo_title: "",
  seo_description: "",
  is_active: true,
};

const CATEGORY_INITIAL_COLOR: Record<string, string> = {
  streaming: "bg-violet-500/20 text-violet-300",
  music: "bg-emerald-500/20 text-emerald-300",
  software: "bg-sky-500/20 text-sky-300",
  vpn: "bg-cyan-500/20 text-cyan-300",
  "ai-tools": "bg-fuchsia-500/20 text-fuchsia-300",
  "seo-tools": "bg-orange-500/20 text-orange-300",
  education: "bg-amber-500/20 text-amber-300",
  gaming: "bg-blue-500/20 text-blue-300",
  productivity: "bg-amber-500/20 text-amber-300",
};

// Seven live categories first (mirror products.category in production);
// gaming/productivity kept at the end so the operator can still manage
// their archived products (PS Plus, Xbox, Canva, MS 365 …) and re-list
// them the moment stock returns.
const CATEGORY_OPTIONS = [
  { value: "", label: "اختر الفئة" },
  { value: "streaming", label: "بث مباشر" },
  { value: "music", label: "موسيقى" },
  { value: "software", label: "برامج وتراخيص" },
  { value: "vpn", label: "شبكات VPN" },
  { value: "ai-tools", label: "أدوات الذكاء الاصطناعي" },
  { value: "seo-tools", label: "أدوات SEO" },
  { value: "education", label: "تعليم ومكتبات" },
  { value: "gaming", label: "ألعاب (مؤرشفة)" },
  { value: "productivity", label: "إنتاجية (مؤرشفة)" },
];

const CATEGORY_FILTERS = [
  { value: "", label: "الكل" },
  { value: "streaming", label: "بث مباشر" },
  { value: "music", label: "موسيقى" },
  { value: "software", label: "برامج وتراخيص" },
  { value: "vpn", label: "شبكات VPN" },
  { value: "ai-tools", label: "أدوات الذكاء الاصطناعي" },
  { value: "seo-tools", label: "أدوات SEO" },
  { value: "education", label: "تعليم ومكتبات" },
  { value: "gaming", label: "ألعاب" },
  { value: "productivity", label: "إنتاجية" },
];

/** R120-B4 (A2-F2): the backend list (routes/admin/products.ts) clamps
 *  at 200 newest rows with NO page param — the client-side search used
 *  to run only over that window while the header presented its length
 *  as «N منتج في الكتالوج» (a false total: older products beyond the
 *  cap were invisible to both the search and the counter). The search
 *  now rides the server-side ?search= (ILIKE + trigram, covers the
 *  WHOLE catalog); a full 200-row page means the total is NOT known
 *  and the header switches to the honest «عرض N (الأحدث أولاً)».
 *  Accumulating load-more is impossible against this frozen contract
 *  (no `page` param server-side) — the cap hint + search is the honest
 *  surface instead. */
const PRODUCTS_SERVER_CAP = 200;

/** Arabic plural forms for the catalog counter (formatCount). */
const PRODUCT_COUNT_FORMS = {
  zero: "منتجات",
  one: "منتج",
  two: "منتجان",
  few: "منتجات",
  many: "منتجًا",
  other: "منتج",
};

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
      // R123 (E3 item 1): adminFetchJson owns the ok-guard + safe parse.
      await adminFetchJson(`/api/admin/products/${productId}/inventory/set-count`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ count: n }),
      });
      toast({ title: "تم تحديث المخزون", variant: "success" });
    } catch (e) {
      // Session expiry already toasted + redirected globally — the
      // finally still closes the inline editor; every other failure
      // keeps its per-row destructive toast.
      if (!(e instanceof AdminSessionExpiredError)) {
        toast({
          title: "تعذّر تحديث المخزون",
          description: e instanceof Error ? e.message : "خطأ غير معروف",
          variant: "destructive",
        });
      }
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
        /* R115 (A9 P3-7): the edit is an ABSOLUTE SET (POST set-count),
           not a +N increment — a "+5" mental model silently replaces
           the whole count. The title/aria-label carry the semantics
           (the value is prefilled with the current total, so a
           placeholder would never render). */
        title="العدد الكلي للوحدات — تعيين مطلق وليس إضافة (أدخل الرقم النهائي)"
        aria-label="العدد الكلي للوحدات (تعيين مطلق)"
        placeholder="الكل"
        /* 96-F7 (R96 M8): h-9 input (was w-16 h-6 — a 24px touch target
           for a money-adjacent field). */
        className="w-20 h-9 bg-secondary border border-primary/40 rounded px-1.5 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary"
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

/* ── R124-I5 (A6 F4 — the R118-B2 orders.tsx pattern) ──────────────────
 * The search box is a CONTROLLED input — every keystroke re-rendered the
 * whole page and (with the 200-card grid inlined in the map closure) all
 * card subtrees with fresh inline handlers, TWICE a minute more via the
 * 60s refetchInterval. The card is now a module-level React.memo
 * component whose props are stable across a keystroke (product refs come
 * from the query data array; isSelected/isEditingStock are primitives;
 * the seven callbacks are useCallback-stable), so typing re-renders the
 * search box and nothing else, and the poll only busts cards whose rows
 * actually changed identity. */
interface ProductCardProps {
  product: AdminProduct;
  isSelected: boolean;
  /** Whether THIS card's inline stock editor is open. */
  isEditingStock: boolean;
  onToggleSelect: (id: number) => void;
  onEdit: (product: AdminProduct) => void;
  onEditStock: (id: number) => void;
  onStockEditDone: () => void;
  onUploadInventory: (product: AdminProduct) => void;
  onManageVariants: (product: AdminProduct) => void;
  onArchive: (product: AdminProduct) => void;
}

const ProductCard = React.memo(function ProductCard({
  product,
  isSelected,
  isEditingStock,
  onToggleSelect,
  onEdit,
  onEditStock,
  onStockEditDone,
  onUploadInventory,
  onManageVariants,
  onArchive,
}: ProductCardProps) {
  return (
    <div
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
            onClick={() => onToggleSelect(product.id)}
            aria-label={`تحديد ${product.name}`}
            /* R124-I5 (A6 F10): the bulk-archive selection state feeding
               the destructive action was visual-only — aria-pressed
               exposes it (the orders.tsx row-selector idiom). */
            aria-pressed={isSelected}
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
                    CATEGORY_INITIAL_COLOR[product.category ?? ""]?.split(" ")[0] ?? "bg-muted",
                  );
                }}
              />
            ) : (
              <span className="text-base font-bold opacity-70">
                {product.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm truncate">{product.name}</div>
            <div className="text-xs text-muted-foreground">{categoryLabel(product.category)}</div>
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
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/25 border border-border/40 rounded-lg mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="font-bold text-primary tabular-nums">
              {formatCurrency(product.price)}
            </span>
            {/* catalog-recon: variant-count badge — the display
                price is MIN(active variants); zero variants =
                unbuyable product (actionable catalog signal). */}
            {(() => {
              const count = product.variants?.length ?? 0;
              if (count === 0)
                return (
                  <span
                    title="لا باقات — اضغط «الباقات» لإضافة باقة"
                    className="text-3xs font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-500 border-amber-500/30"
                  >
                    بلا باقات
                  </span>
                );
              return (
                <span
                  title="عدد باقات المنتج — اضغط «الباقات» للإدارة"
                  className="text-3xs font-bold px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/25"
                >
                  {formatCount(count, {
                    one: "باقة",
                    two: "باقتان",
                    few: "باقات",
                    many: "باقة",
                    other: "باقة",
                  })}
                </span>
              );
            })()}
            {(() => {
              // R125-I3 (A2-20): the generated AdminProduct already
              // declares cost_price — the pre-codegen-era cast is gone.
              const cp = product.cost_price;
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
                  className={`text-3xs font-bold tabular-nums px-1.5 py-0.5 rounded border ${tone}`}
                  title={`تكلفة: ${formatCurrency(cp)} / هامش: ${formatCurrency(margin)}`}
                >
                  {margin >= 0 ? "+" : ""}
                  {pct.toFixed(0)}%
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-3 text-xs">
            {isEditingStock ? (
              <InlineStockEdit
                productId={product.id}
                current={product.stock_count}
                onDone={onStockEditDone}
              />
            ) : (
              <button
                onClick={() => onEditStock(product.id)}
                className={`font-bold tabular-nums hover:underline decoration-dashed underline-offset-2 transition-colors ${
                  product.stock_count === 0 ? "text-orange-400" : "text-emerald-400"
                }`}
                /* R115 (A9 P3-7): the inline edit is an absolute
                   SET, not +N — say so on the trigger too. */
                title="انقر لتعديل المخزون — تعيين العدد الكلي (وليس إضافة)"
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
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 min-w-[88px] h-8 text-xs active:scale-[0.97] transition-transform"
            onClick={() => onEdit(product)}
          >
            <Edit2 className="w-3 h-3 ml-1" /> تعديل
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 min-w-[88px] h-8 text-xs text-muted-foreground active:scale-[0.97] transition-transform"
            onClick={() => onUploadInventory(product)}
          >
            <Upload className="w-3 h-3 ml-1" /> رفع مخزون
          </Button>
          {/* catalog-recon: variant manager entry (plan/duration/
              cost + engine pricing). */}
          <Button
            size="sm"
            variant="outline"
            aria-label={`إدارة باقات ${product.name}`}
            className="flex-1 min-w-[88px] h-8 text-xs text-primary active:scale-[0.97] transition-transform"
            onClick={() => onManageVariants(product)}
          >
            <Layers className="w-3 h-3 ml-1" /> الباقات
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={`أرشفة ${product.name}`}
            className="h-8 min-w-9 px-2 border-destructive/15 text-destructive/50 hover:border-destructive/35 hover:text-destructive hover:bg-destructive/8 active:scale-90"
            onClick={() => onArchive(product)}
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
});

export default function AdminProductsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  // 98-F7 (R98-05): the pristine baseline the editor opened with — the
  // create path seeds EMPTY_FORM, startEdit seeds the loaded product.
  // Powers the dirty flag below (form vs baseline, cheap JSON compare —
  // the form is flat strings + one bool).
  const [formBaseline, setFormBaseline] = useState({ ...EMPTY_FORM });
  // R123 (E3 item 2): per-field "the operator edited this SEO field"
  // flags. R125-I3: the editor now SEEDS the stored values, so a plain
  // value-vs-baseline compare would suffice — but the touched flags
  // stay as belt-and-suspenders (they also keep an explicit
  // clear-back-to-the-original-value from sending a redundant write).
  // The first change event per field sets its flag; every editor
  // re-seed resets both. (The reset rides the stable setState directly —
  // a per-render wrapper fn would make openCreateFromHash/cancelForm
  // non-stable and re-flag the two pre-existing mount effects for
  // react-hooks/exhaustive-deps.)
  const [seoTouched, setSeoTouched] = useState({ title: false, description: false });

  const [inventoryDialogProduct, setInventoryDialogProduct] = useState<{
    id: number;
    name: string;
    inventoryCount: number;
  } | null>(null);
  // catalog-recon: which product's variants dialog is open («الباقات»).
  const [variantsDialogProduct, setVariantsDialogProduct] = useState<{
    id: number;
    name: string;
  } | null>(null);
  // 94-C2 (A2 P2-3): the GlobalSearch palette deep-links here with
  // ?search= — prefill the box (R120-B4: the search is now SERVER-side,
  // so the param also seeds the debounced mirror the first query
  // carries — no double fetch).
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get("search") ?? "",
  );
  // R120-B4 (A2-F2): 300ms debounce feeding the server-side ?search=
  // (the orders/users pattern) — one request per typing pause, not per
  // keystroke; the query-key change aborts the in-flight request via
  // the generated hook's AbortSignal.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const searchParam = useSearch();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editingStockId, setEditingStockId] = useState<number | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  // 93-C7 / C-UX3 (A12 F-04): styled confirm for the destructive bulk
  // archive (window.confirm broke theme/RTL and named no count context).
  const { confirm, ConfirmDialog } = useConfirm();

  // R115 (A9 P1 / A9 #6): the layout's context action links to
  // /admin/products#new (layout.tsx CONTEXT_ACTIONS) — the page used to
  // read ?search only, so the link landed on a closed form. Honor the
  // hash: open the create editor (fresh session) and consume the hash
  // so a refresh doesn't reopen it after the operator closes the form.
  const openCreateFromHash = () => {
    if (window.location.hash !== "#new") return;
    setShowForm(true);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    // 98-F7 (R98-05): fresh create session starts pristine.
    setFormBaseline({ ...EMPTY_FORM });
    setSeoTouched({ title: false, description: false });
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  useEffect(() => {
    openCreateFromHash();
    // Same-page clicks (already on /admin/products, tapping the
    // context action again) don't remount — listen for the hash change
    // too.
    window.addEventListener("hashchange", openCreateFromHash);
    return () => window.removeEventListener("hashchange", openCreateFromHash);
  }, []);

  // R120-B4 (A2-F2): GlobalSearch deep-links (?search=…) — keep the box
  // in sync when the URL search changes without clobbering local typing
  // (the orders.tsx idiom).
  useEffect(() => {
    const q = new URLSearchParams(searchParam).get("search") ?? "";
    setSearch((prev) => (prev === q ? prev : q));
  }, [searchParam]);

  // R120-B4 (A2-F2): the debounce — only the settled value enters the
  // query key.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const headers = useAdminHeaders();

  // 98-F7 (R98-05): dirty-state guard for the product editor — a long
  // Arabic description/usage-terms lost to an accidental refresh (zero
  // beforeunload existed repo-wide) now prompts first. Armed ONLY while
  // the editor is open AND its content differs from the baseline the
  // editor opened with (a dismissed-with-changes editor is not dirty —
  // its state was reset). SPA route-leave interception stays a
  // documented residual (see use-dirty-guard.ts).
  const editorDirty = showForm && JSON.stringify(form) !== JSON.stringify(formBaseline);
  useDirtyGuard(editorDirty);

  // R120-B4 (A2-F2): the debounced search rides the existing server-side
  //  ?search= (ILIKE name + category, newest-first, capped 200). The
  //  queryKey carries the params (getListAdminProductsQueryKey(params)) so
  //  a settled search restarts the query; the base-key invalidations
  //  (invalidate() + socket pushes) still prefix-match and refresh it.
  const listParams = { search: debouncedSearch.trim() || undefined };
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
  } = useListAdminProducts(listParams, {
    query: {
      queryKey: getListAdminProductsQueryKey(listParams),
      enabled: !!adminToken,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
    request: { headers },
  });

  // R120-B4 (A2-F2): a full cap page = the total is NOT provably known;
  // a short page IS the whole (search-filtered) catalog.
  const catalogCapped = products.length >= PRODUCTS_SERVER_CAP;

  const loadErrorMessage = isError ? getErrorMessage(error) : null;

  // R124-I5 (A6 F4 — R118-B2): useCallback-stable — feeds the memoized
  // cards' onStockEditDone and the dialogs' onChanged without busting them.
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: getListAdminProductsQueryKey() }),
    [queryClient],
  );

  const createMutation = useCreateProduct({
    request: { headers },
    mutation: {
      onSuccess() {
        invalidate();
        setShowForm(false);
        setForm({ ...EMPTY_FORM });
        setSeoTouched({ title: false, description: false });
        // R124-I5 (A6 F1): success variant (matches the green stock-edit
        // toast above — the create/update/archive paths were blue).
        toast({ title: "تمت الإضافة", variant: "success" });
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
        setSeoTouched({ title: false, description: false });
        // R124-I5 (A6 F1): success variant.
        toast({ title: "تم التحديث", variant: "success" });
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
        // R124-I5 (A6 F1): success variant.
        toast({ title: "تمت الأرشفة", variant: "success" });
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
  // R115 (A9 P1): the copy is now HONEST about the one-way door — the
  // list endpoint filters is_archived=false and NO restore path exists
  // anywhere (UI or API); the old «تبقى بياناته ومبيعاته» wording
  // implied recoverability that does not exist.
  const deleteMutate = deleteMutation.mutate;
  // R124-I5 (A6 F4 — R118-B2): useCallback-stable for the memoized cards
  // (confirm is useCallback([]) in useConfirm; deleteMutate is referentially
  // stable for a fixed mutationKey — only the wrapper object re-mints per
  // render, so the destructured fn is the safe dep).
  const archiveProduct = useCallback(
    async (product: AdminProduct) => {
      const confirmed = await confirm({
        title: "أرشفة المنتج؟",
        description: `سيتم أرشفة «${product.name}» — الأرشفة نهائية من الواجهة: بيانات المنتج ومبيعاته تبقى في السجل، لكنه يُخفى من المتجر ومن قائمة المنتجات، واستعادته تتطلب تدخلاً مباشراً.`,
        confirmLabel: "أرشفة",
        destructive: true,
      });
      if (!confirmed) return;
      deleteMutate({ id: product.id });
    },
    [confirm, deleteMutate],
  );

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

  // R124-I5 (A6 F4 — R118-B2): useCallback-stable (only stable setters + window).
  const startEdit = useCallback((product: AdminProduct) => {
    setEditingId(product.id);
    const next = {
      name: product.name,
      description: product.description ?? "",
      image_url: product.image_url ?? "",
      price: String(product.price),
      cost_price: product.cost_price != null ? String(product.cost_price) : "",
      category: product.category ?? "",
      usage_terms: product.usage_terms ?? "",
      // R125-I3 (A4 B-2 / A2-3): the list projection now carries the
      // LIVE overrides — seed the editor with them so the operator SEES
      // (and can deliberately clear) what is actually stored, instead
      // of a misleading blank editor on an already-optimized product.
      // null (no override) maps to "" for the string form fields.
      seo_title: product.seo_title ?? "",
      seo_description: product.seo_description ?? "",
      is_active: product.is_active,
    };
    // 98-F7 (R98-05): the loaded values double as the pristine baseline.
    setForm(next);
    setFormBaseline(next);
    setSeoTouched({ title: false, description: false });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // R124-I5 (A6 F4 — R118-B2): useCallback-stable for the memoized cards.
  const openInventory = useCallback((product: AdminProduct) => {
    setInventoryDialogProduct({
      id: product.id,
      name: product.name,
      inventoryCount: product.stock_count,
    });
  }, []);
  const openVariants = useCallback((product: AdminProduct) => {
    setVariantsDialogProduct({ id: product.id, name: product.name });
  }, []);
  const stockEditDone = useCallback(() => {
    setEditingStockId(null);
    invalidate();
  }, [invalidate]);
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // R120-B4 (A2-F2): the search ran on the SERVER (?search= covers the
  //  whole catalog, not just the loaded window) — only the category tab
  //  stays client-side over the (possibly capped) loaded rows.
  // R124-I5 (A6 F4 — R118-B2): memoized derived arrays — the search is
  // SERVER-side (?search=), so only the category tab stays client-side; a
  // keystroke no longer re-mints the filtered array + the low-stock count.
  const filtered = useMemo(
    () => (categoryFilter ? products.filter((p) => p.category === categoryFilter) : products),
    [products, categoryFilter],
  );

  const lowStockCount = useMemo(
    () => products.filter((p) => p.stock_count === 0 && p.is_active).length,
    [products],
  );

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
      // R123 (E3 item 2) + R125-I3 (A4 B-2): SEO overrides mirror the
      // backend PATCH contract (admin/products.ts — explicit-null-
      // clears), keyed on the per-field touched flags: send the trimmed
      // value when the operator set one; send null when the operator
      // edited AND cleared (explicit clear → the product page falls
      // back to the name/description-based meta, the exact behavior the
      // field's hint copy promises); OMIT when the operator never
      // touched the field. With the seeded values the guard is now
      // belt-and-suspenders — an untouched save is byte-identical to
      // the stored row anyway — but it keeps the wire body minimal.
      // The generated zod carries the column-aligned caps (200/320)
      // server-side.
      seo_title: seoTouched.title ? form.seo_title.trim() || null : undefined,
      seo_description: seoTouched.description ? form.seo_description.trim() || null : undefined,
      is_active: form.is_active,
    };
    if (editingId) updateMutation.mutate({ id: editingId, data });
    else createMutation.mutate({ data });
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setSeoTouched({ title: false, description: false });
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
        title: `${verb} ${successCount} ${successCount === 1 ? "منتج" : "منتجات"}`,
        variant: "success",
      });
    }
  };

  const bulkDelete = async () => {
    if (!selectedIds.size) return;
    // 93-C7 / C-UX3: shared styled confirm — native window.confirm left
    // the operator with English browser chrome and no count context.
    // R115 (A9 P1): same one-way-door honesty as the single archive.
    const confirmed = await confirm({
      title: "أرشفة المنتجات المحددة؟",
      description: `سيتم أرشفة ${selectedIds.size} منتج — الأرشفة نهائية من الواجهة: بياناتها ومبيعاتها تبقى في السجل، لكنها تُخفى من المتجر ومن قائمة المنتجات، واستعادتها تتطلب تدخلاً مباشراً.`,
      confirmLabel: "أرشفة",
      destructive: true,
    });
    if (!confirmed) return;
    setBulkProcessing(true);
    const failures: Array<{ id: number; reason: string }> = [];
    // R123 (E3 P3h): the mid-loop session-expiry exit now breaks +
    // returns INSIDE try/finally — the old bare `return` skipped
    // setBulkProcessing(false) and left the bulk buttons permanently
    // disabled after a 401 redirect round-trip.
    let sessionExpired = false;
    try {
      for (const id of selectedIds) {
        const url = `/api/admin/products/${id}`;
        try {
          const r = await fetch(url, { method: "DELETE", headers });
          // 94-C2 (A2 P2-14): 401 mid-loop = session expiry — stop the
          // loop; the global handler has toasted + redirected.
          if (isAdminUnauthorized(r, url)) {
            sessionExpired = true;
            break;
          }
          if (!r.ok) {
            const body = (await r.json().catch(() => null)) as {
              error?: string;
              code?: string;
            } | null;
            failures.push({
              id,
              reason:
                body && (body.error || body.code) ? getErrorMessage(body) : `HTTP ${r.status}`,
            });
            continue;
          }
        } catch (e) {
          failures.push({ id, reason: e instanceof Error ? e.message : "خطأ غير معروف" });
        }
      }
      if (sessionExpired) return;
      summarizeBulk("تمت الأرشفة", selectedIds.size, failures);
      setSelectedIds(new Set());
      invalidate();
    } finally {
      setBulkProcessing(false);
    }
  };

  const bulkToggleActive = async (active: boolean) => {
    if (!selectedIds.size) return;
    setBulkProcessing(true);
    const failures: Array<{ id: number; reason: string }> = [];
    // R123 (E3 P3h): same break + try/finally as bulkDelete.
    let sessionExpired = false;
    try {
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
          if (isAdminUnauthorized(r, url)) {
            sessionExpired = true;
            break;
          }
          if (!r.ok) {
            const body = (await r.json().catch(() => null)) as {
              error?: string;
              code?: string;
            } | null;
            failures.push({
              id,
              reason:
                body && (body.error || body.code) ? getErrorMessage(body) : `HTTP ${r.status}`,
            });
          }
        } catch (e) {
          failures.push({ id, reason: e instanceof Error ? e.message : "خطأ غير معروف" });
        }
      }
      if (sessionExpired) return;
      summarizeBulk(active ? "تم التفعيل" : "تم الإخفاء", selectedIds.size, failures);
      setSelectedIds(new Set());
      invalidate();
    } finally {
      setBulkProcessing(false);
    }
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold mb-0.5">المنتجات</h1>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {/* R120-B4 (A2-F2): honest count (the orders idiom). The old
                  «{products.length} منتج في الكتالوج» presented the capped
                  200-row window as the whole catalog. A full cap page →
                  «عرض N (الأحدث أولاً)»; a search → «نتائج البحث: N» (the
                  result set IS complete when shorter than the cap);
                  otherwise the catalog genuinely fits and the total is
                  true. */}
              <span>
                {catalogCapped
                  ? `عرض ${formatCount(products.length, PRODUCT_COUNT_FORMS)} (الأحدث أولاً)`
                  : debouncedSearch.trim()
                    ? `نتائج البحث: ${formatCount(products.length, PRODUCT_COUNT_FORMS)}`
                    : `${formatCount(products.length, PRODUCT_COUNT_FORMS)} في الكتالوج`}
              </span>
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
              // 98-F7 (R98-05): fresh create session starts pristine.
              setFormBaseline({ ...EMPTY_FORM });
              setSeoTouched({ title: false, description: false });
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
                <h2 className="font-bold text-sm">
                  {editingId ? "تعديل المنتج" : "إضافة منتج جديد"}
                </h2>
                <p className="text-3xs text-muted-foreground mt-0.5">
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
              {/* R124-I5 (A6 F3 — AUD103-6-F2 completion): every editor
                field carries a real htmlFor↔id pair. The r103 label pass
                covered coupons/users/topups/admins/settings/security but
                missed this — the biggest admin form (9 fields) had
                programmatically-unassociated labels. */}
              <div>
                <Label
                  htmlFor="product-editor-name"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block"
                >
                  اسم المنتج *
                </Label>
                <Input
                  id="product-editor-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="مثال: Netflix Premium"
                />
              </div>
              <div>
                <Label
                  htmlFor="product-editor-price"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block"
                >
                  السعر (د.ل) *
                </Label>
                <Input
                  id="product-editor-price"
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
                <Label
                  htmlFor="product-editor-cost"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block flex items-center gap-2"
                >
                  سعر التكلفة (د.ل)
                  {/* 96-F7 (R96 A6 #11): 9px → 10px — functional hint
                      text, not decoration. */}
                  <span className="text-3xs font-normal text-muted-foreground/70">
                    اختياري — للإدارة فقط، لا يظهر للمستخدم
                  </span>
                </Label>
                <Input
                  id="product-editor-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cost_price}
                  onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))}
                  dir="ltr"
                  placeholder="0.00"
                />
                {form.price && form.cost_price && (
                  <p className="text-3xs mt-1 text-muted-foreground">
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
                <Label
                  htmlFor="product-editor-description"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block"
                >
                  الوصف
                </Label>
                <Input
                  id="product-editor-description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="وصف مختصر للمنتج…"
                />
              </div>
              <div>
                <Label
                  htmlFor="product-editor-image"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block"
                >
                  رابط الصورة
                </Label>
                <Input
                  id="product-editor-image"
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
                        className="absolute inset-0 items-center justify-center text-3xs font-bold text-destructive text-center px-1"
                      >
                        رابط غير صالح
                      </div>
                    </div>
                    <p className="text-2xs text-muted-foreground leading-relaxed">
                      معاينة كما ستظهر في البطاقة. استخدم صورة شفافة (PNG/SVG) عالية الدقة لأفضل
                      نتيجة.
                    </p>
                  </div>
                )}
              </div>
              <div>
                <Label
                  htmlFor="product-editor-category"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block"
                >
                  الفئة
                </Label>
                <select
                  id="product-editor-category"
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
                <Label
                  htmlFor="product-editor-usage"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block"
                >
                  شروط الاستخدام
                </Label>
                <Input
                  id="product-editor-usage"
                  value={form.usage_terms}
                  onChange={(e) => setForm((f) => ({ ...f, usage_terms: e.target.value }))}
                  placeholder="ملاحظات مهمة تظهر بعد الشراء…"
                />
              </div>
              {/* R123 (E3 item 2): the SEO override fields the CHANGELOG
                  claimed existed — they feed the product page's meta tags
                  (seo-builders consume the overrides; empty falls back to
                  name/description). Column-aligned caps: 200/320. */}
              <div className="md:col-span-2">
                <Label
                  htmlFor="product-editor-seo-title"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block"
                >
                  عنوان SEO (اختياري)
                </Label>
                <Input
                  id="product-editor-seo-title"
                  value={form.seo_title}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, seo_title: e.target.value }));
                    setSeoTouched((t) => (t.title ? t : { ...t, title: true }));
                  }}
                  maxLength={200}
                  placeholder="عنوان مخصص لنتائج البحث — يُترك فارغاً لاستخدام اسم المنتج"
                />
                <p className="text-3xs mt-1 text-muted-foreground">
                  يظهر كعنوان صفحة المنتج في محركات البحث ومشاركات الروابط — فارغ يعني العنوان
                  الافتراضي ({200 - form.seo_title.length} حرف متبقٍ).
                </p>
              </div>
              <div className="md:col-span-2">
                <Label
                  htmlFor="product-editor-seo-description"
                  className="text-xs font-bold text-muted-foreground mb-1.5 block"
                >
                  وصف SEO (اختياري)
                </Label>
                <textarea
                  id="product-editor-seo-description"
                  value={form.seo_description}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, seo_description: e.target.value }));
                    setSeoTouched((t) => (t.description ? t : { ...t, description: true }));
                  }}
                  maxLength={320}
                  rows={3}
                  dir="rtl"
                  placeholder="وصف مخصص يظهر تحت عنوان الصفحة في نتائج البحث…"
                  className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                />
                <p className="text-3xs mt-1 text-muted-foreground">
                  يظهر كوصف صفحة المنتج في محركات البحث — فارغ يعني الوصف الافتراضي ({" "}
                  {form.seo_description.length}/320).
                </p>
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
                aria-label="مسح البحث"
                /* R120-B4 (A2-F12): the orders.tsx fixed version — bare
                   w-3 icon ≈ 12px target; p-2 lifts the tappable area to
                   ~28px. */
                className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground transition-colors"
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
                /* R124-C2 (A6 F10): the active chip was purely visual —
                   aria-pressed exposes the toggle state (the
                   orders.tsx/topups.tsx chip-bar idiom). */
                aria-pressed={categoryFilter === c.value}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
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

        {/* R120-B4 (A2-F2): partial-data hint — over a capped window the
            category tabs (and their counts) only see the newest
            PRODUCTS_SERVER_CAP rows; the search box is the path to older
            products (the orders.tsx honest-count hint idiom). */}
        {catalogCapped && !isLoading && (
          <p className="text-3xs text-muted-foreground">
            الفلاتر تعمل على المنتجات المعروضة فقط (أحدث {PRODUCTS_SERVER_CAP}) — استخدم البحث
            للوصول إلى المنتجات الأقدم
          </p>
        )}

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
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل المنتجات"
            description={loadErrorMessage ?? "حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"}
            onRetry={() => refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Package} title="لا توجد منتجات" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                isSelected={selectedIds.has(product.id)}
                isEditingStock={editingStockId === product.id}
                onToggleSelect={toggleSelect}
                onEdit={startEdit}
                /* setState dispatchers + the useCallbacks above are all
                   referentially stable — no inline arrows here, or every
                   keystroke would bust all 200 memoized cards. */
                onEditStock={setEditingStockId}
                onStockEditDone={stockEditDone}
                onUploadInventory={openInventory}
                onManageVariants={openVariants}
                onArchive={archiveProduct}
              />
            ))}
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

      {/* Variant manager dialog (catalog-recon) — opened per-product from
          «الباقات»; every mutation refetches this list (display price +
          variant badges) via onChanged. */}
      {variantsDialogProduct && (
        <ProductVariantsDialog
          productId={variantsDialogProduct.id}
          productName={variantsDialogProduct.name}
          onClose={() => setVariantsDialogProduct(null)}
          onChanged={invalidate}
        />
      )}
      <ConfirmDialog />
    </AdminLayout>
  );
}
