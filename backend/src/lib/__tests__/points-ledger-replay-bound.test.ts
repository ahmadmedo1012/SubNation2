import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, initTestDb, resetTestDb, pointsLedgerTable, usersTable } from "../../test/db";
import {
  insertPointsLedgerEntry,
  POINTS_FIFO_REPLAY_BOUND,
  remainingAwardForOrder,
} from "../points-ledger";

/**
 * R122 (A4-P2-6) — the remainingAwardForOrder replay bound.
 *
 * The FIFO replay used to select a user's ENTIRE points_ledger per refund
 * (no LIMIT) — O(lifetime ledger rows) while holding the refund
 * transaction. The order-scoped rewrite the audit floated is NOT
 * semantically safe: pre-award inflows form a FIFO SHIELD that later
 * conversions consume first (skipping them overstates the award's
 * remainder), and a pre-award admin_set breaks attribution just as much
 * as a post-award one. The fix therefore bounds the replay window:
 *   ≤ BOUND rows  → the exact replay, semantics byte-identical;
 *   > BOUND rows  → the pre-existing bounded-cap fallback
 *                   (precise:false, awarded - alreadyRevoked via exact
 *                   order-scoped reads) — never more than the award
 *                   remainder, never other sources' points.
 *
 * The boundary tests seed real BOUND-sized histories against the pglite
 * harness (batched inserts) so the exact threshold — not a scaled-down
 * proxy — is what's pinned.
 */

beforeAll(initTestDb, 60_000);
beforeEach(resetTestDb);

let phoneSeq = 91_500_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function makeUser(): Promise<number> {
  const [u] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
  return u.id;
}

/**
 * Seed `count` append-style filler inflows (positive `correction` rows —
 * the opening-balance class, reference_id NULL so the exactly-once partial
 * unique index stays exempt). Batched: one multi-row INSERT per 1000 rows
 * (pglite handles the batch; the parameter count stays far below the
 * 65535 protocol ceiling).
 */
async function seedFillers(userId: number, count: number, startBalance = 0): Promise<number> {
  let balance = startBalance;
  for (let offset = 0; offset < count; offset += 1000) {
    const batch = Array.from({ length: Math.min(1000, count - offset) }, () => {
      const row = {
        userId,
        type: "correction" as const,
        pointsDelta: 1,
        pointsBefore: balance,
        pointsAfter: balance + 1,
        referenceType: "opening_balance",
        reason: "R122 replay-bound bulk filler",
      };
      balance += 1;
      return row;
    });
    await db.insert(pointsLedgerTable).values(batch);
  }
  return balance;
}

describe("remainingAwardForOrder — R122 (A4-P2-6) replay bound", () => {
  it("below the bound: exact FIFO semantics unchanged (the shield a naive order-scoped rewrite would lose)", async () => {
    const userId = await makeUser();
    const orderId = 4100;

    // Pre-award shield: +100 referral credit older than the award.
    await insertPointsLedgerEntry({
      userId,
      type: "referral_credit",
      pointsDelta: 100,
      pointsBefore: 0,
      pointsAfter: 100,
      referenceId: 900001,
      referenceType: "referral_event",
    });
    // The order's award: +50 on top of the shield.
    await insertPointsLedgerEntry({
      userId,
      type: "purchase_award",
      pointsDelta: 50,
      pointsBefore: 100,
      pointsAfter: 150,
      referenceId: orderId,
      referenceType: "order",
    });
    // A conversion of 120 consumes the 100-point shield FIRST, then 20 of
    // the award — the award remainder is 30, not 0 and not 50.
    await insertPointsLedgerEntry({
      userId,
      type: "conversion_out",
      pointsDelta: -120,
      pointsBefore: 150,
      pointsAfter: 30,
      lydCredited: 1.2,
      referenceId: 900002,
      referenceType: "wallet_ledger",
    });

    const result = await remainingAwardForOrder(userId, orderId);
    expect(result).toEqual({ precise: true, remaining: 30 });
  });

  it("the boundary: BOUND rows stay precise; BOUND + 1 flips to the bounded-cap fallback", async () => {
    const userId = await makeUser();
    const orderId = 4200;

    // BOUND - 1 fillers + the award = exactly POINTS_FIFO_REPLAY_BOUND
    // rows — the largest history the window can still replay exactly.
    const balance = await seedFillers(userId, POINTS_FIFO_REPLAY_BOUND - 1);
    await insertPointsLedgerEntry({
      userId,
      type: "purchase_award",
      pointsDelta: 50,
      pointsBefore: balance,
      pointsAfter: balance + 50,
      referenceId: orderId,
      referenceType: "order",
    });
    expect(await remainingAwardForOrder(userId, orderId)).toEqual({
      precise: true,
      remaining: 50,
    });

    // One more row (a prior refund reversal of this very order) pushes the
    // history past the window: FIFO is no longer provable → the bounded-
    // cap fallback, computed from the exact order-scoped reads
    // (awarded 50 - alreadyRevoked 20 = 30).
    await insertPointsLedgerEntry({
      userId,
      type: "refund_reversal",
      pointsDelta: -20,
      pointsBefore: balance + 50,
      pointsAfter: balance + 30,
      referenceId: orderId,
      referenceType: "order",
    });
    expect(await remainingAwardForOrder(userId, orderId)).toEqual({
      precise: false,
      remaining: 30,
    });

    // Truncated history + an order with NO award row → the no-award
    // fallback (the caller's legacy frozen formula), never a phantom
    // remainder from the filler window.
    expect(await remainingAwardForOrder(userId, 999_999)).toEqual({
      precise: false,
      remaining: 0,
    });
  });
});
