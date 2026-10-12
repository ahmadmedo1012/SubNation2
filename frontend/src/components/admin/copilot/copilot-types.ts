// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// copilot DTO + conversation model types moved to their own React-free
// module so the panel file shrinks to orchestration. ZERO behavior change:
// the panel and every extract import them by name; each field survives
// byte-identical (the persistence suite still derives its Conversation
// shape from `Parameters<typeof stripTransientLoading>`).

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface PhaseFlags {
  phase1_enabled: boolean;
  phase2_enabled: boolean;
  phase3_enabled: boolean;
  phase3_high_risk_enabled: boolean;
}

export interface ToolUseTracePreview {
  name: string;
  input: Record<string, unknown>;
  result_preview: string;
}

export interface DirectExecution {
  tool: string;
  success: boolean;
  summary: string;
  data: unknown;
}

export interface AskResponse {
  text: string;
  tool_uses: ToolUseTracePreview[];
  direct_executions?: DirectExecution[];
  input_tokens: number;
  output_tokens: number;
  correlation_id: string;
}

export interface PreviewChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface PreviewView {
  id: string;
  intent_text: string;
  intent_summary: string;
  action_class: string;
  risk_tier: "low" | "high" | "no_execute";
  payload: {
    kind: "single" | "bulk";
    intent_summary: string;
    side_effects: string[];
    validation_warnings: Array<{ severity: string; code: string; message: string }>;
    irreversible: boolean;
    entity_type?: string;
    entity_id?: number;
    changes?: PreviewChange[];
    handoff?: { target_url: string; rationale: string } | null;
  };
  created_at: string;
  expires_at: string;
}

export interface DraftResponse {
  preview_id: string | null;
  preview: PreviewView | null;
  assistant_text?: string;
  input_tokens: number;
  output_tokens: number;
  correlation_id: string;
}

export interface ConfirmResponse {
  outcome: "success" | "partial" | "failure" | "awaiting_double_confirm";
  action_id: number | null;
  result_url?: string | null;
  /** Present when outcome === "awaiting_double_confirm" — server-side clock. */
  cooldown_starts_at?: string;
  cooldown_ends_at?: string;
  cooldown_seconds?: number;
}

export type TurnKind = "ask" | "draft";

export interface ConversationTurn {
  id: string;
  kind: TurnKind;
  question: string;
  answer?: string | null;
  toolUses?: ToolUseTracePreview[];
  directExecutions?: DirectExecution[];
  /** Live progress messages while the request is in-flight. */
  progress?: string[];
  preview?: PreviewView | null;
  previewState?:
    | "pending"
    | "confirming"
    | "awaiting_double_confirm"
    | "double_confirming"
    | "executed"
    | "cancelled"
    | "rejected"
    | "expired";
  /** Server-side clock for the 3-second cooldown on high-risk previews. */
  cooldownEndsAt?: number | null;
  resultUrl?: string | null;
  error: string | null;
  loading: boolean;
  ts: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ConversationTurn[];
}
