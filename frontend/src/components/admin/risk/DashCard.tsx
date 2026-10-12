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
  const tones = {
    ok: "border-border/40 bg-card/60",
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
      <div className={`text-xl font-bold mt-0.5 ${valueColor[tone]}`}>{value}</div>
      {hint && <div className="text-3xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
