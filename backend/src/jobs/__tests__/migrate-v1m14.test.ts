import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  schedulerLeaderLeaseTable,
  accountLinkConsentsTable,
} from "../../test/db";
import {
  applySchedulerLeaseAndConsentTablesStage,
  applyTicketRepliesDriftClosureStage,
} from "../../migrate";

/**
 * V1-M14 (round-97 F7) — official registration of the two lazily-created
 * round-97 tables:
 *
 *   scheduler_leader_lease  (97-F1, backend/src/lib/pg-leader-lease.ts)
 *   account_link_consents   (97-F2, backend/src/lib/account-link-consent.ts)
 *
 * Both modules CREATE their table lazily with CREATE TABLE IF NOT EXISTS at
 * first use — so this stage must be a no-op when the table already exists
 * (the "lazy path already deployed" case) and must produce the EXACT shape
 * the lazy DDL produces (a mismatch would break the lease/consent SQL the
 * same way a V1-M12 column drift would break lib/idempotency.ts).
 *
 * Tests pin: catalog shape (columns/types/nullability), PK/CHECK/DEFAULT
 * semantics, idempotent re-runs (zero DDL-class statements on steady
 * state), the lazy-path coexistence, and registry parity (the drizzle
 * table objects resolve against the migrated tables).
 */

// Explicit hook timeout: the pglite WASM boot + DDL runs under heavy
// parallel-suite CPU contention (same rationale as migrate-v1m9/v1m10/v1m12).
beforeAll(initTestDb, 60_000);

beforeEach(async () => {
  await resetTestDb();
  // Strip both tables back to the pre-V1-M14 state the stage must build.
  await db.execute(sql.raw("DROP TABLE IF EXISTS account_link_consents"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS scheduler_leader_lease"));
});

async function columnsOf(table: string): Promise<Map<string, string>> {
  const result = await db.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = ${table}
  `);
  const rows = (result as unknown as { rows?: Array<Record<string, string>> }).rows ?? [];
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.column_name, row.data_type);
  return map;
}

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 AS one FROM information_schema.tables WHERE table_name = ${table}`,
  );
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}

async function constraintDef(name: string): Promise<string | undefined> {
  const result = await db.execute(
    sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`,
  );
  const rows = (result as unknown as { rows?: Array<{ def: string }> }).rows ?? [];
  return rows[0]?.def;
}

/** The exact lazy DDL pg-leader-lease.ts issues (97-F1) — verbatim source. */
const LAZY_LEASE_DDL = `
CREATE TABLE IF NOT EXISTS scheduler_leader_lease (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  holder text NOT NULL,
  expires_at timestamptz NOT NULL
)`;

/** The exact lazy DDL account-link-consent.ts issues (97-F2) — verbatim source. */
const LAZY_CONSENT_DDL = `
CREATE TABLE IF NOT EXISTS account_link_consents (
  token text PRIMARY KEY,
  candidate_user_id integer NOT NULL,
  firebase_uid_hash text NOT NULL,
  expires_at timestamptz NOT NULL
)`;

describe("V1-M14 applySchedulerLeaseAndConsentTablesStage — catalog shape (pinned to the lazy DDL)", () => {
  it("creates scheduler_leader_lease with exactly id/holder/expires_at, pinned types", async () => {
    await applySchedulerLeaseAndConsentTablesStage();

    expect(await tableExists("scheduler_leader_lease")).toBe(true);
    const cols = await columnsOf("scheduler_leader_lease");
    expect([...cols.keys()].sort()).toEqual(["expires_at", "holder", "id"]);
    expect(cols.get("id")).toBe("integer");
    expect(cols.get("holder")).toBe("text");
    expect(cols.get("expires_at")).toBe("timestamp with time zone");
  });

  it("scheduler_leader_lease: id is PK with DEFAULT 1 and CHECK (id = 1) — single-row invariant", async () => {
    await applySchedulerLeaseAndConsentTablesStage();

    // DEFAULT 1 — the lease INSERT never names id.
    const defaults = await db.execute(sql`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'scheduler_leader_lease' AND column_name = 'id'
    `);
    const defRows =
      (defaults as unknown as { rows?: Array<{ column_default: string | null }> }).rows ?? [];
    expect(defRows[0]?.column_default).toBe("1");

    expect(await constraintDef("scheduler_leader_lease_pkey")).toBe("PRIMARY KEY (id)");

    // The CHECK mirror: a second row (id = 2) must be rejected by the
    // constraint the lazy DDL also carries.
    let checkViolation: unknown;
    try {
      await db.execute(
        sql`INSERT INTO scheduler_leader_lease (id, holder, expires_at) VALUES (2, 'rogue', now())`,
      );
    } catch (err) {
      checkViolation = err;
    }
    expect(checkViolation).toBeDefined();

    // The lease row itself resolves through the drizzle object (registry
    // parity) — insert omits id entirely (DEFAULT 1 carries it).
    await db
      .insert(schedulerLeaderLeaseTable)
      .values({ holder: "host-a:1", expiresAt: new Date(Date.now() + 60_000) });
    const leaseRows = await db.select().from(schedulerLeaderLeaseTable);
    expect(leaseRows).toHaveLength(1);
    expect(leaseRows[0].id).toBe(1);
    expect(leaseRows[0].holder).toBe("host-a:1");
  });

  it("creates account_link_consents with exactly token/candidate_user_id/firebase_uid_hash/expires_at", async () => {
    await applySchedulerLeaseAndConsentTablesStage();

    expect(await tableExists("account_link_consents")).toBe(true);
    const cols = await columnsOf("account_link_consents");
    expect([...cols.keys()].sort()).toEqual([
      "candidate_user_id",
      "expires_at",
      "firebase_uid_hash",
      "token",
    ]);
    expect(cols.get("token")).toBe("text");
    expect(cols.get("candidate_user_id")).toBe("integer");
    expect(cols.get("firebase_uid_hash")).toBe("text");
    expect(cols.get("expires_at")).toBe("timestamp with time zone");

    expect(await constraintDef("account_link_consents_pkey")).toBe("PRIMARY KEY (token)");
  });

  it("account_link_consents: token PK rejects a duplicate row (one-shot issuance contract)", async () => {
    await applySchedulerLeaseAndConsentTablesStage();

    await db.insert(accountLinkConsentsTable).values({
      token: "a".repeat(64),
      candidateUserId: 7,
      firebaseUidHash: "deadbeef",
      expiresAt: new Date(Date.now() + 300_000),
    });
    await expect(
      db.insert(accountLinkConsentsTable).values({
        token: "a".repeat(64),
        candidateUserId: 8,
        firebaseUidHash: "other",
        expiresAt: new Date(Date.now() + 300_000),
      }),
    ).rejects.toBeDefined();
  });
});

describe("V1-M14 — coexistence with the already-deployed lazy bootstrap", () => {
  it("is a no-op when scheduler_leader_lease was already created by pg-leader-lease.ts", async () => {
    // 97-F1's lazy path may already have created the table in production
    // before this migration ever boots — the stage must not disturb it.
    await db.execute(sql.raw(LAZY_LEASE_DDL));
    await db.execute(
      sql`INSERT INTO scheduler_leader_lease (id, holder, expires_at) VALUES (1, 'live-holder', now() + interval '60 seconds')`,
    );

    await applySchedulerLeaseAndConsentTablesStage();

    const rows = await db.select().from(schedulerLeaderLeaseTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].holder).toBe("live-holder");
  });

  it("is a no-op when account_link_consents was already created by account-link-consent.ts", async () => {
    await db.execute(sql.raw(LAZY_CONSENT_DDL));
    await db.execute(
      sql`INSERT INTO account_link_consents (token, candidate_user_id, firebase_uid_hash, expires_at)
          VALUES ('tok-live', 9, 'cafe', now() + interval '300 seconds')`,
    );

    await applySchedulerLeaseAndConsentTablesStage();

    const rows = await db.select().from(accountLinkConsentsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].candidateUserId).toBe(9);
  });
});

describe("V1-M14 — idempotent re-runs", () => {
  it("applying the stage twice keeps exactly the two tables and their rows intact", async () => {
    await applySchedulerLeaseAndConsentTablesStage();
    await db.insert(schedulerLeaderLeaseTable).values({
      holder: "stable-holder",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(accountLinkConsentsTable).values({
      token: "stable-token",
      candidateUserId: 3,
      firebaseUidHash: "abc",
      expiresAt: new Date(Date.now() + 300_000),
    });

    await applySchedulerLeaseAndConsentTablesStage(); // re-run must be a no-op

    expect((await db.select().from(schedulerLeaderLeaseTable)).map((r) => r.holder)).toEqual([
      "stable-holder",
    ]);
    expect((await db.select().from(accountLinkConsentsTable)).map((r) => r.token)).toEqual([
      "stable-token",
    ]);
  });

  it("re-runs issue no DDL-class statements (recording executor)", async () => {
    await applySchedulerLeaseAndConsentTablesStage();

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
    await applySchedulerLeaseAndConsentTablesStage(recording);

    // Steady state: only the two DO-block existence probes (catalog reads
    // — the CREATE TABLE inside the IF never fires). No bare CREATE TABLE
    // or ALTER/DROP statements are issued against the live schema.
    expect(statements.some((s) => /^\s*CREATE TABLE/i.test(s))).toBe(false);
    expect(statements.some((s) => /^\s*(ALTER TABLE|DROP)/i.test(s))).toBe(false);
    expect(statements.some((s) => s.includes("scheduler_leader_lease"))).toBe(true);
    expect(statements.some((s) => s.includes("account_link_consents"))).toBe(true);
  });

  it("running the full runMigrations stage sequence twice leaves both tables usable (boot idempotency)", async () => {
    // The stage is invoked from runMigrations at every boot — simulate two
    // consecutive boots at stage granularity (runMigrations itself touches
    // many unrelated tables; the stage boundary is the unit under test).
    await applySchedulerLeaseAndConsentTablesStage();
    await applyTicketRepliesDriftClosureStage(); // sibling 97-F7 stage order
    await applySchedulerLeaseAndConsentTablesStage();

    await db.insert(schedulerLeaderLeaseTable).values({
      holder: "boot-2",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const rows = await db.select().from(schedulerLeaderLeaseTable);
    expect(rows).toHaveLength(1);
  });
});
