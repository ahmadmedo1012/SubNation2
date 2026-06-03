import { logger } from "../logger";

/**
 * Anthropic API key for the AI Admin Copilot (010-ai-admin-copilot).
 *
 * Validation posture, mirroring the existing SESSION_SECRET / ENCRYPTION_KEY
 * pattern (Constitution §IV "fail fast on weak/missing secrets"):
 *
 *   - Production (NODE_ENV === "production"): throw at first call if missing,
 *     empty, or shorter than 40 chars (Anthropic keys are sk-ant-* and well
 *     above this; we accept any length ≥ 40 to stay forward-compatible with
 *     future key formats).
 *   - Non-production: log a single warning at first call and return null;
 *     copilot routes that depend on it return 503 COPILOT_LLM_UNAVAILABLE
 *     rather than crashing the dev process.
 *
 * Boot does NOT touch this. The check is lazy so a dev or staging environment
 * without the key can still boot the rest of the API. The fail-fast triggers
 * only when an admin actually invokes a copilot route.
 *
 * Never log the key value, even at debug level.
 */
let cachedKey: string | null | undefined;
let warned = false;

export function getAnthropicApiKey(): string {
  if (cachedKey === undefined) {
    const raw = (process.env.ANTHROPIC_API_KEY ?? "").trim();
    cachedKey = raw.length >= 40 ? raw : null;
  }

  if (cachedKey) return cachedKey;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ANTHROPIC_API_KEY is required in production for the AI Admin Copilot. " +
        "Set it in the host environment (e.g. Render Dashboard → Environment → " +
        "ANTHROPIC_API_KEY) before enabling any copilot phase flag. The key " +
        "MUST start with `sk-ant-` and be ≥ 40 chars; obtain one from " +
        "https://console.anthropic.com/.",
    );
  }

  if (!warned) {
    logger.warn(
      { module: "copilot/anthropic-config" },
      "ANTHROPIC_API_KEY is unset or shorter than 40 chars — copilot routes " +
        "will return 503 COPILOT_LLM_UNAVAILABLE. This is non-fatal in non-prod.",
    );
    warned = true;
  }
  return "";
}

/**
 * Returns true if a usable key is configured. Use to short-circuit copilot
 * route handlers in non-production without throwing.
 */
export function hasAnthropicApiKey(): boolean {
  if (cachedKey === undefined) {
    const raw = (process.env.ANTHROPIC_API_KEY ?? "").trim();
    cachedKey = raw.length >= 40 ? raw : null;
  }
  return cachedKey !== null && cachedKey.length > 0;
}

/**
 * Test-only reset. Restores the lazy-load behavior so tests can swap the
 * env var. Not exported via index.ts — import directly in test files.
 */
export function __resetAnthropicConfigCacheForTests(): void {
  cachedKey = undefined;
  warned = false;
}
