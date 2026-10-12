import { Activity, CheckCircle, RefreshCw, WifiOff, XCircle } from "lucide-react";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { formatCount, formatDate } from "@/lib/utils";
import {
  ACTIVITY_COUNT_FORMS,
  ACTIVITY_WINDOW_CAP,
  actionLabel,
  type AdminAuthActivity,
} from "@/components/admin/security/security-meta";

// R137 (FE decomposition): extracted verbatim from pages/admin/security.tsx —
// the auth timeline card: the honest window count (R125-I5 A3-5, the
// 100-row cap disclosure), the failure card with retry (94-C2 A2 P2-1 —
// NEVER the «لا توجد أنشطة» false-empty), the shared EmptyState and the
// activity rows. The page owns the query + the `activities` /
// `activitiesError` derivations; the extract takes values + the onRetry
// callback only (the inline `void activitiesQuery.refetch()` closure
// became the prop — same event, same call).

export function ActivityTimelineCard({
  activities,
  activitiesError,
  onRetry,
}: {
  activities: AdminAuthActivity[];
  activitiesError: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="bg-card border border-border/55 rounded-xl p-4">
      {/* R125-I5 (A3-5): honest count — the timeline used to render
                whatever arrived under a bare «سجل النشاط» heading, an
                audit log presented as complete. The header now names the
                window («عرض N (الأحدث أولاً)», the users/topups count
                idiom) and, when the backend's 100-row cap is hit,
                discloses that older events exist but are not loaded
                (backend pagination stays as-is — frontend honesty
                only). */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-bold">سجل النشاط</h2>
        {activities.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span>عرض {formatCount(activities.length, ACTIVITY_COUNT_FORMS)} (الأحدث أولاً)</span>
            {activities.length >= ACTIVITY_WINDOW_CAP && (
              <span className="block mt-0.5 text-status-warning">
                يعرض أحدث {formatCount(ACTIVITY_WINDOW_CAP, ACTIVITY_COUNT_FORMS)} فقط — قد تكون
                هناك أحداث أقدم
              </span>
            )}
          </div>
        )}
      </div>
      {/* 94-C2 (A2 P2-1): a failed activity load is an error card
              with retry — NOT the "لا توجد أنشطة" false-empty state an
              expired session used to render. */}
      {activitiesError ? (
        <div className="text-center py-10 text-muted-foreground">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
            <WifiOff className="w-7 h-7 text-status-error" />
          </div>
          <p className="font-bold text-base mb-1.5 text-foreground/80">تعذّر تحميل سجل النشاط</p>
          <p className="text-sm mb-5 max-w-xs mx-auto leading-relaxed">{activitiesError}</p>
          <Button onClick={onRetry} className="gap-2 font-bold" variant="outline" size="sm">
            <RefreshCw className="w-3.5 h-3.5" />
            إعادة المحاولة
          </Button>
        </div>
      ) : activities.length === 0 ? (
        <EmptyState icon={Activity} title="لا توجد أنشطة" />
      ) : (
        <div className="space-y-3">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-start gap-4 p-4 border border-border/40 rounded-lg bg-muted/20"
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
                {activity.success ? (
                  <CheckCircle className="w-4 h-4 text-status-success" />
                ) : (
                  <XCircle className="w-4 h-4 text-destructive" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{actionLabel(activity.action)}</span>
                  <span className="text-xs text-muted-foreground">
                    {/* 96-F7 (R96 A6 #6): -u-nu-latn pins Latin digits —
                            engines without ar-LY data fall back to the
                            "ar" root and emit Arabic-Indic numerals. */}
                    {formatDate(activity.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{activity.identifier}</p>
                {activity.failureReason && (
                  <p className="text-xs text-destructive mt-1">{activity.failureReason}</p>
                )}
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                  {activity.provider && <span>المزود: {activity.provider}</span>}
                  {activity.ipAddress && <span>IP: {activity.ipAddress}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
