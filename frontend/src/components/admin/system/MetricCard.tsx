import { Server } from "lucide-react";
import { type ReactElement, Suspense } from "react";
import { ChartsLoader } from "@/components/admin/system/system-charts";

// R137 (FE decomposition): extracted verbatim from pages/admin/system.tsx —
// the diagnostics KPI card (icon tile + value + sub + the optional lazy
// recharts sparkline with its height-reserved shimmer). Labels, values,
// series and spark colors flow down as props; the move only changes its
// address, DOM/classes byte-identical.

export function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  color = "text-foreground",
  bg = "bg-muted/30",
  border = "border-border/60",
  spark,
  sparkColor,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Server;
  color?: string;
  bg?: string;
  border?: string;
  spark?: number[];
  sparkColor?: string;
}): ReactElement {
  return (
    <div className={`bg-card border ${border} rounded-2xl p-4 flex flex-col`}>
      <div className="flex items-center gap-2 mb-2.5">
        <div
          className={`w-8 h-8 ${bg} border ${border} rounded-xl flex items-center justify-center shrink-0`}
        >
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <span className="text-3xs text-muted-foreground font-bold">{label}</span>
      </div>
      <div className="font-bold text-lg leading-none tabular-nums">{value}</div>
      {sub && <div className="text-3xs text-muted-foreground mt-1">{sub}</div>}
      {spark && spark.length >= 2 && (
        /* R125-I2 (A5-F3): the sparkline rides the lazy recharts bridge —
           a height-reserved shimmer keeps the card's 28px slot so the
           vendor-charts fetch causes zero layout shift. */
        <div className="mt-2 -mx-1 opacity-70">
          <Suspense
            fallback={<div className="h-7 skeleton-shimmer rounded-lg" aria-hidden="true" />}
          >
            <ChartsLoader>
              {(rc) => (
                <rc.ResponsiveContainer width="100%" height={28}>
                  <rc.LineChart
                    data={spark.map((v, i) => ({ i, v }))}
                    margin={{ top: 1, right: 1, left: 1, bottom: 1 }}
                  >
                    <rc.Line
                      type="monotone"
                      dataKey="v"
                      stroke={sparkColor ?? "currentColor"}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </rc.LineChart>
                </rc.ResponsiveContainer>
              )}
            </ChartsLoader>
          </Suspense>
        </div>
      )}
    </div>
  );
}
