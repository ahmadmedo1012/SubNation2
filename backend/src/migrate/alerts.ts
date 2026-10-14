// R144-B2: moved verbatim from src/migrate.ts (original lines 105–258).
// R144-B2: Only the import block + minimal `export` keywords are new;
// R144-B2: the ONE dynamic-import specifier that moved (`./jobs/alertLogger`
// R144-B2: → `../jobs/alertLogger`, in alertMoneyConstraintIssue) is disclosed
// R144-B2: and machine-verified moved-not-modified (scripts/r144b2_verify_split.py).
import { logger } from "../lib/logger";
import { constraintSkipKeys } from "../migrate";

/** Skip paths recorded during the current/last reconcile run (dedupe keys). */
export function getConstraintSkipAlerts(): string[] {
  return [...constraintSkipKeys];
}

/** r110 (109-e P2-1): record a constraint-skip (called by every skip path). */
export function recordConstraintSkip(dedupeKey: string): void {
  constraintSkipKeys.push(dedupeKey);
}

export async function alertMoneyConstraintIssue(title: string, message: string, dedupeKey: string) {
  // r110 (109-e P2-1): a skip path is being taken — record it BEFORE the
  // alert dispatch (a dispatch failure must not un-record the skip; the
  // operator fix + reboot still has to re-run the reconcile).
  recordConstraintSkip(dedupeKey);
  logger.error({ category: "monitoring", dedupeKey }, message);
  try {
    // Lazy import — same circular-load avoidance as the V1-M8 block below
    // (alertLogger imports socket dynamically, which reads env at connect
    // time; migration boot must not pay that cost).
    const { logAdminAlert } = await import("../jobs/alertLogger");
    await logAdminAlert("system", title, message, {
      dedupeKey,
      dedupeWindowMs: 24 * 60 * 60 * 1000,
    });
  } catch (err) {
    logger.warn({ err }, "[migrations] V1-M9 admin alert dispatch failed");
  }
}
