import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { TableSkeleton as SharedTableSkeleton } from "@/components/admin/TableSkeleton";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { isAdminUnauthorized } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey, withIdempotencyKey } from "@/lib/idempotency";
import { formatRelativeTime } from "@/lib/utils";
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
  WifiOff,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "./layout";

interface ReferralStats {
  total: number;
  credited: number;
  pending: number;
  total_points: number;
}

interface TopReferrer {
  id: number;
  phone: string;
  credited_count: number;
  total_count: number;
}

interface ReferralRow {
  id: number;
  status: "pending" | "credited";
  created_at: string;
  credited_at: string | null;
  referrer_phone: string;
  referrer_id: number;
  referee_phone: string;
  points_earned: number;
}

interface ReferralData {
  stats: ReferralStats;
  top_referrers: TopReferrer[];
  list: ReferralRow[];
}

const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  { value: "credited", label: "ناجحة" },
  { value: "pending", label: "معلقة" },
];

const MEDAL_COLORS = [
  "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  "text-slate-400  bg-slate-400/10  border-slate-400/20",
  "text-amber-600  bg-amber-600/10  border-amber-600/20",
];

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

export default function AdminReferralsPage() {
  const { adminToken, hasAdminPermission } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  // B5-03 (round-92 audit): fetchData had a bare `catch {}` — a failed
  // /api/admin/referrals load rendered the misleading "لا توجد إحالات"
  // empty state and "—" stat cards with zero error signal. The failure
  // now surfaces as the distinct error card (C5 storefront idiom) on
  // the initial load, and as an inline banner when a refresh of an
  // already-rendered list fails.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [crediting, setCrediting] = useState<number | null>(null);

  // 93-C6 / F-07 (A5 RE-1): the credit action gets a confirmation
  // dialog (useConfirm idiom) — see handleCredit below.
  const { confirm, ConfirmDialog } = useConfirm();

  const headers = useAdminHeaders();

  // 98-F7 (R98-02): monotonic request sequence — every fetchData call
  // takes the next number, and only the LATEST call may write
  // data/loadError/loading. A slow "abc" response that lands AFTER the
  // "abcd" response used to overwrite the newer list/stat cards with
  // results for a query nobody is looking at (the page had no AbortController
  // and no seq guard — the r97 race audit covered home/GlobalSearch/orders/
  // users, referrals slipped through). Belt to the AbortController below
  // (suspenders): the seq guard also protects the non-debounced paths
  // (refresh button, status-filter change, post-credit refetch).
  const fetchSeqRef = useRef(0);

  const fetchData = useCallback(
    async (silent = false, opts?: { signal?: AbortSignal }) => {
      if (!adminToken) return;
      const seq = ++fetchSeqRef.current;
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set("status", statusFilter);
        if (search.trim()) params.set("search", search.trim());
        const r = await fetch(`/api/admin/referrals?${params}`, {
          headers,
          // 98-F7 (R98-02): abort support for the debounced search path —
          // mirrors the GlobalSearch controller pattern (admin/layout.tsx).
          signal: opts?.signal,
        });
        if (!r.ok) {
          // A newer request owns the state — drop the stale error.
          if (seq !== fetchSeqRef.current) return;
          const body = (await r.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          // getErrorMessage maps the backend `code` to Arabic when present.
          const msg = getErrorMessage(body) || `فشل تحميل الإحالات (HTTP ${r.status})`;
          setLoadError(msg);
          return;
        }
        const payload = (await r.json()) as ReferralData;
        // Late stale response arrives last → must NOT overwrite the newer
        // results (the abort above usually kills it; this is the guarantee
        // when the runtime/mock ignores the signal).
        if (seq !== fetchSeqRef.current) return;
        setLoadError(null);
        setData(payload);
      } catch (err) {
        // Our own debounce abort (next keystroke) — not a real failure;
        // the newer request owns the state and the loading flag.
        if (opts?.signal?.aborted) return;
        if (seq !== fetchSeqRef.current) return;
        // Network-level failure (offline/DNS) — same surfacing.
        setLoadError(getErrorMessage(err));
      } finally {
        if (!silent && seq === fetchSeqRef.current) setLoading(false);
      }
    },
    [adminToken, statusFilter, search, headers],
  );

  // 98-F7 (R98-02): fetchDataRef — the debounced effect below depends on
  // `search` ONLY (a dep on fetchData would re-arm the 300ms timer on every
  // statusFilter/token/headers identity change and fire a redundant request
  // next to the immediate one from the effect below); the ref keeps the
  // latest closure without widening the effect's deps.
  const fetchDataRef = useRef(fetchData);
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    if (!adminToken) {
      navigate("/admin/login");
      return;
    }
    fetchData();
  }, [adminToken, statusFilter]);

  useEffect(() => {
    // 98-F7 (R98-02): every keystroke change aborts the previous in-flight
    // debounced request (GlobalSearch pattern — clearTimeout alone left the
    // request running; its response could still land and race the newer one).
    const controller = new AbortController();
    const t = setTimeout(
      () => void fetchDataRef.current(false, { signal: controller.signal }),
      300,
    );
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [search]);

  const handleCredit = async (row: ReferralRow) => {
    // 93-C6 / F-07 (A5 S-1/RE-1): points are LYD-convertible money
    // (100:1 via /loyalty/convert-points) — the credit POST now
    // requires an explicit confirmation instead of firing on the
    // first tap, matching the topups/orders money-action bar.
    const ok = await confirm({
      title: "تأكيد منح النقاط",
      description: `سيتم قيد ${row.points_earned} نقطة ولاء للمُحيل ${row.referrer_phone} (إحالة ${row.referee_phone}).`,
      confirmLabel: "منح النقاط",
    });
    if (!ok) return;
    setCrediting(row.id);
    try {
      const url = `/api/admin/referrals/${row.id}/credit`;
      const r = await fetch(url, {
        method: "POST",
        // 93-C6 / F-07 (A5 RE-1): parity with topups/users/orders — the
        // backend idempotency middleware
        // (admin.referrals.credit) currently logs a warning and passes
        // through when the header is missing; a follow-up makes it
        // REQUIRED. Sending the key now closes that gap (a network
        // retry / double-click replays the cached response instead of
        // surfacing 409 noise).
        headers: withIdempotencyKey(headers, generateIdempotencyKey()),
      });
      // 93-C6 / F-07 (A5 S-3): expired session → global handler (toast
      // + redirect); not a "فشلت العملية" toast.
      if (isAdminUnauthorized(r, url)) return;
      const result = (await r.json().catch(() => null)) as {
        points_credited?: number;
        error?: string;
        code?: string;
      } | null;
      if (!r.ok || !result) {
        // 93-C6 / F-07: envelope-parsed Arabic reasons (already-credited
        // 400, points-race 409 CONFLICT).
        throw new Error((result && getErrorMessage(result)) || `فشل منح النقاط (HTTP ${r.status})`);
      }
      toast({
        title: "تم منح النقاط",
        description: `تم قيد ${result.points_credited} نقطة للمُحيل`,
      });
      fetchData(true);
    } catch (err: unknown) {
      toast({
        title: "خطأ",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setCrediting(null);
    }
  };

  const stats = data?.stats;
  const topReferrers = data?.top_referrers ?? [];
  const list = data?.list ?? [];

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
    <AdminLayout onRefresh={() => fetchData()}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center float-in">
              <Gift className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold">برنامج الإحالة</h1>
              <p className="text-xs text-muted-foreground">إدارة ومتابعة إحالات المستخدمين</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
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
              color="text-blue-400"
              bg="bg-blue-400/10 border-blue-400/15"
            />
            <StatCard
              label="ناجحة (مكتسبة)"
              value={stats?.credited ?? "—"}
              icon={CheckCircle}
              color="text-emerald-400"
              bg="bg-emerald-400/10 border-emerald-400/15"
            />
            <StatCard
              label="قيد الانتظار"
              value={stats?.pending ?? "—"}
              icon={Clock}
              color="text-yellow-400"
              bg="bg-yellow-400/10 border-yellow-400/15"
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
              <Trophy className="w-3.5 h-3.5 text-yellow-400" />
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
                    <span className="text-emerald-400 font-bold">{r.credited_count} ناجحة</span>
                    <span className="text-muted-foreground">{r.total_count} إجمالي</span>
                    <span className="text-yellow-400 font-bold">{r.credited_count * 50} نقطة</span>
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
              onClick={() => fetchData()}
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
          <div className="text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
              <WifiOff className="w-8 h-8 text-status-error/70" />
            </div>
            <p className="font-bold text-lg mb-1.5 text-foreground/80">تعذّر تحميل الإحالات</p>
            <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
              حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة
            </p>
            <Button
              onClick={() => fetchData()}
              className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              إعادة المحاولة
            </Button>
          </div>
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
              {list.map((row, i) => {
                const credited = row.status === "credited";
                return (
                  <div
                    key={row.id}
                    className={`flex flex-col md:grid md:grid-cols-[1fr_1fr_100px_130px_90px] gap-2 md:gap-4 items-start md:items-center px-4 py-3 hover:bg-muted/15 transition-colors ${i % 2 !== 0 ? "bg-muted/5" : ""}`}
                  >
                    {/* Referrer */}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-blue-400/10 border border-blue-400/15 flex items-center justify-center shrink-0">
                        <Phone className="w-2.5 h-2.5 text-blue-400" />
                      </div>
                      <span className="font-mono text-sm font-bold truncate">
                        {row.referrer_phone}
                      </span>
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
                        <span className="inline-flex items-center gap-1 text-3xs font-bold px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle className="w-2.5 h-2.5" /> ناجحة
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-3xs font-bold px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          <Clock className="w-2.5 h-2.5" /> معلقة
                        </span>
                      )}
                    </div>

                    {/* Date */}
                    <div className="text-xs text-muted-foreground">
                      <div>{formatRelativeTime(row.created_at)}</div>
                      {credited && row.credited_at && (
                        <div className="text-emerald-400/70 text-3xs mt-0.5">
                          قُيِّد: {formatRelativeTime(row.credited_at)}
                        </div>
                      )}
                    </div>

                    {/* Action */}
                    <div>
                      {credited ? (
                        <div className="flex items-center gap-1 text-xs text-yellow-400 font-bold">
                          <Star className="w-3 h-3" />+{row.points_earned}
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCredit(row)}
                          // R122 (A2-P1): finance scope required — see
                          // canCredit above (users.tsx canEditMoney idiom).
                          disabled={crediting === row.id || !canCredit}
                          title={canCredit ? undefined : "يتطلب صلاحية المالية"}
                          className="h-7 px-2.5 text-xs gap-1 border-primary/25 text-primary hover:bg-primary/8 hover:border-primary/40"
                        >
                          {crediting === row.id ? (
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
              })}
            </div>

            {/* Footer count */}
            <div className="px-4 py-2.5 border-t border-border/40 bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
              <span>{list.length} إحالة</span>
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
