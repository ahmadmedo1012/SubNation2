import { TimerReset } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { DetailsSection } from "@/components/admin/system/DetailsSection";
import type { StatusMetaEntry } from "@/components/admin/system/system-meta";
import type { SchedulerResponse } from "@/components/admin/system/system-types";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the scheduler details panel of the advanced-diagnostics section (tone
// banner + mode/leader/startedAt chips). The scheduler query and the
// banner derivation stay in the page — tone/meta/title/message flow down
// as values; the move only changes its address, DOM/classes
// byte-identical.

export function SchedulerDetailsSection({
  scheduler,
  schedMeta,
  schedTitle,
  schedMessage,
}: {
  scheduler: SchedulerResponse | undefined;
  schedMeta: StatusMetaEntry;
  schedTitle: string;
  schedMessage: string;
}) {
  return (
    <DetailsSection title="تفاصيل الجدولة">
      <div
        className={`flex items-center justify-between gap-4 p-3 rounded-xl border ${schedMeta.bg} ${schedMeta.border}`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-xl ${schedMeta.bg} flex items-center justify-center shrink-0`}
          >
            <TimerReset className={`w-4 h-4 ${schedMeta.color}`} />
          </div>
          <div className="min-w-0">
            <p className={`font-bold text-sm ${schedMeta.color}`}>{schedTitle}</p>
            <p className="text-xs text-muted-foreground">{schedMessage}</p>
            {scheduler && (
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-3xs font-mono px-1.5 py-0.5 rounded bg-muted/40 border border-border/40 text-muted-foreground">
                  mode: {scheduler.mode}
                </span>
                {scheduler.isLeader && (
                  /* R125-I2 (A6-B6): --primary-text — raw --primary
                   * on its own /10 tint is 3.56:1 on dark (text
                   * floor 4.5:1); the mono `leader` value is
                   * TEXT. */
                  <span className="text-3xs font-mono px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary-text">
                    leader
                  </span>
                )}
                {scheduler.startedAt && (
                  <span className="text-3xs text-muted-foreground" title={scheduler.startedAt}>
                    {/* 93-C6 / F-06: the formatter now emits its
                        own «قبل …» wording — a hand-written
                        «منذ» prefix would double up. */}
                    {formatRelativeTime(scheduler.startedAt)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DetailsSection>
  );
}
