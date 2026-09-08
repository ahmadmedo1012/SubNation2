/**
 * 94-C2 (A2 P2-4) — CopilotPanel localStorage persistence tests.
 *
 * A conversation saved MID-REQUEST used to persist `loading: true` to
 * localStorage (saveConversations ran on appendTurn, before the fetch
 * resolved). Reopening the panel hydrated that turn as-is — an eternal
 * «جارٍ التفكير…» spinner with no completion path: the retry button
 * only renders for errored turns, and nothing ever flips the flag.
 *
 * Two guards now bracket the persistence boundary (both pure and
 * exported from CopilotPanel for this regression test):
 *
 *   1. `stripTransientLoading` (save path): `loading:true` never
 *      REACHES localStorage — the stored copy just doesn't claim it.
 *   2. `sanitizeRestoredConversations` (restore path): a `loading:true`
 *      turn that somehow got stored (an older build, a future writer
 *      bug) is converted into an explicit error with a retry hint.
 */

import { describe, expect, it } from "vitest";
import {
  sanitizeRestoredConversations,
  stripTransientLoading,
} from "@/components/admin/copilot/CopilotPanel";

/** The module-private Conversation shape, derived from the function. */
type Conversation = Parameters<typeof stripTransientLoading>[0];

const turn = (over: Record<string, unknown> = {}) => ({
  id: "t-1",
  role: "user",
  text: "ما المخزون؟",
  status: "done",
  loading: false,
  error: null,
  ts: 1_700_000_000_000,
  ...over,
});

const conversation = (turns: Conversation["turns"]): Conversation[] => [
  {
    id: "c-1",
    title: "محادثة جديدة",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    turns,
  },
];

describe("CopilotPanel persistence — loading:true never survives a round-trip (A2 P2-4)", () => {
  it("stripTransientLoading (save path): the stored copy drops the flag WITHOUT inventing an error", () => {
    const stored = stripTransientLoading(conversation([turn({ loading: true })]));

    expect(stored[0].turns[0].loading).toBe(false);
    // The stored turn stays clean — the spinner is transient state,
    // not a persisted error. Restore decides what it means later.
    expect(stored[0].turns[0].error).toBeNull();
    // Finished turns pass through untouched.
    const untouched = stripTransientLoading(conversation([turn()]));
    expect(untouched).toEqual(conversation([turn()]));
  });

  it("sanitizeRestoredConversations (restore path): a stored loading turn becomes an explicit error with a retry hint", () => {
    const restored = sanitizeRestoredConversations(conversation([turn({ loading: true })]));

    expect(restored[0].turns[0].loading).toBe(false);
    expect(restored[0].turns[0].error).toBeTruthy();
    expect(String(restored[0].turns[0].error)).toContain("أعد المحاولة");
    // The retry path is reachable: an error renders the retry button,
    // while a bare loading:true rendered the eternal spinner.
  });

  it("a turn stored WITH its own error keeps it (no clobbering by the sanitizer)", () => {
    const restored = sanitizeRestoredConversations(
      conversation([turn({ loading: true, error: "أصلي" })]),
    );

    expect(restored[0].turns[0].error).toBe("أصلي");
    expect(restored[0].turns[0].loading).toBe(false);
  });

  it("the round-trip is a fixed point: strip → sanitize → strip leaves nothing to fix", () => {
    const input = conversation([turn({ loading: true })]);
    const once = stripTransientLoading(input);
    const twice = sanitizeRestoredConversations(once);

    // After one save+restore cycle no turn claims in-flight state and
    // no NEW error was invented (the stored copy was already clean).
    expect(twice[0].turns[0].loading).toBe(false);
    expect(twice[0].turns[0].error).toBeNull();
    expect(stripTransientLoading(twice)).toEqual(twice);
  });
});
