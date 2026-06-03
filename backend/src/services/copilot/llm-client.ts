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
 */
export async function copilotChat(args: {
  systemText: string;
  intentText: string;
  tools: Tool[];
  toolHandler: ToolHandler;
  maxTokens?: number;
}): Promise<CopilotChatResult> {
  const provider = getCopilotProvider();
  if (!provider.apiKey) {
    throw new Error("LLM provider not configured");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: args.systemText },
    { role: "user", content: args.intentText },
  ];
  const trace: ToolUseTrace[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let lastStop: string | null = null;
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
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
      const result = await args.toolHandler(tc.function.name, parsedInput);
      trace.push({ name: tc.function.name, input: parsedInput, result });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content:
          typeof result === "string" ? result : JSON.stringify(result ?? null),
      });
    }
  }

  return {
    text: finalText,
    toolUses: trace,
    inputTokens,
    outputTokens,
    stoppedReason: lastStop,
  };
}
