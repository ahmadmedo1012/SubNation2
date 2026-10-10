import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { EmptyState } from "@/components/admin/EmptyState";
import { TableSkeleton as SharedTableSkeleton } from "@/components/admin/TableSkeleton";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
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
  type AdminReferralEventRow,
  type ListAdminReferralsStatus,
} from "@workspace/api-client-react";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Gift,
  Phone,
  RefreshCw,
  Search,
  Star,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

// R127-L1: the hand-rolled row interface is the generated
// AdminReferralEventRow (field-identical — the batch-1 contract row
// pins the shape); aliased so the render code keeps its local name.
// (The old ReferralData/TopReferrer interfaces had no remaining
// references once the list rode useListAdminReferrals — deleted.)
type ReferralRow = AdminReferralEventRow;

/** R127-L1 (B1 §3.3): a 401 from the generated fetcher is the global
 * admin-session handler's business (toast + redirect fired inside
 * customFetch) — the error card + the credit catch below stay quiet on
 * it. ApiError is type-only from the package, so the check duck-types
 * `status` (the alerts.tsx R126-L8b idiom). */
function isSessionExpiredError(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 401;
}

const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  { value: "credited", label: "ناجحة" },
  { value: "pending", label: "معلقة" },
];

const MEDAL_COLORS = [
  // R128 (A1-D10/F3): the medal trio rides the NEW theme-aware --tier-*
  // inks. Gold was already the --status-warning pair (R126-L5 —
  // yellow-400 text failed the light theme 1.43:1); silver (slate-400)
  // and bronze (amber-600) measured 2.56:1 / 3.19:1 in light — the
  // tier tokens are AA in both themes by construction (tier-gold =
  // var(--status-warning), so gold is visually unchanged).
  "text-tier-gold bg-tier-gold/10 border-tier-gold/20",
  "text-tier-silver bg-tier-silver/10 border-tier-silver/20",
  "text-tier-bronze bg-tier-bronze/10 border-tier-bronze/20",
];

/** R125-I3 (A2-5): the backend list route hardcodes LIMIT 200 with NO
 *  page param (routes/admin/referrals.ts) — the same frozen-cap contract
 *  as products/coupons. Mirror of the backend bound for the honest-cap
 *  footer wording (a backend change to that LIMIT is a contract change
 *  that must update this mirror — the products/coupons convention). */
const REFERRALS_SERVER_CAP = 200;

function TableSkeleton() {
  return (
    <SharedTableSkeleton
      rows={6}
      cells={["w-28", "w-28", "rounded-full w-14", "flex-1 w-24", "w-16"]}
    />
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  bg: string;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl p-4">
      <div className={`w-8 h-8 rounded-xl border flex items-center justify-center mb-3 ${bg}`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className={`text-2xl font-bold tabular-nums mb-0.5 ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground font-semibold">{label}</div>
    </div>
  );
}

/* ── R124-I5 (A6 F4 — the R118-B2 orders.tsx pattern) ──────────────────
 * The search box is a CONTROLLED input — every keystroke re-rendered
 * the full referral list with fresh inline closures (the debounced
 * network refetch is separate). The row is now a module-level
 * React.memo component whose props are stable across a keystroke (row
 * refs come from `data`; onCredit is useCallback-stable; the busy/
 * scope flags are primitives), so typing re-renders the search box and
 * nothing else. */
interface ReferralRowItemProps {
  row: ReferralRow;
  /** Zebra striping (i % 2). */
  idx: number;
  /** Whether THIS row's credit POST is in flight. */
  crediting: boolean;
  /** R122 (A2-P1): finance scope for the credit action. */
  canCredit: boolean;
  onCredit: (row: ReferralRow) => void;
}

const ReferralRowItem = React.memo(function ReferralRowItem({
  row,
  idx,
  crediting,
  canCredit,
  onCredit,
}: ReferralRowItemProps) {
  const credited = row.status === "credited";
  return (
    <div
      className={`flex flex-col md:grid md:grid-cols-[1fr_1fr_100px_130px_90px] gap-2 md:gap-4 items-start md:items-center px-4 py-3 hover:bg-muted/15 transition-colors ${idx % 2 !== 0 ? "bg-muted/5" : ""}`}
    >
      {/* Referrer */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-status-info/10 border border-status-info/15 flex items-center justify-center shrink-0">
          <Phone className="w-2.5 h-2.5 text-status-info" />
        </div>
        <span className="font-mono text-sm font-bold truncate">{row.referrer_phone}</span>
      </div>

      {/* Referee */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-muted/50 border border-border/40 flex items-center justify-center shrink-0">
          <Users className="w-2.5 h-2.5 text-muted-foreground" />
        </div>
        <span className="font-mono text-sm text-muted-foreground truncate">
          {row.referee_phone}
        </span>
      </div>

      {/* Status */}
      <div>
        {credited ? (
          <span className="inline-flex items-center gap-1 text-3xs font-bold px-2 py-1 rounded-full bg-status-success/10 text-status-success border border-status-success/20">
            <CheckCircle className="w-2.5 h-2.5" /> ناجحة
          </span>
        ) : (
          /* R126-L5 (A3 item-10): the pending pill rides the
             --status-warning ink+tint pair (yellow-400 fails the light
             theme at 1.43-1.53:1 — A3's measured figures). */
          <span className="inline-flex items-center gap-1 text-3xs font-bold px-2 py-1 rounded-full bg-status-warning/10 text-status-warning border border-status-warning/20">
            <Clock className="w-2.5 h-2.5" /> معلقة
          </span>
        )}
      </div>

      {/* Date */}
      <div className="text-xs text-muted-foreground">
        <div>{formatRelativeTime(row.created_at)}</div>
        {credited && row.credited_at && (
          <div className="text-status-success/70 text-3xs mt-0.5">
            قُيِّد: {formatRelativeTime(row.credited_at)}
          </div>
        )}
      </div>

      {/* Action */}
      <div>
        {credited ? (
          /* R126-L5 (A3 item-10): pending-count text joins the warning
             sweep (yellow-400 fails the light theme at ~1.5:1). */
          <div className="flex items-center gap-1 text-xs text-status-warning font-bold">
            <Star className="w-3 h-3" />+{row.points_earned}
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onCredit(row)}
            // R122 (A2-P1): finance scope required — see
            // canCredit (users.tsx canEditMoney idiom).
            disabled={crediting || !canCredit}
            title={canCredit ? undefined : "يتطلب صلاحية المالية"}
            className="h-7 px-2.5 text-xs gap-1 border-primary/25 text-primary hover:bg-primary/8 hover:border-primary/40"
          >
            {crediting ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <Zap className="w-3 h-3" />
                منح نقاط
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
});

export default function AdminReferralsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
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
      enabled: !!adminToken,
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

  return (
    <AdminLayout onRefresh={() => void listQuery.refetch()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center float-in">
              <Gift className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">برنامج الإحالة</h1>
              <p className="text-xs text-muted-foreground">إدارة ومتابعة إحالات المستخدمين</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void listQuery.refetch()}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="w-3 h-3" />
            تحديث
          </Button>
        </div>

        {/* Stats — hidden until the first successful load: a failed
            fetch must not render "—" cards that read as zero data
            (B5-03). */}
        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="إجمالي الإحالات"
              value={stats?.total ?? "—"}
              icon={Users}
              color="text-status-info"
              bg="bg-status-info/10 border-status-info/15"
            />
            <StatCard
              label="ناجحة (مكتسبة)"
              value={stats?.credited ?? "—"}
              icon={CheckCircle}
              color="text-status-success"
              bg="bg-status-success/10 border-status-success/15"
            />
            <StatCard
              label="قيد الانتظار"
              value={stats?.pending ?? "—"}
              icon={Clock}
              /* R126-L5 (A3 item-10): the pending StatCard joins the
                 warning sweep (yellow-400 fails the light theme). */
              color="text-status-warning"
              bg="bg-status-warning/10 border-status-warning/15"
            />
            <StatCard
              label="نقاط ممنوحة إجمالاً"
              value={stats?.total_points ?? "—"}
              icon={Star}
              color="text-primary"
              bg="bg-primary/10 border-primary/15"
            />
          </div>
        )}

        {/* Top Referrers Leaderboard */}
        {topReferrers.length > 0 && (
          <div className="bg-card border border-border/60 rounded-2xl p-4 float-in stagger-5">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-3.5 h-3.5 text-tier-gold" />
              <h2 className="font-bold text-sm">أكثر المستخدمين إحالةً</h2>
            </div>
            <div className="space-y-2">
              {topReferrers.map((r, i) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/20 hover:bg-muted/35 transition-colors"
                >
                  <div
                    className={`w-6 h-6 rounded-full border flex items-center justify-center text-2xs font-bold shrink-0 ${MEDAL_COLORS[i] ?? "text-muted-foreground bg-muted/40 border-border/40"}`}
                  >
                    {i + 1}
                  </div>
                  <span className="font-mono text-sm font-bold flex-1 truncate">{r.phone}</span>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="text-status-success font-bold">{r.credited_count} ناجحة</span>
                    <span className="text-muted-foreground">{r.total_count} إجمالي</span>
                    {/* R125-I3 (A2-7): the derived «{credited_count * 50}
                        نقطة» column is GONE — it hardcoded the
                        POINTS_PER_REFERRAL money constant (the backend
                        derives it from lib/loyalty-policy, which the
                        frontend cannot import). The rows below already
                        show each referral's points from the API
                        (points_earned), and the stat cards show the
                        server-computed total_points — a policy change
                        can no longer make this column lie. */}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters + search */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="بحث برقم المُحيل أو المُحال..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 h-9 text-sm"
            />
          </div>
          <div className="flex gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all press-spring ${
                  statusFilter === f.value
                    ? "bg-primary text-white shadow-sm shadow-primary/25"
                    : "bg-card border border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Refresh of an already-rendered list failed — keep the stale
            rows visible below, surface the failure inline (coupons.tsx
            banner idiom) instead of blanking the page. */}
        {!loading && loadError && data && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-error/10 border border-status-error/25 text-status-error text-sm font-bold flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => void listQuery.refetch()}
              className="ms-auto text-xs underline underline-offset-2 hover:opacity-80 press-spring"
            >
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <TableSkeleton />
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
          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_100px_130px_90px] gap-4 px-4 py-2.5 border-b border-border bg-muted/30 text-xs font-bold text-muted-foreground">
              <span>المُحيل</span>
              <span>المُحال</span>
              <span>الحالة</span>
              <span>التاريخ</span>
              <span>إجراء</span>
            </div>

            <div className="divide-y divide-border/30">
              {/* R124-I5 (A6 F4 — R118-B2): the memoized row component —
                  props are stable across keystrokes so only the search
                  box re-renders while typing. */}
              {list.map((row, i) => (
                <ReferralRowItem
                  key={row.id}
                  row={row}
                  idx={i}
                  crediting={crediting === row.id}
                  canCredit={canCredit}
                  onCredit={handleCredit}
                />
              ))}
            </div>

            {/* Footer count — R125-I3 (A2-5): the backend list is
                server-capped at LIMIT 200 (routes/admin/referrals.ts)
                with no page param, while the stat cards count the FULL
                table — a 200-row window used to render as a bare
                «200 إحالة» next to «إجمالي الإحالات: 340», contradicting
                itself. The products/coupons honest-cap convention: a
                full cap page reads «عرض N (الأحدث أولاً)». */}
            <div className="px-4 py-2.5 border-t border-border/40 bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {list.length >= REFERRALS_SERVER_CAP
                  ? `عرض ${list.length} (الأحدث أولاً)`
                  : `${list.length} إحالة`}
              </span>
              <span className="flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                الإحالات المعلقة بانتظار أول شحن من المُحال
              </span>
            </div>
          </div>
        )}
      </div>
      {/* 93-C6 / F-07: the credit confirmation dialog mount. */}
      <ConfirmDialog />
    </AdminLayout>
  );
}
