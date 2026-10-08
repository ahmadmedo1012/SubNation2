import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq, sql, type SQL } from "drizzle-orm";
import { db, initTestDb, resetTestDb, referralEventsTable, usersTable } from "../../test/db";
import { applyReferralFksRestrictStage } from "../../migrate";

/**
 * R123-E5 (R123-A7 P2) — V1-M28: referral_events referrer/referee FKs
 * rebuilt as ON DELETE RESTRICT (money-adjacent attribution — deleting a
 * REFEREE user must not atomically erase the REFERRER's pending credit
 * claim; the V1-M25 never-delete boundary extended).
 *
 * The pglite harness carries the POST-V1-M28 steady state (both FKs
 * RESTRICT under the boot names fk_referral_referrer / fk_referral_referee),
 * so the default run certifies the zero-DDL pin, and the legacy-shape tests
 * restore the pre-R123 CASCADE twins by hand (raw SQL, never the stage
 * under test — the v1m25 pristine-state pattern).
 */

const FK_TARGETS: Array<{ column: string; constraint: string }> = [
  { column: "referrer_id", constraint: "fk_referral_referrer" },
  { column: "referee_id", constraint: "fk_referral_referee" },
];

/** Drop EVERY FK on referral_events.<column> regardless of name (V1-M20 sweep shape). */
async function dropAllReferralFks(column: string): Promise<void> {
  await db.execute(
    sql.raw(`
    DO $$
    DECLARE
      fk_name text;
    BEGIN
      FOR fk_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_attribute a
          ON a.attrelid = con.conrelid
         AND a.attnum = ANY (con.conkey)
        WHERE con.contype = 'f'
          AND con.conrelid = 'referral_events'::regclass
          AND a.attname = '${column}'
      LOOP
        EXECUTE format('ALTER TABLE referral_events DROP CONSTRAINT %I', fk_name);
      END LOOP;
    END $$;
  `),
  );
}

/** Restore the pristine (post-V1-M28) harness shape: one RESTRICT FK per column. */
async function restorePristineFks(): Promise<void> {
  for (const { column, constraint } of FK_TARGETS) {
    await dropAllReferralFks(column);
    await db.execute(
      sql.raw(
        `ALTER TABLE referral_events ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES users(id) ON DELETE RESTRICT`,
      ),
    );
  }
}

interface Recorded {
  statements: string[];
  execute: (query: SQL) => Promise<unknown>;
}

/** Recording executor (same chunk-walking as migrate-v1m25). */
function recorder(): Recorded {
  const statements: string[] = [];
  return {
    statements,
    execute: async (query) => {
      const text = String(
        (query as unknown as { queryChunks?: Array<{ value: unknown }> }).queryChunks
          ?.map((c) => (Array.isArray(c.value) ? c.value.join("") : c.value))
          .join(""),
      );
      statements.push(text);
      return db.execute(query);
    },
  };
}

/** DDL-class statements (ALTER TABLE / DROP CONSTRAINT / ADD CONSTRAINT). */
const DDL_RE = /ALTER\s+TABLE|DROP\s+CONSTRAINT|ADD\s+CONSTRAINT/i;

async function constraintDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

/** All FK constraint names on referral_events.<column> (the sweep's view). */
async function columnFkNames(column: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT con.conname AS conname
    FROM pg_constraint con
    JOIN pg_attribute a
      ON a.attrelid = con.conrelid
     AND a.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid = 'referral_events'::regclass
      AND a.attname = ${column}
  `);
  const rows = (result as unknown as { rows?: Array<{ conname: string }> }).rows ?? [];
  return rows.map((r) => String(r.conname));
}

async function countAlerts(dedupeKey: string): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*) AS c FROM admin_alerts WHERE dedupe_key = ${dedupeKey}`,
  );
  const rows = (result as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
  return Number(rows[0]?.c ?? 0);
}

/** Unwrap drizzle's error cause to pin the exact constraint that rejected. */
async function constraintViolationName(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint?: string } }).cause;
    return cause?.constraint ?? (err as { constraint?: string }).constraint;
  }
}

let phoneSeq = 91_710_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

beforeAll(initTestDb, 60_000);
beforeEach(async () => {
  await resetTestDb();
  await restorePristineFks();
});

describe("V1-M28 — applyReferralFksRestrictStage (R123-A7 P2)", () => {
  it("steady state: both FKs already RESTRICT under the boot names → ZERO DDL", async () => {
    // The harness boots in the post-V1-M28 shape — exactly every steady-
    // state boot after the first post-R123 deploy.
    expect(await constraintDef("fk_referral_referrer")).toBe(
      "FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE RESTRICT",
    );
    expect(await constraintDef("fk_referral_referee")).toBe(
      "FOREIGN KEY (referee_id) REFERENCES users(id) ON DELETE RESTRICT",
    );

    const rec = recorder();
    await applyReferralFksRestrictStage(rec.execute);

    // THE regression pin: the probes answered RESTRICT → no ALTER at all.
    expect(rec.statements.filter((s) => DDL_RE.test(s))).toHaveLength(0);
  });

  it("legacy CASCADE shape (the pre-R123 live DB): probe-gated conversion → RESTRICT, once", async () => {
    // Both columns back to their pre-R123 boot shape: same names, CASCADE.
    for (const { column, constraint } of FK_TARGETS) {
      await dropAllReferralFks(column);
      await db.execute(
        sql.raw(
          `ALTER TABLE referral_events ADD CONSTRAINT ${constraint} FOREIGN KEY (${column}) REFERENCES users(id) ON DELETE CASCADE`,
        ),
      );
      expect(await constraintDef(constraint)).toContain("ON DELETE CASCADE");
    }

    await applyReferralFksRestrictStage();
    for (const { column, constraint } of FK_TARGETS) {
      expect(await constraintDef(constraint)).toContain("ON DELETE RESTRICT");
      // Converged to EXACTLY one FK per column — no drizzle-named twin left.
      expect(await columnFkNames(column)).toEqual([constraint]);
    }

    // Re-run with a recorder: pure no-op (the forever-boot contract).
    const rec = recorder();
    await applyReferralFksRestrictStage(rec.execute);
    expect(rec.statements.filter((s) => DDL_RE.test(s))).toHaveLength(0);
  });

  it("differently-named CASCADE FKs (chain-built shape): the any-name sweep converges them", async () => {
    // A database built by the drizzle chain carries the drizzle-named FKs.
    for (const { column } of FK_TARGETS) {
      await dropAllReferralFks(column);
    }
    await db.execute(
      sql.raw(
        `ALTER TABLE referral_events ADD CONSTRAINT referral_events_referrer_id_users_id_fk FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE`,
      ),
    );
    await db.execute(
      sql.raw(
        `ALTER TABLE referral_events ADD CONSTRAINT referral_events_referee_id_users_id_fk FOREIGN KEY (referee_id) REFERENCES users(id) ON DELETE CASCADE`,
      ),
    );

    await applyReferralFksRestrictStage();

    // The strays are gone; the canonical boot-named RESTRICT FKs remain.
    expect(await columnFkNames("referrer_id")).toEqual(["fk_referral_referrer"]);
    expect(await columnFkNames("referee_id")).toEqual(["fk_referral_referee"]);
    expect(await constraintDef("fk_referral_referrer")).toContain("ON DELETE RESTRICT");
    expect(await constraintDef("fk_referral_referee")).toContain("ON DELETE RESTRICT");
  });

  it("orphan rows: ALERT + skip, nothing deleted, the other column still converges", async () => {
    // A real referee user (the referee FK stays live), an orphan referrer.
    const [referee] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
    // Drop the referrer FK so an orphaned referrer_id can exist (v1m25 pattern).
    await dropAllReferralFks("referrer_id");
    await db.execute(sql`
      INSERT INTO referral_events (referrer_id, referee_id, status)
      VALUES (424242, ${referee.id}, 'pending')
    `);

    await applyReferralFksRestrictStage();

    // The FK was NOT created and the orphan row was NOT deleted.
    expect(await columnFkNames("referrer_id")).toEqual([]);
    const orphans = await db.execute(
      sql`SELECT count(*) AS c FROM referral_events WHERE referrer_id = 424242`,
    );
    const rows = (orphans as unknown as { rows?: Array<{ c: number | string }> }).rows ?? [];
    expect(Number(rows[0]?.c ?? 0)).toBe(1);
    // A deduped admin alert was logged for the operator.
    expect(await countAlerts("db:fkrestrict:fk_referral_referrer")).toBe(1);
    // Per-column short-circuit: the referee FK still converged.
    expect(await constraintDef("fk_referral_referee")).toContain("ON DELETE RESTRICT");
  });

  it("the rebuilt RESTRICT FK actually blocks a referee delete (the referrer's claim survives)", async () => {
    const [referrer] = await db
      .insert(usersTable)
      .values({ phone: nextPhone(), referralCode: "REFR28A" })
      .returning();
    const [referee] = await db
      .insert(usersTable)
      .values({ phone: nextPhone(), referredBy: referrer.id })
      .returning();
    await db.insert(referralEventsTable).values({
      referrerId: referrer.id,
      refereeId: referee.id,
      status: "pending",
    });

    // The stage ran in beforeEach's pristine restore — the behavioral pin:
    // deleting the REFEREE is refused (the pending credit claim survives).
    expect(
      await constraintViolationName(db.delete(usersTable).where(eq(usersTable.id, referee.id))),
    ).toBe("fk_referral_referee");
    const [survivor] = await db.select().from(referralEventsTable);
    expect(survivor).toBeDefined();
    expect(survivor.status).toBe("pending");
  });

  it("a user with NO referral rows still deletes cleanly (RESTRICT is not a blanket block)", async () => {
    const [loner] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
    await db.delete(usersTable).where(eq(usersTable.id, loner.id));
    const [gone] = await db.select().from(usersTable).where(eq(usersTable.id, loner.id));
    expect(gone).toBeUndefined();
  });
});
