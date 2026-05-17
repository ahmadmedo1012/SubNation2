import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Activity } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import {
  fetchHealthzReady,
  type CheckStatus,
  type HealthzReadyResponse,
} from "@/lib/healthz";

const STATUS_META: Record<
  CheckStatus,
  { color: string; bg: string; border: string; label: string; icon: typeof CheckCircle2 }
> = {
  ok: {
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
    label: "متاح",
    icon: CheckCircle2,
  },
  degraded: {
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/30",
    label: "أداء متدنٍ",
    icon: AlertTriangle,
  },
  failing: {
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
    label: "خلل",
    icon: XCircle,
  },
};

const SERVICE_LABELS: Record<string, string> = {
  redis: "Redis",
  neon: "قاعدة البيانات",
  socket: "Socket.IO",
  // worker handled separately — running embedded with the web tier
  worker: "خدمة الجدولة",
};

function formatRelative(ts: string): string {
  const date = new Date(ts);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 5) return "الآن";
  if (diffSec < 60) return `منذ ${diffSec}ث`;
  if (diffSec < 3600) return `منذ ${Math.floor(diffSec / 60)}د`;
  return `منذ ${Math.floor(diffSec / 3600)}س`;
}

export default function StatusPage(): ReactElement {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, refetch } = useQuery<HealthzReadyResponse>({
    queryKey: ["public-status"],
    queryFn: fetchHealthzReady,
    refetchInterval: 30_000,
    staleTime: 15_000,
    // Robust fetcher absorbs all error paths into a synthesised
    // degraded payload — React Query never enters error state.
    retry: false,
  });

  // The fetcher never throws, so `isError` is structurally always false.
  // Keep an explicit `false` here so the JSX below stays readable.
  const isError = false;

  const aggregate = data?.status ?? "degraded";
  const aggregateMeta = STATUS_META[aggregate];

  // Suppress the unused `now` warning — it forces the relative-time labels
  // to refresh on the 5s tick even when the query data hasn't changed.
  void now;

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black">حالة المنصة</h1>
            <p className="text-xs text-muted-foreground">
              تحديث تلقائي كل 30 ثانية ·{" "}
              <a href="https://subnation.ly" className="text-primary hover:underline">
                subnation.ly
              </a>
            </p>
          </div>
        </div>

        {/* Aggregate banner */}
        {data && !isLoading && !isError && (
          <div
            className={`mt-6 flex items-center justify-between gap-4 p-5 rounded-2xl border ${aggregateMeta.bg} ${aggregateMeta.border}`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  aggregate === "ok"
                    ? "bg-emerald-400 animate-pulse"
                    : aggregate === "degraded"
                      ? "bg-yellow-400"
                      : "bg-red-400 animate-pulse"
                }`}
              />
              <span className={`font-bold ${aggregateMeta.color}`}>
                {aggregate === "ok"
                  ? "جميع الخدمات تعمل بشكل طبيعي"
                  : aggregate === "degraded"
                    ? "بعض الخدمات تعاني من أداء متدنٍ"
                    : "هناك خلل في إحدى الخدمات"}
              </span>
            </div>
            <button
              onClick={() => refetch()}
              className="p-2 rounded-lg hover:bg-card transition-colors text-muted-foreground hover:text-foreground"
              title="تحديث"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[68px] rounded-2xl skeleton-shimmer" />
            ))}
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="mt-6 p-5 bg-red-400/10 border border-red-400/30 rounded-2xl">
            <p className="text-sm text-red-400 font-bold">تعذّر الاتصال بالخادم</p>
            <p className="text-xs text-muted-foreground mt-1">
              قد يكون هناك انقطاع مؤقت في الشبكة. سنحاول مجدداً تلقائياً.
            </p>
          </div>
        )}

        {/* Per-service rows */}
        {data && !isLoading && !isError && (
          <div className="mt-6 space-y-2">
            {Object.entries(data.checks)
              .filter(([key]) => key !== "worker") // embedded scheduler runs in web tier
              .map(([service, check]) => {
                const meta = STATUS_META[check.status];
                const Icon = meta.icon;
                const label = SERVICE_LABELS[service] ?? service;
                return (
                  <div
                    key={service}
                    className={`flex items-center gap-4 p-4 rounded-2xl border bg-card ${meta.border}`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${meta.bg}`}
                    >
                      <Icon className={`w-5 h-5 ${meta.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm">{label}</div>
                      <div className={`text-xs mt-0.5 ${meta.color}`}>
                        {meta.label}
                        {check.latencyMs != null && (
                          <span className="text-muted-foreground"> · {check.latencyMs}ms</span>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {formatRelative(check.lastCheckedAt)}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* Footer info */}
        {data && !isLoading && !isError && (
          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-4">
            <span>
              مدة التشغيل: {Math.floor(data.uptimeSec / 3600)}س{" "}
              {Math.floor((data.uptimeSec % 3600) / 60)}د
            </span>
            <span className="font-mono">{data.version}</span>
          </div>
        )}

        {/* Help link */}
        <div className="mt-12 text-center text-xs text-muted-foreground">
          <p>
            للإبلاغ عن مشاكل أو الحصول على المساعدة، يرجى{" "}
            <a href="/support" className="text-primary hover:underline">
              التواصل مع الدعم الفني
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
