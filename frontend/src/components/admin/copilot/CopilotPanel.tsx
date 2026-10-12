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
 *
 * R137 (2-a decomposition): this file is now the ORCHESTRATION CORE (was
 * 1,794 lines — the biggest component in the repo). The verbatim extracts
 * live beside it under components/admin/copilot/: CopilotTrigger,
 * ConversationSidebar, CopilotHeader, CopilotComposer, EmptyState,
 * SuggestionRow, TurnView, AskAnswer, DirectExecutionBadge, PreviewCard,
 * ChangeDiff, MarkdownLite, ProgressTraceLine + the React-free modules
 * copilot-types / copilot-persistence / copilot-intent / copilot-markdown.
 * ALL chat truth stays HERE (the r136/r137 idiom): every cross-section
 * state atom, the flags probe, the keyboard/focus effects, the 15s
 * preview-expiry sweep, the whole send loop (draft → ask SSE stream →
 * progress/final events) and the approve / double-confirm / cancel
 * mutations — the extracts take values + callbacks only. The module's
 * PUBLIC surface is unchanged: CopilotPanel plus the three test-pinned
 * symbols (AskAnswer, ProgressTraceLine, the two persistence guards)
 * ride verbatim re-exports from their new addresses.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminHeaders } from "@/hooks/use-admin-headers";
// R123 (E3 item 1): the copilot's six raw fetches ride the session-aware
// adminFetch wrapper. NOTE the SSE site (ask): adminFetch returns the
// Response UNTOUCHED on every non-401 path, so the streaming reader +
// content-type JSON fallback below keep working byte-for-byte; a 401
// mid-conversation throws AdminSessionExpiredError after the global
// «انتهت الجلسة» toast + redirect (the caller's catch closes the turn
// quietly — no fake "request failed" bubble on a page being left).
import { AdminSessionExpiredError, adminFetch } from "@/lib/admin-session";
import { getErrorMessage } from "@/lib/errors";
// R134 (A3-F2): the shared Tab-trap (the NotificationBell idiom).
import { trapTabKey } from "@/lib/a11y/trap-tab-key";
import { CopilotHistoryView } from "./CopilotHistoryView";
// R137 (2-a decomposition): the copilot's verbatim extracts under
// components/admin/copilot/ — the trigger launcher, the conversations
// sidebar, the panel header, the composer shell and the turn/preview
// renderers. This file stays the orchestration core: every state atom,
// the send/stream machinery and the confirm/cancel mutations live below;
// the extracts take values + callbacks only.
import { ConversationSidebar } from "@/components/admin/copilot/ConversationSidebar";
import { CopilotComposer } from "@/components/admin/copilot/CopilotComposer";
import { CopilotHeader } from "@/components/admin/copilot/CopilotHeader";
import { CopilotTrigger } from "@/components/admin/copilot/CopilotTrigger";
import { EmptyState } from "@/components/admin/copilot/EmptyState";
import { TurnView } from "@/components/admin/copilot/TurnView";
// The React-free halves: the DTO/conversation model, the localStorage
// persistence layer (with the 94-C2 loading-flag round-trip guards) and
// the multilingual change-intent heuristic the send loop consults.
import type {
  AskResponse,
  ConfirmResponse,
  Conversation,
  ConversationTurn,
  DraftResponse,
  PhaseFlags,
} from "@/components/admin/copilot/copilot-types";
import {
  autoTitle,
  loadConversations,
  loadCurrentId,
  MAX_CONVERSATIONS,
  MEMORY_TURNS_SENT,
  newConversation,
  saveConversations,
  saveCurrentId,
} from "@/components/admin/copilot/copilot-persistence";
import { looksLikeChangeIntent } from "@/components/admin/copilot/copilot-intent";

// R137 (2-a decomposition): the module's public surface survives verbatim
// — AskAnswer + ProgressTraceLine moved to their own files (feature /
// presentational extracts) and the two 94-C2 persistence guards moved to
// copilot-persistence.ts; these re-exports keep every existing importer
// resolving unchanged (copilot-copy / copilot-trace-line-r129 /
// copilot-persistence suites + the layout's lazyWithRetry chunk mount).
export { AskAnswer } from "@/components/admin/copilot/AskAnswer";
export { ProgressTraceLine } from "@/components/admin/copilot/ProgressTraceLine";
export {
  sanitizeRestoredConversations,
  stripTransientLoading,
} from "@/components/admin/copilot/copilot-persistence";

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

  // 94-C2 (A2 P3-17): the «expired» preview state existed with no
  // trigger — a stale preview only errored when the operator CLICKED
  // it (the server rejects expired previews). A 15s sweep flips any
  // actionable preview whose server-side `expires_at` has passed, so
  // the card tells the truth before the click.
  useEffect(() => {
    const ACTIONABLE = new Set(["pending", "awaiting_double_confirm"]);
    const sweep = () => {
      setConversations((prev) => {
        let changed = false;
        const list = prev.map((c) => {
          const turns2 = c.turns.map((t) => {
            if (
              ACTIONABLE.has(t.previewState ?? "") &&
              t.preview?.expires_at &&
              Date.parse(t.preview.expires_at) <= Date.now()
            ) {
              changed = true;
              return { ...t, previewState: "expired" as const };
            }
            return t;
          });
          return changed && turns2 !== c.turns ? { ...c, turns: turns2 } : c;
        });
        if (changed) saveConversations(list);
        return changed ? list : prev;
      });
    };
    const timer = setInterval(sweep, 15_000);
    return () => clearInterval(timer);
  }, []);

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
    // R123 (E3 item 1): adminFetch adds the 401 conversion on top of the
    // tolerant null-on-any-failure semantics (the probe stays quiet —
    // the panel simply hides when flags are unknown).
    adminFetch("/api/admin/copilot/settings", { headers })
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
        // 94-C2 (A2 P3-17): ESC peels layers off in order — the action
        // history overlay first, then the conversations sidebar, then
        // fullscreen, then the panel itself (previously it closed the
        // whole panel while the history overlay stayed logically open).
        if (showActionHistory) setShowActionHistory(false);
        else if (showHistory) setShowHistory(false);
        else if (fullscreen) setFullscreen(false);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, fullscreen, showHistory, showActionHistory]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, current.id]);

  // R134 (A3-F2): the dialog contract's OTHER halves — the invoker (the
  // trigger button) is captured when the panel opens, and every close
  // path (X, Escape, outside-click, layer-peel) restores focus to it
  // instead of dropping the keyboard user onto <body> (the
  // NotificationBell R133 A4-F7 idiom).
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const invoker = document.activeElement as HTMLElement | null;
    return () => {
      invoker?.focus();
    };
  }, [open]);

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
    // 94-C2 (A2 P3-17): the auto-grow textarea used to KEEP its grown
    // height after sending — the composer stayed a tall block until the
    // next manual edit shrank it.
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    const history = buildHistory();
    try {
      if (wantsChange) {
        const resp = await adminFetch("/api/admin/copilot/draft", {
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
      // R123 (E3 item 1): session expiry already toasted + redirected —
      // close the turn quietly instead of a fake failure bubble.
      if (err instanceof AdminSessionExpiredError) {
        patchTurn(turn.id, { loading: false });
        return;
      }
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      patchTurn(turn.id, { error: msg, loading: false });
    }
  }

  async function runAsk(
    turnId: string,
    text: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ) {
    // R123 (E3 item 1): adminFetch returns the Response untouched on
    // every non-401 path — the SSE reader + the JSON-fallback branch
    // below are byte-for-byte unchanged. Only a session-expired 401
    // behaves differently (AdminSessionExpiredError into the caller's
    // catch, after the global toast + redirect).
    const resp = await adminFetch("/api/admin/copilot/ask", {
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
      // R123 (E3 P3e): the stream ended WITHOUT a `final` event (proxy
      // cut the connection, server crash mid-answer) — the old bare
      // loading:false patch left a turn that looked "answered" with no
      // answer and no error: a silent dead end. The operator now gets
      // an honest retryable error on the turn itself.
      patchTurn(turnId, {
        error: "لم يصل رد من المساعد — انقطع البث قبل اكتمال الإجابة، حاول مجدداً.",
        loading: false,
        progress: [],
      });
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
      const resp = await adminFetch(`/api/admin/copilot/previews/${turn.preview.id}/confirm`, {
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
      // Session expiry already toasted + redirected — park the preview
      // quietly (the redirect unmounts the panel anyway).
      if (err instanceof AdminSessionExpiredError) {
        patchTurn(turn.id, { previewState: "pending", loading: false });
        return;
      }
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      patchTurn(turn.id, { previewState: "pending", error: msg });
    }
  }

  async function doubleConfirm(turn: ConversationTurn) {
    if (!turn.preview) return;
    patchTurn(turn.id, { previewState: "double_confirming", error: null });
    try {
      const resp = await adminFetch(
        `/api/admin/copilot/previews/${turn.preview.id}/double-confirm`,
        {
          method: "POST",
          headers,
        },
      );
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
      if (err instanceof AdminSessionExpiredError) {
        patchTurn(turn.id, { previewState: "awaiting_double_confirm", loading: false });
        return;
      }
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      patchTurn(turn.id, { previewState: "awaiting_double_confirm", error: msg });
    }
  }

  async function cancelPreview(turn: ConversationTurn) {
    if (!turn.preview) return;
    try {
      await adminFetch(`/api/admin/copilot/previews/${turn.preview.id}/cancel`, {
        method: "POST",
        headers,
      });
    } catch {
      // Ignore — backend audit will still record if reachable (a 401
      // here rides the global handler; the cancel is fire-and-forget).
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

  const panelWidth = fullscreen ? "w-full" : "w-[min(36rem,98vw)]";
  const panelHeight = fullscreen ? "h-full" : "h-full";

  return (
    <>
      {/* Floating trigger */}
      {!open && <CopilotTrigger onOpen={() => setOpen(true)} />}

      {/* Slide-out panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setOpen(false)}
          />
          <aside
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            /* R134 (A3-F2): aria-modal completes the role="dialog"
               contract (outside-click + Esc already behave modally); the
               onKeyDown trap keeps Tab inside (the NotificationBell
               idiom) — the overlay was the console's LAST modal without
               dialog semantics, and it can execute catalog writes. */
            aria-modal="true"
            aria-label="المساعد الذكي"
            onKeyDown={(e) => {
              if (panelRef.current) trapTabKey(panelRef.current, e);
            }}
            className={`fixed top-0 bottom-0 left-0 ${panelWidth} ${panelHeight} bg-card border-l border-border z-50 shadow-2xl animate-in slide-in-from-left-8 duration-200 flex outline-none`}
          >
            {/* History sidebar (collapsible) */}
            {showHistory && (
              <ConversationSidebar
                conversations={conversations}
                currentId={currentId}
                onNewConversation={startNewConversation}
                onSelect={(id) => {
                  setCurrentId(id);
                  saveCurrentId(id);
                  setShowHistory(false);
                }}
                onDelete={deleteConversation}
              />
            )}

            {/* Main column */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header */}
              <CopilotHeader
                flags={flags}
                currentTitle={current.title}
                fullscreen={fullscreen}
                onToggleHistory={() => setShowHistory((v) => !v)}
                onNewConversation={startNewConversation}
                onToggleActionHistory={() => setShowActionHistory((v) => !v)}
                onToggleFullscreen={() => setFullscreen((v) => !v)}
                onClose={() => setOpen(false)}
              />

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
                  <CopilotComposer
                    value={input}
                    phase2Enabled={flags.phase2_enabled}
                    inputRef={inputRef}
                    onValueChange={onInputChange}
                    onSubmit={() => void submit()}
                  />
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
