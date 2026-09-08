/**
 * F5 (round-94 A4) — createApprovedTopup (automated-gateway entry point)
 * gets the guard battery approve() always had.
 *
 * Previously the signature was trusted as-is: no finiteness/bounds, no
 * required reference, no advisory lock, no in-tx duplicate check, no
 * 23505 mapping. `amount=-50` → wallet DEBIT mislabeled topup;
 * `Infinity` → raw 500 from numeric; a gateway retry on the same
 * reference → unclassified 23505 → 500 → retry storm.
 *
 * Under test:
 *   - invalid amounts (≤0, >5000, non-finite) → 400 BEFORE any DB write;
 *   - missing/blank reference → 400;
 *   - sequential same-reference replay → stable 409, wallet credited once;
 *   - TRUE 23505 (in-tx writer claims the reference between the duplicate
 *     check and the insert, via the tx-interleave harness) → mapped to
 *     the same stable 409, full rollback — never a raw 500;
 *   - happy path keeps working end-to-end (credit + ledger + topup row).
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
});
beforeEach(async () => {
  await resetTestDb();
});

async function makeUser(balance = "0.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: balance })
    .returning();
  return u;
}

describe("F5: createApprovedTopup input guards (fail before any DB write)", () => {
  it.each([
    ["negative", -50],
    ["zero", 0],
    ["above the 5000 cap", 5000.01],
    ["Infinity", Infinity],
    ["NaN", NaN],
  ])("amount %s → ServiceError 400, zero rows written", async (_label, amount) => {
    const user = await makeUser("10.00");

    await expect(
      TopupService.createApprovedTopup(user.id, amount as number, "test-gw", "ref-a"),
    ).rejects.toMatchObject({ statusCode: 400 });

    // Nothing moved: no topup row, no ledger row, balance untouched.
    expect(await db.select().from(walletTopupsTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(10);
  });

  it.each([
    ["missing", ""],
    ["blank", "   "],
  ])("%s reference → ServiceError 400 (a gateway callback without a reference carries no dedup signal)", async (_label, ref) => {
    const user = await makeUser("10.00");

    await expect(
      TopupService.createApprovedTopup(user.id, 25, "test-gw", ref),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await db.select().from(walletTopupsTable)).toHaveLength(0);
  });

  it("amount exactly at the 5000 cap is accepted", async () => {
    const user = await makeUser("0.00");
    const topup = await TopupService.createApprovedTopup(user.id, 5000, "gw", "cap-ref");
    expect(topup.status).toBe("approved");
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(5000);
  });

  it("nonexistent user → 404 (unchanged)", async () => {
    await expect(TopupService.createApprovedTopup(999999, 25, "gw", "ref-x")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("F5: createApprovedTopup duplicate-reference guards", () => {
  it("happy path: credit + ledger + approved topup row, all atomic", async () => {
    const user = await makeUser("10.00");

    const topup = await TopupService.createApprovedTopup(user.id, 25, "test-gw", "GW-REF-1");

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(35);
    expect(topup.status).toBe("approved");
    expect(topup.paymentReference).toBe("GW-REF-1");

    const ledger = await db.select().from(walletLedgerTable);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("topup");
    expect(parseFloat(String(ledger[0].balanceBefore))).toBe(10);
    expect(parseFloat(String(ledger[0].balanceAfter))).toBe(35);
  });

  it("sequential same-reference replay → stable 409, wallet credited exactly once", async () => {
    const user = await makeUser("0.00");

    await TopupService.createApprovedTopup(user.id, 25, "gw", "GW-REF-2");
    await expect(
      TopupService.createApprovedTopup(user.id, 25, "gw", "GW-REF-2"),
    ).rejects.toMatchObject({ statusCode: 409 });

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(25);
    expect(await db.select().from(walletTopupsTable)).toHaveLength(1);
    const ledger = await db.select().from(walletLedgerTable);
    expect(ledger).toHaveLength(1);
  });

  it("TRUE 23505: reference claimed between the in-tx check and the insert → mapped 409 (never a raw 500), full rollback", async () => {
    const user = await makeUser("0.00");

    // The duplicate-check SELECT inside the tx projects exactly {id} on
    // wallet_topups — the same matcher the B2-02 suite uses.
    const isDuplicateCheckSelect = (fields: unknown): boolean =>
      !!fields &&
      typeof fields === "object" &&
      Object.keys(fields as object).length === 1 &&
      "id" in (fields as object);

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isDuplicateCheckSelect,
      // The "concurrent gateway callback": inserts the same reference on
      // this transaction's own session right after the duplicate check
      // resolved empty — the subsequent service INSERT then collides with
      // the unique index exactly as it would in production.
      writer: async (realTx) => {
        await realTx.execute(
          sql`INSERT INTO wallet_topups (user_id, amount, payment_method, payment_reference, status, reviewed_at)
              VALUES (${user.id}, 25, 'automated', 'GW-REF-RACE', 'approved', now())`,
        );
      },
    });

    let err: unknown;
    try {
      err = await TopupService.createApprovedTopup(user.id, 25, "gw", "GW-REF-RACE").catch(
        (e: unknown) => e,
      );
    } finally {
      restore();
    }

    // The 23505 is CLASSIFIED: same stable 409 the sequential path
    // returns — not an unhandled driver error (previously a raw 500
    // that a gateway would retry forever).
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).statusCode).toBe(409);
    expect((err as ServiceError).message).toContain("مرجع الدفع مستخدم مسبقاً");

    // The whole transaction rolled back: no credit, no ledger row.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(0);
    const ledger = await db.select().from(walletLedgerTable);
    expect(ledger.filter((l) => l.type === "topup")).toHaveLength(0);
  });
});
