/**
 * Risk-label writer (T013).
 *
 * Phase-1 fallback: writes to `audit_logs` with
 * `action = 'risk.label'`, `targetType = 'risk_event'`,
 * `targetId = <riskEventId>`, `metadata = { label, notes }`.
 *
 * Phase-2 onwards: writes to `risk_labels` directly. This
 * helper hides the switch behind one function so the
 * Phase-1→Phase-2 rollout is a single env-flag flip
 * (`RISK_LABELS_BACKEND=audit_logs|risk_labels`, default
 * `risk_labels` when the table exists).
 */

import type { Request } from "express";

import { db, riskLabelsTable, type NewRiskLabel } from "@workspace/db";

import { writeAuditLog } from "./audit";
import { logger } from "./logger";
import { recordLabel } from "./risk-metrics";

export type RiskLabelKind = "confirmed_fraud" | "false_positive" | "escalated";

export interface WriteRiskLabelInput {
  req: Request;
  riskEventId: number;
  label: RiskLabelKind;
  labeledByAdminId: number;
  notes?: string | null;
}

export interface WriteRiskLabelResult {
  ok: true;
  id: number | null;
  backend: "risk_labels" | "audit_logs";
}

const BACKEND = (() => {
  const v = process.env.RISK_LABELS_BACKEND?.toLowerCase();
  if (v === "audit_logs") return "audit_logs" as const;
  return "risk_labels" as const;
})();

/**
 * Write a label for a single event. Caller must have already
 * verified that:
 *   - the riskEventId exists, and
 *   - the event has no prior label (409 path lives in the
 *     route handler).
 *
 * Returns `{ ok: true }` on success. Throws on real DB
 * errors so the route returns 500 (we do NOT silently
 * succeed on label failure — labels feed the model).
 */
export async function writeRiskLabel(input: WriteRiskLabelInput): Promise<WriteRiskLabelResult> {
  const notes =
    typeof input.notes === "string" && input.notes.length > 0 ? input.notes.slice(0, 2000) : null;

  if (BACKEND === "audit_logs") {
    await writeAuditLog(input.req, "risk.label", "risk_event", input.riskEventId, {
      label: input.label,
      notes,
    });
    recordLabel(input.label);
    return { ok: true, id: null, backend: "audit_logs" };
  }

  const row: NewRiskLabel = {
    riskEventId: input.riskEventId,
    label: input.label,
    labeledBy: input.labeledByAdminId,
    notes,
  };
  const inserted = await db.insert(riskLabelsTable).values(row).returning({
    id: riskLabelsTable.id,
  });

  // Audit-log the action regardless — admins always have a
  // breadcrumb in `audit_logs` even after Phase 2 ships.
  try {
    await writeAuditLog(input.req, "risk.label", "risk_event", input.riskEventId, {
      label: input.label,
      notes,
      labelId: inserted[0]?.id,
    });
  } catch (err) {
    logger.warn(
      { err, riskEventId: input.riskEventId, category: "risk-labels" },
      "[risk-labels] audit-log breadcrumb failed",
    );
  }

  recordLabel(input.label);
  return {
    ok: true,
    id: inserted[0]?.id ?? null,
    backend: "risk_labels",
  };
}
