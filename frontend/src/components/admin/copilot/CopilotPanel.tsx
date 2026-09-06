/**
 * AI Admin Copilot panel (010-ai-admin-copilot).
 *
 * Phase 1 (read), Phase 2 (draft + preview), Phase 3 (low-risk execute),
 * plus Super-admin direct-execute (resolve_product / update_product /
 * update_stock).
 *
 * UX features:
 *   - Multi-conversation persistence in localStorage (8 most-recent kept).
 *   - Per-turn conversation memory: the last 6 messages of the active
 *     conversation are sent with every request so the model remembers
 *     "the product I was talking about".
 *   - Fullscreen mode for long inspection sessions.
 *   - Markdown-lite rendering (bold, code, lists, line breaks) for the
 *     assistant's replies — tools sometimes return formatted output.
 *   - Copy / retry buttons per turn.
 *   - Auto-growing input.
 *   - Open with Ctrl/Cmd+J, close with Esc.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
  Plus,
  MessageSquare,
  Trash2,
  Copy,
  RefreshCw,
  Maximize2,
  Minimize2,
  Menu,
  Check,
  History,
} from "lucide-react";
import { useAdminHeaders } from "@/hooks/use-admin-headers";
import { getErrorMessage } from "@/lib/errors";
import { CopilotHistoryView } from "./CopilotHistoryView";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

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
  /** Present when outcome === "awaiting_double_confirm" — server-side clock. */
  cooldown_starts_at?: string;
  cooldown_ends_at?: string;
  cooldown_seconds?: number;
}

type TurnKind = "ask" | "draft";

interface ConversationTurn {
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

interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ConversationTurn[];
}

// ──────────────────────────────────────────────────────────────────────
// Persistence (localStorage)
// ──────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "subnation:copilot:conversations:v1";
const STORAGE_CURRENT_KEY = "subnation:copilot:current:v1";
const MAX_CONVERSATIONS = 8;
const MEMORY_TURNS_SENT = 6; // last N turns sent with each request

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Conversation[];
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

function saveConversations(list: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_CONVERSATIONS)));
  } catch {
    // Storage quota or disabled — silently ignore.
  }
}

function loadCurrentId(): string | null {
  try {
    return localStorage.getItem(STORAGE_CURRENT_KEY);
  } catch {
    return null;
  }
}

function saveCurrentId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_CURRENT_KEY, id);
    else localStorage.removeItem(STORAGE_CURRENT_KEY);
  } catch {
    // ignore
  }
}

function newConversation(): Conversation {
  const now = Date.now();
  return {
    id: `c-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "محادثة جديدة",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}

function autoTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= 40) return t;
  return t.slice(0, 38) + "…";
}

// ──────────────────────────────────────────────────────────────────────
// Change-intent heuristic (multilingual)
// ──────────────────────────────────────────────────────────────────────

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
  "rename",
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
  "ماذا تغيّر في لوحة الإدارة آخر 24 ساعة؟",
];
const SUPER_SUGGESTIONS = [
  "غيّر سعر نتفلكس إلى 19.99",
  "زد مخزون سبوتيفاي بـ 10",
  "أرشف المنتج رقم 7",
];

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

export function CopilotPanel() {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showActionHistory, setShowActionHistory] = useState(false);
  const [flags, setFlags] = useState<PhaseFlags | null>(null);
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [currentId, setCurrentId] = useState<string | null>(() => loadCurrentId());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const turnsEndRef = useRef<HTMLDivElement>(null);
  const headers = useAdminHeaders({ json: true });

  // Resolve current conversation; create one on first use.
  const current = useMemo<Conversation>(() => {
    const found = conversations.find((c) => c.id === currentId);
    if (found) return found;
    if (conversations.length > 0) {
      setCurrentId(conversations[0]!.id);
      return conversations[0]!;
    }
    const fresh = newConversation();
    return fresh;
  }, [conversations, currentId]);

  const turns = current.turns;

  function patchTurn(id: string, patch: Partial<ConversationTurn>) {
    setConversations((prev) => {
      const list = prev.map((c) => {
        if (c.id !== current.id) return c;
        return {
          ...c,
          updatedAt: Date.now(),
          turns: c.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        };
      });
      saveConversations(list);
      return list;
    });
  }

  function appendTurn(turn: ConversationTurn) {
    setConversations((prev) => {
      // If the current conversation isn't in prev (first turn ever), add it.
      const exists = prev.some((c) => c.id === current.id);
      const list = exists
        ? prev.map((c) =>
            c.id === current.id
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  title: c.turns.length === 0 ? autoTitle(turn.question) : c.title,
                  turns: [...c.turns, turn],
                }
              : c,
          )
        : [
            {
              ...current,
              title: autoTitle(turn.question),
              updatedAt: Date.now(),
              turns: [turn],
            },
            ...prev,
          ];
      saveConversations(list);
      saveCurrentId(current.id);
      return list;
    });
  }

  function deleteConversation(id: string) {
    setConversations((prev) => {
      const list = prev.filter((c) => c.id !== id);
      saveConversations(list);
      if (currentId === id) {
        const next = list[0]?.id ?? null;
        setCurrentId(next);
        saveCurrentId(next);
      }
      return list;
    });
  }

  function startNewConversation() {
    const fresh = newConversation();
    setConversations((prev) => {
      const list = [fresh, ...prev].slice(0, MAX_CONVERSATIONS);
      saveConversations(list);
      return list;
    });
    setCurrentId(fresh.id);
    saveCurrentId(fresh.id);
    setShowHistory(false);
    inputRef.current?.focus();
  }

  // Probe phase flags once.
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

  // Keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        if (showHistory) setShowHistory(false);
        else if (fullscreen) setFullscreen(false);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, fullscreen, showHistory]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, current.id]);

  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, turns]);

  // Build the history payload for the backend (last N turns, role/content only).
  function buildHistory(): Array<{ role: "user" | "assistant"; content: string }> {
    const recent = turns.slice(-MEMORY_TURNS_SENT);
    const out: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const t of recent) {
      out.push({ role: "user", content: t.question });
      const assistantContent =
        t.kind === "draft" && t.preview
          ? `(proposed change preview, awaiting confirmation): ${t.preview.intent_summary}`
          : (t.answer ?? "");
      if (assistantContent) {
        out.push({ role: "assistant", content: assistantContent });
      }
    }
    return out;
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
      ts: Date.now(),
    };
    appendTurn(turn);
    setInput("");

    const history = buildHistory();
    try {
      if (wantsChange) {
        const resp = await fetch("/api/admin/copilot/draft", {
          method: "POST",
          headers,
          body: JSON.stringify({
            intent_text: text,
            history,
            context: { route: window.location.pathname },
          }),
        });
        if (!resp.ok) {
          const body = (await resp.json().catch(() => null)) as {
            error?: string;
            code?: string;
            message?: string;
          } | null;
          if (resp.status === 503 || body?.code === "COPILOT_PHASE_DISABLED") {
            await runAsk(turn.id, text, history);
            return;
          }
          // Round-4 (org §6a): getErrorMessage maps the backend `code`
          // to Arabic; raw error/message remain the fallbacks.
          throw new Error(
            getErrorMessage(body) || body?.message || `request failed (${resp.status})`,
          );
        }
        const data = (await resp.json()) as DraftResponse;
        if (!data.preview_id || !data.preview) {
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
        await runAsk(turn.id, text, history);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      patchTurn(turn.id, { error: msg, loading: false });
    }
  }

  async function runAsk(
    turnId: string,
    text: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ) {
    const resp = await fetch("/api/admin/copilot/ask", {
      method: "POST",
      headers,
      body: JSON.stringify({
        intent_text: text,
        history,
        stream: true,
        context: { route: window.location.pathname },
      }),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => null)) as { error?: string } | null;
      throw new Error(getErrorMessage(body) || `request failed (${resp.status})`);
    }
    // If the server didn't actually start an SSE stream (e.g. proxy
    // stripped it), fall back to JSON parse.
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("event-stream") || !resp.body) {
      const data = (await resp.json()) as AskResponse;
      patchTurn(turnId, {
        kind: "ask",
        answer: data.text,
        toolUses: data.tool_uses,
        directExecutions: data.direct_executions ?? [],
        previewState: undefined,
        loading: false,
      });
      return;
    }

    // SSE stream — parse events as they arrive.
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload: AskResponse | null = null;

    function progressFor(name: string, ok?: boolean, summary?: string): string {
      const labels: Record<string, string> = {
        resolve_product: "🔍 يبحث عن المنتج",
        search_products: "🔍 يبحث في الكتالوج",
        get_product: "📋 يقرأ تفاصيل المنتج",
        list_low_stock: "📦 يفحص المخزون",
        summarize_recent_changes: "📜 يقرأ سجل النشاط",
        update_product: "✏️ يحدّث المنتج",
        update_stock: "📦 يحدّث المخزون",
        admin_request: "⚙️ يستدعي اللوحة",
      };
      const label = labels[name] ?? `🔧 ${name}`;
      if (ok === undefined) return `${label}…`;
      const tail = summary ? ` (${summary})` : "";
      return `${ok ? "✓" : "✗"} ${label}${tail}`;
    }

    function handleEvent(event: string, data: unknown) {
      if (event === "progress") {
        const e = data as
          | { type: "round_start"; round: number }
          | { type: "tool_call_start"; name: string }
          | { type: "tool_call_done"; name: string; ok: boolean; summary: string }
          | { type: "round_done"; hadToolCalls: boolean };
        if (e.type === "tool_call_start") {
          appendProgress(turnId, progressFor(e.name));
        } else if (e.type === "tool_call_done") {
          replaceLastProgress(turnId, progressFor(e.name, e.ok, e.summary));
        }
      } else if (event === "final") {
        finalPayload = data as AskResponse;
      } else if (event === "error") {
        const e = data as { error?: string };
        throw new Error(e.error ?? "stream error");
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (!frame.trim()) continue;
        let event = "message";
        let dataLine = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
        }
        if (!dataLine) continue;
        try {
          const data = JSON.parse(dataLine) as unknown;
          handleEvent(event, data);
        } catch {
          // ignore malformed frame
        }
      }
    }

    if (finalPayload) {
      const fp = finalPayload as AskResponse;
      patchTurn(turnId, {
        kind: "ask",
        answer: fp.text,
        toolUses: fp.tool_uses,
        directExecutions: fp.direct_executions ?? [],
        previewState: undefined,
        loading: false,
        progress: [],
      });
    } else {
      patchTurn(turnId, { loading: false });
    }
  }

  function appendProgress(turnId: string, line: string) {
    setConversations((prev) => {
      const list = prev.map((c) => {
        if (c.id !== current.id) return c;
        return {
          ...c,
          turns: c.turns.map((t) =>
            t.id === turnId ? { ...t, progress: [...(t.progress ?? []), line] } : t,
          ),
        };
      });
      return list;
    });
  }

  function replaceLastProgress(turnId: string, line: string) {
    setConversations((prev) => {
      const list = prev.map((c) => {
        if (c.id !== current.id) return c;
        return {
          ...c,
          turns: c.turns.map((t) => {
            if (t.id !== turnId) return t;
            const arr = [...(t.progress ?? [])];
            if (arr.length > 0) arr[arr.length - 1] = line;
            else arr.push(line);
            return { ...t, progress: arr };
          }),
        };
      });
      return list;
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
        throw new Error(getErrorMessage(body) || `confirm failed (${resp.status})`);
      }
      const data = (await resp.json()) as ConfirmResponse;
      if (data.outcome === "awaiting_double_confirm") {
        // High-risk: enter cooldown, schedule the second confirm.
        const endsAt = data.cooldown_ends_at
          ? new Date(data.cooldown_ends_at).getTime()
          : Date.now() + 3000;
        patchTurn(turn.id, {
          previewState: "awaiting_double_confirm",
          cooldownEndsAt: endsAt,
        });
        return;
      }
      patchTurn(turn.id, {
        previewState: "executed",
        resultUrl: data.result_url ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      patchTurn(turn.id, { previewState: "pending", error: msg });
    }
  }

  async function doubleConfirm(turn: ConversationTurn) {
    if (!turn.preview) return;
    patchTurn(turn.id, { previewState: "double_confirming", error: null });
    try {
      const resp = await fetch(`/api/admin/copilot/previews/${turn.preview.id}/double-confirm`, {
        method: "POST",
        headers,
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => null)) as {
          error?: string;
          code?: string;
          remaining_ms?: number;
        } | null;
        // 425 = cooldown not elapsed; route already enforced server-side
        // but the client clock can drift. Surface it cleanly.
        const msg = getErrorMessage(body) || `double-confirm failed (${resp.status})`;
        throw new Error(msg);
      }
      const data = (await resp.json()) as ConfirmResponse;
      patchTurn(turn.id, {
        previewState: "executed",
        resultUrl: data.result_url ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      patchTurn(turn.id, { previewState: "awaiting_double_confirm", error: msg });
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

  async function retry(turn: ConversationTurn) {
    setInput(turn.question);
    inputRef.current?.focus();
  }

  if (flags === null) return null;
  if (!flags.phase1_enabled) return null;

  // Auto-grow input.
  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }

  const phaseBadge = flags.phase3_enabled
    ? { label: "نشط", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" }
    : flags.phase2_enabled
      ? { label: "مع موافقة", color: "bg-amber-500/20 text-amber-400 border-amber-500/40" }
      : { label: "قراءة", color: "bg-blue-500/20 text-blue-400 border-blue-500/40" };

  const panelWidth = fullscreen ? "w-full" : "w-[min(36rem,98vw)]";
  const panelHeight = fullscreen ? "h-full" : "h-full";

  return (
    <>
      {/* Floating trigger */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 left-6 z-30 group"
          title="المساعد الذكي (Ctrl/Cmd+J)"
          aria-label="فتح المساعد الذكي"
        >
          <span className="absolute inset-0 rounded-full bg-primary/40 blur-xl group-hover:bg-primary/60 transition-colors" />
          <span className="relative w-14 h-14 rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-2xl group-hover:scale-110 active:scale-95 transition-transform flex items-center justify-center ring-2 ring-primary/30">
            <Bot className="w-6 h-6" />
          </span>
        </button>
      )}

      {/* Slide-out panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setOpen(false)}
          />
          <aside
            className={`fixed top-0 bottom-0 left-0 ${panelWidth} ${panelHeight} bg-card border-l border-border z-50 shadow-2xl animate-in slide-in-from-left-8 duration-200 flex`}
          >
            {/* History sidebar (collapsible) */}
            {showHistory && (
              <div className="w-60 border-l border-border bg-background/50 flex flex-col">
                <div className="px-3 py-3 border-b border-border flex items-center gap-2">
                  <button
                    onClick={startNewConversation}
                    className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> محادثة جديدة
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                  {conversations.length === 0 && (
                    <div className="text-[11px] text-muted-foreground text-center py-4">
                      لا توجد محادثات بعد
                    </div>
                  )}
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      className={`group rounded-lg px-2 py-2 text-xs cursor-pointer flex items-start gap-2 transition-colors ${
                        c.id === currentId
                          ? "bg-primary/15 border border-primary/30"
                          : "hover:bg-muted/50 border border-transparent"
                      }`}
                      onClick={() => {
                        setCurrentId(c.id);
                        saveCurrentId(c.id);
                        setShowHistory(false);
                      }}
                    >
                      <MessageSquare className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate leading-tight">{c.title}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {c.turns.length} رسالة
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(c.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-all"
                        aria-label="حذف"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Main column */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-gradient-to-l from-primary/5 to-transparent">
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                  title="المحادثات"
                  aria-label="المحادثات"
                >
                  <Menu className="w-4 h-4" />
                </button>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm flex items-center gap-2">
                    المساعد الذكي
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full border ${phaseBadge.color}`}
                    >
                      {phaseBadge.label}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">{current.title}</div>
                </div>
                <button
                  onClick={startNewConversation}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                  title="محادثة جديدة"
                  aria-label="محادثة جديدة"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowActionHistory((v) => !v)}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                  title="سجل الإجراءات"
                  aria-label="سجل الإجراءات"
                >
                  <History className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setFullscreen((v) => !v)}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hidden sm:inline-flex"
                  title={fullscreen ? "تصغير" : "ملء الشاشة"}
                  aria-label={fullscreen ? "تصغير" : "ملء الشاشة"}
                >
                  {fullscreen ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
                  aria-label="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Conversation */}
              {!showActionHistory && (
                <>
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
                    {turns.length === 0 && (
                      <EmptyState
                        flags={flags}
                        onPick={(s) => {
                          setInput(s);
                          inputRef.current?.focus();
                        }}
                      />
                    )}

                    {turns.map((turn) => (
                      <TurnView
                        key={turn.id}
                        turn={turn}
                        onApprove={() => void approve(turn)}
                        onCancel={() => void cancelPreview(turn)}
                        onDoubleConfirm={() => void doubleConfirm(turn)}
                        onRetry={() => void retry(turn)}
                      />
                    ))}
                    <div ref={turnsEndRef} />
                  </div>

                  {/* Input */}
                  <div className="border-t border-border bg-card/95 px-3 py-3">
                    <div className="flex items-end gap-2 bg-background border border-border rounded-2xl px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={onInputChange}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void submit();
                          }
                        }}
                        rows={1}
                        placeholder={
                          flags.phase2_enabled ? "اكتب سؤالاً أو أمراً للتعديل..." : "اكتب سؤالك..."
                        }
                        className="flex-1 resize-none bg-transparent border-0 text-sm focus:outline-none min-h-[20px] max-h-[240px] py-1"
                      />
                      <button
                        onClick={() => void submit()}
                        disabled={!input.trim()}
                        className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center shrink-0 shadow-md shadow-primary/20 transition-all active:scale-95"
                        aria-label="إرسال"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground px-1">
                      <span>يتذكر آخر {MEMORY_TURNS_SENT} رسائل في هذه المحادثة</span>
                      <span className="flex items-center gap-2">
                        <kbd className="font-mono bg-muted border border-border/50 px-1 py-0.5 rounded">
                          Enter
                        </kbd>
                        للإرسال
                      </span>
                    </div>
                  </div>
                </>
              )}
              {showActionHistory && (
                <CopilotHistoryView onClose={() => setShowActionHistory(false)} />
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function EmptyState({ flags, onPick }: { flags: PhaseFlags; onPick: (s: string) => void }) {
  return (
    <div className="space-y-4 py-2">
      <div className="text-center space-y-2">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-primary" />
        </div>
        <div className="font-bold text-sm">كيف يمكنني مساعدتك؟</div>
        <div className="text-xs text-muted-foreground leading-6 max-w-xs mx-auto">
          اطرح سؤالاً أو اكتب أمراً للتعديل بأي لغة (عربي، إنجليزي، أو خليط).
          {flags.phase3_enabled && " التعديلات منخفضة الخطورة تُنفّذ مباشرة."}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-[11px] text-muted-foreground font-bold pr-1">أمثلة سريعة</div>
        {ASK_SUGGESTIONS.map((s) => (
          <SuggestionRow key={s} text={s} onPick={onPick} />
        ))}
        {flags.phase3_enabled && (
          <>
            {SUPER_SUGGESTIONS.map((s) => (
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
      className="w-full text-right text-xs px-3 py-2.5 rounded-xl bg-muted/30 hover:bg-muted/60 border border-border/30 hover:border-primary/30 transition-all flex items-center gap-2 group"
    >
      <Icon className="w-3 h-3 text-primary shrink-0" />
      <span className="flex-1 group-hover:text-primary transition-colors">{text}</span>
    </button>
  );
}

function TurnView({
  turn,
  onApprove,
  onCancel,
  onDoubleConfirm,
  onRetry,
}: {
  turn: ConversationTurn;
  onApprove: () => void;
  onCancel: () => void;
  onDoubleConfirm: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      {/* User question */}
      <div className="flex justify-end">
        <div className="max-w-[88%] bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 text-foreground rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm whitespace-pre-wrap shadow-sm">
          {turn.question}
        </div>
      </div>

      {turn.loading && (
        <div className="space-y-1 pr-1">
          {(turn.progress ?? []).map((line, i) => (
            <div key={i} className="text-[11px] text-muted-foreground font-mono leading-5">
              {line}
            </div>
          ))}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            {(turn.progress ?? []).length === 0 ? "جاري التفكير…" : "جاري المعالجة…"}
          </div>
        </div>
      )}

      {turn.error && (
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{turn.error}</span>
          <button
            onClick={onRetry}
            className="text-[11px] hover:underline shrink-0 flex items-center gap-1"
            title="إعادة المحاولة"
          >
            <RefreshCw className="w-3 h-3" /> إعادة
          </button>
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
          cooldownEndsAt={turn.cooldownEndsAt ?? null}
          resultUrl={turn.resultUrl ?? null}
          onApprove={onApprove}
          onCancel={onCancel}
          onDoubleConfirm={onDoubleConfirm}
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
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(answer).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // ignore
      },
    );
  }
  return (
    <div className="space-y-2">
      {directExecutions.length > 0 && (
        <div className="space-y-1.5">
          {directExecutions.map((d, i) => (
            <DirectExecutionBadge key={i} item={d} />
          ))}
        </div>
      )}
      <div className="group relative bg-muted/40 border border-border/50 rounded-2xl rounded-tr-md px-3.5 py-2.5 text-sm shadow-sm">
        <MarkdownLite text={answer} />
        <button
          onClick={handleCopy}
          className="absolute top-1.5 left-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1 rounded-md hover:bg-secondary text-muted-foreground transition-all"
          title="نسخ"
          aria-label="نسخ"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      {toolUses.length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            مصدر البيانات ({toolUses.length})
          </summary>
          <div className="mt-1.5 space-y-1 pr-3 border-r-2 border-primary/20">
            {toolUses.map((tu, i) => (
              <div key={i} className="font-mono leading-5 text-[10px]">
                <span className="text-primary">{tu.name}</span>(
                <span className="text-muted-foreground">{Object.keys(tu.input).length} args</span>)
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
  type AdminReqData = {
    method?: string;
    path?: string;
    status?: number;
    body?: unknown;
    truncated?: boolean;
  };
  const isReq = item.tool === "admin_request";
  const data = (item.data ?? {}) as ProductData & AdminReqData;
  const fields = Array.isArray(data.diff) ? data.diff.map((d) => d.field).join(", ") : null;
  const stockChange =
    typeof data.before_stock === "number" && typeof data.after_stock === "number"
      ? `${data.before_stock} → ${data.after_stock}`
      : null;
  return (
    <div
      className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 border shadow-sm ${
        ok
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          : "bg-destructive/10 border-destructive/30 text-destructive"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-bold">{ok ? "تم التنفيذ" : "فشل التنفيذ"}</div>
        {ok && isReq && (
          <div className="text-[11px] text-muted-foreground mt-0.5 font-mono break-all">
            {data.method} {data.path} · {data.status}
          </div>
        )}
        {ok && !isReq && data.productName && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            <span className="font-mono">{item.tool}</span> · {data.productName} (#{data.productId})
            {fields && ` · ${fields}`}
            {stockChange && ` · مخزون: ${stockChange}`}
          </div>
        )}
        {!ok && <div className="text-[11px] mt-0.5 break-words">{item.summary}</div>}
      </div>
    </div>
  );
}

function PreviewCard({
  preview,
  state,
  cooldownEndsAt,
  resultUrl,
  onApprove,
  onCancel,
  onDoubleConfirm,
}: {
  preview: PreviewView;
  state: NonNullable<ConversationTurn["previewState"]>;
  cooldownEndsAt: number | null;
  resultUrl: string | null;
  onApprove: () => void;
  onCancel: () => void;
  onDoubleConfirm: () => void;
}) {
  const isHighRisk = preview.risk_tier === "high";
  const isNoExec = preview.risk_tier === "no_execute";
  const changes = preview.payload.changes ?? [];

  // Cooldown countdown for the high-risk path.
  const [remainingMs, setRemainingMs] = useState(() =>
    cooldownEndsAt ? Math.max(0, cooldownEndsAt - Date.now()) : 0,
  );
  useEffect(() => {
    if (state !== "awaiting_double_confirm" || !cooldownEndsAt) return;
    const tick = () => setRemainingMs(Math.max(0, cooldownEndsAt - Date.now()));
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [state, cooldownEndsAt]);
  const cooldownDone = remainingMs <= 0;

  return (
    <div className="border border-border rounded-2xl rounded-tr-md bg-muted/20 shadow-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2 text-[11px] bg-muted/30">
        <span className={`font-bold ${isHighRisk ? "text-amber-400" : "text-primary"}`}>
          معاينة — {preview.action_class}
        </span>
        <span className="text-muted-foreground">
          • {isHighRisk ? "عالية الخطورة" : isNoExec ? "إحالة لأداة المحفظة" : "منخفضة الخطورة"}
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
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

      <div className="px-3 py-2 border-t border-border/60 flex items-center gap-2 bg-muted/10">
        {state === "pending" && (
          <>
            <button
              onClick={onApprove}
              disabled={isNoExec}
              className="flex-1 px-3 py-2 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground text-xs font-bold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-all"
            >
              {isHighRisk ? "موافقة (تأكيد أول)" : "موافقة وتنفيذ"}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-2 rounded-xl bg-muted hover:bg-muted/70 text-xs transition-colors"
            >
              إلغاء
            </button>
          </>
        )}
        {state === "confirming" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> جاري التحقق…
          </div>
        )}
        {state === "awaiting_double_confirm" && (
          <>
            <button
              onClick={onDoubleConfirm}
              disabled={!cooldownDone}
              className="flex-1 px-3 py-2 rounded-xl bg-amber-500/90 text-amber-50 text-xs font-bold hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
            >
              {cooldownDone
                ? "تأكيد ثانٍ — تنفيذ الآن"
                : `الانتظار ${Math.ceil(remainingMs / 1000)}…`}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-2 rounded-xl bg-muted hover:bg-muted/70 text-xs transition-colors"
            >
              تراجع
            </button>
          </>
        )}
        {state === "double_confirming" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> جاري التنفيذ…
          </div>
        )}
        {state === "executed" && (
          <div className="flex items-center gap-2 text-xs text-emerald-400 w-full">
            <CheckCircle2 className="w-3.5 h-3.5" /> تم التنفيذ بنجاح
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
          <div className="text-xs text-muted-foreground">انتهت صلاحية لمعاينة (5 دقائق)</div>
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
    <div className="border border-border/40 rounded-lg bg-background/50 overflow-hidden">
      <div className="px-2 py-1 text-[11px] font-bold text-muted-foreground border-b border-border/40 bg-muted/20">
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

// ──────────────────────────────────────────────────────────────────────
// Markdown-lite — bold, code, lists, line breaks. No deps.
// ──────────────────────────────────────────────────────────────────────

function MarkdownLite({ text }: { text: string }) {
  // Split into blocks separated by blank lines.
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        // Code fence
        if (lines[0]?.startsWith("```") && lines[lines.length - 1]?.startsWith("```")) {
          const code = lines.slice(1, -1).join("\n");
          return (
            <pre
              key={i}
              dir="ltr"
              className="text-[11px] font-mono bg-background/60 border border-border rounded-lg p-2 overflow-x-auto whitespace-pre"
            >
              {code}
            </pre>
          );
        }
        // List
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l) || l.trim() === "")) {
          return (
            <ul key={i} className="list-disc pr-4 space-y-0.5">
              {lines
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>
                    <InlineMd text={l.replace(/^\s*[-*•]\s+/, "")} />
                  </li>
                ))}
            </ul>
          );
        }
        // Numbered list
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l) || l.trim() === "")) {
          return (
            <ol key={i} className="list-decimal pr-4 space-y-0.5">
              {lines
                .filter((l) => l.trim())
                .map((l, j) => (
                  <li key={j}>
                    <InlineMd text={l.replace(/^\s*\d+\.\s+/, "")} />
                  </li>
                ))}
            </ol>
          );
        }
        // Paragraph with line breaks preserved
        return (
          <p key={i} className="whitespace-pre-wrap">
            <InlineMd text={block} />
          </p>
        );
      })}
    </div>
  );
}

function InlineMd({ text }: { text: string }) {
  // Replace **bold**, *italic*, `code`. Order matters: code first so its
  // contents are not re-processed.
  const tokens: Array<{ type: "text" | "bold" | "italic" | "code"; value: string }> = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: "text", value: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) tokens.push({ type: "bold", value: tok.slice(2, -2) });
    else if (tok.startsWith("`")) tokens.push({ type: "code", value: tok.slice(1, -1) });
    else tokens.push({ type: "italic", value: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === "bold") return <strong key={i}>{t.value}</strong>;
        if (t.type === "italic") return <em key={i}>{t.value}</em>;
        if (t.type === "code")
          return (
            <code
              key={i}
              dir="ltr"
              className="px-1 py-0.5 rounded bg-background/70 border border-border/40 text-[11px] font-mono"
            >
              {t.value}
            </code>
          );
        return <span key={i}>{t.value}</span>;
      })}
    </>
  );
}
