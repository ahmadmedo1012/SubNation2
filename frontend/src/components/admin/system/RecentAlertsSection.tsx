import { AlertTriangle, ChevronLeft, Inbox } from "lucide-react";
import { SkeletonText } from "@/components/ui/Skeleton";
import { formatRelativeTime } from "@/lib/utils";
import { Link } from "wouter";
import type { RecentAlert } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the recent-alerts panel (announcing skeleton / empty state / the
// five-row alert list with its relative timestamps + the «عرض الكل»
// deep-link). The alerts query stays in the page — loading/data flow down
// as values; the move only changes its address, DOM/classes
// byte-identical.

export function RecentAlertsSection({
  alertsLoading,
  recentAlerts,
}: {
  alertsLoading: boolean;
  recentAlerts: RecentAlert[];
}) {
  return (
    <section className="space-y-3 float-in stagger-9">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">آخر التنبيهات</h2>
        <Link href="/admin/alerts">
          <span className="text-xs text-muted-foreground hover:text-primary-text transition-colors cursor-pointer">
            {/* RTL: forward link arrow points left (unified icon-direction decision) */}
            عرض الكل <ChevronLeft className="w-3 h-3 inline" />
          </span>
        </Link>
      </div>
      {alertsLoading ? (
        /* R136 (UX-1): SkeletonText — the 3-row alerts stack,
           geometry verbatim; the pair is net-new. */
        <SkeletonText
          count={3}
          wrapperClassName="space-y-2"
          className="h-[56px] rounded-xl"
          lastShorter={false}
        />
      ) : recentAlerts.length === 0 ? (
        <div className="bg-card border border-border/60 rounded-2xl p-6 flex flex-col items-center gap-2 text-muted-foreground">
          <Inbox className="w-6 h-6 opacity-30" />
          <span className="text-xs">لا توجد تنبيهات حديثة</span>
        </div>
      ) : (
        <div className="bg-card border border-border/60 rounded-2xl divide-y divide-border/40 overflow-hidden">
          {recentAlerts.slice(0, 5).map((alert) => (
            <Link key={alert.id} href="/admin/alerts">
              <div className="flex items-start gap-3 px-4 py-3 hover:bg-muted/20 transition-colors cursor-pointer">
                <AlertTriangle className="w-3.5 h-3.5 text-status-warning shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate">{alert.title}</div>
                  {alert.message && (
                    <div className="text-2xs text-muted-foreground truncate">{alert.message}</div>
                  )}
                </div>
                <span className="text-3xs text-muted-foreground shrink-0">
                  {formatRelativeTime(alert.createdAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
