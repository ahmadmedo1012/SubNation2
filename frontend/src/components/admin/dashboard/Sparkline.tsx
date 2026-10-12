import { Suspense } from "react";
import type { ChartDay } from "./chart-data";
import { ChartPanelFallback, ChartsLoader } from "./ChartsLoader";

// R137 (FE admin decomposition): the KPI mini-sparkline moved verbatim from
// pages/admin/dashboard.tsx — the chart series it renders flows down as a
// value; the lazy recharts boundary rides the shared ChartsLoader bridge.

// Mini sparkline for KPI trend — uses last N days of chart data.
// R125-I2 (A5-F3): rides the lazy recharts bridge (see ChartsLoader)
// with a height-reserved fallback — the KPI tiles paint before
// vendor-charts lands and the 32px slot never shifts.
export function Sparkline({
  data,
  dataKey,
  color,
}: {
  data: ChartDay[];
  dataKey: keyof ChartDay;
  color: string;
}) {
  if (data.length < 2) return null;
  return (
    <Suspense fallback={<ChartPanelFallback heightClass="h-8" />}>
      <ChartsLoader>
        {(rc) => (
          <rc.ResponsiveContainer width="100%" height={32}>
            <rc.LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
              <rc.Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={1.5}
                dot={false}
              />
            </rc.LineChart>
          </rc.ResponsiveContainer>
        )}
      </ChartsLoader>
    </Suspense>
  );
}
