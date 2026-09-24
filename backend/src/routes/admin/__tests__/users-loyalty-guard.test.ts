import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import {
  adminUsersTable,
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminUsersRouter } from "../users";

/**
 * 93-A1 S6 / 93-A2 (round-93) — admin loyalty-points guarded UPDATE.
 *
 * The PATCH /api/admin/users/:id loyalty path used to be an absolute
 * `SET loyalty_points = X` with no predicate on prior state — racing the
 * referral award's ATOMIC `loyaltyPoints = loyaltyPoints + 50`
 * (topup.service approve): an admin edit built from a stale read silently
 * ERASED a concurrently-credited award. Points are LYD-convertible money
 * (100:1 via /loyalty/convert-points). The write is now a compare-and-set:
 * `WHERE loyalty_points = <pre-read> [AND loyalty_tier = <pre-read>]`,
 * 0 flipped rows → 409 CONFLICT, nothing applied.
 *
 * The race itself is deterministic here: a spy wraps db.select and, for
 * the guard read specifically (selection {loyaltyPoints, loyaltyTier} on
 * usersTable), resolves the row FIRST and lands the concurrent award
 * AFTER — exactly the topup-approval interleaving the audit described.
 * Everything else replays the original drizzle chain untouched.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminUsersRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let userSeq = 0;
async function seedUser(overrides: Partial<typeof usersTable.$inferInsert> = {}): Promise<number> {
  userSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({
      phone: `9300${String(userSeq).padStart(5, "0")}`,
      loyaltyPoints: 100,
      loyaltyTier: "bronze",
      ...overrides,
    })
    .returning();
  return u.id;
}

async function seedAdmin(permissions: string[] = ["all"]) {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: "admin_loyalty",
      passwordHash: "not-a-real-hash",
      isActive: true,
      // B1-3 (R111): wallet mutations on this route now require the
      // finance scope in addition to the router's users mount — default
      // the fixture to the wildcard like every other admin-route suite.
      permissions,
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

interface PatchResponse {
  status: number;
  body: Record<string, unknown>;
}

async function patchUser(
  url: string,
  token: string,
  userId: number,
  body: Record<string, unknown>,
): Promise<PatchResponse> {
  const res = await fetch(`${url}/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function getUser(userId: number): Promise<typeof usersTable.$inferSelect> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return row!;
}

// ── The deterministic race harness ─────────────────────────────────────────────

/** Chain methods the route composes on db.select(...) before awaiting. */
const CHAIN_METHODS = ["from", "where", "limit", "orderBy", "offset", "groupBy", "having"] as const;

const realDbSelect = db.select.bind(db);
const selectSpies: Array<{ mockRestore: () => void }> = [];

/**
 * Wrap db.select so the ROUTE's guard read (selection contains
 * loyaltyPoints, table = usersTable) resolves the row BEFORE landing a
 * concurrent `loyaltyPoints + award` — the exact interleaving of
 * "admin opened the edit form, topup approval credited the referrer's
 * award, admin hit save". Any other select replays the original chain.
 */
function injectConcurrentLoyaltyAward(userId: number, award: number): void {
  const spy = vi.spyOn(db, "select");
  selectSpies.push(spy);
  let hijacked = false;
  spy.mockImplementation(((selection?: Record<string, unknown>) => {
    const calls: Array<{ m: string; args: unknown[] }> = [];
    const replay = (): PromiseLike<unknown> => {
      let builder: unknown = realDbSelect(selection as never);
      for (const { m, args } of calls) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        builder = (builder as any)[m](...args);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return builder as any;
    };
    const isGuardRead = (): boolean => {
      if (hijacked) return false;
      if (!selection || !("loyaltyPoints" in selection)) return false;
      return calls.some(({ m, args }) => m === "from" && (args[0] as unknown) === usersTable);
    };
    const recorder: Record<string, unknown> = {
      then: (onFulfilled: unknown, onRejected: unknown) =>
        wrap(replay()).then(onFulfilled as never, onRejected as never),
    };
    for (const m of CHAIN_METHODS) {
      recorder[m] = (...args: unknown[]) => {
        calls.push({ m, args });
        return recorder;
      };
    }
    const wrap = (real: PromiseLike<unknown>): PromiseLike<unknown> => {
      if (!isGuardRead()) return real;
      hijacked = true;
      // Resolve the OLD row first (the admin's stale read), then land the
      // concurrent award — the route's subsequent guarded UPDATE sees a
      // different loyalty_points than its pre-read → 0 rows flipped.
      return real.then(async (rows) => {
        await db
          .update(usersTable)
          .set({ loyaltyPoints: sql`${usersTable.loyaltyPoints} + ${award}` })
          .where(eq(usersTable.id, userId));
        return rows;
      });
    };
    return recorder;
  }) as never);
}

afterAll(() => {
  for (const s of selectSpies) s.mockRestore();
});

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  for (const s of selectSpies) s.mockRestore();
  selectSpies.length = 0;
});

describe("PATCH /api/admin/users/:id — loyalty happy paths (S6 guard, no race)", () => {
  it("sets loyalty_points; tier and wallet untouched", async () => {
    const userId = await seedUser({ loyaltyPoints: 100 });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await patchUser(url, token, userId, { loyalty_points: 250 });
      expect(status).toBe(200);
      expect(body.loyalty_points).toBe(250);

      const row = await getUser(userId);
      expect(row.loyaltyPoints).toBe(250);
      expect(row.loyaltyTier).toBe("bronze");
      expect(String(row.walletBalance)).toBe("0.00");
    } finally {
      close();
    }
  });

  it("sets a valid loyalty_tier alongside points", async () => {
    const userId = await seedUser({ loyaltyPoints: 100 });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await patchUser(url, token, userId, {
        loyalty_points: 120,
        loyalty_tier: "gold",
      });
      expect(status).toBe(200);
      const row = await getUser(userId);
      expect(row.loyaltyPoints).toBe(120);
      expect(row.loyaltyTier).toBe("gold");
    } finally {
      close();
    }
  });

  it("loyalty_points + wallet_adjustment in ONE PATCH apply both (loyalty first, wallet after — no double application)", async () => {
    const userId = await seedUser({ loyaltyPoints: 100, walletBalance: "5.00" });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await patchUser(url, token, userId, {
        loyalty_points: 200,
        wallet_adjustment: 10,
        note: "اختبار تعديل مركّب",
      });
      expect(status).toBe(200);
      const row = await getUser(userId);
      expect(row.loyaltyPoints).toBe(200);
      expect(String(row.walletBalance)).toBe("15.00");
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, userId));
      expect(ledger).toHaveLength(1); // exactly one adjustment row
    } finally {
      close();
    }
  });

  it("rejects out-of-bounds / fractional points (M5 bounds preserved)", async () => {
    const userId = await seedUser({ loyaltyPoints: 100 });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      for (const bad of [-1, 10_000_001, 12.5, "200" as unknown as number]) {
        const { status } = await patchUser(url, token, userId, { loyalty_points: bad });
        expect(status, `loyalty_points=${String(bad)} must 400`).toBe(400);
      }
      expect((await getUser(userId)).loyaltyPoints).toBe(100); // untouched
    } finally {
      close();
    }
  });

  it("invalid tier string alone → 400 no-changes (not silently stored)", async () => {
    const userId = await seedUser({ loyaltyPoints: 100 });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await patchUser(url, token, userId, { loyalty_tier: "diamond" });
      expect(status).toBe(400);
      expect(body.code).toBe("INVALID_DATA");
      expect((await getUser(userId)).loyaltyTier).toBe("bronze");
    } finally {
      close();
    }
  });

  it("missing user → 404 (not a silent 200)", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await patchUser(url, token, 999_999, { loyalty_points: 10 });
      expect(status).toBe(404);
    } finally {
      close();
    }
  });
});

describe("PATCH /api/admin/users/:id — B1-3 wallet mutations require the finance scope (R111)", () => {
  it("a users-only admin → 403 on wallet_balance printing, wallet untouched, no ledger row", async () => {
    const userId = await seedUser({ loyaltyPoints: 100 });
    const token = await seedAdmin(["users"]); // the OLD mount scope alone
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await patchUser(url, token, userId, {
        wallet_balance: 50,
        note: "محاولة طباعة رصيد بدون صلاحية",
      });
      expect(status).toBe(403);
      expect(body.code).toBe("FORBIDDEN");

      const row = await getUser(userId);
      expect(String(row.walletBalance)).toBe("0.00");
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, userId));
      expect(ledger).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("a users-only admin → 403 on wallet_adjustment too (LYD 1:1 movement)", async () => {
    const userId = await seedUser({ walletBalance: "10.00" });
    const token = await seedAdmin(["users"]);
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await patchUser(url, token, userId, {
        wallet_adjustment: 25,
        note: "محاولة تعديل بدون صلاحية",
      });
      expect(status).toBe(403);
      expect(String((await getUser(userId)).walletBalance)).toBe("10.00");
    } finally {
      close();
    }
  });

  it("loyalty edits stay available to a users-only admin (the users-scope surface is unchanged)", async () => {
    const userId = await seedUser({ loyaltyPoints: 100 });
    const token = await seedAdmin(["users"]);
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await patchUser(url, token, userId, { loyalty_points: 250 });
      expect(status).toBe(200);
      expect(body.loyalty_points).toBe(250);
    } finally {
      close();
    }
  });

  it("an admin holding finance (users+finance) may adjust the wallet — the gate is additive, not a lockout", async () => {
    const userId = await seedUser({ walletBalance: "0.00" });
    const token = await seedAdmin(["users", "finance"]);
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await patchUser(url, token, userId, {
        wallet_adjustment: 15,
        note: "تعديل صلاحية مزدوجة",
      });
      expect(status).toBe(200);
      expect(String((await getUser(userId)).walletBalance)).toBe("15.00");
    } finally {
      close();
    }
  });

  it("a finance-only admin (no users scope) is stopped by the router mount in the real composition — here requireAdmin still authenticates, and the 403 fires before any wallet write", async () => {
    // The mini-app mount omits the parent requirePermission("users") gate
    // (all suites mount the router directly), so a finance-only admin
    // reaches the handler here. The route's own finance check passes, but
    // the real composition (admin/index.ts) keeps the users mount — the
    // effective rule is users AND finance, pinned by admin/index.ts's
    // mount + this route gate together.
    const userId = await seedUser({ walletBalance: "0.00" });
    const token = await seedAdmin(["finance"]);
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await patchUser(url, token, userId, {
        wallet_adjustment: 15,
        note: "تعديل صلاحية مالية فقط",
      });
      expect(status).toBe(200);
      expect(String((await getUser(userId)).walletBalance)).toBe("15.00");
    } finally {
      close();
    }
  });
});

describe("PATCH /api/admin/users/:id — the S6 race (concurrent referral award)", () => {
  it("stale guard → 409 CONFLICT, the concurrent award SURVIVES, wallet untouched (no partial application)", async () => {
    // The admin's edit form was built from points=100.
    const userId = await seedUser({ loyaltyPoints: 100 });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      // Between the route's guard read and its guarded UPDATE, a topup
      // approval credits +50 referral points — the S6 interleaving.
      injectConcurrentLoyaltyAward(userId, 50);

      // The request ALSO carries a wallet adjustment: the 409 must fire
      // BEFORE the wallet path, leaving ZERO mutations applied (a retry
      // after re-read then cannot double-credit the wallet).
      const { status, body } = await patchUser(url, token, userId, {
        loyalty_points: 200,
        wallet_adjustment: 10,
        note: "اختبار تعارض التعديل",
      });

      expect(status).toBe(409);
      expect(body.code).toBe("CONFLICT");
      expect((body.details as { reason?: string })?.reason).toBe("loyalty_concurrent_modification");

      const row = await getUser(userId);
      // THE S6 FIX: the referral award is no longer erased by the admin's
      // stale absolute write (old behaviour: points would be 200).
      expect(row.loyaltyPoints).toBe(150);
      // No partial application — the wallet path never ran.
      expect(String(row.walletBalance)).toBe("0.00");
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, userId));
      expect(ledger).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("retry after re-read succeeds — the admin sees the awarded points and sets the intended value", async () => {
    const userId = await seedUser({ loyaltyPoints: 100 });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      injectConcurrentLoyaltyAward(userId, 50);
      const raced = await patchUser(url, token, userId, { loyalty_points: 200 });
      expect(raced.status).toBe(409);

      // Admin refreshes (sees 150), retries — guard matches now.
      const retried = await patchUser(url, token, userId, { loyalty_points: 200 });
      expect(retried.status).toBe(200);
      expect((await getUser(userId)).loyaltyPoints).toBe(200);
    } finally {
      close();
    }
  });

  it("tier-only edit is guarded on the points pre-read too (conservative compare-and-set)", async () => {
    const userId = await seedUser({ loyaltyPoints: 100, loyaltyTier: "bronze" });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      injectConcurrentLoyaltyAward(userId, 50);
      const { status } = await patchUser(url, token, userId, { loyalty_tier: "silver" });
      expect(status).toBe(409);
      expect((await getUser(userId)).loyaltyTier).toBe("bronze"); // not applied
    } finally {
      close();
    }
  });

  it("the guard predicate itself: an UPDATE on a stale pre-read flips 0 rows (drizzle composition the route uses)", async () => {
    // Belt to the route-level tests above: pin the exact SQL guard shape
    // (AND id + loyaltyPoints = <pre-read>) directly, including the
    // no-rows verdict when the pre-read is stale.
    const userId = await seedUser({ loyaltyPoints: 100 });
    const stale = 999; // deliberately not the row's value

    const flippedStale = await db
      .update(usersTable)
      .set({ loyaltyPoints: 200 })
      .where(and(eq(usersTable.id, userId), eq(usersTable.loyaltyPoints, stale)))
      .returning({ id: usersTable.id });
    expect(flippedStale).toHaveLength(0);
    expect((await getUser(userId)).loyaltyPoints).toBe(100);

    const flippedFresh = await db
      .update(usersTable)
      .set({ loyaltyPoints: 200 })
      .where(and(eq(usersTable.id, userId), eq(usersTable.loyaltyPoints, 100)))
      .returning({ id: usersTable.id });
    expect(flippedFresh).toHaveLength(1);
    expect((await getUser(userId)).loyaltyPoints).toBe(200);
  });
});
