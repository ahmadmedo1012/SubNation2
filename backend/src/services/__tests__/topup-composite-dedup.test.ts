/**
 * F-03 (round-93 A2 §"Duplicate-transfer double-credit") — composite
 * soft-dedup on topup approval.
 *
 * The exact-reference guards (B2-02 + the V1-M9 partial unique index) are
 * blind when the SAME transfer is resubmitted with different/typo'd
 * references: MAX_PENDING=3 permits three pending submissions, the Telegram
 * operator group gets one approval card per submission, and each ✅ credits
 * the wallet once — 3× money for one real transfer.
 *
 * Fix under test (TopupService.approve, inside the approve tx, before any
 * mutation): when the topup being approved carries BOTH a reference and a
 * sender phone, an already-approved sibling with the same
 * (user, amount, network, sender_phone) profile within 24h → 409
 * DUPLICATE_PAYMENT_REFERENCE (Arabic message + sibling ids for the
 * operator). Conservative by design:
 *   - ref-less topups never trigger it (legit repeat pattern);
 *   - sender-less topups never trigger it (pinned as legal by the B2-02
 *     suite — "different references both approve");
 *   - same-reference siblings stay the exact check's domain;
 *   - siblings older than 24h are out of window.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";
import { ServiceError, TopupService } from "../topup.service";

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_900_000;
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

interface SeedTopup {
  userId: number;
  amount: string;
  paymentReference: string | null;
  senderPhone?: string | null;
  paymentNetwork?: string | null;
  createdAt?: Date;
}

async function seedPendingTopup(seed: SeedTopup) {
  const [t] = await db
    .insert(walletTopupsTable)
    .values({
      userId: seed.userId,
      amount: seed.amount,
      paymentMethod: "mobile_transfer",
      paymentNetwork: seed.paymentNetwork ?? "madar",
      senderPhone: seed.senderPhone ?? null,
      paymentReference: seed.paymentReference,
      status: "pending",
      // The composite window is 24h on created_at — tests that need an
      // out-of-window sibling set this explicitly.
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    })
    .returning();
  return t;
}

describe("F-03: composite soft-dedup on approve (different refs, same transfer profile)", () => {
  it("second approval of the same (amount, network, sender) profile with a different ref → 409 DUPLICATE_PAYMENT_REFERENCE", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "TRX-1111",
      senderPhone: "0912345678",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "TRX-1112", // typo'd/different ref, same transfer
      senderPhone: "0912345678",
    });

    await TopupService.approve(t1.id, null);

    let err: unknown;
    try {
      await TopupService.approve(t2.id, null);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ServiceError);
    const se = err as ServiceError;
    expect(se.statusCode).toBe(409);
    // The clear Arabic error code from the fix spec, riding the message.
    expect(se.message).toContain("DUPLICATE_PAYMENT_REFERENCE");
    // Sibling ids surface for the operator to compare receipts.
    expect(se.message).toContain(`#${t1.id}`);
    expect(se.code).toBe("DUPLICATE_PAYMENT_REFERENCE");

    // Money state: credited exactly once, t2 untouched and still pending.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger.filter((l) => l.type === "topup")).toHaveLength(1);
    const [t2row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, t2.id));
    expect(t2row.status).toBe("pending");
  });

  it("does NOT fire when the sibling is outside the 24h window", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "TRX-OLD",
      senderPhone: "0912345678",
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "TRX-NEW",
      senderPhone: "0912345678",
    });

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null); // out of window → allowed

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(200);
  });

  it("conservative scope: sender-less topups with different refs both approve (B2-02 suite behavior preserved)", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "NOSENDER-A",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "NOSENDER-B",
    });

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(200);
  });

  it("conservative scope: ref-less topups never trigger the composite check", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: null,
      senderPhone: "0912345678",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: null,
      senderPhone: "0912345678",
    });

    // A2's empty-ref fallback was deliberately NOT taken (fix-plan
    // decision): ref-less repeat topups are a legitimate pattern.
    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(200);
  });

  it("same-profile sibling with a NULL reference does not trigger it (legacy exempt class)", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: null,
      senderPhone: "0912345678",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "TRX-LATE",
      senderPhone: "0912345678",
    });

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(200);
  });

  it("a different amount with the same sender does not trigger it", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "TRX-AMT-A",
      senderPhone: "0912345678",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "75.00",
      paymentReference: "TRX-AMT-B",
      senderPhone: "0912345678",
    });

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(175);
  });

  it("exact same reference keeps the B2-02 exact-check message (composite is not a replacement)", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "SAME-REF",
      senderPhone: "0912345678",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "100.00",
      paymentReference: "SAME-REF",
      senderPhone: "0912345678",
    });

    await TopupService.approve(t1.id, null);
    await expect(TopupService.approve(t2.id, null)).rejects.toMatchObject({
      statusCode: 409,
    });

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
  });
});
