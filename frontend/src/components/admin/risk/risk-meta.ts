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

// ── R160 (the R158-A P3 «no sort affordance on risk»): the ?sort=
// whitelist ──────────────────────────────────────────────────────────
// Hand-mirrors the backend route's zod enum (backend/src/routes/admin/
// risk.ts RISK_SORT_VALUES) and the openapi param (the generated
// ListAdminRiskEventsSort). The generated const is deliberately NOT
// imported here: the admin risk render suites stub the global fetch
// and never mock the generated client, but keeping the meta React-free
// + self-contained preserves the r137 purity contract; the
// risk-sort test pins meta ↔ generated parity. Keep the three lists in
// lockstep.
export const RISK_SORTS = ["created_at:asc", "created_at:desc", "score:asc", "score:desc"] as const;
export type RiskSort = (typeof RISK_SORTS)[number];

/** Tolerant intake: an invalid ?sort= deep link degrades to the default
 * ordering ("" — the param is dropped) instead of a 400. */
export const isRiskSort = (v: string): v is RiskSort =>
  (RISK_SORTS as readonly string[]).includes(v);

/** The desktop sortable-header toggle: the default ("" — no ?sort= param)
 * IS created_at DESC (the queue's frozen default), so the effective
 * direction maps through before the asc/desc flip. */
export function nextRiskSort(key: "created_at" | "score", current: string): RiskSort {
  const effective = current === "" ? "created_at:desc" : current;
  return effective === `${key}:desc` ? `${key}:asc` : `${key}:desc`;
}

// R160: the mobile chip labels (the shared FilterTabs chips dialect —
// the users panel's «الأقدم» label precedent). The default maps to
// «الأحدث» because an absent ?sort= is newest-first.
export const RISK_SORT_CHIPS: Array<{ value: RiskSort; label: string }> = [
  { value: "created_at:desc", label: "الأحدث" },
  { value: "created_at:asc", label: "الأقدم" },
  { value: "score:desc", label: "الأعلى نقاطًا" },
  { value: "score:asc", label: "الأقل نقاطًا" },
];
