import { db, auditLogsTable, loginAttemptsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * R111 (B1-2 + B6-05 — the last two unpruned growth tables, live-confirmed
 * by audit T3: login_attempts 3 rows / audit_logs 25 rows and growing).
 *
 * `login_attempts` (B1-2): every failed auth (user OR admin, including
 * probes for NONEXISTENT usernames) inserts/upserts a row keyed
 * `admin:<username>:<ip>` / `user:<phone>:<ip>`. Nothing ever deleted them
 * — an immortal row per failed attempt, pure attacker-controlled storage
 * growth. A row whose last_attempt is older than the retention window can
 * never influence a lockout decision again (the lockout flow reads the
 * CURRENT window's count; a stale row just carries a dead counter), so
 * deleting it cannot weaken brute-force protection.
 *
 * `audit_logs` (B6-05): the only remaining unbounded table. Compliance
 * value is real (admin money actions, auth events) but so is the cost —
 * 180 days covers every operational + dispute horizon this platform has
 * (support window is days; financial reconciliation runs same-month).
 * COMPLIANCE.md documents this window explicitly now.
 */
const LOGIN_ATTEMPTS_RETENTION_DAYS = 7;
const AUDIT_LOGS_RETENTION_DAYS = 180;
const DELETE_BATCH_SIZE = 1000;

function daysAgo(days: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - days * 24);
  return d;
}

/**
 * Delete login_attempts rows whose last_attempt is older than
 * LOGIN_ATTEMPTS_RETENTION_DAYS.
 *
 * Safety: locked_until is always < 15-min-doubling ceilings (bounded far
 * below the window), so any lock that could still matter lives on a row
 * with a RECENT last_attempt — never on a pruned row. Idempotent; batched
 * ctid deletes (B7-P2-5 shape). Scheduling: 05:00 UTC retention slot.
 */
export async function pruneStaleLoginAttempts(): Promise<number> {
  const cutoff = daysAgo(LOGIN_ATTEMPTS_RETENTION_DAYS);
  let deleted = 0;
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM login_attempts
      WHERE ctid IN (
        SELECT ctid FROM login_attempts
        WHERE last_attempt < ${cutoff}
        LIMIT ${DELETE_BATCH_SIZE}
      )
      RETURNING id
    `);
    const rows =
      (result as unknown as { rows?: Array<{ id: number }> }).rows ??
      (result as unknown as Array<{ id: number }>) ??
      [];
    deleted += rows.length;
    if (rows.length < DELETE_BATCH_SIZE) break;
  }
  if (deleted > 0) {
    logger.info(
      {
        category: "login_attempts.retention",
        deleted,
        retentionDays: LOGIN_ATTEMPTS_RETENTION_DAYS,
      },
      `[auth-retention] pruned ${deleted} login_attempt row(s) idle > ${LOGIN_ATTEMPTS_RETENTION_DAYS}d`,
    );
  }
  void loginAttemptsTable;
  return deleted;
}

/**
 * Delete audit_logs rows older than AUDIT_LOGS_RETENTION_DAYS.
 *
 * Safety: audit rows are write-once evidence — deleting only by age, never
 * by actor/action, and 180d dwarfs every dispute/ops window (the money
 * trail itself lives forever in orders + wallet_ledger + topups; this is
 * the META trail). Idempotent; batched ctid deletes.
 */
export async function pruneOldAuditLogs(): Promise<number> {
  const cutoff = daysAgo(AUDIT_LOGS_RETENTION_DAYS);
  let deleted = 0;
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM audit_logs
      WHERE ctid IN (
        SELECT ctid FROM audit_logs
        WHERE created_at < ${cutoff}
        LIMIT ${DELETE_BATCH_SIZE}
      )
      RETURNING id
    `);
    const rows =
      (result as unknown as { rows?: Array<{ id: number }> }).rows ??
      (result as unknown as Array<{ id: number }>) ??
      [];
    deleted += rows.length;
    if (rows.length < DELETE_BATCH_SIZE) break;
  }
  if (deleted > 0) {
    logger.info(
      { category: "audit_logs.retention", deleted, retentionDays: AUDIT_LOGS_RETENTION_DAYS },
      `[audit-retention] pruned ${deleted} audit row(s) older than ${AUDIT_LOGS_RETENTION_DAYS}d`,
    );
  }
  void auditLogsTable;
  return deleted;
}
