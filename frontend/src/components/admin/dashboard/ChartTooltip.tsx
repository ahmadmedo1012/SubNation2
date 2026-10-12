import { formatCurrency } from "@/lib/utils";

// R137 (FE admin decomposition): the shared recharts tooltip moved verbatim
// from pages/admin/dashboard.tsx — every chart panel in this folder passes
// it to <rc.Tooltip content={<ChartTooltip />} /> unchanged.

const CURRENCY_KEYS = new Set(["الإيرادات", "الخصومات"]);

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}

export const ChartTooltip = ({ active, payload, label }: ChartTooltipProps) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-2xl text-xs min-w-[150px]">
      <p className="font-bold text-muted-foreground mb-2">{label}</p>
      {payload.map((p: { value: number; name: string; color: string }) => (
        <div key={p.name} className="flex items-center justify-between gap-4 mb-1 last:mb-0">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
          </div>
          <span className="font-bold tabular-nums">
            {CURRENCY_KEYS.has(p.name) ? formatCurrency(Number(p.value)) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};
