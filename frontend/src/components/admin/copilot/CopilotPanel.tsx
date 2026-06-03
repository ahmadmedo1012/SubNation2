/**
 * AI Admin Copilot panel (010-ai-admin-copilot, US1 + US2 + US3).
 *
 * Slide-out panel (right edge in LTR, left edge in RTL) that:
 *   - Phase 1: posts a question to /api/admin/copilot/ask and renders the
 *     model's grounded answer.
 *   - Phase 2: detects when the admin's request is a CHANGE intent and posts
 *     to /draft instead. Renders the returned preview as a structured diff.
 *   - Phase 3: when the admin clicks "موافقة", posts to
 *     /previews/:id/confirm and shows the result. High-risk classes are
 *     rejected by the backend with COPILOT_HIGH_RISK_DISABLED until US4
 *     ships.
 *
 * Open with Ctrl/Cmd+J (or the floating Bot button); close with Esc.
 */

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Sparkles,
  Send,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  ExternalLink,
} from "lucide-react";
import { useAdminHeaders } from "@/hooks/use-admin-headers";

interface PhaseFlags {
  phase1_enabled: boolean;
  phase2_enabled: boolean;
  phase3_enabled: boolean;
  phase3_high_risk_enabled: boolean;
}

interface ToolUseTracePreview {
  name: string;
  input: Record<string, unknown>;
  result_preview: string;
}

interface DirectExecution {
  tool: string;
  success: boolean;
  summary: string;
  data: unknown;
}

interface AskResponse {
  text: string;
  tool_uses: ToolUseTracePreview[];
  direct_executions?: DirectExecution[];
  input_tokens: number;
  output_tokens: number;
  correlation_id: string;
}

interface PreviewChange {
  field: string;
  before: unknown;
  after: unknown;
}

interface PreviewView {
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

interface DraftResponse {
  preview_id: string | null;
  preview: PreviewView | null;
  assistant_text?: string;
  input_tokens: number;
  output_tokens: number;
  correlation_id: string;
}

interface ConfirmResponse {
  outcome: "success" | "partial" | "failure" | "awaiting_double_confirm";
  action_id: number | null;
  result_url?: string | null;
}

type TurnKind = "ask" | "draft";

interface ConversationTurn {
  id: string;
  kind: TurnKind;
  question: string;
  // ASK turn fields
  answer?: string | null;
  toolUses?: ToolUseTracePreview[];
  directExecutions?: DirectExecution[];
  // DRAFT turn fields
  preview?: PreviewView | null;
  previewState?: "pending" | "confirming" | "executed" | "cancelled" | "rejected" | "expired";
  resultUrl?: string | null;
  // shared
  error: string | null;
  loading: boolean;
}

// Heuristic: does this prompt look like a change request? If yes, route to
// /draft instead of /ask. Phase 2 must be enabled or backend returns 503,
// in which case we fall back to /ask automatically.
const CHANGE_VERBS_AR = [
  "حدّث",
  "حدث",
  "غيّر",
  "غير",
  "بدّل",
  "بدل",
  "عدّل",
  "عدل",
  "أضف",
  "اضف",
  "ضع",
  "اجعل",
  "احذف",
  "امسح",
  "إلغ",
  "ألغ",
  "ارفع",
  "اخفض",
  "زد",
  "نقص",
  "أرشف",
  "ارشف",
  "انشر",
];
const CHANGE_VERBS_EN = [
  "update",
  "change",
  "set",
  "edit",
  "modify",
  "rename",
  "add",
  "remove",
  "delete",
  "increase",
  "decrease",
  "raise",
  "lower",
  "publish",
  "archive",
  "unarchive",
];
function looksLikeChangeIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return [...CHANGE_VERBS_AR, ...CHANGE_VERBS_EN].some((v) => t.includes(v.toLowerCase()));
}

const ASK_SUGGESTIONS = [
  "كم منتجاً نشطاً عندنا؟",
  "اعرض المنتجات التي مخزونها أقل من 5",
  "ما الذي تغيّر في لوحة الإدارة خلال آخر 24 ساعة؟",
  "اشرح لي حالة المنتج الأكثر مبيعاً",
];

const DRAFT_SUGGESTIONS = [
  "حدّث وصف المنتج رقم 1 ليذكر الدعم على مدار الساعة",
  "غيّر فئة المنتج رقم 5 إلى trading",
  "أضف سؤالاً وجواباً للمنتج رقم 7 عن سياسة الاسترداد",
];

export function CopilotPanel() {
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<PhaseFlags | null>(null);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const turnsEndRef = useRef<HTMLDivElement>(null);
  const headers = useAdminHeaders({ json: true });

  // Probe Phase 1 availability once. Avoids showing the panel button to
  // admins on a deployment where the copilot is fully off.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/copilot/settings", { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: PhaseFlags | null) => {
        if (cancelled) return;
        setFlags(j ?? null);
      })
      .catch(() => {
        if (!cancelled) setFlags(null);
      });
    return () => {
      cancelled = true;
    };
  }, [headers]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, turns]);

  function patchTurn(id: string, patch: Partial<ConversationTurn>) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function submit() {
    const text = input.trim();
    if (!text) return;
    const phase2 = flags?.phase2_enabled ?? false;
    const phase3 = flags?.phase3_enabled ?? false;
    const wantsChange = phase2 && looksLikeChangeIntent(text);

    const turn: ConversationTurn = {
      id: `t-${Date.now()}`,
      kind: wantsChange ? "draft" : "ask",
      question: text,
      error: null,
      loading: true,
      previewState: wantsChange ? "pending" : undefined,
    };
    setTurns((prev) => [...prev, turn]);
    setInput("");

    try {
      if (wantsChange) {
        const resp = await fetch("/api/admin/copilot/draft", {
          method: "POST",
          headers,
          body: JSON.stringify({
            intent_text: text,
            context: { route: window.location.pathname },
          }),
        });
        if (!resp.ok) {
          const body = (await resp.json().catch(() => null)) as {
            error?: string;
            code?: string;
            message?: string;
          } | null;
          // If Phase 2 not enabled, retry as /ask automatically.
          if (resp.status === 503 || body?.code === "COPILOT_PHASE_DISABLED") {
            await runAsk(turn.id, text);
            return;
          }
          throw new Error(body?.error ?? body?.message ?? `request failed (${resp.status})`);
        }
        const data = (await resp.json()) as DraftResponse;
        if (!data.preview_id || !data.preview) {
          // Model declined to draft; show the assistant text as a normal answer.
          patchTurn(turn.id, {
            kind: "ask",
            answer: data.assistant_text ?? "(no answer)",
            toolUses: [],
            previewState: undefined,
            loading: false,
          });
          return;
        }
        patchTurn(turn.id, {
          preview: data.preview,
          previewState: phase3 ? "pending" : "rejected",
          loading: false,
        });
        if (!phase3) {
          patchTurn(turn.id, {
            error: "المرحلة 3 غير مفعّلة. يمكنك مراجعة المعاينة لكن لا يمكن تنفيذها بعد.",
          });
        }
      } else {
        await runAsk(turn.id, text);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      patchTurn(turn.id, { error: msg, loading: false });
    }
  }

  async function runAsk(turnId: string, text: string) {
    const resp = await fetch("/api/admin/copilot/ask", {
      method: "POST",
      headers,
      body: JSON.stringify({ intent_text: text, context: { route: window.location.pathname } }),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `request failed (${resp.status})`);
    }
    const data = (await resp.json()) as AskResponse;
    patchTurn(turnId, {
      kind: "ask",
      answer: data.text,
      toolUses: data.tool_uses,
      directExecutions: data.direct_executions ?? [],
      previewState: undefined,
      loading: false,
    });
  }

  async function approve(turn: ConversationTurn) {
    if (!turn.preview) return;
    patchTurn(turn.id, { previewState: "confirming", error: null });
    try {
      const resp = await fetch(`/api/admin/copilot/previews/${turn.preview.id}/confirm`, {
        method: "POST",
        headers,
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as {
          error?: string;
          code?: string;
          stale_ids?: number[];
        } | null;
        throw new Error(body?.error ?? `confirm failed (${resp.status})`);
      }
      const data = (await resp.json()) as ConfirmResponse;
      patchTurn(turn.id, {
        previewState: "executed",
        resultUrl: data.result_url ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      patchTurn(turn.id, { previewState: "pending", error: msg });
    }
  }

  async function cancelPreview(turn: ConversationTurn) {
    if (!turn.preview) return;
    try {
      await fetch(`/api/admin/copilot/previews/${turn.preview.id}/cancel`, {
        method: "POST",
        headers,
      });
    } catch {
      // Ignore — backend audit will still record if reachable.
    }
    patchTurn(turn.id, { previewState: "cancelled", error: null });
  }

  if (flags === null) return null;
  if (!flags.phase1_enabled) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 left-6 z-30 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-2xl hover:scale-105 active:scale-95 transition-transform flex items-center justify-center"
          title="المساعد الذكي (Ctrl/Cmd+J)"
          aria-label="فتح المساعد الذكي"
        >
          <Bot className="w-5 h-5" />
        </button>
      )}

      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-150"
            onClick={() => setOpen(false)}
          />
          <aside className="fixed top-0 bottom-0 left-0 w-[min(32rem,95vw)] bg-card border-l border-border z-50 shadow-2xl animate-in slide-in-from-left-8 duration-200 flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/95">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">المساعد الذكي</div>
                <div className="text-[10px] text-muted-foreground">
                  {flags.phase3_enabled
                    ? "مرحلة 3 — يمكن تنفيذ التعديلات منخفضة الخطورة بعد الموافقة"
                    : flags.phase2_enabled
                      ? "مرحلة 2 — يمكن اقتراح تعديلات لكن لا تنفّذ بعد"
                      : "مرحلة 1 — قراءة فقط"}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Conversation */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {turns.length === 0 && <EmptyState flags={flags} onPick={(s) => setInput(s)} />}

              {turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  onApprove={() => void approve(turn)}
                  onCancel={() => void cancelPreview(turn)}
                />
              ))}
              <div ref={turnsEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-border bg-card/95 px-3 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  rows={2}
                  placeholder="اكتب سؤالك أو أمراً للتعديل…"
                  className="flex-1 resize-none bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  onClick={() => void submit()}
                  disabled={!input.trim()}
                  className="w-9 h-9 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center shrink-0"
                  aria-label="إرسال"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>كل المحادثات تُسجَّل للمراجعة الأمنية</span>
                <kbd className="font-mono bg-muted border border-border/50 px-1 py-0.5 rounded">
                  ⌘J
                </kbd>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function EmptyState({ flags, onPick }: { flags: PhaseFlags; onPick: (s: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground leading-6">
        اطرح سؤالاً عن المنتجات والمخزون والأنشطة الإدارية. المساعد سيستخدم بياناتك المباشرة ولن
        يخترع أي معلومة.
        {flags.phase2_enabled
          ? " يمكنك أيضاً طلب تعديلات بسيطة وستحصل على معاينة قبل التنفيذ."
          : ""}
      </div>
      <div className="space-y-1.5">
        <div className="text-[11px] text-muted-foreground font-bold pr-1">أمثلة للقراءة</div>
        {ASK_SUGGESTIONS.map((s) => (
          <SuggestionRow key={s} text={s} onPick={onPick} />
        ))}
        {flags.phase2_enabled && (
          <>
            <div className="text-[11px] text-muted-foreground font-bold pr-1 pt-2">
              أمثلة للتعديل (تحتاج موافقتك)
            </div>
            {DRAFT_SUGGESTIONS.map((s) => (
              <SuggestionRow key={s} text={s} onPick={onPick} icon="pencil" />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SuggestionRow({
  text,
  onPick,
  icon = "spark",
}: {
  text: string;
  onPick: (s: string) => void;
  icon?: "spark" | "pencil";
}) {
  const Icon = icon === "pencil" ? Pencil : Sparkles;
  return (
    <button
      onClick={() => onPick(text)}
      className="w-full text-right text-xs px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/40 transition-colors flex items-center gap-2"
    >
      <Icon className="w-3 h-3 text-primary shrink-0" />
      <span className="flex-1">{text}</span>
    </button>
  );
}

function TurnView({
  turn,
  onApprove,
  onCancel,
}: {
  turn: ConversationTurn;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary/10 text-foreground rounded-2xl rounded-tl-md px-3 py-2 text-sm whitespace-pre-wrap">
          {turn.question}
        </div>
      </div>
      {turn.loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> جاري التفكير…
        </div>
      )}
      {turn.error && (
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{turn.error}</span>
        </div>
      )}
      {turn.kind === "ask" && turn.answer && (
        <AskAnswer
          answer={turn.answer}
          toolUses={turn.toolUses ?? []}
          directExecutions={turn.directExecutions ?? []}
        />
      )}
      {turn.kind === "draft" && turn.preview && (
        <PreviewCard
          preview={turn.preview}
          state={turn.previewState ?? "pending"}
          resultUrl={turn.resultUrl ?? null}
          onApprove={onApprove}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

function AskAnswer({
  answer,
  toolUses,
  directExecutions,
}: {
  answer: string;
  toolUses: ToolUseTracePreview[];
  directExecutions: DirectExecution[];
}) {
  return (
    <div className="space-y-2">
      {directExecutions.length > 0 && (
        <div className="space-y-1">
          {directExecutions.map((d, i) => (
            <DirectExecutionBadge key={i} item={d} />
          ))}
        </div>
      )}
      <div className="bg-muted/40 border border-border/50 rounded-2xl rounded-tr-md px-3 py-2 text-sm whitespace-pre-wrap">
        {answer}
      </div>
      {toolUses.length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">
            مصدر البيانات ({toolUses.length})
          </summary>
          <div className="mt-1 space-y-1 pr-3 border-r border-border/40">
            {toolUses.map((tu, i) => (
              <div key={i} className="font-mono leading-5">
                <span className="text-primary">{tu.name}</span>({Object.keys(tu.input).length} args)
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function DirectExecutionBadge({ item }: { item: DirectExecution }) {
  const ok = item.success;
  type ProductData = {
    productId?: number;
    productName?: string;
    before_stock?: number;
    after_stock?: number;
    diff?: Array<{ field: string }>;
  };
  const data = (item.data ?? {}) as ProductData;
  const fields = Array.isArray(data.diff) ? data.diff.map((d) => d.field).join(", ") : null;
  const stockChange =
    typeof data.before_stock === "number" && typeof data.after_stock === "number"
      ? `${data.before_stock} → ${data.after_stock}`
      : null;
  return (
    <div
      className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2 border ${
        ok
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          : "bg-destructive/10 border-destructive/30 text-destructive"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-bold">
          {ok ? "تم التنفيذ" : "فشل التنفيذ"}: <span className="font-mono">{item.tool}</span>
        </div>
        {ok && data.productName && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {data.productName} (#{data.productId}){fields && ` — ${fields}`}
            {stockChange && ` — مخزون: ${stockChange}`}
          </div>
        )}
        {!ok && <div className="text-[11px] mt-0.5">{item.summary}</div>}
      </div>
    </div>
  );
}

function PreviewCard({
  preview,
  state,
  resultUrl,
  onApprove,
  onCancel,
}: {
  preview: PreviewView;
  state: NonNullable<ConversationTurn["previewState"]>;
  resultUrl: string | null;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const isHighRisk = preview.risk_tier === "high";
  const isNoExec = preview.risk_tier === "no_execute";
  const changes = preview.payload.changes ?? [];

  return (
    <div className="border border-border rounded-2xl rounded-tr-md bg-muted/20">
      <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2 text-[11px]">
        <span className={`font-bold ${isHighRisk ? "text-amber-400" : "text-primary"}`}>
          معاينة — {preview.action_class}
        </span>
        <span className="text-muted-foreground">
          • {isHighRisk ? "عالية الخطورة" : isNoExec ? "إحالة لأداة المحفظة" : "منخفضة الخطورة"}
        </span>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div className="text-sm">{preview.intent_summary}</div>

        {changes.length > 0 && (
          <div className="space-y-1.5">
            {changes.map((c, i) => (
              <ChangeDiff key={i} change={c} />
            ))}
          </div>
        )}

        {preview.payload.side_effects.length > 0 && (
          <ul className="text-[11px] text-amber-400/90 list-disc pr-4 space-y-0.5">
            {preview.payload.side_effects.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}

        {preview.payload.validation_warnings.map((w, i) => (
          <div
            key={i}
            className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-2 py-1"
          >
            {w.message}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-border/60 flex items-center gap-2">
        {state === "pending" && (
          <>
            <button
              onClick={onApprove}
              disabled={isHighRisk || isNoExec}
              className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              موافقة وتنفيذ
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-xs"
            >
              إلغاء
            </button>
          </>
        )}
        {state === "confirming" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> جاري التنفيذ…
          </div>
        )}
        {state === "executed" && (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> تم التنفيذ
            {resultUrl && (
              <a
                href={resultUrl}
                className="text-primary hover:underline flex items-center gap-1 mr-auto"
              >
                فتح <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
        {state === "cancelled" && <div className="text-xs text-muted-foreground">تم الإلغاء</div>}
        {state === "rejected" && (
          <div className="text-xs text-muted-foreground">المرحلة 3 غير مفعّلة — مراجعة فقط</div>
        )}
        {state === "expired" && (
          <div className="text-xs text-muted-foreground">انتهت صلاحية المعاينة (5 دقائق)</div>
        )}
      </div>
    </div>
  );
}

function ChangeDiff({ change }: { change: PreviewChange }) {
  const fmt = (v: unknown) => {
    if (v === null || v === undefined) return "(فارغ)";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  };
  return (
    <div className="border border-border/40 rounded-lg bg-background/50">
      <div className="px-2 py-1 text-[11px] font-bold text-muted-foreground border-b border-border/40">
        {change.field}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border/40">
        <div className="bg-destructive/5 px-2 py-1.5 text-xs whitespace-pre-wrap break-words">
          <div className="text-[10px] text-muted-foreground mb-0.5">قبل</div>
          {fmt(change.before)}
        </div>
        <div className="bg-emerald-500/5 px-2 py-1.5 text-xs whitespace-pre-wrap break-words">
          <div className="text-[10px] text-muted-foreground mb-0.5">بعد</div>
          {fmt(change.after)}
        </div>
      </div>
    </div>
  );
}
