// R137 (2-a decomposition): extracted verbatim from CopilotPanel.tsx — the
// localStorage persistence layer (multi-conversation store, the 94-C2
// loading-flag round-trip guards, auto-titling) moved to its own
// React-free module so the panel file shrinks to orchestration. ZERO
// behavior change: the panel imports every helper by name — every key,
// cap and call site survives byte-identical (the persistence regression
// suite still imports both sanitize guards off the CopilotPanel module's
// re-export).

import type { Conversation } from "./copilot-types";

// ──────────────────────────────────────────────────────────────────────
// Persistence (localStorage)
// ──────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "subnation:copilot:conversations:v1";
const STORAGE_CURRENT_KEY = "subnation:copilot:current:v1";
export const MAX_CONVERSATIONS = 8;
export const MEMORY_TURNS_SENT = 6; // last N turns sent with each request

/** 94-C2 (A2 P2-4): restores a persisted conversation list, converting
 * any turn saved mid-request (`loading: true` — written before the fix,
 * or by an older build) into an explicit error with a retry hint.
 * Restoring it as-is rendered an eternal «جارٍ التفكير…» spinner with
 * no completion path (the retry button only renders for errors).
 * Exported for the restore regression test. */
export function sanitizeRestoredConversations(list: Conversation[]): Conversation[] {
  return list.map((c) => ({
    ...c,
    turns: c.turns.map((t) =>
      t.loading
        ? {
            ...t,
            loading: false,
            error: t.error ?? "انقطع الطلب بإغلاق اللوحة — حاول مجدداً",
          }
        : t,
    ),
  }));
}

/** 94-C2 (A2 P2-4): strips the transient `loading` flag before
 * persistence — the in-memory state keeps spinning while the request
 * runs, but the stored copy never claims it (a tab closed mid-request
 * previously hydrated into the eternal-spinner state above).
 * Exported for the persistence regression test (save path). */
export function stripTransientLoading(list: Conversation[]): Conversation[] {
  return list.map((c) => ({
    ...c,
    turns: c.turns.map((t) => (t.loading ? { ...t, loading: false } : t)),
  }));
}

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Conversation[];
    if (!Array.isArray(arr)) return [];
    return sanitizeRestoredConversations(arr);
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]) {
  try {
    // 94-C2 (A2 P2-4): `loading:true` never reaches localStorage — see
    // stripTransientLoading above.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(stripTransientLoading(list.slice(0, MAX_CONVERSATIONS))),
    );
  } catch {
    // Storage quota or disabled — silently ignore.
  }
}

export function loadCurrentId(): string | null {
  try {
    return localStorage.getItem(STORAGE_CURRENT_KEY);
  } catch {
    return null;
  }
}

export function saveCurrentId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_CURRENT_KEY, id);
    else localStorage.removeItem(STORAGE_CURRENT_KEY);
  } catch {
    // ignore
  }
}

export function newConversation(): Conversation {
  const now = Date.now();
  return {
    id: `c-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "محادثة جديدة",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}

export function autoTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= 40) return t;
  return t.slice(0, 38) + "…";
}
