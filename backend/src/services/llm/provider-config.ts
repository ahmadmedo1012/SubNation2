/**
 * LLM provider configuration (R181: relocated from services/copilot/ — the
 * copilot is gone; the Arabic catalog-enrichment feature and any future
 * OpenAI-compatible consumer keep this transport).
 *
 * Supports two presets, both speak the OpenAI-compatible Chat Completions
 * HTTP protocol (not OpenAI itself — the protocol is an open standard
 * adopted by NVIDIA NIM, OpenRouter, vLLM, and many others). The two
 * presets are:
 *
 *   COPILOT_PROVIDER=openrouter   → https://openrouter.ai/api/v1
 *   COPILOT_PROVIDER=nvidia       → https://integrate.api.nvidia.com/v1
 *
 * Required envs (names kept verbatim from the copilot era — production
 * hosts already carry these keys in Coolify; renaming would break the
 * enrichment runs at boot):
 *   COPILOT_API_KEY      — provider-issued bearer token (always required).
 *   COPILOT_PROVIDER     — preset name (default: openrouter).
 *   COPILOT_MODEL        — model id; falls back to a sensible default
 *                          per provider (see DEFAULT_MODEL_FOR).
 *   COPILOT_BASE_URL     — full override; bypass the preset entirely.
 *
 * Switching models is a single env-var flip with no code change.
 *
 * Production posture mirrors the existing fail-fast pattern: missing
 * COPILOT_API_KEY in production → the LLM consumer fails fast; non-prod →
 * log a single warning and short-circuit so dev boots without the key.
 */

import { logger } from "../../lib/logger";

export type ProviderId = "openrouter" | "nvidia";

interface ProviderPreset {
  id: ProviderId;
  baseUrl: string;
  defaultModel: string;
  /** Some providers want extra HTTP headers (OpenRouter wants a referrer/title). */
  extraHeaders: Record<string, string>;
}

const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  openrouter: {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    // Llama 3.3 70B has solid tool-use and is cheap on OpenRouter. Switch
    // to "anthropic/claude-3.5-sonnet" or "openai/gpt-4o-mini" via env if
    // you want a different cost/quality tradeoff.
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
    extraHeaders: {
      // OpenRouter recommends these; SubNation domain is the production origin.
      "HTTP-Referer": "https://subnation.ly",
      "X-Title": "SubNation",
    },
  },
  nvidia: {
    id: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.3-70b-instruct",
    extraHeaders: {},
  },
};

export interface LlmProviderConfig {
  providerId: ProviderId | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders: Record<string, string>;
}

let cached: LlmProviderConfig | null | undefined;
let warned = false;

function resolveProvider(): LlmProviderConfig | null {
  const apiKey = (process.env.COPILOT_API_KEY ?? "").trim();
  if (!apiKey) return null;

  const baseUrlOverride = (process.env.COPILOT_BASE_URL ?? "").trim();
  const modelOverride = (process.env.COPILOT_MODEL ?? "").trim();

  if (baseUrlOverride) {
    return {
      providerId: "custom",
      baseUrl: baseUrlOverride.replace(/\/+$/, ""),
      apiKey,
      model: modelOverride || "meta-llama/llama-3.3-70b-instruct",
      extraHeaders: {},
    };
  }

  const preset = (process.env.COPILOT_PROVIDER ?? "openrouter").toLowerCase();
  const p = (PROVIDERS as Record<string, ProviderPreset | undefined>)[preset];
  if (!p) {
    logger.warn(
      { COPILOT_PROVIDER: preset },
      "llm: unknown COPILOT_PROVIDER, falling back to openrouter",
    );
    const fallback = PROVIDERS.openrouter;
    return {
      providerId: fallback.id,
      baseUrl: fallback.baseUrl,
      apiKey,
      model: modelOverride || fallback.defaultModel,
      extraHeaders: fallback.extraHeaders,
    };
  }

  return {
    providerId: p.id,
    baseUrl: p.baseUrl,
    apiKey,
    model: modelOverride || p.defaultModel,
    extraHeaders: p.extraHeaders,
  };
}

export function getLlmProvider(): LlmProviderConfig {
  if (cached === undefined) cached = resolveProvider();

  if (cached) return cached;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "COPILOT_API_KEY is required in production for the LLM-backed features " +
        "(catalog enrichment). Set COPILOT_PROVIDER=openrouter|nvidia and " +
        "COPILOT_API_KEY in the host environment.",
    );
  }
  if (!warned) {
    logger.warn(
      { module: "llm/provider-config" },
      "COPILOT_API_KEY is unset — LLM-backed features (enrichment) will no-op.",
    );
    warned = true;
  }
  // Return a sentinel that hasLlmProvider() detects via the empty key.
  return { providerId: "openrouter", baseUrl: "", apiKey: "", model: "", extraHeaders: {} };
}

export function hasLlmProvider(): boolean {
  if (cached === undefined) cached = resolveProvider();
  return cached !== null && cached.apiKey.length > 0;
}
