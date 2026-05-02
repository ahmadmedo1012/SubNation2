import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatDate, formatRelativeTime } from "@/lib/utils";
import { AdminLayout } from "./layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Gift, Users, CheckCircle, Clock, Star,
  Search, Trophy, Zap, RefreshCw, Check,
  AlertCircle, Phone,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  { value: "",         label: "الكل" },
  { value: "credited", label: "ناجحة" },
  { value: "pending",  label: "معلقة" },
];

const MEDAL_COLORS = [
  "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  "text-slate-400  bg-slate-400/10  border-slate-400/20",
  "text-amber-600  bg-amber-600/10  border-amber-600/20",
];

function TableSkeleton() {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="border-b border-border bg-muted/30 h-11" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`flex items-center gap-4 px-4 py-3 border-b border-border/30 ${i % 2 !== 0 ? "bg-muted/5" : ""}`}>
          <div className="h-4 bg-muted skeleton-shimmer rounded w-28" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-28" />
          <div className="h-5 bg-muted skeleton-shimmer rounded-full w-14" />
          <div className="h-4 bg-muted skeleton-shimmer rounded w-24 flex-1" />
          <div className="h-7 w-16 bg-muted skeleton-shimmer rounded" />
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, bg }: {
  label: string; value: string | number;
  icon: React.ElementType; color: string; bg: string;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-xl p-4">
      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center mb-3 ${bg}`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className={`text-2xl font-black tabular-nums mb-0.5 ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
    </div>
  );
}

export default function AdminReferralsPage() {
  const { adminToken } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [crediting, setCrediting] = useState<number | null>(null);

  const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" };

  const fetchData = useCallback(async (silent = false) => {
    if (!adminToken) return;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      const r = await fetch(`/api/admin/referrals?${params}`, { headers });
      if (r.ok) setData(await r.json());
    } catch {}
    finally { if (!silent) setLoading(false); }
  }, [adminToken, statusFilter, search]);

  useEffect(() => {
    if (!adminToken) { navigate("/admin/login"); return; }
    fetchData();
  }, [adminToken, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => fetchData(), 300);
    return () => clearTimeout(t);
  }, [search]);

  const handleCredit = async (id: number) => {
    setCrediting(id);
    try {
      const r = await fetch(`/api/admin/referrals/${id}/credit`, {
        method: "POST",
        headers,
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      toast({ title: "تم منح النقاط", description: `تم قيد ${result.points_credited} نقطة للمُحيل` });
      fetchData(true);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setCrediting(null);
    }
  };

  const stats = data?.stats;
  const topReferrers = data?.top_referrers ?? [];
  const list = data?.list ?? [];

  return (
    <AdminLayout onRefresh={() => fetchData()}>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Gift className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-black">برنامج الإحالة</h1>
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

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="إجمالي الإحالات"  value={stats?.total ?? "—"}        icon={Users}       color="text-blue-400"    bg="bg-blue-400/10 border-blue-400/15" />
          <StatCard label="ناجحة (مكتسبة)"   value={stats?.credited ?? "—"}     icon={CheckCircle} color="text-emerald-400" bg="bg-emerald-400/10 border-emerald-400/15" />
          <StatCard label="قيد الانتظار"      value={stats?.pending ?? "—"}      icon={Clock}       color="text-yellow-400"  bg="bg-yellow-400/10 border-yellow-400/15" />
          <StatCard label="نقاط ممنوحة إجمالاً" value={stats?.total_points ?? "—"} icon={Star}      color="text-primary"     bg="bg-primary/10 border-primary/15" />
        </div>

        {/* Top Referrers Leaderboard */}
        {topReferrers.length > 0 && (
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-3.5 h-3.5 text-yellow-400" />
              <h2 className="font-black text-sm">أكثر المستخدمين إحالةً</h2>
            </div>
            <div className="space-y-2">
              {topReferrers.map((r, i) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/20 hover:bg-muted/35 transition-colors"
                >
                  <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-black shrink-0 ${MEDAL_COLORS[i] ?? "text-muted-foreground bg-muted/40 border-border/40"}`}>
                    {i + 1}
                  </div>
                  <span className="font-mono text-sm font-bold flex-1 truncate">{r.phone}</span>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="text-emerald-400 font-black">{r.credited_count} ناجحة</span>
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
              onChange={e => setSearch(e.target.value)}
              className="pr-9 h-9 text-sm"
            />
          </div>
          <div className="flex gap-1.5">
            {STATUS_FILTERS.map(f => (
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

        {/* Table */}
        {loading ? (
          <TableSkeleton />
        ) : list.length === 0 ? (
          <div className="bg-card border border-border rounded-xl py-16 text-center text-muted-foreground">
            <div className="w-14 h-14 rounded-2xl bg-muted/30 border border-border/40 flex items-center justify-center mx-auto mb-3">
              <Gift className="w-6 h-6 opacity-20" />
            </div>
            <p className="font-bold text-foreground/50 text-sm">لا توجد إحالات</p>
            <p className="text-xs mt-1 text-muted-foreground/60">
              {search ? `لا نتائج لـ "${search}"` : "لم يتم تسجيل إحالات بعد"}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
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
                      <span className="font-mono text-sm font-bold truncate">{row.referrer_phone}</span>
                    </div>

                    {/* Referee */}
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-muted/50 border border-border/40 flex items-center justify-center shrink-0">
                        <Users className="w-2.5 h-2.5 text-muted-foreground" />
                      </div>
                      <span className="font-mono text-sm text-muted-foreground truncate">{row.referee_phone}</span>
                    </div>

                    {/* Status */}
                    <div>
                      {credited ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle className="w-2.5 h-2.5" /> ناجحة
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          <Clock className="w-2.5 h-2.5" /> معلقة
                        </span>
                      )}
                    </div>

                    {/* Date */}
                    <div className="text-xs text-muted-foreground">
                      <div>{formatRelativeTime(row.created_at)}</div>
                      {credited && row.credited_at && (
                        <div className="text-emerald-400/70 text-[10px] mt-0.5">
                          قُيِّد: {formatRelativeTime(row.credited_at)}
                        </div>
                      )}
                    </div>

                    {/* Action */}
                    <div>
                      {credited ? (
                        <div className="flex items-center gap-1 text-xs text-yellow-400 font-black">
                          <Star className="w-3 h-3" />
                          +{row.points_earned}
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCredit(row.id)}
                          disabled={crediting === row.id}
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
    </AdminLayout>
  );
}
