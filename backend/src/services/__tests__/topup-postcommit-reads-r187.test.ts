import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  referralEventsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";
import { TopupService } from "../topup.service";

/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle builder
   internals are intentionally opaque here; the proxy forwards shape (the
   helpers/tx-interleave idiom). */

/**
 * R187 (G-F5) — the three post-commit reads on the topup paths are
 * failure-isolated.
 *
 * The audit: the referrer re-read in approve (topup.service.ts), the user
 * re-read in reject, and the currentUser projection read in
 * createPendingTopup were the only post-tx steps NOT wrapped — a transient
 * DB blip AFTER the money write committed 500'd an already-committed money
 * operation (M16's emission-isolation discipline, missed on the read side).
 *
 * The pin harness (the tx-interleave family): a spy on db.select that,
 * once ARMED at the money write's commit point, turns every subsequent
 * read into a rejecting thenable — the transient post-commit blip.
 *   - approve/create arm on db.transaction's resolution (the commit);
 *   - reject arms on the guarded status-flip update's resolution.
 *
 * Every leg asserts the committed money state SURVIVED the blip: the
 * wallet credit / the pending row / the rejection flip — and the service
 * resolved its success shape instead of throwing.
 */

const BLIP = new Error("post-commit db blip (R187G-F5 pin)");

/** A thenable that rejects on await, however the caller chains it —
 * including through .catch (the create-site guard rides it). */
function blipBuilder(source: any = {}): any {
  return new Proxy(source, {
    get(target, prop) {
      if (prop === "then") {
        return (onFulfilled?: any, onRejected?: any) =>
          Promise.reject(BLIP).then(onFulfilled, onRejected);
      }
      if (prop === "catch") {
        return (onRejected?: any) => Promise.reject(BLIP).catch(onRejected);
      }
      if (prop === "finally") {
        return (onFinally?: any) => Promise.reject(BLIP).finally(onFinally);
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value === "function") {
        return (...args: any[]) => {
          const result = value.apply(target, args);
          return result !== null && typeof result === "object" ? blipBuilder(result) : result;
        };
      }
      return value;
    },
  });
}

/** Wrap a builder so its first await ARMS the blip, then delivers real rows. */
function armBlipOnAwait(builder: any, arm: () => void): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === "then") {
        return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          target.then((rows: unknown) => {
            arm();
            return onFulfilled ? onFulfilled(rows) : rows;
          }, onRejected);
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result !== null && typeof result === "object"
            ? armBlipOnAwait(result, arm)
            : result;
        };
      }
      return value;
    },
  });
}

/** From the money write's commit point on, every db.select rejects. */
function blipSelectsAfterCommit(armOn: "transaction" | "update"): () => void {
  const dbAny = db as any;
  const origSelect = dbAny.select.bind(dbAny);
  const origMutate = dbAny[armOn].bind(dbAny);
  let armed = false;
  const arm = () => {
    armed = true;
  };
  const selSpy = vi
    .spyOn(dbAny, "select")
    .mockImplementation((...args: unknown[]) =>
      armed ? blipBuilder(origSelect(...args)) : origSelect(...args),
    );
  let mutSpy: ReturnType<typeof vi.spyOn>;
  if (armOn === "transaction") {
    mutSpy = vi.spyOn(dbAny, "transaction").mockImplementation((cb: any, cfg?: any) =>
      origMutate(cb, cfg).then((result: unknown) => {
        armed = true;
        return result;
      }),
    );
  } else {
    mutSpy = vi
      .spyOn(dbAny, "update")
      .mockImplementation((...args: unknown[]) => armBlipOnAwait(origMutate(...args), arm));
  }
  return () => {
    selSpy.mockRestore();
    mutSpy.mockRestore();
  };
}

let phoneSeq = 91_400_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function makeUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "0.00", ...overrides })
    .returning();
  return u;
}

/** Referee with a pending referral event and one pending topup (the race-suite fixture). */
async function seedReferralSetup() {
  const referrer = await makeUser();
  const referee = await makeUser({
    referredBy: referrer.id,
    // Keep the leg focused on the referrer re-read (no welcome block).
    welcomeBonusGranted: true,
  });
  await db
    .insert(referralEventsTable)
    .values({ referrerId: referrer.id, refereeId: referee.id, status: "pending" });
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
  return { referrer, referee, topup };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R187 (G-F5) — post-commit reads never fail the committed topup operation", () => {
  it("approve: the referrer re-read blips AFTER the credit tx commits → success + wallet credited + ledger IN", async () => {
    const { referee, topup } = await seedReferralSetup();
    const restore = blipSelectsAfterCommit("transaction");

    try {
      // Pre-fix: the unguarded referrer db.select rejects and approve()
      // throws — a 500 on an ALREADY-COMMITTED money operation.
      const result = await TopupService.approve(topup.id, null);
      expect(result).toMatchObject({ success: true });
    } finally {
      restore();
    }

    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, referee.id));
    expect(parseFloat(String(after.walletBalance))).toBe(50);
    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, topup.id));
    expect(row.status).toBe("approved");
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, referee.id));
    expect(ledger).toHaveLength(1);
  });

  it("reject: the user re-read blips AFTER the guarded flip commits → success + status rejected, nothing credited", async () => {
    const user = await makeUser();
    const [topup] = await db
      .insert(walletTopupsTable)
      .values({
        userId: user.id,
        amount: "75.00",
        paymentMethod: "mobile_transfer",
        paymentNetwork: "madar",
        status: "pending",
      })
      .returning();
    const restore = blipSelectsAfterCommit("update");

    try {
      const result = await TopupService.reject(topup.id, "bad reference");
      expect(result).toMatchObject({ success: true });
    } finally {
      restore();
    }

    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, topup.id));
    expect(row.status).toBe("rejected");
    const [after] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(after.walletBalance))).toBe(0);
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(0);
  });

  it("create: the currentUser projection read blips AFTER the creation tx commits → ok:true + the PENDING row exists", async () => {
    const user = await makeUser();
    const restore = blipSelectsAfterCommit("transaction");

    try {
      const result = await TopupService.createPendingTopup({
        userId: user.id,
        amount: 50,
        paymentMethod: "mobile_transfer",
        paymentNetwork: "madar",
        idempotencyBodyHash: "r187-gf5-pin",
      });
      expect(result.ok).toBe(true);
    } finally {
      restore();
    }

    const pendings = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.userId, user.id));
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.status).toBe("pending");
  });
});
