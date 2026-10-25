import { EmptyState } from "@/components/admin/EmptyState";
import { useConfirm } from "@/hooks/useConfirm";
import { useAdminHeaders } from "@/hooks/useAdminHeaders";
import { useDirtyGuard } from "@/hooks/useDirtyGuard";
import { useToast } from "@/hooks/useToast";
// R123 (E3 item 1): the four raw fetches ride the session-aware wrapper
// — this is the page that made admin-session.ts's /api/coupons/admin
// 401 extension (isAdminApiUrl) LIVE: a finance cookie expiring mid-work
// now gets the global «انتهت الجلسة» toast + redirect instead of a
// per-action «فشلت العملية» retry-loop toast. adminFetchJson also owns
// the ok-guard + safe error-body parse, so the old unguarded r.json()
// on error paths (English SyntaxError on a non-JSON 502) is gone.
import { AdminSessionExpiredError, adminFetchJson } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency, localDateTimeToUtcIso } from "@/lib/utils";
import { AlertCircle, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
// R123 (E3 P3a): two-way URL sync — useSearch re-renders on ?sort=
// changes (the users.tsx ?tier=/?sort= idiom).
import { useLocation, useSearch } from "wouter";
// R160: the shared chips primitive (the users panel's client-side sort
// dialect — the 44px touch floor is baked in).
import { FilterTabs } from "@/components/ui/filter-tabs";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the money-discount page's presentational
// sections and pure metadata moved to @/components/admin/coupons/*
// (verbatim moves — the money path stays HERE: the coupons list fetch,
// handleCreate (the create POST with the 110-M parity guards + the
// localDateTimeToUtcIso TZ conversion), handleToggle (the activate/
// deactivate PATCH) and handleDelete (the confirm-gated soft-archive
// DELETE), plus every form/busy atom; the extracts render the
// byte-identical DOM they rendered inline yesterday). Import surface:
//   • coupons-meta — the pure module (the Coupon/CreateForm contracts,
//     the EMPTY_FORM seed, the 10,000 LYD MAX_FIXED_COUPON_VALUE bound)
//   • CouponsHeader — h1 + «كوبون جديد» CTA + the three-stat strip
//   • CreateCouponDialog — the create shell (page-owned form/valueError
//     atoms ride down; submit fires through the page's handleCreate)
//   • CouponsTable — the responsive rows + toggle/archive actions
//   • CouponsTableSkeleton — the page-shaped loading skeleton
import {
  COUPON_SORT_CHIPS,
  EMPTY_FORM,
  isCouponSort,
  MAX_FIXED_COUPON_VALUE,
  type Coupon,
  type CreateForm,
} from "@/components/admin/coupons/coupons-meta";
import { CouponsHeader } from "@/components/admin/coupons/CouponsHeader";
import { CreateCouponDialog } from "@/components/admin/coupons/CreateCouponDialog";
import { CouponsTable } from "@/components/admin/coupons/CouponsTable";
import { CouponsTableSkeleton } from "@/components/admin/coupons/CouponsTableSkeleton";

// R186 (C-F8): the list's TanStack Query key — the documented base key
// every invalidation (this page's mutations, future socket pushes) keys
// off, mirroring the orders/topups/users "/api/admin/…" convention.
const COUPONS_ADMIN_QUERY_KEY = ["/api/coupons/admin"] as const;

export default function AdminCouponsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("finance");
  const [, navigate] = useLocation();
  // R123 (E3 P3a): the URL is the second source of truth for the sort
  // (see the sync effect below).
  const searchParam = useSearch();
  const { toast } = useToast();
  // 93-C7 / C-UX3 (A12 §1.3 + A5 C-1): the raw window.confirm on
  // coupon delete is replaced by the shared styled confirm — the
  // message now also NAMES the coupon (code + value), which the
  // native confirm never did.
  const { confirm, ConfirmDialog } = useConfirm();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  // 110-M (109-m P3): inline validation error for the value field (see
  // the handleCreate parity guards) — cleared on any value/type edit.
  const [valueError, setValueError] = useState<string | null>(null);
  // R187 (D-F5): the per-row busy atoms are Sets now (the topups
  // processingIds idiom) — the single-id models re-enabled row A's
  // spinner the moment row B's action started, and A's finally then
  // cleared B's mid-flight busy. Each mutation marks its OWN id and
  // clears it — and only it — in its finally. Two sets (not one): the
  // toggle and archive buttons each own their spinner identity.
  const [togglingIds, setTogglingIds] = useState<Set<number>>(() => new Set());
  const markToggling = (id: number) =>
    setTogglingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  const clearToggling = (id: number) =>
    setTogglingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  // R125-I3 (A2-16): per-row busy guard for the archive DELETE — a
  // double-click fired two DELETEs; the second 404'd and stacked an
  // error toast on top of the success toast.
  const [archivingIds, setArchivingIds] = useState<Set<number>>(() => new Set());
  const markArchiving = (id: number) =>
    setArchivingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  const clearArchiving = (id: number) =>
    setArchivingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  // R160 (coupons sort affordance): the CLIENT-side ?sort= state — the
  // admin list API returns the ENTIRE capped list (≤200) in one fetch,
  // so the sort ranks the full dataset in memory (the users-directory
  // precedent; a server-side param would be indirection with zero user
  // value). Same two-way ?sort= sync discipline as users.tsx; invalid
  // deep-link values degrade to the default ("" → the API's order).
  const [sortBy, setSortBy] = useState(() => {
    const s = new URLSearchParams(window.location.search).get("sort") ?? "";
    return isCouponSort(s) ? s : "";
  });

  // 98-F7 (R98-05): dirty-state guard — a half-filled coupon form is
  // un-submitted work, so a refresh/tab-close mid-edit (or with a
  // dismissed-but-surviving draft, the 93-C7/C-UX3 behavior) prompts
  // before silently destroying it. Identity compare vs the module-level
  // EMPTY_FORM constant is exact: useState seeds it, setForm(EMPTY_FORM)
  // on success resets it, every user keystroke mints a new object.
  // SPA route-leave interception stays a documented residual
  // (see use-dirty-guard.ts).
  useDirtyGuard(form !== EMPTY_FORM);

  // 93-C7 / C-UX3 (A5 A-3 header drift): the hand-built
  // `Authorization: adminToken ? Bearer : ""` map is swapped for the
  // shared hook (empty-Bearer when logged out is neutralized centrally,
  // and the 401 session-expiry observer rides along).
  const headers = useAdminHeaders({ json: true });

  // R186 (C-F8): the list rides TanStack Query (the last hand-rolled
  // useState+fetch admin-core list) — the 5-minute poll fallback + the
  // `enabled` token/scope gate every sibling page rides, so another
  // admin's coupon writes reach an open tab of this page without a
  // manual refresh (the query cache + this page's mutations share the
  // COUPONS_ADMIN_QUERY_KEY base). The old silent/visible reload pair
  // maps to TanStack's own first-load isLoading vs background-refetch
  // semantics: the skeleton shows only before any data exists; a
  // refetch keeps the rendered rows standing while it lands.
  const queryClient = useQueryClient();
  const {
    data: couponsData,
    isLoading: loading,
    isError: couponsQueryError,
    error: couponsError,
    refetch: refetchCoupons,
  } = useQuery<Coupon[]>({
    queryKey: COUPONS_ADMIN_QUERY_KEY,
    queryFn: () => adminFetchJson<Coupon[]>("/api/coupons/admin", { headers }),
    enabled: !!adminToken && canView,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });
  // R186 (C-F8): the empty-list fallback gets a memoized identity so
  // the sortedCoupons deps below stay stable while the query is loading
  // (a fresh []  per render would defeat the memo every frame).
  const coupons = useMemo(() => couponsData ?? [], [couponsData]);
  // Round-4 (org §2/§6a): the load failure surfaces as the inline
  // banner below (a toast on every 5-min poll failure would be noise —
  // the banner + its retry carry the recovery).
  const loadError = couponsQueryError ? getErrorMessage(couponsError) : null;

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  // R123 (E3 P3a): URL → sort (a ?sort= change lands without clobbering
  // a sort the operator already picked locally — the users.tsx
  // contract). An invalid value degrades to the API's default ordering.
  useEffect(() => {
    const q = new URLSearchParams(searchParam);
    const s = q.get("sort") ?? "";
    const sort = isCouponSort(s) ? s : "";
    setSortBy((prev) => (prev === sort ? prev : sort));
  }, [searchParam]);

  // R160: sort flips write ?sort= back via replaceState (the users.tsx
  // syncFilterParams discipline — flips don't spam the history stack).
  const handleSortBy = (value: string) => {
    setSortBy(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("sort", value);
    else url.searchParams.delete("sort");
    window.history.replaceState(null, "", url.toString());
  };

  // R160: the in-memory ordering over the FULL fetched list (the users
  // page's `sorted` memo idiom). "" and created_at:desc keep the API
  // array as-is — the server order IS created_at DESC, and re-sorting
  // locally could reshuffle its unspecified ties. The value sorts
  // rank by the raw numeric `value` (what the الخصم column renders).
  const sortedCoupons = useMemo(() => {
    if (sortBy === "" || sortBy === "created_at:desc") return coupons;
    const dir = sortBy.endsWith(":asc") ? 1 : -1;
    const byValue = sortBy.startsWith("value");
    return [...coupons].sort((a, b) =>
      byValue
        ? (a.value - b.value) * dir
        : (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir,
    );
  }, [coupons, sortBy]);

  const handleCreate = async () => {
    if (!form.code.trim()) {
      toast({ title: "خطأ", description: "رمز الكوبون مطلوب", variant: "destructive" });
      return;
    }

    const value = parseFloat(form.value);
    if (isNaN(value) || value <= 0) {
      toast({ title: "خطأ", description: "قيمة الخصم غير صالحة", variant: "destructive" });
      return;
    }

    // 110-M (109-m P3): parity guards — the exact bounds the backend
    // create route enforces (percentage < 100, value <= 10,000 LYD),
    // blocked here with an inline Arabic error BEFORE the round-trip.
    // The >= 100 wording matches the server's 400 message verbatim.
    if (form.type === "percentage" && value >= 100) {
      setValueError("نسبة الخصم يجب أن تكون أقل من 100% (السعر لا يمكن أن يصل إلى صفر)");
      return;
    }
    if (value > MAX_FIXED_COUPON_VALUE) {
      setValueError(
        `قيمة الخصم يجب ألا تتجاوز ${MAX_FIXED_COUPON_VALUE.toLocaleString("en-US")} د.ل`,
      );
      return;
    }

    // R187 (D-F7): the remaining server bounds (routes/coupons.ts) get
    // field-specific Arabic guards BEFORE the round-trip — the old path
    // surfaced these only as the generic «بيانات غير صالحة» 400 toast.
    if (form.min_order_amount) {
      const minOrder = parseFloat(form.min_order_amount);
      if (isNaN(minOrder) || minOrder < 0 || minOrder > 1_000_000) {
        toast({
          title: "خطأ",
          description: "الحد الأدنى للطلب يجب أن يكون بين 0 و 1,000,000 د.ل",
          variant: "destructive",
        });
        return;
      }
    }
    if (form.max_uses) {
      const maxUses = Number.parseInt(form.max_uses, 10);
      if (isNaN(maxUses) || maxUses < 1 || maxUses > 1_000_000) {
        toast({
          title: "خطأ",
          description: "الحد الأقصى للاستخدام يجب أن يكون عددًا صحيحًا بين 1 و 1,000,000",
          variant: "destructive",
        });
        return;
      }
    }

    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value,
        min_order_amount: form.min_order_amount ? parseFloat(form.min_order_amount) : 0,
        max_uses: form.max_uses ? parseInt(form.max_uses) : null,
        // 93-C7 / C-UX4 (A5 C-2 + A12 §11.2): `datetime-local` values are
        // NAIVE (no timezone). Sent raw, the UTC server reads the
        // operator's local wall-clock as UTC — a coupon meant to die at
        // 23:59 Libya time stayed redeemable until 01:59/02:59 the next
        // day (money leak: customers kept buying under a discount the
        // admin believed had ended). localDateTimeToUtcIso (the shared
        // helper C6 extracted from promotions.tsx's correct pattern)
        // re-encodes the intended instant as a true UTC ISO string.
        expires_at: localDateTimeToUtcIso(form.expires_at),
        description: form.description || null,
      };
      const result = await adminFetchJson<{ code: string }>("/api/coupons/admin", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      // R124-I5 (A6 F1): success variant.
      toast({ title: "تم إنشاء الكوبون", description: `رمز: ${result.code}`, variant: "success" });
      setShowCreate(false);
      // Form resets ONLY on success (93-C7 / C-UX3): previously every
      // dismiss path (backdrop click, X, إلغاء) wiped a half-filled
      // form — the exact A12 F-01 data-loss class. A dismissed draft
      // now survives reopening the dialog.
      setForm(EMPTY_FORM);
      // 110-M (109-m P3): the guard error dies with the form it belonged
      // to.
      setValueError(null);
      // R186 (C-F8): the query cache refreshes off the shared base key
      // (was fetchCoupons(true) — the silent refetch kept rows standing,
      // exactly what a background query refetch does by construction).
      void queryClient.invalidateQueries({ queryKey: COUPONS_ADMIN_QUERY_KEY });
    } catch (err: unknown) {
      // R123 (E3 item 1): 401 = session expiry — the global handler
      // already toasted + redirected; no generic error toast on top.
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "خطأ",
        // R148 (3-errcopy): route through getErrorMessage — the same
        // routing the load path above uses; network-level English
        // collapses to Arabic instead of landing raw in the toast.
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (coupon: Coupon) => {
    // R187 (D-F5): mark THIS row busy (the Set adds its own id).
    markToggling(coupon.id);
    try {
      await adminFetchJson(`/api/coupons/admin/${coupon.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ is_active: !coupon.is_active }),
      });
      // R186 (C-F8): invalidate the shared base key (see handleCreate).
      void queryClient.invalidateQueries({ queryKey: COUPONS_ADMIN_QUERY_KEY });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "خطأ",
        // R148 (3-errcopy): route through getErrorMessage (see create).
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      // R187 (D-F5): clears OWN id only — another row's in-flight
      // action keeps its busy state.
      clearToggling(coupon.id);
    }
  };

  const handleDelete = async (coupon: Coupon) => {
    // 93-C7 / C-UX3 (A5 C-1): the native confirm named NO coupon — an
    // admin could disable the wrong row on a touch screen. The styled
    // confirm now shows code + value.
    // R125-I3 (A2-16): honest verb — DELETE /api/coupons/admin/:id is a
    // SOFT ARCHIVE (routes/coupons.ts sets isActive:false, audits
    // coupon.archive; PATCH can resurrect the row), NOT a hard delete.
    // The button said «حذف» while the confirm said «تعطيل» — every
    // surface now says «أرشفة».
    const confirmed = await confirm({
      title: "أرشفة الكوبون؟",
      description: `سيتم أرشفة الكوبون ${coupon.code} (${
        coupon.type === "percentage" ? `${coupon.value}%` : formatCurrency(coupon.value)
      }) — يتوقف قبوله فوراً، ويبقى في السجل ويمكن استعادته لاحقاً.`,
      confirmLabel: "أرشفة",
      destructive: true,
    });
    if (!confirmed) return;
    // R187 (D-F5): mark THIS row busy (the Set adds its own id).
    markArchiving(coupon.id);
    try {
      await adminFetchJson(`/api/coupons/admin/${coupon.id}`, { method: "DELETE", headers });
      // R186 (C-F8): invalidate the shared base key (see handleCreate).
      void queryClient.invalidateQueries({ queryKey: COUPONS_ADMIN_QUERY_KEY });
      // R124-I5 (A6 F1): success variant. R125-I3 (A2-16): the toast
      // names the ARCHIVE outcome, matching what the API did.
      toast({ title: "تمت أرشفة الكوبون", variant: "success" });
    } catch (err: unknown) {
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "خطأ",
        // B14-11 (R127-L11, same-file cheap pass): unified to the file's
        // majority fallback «فشلت العملية» (:255/:276) — the cross-repo
        // fallback canon decision stays deferred to R128 per B14's
        // batching.
        // R148 (3-errcopy): the raw extractor retired — getErrorMessage
        // (see create) collapses network-level English to Arabic.
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      // R187 (D-F5): clears OWN id only (the Set model).
      clearArchiving(coupon.id);
    }
  };

  const activeCount = coupons.filter((c) => c.is_active).length;
  const totalUsed = coupons.reduce((a, c) => a + c.used_count, 0);
  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="finance" />;
  }

  return (
    <AdminLayout onRefresh={() => void refetchCoupons()}>
      <div className="space-y-5">
        <CouponsHeader
          couponsCount={coupons.length}
          activeCount={activeCount}
          totalUsed={totalUsed}
          onCreate={() => setShowCreate(true)}
        />

        {/* Create modal — the shell renders the shared AppDialog (93-C7
            / C-UX3 A12 §11.2, H5); the form atom, the valueError guard
            and the money-discount POST stay page-owned above. */}
        <CreateCouponDialog
          open={showCreate}
          onOpenChange={setShowCreate}
          form={form}
          setForm={setForm}
          creating={creating}
          valueError={valueError}
          setValueError={setValueError}
          onSubmit={handleCreate}
        />

        {/* R160 (coupons sort affordance): the shared FilterTabs chips
            bar — ONE control for both breakpoints (the surface below is
            the R-140-l frozen DIV-GRID, so there is no th to carry
            aria-sort; the users directory's client-side sort rides the
            same chips dialect). The state + the ?sort= write-back stay
            page-owned. */}
        {!loading && coupons.length > 0 && (
          <FilterTabs
            variant="chips"
            ariaLabel="ترتيب الكوبونات"
            value={isCouponSort(sortBy) ? sortBy : "created_at:desc"}
            onSelect={handleSortBy}
            items={COUPON_SORT_CHIPS}
          />
        )}

        {/* Table */}
        {loading ? (
          <CouponsTableSkeleton />
        ) : (
          <>
            {/* Failure banner: shown ABOVE whatever data we already have —
                a failed refresh (or initial load) never blanks a list the
                admin was already looking at. */}
            {loadError && (
              <div
                role="alert"
                /* R139 (precision): the load-failure banner joins the
                   r138 calm-error register (the ChartErrorBanner
                   idiom): the frame drops its status-error/10 + /25
                   red wall for the card family's resting chrome
                   (bg-card + border-border/60 + rounded-2xl — the
                   same shape as the table it sits above), the error
                   tone concentrates in the icon stage (an error/8
                   fill + /22 edge + full-ink glyph — the ONE red
                   accent on the card), the message moves to the /80
                   foreground headline ink and the retry keeps the
                   error ink; the retry's hand-rolled press-spring
                   retires with the wall (the idiom's retry is a
                   quiet underline). mb-4 layout + role/onClick are
                   byte-identical. */
                className="mb-4 p-4 rounded-2xl bg-card border border-border/60 flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-4 h-4 text-status-error" />
                </div>
                <span className="min-w-0 text-sm font-bold text-foreground/80">{loadError}</span>
                <button
                  type="button"
                  onClick={() => void refetchCoupons()}
                  className="ms-auto shrink-0 text-xs font-bold text-status-error underline underline-offset-2 hover:opacity-80"
                >
                  إعادة المحاولة
                </button>
              </div>
            )}
            {coupons.length === 0 && !loadError ? (
              <EmptyState
                icon={Tag}
                title="لا توجد كوبونات بعد"
                action={
                  <button
                    onClick={() => setShowCreate(true)}
                    /* R139 (precision): the exit link rides the
                       text-safe brand ink (--primary-text — the
                       A6-B6 rule: raw primary measured under the
                       text floor) + the quiet link register the
                       tickets empty branches use; the hand-rolled
                       press-spring retires with the raw ink. */
                    className="text-xs text-primary-text hover:underline"
                  >
                    + إنشاء أول كوبون
                  </button>
                }
              />
            ) : coupons.length > 0 ? (
              <CouponsTable
                coupons={sortedCoupons}
                activeCount={activeCount}
                togglingIds={togglingIds}
                archivingIds={archivingIds}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ) : null}
          </>
        )}
      </div>
      <ConfirmDialog />
    </AdminLayout>
  );
}

// AUD103-6-F2 (r103): admin form labels programmatically associated with their controls.
