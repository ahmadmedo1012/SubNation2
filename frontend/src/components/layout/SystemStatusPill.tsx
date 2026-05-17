import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchHealthzReady, type CheckStatus, type HealthzReadyResponse } from "@/lib/healthz";

const STATUS_META: Record<
  CheckStatus,
  { dotClass: string; label: string; ariaLabel: string }
> = {
  ok: {
    dotClass: "bg-emerald-400",
    label: "النظام يعمل",
    ariaLabel: "حالة النظام: يعمل بشكل طبيعي",
  },
  degraded: {
    dotClass: "bg-yellow-400",
    label: "أداء متدنٍ",
    ariaLabel: "حالة النظام: أداء متدنٍ",
  },
  failing: {
    dotClass: "bg-red-400",
    label: "خلل مؤقت",
    ariaLabel: "حالة النظام: يوجد خلل",
  },
};

/**
 * Tiny operational-transparency badge for the Footer.
 *
 * Polls the existing public /api/healthz/ready endpoint every 60 s.
 * Renders a single colored dot + Arabic status copy + a link to the
 * full /status page. Renders nothing on the very first request before
 * data arrives so the footer doesn't flash "خلل" before knowing — same
 * graceful-degrade pattern used by the admin observability panel.
 *
 * Uses the shared robust fetcher (lib/healthz) which never throws —
 * 503 responses become "degraded" yellow dots (not errors) and
 * network failures hide the pill entirely. No console spam, no
 * Sentry network breadcrumbs.
 */
export function SystemStatusPill() {
  const { data } = useQuery<HealthzReadyResponse>({
    queryKey: ["healthz-ready"],
    queryFn: fetchHealthzReady,
    refetchInterval: 60_000,
    staleTime: 30_000,
    // Fetcher already absorbs errors and synthesises a degraded
    // payload — React Query never enters error state, so retries
    // are unnecessary.
    retry: false,
  });

  if (!data) return null;

  const meta = STATUS_META[data.status] ?? STATUS_META.degraded;

  return (
    <Link href="/status">
      <span
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        aria-label={meta.ariaLabel}
        title={meta.ariaLabel}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotClass} ${
            data.status === "ok" ? "animate-pulse" : ""
          }`}
        />
        {meta.label}
      </span>
    </Link>
  );
}
