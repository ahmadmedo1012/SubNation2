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
  paymentMethod?: string;
  senderAccount?: string | null;
}

async function seedPendingTopup(seed: SeedTopup) {
  const [t] = await db
    .insert(walletTopupsTable)
    .values({
      userId: seed.userId,
      amount: seed.amount,
      paymentMethod: seed.paymentMethod ?? "mobile_transfer",
      paymentNetwork: seed.paymentNetwork ?? "madar",
      senderPhone: seed.senderPhone ?? null,
      senderAccount: seed.senderAccount ?? null,
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
    // A8 F14 (R126): the Arabic message leads with the «رمز تحويل مكرر»
    // prefix — the raw enum stays on the machine-readable code below.
    expect(se.message).toContain("رمز تحويل مكرر");
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

describe("R143 (L7-1): lypay reference-optional soft-dedup on approve (sender_account axis)", () => {
  /**
   * lypay keeps payment_reference optional (gateway receipts are not
   * consistently exposed to users), so the entire reference-keyed battery
   * — advisory lock, in-tx exact check, V1-M9 partial unique, F-03
   * composite — was inert for ref-less lypay pendings: two deliberate
   * submissions (or any keyless client — the Idempotency-Key header is
   * optional) could BOTH be approved, crediting one real transfer twice.
   * The guard under test mirrors F-03 on the sender_account axis (the
   * dimension lypay always collects — required at creation).
   */

  it("two ref-less lypay pendings, same (amount, network, sender_account) → second approve 409 DUPLICATE_LYPAY_TRANSFER, money credited once", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "50.00",
      paymentMethod: "lypay",
      paymentReference: null,
      senderAccount: "LY-ACC-777",
      paymentNetwork: "lypay",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "50.00",
      paymentMethod: "lypay",
      paymentReference: null, // keyless duplicate — the L7-1 window
      senderAccount: "LY-ACC-777",
      paymentNetwork: "lypay",
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
    expect(se.message).toContain("تحويل مكرر");
    expect(se.message).toContain(`#${t1.id}`);
    expect(se.code).toBe("DUPLICATE_LYPAY_TRANSFER");

    // Credited exactly once; the duplicate stays pending for the operator.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
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

  it("different amounts → both approve (legitimate same-day repeat class stays legal)", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "50.00",
      paymentMethod: "lypay",
      paymentReference: null,
      senderAccount: "LY-ACC-888",
      paymentNetwork: "lypay",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "75.00", // genuinely different transfer
      paymentMethod: "lypay",
      paymentReference: null,
      senderAccount: "LY-ACC-888",
      paymentNetwork: "lypay",
    });

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(125);
  });

  it("conservative scope: legacy account-less lypay rows stay exempt", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "50.00",
      paymentMethod: "lypay",
      paymentReference: null,
      senderAccount: null, // pre-L7-1 legacy shape — no dedup signal
      paymentNetwork: "lypay",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "50.00",
      paymentMethod: "lypay",
      paymentReference: null,
      senderAccount: null,
      paymentNetwork: "lypay",
    });

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
  });

  it("the sibling window is 24h — an out-of-window approved sibling does not block", async () => {
    const user = await makeUser("0.00");
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "50.00",
      paymentMethod: "lypay",
      paymentReference: null,
      senderAccount: "LY-ACC-999",
      paymentNetwork: "lypay",
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "50.00",
      paymentMethod: "lypay",
      paymentReference: null,
      senderAccount: "LY-ACC-999",
      paymentNetwork: "lypay",
    });

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null); // out of window → allowed

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
  });

  it("cross-method isolation: a matching mobile_transfer sibling never trips the lypay guard", async () => {
    const user = await makeUser("0.00");
    // Same amount/sender-account STRING, but a mobile_transfer row — the
    // lypay guard only matches lypay siblings (sender_account is a
    // different field from the bank channel's sender_phone identity).
    const t1 = await seedPendingTopup({
      userId: user.id,
      amount: "50.00",
      paymentMethod: "mobile_transfer",
      paymentReference: "TRX-LY-X",
      senderAccount: "LY-ACC-111",
      paymentNetwork: "madar",
    });
    const t2 = await seedPendingTopup({
      userId: user.id,
      amount: "50.00",
      paymentMethod: "lypay",
      paymentReference: null,
      senderAccount: "LY-ACC-111",
      paymentNetwork: "lypay",
    });

    await TopupService.approve(t1.id, null);
    await TopupService.approve(t2.id, null);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
  });
});
