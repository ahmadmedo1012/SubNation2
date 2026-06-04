/**
 * Admin risk events review queue (003-anomaly-detection, US2 P1 slice).
 *
 * Lists risk_events with filters by level + lookback window. Click a row
 * to drill into /admin/risk/events/:id. Uses the existing AdminLayout
 * for chrome and useAdminHeaders for auth.
 */

import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "./layout";

type RiskLevel = "low" | "medium" | "high" | "critical";

interface RiskEventRow {
  id: number;
  user_id: number | null;
  user_phone: string | null;
  user_email: string | null;
  event_type: string;
  score: number;
  level: RiskLevel;
  confidence: number;
  rule_fired: string[];
  action_taken: string;
  ip_address: string | null;
  created_at: string;
  shown_at: string | null;
}

interface ListResponse {
  events: RiskEventRow[];
  next_cursor: string | null;
}

const LEVEL_META: Record<RiskLevel, { label: string; bg: string; text: string; border: string }> = {
  low: {
    label: "منخفض",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
  },
  medium: {
    label: "متوسط",
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    border: "border-yellow-500/30",
  },
  high: {
    label: "عالي",
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/30",
  },
  critical: {
    label: "حرج",
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/30",
  },
};

const FILTERS: { value: "all" | RiskLevel; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "critical", label: "حرج" },
  { value: "high", label: "عالي" },
  { value: "medium", label: "متوسط" },
  { value: "low", label: "منخفض" },
];

export default function AdminRiskPage() {
  const headers = useAdminHeaders();
  const [filter, setFilter] = useState<"all" | RiskLevel>("all");

  const query = useQuery<ListResponse>({
    queryKey: ["admin-risk-events", filter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "100");
      if (filter !== "all") params.set("level", filter);
      const resp = await fetch(`/api/admin/risk/events?${params.toString()}`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
  });

  const events = useMemo(() => query.data?.events ?? [], [query.data]);
  const counts = useMemo(() => {
    const c: Record<RiskLevel | "all", number> = {
      all: events.length,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    for (const e of events) c[e.level]++;
    return c;
  }, [events]);

  return (
    <AdminLayout>
      <div className="space-y-4">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-primary" />
              مراقبة المخاطر
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              أحداث الأمان والاحتيال المرصودة من خط أنابيب التسجيل (003-anomaly-detection)
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            تحديث
          </Button>
        </header>

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => {
            const active = f.value === filter;
            const tone =
              f.value === "all" ? null : LEVEL_META[f.value as RiskLevel];
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                  active
                    ? tone
                      ? `${tone.bg} ${tone.text} ${tone.border}`
                      : "bg-primary/15 text-primary border-primary/40"
                    : "bg-muted/30 border-border/30 hover:bg-muted/60"
                }`}
              >
                {f.label}
                <span className="opacity-70 mr-1.5">({counts[f.value]})</span>
              </button>
            );
          })}
        </div>

        {/* Empty / loading / error / list */}
        {query.isLoading && (
          <div className="text-sm text-muted-foreground py-12 text-center">جاري التحميل…</div>
        )}
        {query.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4" /> فشل تحميل الأحداث
          </div>
        )}
        {!query.isLoading && events.length === 0 && (
          <div className="border border-border/40 rounded-2xl bg-muted/10 p-8 text-center text-sm text-muted-foreground space-y-2">
            <ShieldCheck className="w-8 h-8 mx-auto text-emerald-500/70" />
            <div>لا توجد أحداث في النطاق المحدد.</div>
            <div className="text-xs">
              لتفعيل خط الأنابيب: اضبط <code dir="ltr">RISK_PIPELINE_ENABLED=true</code> في الخادم
              ثم انتظر حتى يعالج الخادم طلبات تسجيل الدخول والشحن.
            </div>
          </div>
        )}
        {events.length > 0 && (
          <div className="border border-border/40 rounded-2xl overflow-hidden bg-card/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-bold">المستوى</th>
                  <th className="px-3 py-2 text-right font-bold">النوع</th>
                  <th className="px-3 py-2 text-right font-bold">المستخدم</th>
                  <th className="px-3 py-2 text-right font-bold">القاعدة</th>
                  <th className="px-3 py-2 text-right font-bold">النقاط</th>
                  <th className="px-3 py-2 text-right font-bold">الإجراء</th>
                  <th className="px-3 py-2 text-right font-bold">الوقت</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const tone = LEVEL_META[e.level];
                  const userLabel = e.user_phone ?? e.user_email ?? (e.user_id ? `#${e.user_id}` : "—");
                  return (
                    <tr
                      key={e.id}
                      className="border-t border-border/30 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${tone.bg} ${tone.text} ${tone.border}`}
                        >
                          {tone.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.event_type}</td>
                      <td className="px-3 py-2 text-xs">{userLabel}</td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground">
                        {e.rule_fired.slice(0, 2).join(", ") || "—"}
                        {e.rule_fired.length > 2 && ` +${e.rule_fired.length - 2}`}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.score}</td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground">
                        {e.action_taken}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                        <Link
                          href={`/admin/risk/events/${e.id}`}
                          className="text-primary hover:underline"
                        >
                          {new Date(e.created_at).toLocaleString("ar-LY")}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
