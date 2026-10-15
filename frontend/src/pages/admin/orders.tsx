import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { AdminSessionExpiredError, adminFetch, isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import { formatCurrency, statusLabel } from "@/lib/utils";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  getListAdminOrdersQueryKey,
  listAdminOrders,
  type AdminOrder,
} from "@workspace/api-client-react";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE) decomposition: the page's self-contained subcomponents and
// pure helpers moved to @/components/admin/orders/* (verbatim moves —
// the money path stays HERE: applyBulkStatus's bulk refund / status
// transitions ride the per-click Idempotency-Key + the 207 partial
// parse + the base-key invalidation; ensureOrderCredentials owns the
// B6-03 decrypt-on-demand cache; every cross-section state atom and
// every mutation/submit handler stay in the page — the extracts render
// the byte-identical DOM they rendered inline yesterday). Import
// surface:
//   • orders-meta / orders-csv / orders-types — the page's pure
//     modules (status/filter/date tables + the refund-failure
//     vocabulary, the CSV ritual, the row/credentials contracts)
//   • OrdersHeader / OrdersFilters — the honest-counts header + the
//     filter row (the setters + the R123 URL sync stay HERE)
//   • OrdersStatsPanel — the collapsible coupon aggregates (the
//     showStats state stays HERE)
//   • BulkActionBar — the bulk menu (applyBulkStatus stays HERE; the
//     ESC-focus triggerRef rides down as a prop)
//   • TableSkeleton / StaleListErrorBanner / OrdersEmptyResults /
//     OrdersTable / MobileOrdersList — the list surfaces
//     (DesktopOrderRow / MobileOrderCard / MaskedCredential ride along
//     inside their consumers)
import {
  DATE_RANGES,
  ORDERS_PAGE_SIZE,
  REFUND_FAILURE_LABELS,
  BULK_SKIPPED_REASON_LABELS,
  STATUS_FILTERS,
  isWithinDays,
} from "@/components/admin/orders/orders-meta";
import { downloadCsv, orderCsvRows } from "@/components/admin/orders/orders-csv";
import type { AdminOrderRow, OrderCredentials } from "@/components/admin/orders/orders-types";
import { BulkActionBar } from "@/components/admin/orders/BulkActionBar";
import { MobileOrdersList } from "@/components/admin/orders/MobileOrdersList";
import { OrdersEmptyResults } from "@/components/admin/orders/OrdersEmptyResults";
import { OrdersFilters } from "@/components/admin/orders/OrdersFilters";
import { OrdersHeader } from "@/components/admin/orders/OrdersHeader";
import { OrdersStatsPanel } from "@/components/admin/orders/OrdersStatsPanel";
import { OrdersTable } from "@/components/admin/orders/OrdersTable";
import { StaleListErrorBanner } from "@/components/admin/orders/StaleListErrorBanner";
import { TableSkeleton } from "@/components/admin/orders/TableSkeleton";

export default function AdminOrdersPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("orders");
  const jsonHeaders = useAdminHeaders({ json: true });
  const headers = useAdminHeaders();
  const [, navigate] = useLocation();
  // 94-C2 (A2 P2-3): the GlobalSearch palette deep-links here via
  // /admin/orders?search=… — useSearch keeps the box in sync on mount
  // AND on same-route navigations.
  const searchParam = useSearch();
  const { toast } = useToast();
  const qc = useQueryClient();
  // R123 (E3 P3a): two-way URL filter sync (?status= / ?days=) — the
  // settings.tsx ?tab= idiom: URL → state on mount/param change, state
  // → URL via replaceState (filter flips don't spam the history stack).
  // A shared orders link can now pin a status/date view.
  const [statusFilter, setStatusFilter] = useState(
    () => new URLSearchParams(window.location.search).get("status") ?? "",
  );
  // 94-C2 (A2 P2-2): search is SERVER-side (?search= LIKE) — the raw
  // input state feeds a 300ms debounce below; only the debounced value
  // enters the query key, so one request per typing pause.
  const [search, setSearch] = useState(
    () => new URLSearchParams(window.location.search).get("search") ?? "",
  );
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState(() => {
    const raw = Number.parseInt(new URLSearchParams(window.location.search).get("days") ?? "0", 10);
    return DATE_RANGES.some((d) => d.days === raw) ? raw : 0;
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showStats, setShowStats] = useState(true);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  // R120-B4 (A2-F19): the bulk-status menu trigger — ESC returns focus
  // here when the menu closes (keyboard users rejoin where they left).
  // R137 (FE): the ref rides down to the BulkActionBar extract as the
  // triggerRef prop (the BalanceCard glowRef idiom) — the Button it
  // anchors is the same DOM node as before.
  const bulkMenuTriggerRef = useRef<HTMLButtonElement>(null);
  // ── B6-03 (R116): credentials-on-demand ──────────────────────────────
  // The list no longer ships decrypted credentials. The plaintext is
  // fetched from GET /api/admin/orders/:id/credentials the FIRST time an
  // order's expansion is opened, then cached per order id for the page's
  // lifetime (re-expansions are instant and never re-hit the audited
  // endpoint). A failure is remembered too — retry spam on a dead
  // endpoint would re-log audit rows for nothing (D-2/R142: the
  // remembering now ends when the row COLLAPSES, so the toast's «حاول
  // فتح الطلب مرة أخرى» is an honest instruction, not a no-op).
  const [credentialsCache, setCredentialsCache] = useState<Map<number, OrderCredentials>>(
    () => new Map(),
  );
  const [failedCredentialIds, setFailedCredentialIds] = useState<Set<number>>(() => new Set());
  const credentialsInFlight = useRef<Set<number>>(new Set());
  // D-2 (R142): the previously-expanded row id — the expand effect below
  // uses it to forget a failed credentials fetch when its row collapses.
  const prevExpandedRowRef = useRef<number | null>(null);

  const ensureOrderCredentials = useCallback(
    async (orderId: number) => {
      if (
        credentialsCache.has(orderId) ||
        failedCredentialIds.has(orderId) ||
        credentialsInFlight.current.has(orderId)
      ) {
        return;
      }
      credentialsInFlight.current.add(orderId);
      try {
        // L13-1 (R143): adminFetch threads the shared 20 s timeout — a
        // stalled link used to leave the row on «جارٍ تحميل بيانات
        // التسليم…» for the browser's ~300 s TCP timeout (the PII read
        // is not money, but the failed-credential state it feeds is the
        // D-2 retry surface). Bodies/headers/401 handling identical.
        const r = await adminFetch(`/api/admin/orders/${orderId}/credentials`, { headers });
        if (isAdminUnauthorized(r, `/api/admin/orders/${orderId}/credentials`)) return;
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        const body = (await r.json().catch(() => null)) as OrderCredentials | null;
        if (!body) throw new Error("bad credentials payload");
        setCredentialsCache((prev) => new Map(prev).set(orderId, body));
      } catch (err) {
        // L13-1 (R143): the expired-session sentinel — the global handler
        // already toasted + redirected; stay quiet (a session expiry is
        // not a per-row credential failure).
        if (err instanceof AdminSessionExpiredError) return;
        setFailedCredentialIds((prev) => new Set(prev).add(orderId));
        toast({
          title: "تعذّر تحميل بيانات التسليم",
          description: "حاول فتح الطلب مرة أخرى",
          variant: "destructive",
        });
      } finally {
        credentialsInFlight.current.delete(orderId);
      }
    },
    [credentialsCache, failedCredentialIds, headers, toast],
  );

  // Expanding a row with credentials triggers the one-time fetch —
  // declared AFTER allOrders is defined (hook order is stable: this is
  // the same position every render).
  // 94-C2 (A2 P1-1): page accumulation lives in useInfiniteQuery — no
  // local `page` state (the round-93 prev/next controls are replaced by
  // the append-in-place «تحميل المزيد» button below).
  // B5-05 (round-92 audit): the raw window.confirm for the destructive
  // bulk actions (refund!) is replaced by the shared styled AlertDialog
  // hook used by admins.tsx / promotions.tsx — same message text.
  const { confirm, ConfirmDialog } = useConfirm();

  const listParams = { search: debouncedSearch.trim() || undefined, limit: ORDERS_PAGE_SIZE };
  const {
    data: ordersPages,
    isLoading,
    // 93-C6 / F-07 (A5 S-2/O-1, round-93): `isError`/`error` were never
    // destructured — a failed load (401/500/network) left data=[] and
    // the page rendered the "لا توجد طلبات" empty state, i.e. a
    // support queue that LOOKED empty during an outage.
    isError,
    error,
    refetch,
    // 94-C2 (A2 P1-1): append controls (fetchNextPage) + the server's
    // implicit "more may exist" flag (a full page).
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AdminOrder[], Error>({
    // Key keeps the "/api/admin/orders" prefix so the existing
    // invalidations (bulk-status, dashboard socket pushes…) still
    // refresh this query; the debounced `search` in the key restarts
    // at page 1 and aborts the in-flight request via the queryFn's
    // AbortSignal (94-C2 debounce + abort, A2 P2-2).
    queryKey: ["/api/admin/orders", "load-more", listParams],
    queryFn: ({ pageParam, signal }) =>
      listAdminOrders({ ...listParams, page: pageParam as number }, { signal, headers }),
    initialPageParam: 1,
    // Frozen contract (A2 P1-1): the body is a plain array with no
    // total meta — a full page means the next page MIGHT exist; the
    // first short/empty page is the definite end.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === ORDERS_PAGE_SIZE ? allPages.length + 1 : undefined,
    enabled: !!adminToken && canView,
    // Round-4 (perf P1-3): the admin-room socket listener invalidates
    // orders on every `admin-stats-update` push — 5-min fallback only.
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });

  // Same relaxed widening the page always used for the delivered-* /
  // coupon_* extra fields the generated AdminOrder type doesn't carry.
  // R118-B2 (A6 F-8): memoized — `.flat()` mints a fresh array identity
  // on every render, which would defeat the useMemo chain below (and
  // every row's `order` prop identity) on each keystroke. ordersPages
  // only changes identity on query updates.
  const allOrders = useMemo(
    () => (ordersPages?.pages ?? []).flat() as AdminOrderRow[],
    [ordersPages],
  );

  // B6-03 (R116): expanding a row whose list entry carries the
  // has_credentials flag triggers the one-time audited fetch. The gate
  // conditions inside ensureOrderCredentials (cache / failed / in-flight)
  // make repeat calls safe no-ops while allOrders identity changes per
  // refetch.
  useEffect(() => {
    const prev = prevExpandedRowRef.current;
    prevExpandedRowRef.current = expandedRow;
    // D-2 (R142): a failed credentials fetch used to be sticky for the
    // page's lifetime — the failure toast said «حاول فتح الطلب مرة
    // أخرى», but ensureOrderCredentials early-returned on the remembered
    // id, so that exact retry was a no-op until a full reload. COLLAPSING
    // the row now forgets the failure: the next expansion re-fires the
    // audited fetch (the B6-03 retry-spam guard stays armed while the
    // row is open — a failure never re-fetches on refetch-driven effect
    // re-runs).
    if (prev !== null && prev !== expandedRow) {
      setFailedCredentialIds((prevSet) => {
        if (!prevSet.has(prev)) return prevSet;
        const next = new Set(prevSet);
        next.delete(prev);
        return next;
      });
    }
    if (expandedRow === null) return;
    const row = allOrders.find((o) => o.id === expandedRow);
    if (row?.has_credentials) {
      void ensureOrderCredentials(row.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedRow, ensureOrderCredentials]);

  // A single short page is the only case where the total is provably
  // known — otherwise the honest count is «عرض N» (A2 P1-1).
  const knownTotal = (ordersPages?.pages.length ?? 0) <= 1 && allOrders.length < ORDERS_PAGE_SIZE;
  const loadErrorMessage = isError ? getErrorMessage(error) : null;

  // ── R118-B2 (A6 F-8): memoized filter/aggregate chain ─────────────
  // The search box is controlled state — every keystroke re-rendered
  // the page and recomputed these chains (statusCounts / byStatus /
  // byDate / todayCount / revenue + coupon aggregates) plus every row
  // subtree for nothing (the server search only runs after the 300ms
  // debounce). All of it is now derived through useMemo keyed on
  // [allOrders, statusFilter, dateRange] so a keystroke skips the work
  // entirely; the memoized row components below skip the DOM side.
  // Lives ABOVE the adminToken early-return (rules of hooks).
  const statusCounts = useMemo(
    () =>
      allOrders.reduce((acc: Record<string, number>, o) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      }, {}),
    [allOrders],
  );

  const filtered = useMemo(() => {
    const byStatus = statusFilter ? allOrders.filter((o) => o.status === statusFilter) : allOrders;
    const byDate = dateRange
      ? byStatus.filter((o) => o.created_at && isWithinDays(o.created_at, dateRange))
      : byStatus;
    // 94-C2 (A2 P2-2): search already ran on the server — only the status
    // tab and date quick-filter stay client-side over the accumulated
    // pages (keeping status local preserves the tab counts' honesty over
    // the loaded set — the risk.tsx P3-1 lesson).
    return byDate;
  }, [allOrders, statusFilter, dateRange]);

  const todayCount = useMemo(
    () =>
      allOrders.filter((o) => {
        if (!o.created_at) return false;
        const d = new Date(o.created_at);
        const now = new Date();
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      }).length,
    // `new Date()` per render would be fine correctness-wise but keeps
    // the memo forever-fresh; one snapshot per allOrders change matches
    // the old behavior (recomputed on data updates).
    [allOrders],
  );

  const totalRevenue = useMemo(
    () => filtered.reduce((sum: number, o) => sum + (Number(o.amount) || 0), 0),
    [filtered],
  );

  // Coupon stats from ALL orders (not filtered) for the overview panel
  const { couponOrders, totalDiscounts, totalRevenueAll, topCoupons, uniqueCouponCount } =
    useMemo(() => {
      const couponOrders = allOrders.filter((o) => o.coupon_code);
      const totalDiscounts = couponOrders.reduce(
        (sum: number, o) => sum + (Number(o.discount_amount) || 0),
        0,
      );
      const totalRevenueAll = allOrders.reduce(
        (sum: number, o) => sum + (Number(o.amount) || 0),
        0,
      );
      // Top coupon codes: { code, uses, totalDiscount }
      const couponMap = couponOrders.reduce(
        (acc: Record<string, { uses: number; totalDiscount: number }>, o) => {
          const c = o.coupon_code as string;
          if (!acc[c]) acc[c] = { uses: 0, totalDiscount: 0 };
          acc[c].uses++;
          acc[c].totalDiscount += Number(o.discount_amount) || 0;
          return acc;
        },
        {},
      );
      const topCoupons = (
        Object.entries(couponMap) as Array<[string, { uses: number; totalDiscount: number }]>
      )
        .map(([code, v]) => ({ code, ...v }))
        .sort((a, b) => b.uses - a.uses)
        .slice(0, 4);
      const uniqueCouponCount = Object.keys(couponMap).length;
      return { couponOrders, totalDiscounts, totalRevenueAll, topCoupons, uniqueCouponCount };
    }, [allOrders]);

  // B5-02 (round-92 audit): the bulk-status endpoint (including bulk
  // refund — a money action) used to complete SILENTLY on success: the
  // error path toasted, the success path only refetched the table. The
  // backend also returns an explicit 207 partial shape when some
  // refunds can't be applied
  // (`{ updated, failed: [{ orderId, code, message }] }` —
  // backend/src/routes/admin/orders.ts); that body was never parsed,
  // so a half-failed batch looked like full success. Both are handled
  // below: a success toast with counts, and per-failure reasons on 207.
  const applyBulkStatus = async (status: string) => {
    if (selectedIds.size === 0) return;
    const isRefund = status === "refunded";
    // 93-C6 / F-07 (A5 O-3): the refund confirm now shows the TOTAL
    // LYD to be returned (computable from the selected rows), not just
    // a count — the money amount is the number an operator verifies.
    const selectedRows = allOrders.filter((o) => selectedIds.has(o.id));
    const totalRefund = selectedRows.reduce((sum: number, o) => sum + (Number(o.amount) || 0), 0);
    const confirmMessage = isRefund
      ? `تأكيد استرداد ${selectedIds.size} طلب؟ سيتم استرداد المبالغ للمستخدمين (إجمالي ${formatCurrency(totalRefund)}).`
      : `تأكيد تغيير حالة ${selectedIds.size} طلب؟`;
    const confirmed = await confirm({
      title: isRefund ? "استرداد جماعي للطلبات" : "تغيير الحالة الجماعي",
      description: confirmMessage,
      confirmLabel: isRefund ? "استرداد" : "تغيير الحالة",
      destructive: isRefund,
    });
    if (!confirmed) return;
    setBulkUpdating(true);
    setBulkStatusOpen(false);
    const requestedCount = selectedIds.size;
    try {
      // F-008 (security audit 004) + 99-C8 (R99-A2 P3 — comment honesty):
      // the key is minted per CLICK (per HTTP attempt — there is no
      // auto-retry, so the two coincide). The middleware layer is best-
      // effort here; the REAL double-refund protection is server-side:
      // RefundService's per-order status-machine guard refuses any order
      // not in a refundable state, so a same-click network replay or an
      // accidental double-click cannot refund twice.
      // L13-1 (R143): adminFetch threads the shared 20 s timeout — the
      // bulk refund/status PATCH is a money mutation whose `bulkUpdating`
      // state armed the BulkActionBar until the browser's ~300 s TCP
      // timeout on a stalled link. Bodies/headers/401 handling identical;
      // the 207 partial branch below parses by hand, untouched.
      const r = await adminFetch("/api/admin/orders/bulk-status", {
        method: "PATCH",
        headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      });
      // 93-C6 / F-07 (A5 S-3): a 401 mid-work is a session expiry, not
      // a retryable failure — the global handler toasts + redirects;
      // no misleading "حاول مرة أخرى" toast on top.
      if (isAdminUnauthorized(r, "/api/admin/orders/bulk-status")) return;
      if (!r.ok) {
        // 93-C6 / F-07 (A5 O-2): the failure body carries the backend
        // code (409 CONCURRENCY_ERROR / 403 RBAC…) — parse it instead
        // of `throw String(r.status)` so the catch can surface the
        // Arabic reason instead of "حاول مرة أخرى" for a conflict the
        // operator cannot retry away.
        const body = (await r.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        throw new Error(getErrorMessage(body) || `فشل تنفيذ العملية (HTTP ${r.status})`);
      }
      // 207 (Multi-Status) — Response.ok is true for it, so the partial
      // body must be parsed explicitly, never swallowed. R151: the body
      // ALSO carries `skipped_*` counts + a `reason` code when the F2/F3
      // guards skip every requested id (updated:0) — the old type
      // discarded them and toasted a green "Updated 0 orders".
      const body = (await r.json().catch(() => null)) as {
        updated?: number;
        failed?: Array<{ orderId: number; code?: string; message?: string }>;
        reason?: string;
        skipped_refunded?: number;
        skipped_blocked_completion?: number;
        skipped_completed_source?: number;
        skipped_missing?: number;
      } | null;
      const updated = body?.updated ?? requestedCount;
      const failed = body?.failed ?? [];
      const totalSkipped =
        (body?.skipped_refunded ?? 0) +
        (body?.skipped_blocked_completion ?? 0) +
        (body?.skipped_completed_source ?? 0) +
        (body?.skipped_missing ?? 0);
      if (failed.length > 0) {
        // RefundService failure codes → Arabic reasons.
        const reasons = failed
          .map(
            (f) =>
              `#${f.orderId}: ${REFUND_FAILURE_LABELS[f.code ?? ""] ?? f.message ?? "سبب غير معروف"}`,
          )
          .join("، ");
        toast({
          title: `تم تحديث ${updated} من ${requestedCount} طلب`,
          description: `فشلت ${failed.length}: ${reasons}`,
          variant: "destructive",
        });
      } else if (updated === 0 && totalSkipped > 0) {
        // R151: every requested id was skipped by a backend guard (F2/F3)
        // — zero rows transitioned. A green "Updated 0 orders" misled the
        // operator into thinking the tool was broken. Surface the exact
        // Arabic reason + the skipped count, destructive tone.
        const reasonLabel = body?.reason
          ? (BULK_SKIPPED_REASON_LABELS[body.reason] ?? body.reason)
          : "لا توجد طلبات قابلة للتحديث";
        toast({
          title: `لم يتم تحديث أي طلب (تخطي ${totalSkipped})`,
          description: reasonLabel,
          variant: "destructive",
        });
      } else {
        // Success feedback parity with the single-approve toast on
        // topups: money actions announce what happened, with counts.
        // `updated < requested` on non-refund statuses means the
        // backend skipped refunded/missing ids — surface the gap.
        const skipped = Math.max(0, requestedCount - updated);
        toast({
          title: isRefund ? `تم استرداد ${updated} طلب` : `تم تحديث حالة ${updated} طلب`,
          description: isRefund
            ? "أُعيدت مبالغ الطلبات إلى محافظ المستخدمين"
            : `${statusLabel(status)}${skipped > 0 ? ` · تخطي ${skipped} طلب` : ""}`,
          variant: "success",
        });
      }
      setSelectedIds(new Set());
      // R124-I5 (A6 F11): the explicit refetch() + the base-key
      // invalidateQueries fired TWO identical list requests per bulk
      // action (the invalidate already re-fetches every active query
      // under the key). The invalidate alone is the refresh — the same
      // single-invalidation shape every other admin page uses
      // (users.tsx / topups.tsx / products.tsx).
      // 93-C6 / F-07: invalidate the BASE key (no params) so every
      // cached page + the dashboard's recent-orders query refresh,
      // not just the current page's exact key.
      qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey() });
    } catch (err) {
      // L13-1 (R143): the expired-session sentinel — the global handler
      // already toasted + redirected; stay quiet (finally still re-arms
      // the BulkActionBar).
      if (err instanceof AdminSessionExpiredError) return;
      toast({
        title: "خطأ",
        // R148 (3-errcopy): route through getErrorMessage — the 207
        // per-row failures above already ride it; the catch's raw
        // extractor leaked network-level English into the Arabic toast.
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  // Keyboard shortcut: / to focus search, Esc to clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as Element)?.tagName)) {
        e.preventDefault();
        document.getElementById("orders-search")?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 94-C2 (A2 P2-2): 300ms debounce feeding the server-side search
  // (same pattern as users.tsx) — one request per typing pause, not per
  // keystroke; the in-flight request is aborted by the query key change
  // (AbortSignal passed through listAdminOrders → customFetch → fetch).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // 94-C2 (A2 P2-3): GlobalSearch deep-links (?search=…) — sync the box
  // when the URL search changes without clobbering local typing (the
  // operator may have edited the box after arriving).
  // R123 (E3 P3a): ?status= / ?days= land the same way — without
  // clobbering a filter the operator already picked locally.
  useEffect(() => {
    const q = new URLSearchParams(searchParam);
    const s = q.get("search") ?? "";
    setSearch((prev) => (prev === s ? prev : s));
    const st = q.get("status") ?? "";
    if (STATUS_FILTERS.some((x) => x.value === st)) {
      setStatusFilter((prev) => (prev === st ? prev : st));
    }
    const rawDays = Number.parseInt(q.get("days") ?? "0", 10);
    const days = DATE_RANGES.some((d) => d.days === rawDays) ? rawDays : 0;
    setDateRange((prev) => (prev === days ? prev : days));
  }, [searchParam]);

  // R123 (E3 P3a): filters → URL (replaceState — flips don't spam the
  // history stack; empty/zero values drop the param entirely).
  const syncFilterParams = (status: string, days: number) => {
    const url = new URL(window.location.href);
    if (status) url.searchParams.set("status", status);
    else url.searchParams.delete("status");
    if (days > 0) url.searchParams.set("days", String(days));
    else url.searchParams.delete("days");
    window.history.replaceState(null, "", url.toString());
  };

  // R137 (FE): the OrdersFilters / OrdersEmptyResults extracts call
  // THESE page-owned handlers — the setters + the URL sync stay HERE
  // (a raw setter must never reach an extract or the URL would desync
  // from the chips).
  const handleStatusFilter = (value: string) => {
    setStatusFilter(value);
    syncFilterParams(value, dateRange);
  };

  const handleDateRange = (days: number) => {
    setDateRange(days);
    syncFilterParams(statusFilter, days);
  };

  // R123 (E3 P3a): the clear-all also clears the URL params.
  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("");
    setDateRange(0);
    syncFilterParams("", 0);
  };

  // Redirect effect AFTER all hooks so hook order is identical every
  // render (rules-of-hooks). The null return below keeps the guard
  // semantics: unauthenticated admins render nothing until the
  // redirect lands.
  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  // R118-B2 (A6 F-8): the row callbacks are useCallback-stable so the
  // memoized row components bail out on keystroke re-renders (selection /
  // expansion flips bust exactly ONE row via its boolean prop).
  // R118 fix: declared BEFORE the !adminToken early return — hooks must
  // run unconditionally (rules-of-hooks); setters are stable so hoisting
  // is behavior-neutral for the authenticated render.
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: number) => {
    setExpandedRow((prev) => (prev === id ? null : id));
  }, []);

  if (!adminToken) return null;

  // R120-B4 (A2-F4): refund visibility follows the backend's OWN gate —
  // the bulk-status PATCH answers 403 for `refunded` unless the acting
  // admin carries the finance scope (routes/admin/orders.ts A6-01). The
  // option is HIDDEN for orders-only operators instead of offered and
  // 403'd mid-flow after the operator already curated a selection.
  const canBulkRefund = hasAdminPermission("finance");

  // R137 (FE): the CSV ritual (downloadCsv) + the row builder
  // (orderCsvRows) moved verbatim to components/admin/orders/orders-csv;
  // the two handlers below stay HERE — they close over the live
  // filtered / selectedIds.
  const exportCSV = () => {
    downloadCsv(orderCsvRows(filtered), `orders_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // R126-L3 (A4 quick-win): select-all membership honesty. The branch
  // condition used to compare `selectedIds.size === filtered.length` —
  // a SIZE test — while the rendered checkbox state one line down
  // (and its aria-pressed) uses MEMBERSHIP (`filtered.every(o =>
  // selectedIds.has(o.id))`). The selection legitimately carries ids
  // OUTSIDE the current filter (rows selected before a search/status
  // narrow), so the two could disagree: with 3 hidden-but-selected ids
  // and 3 visible-unselected rows the unchecked button CLEARED the
  // selection instead of selecting the visible rows; with extra hidden
  // ids alongside a fully-selected window the checked button re-ran the
  // select branch (a no-op set) and the operator could never deselect.
  // The toggle now branches on the SAME membership flag it renders.
  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((o) => o.id)));
  };

  const exportSelected = () => {
    const sel = filtered.filter((o) => selectedIds.has(o.id));
    downloadCsv(orderCsvRows(sel), `orders_selected_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="orders" />;
  }

  return (
    <AdminLayout onRefresh={() => refetch()}>
      <div className="space-y-5">
        {/* Header — R137 (FE): the markup moved verbatim to
            components/admin/orders/OrdersHeader; the search state and
            the export handlers stay HERE. */}
        <OrdersHeader
          knownTotal={knownTotal}
          allOrdersCount={allOrders.length}
          todayCount={todayCount}
          filteredCount={filtered.length}
          totalRevenue={totalRevenue}
          search={search}
          onSearchChange={setSearch}
          onClearSearch={() => setSearch("")}
          selectedCount={selectedIds.size}
          onExport={selectedIds.size > 0 ? exportSelected : exportCSV}
        />

        {/* Stats Panel — R137 (FE): the markup moved verbatim to
            OrdersStatsPanel; the aggregates + the showStats state stay
            HERE. */}
        {!isLoading && allOrders.length > 0 && (
          <OrdersStatsPanel
            showStats={showStats}
            onToggleStats={() => setShowStats((s) => !s)}
            couponCount={couponOrders.length}
            totalDiscounts={totalDiscounts}
            totalRevenueAll={totalRevenueAll}
            allOrdersCount={allOrders.length}
            topCoupons={topCoupons}
            uniqueCouponCount={uniqueCouponCount}
            knownTotal={knownTotal}
          />
        )}

        {/* Bulk action bar — R137 (FE): the markup moved verbatim to
            BulkActionBar; applyBulkStatus (the refund money path), the
            menu state and the ESC-focus ref stay HERE. */}
        {selectedIds.size > 0 && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            open={bulkStatusOpen}
            onToggleMenu={() => setBulkStatusOpen((v) => !v)}
            onCloseMenu={() => setBulkStatusOpen(false)}
            bulkUpdating={bulkUpdating}
            canBulkRefund={canBulkRefund}
            triggerRef={bulkMenuTriggerRef}
            onApplyStatus={applyBulkStatus}
            onExportSelected={exportSelected}
            onClearSelection={() => setSelectedIds(new Set())}
          />
        )}

        {/* Filters row — R137 (FE): the markup moved verbatim to
            OrdersFilters; the setters + the R123 URL sync stay HERE. */}
        <OrdersFilters
          search={search}
          statusFilter={statusFilter}
          dateRange={dateRange}
          statusCounts={statusCounts}
          allOrdersCount={allOrders.length}
          filteredCount={filtered.length}
          onSelectStatus={handleStatusFilter}
          onSelectDays={handleDateRange}
          onClearAll={clearAllFilters}
        />

        {/* 93-C6 / F-07 (A5 S-2): refresh of an already-rendered list
            failed — keep the stale rows, surface the failure inline
            (referrals.tsx banner idiom) instead of pretending nothing
            happened. — R137 (FE): moved verbatim to
            StaleListErrorBanner. */}
        {isError && allOrders.length > 0 && (
          <StaleListErrorBanner message={loadErrorMessage} onRetry={() => refetch()} />
        )}

        {/* Table */}
        {isLoading ? (
          <TableSkeleton />
        ) : isError && allOrders.length === 0 ? (
          /* 93-C6 / F-07 (A5 S-2): a failed load is NOT an empty store.
             The referrals.tsx error-card idiom — an outage/expired
             session previously masqueraded as "لا توجد طلبات" and the
             header told the operator the support queue was empty. */
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل الطلبات"
            description={loadErrorMessage ?? "حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"}
            onRetry={() => refetch()}
          />
        ) : filtered.length === 0 ? (
          /* R137 (FE): the two honest zero-result states moved verbatim
             to OrdersEmptyResults (the R115 A9 P2 partial-data
             distinction + the definite EmptyState). */
          <OrdersEmptyResults
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            isLoading={isLoading}
            onLoadMore={() => void fetchNextPage()}
            search={search}
            statusFilter={statusFilter}
            dateRange={dateRange}
            onClearFilters={clearAllFilters}
          />
        ) : (
          <>
            {/* Desktop table — R137 (FE): moved verbatim to
                OrdersTable (DesktopOrderRow rides along inside it). */}
            <OrdersTable
              filtered={filtered}
              selectedIds={selectedIds}
              expandedRow={expandedRow}
              credentialsCache={credentialsCache}
              failedCredentialIds={failedCredentialIds}
              allFilteredSelected={allFilteredSelected}
              onToggleSelectAll={toggleSelectAll}
              onToggleSelect={toggleSelect}
              onToggleExpand={toggleExpand}
              search={search}
              knownTotal={knownTotal}
              totalRevenue={totalRevenue}
            />

            {/* Mobile card list — R137 (FE): moved verbatim to
                MobileOrdersList (MobileOrderCard rides along inside
                it). */}
            <MobileOrdersList
              filtered={filtered}
              selectedIds={selectedIds}
              expandedRow={expandedRow}
              credentialsCache={credentialsCache}
              failedCredentialIds={failedCredentialIds}
              onToggleSelect={toggleSelect}
              onToggleExpand={toggleExpand}
            />

            {/* 94-C2 (A2 P1-1): "load more" appends the next page in
                place (frozen contract: ?page=N+1&limit=…, body stays a
                plain array) — replacing the round-93 page-swapping
                controls so accumulated rows and their selections
                survive. The button hides once a short page arrives. */}
            {hasNextPage && (
              <div className="flex justify-center pt-1">
                <LoadMoreButton
                  spinner={RefreshCw}
                  busy={isFetchingNextPage}
                  disabled={isLoading}
                  onClick={() => void fetchNextPage()}
                />
              </div>
            )}
          </>
        )}
      </div>
      <ConfirmDialog />
    </AdminLayout>
  );
}
