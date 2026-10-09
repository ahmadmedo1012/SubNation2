import { fetchHealthzSummary, type CheckStatus, type HealthzSummary } from "@/lib/healthz";
import { formatTime } from "@/lib/utils";
import { useSeo } from "@/hooks/useSeo";
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
  CheckStatus | "unknown",
  {
    color: string;
    bg: string;
    border: string;
    label: string;
    description: string;
    icon: typeof CheckCircle2;
  }
> = {
  // R94-A1 #5 (P2, WCAG AA): raw -400 shades measured 1.92–2.54:1 on
  // white/light surfaces — the shared --status-* tokens carry
  // theme-aware values tuned for AA contrast on card surfaces.
  ok: {
    color: "text-status-success",
    bg: "bg-status-success/10",
    border: "border-status-success/30",
    label: "جميع الخدمات تعمل بشكل طبيعي",
    description: "المنصة تعمل بشكل كامل وجميع العمليات متاحة.",
    icon: CheckCircle2,
  },
  degraded: {
    color: "text-status-warning",
    bg: "bg-status-warning/10",
    border: "border-status-warning/30",
    label: "أداء متدنٍ في بعض الخدمات",
    description: "المنصة تعمل لكن قد تلاحظ بطءًا أو تأخراً في بعض الميزات.",
    icon: AlertTriangle,
  },
  failing: {
    color: "text-status-error",
    bg: "bg-status-error/10",
    border: "border-status-error/30",
    label: "هناك خلل في الخدمة",
    description: "نعمل حالياً على إصلاح المشكلة. يرجى المحاولة لاحقاً.",
    icon: XCircle,
  },
  unknown: {
    color: "text-status-error",
    bg: "bg-status-error/10",
    border: "border-status-error/30",
    label: "تعطل — حالة غير معروفة",
    description: "لم نتمكن من التحقق من حالة المنصة. نعمل حالياً على إصلاح المشكلة.",
    icon: XCircle,
  },
};

export default function StatusPage(): ReactElement {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  // R125-I7 (A7 B-5): the tick is NOT dead — `lastUpdatedLabel` renders
  // formatTime(dataUpdatedAt) (an absolute HH:MM string) computed at
  // render time, so between the query's 5-minute refetches the label
  // would sit up to 5 minutes stale on a minute boundary without these
  // re-renders. 30s bounds the staleness at half a minute for a
  // minute-granularity label (a 60s tick would allow a full minute of
  // drift). Cheap: one tiny page, twice a minute, only while the tab
  // is open.
  void tick;

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<HealthzSummary>({
    queryKey: ["public-status-summary"],
    queryFn: fetchHealthzSummary,
    // R104 (AG2-9): 90 s → 5 min. A left-open status tab was 40
    // wake-up requests/hour; the backend aggregates on a 15 s cache and
    // the page is a self-selecting audience — 5 min is plenty honest.
    refetchInterval: 300_000,
    staleTime: 240_000,
    retry: false,
  });

  // Only an explicitly ok/degraded/failing probe result may drive the
  // banner. Anything else (missing data, unrecognized status string
  // from a proxy/CDN fault) renders as a failure — never green.
  const rawStatus = data?.status;
  const aggregate: CheckStatus | "unknown" =
    rawStatus === "ok" || rawStatus === "degraded" || rawStatus === "failing"
      ? rawStatus
      : "unknown";
  const meta = STATUS_META[aggregate];
  const Icon = meta.icon;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const lastUpdatedLabel = lastUpdated ? formatTime(lastUpdated) : "—";

  // R123-E4b (P3-j, live-verified): the page never set document.title —
  // the tab kept the previous route's title (or the SPA default) and
  // the R123-A8 audit confirmed /status ships no per-page title.
  // noindex,follow mirrors robots.txt (which disallows /status) — same
  // pairing every other noindex surface uses.
  const seoBlock = useSeo({
    title: "حالة المنصة — SubNation",
    description: "حالة خدمات منصة SubNation المجمّعة، مع تحديث تلقائي دوري.",
    path: "/status",
    locale: "ar",
    robots: "noindex,follow",
  });

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="max-w-xl mx-auto px-4 py-16">
        {seoBlock}
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">حالة المنصة</h1>
            <p className="text-xs text-muted-foreground">
              {/* R124-I4 (A5 #1/#10): text-primary-text (the Button link
                  convention) + resting underline — not color-alone. */}
              <a
                href="https://subnation.ly"
                className="text-primary-text underline underline-offset-2 hover:opacity-80 transition-opacity"
              >
                subnation.ly
              </a>{" "}
              · تحديث تلقائي كل خمس دقائق
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
              /* R125-I7 (A7 B-5): the page's only interactive control was
                 p-2 + w-4 icon ≈ 32px — under the app-wide 44px tap
                 floor (WCAG 2.5.8's 24px would pass, the repo's bar
                 doesn't). Fixed h-11 w-11 box (banner-less page — no
                 negative-margin trick needed). */
              className="h-11 w-11 flex items-center justify-center rounded-lg hover:bg-card transition-colors text-muted-foreground hover:text-foreground"
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
          <Link
            href="/support"
            className="text-primary-text underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            تواصل مع فريق الدعم
          </Link>
        </div>
      </div>
    </div>
  );
}
