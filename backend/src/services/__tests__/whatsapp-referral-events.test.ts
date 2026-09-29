/**
 * F2 (round-94 A4) — WhatsApp referral channel parity.
 *
 * findOrCreateWhatsAppUser granted the referred signup bonus (5 LYD +
 * ledger row) but never inserted the referral_events row that the
 * Telegram (auth-settings.ts) and Firebase (firebase-auth.service.ts)
 * channels insert. TopupService.approve — the sole consumer — requires
 * that row to award the referrer's +50 points on the referee's first
 * topup, so the referral promise silently never paid on the WhatsApp
 * channel (the live Phase-1 channel), while /admin/referrals showed
 * pending: 0 despite user.referredBy being populated.
 *
 * Fix under test: the event row is inserted INSIDE the user-creation
 * transaction (stronger than the sibling channels) — the full chain is
 * exercised end-to-end:
 *
 *   verifyOtp(referralCode) → user + bonus + ledger + referral_event
 *   → TopupService.approve(first topup) → referrer +50 points exactly
 *   once, event 'credited'.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  referralEventsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
  whatsappOtpsTable,
} from "../../test/db";
import { verifyOtp, getServerSecret } from "../whatsapp-otp.service";
import { TopupService } from "../topup.service";
import { hashOtp } from "../../lib/whatsapp-otp";

const SECRET = getServerSecret();
const CODE = "482913";

beforeAll(async () => {
  await initTestDb();
  // The shared harness DDL predates the OTP surface — mirror the real
  // whatsapp_otps schema (shared/db/src/schema/whatsapp_otps.ts).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_otps (
      id serial PRIMARY KEY,
      phone varchar(20) NOT NULL,
      code_hash varchar(64) NOT NULL,
      purpose varchar(32) NOT NULL,
      expires_at timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      consumed_at timestamptz,
      ip_address varchar(45),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
});
beforeEach(async () => {
  // resetTestDb's CASCADE reaches the standard 15 tables; whatsapp_otps
  // hangs off no FK, so wipe it explicitly first.
  await db.execute(sql`TRUNCATE TABLE whatsapp_otps RESTART IDENTITY CASCADE`);
  await resetTestDb();
});

let phoneSeq = 913_100_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

/** A fresh, unconsumed, unexpired OTP row for a new phone. */
async function seedOtp(phone: string) {
  await db.insert(whatsappOtpsTable).values({
    phone,
    codeHash: hashOtp(CODE, phone, "registration", SECRET),
    purpose: "registration",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
}

describe("F2: WhatsApp signup with referral code creates the referral event", () => {
  it("referred WhatsApp signup → relationship recorded, NO instant bonus (R115 policy B: welcome credit lands on first approved topup)", async () => {
    const [referrer] = await db
      .insert(usersTable)
      .values({ phone: nextPhone(), referralCode: "REFWATEST" })
      .returning();
    const phone = nextPhone();
    await seedOtp(phone);

    const result = await verifyOtp({
      rawPhone: phone,
      code: CODE,
      purpose: "registration",
      referralCode: "REFWATEST",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.isNewUser).toBe(true);
    expect(result.user.referredBy).toBe(referrer.id);
    // R115 (policy B): signup grants NOTHING — the 5 LYD welcome credit
    // + the referrer's 50 points both land when the referee's FIRST topup
    // is approved (topup.service.ts, guarded by users.welcome_bonus_granted).
    // This kills the farm vector (instant spendable credit for free
    // accounts) and unifies the channels (Telegram used to get nothing).
    expect(parseFloat(String(result.user.walletBalance))).toBe(0);
    expect(result.user.welcomeBonusGranted).toBe(false);

    // The event row the approve() consumer requires — previously absent
    // on this channel (the F2 bug). Still created at signup, still pending.
    const [event] = await db
      .select()
      .from(referralEventsTable)
      .where(eq(referralEventsTable.refereeId, result.user.id));
    expect(event).toBeDefined();
    expect(event.referrerId).toBe(referrer.id);
    expect(event.status).toBe("pending");

    // No ledger rows at signup — wallet/ledger parity (no balance ⇒ no row).
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, result.user.id));
    expect(ledger).toHaveLength(0);
  });

  it("non-referred WhatsApp signup → no event row, no bonus", async () => {
    const phone = nextPhone();
    await seedOtp(phone);

    const result = await verifyOtp({ rawPhone: phone, code: CODE, purpose: "registration" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.user.referredBy).toBeNull();
    expect(parseFloat(String(result.user.walletBalance))).toBe(0);
    const events = await db.select().from(referralEventsTable);
    expect(events).toHaveLength(0);
  });

  it("unknown referral code → signup succeeds, no event row (soft behavior preserved)", async () => {
    const phone = nextPhone();
    await seedOtp(phone);

    const result = await verifyOtp({
      rawPhone: phone,
      code: CODE,
      purpose: "registration",
      referralCode: "NOPECODE",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.user.referredBy).toBeNull();
    expect(await db.select().from(referralEventsTable)).toHaveLength(0);
  });

  it("END-TO-END: first topup approval awards the referrer +50 points exactly once", async () => {
    const [referrer] = await db
      .insert(usersTable)
      .values({ phone: nextPhone(), referralCode: "REFWATEST" })
      .returning();
    const phone = nextPhone();
    await seedOtp(phone);

    const reg = await verifyOtp({
      rawPhone: phone,
      code: CODE,
      purpose: "registration",
      referralCode: "REFWATEST",
    });
    if (!reg.ok) throw new Error("expected success");
    const refereeId = reg.user.id;

    const [topup] = await db
      .insert(walletTopupsTable)
      .values({
        userId: refereeId,
        amount: "50.00",
        paymentMethod: "mobile_transfer",
        paymentNetwork: "madar",
        status: "pending",
      })
      .returning();

    await TopupService.approve(topup.id, null);

    const [r] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
    expect(r.loyaltyPoints).toBe(50); // the F2 bug: this was 0

    const [event] = await db
      .select()
      .from(referralEventsTable)
      .where(eq(referralEventsTable.refereeId, refereeId));
    expect(event.status).toBe("credited");

    // A second topup approval must not award again (B2-04 guard intact).
    const [topup2] = await db
      .insert(walletTopupsTable)
      .values({
        userId: refereeId,
        amount: "25.00",
        paymentMethod: "mobile_transfer",
        status: "pending",
      })
      .returning();
    await TopupService.approve(topup2.id, null);
    const [r2] = await db.select().from(usersTable).where(eq(usersTable.id, referrer.id));
    expect(r2.loyaltyPoints).toBe(50);
  });
});
