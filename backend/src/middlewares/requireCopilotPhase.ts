/**
 * Phase-gate middleware (010-ai-admin-copilot, T026 + T142).
 *
 * Each copilot route declares which phase flag MUST be enabled for it
 * to execute. If the flag is off, returns 503 COPILOT_PHASE_DISABLED.
 *
 * A5-05 (round-94): the code now rides the typed ErrorCode enum
 * (shared/error-codes) — it was a bare string literal that lived
 * outside the enum/spec contract while the routes emitted it.
 */
import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { getPhaseFlags, type CopilotPhaseFlags } from "../services/copilot/phase-flags";

export type PhaseGate = keyof CopilotPhaseFlags;

export function requireCopilotPhase(phase: PhaseGate) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const flags = await getPhaseFlags();
    if (!flags[phase]) {
      res.status(503).json({
        ...createErrorResponse("هذه المرحلة من المساعد معطّلة حالياً", ErrorCode.COPILOT_PHASE_DISABLED),
        phase,
      });
      return;
    }
    next();
  };
}
