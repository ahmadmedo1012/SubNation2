/**
 * B2-04 (round-92 audit) — referral +50 double-award under concurrent topup
 * approvals of the same referee.
 *
 * The old referral-credit block in TopupService.approve SELECTed the
 * referral_events row, checked `status === "pending"` in JS, then ran an
 * UNGUARDED `UPDATE ... WHERE referee_id = X` + an atomic
 * `loyaltyPoints + 50` on the referrer. A user with two pending topups
 * approved concurrently (two operators, two Telegram buttons) both passed
 * the SELECT while the event was still 'pending', both ran the unguarded
 * flip, and both ran the increment → +100 points for one referral
 * (50 points = 0.50 LYD at the 100:1 conversion).
 *
 * Fix under test (mirror of admin/referrals.ts): the status-flip UPDATE
 * gains `status='pending'` in its WHERE and the award runs ONLY when the
 * flip returned exactly 1 row — the loser of the race sees 0 flipped rows
 * and skips the increment entirely.
 *
 * The concurrent case is simulated with the tx-proxy harness in
 * ./helpers/tx-interleave: the "other approval" flips the referral event
 * (and awards the referrer +50) on the transaction's own session right
 * after the first approve's referral SELECT resolves — the exact
 * read→write window. Unlike the failing-tx races (B2-01/B2-02), this
 * approve SUCCEEDS (only the award is skipped), so the simulated
 * winner's mutations commit together with it — the assertion is that
 * the referrer ends with +50, not +100.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  referralEventsTable,
  usersTable,
  walletTopupsTable,
} from "../../test/db";
import { TopupService } from "../topup.service";
import { interleaveWriterAfterSelect } from "./helpers/tx-interleave";

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_300_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function makeUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), ...overrides })
    .returning();
  return u;
}

/** Referee with a pending referral event and one pending topup. */
async function seedReferralSetup() {
  const referrer = await makeUser({ walletBalance: "0.00" });
  const referee = await makeUser({
    walletBalance: "0.00",
    referredBy: referrer.id,
    // R115: mark the welcome bonus as already granted so THIS suite stays
    // focused on the referral-credit race mechanics (the referee's wallet
    // ends at exactly the topup amount). The welcome-bonus policy itself
    // (grant-on-first-approved-topup, guarded flip) has its own dedicated
    // tests in referral-welcome-policy.test.ts.
    welcomeBonusGranted: true,
  });
  const [event] = await db
    .insert(referralEventsTable)
    .values({ referrerId: referrer.id, refereeId: referee.id, status: "pending" })
    .returning();
  const [topup] = await db
    .insert(walletTopupsTable)
    .values({
      userId: referee.id,
      amount: "50.00",
      paymentMethod: "mobile_transfer",
      paymentNetwork: "madar",
      status: "pending",
    })
    .returning();
  return { referrer, referee, event, topup };
}

/**
 * The referral SELECT in the approve tx is `tx.select()` (full row, no
 * field projection) — the FIRST no-arg select in the transaction — used
 * to identify it for the interleave hook. (The later referrer lookup is
 * also a no-arg select, but the hook arms once only.)
 */
function isReferralEventsSelect(fields: unknown): boolean {
  return fields === undefined;
}

describe("B2-04: referral status-flip guard in topup approve", () => {
  it("happy path: first topup approval awards the referrer +50 exactly once", async () => {
    const { referrer, topup } = await seedReferralSetup();

    await TopupService.approve(topup.id, null);

    const [r] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
    expect(r.loyaltyPoints).toBe(50);
    const [event] = await db.select().from(referralEventsTable);
    expect(event.status).toBe("credited");
    expect(event.creditedAt).not.toBeNull();
  });

  it("sequential: a second topup approval of the same referee does not award again", async () => {
    const { referrer, referee, topup } = await seedReferralSetup();
    const [topup2] = await db
      .insert(walletTopupsTable)
      .values({
        userId: referee.id,
        amount: "25.00",
        paymentMethod: "mobile_transfer",
        paymentNetwork: "madar",
        status: "pending",
      })
      .returning();

    await TopupService.approve(topup.id, null);
    await TopupService.approve(topup2.id, null); // event already 'credited'

    const [r] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
    expect(r.loyaltyPoints).toBe(50); // NOT 100
  });

  it("concurrent: rival approval flips the event between the SELECT and the UPDATE → this approve skips the award (+50 total, not +100)", async () => {
    const { referrer, referee, topup } = await seedReferralSetup();

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isReferralEventsSelect,
      // The "other operator's" approval of the referee's second pending
      // topup: it flips the event to 'credited' and awards the referrer
      // +50 on this transaction's session, right after our SELECT read
      // the still-'pending' row.
      // pglite rejects multi-statement prepared statements — two executes.
      writer: async (realTx) => {
        await realTx.execute(
          sql`UPDATE referral_events SET status = 'credited', credited_at = now() WHERE referee_id = ${referee.id}`,
        );
        await realTx.execute(
          sql`UPDATE users SET loyalty_points = loyalty_points + 50 WHERE id = ${referrer.id}`,
        );
      },
    });

    try {
      // Approve SUCCEEDS (the topup itself is creditable) — only the
      // referral award must be skipped because the guarded flip matches
      // 0 rows.
      await TopupService.approve(topup.id, null);
    } finally {
      restore();
    }

    const [r] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
    // Exactly ONE award (the simulated concurrent winner, which committed
    // with this tx). Under the old unguarded flip this approve would ALSO
    // have awarded → 100.
    expect(r.loyaltyPoints).toBe(50);

    const [event] = await db.select().from(referralEventsTable);
    expect(event.status).toBe("credited");
    expect(event.creditedAt).not.toBeNull();
  });

  it("concurrent race does not disturb the wallet credit itself (topup still approved, ledger intact)", async () => {
    const { referrer, referee, topup } = await seedReferralSetup();

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isReferralEventsSelect,
      // pglite rejects multi-statement prepared statements — two executes.
      writer: async (realTx) => {
        await realTx.execute(
          sql`UPDATE referral_events SET status = 'credited', credited_at = now() WHERE referee_id = ${referee.id}`,
        );
        await realTx.execute(
          sql`UPDATE users SET loyalty_points = loyalty_points + 50 WHERE id = ${referrer.id}`,
        );
      },
    });
    try {
      await TopupService.approve(topup.id, null);
    } finally {
      restore();
    }

    const [refereeRow] = await db.select().from(usersTable).where(eq(usersTable.id, referee.id));
    expect(parseFloat(String(refereeRow.walletBalance))).toBe(50);
    const [t] = await db.select().from(walletTopupsTable).where(eq(walletTopupsTable.id, topup.id));
    expect(t.status).toBe("approved");
    const [r] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
    expect(r.loyaltyPoints).toBe(50);
  });
});
