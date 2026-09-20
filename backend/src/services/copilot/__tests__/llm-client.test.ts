/**
 * F7 (R98-A6, 98-F5) — copilot total request budget.
 *
 * MAX_TOOL_ROUNDS (4) × 60 s LLM calls + 20 s loopback tools used to be
 * unbounded (~4–5 min worst case) while Render's proxy cuts the connection
 * around ~100 s — the handler and LLM tokens kept burning on a 0.5-CPU free
 * instance. copilotChat now owns a shared 90 s deadline AbortController that
 * (a) composes with each fetch's own 60 s AbortController inside
 * postChatCompletion (aborts the in-flight request) and (b) is checked at
 * every round boundary (a deadline hit mid-tool must not queue another
 * doomed round).
 *
 * Fake timers drive the 90 s budget and the simulated slow tools; the
 * provider config is mocked so no real provider/env is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../provider-config", () => ({
  getCopilotProvider: () => ({
    providerId: "custom" as const,
    baseUrl: "http://llm.test/v1",
    apiKey: "test-key",
    model: "test-model",
    extraHeaders: {},
  }),
  hasCopilotProvider: () => true,
}));

import { copilotChat, type CopilotEvent, type Tool } from "../llm-client";

const ORIGINAL_FETCH = globalThis.fetch;

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "lookup",
      description: "test tool",
      parameters: { type: "object", properties: {} },
    },
  },
];

function completion(body: { text?: string; toolCalls?: number; idPrefix?: string }): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: body.toolCalls ? "tool_calls" : "stop",
          message: body.toolCalls
            ? {
                role: "assistant",
                content: null,
                tool_calls: Array.from({ length: body.toolCalls }, (_, i) => ({
                  id: `${body.idPrefix ?? "call"}_${i}`,
                  type: "function",
                  function: { name: "lookup", arguments: "{}" },
                })),
              }
            : { role: "assistant", content: body.text ?? "final answer", tool_calls: [] },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("copilotChat — F7 shared 90 s request budget", () => {
  it("completes a normal 2-round tool flow well inside the budget (regression)", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? completion({ toolCalls: 1 }) : completion({ text: "done" });
    }) as unknown as typeof fetch;

    const result = await copilotChat({
      systemText: "sys",
      intentText: "hello",
      tools: TOOLS,
      toolHandler: async () => ({ ok: true }),
    });

    expect(result.text).toBe("done");
    expect(result.toolUses).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("budget hit DURING a tool call stops the next round at the boundary (no doomed LLM round)", async () => {
    let llmCalls = 0;
    globalThis.fetch = vi.fn(async () => {
      llmCalls += 1;
      // Round 0 asks for a tool; rounds after it are never reached.
      return llmCalls === 1 ? completion({ toolCalls: 1 }) : completion({ text: "never" });
    }) as unknown as typeof fetch;

    vi.useFakeTimers();
    const events: CopilotEvent[] = [];
    const chat = copilotChat({
      systemText: "sys",
      intentText: "hello",
      tools: TOOLS,
      // 100 s tool — crosses the 90 s budget while running.
      toolHandler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 100_000));
        return { ok: true };
      },
      onEvent: (e) => events.push(e),
    });
    // Attach the handler BEFORE advancing time — the rejection fires during
    // the advance, and a late attach would race Node's unhandled-rejection
    // check (PromiseRejectionHandledWarning).
    const rejection = expect(chat).rejects.toThrow(/budget/);

    await vi.advanceTimersByTimeAsync(100_000);
    await rejection;

    // Round 0 ran (LLM + tool); round 1 never started — the boundary check
    // threw BEFORE its round_start event.
    expect(llmCalls).toBe(1);
    expect(events.filter((e) => e.type === "round_start")).toHaveLength(1);
  });

  it("budget hit while an LLM request is in flight aborts that fetch (composed signals)", async () => {
    // Rounds 0–1 resolve instantly and ask for a (slow) tool; round 2 hangs —
    // only an abort of the REQUEST signal can end it.
    let stage = 0;
    globalThis.fetch = vi.fn((async (_input: string | URL, init?: RequestInit) => {
      stage += 1;
      if (stage <= 2) return completion({ toolCalls: 1, idPrefix: `c${stage}` });
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init?.signal?.reason ?? new Error("aborted")),
        );
      });
    }) as unknown as typeof fetch);

    vi.useFakeTimers();
    const chat = copilotChat({
      systemText: "sys",
      intentText: "hello",
      tools: TOOLS,
      // 35 s per tool — two rounds consume 70 s, so round 2's fetch starts
      // at t=70 s and the 90 s budget aborts it mid-flight (its own 60 s
      // per-request timeout would only fire at t=130 s).
      toolHandler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 35_000));
        return { ok: true };
      },
    });
    // Attach the handler BEFORE advancing time (see note above).
    const rejection = expect(chat).rejects.toThrow(/budget/);

    await vi.advanceTimersByTimeAsync(70_000); // rounds 0–1 complete
    await vi.advanceTimersByTimeAsync(20_000); // t=90 s — budget fires
    await rejection;
    expect(stage).toBe(3); // exactly 3 LLM requests, no 4th round
  });
});
