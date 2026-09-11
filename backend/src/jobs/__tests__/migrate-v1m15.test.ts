import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, supportTicketsTable } from "../../test/db";
import { applyTicketRepliesDriftClosureStage } from "../../migrate";

/**
 * V1-M15 (round-97 F7, R97-DB-02 + R97-DB-04) — ticket_replies drift
 * closure + duplicate users.firebase_uid index cleanup.
 *
 * Live-DB confirmed drift (docs/inspection-r97/database-deep-dive.md
 * D1/D2/D4): ticket_replies has pkey ONLY — no FK to support_tickets and
 * no idx_replies_ticket — while the schema TS (ticket_replies.ts) always
 * declared both; and users carried THREE firebase_uid indexes of which
 * two are structural duplicates of users_firebase_uid_key.
 *
 * The harness DDL (test/db.ts) already carries the CLOSED shape (inline
 * FK + idx_replies_ticket — it mirrors the schema TS), so each test
 * starts by stripping ticket_replies back to the production drift state
 * (pkey only) and re-creating the duplicate firebase indexes to simulate
 * the live users table.
 */

// Explicit hook timeout: the pglite WASM boot + DDL runs under heavy
// parallel-suite CPU contention (same rationale as migrate-v1m9/v1m10/v1m12).
beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
  await stripTicketRepliesToDriftState();
  await recreateDuplicateFirebaseIndexes();
});

/** Reproduce the live production drift: ticket_replies = pkey only. */
async function stripTicketRepliesToDriftState(): Promise<void> {
  await db.execute(sql.raw("DROP INDEX IF EXISTS idx_replies_ticket"));
  // Drop EVERY FK on ticket_replies by name (the harness inline FK's
  // auto-name is an implementation detail — robust by construction).
  const result = await db.execute(sql`
    SELECT conname AS conname FROM pg_constraint
    WHERE contype = 'f' AND conrelid = 'ticket_replies'::regclass
  `);
  const rows = (result as unknown as { rows?: Array<{ conname: string }> }).rows ?? [];
  for (const row of rows) {
    await db.execute(sql.raw(`ALTER TABLE ticket_replies DROP CONSTRAINT "${row.conname}"`));
  }
}

/** Reproduce the live users table: the two duplicate firebase_uid indexes. */
async function recreateDuplicateFirebaseIndexes(): Promise<void> {
  await db.execute(
    sql.raw("CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid)"),
  );
  await db.execute(
    sql.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid_unique ON users(firebase_uid) WHERE firebase_uid IS NOT NULL",
    ),
  );
}

async function constraintDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

async function indexExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 AS one FROM pg_indexes WHERE indexname = ${name}`);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function seedTicket(userId: number, title = "Drift ticket"): Promise<number> {
  const [ticket] = await db
    .insert(supportTicketsTable)
    .values({ userId, title, status: "open" })
    .returning({ id: supportTicketsTable.id });
  return ticket.id;
}

async function seedReply(ticketId: number, message: string): Promise<number> {
  const result = await db.execute(
    sql`INSERT INTO ticket_replies (ticket_id, author_type, message)
        VALUES (${ticketId}, 'admin', ${message}) RETURNING id`,
  );
  const rows = (result as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
  return rows[0]!.id;
}

describe("V1-M15 applyTicketRepliesDriftClosureStage — R97-DB-02 (ticket_replies)", () => {
  it("adds fk_replies_ticket with the exact schema-TS definition", async () => {
    await applyTicketRepliesDriftClosureStage();

    expect(await constraintDef("fk_replies_ticket")).toBe(
      "FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE",
    );
  });

  it("creates idx_replies_ticket on (ticket_id, created_at)", async () => {
    await applyTicketRepliesDriftClosureStage();

    expect(await indexExists("idx_replies_ticket")).toBe(true);
    const result = await db.execute(
      sql`SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'idx_replies_ticket'`,
    );
    const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
    expect(rows[0]?.def).toContain("ON public.ticket_replies");
    expect(rows[0]?.def).toContain("(ticket_id, created_at)");
  });

  it("deletes the orphaned replies (count + delete + keep survivors) BEFORE the FK lands", async () => {
    const [user] = await db
      .insert(usersTable)
      .values({ phone: "09100000015", displayName: "drift-user" })
      .returning();

    // Two orphaned replies (tickets deleted while no FK existed — the
    // exact live-production shape: round-94 replies on tickets #2/#3).
    const doomedTicketA = await seedTicket(user.id, "doomed-a");
    const doomedTicketB = await seedTicket(user.id, "doomed-b");
    await seedReply(doomedTicketA, "orphan reply on A");
    await seedReply(doomedTicketB, "orphan reply on B");
    await db.execute(
      sql`DELETE FROM support_tickets WHERE id IN (${doomedTicketA}, ${doomedTicketB})`,
    );

    // One surviving reply on a live ticket.
    const liveTicket = await seedTicket(user.id, "live");
    const liveReplyId = await seedReply(liveTicket, "legitimate reply");

    // Sanity: the drift state really is orphaned (no FK to stop us).
    const orphansBefore = await db.execute(
      sql`SELECT count(*) AS c FROM ticket_replies r
          WHERE NOT EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = r.ticket_id)`,
    );
    expect(
      Number((orphansBefore as unknown as { rows?: Array<{ c: string }> }).rows?.[0]?.c ?? 0),
    ).toBe(2);

    await applyTicketRepliesDriftClosureStage();

    // Orphans gone, survivor kept.
    const remaining = await db.execute(sql`SELECT id FROM ticket_replies`);
    const rows = (remaining as unknown as { rows?: Array<{ id: number }> }).rows ?? [];
    expect(rows.map((r) => r.id)).toEqual([liveReplyId]);
  });

  it("the FK cascades: deleting a ticket now removes its replies", async () => {
    const [user] = await db.insert(usersTable).values({ phone: "09100000016" }).returning();
    const ticket = await seedTicket(user.id, "cascade-probe");
    await seedReply(ticket, "will cascade");

    await applyTicketRepliesDriftClosureStage();
    await db.execute(sql`DELETE FROM support_tickets WHERE id = ${ticket}`);

    const remaining = await db.execute(sql`SELECT count(*) AS c FROM ticket_replies`);
    expect(
      Number((remaining as unknown as { rows?: Array<{ c: string }> }).rows?.[0]?.c ?? 0),
    ).toBe(0);
  });

  it("rejects a reply for a non-existent ticket after the FK exists", async () => {
    const [user] = await db.insert(usersTable).values({ phone: "09100000017" }).returning();
    void user;

    await applyTicketRepliesDriftClosureStage();

    await expect(
      db.execute(
        sql`INSERT INTO ticket_replies (ticket_id, author_type, message)
            VALUES (99999, 'user', 'ghost')`,
      ),
    ).rejects.toBeDefined();
  });
});

describe("V1-M15 — R97-DB-04 (duplicate users.firebase_uid indexes)", () => {
  it("drops idx_users_firebase_uid + idx_users_firebase_uid_unique, keeps users_firebase_uid_key", async () => {
    // Pre-state from beforeEach: all three firebase_uid indexes exist.
    expect(await indexExists("idx_users_firebase_uid")).toBe(true);
    expect(await indexExists("idx_users_firebase_uid_unique")).toBe(true);

    await applyTicketRepliesDriftClosureStage();

    expect(await indexExists("idx_users_firebase_uid")).toBe(false);
    expect(await indexExists("idx_users_firebase_uid_unique")).toBe(false);
    // The column UNIQUE constraint backing index stays — it is the sole
    // firebase_uid uniqueness enforcement.
    expect(await indexExists("users_firebase_uid_key")).toBe(true);
    expect(await constraintDef("users_firebase_uid_key")).toBe("UNIQUE (firebase_uid)");
  });

  it("unrelated users indexes are untouched — only the two exact duplicates go", async () => {
    // pg_trgm is unavailable in the pglite harness (42704 gin_trgm_ops),
    // so the trgm index itself can't be exercised here — the stage never
    // references it anyway. The drop list is name-pinned; prove the
    // blast radius with an unrelated real index instead.
    await db.execute(sql.raw("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)"));
    expect(await indexExists("idx_users_email")).toBe(true);

    await applyTicketRepliesDriftClosureStage();

    expect(await indexExists("idx_users_email")).toBe(true);
    expect(await indexExists("idx_users_firebase_uid")).toBe(false);
    expect(await indexExists("idx_users_firebase_uid_unique")).toBe(false);
  });
});

describe("V1-M15 — idempotent re-runs", () => {
  it("second apply issues no top-level DDL/DML mutation statements (recording executor)", async () => {
    await applyTicketRepliesDriftClosureStage();

    const statements: string[] = [];
    const recording = async (query: SQL) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks
          ?.map((c) => c.value)
          .join(""),
      );
      statements.push(text);
      return db.execute(query);
    };
    await applyTicketRepliesDriftClosureStage(recording);

    // Steady state: the orphan count-probe (SELECT), the FK DO-block
    // (duplicate_object-swallowed — same every-boot shape as the
    // fkStatements loop), the catalog-gated CREATE INDEX IF NOT EXISTS,
    // and the duplicate-index probe (returns zero rows → no DROP). No
    // top-level CREATE TABLE / ALTER TABLE / DROP / DELETE fires.
    expect(statements.some((s) => /^\s*CREATE TABLE/i.test(s))).toBe(false);
    expect(statements.some((s) => /^\s*(ALTER TABLE|DROP INDEX|DELETE FROM)/i.test(s))).toBe(false);
    // The probe statements DID run (guards engaged, not skipped).
    expect(statements.some((s) => s.includes("ticket_replies"))).toBe(true);
    expect(statements.some((s) => s.includes("pg_indexes"))).toBe(true);
  });

  it("re-running with a seeded ticket keeps rows and constraint shape stable", async () => {
    const [user] = await db.insert(usersTable).values({ phone: "09100000018" }).returning();
    const ticket = await seedTicket(user.id, "stable");
    const replyId = await seedReply(ticket, "stable reply");

    await applyTicketRepliesDriftClosureStage();
    await applyTicketRepliesDriftClosureStage(); // re-run must be a no-op

    const rows = await db.execute(sql`SELECT id FROM ticket_replies`);
    expect((rows as unknown as { rows?: Array<{ id: number }> }).rows?.map((r) => r.id)).toEqual([
      replyId,
    ]);
    expect(await constraintDef("fk_replies_ticket")).toBe(
      "FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE",
    );
    // Exactly ONE fk_replies_ticket constraint — the DO-block swallow
    // prevented a duplicate re-add.
    const fks = await db.execute(sql`
      SELECT count(*) AS c FROM pg_constraint
      WHERE conname = 'fk_replies_ticket' AND contype = 'f'
    `);
    expect(Number((fks as unknown as { rows?: Array<{ c: string }> }).rows?.[0]?.c ?? 0)).toBe(1);
  });
});
