/**
 * R151 — WhatsApp find-or-create double-submit race (F6-sibling).
 *
 * F6 (round-94 A4) closed the SAME-OTP-row double-consume race with a
 * compare-and-set. But a DIFFERENT race survived: one phone can hold TWO
 * live, unconsumed OTP rows (two `start` requests — 60 s cooldown, 5 min
 * TTL, so both codes are live). Two concurrent verifies with two DIFFERENT
 * valid codes each consume their OWN row (different ids → both pass the
 * F6 `isNull(consumedAt)` guard), then both call findOrCreateWhatsAppUser
 * for the same NEW phone. Both miss the existing-user SELECT, both INSERT
 * → the loser's `users.phone` UNIQUE tripped as an unclassified 23505 →
 * raw 500 on a registration that actually SUCCEEDED (the winner's INSERT
 * committed the account).
 *
 * The Firebase (R146-F3) and Telegram channels already catch the 23505 and
 * re-read the winner's row. This test pins the SAME parity for WhatsApp.
 *
 * Race simulation: the same statement-level interleave technique as the
 * F6 test, targeted at findOrCreateWhatsAppUser's existing-user SELECT
 * (the 2nd `db.select()` in the verifyOtp flow) — its rows deliver only
 * AFTER the "concurrent winner's" user INSERT commits on the session.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, whatsappOtpsTable } from "../../test/db";
import { verifyOtp, getServerSecret } from "../whatsapp-otp.service";
import { hashOtp } from "../../lib/whatsapp-otp";

const SECRET = getServerSecret();
const CODE = "482617";

/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle builder
   internals are intentionally opaque (same caveat as the F6 /
   firebase-auth-double-submit harnesses this mirrors). */

/**
 * Wrap `db.select` so the Nth matching SELECT delivers its rows only
 * AFTER `writer()` ran on the real session — simulating a concurrent
 * committed writer landing inside the read→write window. `matchSelectFields`
 * identifies which selects count toward the Nth-fire; here we count the
 * unprojected `db.select()` calls (both the OTP row read and the users
 * existing-user check) and fire on the 2nd (the users check).
 */
function interleaveAfterNthDbSelect(
  matchSelectFields: (fields: unknown) => boolean,
  fireOnNth: number,
  writer: () => Promise<void>,
): () => void {
  const original = db.select.bind(db);
  let seen = 0;
  const spy = vi.spyOn(db, "select").mockImplementation((...args: unknown[]) => {
    const builder = original(...(args as [any]));
    if (matchSelectFields(args[0])) {
      seen += 1;
      if (seen === fireOnNth) {
        return wrapThenable(builder, writer);
      }
    }
    return builder;
  });
  return () => spy.mockRestore();
}

function wrapThenable(builder: any, runWriter: () => Promise<void>): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === "then") {
        return (onFulfilled?: (rows: unknown) => unknown, onRejected?: (err: unknown) => unknown) =>
          target.then(async (rows: unknown) => {
            await runWriter();
            return onFulfilled ? onFulfilled(rows) : rows;
          }, onRejected);
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (result !== null && typeof result === "object") {
          return wrapThenable(result, runWriter);
        }
        return result;
      };
    },
  });
}

/** Both the OTP-row read and the users existing-user check are unprojected
 * `db.select()` calls (args[0] === undefined). The 2nd one in the verifyOtp
 * flow is findOrCreateWhatsAppUser's existing-user lookup. */
function isUnprojectedSelect(fields: unknown): boolean {
  return fields === undefined;
}

beforeAll(async () => {
  await initTestDb();
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
  await db.execute(sql`TRUNCATE TABLE whatsapp_otps RESTART IDENTITY CASCADE`);
  await resetTestDb();
});

let phoneSeq = 914_700_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedOtp(phone: string) {
  const [row] = await db
    .insert(whatsappOtpsTable)
    .values({
      phone,
      codeHash: hashOtp(CODE, phone, "registration", SECRET),
      purpose: "registration",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .returning({ id: whatsappOtpsTable.id });
  return row;
}

describe("R151 — WhatsApp find-or-create 23505 parity (sibling of F6)", () => {
  it("loser of the users-INSERT race re-reads the winner's row (no 23505 → 500)", async () => {
    const phone = nextPhone();
    await seedOtp(phone);

    // The concurrent winner: the SAME phone's request commits the user
    // INSERT right after findOrCreateWhatsAppUser's existing-user SELECT
    // read the (still empty) users table — the loser's INSERT then
    // collides on users.phone UNIQUE. The fix catches the 23505 and
    // re-reads the winner's row as a normal isNewUser:false login.
    const restore = interleaveAfterNthDbSelect(isUnprojectedSelect, 2, async () => {
      await db.execute(sql`
        INSERT INTO users (phone, phone_verified, auth_provider, wallet_balance, referral_code, last_auth_at)
        VALUES (${phone}, true, 'whatsapp_phone', '0.00', ${`rc-${phone}`}, now())
      `);
    });

    let result: Awaited<ReturnType<typeof verifyOtp>>;
    try {
      result = await verifyOtp({ rawPhone: phone, code: CODE, purpose: "registration" });
    } finally {
      restore();
    }

    // A normal login on the winner's row — NOT the raw 23505 throw the
    // route's generic error branch used to 500 on.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.isNewUser).toBe(false);
    expect(result.user.phone).toBe(phone);

    // Exactly ONE user for that phone — the winner's row (the loser's
    // INSERT was caught and re-read instead of creating a duplicate).
    const rows = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
    expect(rows).toHaveLength(1);
  });
});
