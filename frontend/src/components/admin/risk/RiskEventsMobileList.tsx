import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import { FilterTabs } from "@/components/ui/filter-tabs";
import {
  isRiskSort,
  LEVEL_META,
  RISK_SORT_CHIPS,
  type RiskEventRow,
} from "@/components/admin/risk/risk-meta";
import { Link } from "wouter";

// R137 (FE decomposition): extracted verbatim from pages/admin/risk.tsx —
// the mobile card list (level pill + score / event type / user / action
// + date, the whole card drills into the event investigation). The
// events pages (the accumulating infinite query) stay in the page —
// this shell takes the flattened rows DOWN; the per-row tone/userLabel
// derivations are row-local and ride along verbatim. The move only
// changes its address; DOM, classes and Arabic copy are byte-identical.

export function RiskEventsMobileList({
  events,
  sortBy,
  onSelectSort,
}: {
  events: RiskEventRow[];
  /** R160: the current ?sort= value — "" (the default) maps to
   * "created_at:desc" for the chip bar because an absent param IS
   * newest-first (the backend's frozen default). */
  sortBy: string;
  onSelectSort: (value: string) => void;
}) {
  return (
    <>
      {/* Mobile card list (parity with orders/users pattern) */}
      <div className="md:hidden space-y-2.5">
        {/* R160 (risk sort affordance): the mobile control — the desktop
            table's aria-sort headers don't exist in the card layout, so
            the shared FilterTabs chips dialect carries the same
            whitelist (the 44px touch floor is baked into the primitive —
            DESIGN.md spacing.touch-target; the users panel's sort chips
            are the label precedent). The state + the ?sort= write-back
            stay page-owned like every other extract callback. */}
        <FilterTabs
          variant="chips"
          ariaLabel="ترتيب الأحداث"
          value={isRiskSort(sortBy) ? sortBy : "created_at:desc"}
          onSelect={onSelectSort}
          items={RISK_SORT_CHIPS}
        />
        {events.map((e) => {
          const tone = LEVEL_META[e.level];
          const userLabel = e.user_phone ?? e.user_email ?? (e.user_id ? `#${e.user_id}` : "—");
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
                {/* R139 (precision): card-internal separator /30 → /20 —
                    the receipt hairline value (the MobileOrderCard
                    card-internal register). */}
                <div className="flex items-center justify-between text-2xs text-muted-foreground border-t border-border/20 pt-2">
                  <span>{e.action_taken}</span>
                  <span>{formatDate(e.created_at)}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
