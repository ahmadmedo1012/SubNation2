import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import express, { type Express } from "express";
import {
  adminUsersTable,
  auditLogsTable,
  db,
  initTestDb,
  pointsLedgerTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminUsersRouter } from "../users";

/**
 * R188-2 (C-F2) — PATCH /api/admin/users/:id post-commit re-read isolation.
 *
 * The 200 body's re-read (users.ts, after the money commits) built the
 * response from a fresh row with ZERO failure isolation — the R187-G-F5
 * class fixed for topup.service/topup-create but missed here. A DB blip on
 * that read 500'd a request whose wallet credit + ledger (or points +
 * points_ledger) had ALREADY committed: the operator re-sends, the
 * idempotency claim answers 409 «already applied», and the money truth is
 * only discoverable in the ledger.
 *
 * Pinned:
 *   - a failing re-read degrades to a 200 built from the ALREADY-KNOWN
 *     walletResult/loyaltyApplied values (warn logged, audit row + stats
 *     emit still fire — the money trail keeps its operator-facing row);
 *   - a SUCCESSFUL re-read that finds no row still answers the honest 404
 *     (the "row was deleted" case — distinct from the degraded 200).
 *
 * Race harness: the users-loyalty-guard recorder idiom — db.select is
 * wrapped, the route's select-ALL re-read on usersTable is identified by
 * shape (no selection fields + .from(usersTable)), and only that call is
 * hijacked; every other select replays the original drizzle chain.
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
        reject(new Error("no address"));
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
      phone: `9471${String(userSeq).padStart(6, "0")}`,
      loyaltyPoints: 100,
      walletBalance: "10.00",
      ...overrides,
    })
    .returning();
  return u.id;
}

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: "admin_reread_r188",
      passwordHash: "x",
      isActive: true,
      permissions: ["all"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function patchUser(
  url: string,
  token: string,
  userId: number,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

// ── The deterministic re-read harness ────────────────────────────────────────

const CHAIN_METHODS = ["from", "where", "limit", "orderBy", "offset", "groupBy", "having"] as const;

const realDbSelect = db.select.bind(db);
const selectSpies: Array<{ mockRestore: () => void }> = [];

/**
 * Wrap db.select so the ROUTE's post-commit re-read (select-all on
 * usersTable — the only field-less usersTable select in the PATCH flow)
 * resolves to `mode`: "fail" rejects (the DB blip), "empty" resolves no
 * rows (the row-deleted case). Any other select replays the original
 * chain, so the wallet/loyalty paths above the re-read run for real.
 */
function hijackPostCommitReRead(mode: "fail" | "empty"): void {
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
    const isReRead = (): boolean => {
      if (hijacked || selection !== undefined) return false;
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
      if (!isReRead()) return real;
      hijacked = true;
      if (mode === "fail") {
        return Promise.reject(new Error("simulated post-commit re-read outage"));
      }
      return Promise.resolve([]);
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

describe("PATCH /api/admin/users/:id — C-F2 post-commit re-read isolation (R188-2)", () => {
  it("wallet: a failing re-read answers 200 from the committed walletResult (no 500 for committed money)", async () => {
    const userId = await seedUser({ walletBalance: "10.00" });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      hijackPostCommitReRead("fail");
      const res = await patchUser(url, token, userId, {
        wallet_adjustment: 10,
        note: "تعديل أثناء انقطاع إعادة القراءة",
      });

      // THE FIX: committed money answers 200 — degraded body from the
      // already-known committed values.
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: userId,
        phone: null,
        wallet_balance: 20,
        loyalty_points: null,
        loyalty_tier: null,
      });

      // DB truth: the adjustment REALLY committed (balance + ledger).
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      expect(String(row.walletBalance)).toBe("20.00");
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, userId));
      expect(ledger).toHaveLength(1);
      expect(ledger[0].type).toBe("adjustment");

      // The operator-facing trail still lands (fire-and-forget — poll).
      await vi.waitFor(async () => {
        expect(
          await db.select().from(auditLogsTable).where(eq(auditLogsTable.action, "user.update")),
        ).toHaveLength(1);
      });
    } finally {
      close();
    }
  });

  it("loyalty: a failing re-read answers 200 from the committed loyaltyApplied values", async () => {
    const userId = await seedUser({ loyaltyPoints: 100 });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      hijackPostCommitReRead("fail");
      const res = await patchUser(url, token, userId, {
        loyalty_points: 200,
        note: "نقاط أثناء انقطاع إعادة القراءة",
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: userId,
        phone: null,
        wallet_balance: null,
        loyalty_points: 200,
        loyalty_tier: null,
      });

      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      expect(row.loyaltyPoints).toBe(200);
      const ledger = await db
        .select()
        .from(pointsLedgerTable)
        .where(eq(pointsLedgerTable.userId, userId));
      expect(ledger).toHaveLength(1);
      expect(ledger[0].type).toBe("admin_set");
    } finally {
      close();
    }
  });

  it("a SUCCESSFUL re-read that finds no row keeps the honest 404 (row deleted — not the degraded 200)", async () => {
    const userId = await seedUser({ walletBalance: "10.00" });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      hijackPostCommitReRead("empty");
      const res = await patchUser(url, token, userId, {
        wallet_adjustment: 10,
        note: "اختفى الصف بعد الالتزام",
      });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: "NOT_FOUND" });
      // The money still committed — the 404 describes the READ, not the tx.
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      expect(String(row.walletBalance)).toBe("20.00");
    } finally {
      close();
    }
  });
});
