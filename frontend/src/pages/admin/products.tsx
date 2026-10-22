import { useAdminHeaders } from "@/hooks/useAdminHeaders";
import { useDirtyGuard } from "@/hooks/useDirtyGuard";
import { StockoutRiskPanel } from "@/components/admin/forecast/StockoutRiskPanel";
import { InventoryUploadDialog } from "@/components/admin/InventoryUploadDialog";
// catalog-recon (2026-09-20): per-product variant manager dialog (plan /
// duration / cost rows + engine pricing preview).
import { ProductVariantsDialog } from "@/components/admin/ProductVariantsDialog";
// 93-C7 / C-UX3 (A12 §1.3 + §11.2): the bulk-archive window.confirm is
// replaced by the shared styled confirm.
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
// R123 (E3 item 1): the inline stock edit rides the session-aware wrapper
// (a 401 mid-save now gets the global «انتهت الجلسة» toast + redirect
// instead of a per-row failure toast); the two bulk loops keep their
// mid-loop isAdminUnauthorized shape but now break + try/finally (P3h)
// so the bulk-processing flag always resets.
import { AdminSessionExpiredError, adminFetch, isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAdminProductsTierPriceSweepQueryKey,
  getListAdminProductsQueryKey,
  useAdminProductsTierPriceSweep,
  type AdminProduct,
  type AdminTierPriceSweepFinding,
  useCreateProduct,
  useDeleteProduct,
  useListAdminProducts,
  useUpdateProduct,
} from "@workspace/api-client-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
// R168 (L2): the tier-price audit panel's kind badge + icons (the
// StockoutRiskPanel / orders-row-expansion idioms it rides) + the money
// formatter its evidence rows use.
import { StatusBadge } from "@/components/ui/status-badge";
import { AlertTriangle, ChevronDown, ChevronLeft, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the page's self-contained subcomponents and
// pure helpers moved to @/components/admin/products/* (verbatim moves —
// every state atom, every mutation handler (create/update/archive, the
// two bulk loops, the visibility toggles), the summarizeBulk accounting,
// the SEO-touched submit contract and the dialogs' wiring stay HERE; the
// extracts render the byte-identical DOM they rendered inline yesterday).
// Import surface:
//   • products-meta — the pure vocabulary (EMPTY_FORM + the SEO caps
//     contract, the category maps/option lists, the 200-row server cap,
//     the Arabic plural forms)
//   • ProductsHeader — the honest catalog counter + the «منتج جديد» CTA
//     (openCreate stays here, pristine-baseline reset included)
//   • BulkActionBar — the selection bar; bulkToggleActive / bulkDelete
//     (confirm dialogs + mid-loop 401 guards) stay here
//   • ProductEditorCard — the nine-field create/edit shell; form,
//     formBaseline, seoTouched, handleSubmit, cancelForm, the ⌘S/Escape
//     wiring and both mutations stay here (onFormChange/onSeoTouchedChange
//     are this page's setters passed down)
//   • ProductsToolbar — select-all + the server-side search box + the
//     category chips (the debounce + URL sync stay here)
//   • ProductsGrid — the stale-error banner / skeleton / error-card /
//     empty / grid tree; ProductCard + InlineStockEdit ride along inside
//     it (the R124-I5 memoized card + the row-local stock editor)
import { EMPTY_FORM, PRODUCTS_SERVER_CAP } from "@/components/admin/products/products-meta";
import { BulkActionBar } from "@/components/admin/products/BulkActionBar";
import { ProductEditorCard } from "@/components/admin/products/ProductEditorCard";
import { ProductsGrid } from "@/components/admin/products/ProductsGrid";
import { ProductsHeader } from "@/components/admin/products/ProductsHeader";
import { ProductsToolbar } from "@/components/admin/products/ProductsToolbar";

export default function AdminProductsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("inventory");
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
      enabled: !!adminToken && canView,
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
  // R126-L3 (A4-B-2): stats co-invalidation — every products write path
  // funnels through here (create/update/archive mutations, both bulk
  // loops, stock set-count via stockEditDone, variants dialog via
  // onChanged), and each of them moves stats fields
  // (available_stock / unsold_rows — routes/admin/stats.ts:127-131).
  // One co-invalidation here covers the whole family at once: the
  // acting tab's dashboard + layout stats refresh immediately (the
  // orders/users/tickets idiom); OTHER tabs ride the R126 wave-1
  // backend `admin-stats-update` emits on products writes.
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    // R168 (L2): variant writes can resolve tier-price findings — the
    // audit panel rides the same funnel so a fix disappears immediately.
    queryClient.invalidateQueries({ queryKey: getAdminProductsTierPriceSweepQueryKey() });
  }, [queryClient]);

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
        // R148 (D2): route through getErrorMessage — the R126-L3 guard
        // the two bulk loops below already use. The generated ApiError
        // message glues "HTTP 400 Bad Request: " onto the Arabic server
        // message, which used to land raw in the toast.
        toast({
          title: "خطأ",
          description: getErrorMessage(err),
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
        // R148 (D2): same Arabic guard as createMutation above.
        toast({
          title: "خطأ",
          description: getErrorMessage(err),
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
        // R148 (D2): same Arabic guard as createMutation above.
        toast({
          title: "خطأ",
          description: getErrorMessage(err),
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
      // R163: the feature bullets join the seeded editor (one per line —
      // the R125-I3 write-only-editor lesson applied to the checklist).
      features: (product.features ?? []).join("\n"),
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
  // R168 (L2): the tier-price audit panel's rows carry the sweep finding's
  // product identity, not an AdminProduct — same dialog, narrower input.
  const openVariantsById = useCallback((id: number, name: string) => {
    setVariantsDialogProduct({ id, name });
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
    // R148 (D1): in-flight re-entry guard — the ⌘S shortcut dispatches a
    // submit event that bypasses the (disabled) submit button, so two
    // presses during one POST minted two products (the backend POST
    // carries no Idempotency-Key). preventDefault stays FIRST: the
    // swallowed event must not fall through to a native form GET.
    if (createMutation.isPending || updateMutation.isPending) return;
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
      // R163: the features[] write surface — dirty-aware (the seoTouched
      // idiom, but against the pristine baseline the page already keeps):
      // untouched = OMIT (the wire body stays minimal); edited = SET the
      // parsed bullet list (blank lines dropped); edited-to-empty = CLEAR
      // the checklist (an explicit operator action, never an accident).
      // Create carries no features contract — the field is edit-only.
      ...(editingId && form.features !== formBaseline.features
        ? {
            features: form.features
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0),
          }
        : {}),
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

  // The header's «منتج جديد» CTA (page-owned: the pristine-baseline
  // reset is the 98-F7 create-session contract — the ProductsHeader
  // extract takes a bare onCreate callback).
  const openCreate = () => {
    setShowForm(true);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    // 98-F7 (R98-05): fresh create session starts pristine.
    setFormBaseline({ ...EMPTY_FORM });
    setSeoTouched({ title: false, description: false });
  };

  // R127-B2 (§A — the R126-L9 future-lane note): select-all membership
  // honesty, the same class the orders.tsx select-all had (R126-L3
  // A1-5). The toggle used to branch on a SIZE test
  // (`selectedIds.size === filtered.length`) while the rendered
  // checkbox state (title/icon/text below) uses MEMBERSHIP
  // (`filtered.every((p) => selectedIds.has(p.id))`). The selection
  // legitimately carries ids OUTSIDE the current category tab (rows
  // selected before a chip flip — selections are never pruned on
  // filter change), so the two could disagree: with hidden-but-
  // selected ids and visible-unselected rows the unchecked button
  // CLEARED the selection instead of selecting the visible rows; with
  // an extra hidden id alongside a fully-selected window the checked
  // button re-ran the select branch and the operator could never
  // clear. The toggle now branches on the SAME membership flag it
  // renders (the flag used to live below its consumers — hoisted
  // here, mirroring orders.tsx:1021-1026).
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((p) => p.id)));
  };

  // The toolbar's «مسح» clear (page-owned: both filter atoms reset in
  // one place — the ProductsToolbar extract takes a bare onClearFilters
  // callback).
  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("");
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
          // L13-1 (R143): adminFetch threads the shared 20 s timeout — a
          // stalled link used to keep `bulkProcessing` (and the bulk
          // buttons' disabled state) armed until the browser's ~300 s
          // TCP timeout, one dead row at a time. Bodies/headers/401
          // handling identical.
          const r = await adminFetch(url, { method: "DELETE", headers });
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
              // R126-L3 (A2/A8): route through getErrorMessage — the
              // Arabic guard maps the body's code/error to Arabic and
              // collapses message-less bodies (proxy 502s) to the
              // generic Arabic line instead of a bare English
              // "HTTP 502" inside an Arabic toast.
              reason: getErrorMessage(body),
            });
            continue;
          }
        } catch (e) {
          // L13-1 (R143): adminFetch throws the sentinel AFTER the global
          // toast + redirect — preserve the old mid-loop break (the row
          // is NOT counted as a per-row failure; the loop stops).
          if (e instanceof AdminSessionExpiredError) {
            sessionExpired = true;
            break;
          }
          // R126-L3 (A2/A8): same guard for network-level failures —
          // "Failed to fetch" used to land raw in the summary toast.
          failures.push({ id, reason: getErrorMessage(e) });
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
        // R134 (the R126-A2-9 close-out): the dead `products.find`
        // lookup used to SKIP selected ids outside the loaded window —
        // and summarizeBulk counted the skips as successes (a row
        // selected on page 1, then paged past, "succeeded" without a
        // request). The PATCH goes to the id directly; the server is
        // the guard; every selected id now lands in successes OR
        // failures — never silently in neither.
        const url = `/api/admin/products/${id}`;
        try {
          // L13-1 (R143): adminFetch threads the shared 20 s timeout —
          // same stall bound as bulkDelete above.
          const r = await adminFetch(url, {
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
              // R126-L3 (A2/A8): same Arabic guard as bulkDelete — no
              // bare "HTTP 502" fragments in the summary toast.
              reason: getErrorMessage(body),
            });
          }
        } catch (e) {
          // L13-1 (R143): adminFetch throws the sentinel AFTER the global
          // toast + redirect — preserve the old mid-loop break (the row
          // is NOT counted as a per-row failure; the loop stops).
          if (e instanceof AdminSessionExpiredError) {
            sessionExpired = true;
            break;
          }
          // R126-L3 (A2/A8): network-level failures speak Arabic too.
          failures.push({ id, reason: getErrorMessage(e) });
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

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="inventory" />;
  }

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <ProductsHeader
          catalogCapped={catalogCapped}
          productsCount={products.length}
          searchTerm={debouncedSearch}
          lowStockCount={lowStockCount}
          onCreate={openCreate}
        />

        {/* Stockout-risk forecast panel (011-inventory-demand-forecast).
            Self-hides when the cron has never run or when no products are
            at risk; the inventory-scope gate is BOTH the page-level early
            return and the panel's own query enabled arm (R183). */}
        <StockoutRiskPanel />

        {/* R168 (L2): the tier-price audit panel — the whole-catalog
            read-only twin of the variant dialog's write-path warnings
            (self-hides while loading/on error; empty state on a clean
            catalog). */}
        <TierPriceAuditPanel onOpenVariants={openVariantsById} />

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            processing={bulkProcessing}
            onActivate={() => bulkToggleActive(true)}
            onDeactivate={() => bulkToggleActive(false)}
            onArchive={bulkDelete}
            onClear={() => setSelectedIds(new Set())}
          />
        )}

        {/* Create / Edit form */}
        {showForm && (
          <ProductEditorCard
            editingId={editingId}
            form={form}
            onFormChange={setForm}
            onSeoTouchedChange={setSeoTouched}
            onSubmit={handleSubmit}
            onCancel={cancelForm}
            createPending={createMutation.isPending}
            updatePending={updateMutation.isPending}
          />
        )}

        {/* Filters: search + category */}
        <ProductsToolbar
          isLoading={isLoading}
          filteredCount={filtered.length}
          allFilteredSelected={allFilteredSelected}
          onToggleSelectAll={toggleSelectAll}
          search={search}
          onSearchChange={setSearch}
          categoryFilter={categoryFilter}
          onCategoryChange={setCategoryFilter}
          onClearFilters={clearFilters}
        />

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
        <ProductsGrid
          isLoading={isLoading}
          isError={isError}
          loadedCount={products.length}
          loadErrorMessage={loadErrorMessage}
          onRetry={() => refetch()}
          filtered={filtered}
          selectedIds={selectedIds}
          editingStockId={editingStockId}
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

// ── R168 (L2): the tier-price audit panel ─────────────────────────────────
//
// The StockoutRiskPanel idiom applied to catalog pricing: a read-only,
// collapsible surface over GET /api/admin/products/tier-price-sweep — the
// whole-catalog twin of the R167 write-path warnings the variant dialog
// now toasts. It lives in the page file (not under components/admin/)
// because its act-on affordance is the page's own variantsDialogProduct
// state. Self-hides while loading and on error (the StockoutRiskPanel
// conventions); renders the empty state on a clean catalog; every finding
// row carries the verbatim Arabic copy, a kind badge, the «الباقات»
// affordance, and the expandable variant evidence (the orders-row
// aria-expanded idiom).

function TierPriceAuditPanel({
  onOpenVariants,
}: {
  onOpenVariants: (id: number, name: string) => void;
}) {
  const headers = useAdminHeaders();
  // R183: self-gate (the StockoutRiskPanel idiom) — the sweep endpoint is
  // inventory-scoped; the panel previously relied solely on the page's
  // scope gate. The enabled arm keeps a standalone/scope-less mount
  // fetch-free instead of firing a guaranteed-403 poll.
  const { adminToken, hasAdminPermission } = useAuth();
  const canView = hasAdminPermission("inventory");
  const [collapsed, setCollapsed] = useState(false);
  const query = useAdminProductsTierPriceSweep({
    query: { retry: false, enabled: !!adminToken && canView },
    request: { headers },
  });

  const data = query.data;
  if (query.isLoading || query.isError || !data) return null;

  return (
    <div className="border border-border/60 rounded-2xl bg-card overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-muted/30">
        <button
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 flex-1 text-start group"
        >
          <AlertTriangle className="w-4 h-4 text-status-warning" />
          <h2 className="text-sm font-bold">فحص تسعير الباقات</h2>
          {collapsed ? (
            <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
        <span className="text-2xs text-muted-foreground">
          {/* 96-F7: -u-nu-latn pins Latin digits (the StockoutRiskPanel header idiom). */}
          {`آخر فحص: ${new Date(data.checked_at).toLocaleString("ar-LY-u-nu-latn", {
            hour: "2-digit",
            minute: "2-digit",
            day: "numeric",
            month: "short",
          })}`}
        </span>
        <button
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
          aria-label="تحديث"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
        </button>
      </header>
      {!collapsed && (
        <>
          <div className="px-4 py-1.5 text-2xs text-muted-foreground border-b border-border/60">
            فُحص{" "}
            <span dir="ltr" className="font-mono">
              {data.products_scanned}
            </span>{" "}
            منتجًا و{" "}
            <span dir="ltr" className="font-mono">
              {data.variants_scanned}
            </span>{" "}
            باقة
          </div>
          {data.findings.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              لا توجد ملاحظات تسعير على الكتالوج الحالي
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.findings.map((f) => (
                <TierPriceFindingRow
                  key={`${f.product_id}-${f.kind}-${f.plan_a}-${f.plan_b}-${f.duration ?? ""}`}
                  finding={f}
                  onOpenVariants={onOpenVariants}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function TierPriceFindingRow({
  finding,
  onOpenVariants,
}: {
  finding: AdminTierPriceSweepFinding;
  onOpenVariants: (id: number, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        <StatusBadge
          variant={finding.kind === "equalized" ? "warning" : "low-stock"}
          size="xs"
          className="shrink-0"
        >
          {finding.kind === "equalized" ? "تساوٍ" : "ترتيب معكوس"}
        </StatusBadge>
        <span className="font-bold text-sm truncate flex-1">{finding.product_name}</span>
        <button
          onClick={() => onOpenVariants(finding.product_id, finding.product_name)}
          className="text-2xs text-primary-text hover:underline"
        >
          الباقات
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="أدلة الباقات"
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="text-2xs text-muted-foreground mt-1">{finding.message}</p>
      {open && (
        <ul className="mt-2 rounded-xl border border-border/40 bg-muted/20 p-2 space-y-1">
          {finding.variants.map((v) => (
            <li key={v.id} className="text-2xs flex items-center gap-2">
              <span className="font-semibold">{v.plan_label ?? "الخيار الافتراضي"}</span>
              <span className="text-muted-foreground">{v.duration_label ?? "بدون مدة"}</span>
              <span className="ms-auto font-mono" dir="ltr">
                {formatCurrency(v.price)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
