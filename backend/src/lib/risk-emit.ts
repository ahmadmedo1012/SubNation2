/**
 * Fire-and-forget wrapper around `scoreEvent` for use from request handlers.
 *
 * The scoring service already swallows internal errors and returns degraded
 * results — but its result can still be awaited, which would couple the
 * caller's response latency to the rule-engine + Postgres insert. This
 * helper detaches the call so a slow scoring path never blocks the user's
 * login / topup / order request.
 *
 * Usage:
 *
 *   import { scoreEventFireAndForget } from "../lib/risk-emit";
 *   scoreEventFireAndForget({
 *     eventType: "otp_request",
 *     ipAddress: req.ip,
 *     userAgent: req.headers["user-agent"],
 *     phone,
 *     ruleContext: { event: { eventType: "otp_request", ipAddress: req.ip } },
 *   });
 *   // continue handling the request — do NOT await
 *
 * The pipeline is gated by `RISK_PIPELINE_ENABLED=true` (default off), so
 * call sites can be sprinkled in code paths without changing observable
 * behavior until the operator flips the flag.
 */

import type { Request } from "express";
import { logger } from "./logger";
import {
  scoreEvent,
  type ScoringInput,
  type ScoringResult,
} from "../services/risk-scoring.service";

export function scoreEventFireAndForget(input: ScoringInput): void {
  // Capture stack now so a thrown error inside the async chain still
  // points back at the caller, not at this file's microtask.
  const callerStack = new Error("risk-emit caller").stack;
  void scoreEvent(input).catch((err) => {
    logger.warn(
      { err, callerStack, category: "risk-emit" },
      "[risk-emit] scoreEvent rejected (should never happen — service is supposed to swallow)",
    );
  });
}

/**
 * Convenience: pull `req.ip` and `user-agent` off an Express request.
 */
export function clientFromReq(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const uaHeader = req.headers["user-agent"];
  const ua = Array.isArray(uaHeader) ? uaHeader[0] : uaHeader;
  return {
    ipAddress: req.ip ?? null,
    userAgent: ua ?? null,
  };
}

/** Exported for tests that want to await the awaitable form. */
export async function scoreEventAwait(input: ScoringInput): Promise<ScoringResult> {
  return scoreEvent(input);
}
