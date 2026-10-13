// R137 (FE decomposition): extracted verbatim from pages/admin/risk.tsx —
// the risk queue's pure metadata moved to its own React-free module so
// the page file shrinks to orchestration. The page (and the extracts)
// import these by name — the contracts, the level/tone maps and the
// filter list are byte-identical; ZERO behavior change. All three
// queries (dashboard / events / the unfiltered counter source) stay in
// the page — nothing here performs IO.
import type { StatusBadgeVariant } from "@/components/ui/status-badge";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskEventRow {
  id: number;
  user_id: number | null;
  user_phone: string | null;
  user_email: string | null;
  event_type: string;
  score: number;
  level: RiskLevel;
  confidence: number;
  rule_fired: string[];
  action_taken: string;
  ip_address: string | null;
  created_at: string;
  shown_at: string | null;
}

export interface ListResponse {
  events: RiskEventRow[];
  next_cursor: string | null;
}

export interface DashboardResponse {
  window_hours: number;
  total: number;
  by_level: Record<RiskLevel, number>;
  unresolved: number;
  top_rules: Array<{ rule: string; count: number }>;
  pipeline: { enabled: boolean };
}

export const LEVEL_META: Record<RiskLevel, { label: string; tone: StatusBadgeVariant }> = {
  low: { label: "منخفض", tone: "success" },
  medium: { label: "متوسط", tone: "warning" },
  high: { label: "عالي", tone: "low-stock" },
  critical: { label: "حرج", tone: "error" },
};

export const FILTERS: { value: "all" | RiskLevel; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "critical", label: "حرج" },
  { value: "high", label: "عالي" },
  { value: "medium", label: "متوسط" },
  { value: "low", label: "منخفض" },
];

// Active filter-chip styling derived from the same status tokens as the
// row pills (93-C7 / C-UX2) — chip + badge can no longer disagree.
export const TONE_CHIP: Record<StatusBadgeVariant, string> = {
  success: "bg-status-success/15 text-status-success border-status-success/40",
  warning: "bg-status-warning/15 text-status-warning border-status-warning/40",
  error: "bg-status-error/15 text-status-error border-status-error/40",
  "low-stock": "bg-status-low-stock/15 text-status-low-stock border-status-low-stock/40",
  info: "bg-status-info/15 text-status-info border-status-info/40",
  purple: "bg-status-purple/15 text-status-purple border-status-purple/40",
  primary: "bg-primary/15 text-primary-text border-primary/40",
  neutral: "bg-muted/45 text-muted-foreground border-border/50",
};
