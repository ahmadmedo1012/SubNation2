/**
 * B2-02 (round-92 audit) — duplicate payment_reference double-credit.
 *
 * The r4 duplicate-reference guard was a TOCTOU: the SELECT ran BEFORE the
 * approve transaction, and there was no DB unique index on
 * wallet_topups.payment_reference. Two same-reference pending topups
 * approved concurrently (two Telegram buttons tapped at once) both passed
 * the check and both credited the wallet — 2× money for one bank transfer,
 * invisible to the ledger reconstructor (two internally-consistent `topup`
 * rows).
 *
 * Fix under test (three layers):
 *   1. `pg_advisory_xact_lock(hashtextextended(ref))` at tx top —
 *      same-reference approvals serialize.
 *   2. The duplicate SELECT re-runs INSIDE the transaction (sequential
 *      case → clean, specific 409 before any mutation).
 *   3. SQLSTATE 23505 from the partial unique index
 *      `uniq_wallet_topups_payment_reference` (V1-M9, DB-agent owned — the
 *      test DB mirrors the index definition) is mapped to the same 409.
 *
 * The concurrent case is simulated with the tx-proxy harness in
 * ./helpers/tx-interleave: the "other operator's approval" flips topup #1
 * to approved on the transaction's own session right after topup #2's
 * in-tx duplicate check resolves empty — so #2's status-flip UPDATE then
 * collides with the partial unique index exactly as it would in production.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";
import { ServiceError, TopupService } from "../topup.service";
import { interleaveWriterAfterSelect } from "./helpers/tx-interleave";

beforeAll(async () => {
  await initTestDb();
  // Mirror of the V1-M9 production index (DB-agent owned): one approved
  // topup per non-empty payment_reference. TRUNCATE in resetTestDb keeps
  // indexes, so a single beforeAll creation survives every test.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_wallet_topups_payment_reference
      ON wallet_topups (payment_reference)
      WHERE status = 'approved' AND payment_reference IS NOT NULL AND btrim(payment_reference) <> ''
  `);
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_400_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function makeUser(balance = "0.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

async function seedPendingTopup(userId: number, amount: string, paymentReference: string | null) {
  const [t] = await db
    .insert(walletTopupsTable)
    .values({
      userId,
      amount,
      paymentMethod: "mobile_transfer",
      paymentNetwork: "madar",
      paymentReference,
      status: "pending",
    })
    .returning();
  return t;
}

/** The approve tx's duplicate-check SELECT projects exactly {id} on
 * wallet_topups — used to identify it for the interleave hook. */
function isDuplicateCheckSelect(fields: unknown): boolean {
  return (
    !!fields &&
    typeof fields === "object" &&
    Object.keys(fields as object).length === 1 &&
    "id" in (fields as object)
  );
}

describe("B2-02: duplicate payment_reference — sequential case (in-tx check)", () => {
  it("second same-reference approval gets 409; wallet credited exactly once", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup(user.id, "50.00", "BANK-REF-77");
    const t2 = await seedPendingTopup(user.id, "50.00", "BANK-REF-77");

    await TopupService.approve(t1.id, null);
    const [afterFirst] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(afterFirst.walletBalance))).toBe(50);

    await expect(TopupService.approve(t2.id, null)).rejects.toMatchObject({
      statusCode: 409,
    });

    // Exactly one credit, one ledger row, one approved topup.
    const [afterSecond] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(afterSecond.walletBalance))).toBe(50);
    const ledger = await db.select().from(walletLedgerTable);
    expect(ledger.filter((l) => l.type === "topup")).toHaveLength(1);
    const [t2row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, t2.id));
    expect(t2row.status).toBe("pending");
  });

  it("different references both approve (no cross-reference contention)", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup(user.id, "50.00", "BANK-REF-A");
    const t2 = await seedPendingTopup(user.id, "25.00", "BANK-REF-B");

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(after.walletBalance))).toBe(75);
  });

  it("empty/whitespace references carry no dedup signal — both approve", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup(user.id, "50.00", "");
    const t2 = await seedPendingTopup(user.id, "50.00", "   ");

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(after.walletBalance))).toBe(100);
  });
});

describe("B2-02: duplicate payment_reference — concurrent case (unique index 23505 → 409)", () => {
  it("approval landing between the in-tx check and the flip UPDATE trips the unique index → ServiceError 409, no double credit", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup(user.id, "50.00", "BANK-REF-RACE");
    const t2 = await seedPendingTopup(user.id, "50.00", "BANK-REF-RACE");

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isDuplicateCheckSelect,
      // The "other operator's" approval of t1 commits right after t2's
      // duplicate check found nothing — t2's status flip then collides
      // with the partial unique index.
      writer: (realTx) =>
        realTx.execute(
          sql`UPDATE wallet_topups SET status = 'approved', reviewed_at = now() WHERE id = ${t1.id}`,
        ),
    });

    let err: unknown;
    try {
      err = await TopupService.approve(t2.id, null).catch((e: unknown) => e);
    } finally {
      restore();
    }

    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).statusCode).toBe(409);
    expect((err as ServiceError).message).toContain("مرجع الدفع مستخدم مسبقاً");

    // t2's whole transaction rolled back: no credit, no topup ledger row,
    // t2 still pending. (t1's flip was the simulated concurrent writer —
    // it rolls back with the simulated tx here; in production it is the
    // winner's committed approval. The guarantee under test is that t2's
    // credit never lands.)
    const [userAfter] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(userAfter.walletBalance))).toBe(0);
    const ledger = await db.select().from(walletLedgerTable);
    expect(ledger.filter((l) => l.type === "topup")).toHaveLength(0);
    const [t2row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, t2.id));
    expect(t2row.status).toBe("pending");
  });

  it("advisory lock does not deadlock sequential same-user/same-ref approvals", async () => {
    const user = await makeUser("10.00");
    const t1 = await seedPendingTopup(user.id, "5.00", "LOCK-REF-1");
    const t2 = await seedPendingTopup(user.id, "5.00", "LOCK-REF-2");
    const t3 = await seedPendingTopup(user.id, "5.00", "LOCK-REF-1"); // same ref as t1

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);
    await expect(TopupService.approve(t3.id, null)).rejects.toMatchObject({ statusCode: 409 });

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(after.walletBalance))).toBe(20); // 10 + 5 + 5, t3 rejected
  });
});
