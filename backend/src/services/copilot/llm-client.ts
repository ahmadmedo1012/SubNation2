/**
 * LLM transport for the AI Admin Copilot using the OpenAI-compatible
 * Chat Completions HTTP protocol.
 *
 * "OpenAI-compatible" here is the protocol name (the same wire format
 * adopted by NVIDIA NIM, OpenRouter, vLLM, llama.cpp server, etc). This
 * code does NOT call OpenAI; it talks to whichever provider the operator
 * configured in `provider-config.ts`.
 *
 * Why not the OpenAI SDK: we use fetch directly so:
 *   - we never accidentally pick up SDK behaviors that assume OpenAI
 *     (e.g. their "azure"/"organization" headers, retry policies);
 *   - we can swap providers by env var with zero code change.
 */

import { getCopilotProvider, hasCopilotProvider } from "./provider-config";

const MAX_TOOL_ROUNDS = 4;
const REQUEST_TIMEOUT_MS = 60_000;

export type FunctionSchema = {
  name: string;
  description: string;
  /** JSON Schema for the tool's argument shape. */
  parameters: Record<string, unknown>;
};

export type Tool = { type: "function"; function: FunctionSchema };

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: ChatMessage;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface ToolHandler {
  (name: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface ToolUseTrace {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

export interface CopilotChatResult {
  text: string;
  toolUses: ToolUseTrace[];
  inputTokens: number;
  outputTokens: number;
  stoppedReason: string | null;
}

/**
 * Progress event emitted by copilotChat as it works through tool rounds.
 * Used by the SSE streaming /ask endpoint to give the user live feedback
 * during the (typically 3-6 second) tool-loop window. Non-streaming
 * callers can simply pass no onEvent and ignore.
 */
export type CopilotEvent =
  | { type: "round_start"; round: number }
  | { type: "tool_call_start"; round: number; name: string; input: Record<string, unknown> }
  | { type: "tool_call_done"; round: number; name: string; ok: boolean; summary: string }
  | { type: "round_done"; round: number; hadToolCalls: boolean };

function summarizeToolResult(result: unknown): { ok: boolean; summary: string } {
  if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
    const err = (result as { error: unknown }).error;
    return {
      ok: false,
      summary: typeof err === "string" ? err.slice(0, 120) : "error",
    };
  }
  // Try to extract a one-liner from common shapes.
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.matches)) return { ok: true, summary: `${r.matches.length} match(es)` };
    if (Array.isArray(r.products)) return { ok: true, summary: `${r.products.length} product(s)` };
    if (Array.isArray(r.entries)) return { ok: true, summary: `${r.entries.length} entry(ies)` };
    if (typeof r.productId === "number") return { ok: true, summary: `product #${r.productId}` };
    if (typeof r.status === "number") {
      const ok = r.status >= 200 && r.status < 300;
      return { ok, summary: `HTTP ${r.status}` };
    }
  }
  return { ok: true, summary: "ok" };
}

export function copilotLlmAvailable(): boolean {
  return hasCopilotProvider();
}

async function postChatCompletion(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
  messages: ChatMessage[];
  tools: Tool[];
  maxTokens: number;
}): Promise<ChatCompletionResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(`${args.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...args.extraHeaders,
      },
      body: JSON.stringify({
        model: args.model,
        messages: args.messages,
        tools: args.tools.length > 0 ? args.tools : undefined,
        tool_choice: args.tools.length > 0 ? "auto" : undefined,
        max_tokens: args.maxTokens,
        temperature: 0.2,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 500)}`);
    }
    return (await resp.json()) as ChatCompletionResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a tool-use round-trip. Loop until the assistant returns a final
 * text answer (no more tool_calls) or MAX_TOOL_ROUNDS is hit.
 *
 * Optional `history` is the prior conversation's user/assistant messages
 * (typically the last 6 turns) so the model has context across turns.
 * The route caps the size so we don't blow the context window on long
 * sessions.
 *
 * Optional `onEvent` is called as the chat progresses — used by the SSE
 * streaming path to push live "searching… updating… done" feedback to
 * the client during the multi-second tool loop.
 */
export async function copilotChat(args: {
  systemText: string;
  intentText: string;
  tools: Tool[];
  toolHandler: ToolHandler;
  maxTokens?: number;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  onEvent?: (e: CopilotEvent) => void;
}): Promise<CopilotChatResult> {
  const provider = getCopilotProvider();
  if (!provider.apiKey) {
    throw new Error("LLM provider not configured");
  }

  const messages: ChatMessage[] = [{ role: "system", content: args.systemText }];

  // Prior turns (cap on the route side; we just type-narrow here).
  for (const h of args.history ?? []) {
    if (h.role === "user" || h.role === "assistant") {
      messages.push({ role: h.role, content: h.content });
    }
  }

  messages.push({ role: "user", content: args.intentText });

  const trace: ToolUseTrace[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let lastStop: string | null = null;
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    args.onEvent?.({ type: "round_start", round });
    const resp = await postChatCompletion({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      extraHeaders: provider.extraHeaders,
      messages,
      tools: args.tools,
      maxTokens: args.maxTokens ?? 1024,
    });

    inputTokens += resp.usage?.prompt_tokens ?? 0;
    outputTokens += resp.usage?.completion_tokens ?? 0;

    const choice = resp.choices?.[0];
    if (!choice) {
      throw new Error("LLM returned no choices");
    }
    lastStop = choice.finish_reason;
    const message = choice.message;

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      finalText = (message.content ?? "").trim();
      args.onEvent?.({ type: "round_done", round, hadToolCalls: false });
      break;
    }

    // Append assistant turn with tool_calls, then a `tool` message per call.
    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      let parsedInput: Record<string, unknown>;
      try {
        parsedInput =
          typeof tc.function.arguments === "string" && tc.function.arguments.length > 0
            ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
            : {};
      } catch {
        parsedInput = {};
      }
      args.onEvent?.({
        type: "tool_call_start",
        round,
        name: tc.function.name,
        input: parsedInput,
      });
      const result = await args.toolHandler(tc.function.name, parsedInput);
      const { ok: callOk, summary: callSummary } = summarizeToolResult(result);
      args.onEvent?.({
        type: "tool_call_done",
        round,
        name: tc.function.name,
        ok: callOk,
        summary: callSummary,
      });
      trace.push({ name: tc.function.name, input: parsedInput, result });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: typeof result === "string" ? result : JSON.stringify(result ?? null),
      });
    }
    args.onEvent?.({ type: "round_done", round, hadToolCalls: true });
  }

  return {
    text: finalText,
    toolUses: trace,
    inputTokens,
    outputTokens,
    stoppedReason: lastStop,
  };
}
