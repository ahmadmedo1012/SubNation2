import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

type CheckStatus = "ok" | "degraded" | "failing";

interface HealthzReadyResponse {
  status: CheckStatus;
}

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
 * Why not load a heavier component:
 *   - 50-byte JSON payload, 60 s cadence — negligible cost
 *   - same React Query key as the admin status page so the cache is
 *     shared on logged-in pages
 *   - no portal, no listeners, no DOM mutation — single <Link> render
 */
export function SystemStatusPill() {
  const { data, isError } = useQuery<HealthzReadyResponse>({
    queryKey: ["healthz-ready"],
    queryFn: () => fetch("/api/healthz/ready").then((r) => r.json()),
    refetchInterval: 60_000,
    staleTime: 30_000,
    // If the very first probe fails (network blip, deploy in progress),
    // hide the pill rather than display a misleading red dot. React
    // Query will keep retrying in the background.
    retry: 1,
  });

  if (isError || !data) return null;

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
