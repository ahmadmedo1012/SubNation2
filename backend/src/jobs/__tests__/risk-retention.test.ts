import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import { orphanLabelGraceDays, reapExpiredRiskEvents } from "../risk-retention";

/**
 * R123-E5 (R123-A7 P3) — risk_labels orphan prune.
 *
 * The 97-day labeled-event pass deletes risk_events rows whose labels
 * reference them; risk_labels.risk_event_id is ON DELETE SET NULL, so
 * every such purge leaves a NULL-pointer label row behind. Those orphans
 * can never re-join (the event row is gone), hold no training value, and
 * previously accumulated forever. reapExpiredRiskEvents now prunes them
 * after a 30-day grace, ctid-batched like the sibling passes (B7-P2-5).
 *
 * risk_events / risk_labels are not part of the shared harness DDL, so
 * this file provisions the production shape locally (the
 * retention-batching/auth-activity convention; per-file pglite instance).
 * A JOINED label — whatever its age — must never be touched: that is the
 * Phase-3 training corpus.
 */

// 1010 rows: full batch (1000) + remainder (10) — forces ≥2 loop
// iterations without wasting CPU on rows the boundary test doesn't need
// (the 2-CPU full-suite contention rationale, retention-batching.test.ts).
const BATCH_BOUNDARY_ROWS = 1010;

/** The per-file production shape the job touches. */
const PER_FILE_DDL = [
  `CREATE TABLE IF NOT EXISTS risk_events (
    id serial PRIMARY KEY,
    user_id integer,
    event_type varchar(40) NOT NULL DEFAULT 'login_attempt',
    level varchar(10) NOT NULL DEFAULT 'low',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS risk_labels (
    id serial PRIMARY KEY,
    risk_event_id integer REFERENCES risk_events(id) ON DELETE SET NULL,
    label varchar(20) NOT NULL DEFAULT 'false_positive',
    labeled_by integer,
    labeled_at timestamptz NOT NULL DEFAULT now(),
    notes text
  )`,
];

beforeAll(async () => {
  await initTestDb();
  // Explicit hook timeout — same 2-CPU full-suite contention rationale
  // as migrate-v1m9.test.ts.
}, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // (Re-)provision fresh (drop first so a previous case cannot leak
  // rows; one statement per execute — pglite rejects multi-command
  // prepared statements).
  await db.execute(sql.raw("DROP TABLE IF EXISTS risk_labels CASCADE"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS risk_events CASCADE"));
  for (const stmt of PER_FILE_DDL) {
    await db.execute(sql.raw(stmt));
  }
});

async function countRows(table: string, where: string): Promise<number> {
  const result = await db.execute(sql.raw(`SELECT count(*) AS c FROM ${table} WHERE ${where}`));
  const rows = (result as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

describe("reapExpiredRiskEvents — risk_labels orphan prune (R123-E5)", () => {
  it("deletes orphaned labels past the grace, keeps fresh orphans and JOINED labels", async () => {
    // A FRESH event carrying an OLD label (retroactive review of a live
    // event): the training corpus — never touched, whatever the label age.
    await db.execute(sql`
      INSERT INTO risk_events (id, created_at) VALUES (1, now() - interval '1 day')
    `);
    await db.execute(sql`
      INSERT INTO risk_labels (risk_event_id, labeled_at)
      VALUES (1, now() - interval '365 days')
    `);
    // An orphan past the grace (event deleted long ago, SET NULL fired).
    await db.execute(sql`
      INSERT INTO risk_labels (risk_event_id, labeled_at)
      VALUES (NULL, now() - interval '60 days')
    `);
    // An orphan INSIDE the grace — must survive this cycle.
    await db.execute(sql`
      INSERT INTO risk_labels (risk_event_id, labeled_at)
      VALUES (NULL, now() - interval '5 days')
    `);

    const result = await reapExpiredRiskEvents();

    expect(result.unlabeledDeleted).toBe(0); // nothing to purge on events
    expect(result.labeledExpiredDeleted).toBe(0);
    expect(result.orphanLabelsDeleted).toBe(1);
    // The joined label survived…
    expect(await countRows("risk_labels", "risk_event_id IS NOT NULL")).toBe(1);
    // …the fresh orphan survived…
    expect(await countRows("risk_labels", "risk_event_id IS NULL")).toBe(1);
    // …and only the past-grace orphan is gone (the 365-day-old JOINED
    // label above is supposed to survive — age alone never prunes it).
    expect(
      await countRows(
        "risk_labels",
        "risk_event_id IS NULL AND labeled_at < now() - interval '30 days'",
      ),
    ).toBe(0);
  });

  it("the 97-day labeled pass orphans its labels, and aged orphans are pruned in the SAME run", async () => {
    // A labeled event past the 97-day horizon whose label is itself old
    // (the realistic steady-state shape: the label was written at event
    // time). The purge deletes the event, SET NULL orphans the label,
    // and the prune pass — running AFTER the event passes in the same
    // invocation — takes the now-orphaned label in the same cycle.
    await db.execute(sql`
      INSERT INTO risk_events (id, created_at) VALUES (2, now() - interval '100 days')
    `);
    await db.execute(sql`
      INSERT INTO risk_labels (risk_event_id, labeled_at)
      VALUES (2, now() - interval '100 days')
    `);
    // Same shape but the label was written RECENTLY (retroactive review
    // of an old event): the orphan stays inside the grace this cycle.
    await db.execute(sql`
      INSERT INTO risk_events (id, created_at) VALUES (3, now() - interval '100 days')
    `);
    await db.execute(sql`
      INSERT INTO risk_labels (risk_event_id, labeled_at)
      VALUES (3, now() - interval '2 days')
    `);

    const result = await reapExpiredRiskEvents();

    expect(result.labeledExpiredDeleted).toBe(2);
    // Both events are gone…
    expect(await countRows("risk_events", "true")).toBe(0);
    // …the aged label was pruned in the same run…
    expect(result.orphanLabelsDeleted).toBe(1);
    expect(await countRows("risk_labels", "labeled_at < now() - interval '30 days'")).toBe(0);
    // …the fresh retroactive label survives its grace.
    expect(await countRows("risk_labels", "risk_event_id IS NULL")).toBe(1);
  });

  it("prunes >1000 aged orphans through the ctid batch loop (B7-P2-5)", async () => {
    await db.execute(sql`
      INSERT INTO risk_labels (risk_event_id, labeled_at)
      SELECT NULL, now() - interval '60 days'
      FROM generate_series(1, ${BATCH_BOUNDARY_ROWS})
    `);
    // Plus one fresh orphan and one joined label that must survive.
    await db.execute(sql`
      INSERT INTO risk_events (id, created_at) VALUES (4, now() - interval '1 day')
    `);
    await db.execute(sql`
      INSERT INTO risk_labels (risk_event_id, labeled_at)
      VALUES (4, now() - interval '1 day')
    `);
    await db.execute(sql`
      INSERT INTO risk_labels (risk_event_id, labeled_at)
      VALUES (NULL, now() - interval '1 day')
    `);

    const result = await reapExpiredRiskEvents();

    expect(result.orphanLabelsDeleted).toBe(BATCH_BOUNDARY_ROWS);
    expect(await countRows("risk_labels", "true")).toBe(2);
    expect(await countRows("risk_labels", "risk_event_id IS NOT NULL")).toBe(1);
  });

  it("the grace window is pinned at 30 days (the documented policy)", async () => {
    expect(orphanLabelGraceDays()).toBe(30);
  });
});
