// R137 (FE decomposition): extracted verbatim from pages/admin/risk.tsx —
// the dashboard stat tile (label / value / optional hint / ok-warn-danger
// tone). Purely presentational — every value arrives as a prop; this
// shell owns no state. The move only changes its address; DOM, classes
// and Arabic copy are byte-identical.

export function DashCard({
  label,
  value,
  hint,
  tone = "ok",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "danger";
}) {
  // R139 (precision): the ok tone solidifies — bg-card/60 → bg-card (the
  // r138 translucent retirement) with the family's /60 resting edge; the
  // warn/danger tints keep their token borders + /5 washes (§6 severity
  // tiles — token tints, and the hint/reason line below keeps the WHY).
  const tones = {
    ok: "border-border/60 bg-card",
    warn: "border-status-warning/30 bg-status-warning/5",
    danger: "border-status-error/30 bg-status-error/5",
  };
  const valueColor = {
    ok: "",
    warn: "text-status-warning",
    danger: "text-status-error",
  };
  return (
    <div className={`border rounded-xl p-3 ${tones[tone]}`}>
      <div className="text-3xs text-muted-foreground">{label}</div>
      {/* R139 (precision): + tabular-nums — the counts ride the money-digit
          convention (the MetricCard value register). */}
      <div className={`text-xl font-bold mt-0.5 tabular-nums ${valueColor[tone]}`}>{value}</div>
      {hint && <div className="text-3xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
