// R137 (FE decomposition): extracted verbatim from pages/admin/pricing.tsx —
// the risk-state presentation maps + the WHY-text resolver moved to their
// own React-free module so the page file shrinks to orchestration. Pure data
// + pure function, zero behavior change (the outputs-card extract imports
// them by name — every lookup stays byte-identical).

import type { CalculatorResponse, RiskState } from "@/components/admin/pricing/pricing-types";

/** Arabic labels for the risk states (documented thresholds). */
export const RISK_STATE_LABEL: Record<RiskState, string> = {
  SAFE: "آمن",
  WATCH: "تحت المراقبة",
  THIN: "هامش ضعيف",
  LOSS: "خسارة",
};

// Never bare colors (A5 Part 15): each state renders WITH its warning
// text — the tone classes below carry the color, riskExplanation()
// supplies the WHY.
export const RISK_STATE_TONE: Record<RiskState, string> = {
  SAFE: "border-status-success/40 bg-status-success/10 text-status-success",
  WATCH: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  THIN: "border-status-low-stock/40 bg-status-low-stock/10 text-status-low-stock",
  LOSS: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** The WHY next to the badge — the backend's own Arabic warning when one
 *  matches the state, the threshold explainer otherwise. */
export function riskExplanation(result: CalculatorResponse): string {
  switch (result.risk_state) {
    case "LOSS":
      return (
        result.warnings.find((w) => w.severity === "loss")?.message_ar ??
        "البيع تحت التكلفة أو صافي الربح سالب بعد التزامات البرنامج."
      );
    case "THIN":
      return (
        result.warnings.find((w) => w.code === "thin_gross_margin")?.message_ar ??
        "هامش الربح الإجمالي أقل من 5%."
      );
    case "WATCH": {
      const noCost = result.warnings.find((w) => w.code === "no_cost_price");
      if (noCost) return noCost.message_ar;
      return (
        result.warnings.find((w) => w.code === "watch_gross_margin")?.message_ar ??
        "هامش الربح الإجمالي أقل من 15%."
      );
    }
    default:
      return "الهامش الإجمالي ضمن النطاق المريح (15% أو أكثر).";
  }
}
