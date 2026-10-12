import { CheckCircle2 } from "lucide-react";
import { type ReactElement } from "react";
import type { CheckStatus } from "@/lib/healthz";
import { STATUS_META } from "@/components/admin/system/system-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the compact KPI tile of the «نظرة سريعة على الصحة» strip. Status tone,
// label, value and hint flow down as props (STATUS_META rides the shared
// meta module); the move only changes its address, DOM/classes
// byte-identical.

/**
 * Compact KPI tile used in the "Health Overview" strip at the top of the
 * page. Designed to be scannable in <5s and stack cleanly on mobile.
 *
 * `status` controls the color tone; pass "neutral" for tiles that are
 * informational rather than health-bearing (e.g. uptime).
 */
export function HealthTile({
  label,
  value,
  status,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string;
  status: CheckStatus | "neutral";
  icon: typeof CheckCircle2;
  hint?: string;
}): ReactElement {
  const meta =
    status === "neutral"
      ? {
          color: "text-foreground",
          bg: "bg-muted/15",
          border: "border-border/50",
        }
      : STATUS_META[status];
  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${meta.bg} ${meta.border} min-w-0`}
      title={hint}
    >
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}>
        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-3xs text-muted-foreground font-bold leading-none mb-1 truncate">
          {label}
        </div>
        <div className={`text-sm font-bold tabular-nums leading-none ${meta.color}`}>{value}</div>
        {hint && <div className="text-3xs text-muted-foreground mt-1 truncate">{hint}</div>}
      </div>
    </div>
  );
}
