/**
 * F6 (round-94 A4) — concurrent OTP-consume race (double-submit verify).
 *
 * The consume UPDATE after a successful HMAC verdict was unconditional:
 * `UPDATE whatsapp_otps SET consumed_at = now() WHERE id = row.id`. Two
 * concurrent verifies of the same code both passed the SELECT (row still
 * unconsumed) and both passed HMAC; both then "consumed" the row, and for
 * a NEW phone both entered find-or-create → the loser's INSERT tripped
 * users.phone UNIQUE as an unclassified 23505 → raw 500 on a
 * registration that actually succeeded (double-submit is a common
 * pattern on flaky Libyan mobile networks).
 *
 * Fix under test: the consume is a compare-and-set
 * (`WHERE ... AND consumed_at IS NULL` + rowsAffected check). The race
 * loser gets the SAME stable "consumed" verdict the sequential replay
 * already gets (route: 401 «تم استخدام هذا الرمز بالفعل») — and no
 * user-create attempt happens for the loser.
 *
 * Race simulation: the same statement-level interleave technique as
 * helpers/tx-interleave.ts, applied to the plain `db.select` (verifyOtp
 * does not open a transaction): the wrapped SELECT's rows resolve, THEN
 * the "concurrent winner's" consume commits on the session, THEN the
 * stale rows are delivered to the service — the exact read→write window.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  whatsappOtpsTable,
} from "../../test/db";
import { verifyOtp, getServerSecret } from "../whatsapp-otp.service";
import { hashOtp } from "../../lib/whatsapp-otp";

const SECRET = getServerSecret();
const CODE = "731904";

/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle builder
   internals are intentionally opaque (same caveat as the tx-interleave
   harness this mirrors). */

/**
 * Wrap `db.select` so the first matching SELECT delivers its rows only
 * AFTER `writer()` ran on the real session — simulating a concurrent
 * committed writer landing inside the read→write window.
 */
function interleaveAfterDbSelect(
  matchSelectFields: (fields: unknown) => boolean,
  writer: () => Promise<void>,
): () => void {
  const original = db.select.bind(db);
  const armed = { done: false };
  const spy = vi.spyOn(db, "select").mockImplementation((...args: unknown[]) => {
    const builder = original(...(args as [any]));
    if (!armed.done && matchSelectFields(args[0])) {
      armed.done = true;
      return wrapThenable(builder, writer);
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
          target.then(
            async (rows: unknown) => {
              await runWriter();
              return onFulfilled ? onFulfilled(rows) : rows;
            },
            onRejected,
          );
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

/** verifyOtp's OTP lookup is an unprojected `db.select()` — first one. */
function isOtpSelect(fields: unknown): boolean {
  return fields === undefined;
}

beforeAll(async () => {
  await initTestDb();
  // Mirror of the real whatsapp_otps schema (not in the shared harness DDL).
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

let phoneSeq = 913_200_000;
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

describe("F6: OTP consume is a guarded compare-and-set", () => {
  it("happy path: single verify succeeds and consumes the row", async () => {
    const phone = nextPhone();
    const otp = await seedOtp(phone);

    const result = await verifyOtp({ rawPhone: phone, code: CODE, purpose: "registration" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.isNewUser).toBe(true);

    const [row] = await db.select().from(whatsappOtpsTable).where(eq(whatsappOtpsTable.id, otp.id));
    expect(row.consumedAt).not.toBeNull();
  });

  it("sequential replay: second verify of the same code → no_active_code (pre-existing protection intact)", async () => {
    const phone = nextPhone();
    await seedOtp(phone);

    const first = await verifyOtp({ rawPhone: phone, code: CODE, purpose: "registration" });
    expect(first.ok).toBe(true);

    const second = await verifyOtp({ rawPhone: phone, code: CODE, purpose: "registration" });
    expect(second).toMatchObject({ ok: false, reason: "no_active_code" });
  });

  it("RACE: concurrent winner consumes between our SELECT and our UPDATE → stable 'consumed', no user created, no 500", async () => {
    const phone = nextPhone();
    const otp = await seedOtp(phone);

    const restore = interleaveAfterDbSelect(
      isOtpSelect,
      // The "other request" — the concurrent winner's consume, committing
      // right after our SELECT read the still-unconsumed row.
      async () => {
        await db.execute(
          sql`UPDATE whatsapp_otps SET consumed_at = now() WHERE id = ${otp.id} AND consumed_at IS NULL`,
        );
      },
    );

    let result: Awaited<ReturnType<typeof verifyOtp>>;
    try {
      result = await verifyOtp({ rawPhone: phone, code: CODE, purpose: "registration" });
    } finally {
      restore();
    }

    // The stable verdict — NOT a raw 23505→500 from a second user INSERT.
    expect(result).toMatchObject({ ok: false, reason: "consumed" });

    // The loser never reached find-or-create: exactly zero users for that
    // phone (the winner's user would exist in production; here the
    // simulated winner only consumed, so zero proves the loser skipped
    // user creation entirely).
    const users = await db.select().from(usersTable).where(eq(usersTable.phone, phone));
    expect(users).toHaveLength(0);

    // Row stays consumed (winner's write intact).
    const [row] = await db.select().from(whatsappOtpsTable).where(eq(whatsappOtpsTable.id, otp.id));
    expect(row.consumedAt).not.toBeNull();
  });

  it("guard never trips when nothing races (no false positives on the hot path)", async () => {
    const phone = nextPhone();
    const otp = await seedOtp(phone);

    // A SELECT-matching interleave whose writer is a no-op — proves the
    // compare-and-set itself (1 row matched) lets the verify through.
    const restore = interleaveAfterDbSelect(isOtpSelect, async () => {
      /* concurrent nobody */
    });
    try {
      const result = await verifyOtp({ rawPhone: phone, code: CODE, purpose: "registration" });
      expect(result.ok).toBe(true);
    } finally {
      restore();
    }
    const [row] = await db.select().from(whatsappOtpsTable).where(eq(whatsappOtpsTable.id, otp.id));
    expect(row.consumedAt).not.toBeNull();
  });
});
