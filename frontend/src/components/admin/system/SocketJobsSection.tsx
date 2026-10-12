import { TimerReset, Wifi } from "lucide-react";
import { DetailsSection } from "@/components/admin/system/DetailsSection";
import { formatNumber } from "@/components/admin/system/system-format";
import type { MetricsSnapshot } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the Socket.IO + background-jobs panel of the advanced-diagnostics
// section (live clients/events counters + the sorted jobsTotal list with
// its failed-dot verdicts). The metrics query stays in the page — the
// snapshot flows down as a value; the move only changes its address,
// DOM/classes byte-identical.

export function SocketJobsSection({ metrics }: { metrics: MetricsSnapshot }) {
  return (
    <DetailsSection title="Socket.IO والمهام الخلفية (cron · watchers · heartbeat)">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Socket.IO */}
        <div className="bg-card border border-border/60 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wifi className="w-4 h-4 text-status-info" />
            <h3 className="text-sm font-bold">Socket.IO</h3>
            <span className="text-3xs text-muted-foreground mr-auto">واجهات لحظية</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-3xs text-muted-foreground font-bold mb-1">عملاء متّصلون</div>
              <div className="font-bold text-2xl text-status-info tabular-nums">
                {metrics.socket.connectedClients}
              </div>
            </div>
            <div>
              <div className="text-3xs text-muted-foreground font-bold mb-1">إجمالي الأحداث</div>
              <div className="font-bold text-2xl tabular-nums">
                {formatNumber(Object.values(metrics.socket.eventsTotal).reduce((a, b) => a + b, 0))}
              </div>
            </div>
          </div>
        </div>

        {/* Background jobs */}
        <div className="bg-card border border-border/60 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <TimerReset className="w-4 h-4 text-status-success" />
            <h3 className="text-sm font-bold">المهام الخلفية</h3>
            <span className="text-3xs text-muted-foreground mr-auto">
              cron · watchers · heartbeat
            </span>
          </div>
          {Object.keys(metrics.worker.jobsTotal).length === 0 ? (
            <div className="text-xs text-muted-foreground py-3 text-center">
              لم تُسجَّل أي مهمة بعد
            </div>
          ) : (
            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {Object.entries(metrics.worker.jobsTotal)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 8)
                .map(([key, count]) => {
                  const [job, status] = key.split(":");
                  const isFailed = status === "failed";
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-2 text-xs py-1 border-b border-border/30 last:border-0"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isFailed ? "bg-status-error" : "bg-status-success"
                        }`}
                      />
                      <span className="font-mono text-muted-foreground truncate" dir="ltr">
                        {job}
                      </span>
                      <span className="text-3xs text-muted-foreground shrink-0">{status}</span>
                      <span className="font-bold tabular-nums shrink-0 mr-auto">{count}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </DetailsSection>
  );
}
