/**
 * R115 welcome-bonus policy B — grant on FIRST APPROVED TOPUP, all channels.
 *
 * Pre-R115 the three channels diverged: Google/WhatsApp credited 5 LYD
 * instantly at signup (farmable — free spendable balance), Telegram was
 * gated behind a phone-verification flag that made the bonus NEVER pay
 * (a broken promise, R115-A2 P1). Policy B unifies them: signup records
 * the relationship and grants NOTHING; the first manually-approved topup
 * grants the referee's 5 LYD wallet credit AND the referrer's 50 points
 * in ONE transaction, guarded exactly-once by users.welcome_bonus_granted
 * (V1-M21 backfills the flag for pre-R115 recipients).
 *
 * This suite exercises the topup side end-to-end (signup paths are covered
 * per-channel by whatsapp-referral-events / telegram-referral-gate /
 * firebase suites).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  pointsLedgerTable,
  referralEventsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";
import { TopupService } from "../topup.service";
import { WELCOME_BONUS_LYD, POINTS_PER_REFERRAL } from "../../lib/loyalty-policy";

let seq = 0;
async function makeUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  seq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9400${String(seq).padStart(5, "0")}`, ...overrides })
    .returning();
  return u;
}

async function seedReferredReferee(opts: { welcomeGranted: boolean }) {
  const referrer = await makeUser({ referralCode: `RWP${String(seq).padStart(4, "0")}` });
  const referee = await makeUser({
    referredBy: referrer.id,
    welcomeBonusGranted: opts.welcomeGranted,
  });
  await db
    .insert(referralEventsTable)
    .values({ referrerId: referrer.id, refereeId: referee.id, status: "pending" })
    .onConflictDoNothing();
  return { referrer, referee };
}

async function seedPendingTopup(userId: number, amount = "50.00") {
  const [t] = await db
    .insert(walletTopupsTable)
    .values({
      userId,
      amount,
      paymentMethod: "mobile_transfer",
      paymentNetwork: "madar",
      status: "pending",
    })
    .returning();
  return t;
}

describe("R115 welcome-bonus policy B — first approved topup grants both sides", () => {
  beforeAll(async () => {
    await initTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it("first approved topup: referee +5 LYD (wallet + ledger) AND referrer +50 pts (balance + points_ledger), flag flips", async () => {
    const { referrer, referee } = await seedReferredReferee({ welcomeGranted: false });
    const topup = await seedPendingTopup(referee.id, "50.00");

    await TopupService.approve(topup.id, null);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, referee.id));
    // topup 50 + welcome 5
    expect(parseFloat(String(after.walletBalance))).toBe(55);
    expect(after.welcomeBonusGranted).toBe(true);

    // wallet ledger: topup row + welcome_bonus row
    const walletRows = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, referee.id));
    expect(walletRows).toHaveLength(2);
    const welcomeRow = walletRows.find((r) => r.referenceType === "welcome_bonus");
    expect(welcomeRow).toBeDefined();
    expect(welcomeRow!.type).toBe("referral_credit");
    expect(parseFloat(String(welcomeRow!.amount))).toBe(WELCOME_BONUS_LYD);
    expect(welcomeRow!.referenceId).toBe(topup.id);

    // referrer: +50 points, attributed
    const [refAfter] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
    expect(refAfter.loyaltyPoints).toBe(POINTS_PER_REFERRAL);
    const refLedger = await db
      .select()
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.userId, referrer.id));
    expect(refLedger).toHaveLength(1);
    expect(refLedger[0].type).toBe("referral_credit");
    expect(refLedger[0].pointsDelta).toBe(POINTS_PER_REFERRAL);
  });

  it("SECOND approved topup: no second welcome bonus (guarded flip), no extra referrer points (event already credited)", async () => {
    const { referrer, referee } = await seedReferredReferee({ welcomeGranted: false });
    const first = await seedPendingTopup(referee.id, "50.00");
    await TopupService.approve(first.id, null);

    const second = await seedPendingTopup(referee.id, "30.00");
    await TopupService.approve(second.id, null);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, referee.id));
    // 50 + 5 + 30 — exactly one welcome bonus
    expect(parseFloat(String(after.walletBalance))).toBe(85);

    const welcomeRows = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, referee.id));
    expect(welcomeRows.filter((r) => r.referenceType === "welcome_bonus")).toHaveLength(1);

    const [refAfter] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
    expect(refAfter.loyaltyPoints).toBe(POINTS_PER_REFERRAL); // still 50, not 100
  });

  it("pre-R115 recipient (flag backfilled true): topup grants the topup ONLY — no double welcome bonus", async () => {
    const { referrer, referee } = await seedReferredReferee({ welcomeGranted: true });
    const topup = await seedPendingTopup(referee.id, "50.00");
    await TopupService.approve(topup.id, null);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, referee.id));
    expect(parseFloat(String(after.walletBalance))).toBe(50); // no +5
    const [refAfter] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
    // The referrer credit is keyed on the referral EVENT flip, which still
    // runs once — the welcome flag and the event flip are independent
    // guards. Referrer still gets their 50 once.
    expect(refAfter.loyaltyPoints).toBe(POINTS_PER_REFERRAL);
  });

  it("non-referred user's topup: no welcome bonus at all", async () => {
    const user = await makeUser();
    const topup = await seedPendingTopup(user.id, "50.00");
    await TopupService.approve(topup.id, null);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(after.walletBalance))).toBe(50);
    expect(after.welcomeBonusGranted).toBe(false);
    const welcomeRows = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(welcomeRows.filter((r) => r.referenceType === "welcome_bonus")).toHaveLength(0);
  });

  it("concurrent approvals of two pending topups: exactly ONE welcome bonus (the guarded flip admits one winner)", async () => {
    const { referee } = await seedReferredReferee({ welcomeGranted: false });
    const a = await seedPendingTopup(referee.id, "50.00");
    const b = await seedPendingTopup(referee.id, "30.00");

    await Promise.allSettled([TopupService.approve(a.id, null), TopupService.approve(b.id, null)]);

    const welcomeRows = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, referee.id));
    expect(welcomeRows.filter((r) => r.referenceType === "welcome_bonus")).toHaveLength(1);

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, referee.id));
    // Both topups credit (distinct rows); the bonus lands exactly once.
    // Settled: either 80+5 or a 409 left one pending — but never two bonuses.
    const balance = parseFloat(String(after.walletBalance));
    expect([85, 55, 35]).toContain(balance);
    expect(after.welcomeBonusGranted).toBe(true);
  });
});
