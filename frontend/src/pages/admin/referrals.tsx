import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { StaleListErrorBanner } from "@/components/admin/orders/StaleListErrorBanner";
import { EmptyState } from "@/components/admin/EmptyState";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import { formatCurrency } from "@/lib/utils";
// R127-L1 (B1 §3.3): the list + credit ride the generated client from
// the batch-1 spec exposure — useListAdminReferrals (params in the
// queryKey) + creditReferral. The R98-02 seq/abort state machine and
// the 300ms debounce's AbortController are now TanStack-native: a
// filter/keystroke flip swaps queries and the stale response can only
// land in the OLD key's cache — last-REQUEST wins (the security.tsx
// R126-L8b template, 1:1). customFetch owns the ok-guard + the global
// 401 observer, and the error paths speak getErrorMessage (ApiError
// fluently — Arabic body first, HTTP-prefix stripped).
import {
  creditReferral,
  getListAdminReferralsQueryKey,
  useListAdminReferrals,
  type ListAdminReferralsStatus,
} from "@workspace/api-client-react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Gift, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";
import { AdminScopeGate } from "../../components/admin/AdminScopeGate";
// R137 (FE decomposition): the referral page's presentational sections
// and pure metadata moved to @/components/admin/referrals/* (verbatim
// moves — the money path stays HERE: the params-in-queryKey list query
// with its 300ms debounce race guard, and handleCredit (the
// confirm-gated, idempotency-keyed points-mint POST + the base-key
// invalidation), plus every search/filter/busy atom; the extracts render
// the byte-identical DOM they rendered inline yesterday). Import surface:
//   • referrals-meta — the pure module (the ReferralRow alias + the
//     re-exported generated stats/top-referrer contracts, the 401
//     predicate, STATUS_FILTERS, the --tier-* medal trio, the 200-row
//     server-cap mirror)
//   • ReferralsHeader — h1 + the «تحديث» refetch CTA
//   • ReferralsStats — the four-stat strip (hidden until first load)
//   • TopReferrersList — the medal leaderboard
//   • ReferralsFilters — the search box + the status chip bar (the
//     page-owned search/statusFilter atoms ride down)
//   • ReferralsTable — the md header + the memoized rows + the honest
//     server-cap footer (ReferralRowItem is its nested consumer)
//   • ReferralsTableSkeleton — the page-shaped loading skeleton
import {
  type ReferralRow,
  isSessionExpiredError,
} from "@/components/admin/referrals/referrals-meta";
import { ReferralsHeader } from "@/components/admin/referrals/ReferralsHeader";
import { ReferralsStats } from "@/components/admin/referrals/ReferralsStats";
import { TopReferrersList } from "@/components/admin/referrals/TopReferrersList";
import { ReferralsFilters } from "@/components/admin/referrals/ReferralsFilters";
import { ReferralsTable } from "@/components/admin/referrals/ReferralsTable";
import { ReferralsTableSkeleton } from "@/components/admin/referrals/ReferralsTableSkeleton";

export default function AdminReferralsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  // R134 (A3-F1): the scope gate — see components/admin/AdminScopeGate.tsx.
  const canView = hasAdminPermission("users");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  // R127-L1 (B1 §3.3): the 300ms debounce survives as the topups.tsx
  // idiom (search → debouncedSearch → params) — keystroke PAUSES drive
  // the refetch, and the params-in-key swap kills the in-flight
  // predecessor request structurally (no manual AbortController).
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [crediting, setCrediting] = useState<number | null>(null);

  // 93-C6 / F-07 (A5 RE-1): the credit action gets a confirmation
  // dialog (useConfirm idiom) — see handleCredit below.
  const { confirm, ConfirmDialog } = useConfirm();

  const headers = useAdminHeaders();

  // R127-L1 (B1 §3.3): the list rides useListAdminReferrals — the
  // filters sit in the queryKey, so every status/keystroke flip is a
  // fresh query and the stale response can only land in the OLD key's
  // cache (the R98-02 last-REQUEST-wins contract, now structural). The
  // B5-03 contract is preserved: a failed load surfaces as the error
  // card (never the false «لا توجد إحالات» empty state), and a 401 is
  // the global handler's business — quiet locally.
  const referralsParams = {
    status: (statusFilter || undefined) as ListAdminReferralsStatus | undefined,
    search: debouncedSearch.trim() || undefined,
  };
  const listQuery = useListAdminReferrals(referralsParams, {
    query: {
      queryKey: getListAdminReferralsQueryKey(referralsParams),
      enabled: !!adminToken && canView,
      // Old-rows-stay parity: while a flipped filter's window is in
      // flight, the PREVIOUS rows keep rendering — no skeleton flash,
      // no false «لا توجد إحالات» between filters (security.tsx:87).
      placeholderData: keepPreviousData,
    },
    request: { headers },
  });

  // B5-03 (round-92 audit) preserved: the distinct error surface — the
  // initial load renders the error card, a refresh of an
  // already-rendered list keeps the stale rows + the inline banner.
  // The first-load skeleton stands only while no window has settled
  // (isPending; the placeholder above covers later flips).
  const data = listQuery.data ?? null;
  const loading = listQuery.isPending;
  const loadError =
    listQuery.isError && !isSessionExpiredError(listQuery.error)
      ? getErrorMessage(listQuery.error)
      : null;

  useEffect(() => {
    if (!adminToken) navigate("/admin/login");
  }, [adminToken, navigate]);

  // R124-I5 (A6 F4 — R118-B2): useCallback-stable so the memoized
  // ReferralRowItem rows bail out on search keystrokes. R127-L1: the
  // credit POST rides the generated creditReferral fetcher (body-less
  // POST, byte-compatible with the old hand-rolled call) — the
  // idempotency key rides options.headers exactly like topups/users.
  const handleCredit = useCallback(
    async (row: ReferralRow) => {
      // 93-C6 / F-07 (A5 S-1/RE-1): points are LYD-convertible money
      // (100:1 via /loyalty/convert-points) — the credit POST now
      // requires an explicit confirmation instead of firing on the
      // first tap, matching the topups/orders money-action bar.
      // R127-L1 (B1 B15-3): the confirm previews the LYD equivalent too
      // (the users.tsx R126 points-preview idiom — «كل 100 نقطة = 1 د.ل»)
      // so both currencies are named honestly before the mint.
      const ok = await confirm({
        title: "تأكيد منح النقاط",
        description: `سيتم قيد ${row.points_earned} نقطة ولاء للمُحيل ${row.referrer_phone} (إحالة ${row.referee_phone}) — القيمة بالدينار عند التحويل: ${formatCurrency(row.points_earned / 100)} (كل 100 نقطة = 1 د.ل).`,
        confirmLabel: "منح النقاط",
      });
      if (!ok) return;
      setCrediting(row.id);
      try {
        // 93-C6 / F-07 (A5 RE-1): parity with topups/users/orders — the
        // backend idempotency middleware (admin.referrals.credit)
        // currently logs a warning and passes through when the header
        // is missing; a follow-up makes it REQUIRED. Sending the key now
        // closes that gap (a network retry / double-click replays the
        // cached response instead of surfacing 409 noise).
        const result = await creditReferral(row.id, {
          headers: withIdempotencyKey(headers, generateIdempotencyKey()),
        });
        // R124-I5 (A6 F1): success variant — points are LYD-convertible
        // money; the confirmation rides the green success treatment like
        // every other money action.
        toast({
          title: "تم منح النقاط",
          description: `تم قيد ${result.points_credited} نقطة للمُحيل`,
          variant: "success",
        });
        // R127-L1: the base-key invalidate replaces fetchDataRef's silent
        // refetch — every status/search variant of the list refreshes.
        void queryClient.invalidateQueries({ queryKey: getListAdminReferralsQueryKey() });
      } catch (err: unknown) {
        // 93-C6 / F-07 (A5 S-3): expired session → global handler (toast
        // + redirect); not a "فشلت العملية" toast.
        if (isSessionExpiredError(err)) return;
        toast({
          title: "خطأ",
          description: getErrorMessage(err),
          variant: "destructive",
        });
      } finally {
        setCrediting(null);
      }
    },
    [confirm, headers, toast, queryClient],
  );

  const stats = data?.stats;
  const topReferrers = data?.top_referrers ?? [];
  // R124-I5 (A6 F4 — R118-B2): memoized — `?? []` mints a fresh identity
  // per render when data is absent; the stable identity lets the memoized
  // rows below bail out on keystrokes.
  const list = useMemo(() => data?.list ?? [], [data]);

  // R122 (A2-P1): the credit POST is finance-gated server-side
  // (backend routes/admin/referrals.ts — requirePermission("finance"),
  // the B1-3 rationale: points are LYD-convertible money a scoped
  // users-admin must not mint). The button used to render enabled for a
  // users-only operator, who confirmed the dialog and only THEN hit the
  // 403 — the same "offered then 403'd mid-flow" class R120-B4 (A2-F4)
  // eliminated in users.tsx (canEditMoney) and orders.tsx
  // (canBulkRefund). Same idiom: disabled up front with the honest
  // reason instead.
  const canCredit = hasAdminPermission("finance");

  // R134 (A3-F1): the deep-link honest-reason gate (the R133 risk.tsx
  // idiom, now shared) — the nav hides this page from scope-less admins;
  // a deep link used to fire every query into a synchronized 403 burst.
  // Sits AFTER every hook (the enabled/load guards keep the mount fetch-free).
  if (!canView) {
    return <AdminScopeGate scope="users" />;
  }

  return (
    <AdminLayout onRefresh={() => void listQuery.refetch()}>
      <div className="space-y-5">
        <ReferralsHeader onRefresh={() => void listQuery.refetch()} />

        {/* Stats — hidden until the first successful load: a failed
            fetch must not render "—" cards that read as zero data
            (B5-03). */}
        {data && <ReferralsStats stats={stats} />}

        {/* Top Referrers Leaderboard */}
        {topReferrers.length > 0 && <TopReferrersList topReferrers={topReferrers} />}

        <ReferralsFilters
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />

        {/* Refresh of an already-rendered list failed — keep the stale
            rows visible below, surface the failure inline (coupons.tsx
            banner idiom) instead of blanking the page.
            R140 (r139 debt closure): the hand-rolled twin (the pre-r139
            red wall — bg-status-error/10 + border-status-error/25 + full
            error ink on the message) is replaced by the SHARED
            StaleListErrorBanner — the calm-error register admin/orders
            rides and admin/tickets' StaleQueueBanner mirrors
            byte-for-byte: calm card chrome (bg-card + border-border/60 +
            rounded-2xl), severity concentrated in the icon stage
            (error/8 fill + /22 edge + full-ink glyph), the /80 foreground
            message, the error-ink retry. role="alert" + onRetry semantics
            byte-identical; the message + retry callback stay page-owned. */}
        {!loading && loadError && data && (
          <StaleListErrorBanner message={loadError} onRetry={() => void listQuery.refetch()} />
        )}

        {/* Table */}
        {loading ? (
          <ReferralsTableSkeleton />
        ) : loadError && !data ? (
          /* Distinct from "no data": an outage/expired session previously
             masqueraded as the empty state below (B5-03). Same error-card
             idiom the storefront pages use (loyalty.tsx / orders.tsx). */
          <FetchErrorCard
            size="page"
            retryIcon={RefreshCw}
            title="تعذّر تحميل الإحالات"
            description="حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"
            onRetry={() => void listQuery.refetch()}
          />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Gift}
            title="لا توجد إحالات"
            description={search ? `لا نتائج لـ "${search}"` : "لم يتم تسجيل إحالات بعد"}
          />
        ) : (
          <ReferralsTable
            list={list}
            crediting={crediting}
            canCredit={canCredit}
            onCredit={handleCredit}
          />
        )}
      </div>
      {/* 93-C6 / F-07: the credit confirmation dialog mount. */}
      <ConfirmDialog />
    </AdminLayout>
  );
}
