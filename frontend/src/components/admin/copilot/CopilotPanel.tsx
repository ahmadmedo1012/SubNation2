/**
 * AI Admin Copilot panel (010-ai-admin-copilot, US1).
 *
 * A right-side slide-out (left in RTL) admin panel that posts the admin's
 * natural-language query to /api/admin/copilot/ask and renders the model's
 * response. Phase 1 is read-only — no draft/preview/execute UI is rendered.
 *
 * Open with Ctrl/Cmd+K (or the floating button); close with Esc.
 */

import { useEffect, useRef, useState } from "react";
import { Bot, Sparkles, Send, X, Loader2, AlertTriangle } from "lucide-react";
import { useAdminHeaders } from "@/hooks/use-admin-headers";

interface ToolUseTracePreview {
  name: string;
  input: Record<string, unknown>;
  result_preview: string;
}

interface AskResponse {
  text: string;
  tool_uses: ToolUseTracePreview[];
  input_tokens: number;
  output_tokens: number;
  correlation_id: string;
}

interface ConversationTurn {
  id: string;
  question: string;
  answer: string | null;
  toolUses: ToolUseTracePreview[];
  error: string | null;
  loading: boolean;
}

const SUGGESTIONS = [
  "كم منتجاً نشطاً عندنا؟",
  "اعرض المنتجات التي مخزونها أقل من 5",
  "ما الذي تغيّر في لوحة الإدارة خلال آخر 24 ساعة؟",
  "اشرح لي حالة المنتج الأكثر مبيعاً",
];

export function CopilotPanel() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
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
      .then((j) => {
        if (cancelled) return;
        setEnabled(Boolean(j?.phase1_enabled));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [headers]);

  // Open with Ctrl/Cmd+K, close with Esc.
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
  }, [turns.length]);

  async function submit() {
    const text = input.trim();
    if (!text) return;
    const turn: ConversationTurn = {
      id: `t-${Date.now()}`,
      question: text,
      answer: null,
      toolUses: [],
      error: null,
      loading: true,
    };
    setTurns((prev) => [...prev, turn]);
    setInput("");

    try {
      const resp = await fetch("/api/admin/copilot/ask", {
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
        } | null;
        throw new Error(body?.error ?? `request failed (${resp.status})`);
      }
      const data = (await resp.json()) as AskResponse;
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turn.id
            ? { ...t, answer: data.text, toolUses: data.tool_uses, loading: false }
            : t,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, error: msg, loading: false } : t)),
      );
    }
  }

  if (enabled === null) return null;
  if (!enabled) return null;

  return (
    <>
      {/* Floating trigger button */}
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

      {/* Slide-out panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-150"
            onClick={() => setOpen(false)}
          />
          <aside className="fixed top-0 bottom-0 left-0 w-[min(28rem,95vw)] bg-card border-l border-border z-50 shadow-2xl animate-in slide-in-from-left-8 duration-200 flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/95">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">المساعد الذكي</div>
                <div className="text-[10px] text-muted-foreground">
                  مرحلة 1 — قراءة فقط · لن يقوم بأي تعديل
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
              {turns.length === 0 && (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground leading-6">
                    اطرح سؤالاً عن المنتجات، المخزون، الطلبات، أو نشاط لوحة الإدارة. المساعد سيستخدم
                    بياناتك المباشرة ولن يخترع أي معلومة. لا يقوم بأي تعديل في هذه المرحلة.
                  </div>
                  <div className="space-y-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setInput(s)}
                        className="w-full text-right text-xs px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/40 transition-colors flex items-center gap-2"
                      >
                        <Sparkles className="w-3 h-3 text-primary shrink-0" />
                        <span className="flex-1">{s}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map((turn) => (
                <div key={turn.id} className="space-y-2">
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
                  {turn.answer && (
                    <div className="space-y-2">
                      <div className="bg-muted/40 border border-border/50 rounded-2xl rounded-tr-md px-3 py-2 text-sm whitespace-pre-wrap">
                        {turn.answer}
                      </div>
                      {turn.toolUses.length > 0 && (
                        <details className="text-[11px] text-muted-foreground">
                          <summary className="cursor-pointer hover:text-foreground transition-colors">
                            مصدر البيانات ({turn.toolUses.length})
                          </summary>
                          <div className="mt-1 space-y-1 pr-3 border-r border-border/40">
                            {turn.toolUses.map((tu, i) => (
                              <div key={i} className="font-mono leading-5">
                                <span className="text-primary">{tu.name}</span>(
                                {Object.keys(tu.input).length} args)
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
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
                  placeholder="اكتب سؤالك… (Enter للإرسال، Shift+Enter لسطر جديد)"
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
