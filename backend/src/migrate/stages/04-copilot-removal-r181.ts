// R181: stage family for the AI Admin Copilot permanent removal — V1-M36.
// The owner retired the feature outright: UI, API, services, generated
// contracts, and the exclusive data model. This stage converges the
// DATABASE onto that decision at boot, using the V1-M15/M30 probe-gated
// idiom (zero-DDL steady state — a database already converged by a prior
// boot sends no DDL at all).
//
// What is removed and why it is safe:
//
//   1. copilot_action_items → copilot_actions → copilot_previews, in
//      exactly that dependency order (items FK→actions, actions
//      FK→previews). No CASCADE anywhere: the order makes every DROP
//      land with zero dependents, and a plain `DROP TABLE` on a table
//      with dependents would (correctly) fail loud instead of guessing.
//      The tables are Copilot-EXCLUSIVE (created by the retired
//      010-ai-admin-copilot pipeline; no other reader or writer exists
//      in the tree — verified by the R181 reference sweep), so the rows
//      they carry are feature residue, not shared history.
//
//   2. system_settings key `copilot.phases` — the four phase flags the
//      retired settings route (GET/PATCH /api/admin/copilot/settings)
//      read and wrote. Positively identified by the exact key.
//
//   3. audit_logs rows the copilot's audit.ts dual-writer produced:
//      action LIKE 'copilot.%' (action was `copilot.${actionClass}`)
//      and/or targetType = 'copilot_action'. Both are identifiers no
//      other audit writer emits (every other writer uses its own
//      action/targetType vocabulary — money, admin, security writers
//      never emit either pattern), so only positively-identified
//      copilot rows are deleted. Unrelated admin/finance/security
//      audit history is untouched.
//
// Interaction with the retired create block: migrate.ts no longer
// creates these tables (the block was deleted in the same round), so a
// converged database stays converged — repeated boots send no DDL, and
// a FRESH install never sees the tables at all. The Drizzle mirror
// (chain 0027) carries the same DROPs for the chain-built path.
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { type SqlExecutor, defaultExecutor, extractCount, extractRows } from "../shared";

const COPILOT_TABLES = ["copilot_action_items", "copilot_actions", "copilot_previews"] as const;

export async function applyCopilotRemovalStage(
  execute: SqlExecutor = defaultExecutor,
): Promise<void> {
  // 1. The three tables, dependency order, existence-probed (V1-M15 idiom)
  //    with the IF EXISTS belt (V1-M30 idiom). Probe keeps the steady
  //    state at zero DDL: a converged database sends nothing.
  for (const table of COPILOT_TABLES) {
    const present = extractRows(
      await execute(sql`
        SELECT 1 AS present FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = ${table}
      `),
    );
    if (present.length > 0) {
      await execute(sql.raw(`DROP TABLE IF EXISTS ${table}`));
      logger.info(
        { category: "storage", table },
        "V1-M36: dropped copilot-exclusive table (feature retired R181)",
      );
    }
  }

  // 2. The phase-setting row — exact key match, nothing else in
  //    system_settings is touched.
  const phaseRows = extractCount(
    await execute(sql`
      SELECT count(*) AS c FROM system_settings WHERE key = 'copilot.phases'
    `),
  );
  if (phaseRows > 0) {
    await execute(sql`DELETE FROM system_settings WHERE key = 'copilot.phases'`);
    logger.info(
      { category: "storage", key: "copilot.phases" },
      "V1-M36: removed the copilot phase-setting row (feature retired R181)",
    );
  }

  // 3. Copilot-emitted audit rows — the two positive identifiers the
  //    copilot's dual-writer stamped and no other writer uses.
  const auditRows = extractCount(
    await execute(sql`
      SELECT count(*) AS c FROM audit_logs
      WHERE action LIKE 'copilot.%' OR target_type = 'copilot_action'
    `),
  );
  if (auditRows > 0) {
    await execute(sql`
      DELETE FROM audit_logs
      WHERE action LIKE 'copilot.%' OR target_type = 'copilot_action'
    `);
    logger.info(
      { category: "storage", rows: auditRows },
      "V1-M36: removed positively-identified copilot audit rows (feature retired R181)",
    );
  }
}
