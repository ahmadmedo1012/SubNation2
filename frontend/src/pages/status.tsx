import { fetchHealthzSummary, type CheckStatus, type HealthzSummary } from "@/lib/healthz";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { Link } from "wouter";

/**
 * Public status page.
 *
 * Shows ONLY the aggregate platform status — no per-subsystem
 * details, no infrastructure information, no uptime, no version.
 * Operator-grade observability lives behind admin auth at
 * `/admin/system`.
 *
 * Polls /api/healthz/summary at 90 s. Backend caches the aggregate
 * at 15 s, so even at 200 concurrent visitors this collapses to
 * roughly 1 actual check per 15 s on the server.
 */

const STATUS_META: Record<
  CheckStatus,
  {
    color: string;
    bg: string;
    border: string;
    label: string;
    description: string;
    icon: typeof CheckCircle2;
  }
> = {
  ok: {
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
    label: "جميع الخدمات تعمل بشكل طبيعي",
    description: "المنصة تعمل بشكل كامل وجميع العمليات متاحة.",
    icon: CheckCircle2,
  },
  degraded: {
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/30",
    label: "أداء متدنٍ في بعض الخدمات",
    description: "المنصة تعمل لكن قد تلاحظ بطئاً أو تأخراً في بعض الميزات.",
    icon: AlertTriangle,
  },
  failing: {
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
    label: "هناك خلل في الخدمة",
    description: "نعمل حالياً على إصلاح المشكلة. يرجى المحاولة لاحقاً.",
    icon: XCircle,
  },
};

export default function StatusPage(): ReactElement {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<HealthzSummary>({
    queryKey: ["public-status-summary"],
    queryFn: fetchHealthzSummary,
    // 90 s in the client. Backend cache at 15 s. Net effect: at most
    // a few clients trigger an actual aggregation per minute even at
    // moderate concurrent visitor counts.
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: false,
  });

  const aggregate = data?.status ?? "ok";
  const meta = STATUS_META[aggregate];
  const Icon = meta.icon;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const lastUpdatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString("ar-LY", { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="max-w-xl mx-auto px-4 py-16">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black">حالة المنصة</h1>
            <p className="text-xs text-muted-foreground">
              <a href="https://subnation.ly" className="text-primary hover:underline">
                subnation.ly
              </a>{" "}
              · تحديث تلقائي كل دقيقة ونصف
            </p>
          </div>
        </div>

        {/* Loading */}
        {isLoading && <div className="h-[120px] rounded-2xl skeleton-shimmer" />}

        {/* Aggregate banner */}
        {!isLoading && (
          <div
            className={`flex items-start gap-4 p-6 rounded-2xl border ${meta.bg} ${meta.border}`}
          >
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center ${meta.bg} border ${meta.border}`}
            >
              <Icon className={`w-6 h-6 ${meta.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-base font-bold ${meta.color}`}>{meta.label}</div>
              <div className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                {meta.description}
              </div>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="p-2 rounded-lg hover:bg-card transition-colors text-muted-foreground hover:text-foreground"
              aria-label="تحديث"
              title="تحديث"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Footer line — non-sensitive metadata only */}
        {!isLoading && (
          <p className="mt-6 text-xs text-muted-foreground text-center">
            آخر تحديث: {lastUpdatedLabel}
          </p>
        )}

        {/* Help link */}
        <div className="mt-10 text-center text-xs text-muted-foreground">
          هل تواجه مشكلة لم تظهر هنا؟{" "}
          <Link href="/support" className="text-primary hover:underline">
            تواصل مع فريق الدعم
          </Link>
        </div>
      </div>
    </div>
  );
}
