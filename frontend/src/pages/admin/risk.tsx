/**
 * Admin risk events review queue (003-anomaly-detection, US2 P1 slice).
 *
 * Lists risk_events with filters by level + lookback window. Click a row
 * to drill into /admin/risk/events/:id. Uses the existing AdminLayout
 * for chrome and useAdminHeaders for auth.
 */

import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";
import { TableSkeleton } from "@/components/admin/TableSkeleton";
// 93-C7 / C-UX2 (A12 B3): risk-level pills migrate from raw
// emerald/yellow/orange/red hues to the canonical StatusBadge on the
// --status-* tokens (low→success, medium→warning, high→low-stock —
// the orange token, critical→error).
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
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

interface DashboardResponse {
  window_hours: number;
  total: number;
  by_level: Record<RiskLevel, number>;
  unresolved: number;
  top_rules: Array<{ rule: string; count: number }>;
  pipeline: { enabled: boolean };
}

const LEVEL_META: Record<RiskLevel, { label: string; tone: StatusBadgeVariant }> = {
  low: { label: "منخفض", tone: "success" },
  medium: { label: "متوسط", tone: "warning" },
  high: { label: "عالي", tone: "low-stock" },
  critical: { label: "حرج", tone: "error" },
};

const FILTERS: { value: "all" | RiskLevel; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "critical", label: "حرج" },
  { value: "high", label: "عالي" },
  { value: "medium", label: "متوسط" },
  { value: "low", label: "منخفض" },
];

// Active filter-chip styling derived from the same status tokens as the
// row pills (93-C7 / C-UX2) — chip + badge can no longer disagree.
const TONE_CHIP: Record<StatusBadgeVariant, string> = {
  success: "bg-status-success/15 text-status-success border-status-success/40",
  warning: "bg-status-warning/15 text-status-warning border-status-warning/40",
  error: "bg-status-error/15 text-status-error border-status-error/40",
  "low-stock": "bg-status-low-stock/15 text-status-low-stock border-status-low-stock/40",
  info: "bg-status-info/15 text-status-info border-status-info/40",
  purple: "bg-status-purple/15 text-status-purple border-status-purple/40",
  primary: "bg-primary/15 text-primary border-primary/40",
  neutral: "bg-muted/45 text-muted-foreground border-border/50",
};

export default function AdminRiskPage() {
  const headers = useAdminHeaders();
  const [filter, setFilter] = useState<"all" | RiskLevel>("all");

  const dashboard = useQuery<DashboardResponse>({
    queryKey: ["admin-risk-dashboard"],
    queryFn: async () => {
      const resp = await fetch(`/api/admin/risk/dashboard?hours=24`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
    refetchInterval: 30_000,
    // 96-F7 (R96 M11): 30s polling must pause when the tab is hidden —
    // an idle risk-monitor tab on a phone burned 2 requests/minute on
    // mobile data. Every other admin poller (orders/products/alerts)
    // already sets this to false.
    refetchIntervalInBackground: false,
  });

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

  // 94-C2 (A2 P3-1): the chip counters were computed from the FILTERED
  // response — picking «حرج» made every other chip read (0) even when
  // high/medium events existed (the server only returned the filtered
  // subset). A background "all" query (same endpoint, same cache key
  // namespace — it dedupes with the main query when filter === "all")
  // now feeds the counters so they stay level-agnostic.
  const allEventsQuery = useQuery<ListResponse>({
    queryKey: ["admin-risk-events", "all"],
    queryFn: async () => {
      const resp = await fetch(`/api/admin/risk/events?limit=100`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
  });

  const events = useMemo(() => query.data?.events ?? [], [query.data]);
  const countSource = allEventsQuery.data?.events ?? events;
  const counts = useMemo(() => {
    const c: Record<RiskLevel | "all", number> = {
      all: countSource.length,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    for (const e of countSource) c[e.level]++;
    return c;
  }, [countSource]);

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
            onClick={() => {
              query.refetch();
              dashboard.refetch();
            }}
            disabled={query.isFetching || dashboard.isFetching}
            className="gap-2"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${query.isFetching || dashboard.isFetching ? "animate-spin" : ""}`}
            />
            تحديث
          </Button>
        </header>

        {/* Dashboard stats */}
        {dashboard.data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <DashCard
              label={`إجمالي ${dashboard.data.window_hours} ساعة`}
              value={String(dashboard.data.total)}
              hint={
                dashboard.data.pipeline.enabled
                  ? "خط الأنابيب مفعَّل"
                  : "خط الأنابيب معطَّل (RISK_PIPELINE_ENABLED=false)"
              }
              tone={dashboard.data.pipeline.enabled ? "ok" : "warn"}
            />
            <DashCard
              label="حرج"
              value={String(dashboard.data.by_level.critical ?? 0)}
              tone={(dashboard.data.by_level.critical ?? 0) > 0 ? "danger" : "ok"}
            />
            <DashCard
              label="عالي"
              value={String(dashboard.data.by_level.high ?? 0)}
              tone={(dashboard.data.by_level.high ?? 0) > 0 ? "warn" : "ok"}
            />
            <DashCard
              label="بدون تصنيف"
              value={String(dashboard.data.unresolved)}
              hint="لم تُصنَّف بعد"
              tone={dashboard.data.unresolved > 0 ? "warn" : "ok"}
            />
          </div>
        )}
        {dashboard.data && dashboard.data.top_rules.length > 0 && (
          <div className="border border-border/40 rounded-2xl bg-card/60 p-3">
            <div className="text-xs text-muted-foreground mb-2 font-bold">
              أكثر القواعد إطلاقاً (24 ساعة)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {dashboard.data.top_rules.map((r) => (
                <span
                  key={r.rule}
                  className="text-[11px] font-mono bg-muted/40 border border-border/40 rounded-lg px-2 py-1"
                >
                  {r.rule}
                  <span className="opacity-60 mr-1.5">×{r.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => {
            const active = f.value === filter;
            const tone = f.value === "all" ? null : LEVEL_META[f.value as RiskLevel];
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                  active
                    ? tone
                      ? TONE_CHIP[tone.tone]
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
          <TableSkeleton
            cells={["w-20 rounded-full", "flex-1", "w-24", "flex-1", "w-14", "w-20", "w-28"]}
          />
        )}
        {query.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4" /> فشل تحميل الأحداث
          </div>
        )}
        {!query.isLoading && events.length === 0 && (
          <EmptyState
            icon={ShieldCheck}
            title="لا توجد أحداث في النطاق المحدد"
            description="لتفعيل خط الأنابيب: اضبط RISK_PIPELINE_ENABLED=true في الخادم ثم انتظر معالجة طلبات الدخول والشحن."
          />
        )}
        {events.length > 0 && (
          <>
            {/* 94-C2 (A2 P3-2): the list is capped at the newest 100 per
                filter (next_cursor exists) — disclose the truncation
                instead of silently cutting history. */}
            {query.data?.next_cursor && (
              <p className="text-[11px] text-muted-foreground text-center">
                يُعرض أحدث 100 حدث فقط لهذا الفلتر — استخدم الفلاتر لتضييق النطاق والوصول إلى
                الأحداث الأقدم.
              </p>
            )}
            {/* Canonical admin table chrome + horizontal scroll on mobile —
                previously a bespoke border-border/40 bg-card/60 card with
                no overflow handling (7 columns crushed at 375px). */}
            <div className="hidden md:block bg-card border border-border/60 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      {/* 96-F7 (R96 A6 #15 + #6): scope="col" for screen
                          readers; dates pinned to -u-nu-latn so engines
                          without ar-LY data never emit Arabic-Indic
                          numerals. */}
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        المستوى
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        النوع
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        المستخدم
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        القاعدة
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        النقاط
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        الإجراء
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-bold">
                        الوقت
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => {
                      const tone = LEVEL_META[e.level];
                      const userLabel =
                        e.user_phone ?? e.user_email ?? (e.user_id ? `#${e.user_id}` : "—");
                      return (
                        <tr
                          key={e.id}
                          className={`border-t border-border/30 hover:bg-muted/20 transition-colors ${
                            i % 2 !== 0 ? "bg-muted/5" : ""
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <StatusBadge variant={tone.tone} size="xs">
                              {tone.label}
                            </StatusBadge>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs">{e.event_type}</td>
                          <td className="px-4 py-2.5 text-xs">{userLabel}</td>
                          <td className="px-4 py-2.5 text-[11px] text-muted-foreground">
                            {e.rule_fired.slice(0, 2).join(", ") || "—"}
                            {e.rule_fired.length > 2 && ` +${e.rule_fired.length - 2}`}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs">{e.score}</td>
                          <td className="px-4 py-2.5 text-[11px] text-muted-foreground">
                            {e.action_taken}
                          </td>
                          <td className="px-4 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                            <Link
                              href={`/admin/risk/events/${e.id}`}
                              className="text-primary hover:underline"
                            >
                              {new Date(e.created_at).toLocaleString("ar-LY-u-nu-latn")}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Mobile card list (parity with orders/users pattern) */}
            <div className="md:hidden space-y-2.5">
              {events.map((e) => {
                const tone = LEVEL_META[e.level];
                const userLabel =
                  e.user_phone ?? e.user_email ?? (e.user_id ? `#${e.user_id}` : "—");
                return (
                  <Link key={e.id} href={`/admin/risk/events/${e.id}`}>
                    <div className="bg-card border border-border/60 rounded-2xl p-4 hover:border-primary/30 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <StatusBadge variant={tone.tone} size="xs">
                          {tone.label}
                        </StatusBadge>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {e.score} نقطة
                        </span>
                      </div>
                      <div className="font-mono text-xs font-bold mb-1">{e.event_type}</div>
                      <div className="text-xs text-muted-foreground mb-2">{userLabel}</div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/30 pt-2">
                        <span>{e.action_taken}</span>
                        <span>{new Date(e.created_at).toLocaleString("ar-LY-u-nu-latn")}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

function DashCard({
  label,
  value,
  hint,
  tone = "ok",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "danger";
}) {
  const tones = {
    ok: "border-border/40 bg-card/60",
    warn: "border-amber-500/30 bg-amber-500/5",
    danger: "border-red-500/30 bg-red-500/5",
  };
  const valueColor = {
    ok: "",
    warn: "text-amber-400",
    danger: "text-red-400",
  };
  return (
    <div className={`border rounded-xl p-3 ${tones[tone]}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${valueColor[tone]}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
