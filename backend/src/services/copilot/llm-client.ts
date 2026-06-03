/**
 * Anthropic SDK wrapper for the AI Admin Copilot (T028).
 *
 * Lazily constructs the SDK client (so a missing key in dev does not crash
 * boot) and provides a tool-use round-trip helper. For Phase 1 (read-only)
 * we do non-streaming round-trips: model emits tool_use → we run the
 * handler → feed back tool_result → model emits final text. Caller can
 * stream the final text via SSE.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  Tool,
  TextBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { getAnthropicApiKey, hasAnthropicApiKey } from "../../lib/copilot/anthropic-config";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 4;

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = getAnthropicApiKey();
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export function copilotLlmAvailable(): boolean {
  return hasAnthropicApiKey();
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
 * Run a tool-use round-trip: send the user's intent + tools, resolve any
 * tool_use blocks via the handler, loop up to MAX_TOOL_ROUNDS, return the
 * final assistant text plus a trace of every tool call.
 */
export async function copilotChat(args: {
  systemBlocks: TextBlockParam[];
  intentText: string;
  tools: Tool[];
  toolHandler: ToolHandler;
  model?: string;
  maxTokens?: number;
}): Promise<CopilotChatResult> {
  const messages: MessageParam[] = [{ role: "user", content: args.intentText }];
  const trace: ToolUseTrace[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let lastStop: string | null = null;
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp: Message = await client().messages.create({
      model: args.model ?? DEFAULT_MODEL,
      max_tokens: args.maxTokens ?? 1024,
      system: args.systemBlocks,
      tools: args.tools,
      messages,
    });
    inputTokens += resp.usage?.input_tokens ?? 0;
    outputTokens += resp.usage?.output_tokens ?? 0;
    lastStop = resp.stop_reason;

    const toolUses = resp.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const textParts = resp.content
      .filter((b): b is Extract<Message["content"][number], { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (toolUses.length === 0) {
      finalText = textParts;
      break;
    }

    // Append assistant turn (with tool_use blocks) and tool_result blocks.
    messages.push({ role: "assistant", content: resp.content });
    const toolResultsContent: MessageParam["content"] = [];
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      const result = await args.toolHandler(tu.name, input);
      trace.push({ name: tu.name, input, result });
      toolResultsContent.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResultsContent });

    if (resp.stop_reason !== "tool_use") {
      // Anthropic returned tool_use blocks but stop_reason wasn't tool_use:
      // treat any text we got as the final text and exit.
      finalText = textParts;
      break;
    }
  }

  return {
    text: finalText.trim(),
    toolUses: trace,
    inputTokens,
    outputTokens,
    stoppedReason: lastStop,
  };
}
