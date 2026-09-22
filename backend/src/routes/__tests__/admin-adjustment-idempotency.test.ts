import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import {
  adminUsersTable,
  db,
  execTestSql,
  initTestDb,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { __resetIdempotencyTableProbeForTests } from "../../lib/idempotency";
import { AdjustmentError, AdjustmentService } from "../../services/adjustment.service";
import { adminUsersRouter } from "../admin/users";

/**
 * R108 (final-hardening FH-A7 P1) — durable idempotency for admin wallet
 * adjustments.
 *
 * PATCH /api/admin/users/:id was the ONLY money mutation with no durable
 * idempotency backstop: the Redis middleware is a documented pass-through
 * in the production AND Oracle/Coolify target shape (REDIS_URL
 * intentionally unset), so a retry after a lost response re-applied the
 * `wallet_adjustment` delta (a second ledger row, double credit/debit).
 * R108 closes it with the R102 loyalty pattern:
 *   - route pre-check: an admin-scoped key (`u{adminId}:{clientKey}`)
 *     already claimed by ANY intent → 409 "تم تطبيق هذا التعديل مسبقاً";
 *   - in-tx claim: `claimIdempotencyKey(tx, key, null, "admin.adjustment")`
 *     committed atomically with the wallet write + ledger row — the race
 *     window between the pre-check and the commit maps to a 409 with the
 *     wallet mutation ROLLED BACK, not a double application.
 *
 * Mirrors loyalty-durable-idempotency.test.ts (no Redis mock — the
 * production/target shape) + the users-loyalty-guard admin auth pattern.
 */

// Post-V1-M20 shape (R108): no FK on order_id — admin.adjustment claims
// carry NULL anyway; the shape matches every other durable-idempotency
// suite created after R108.
const IDEMPOTENCY_DDL_POST_FIX = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  order_id integer,
  reference_type varchar(32) NOT NULL DEFAULT 'order',
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminUsersRouter);
  return app;
}

const app = buildApp();

let phoneSeq = 91_980_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(startBalance = "0.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: startBalance })
    .returning();
  return u;
}

async function seedAdmin() {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_adjust", passwordHash: "not-a-real-hash", isActive: true })
    .returning();
  return { adminId: a.id, token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

async function patchAdjust(
  token: string,
  userId: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/admin/users/${userId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...headers,
          },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        resolve({ status: res.status, body: text ? JSON.parse(text) : null });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

async function balanceOf(userId: number): Promise<number> {
  const [row] = await db
    .select({ b: usersTable.walletBalance })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return parseFloat(String(row.b));
}

async function ledgerRowCount(userId: number): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(walletLedgerTable)
    .where(eq(walletLedgerTable.userId, userId));
  return Number(row?.c ?? 0);
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(IDEMPOTENCY_DDL_POST_FIX);
  __resetIdempotencyTableProbeForTests();
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE idempotency_keys"));
  __resetIdempotencyTableProbeForTests();
});

describe("R108 — admin wallet adjustment durable idempotency (route)", () => {
  it("same-key retry after a lost response → 409 + exactly ONE ledger row (delta applied once)", async () => {
    const user = await seedUser();
    const { token } = await seedAdmin();
    const key = { "Idempotency-Key": "adjust retry key 0001" };
    const body = { wallet_adjustment: 10, note: "اختبار إعادة الإرسال" };

    // First save commits: +10, one ledger row, durable key claimed in-tx.
    const first = await patchAdjust(token, user.id, body, key);
    expect(first.status).toBe(200);
    expect(first.body.wallet_balance).toBe(10);
    expect(await balanceOf(user.id)).toBe(10);

    // The retry that motivated the guard: response lost, admin re-clicks,
    // r99 stable-intent key re-sent. No Redis → the middleware is a
    // pass-through; the durable pre-check must answer 409.
    const retry = await patchAdjust(token, user.id, body, key);
    expect(retry.status).toBe(409);
    expect(retry.body.error).toContain("تم تطبيق هذا التعديل مسبقاً");
    expect(retry.body.code).toBe("CONFLICT");

    // THE money pin: the delta was applied exactly once.
    expect(await balanceOf(user.id)).toBe(10);
    expect(await ledgerRowCount(user.id)).toBe(1);
  });

  it("a DIFFERENT key is a fresh intent and applies (real second adjustment)", async () => {
    const user = await seedUser();
    const { token } = await seedAdmin();
    const body = { wallet_adjustment: 10, note: "تعديل ثانٍ حقيقي" };

    const first = await patchAdjust(token, user.id, body, {
      "Idempotency-Key": "adjust fresh key 0001",
    });
    expect(first.status).toBe(200);

    const second = await patchAdjust(token, user.id, body, {
      "Idempotency-Key": "adjust fresh key 0002",
    });
    expect(second.status).toBe(200);
    expect(second.body.wallet_balance).toBe(20);

    expect(await balanceOf(user.id)).toBe(20);
    expect(await ledgerRowCount(user.id)).toBe(2); // two REAL adjustments
  });

  it("keyless retries keep the documented tolerant behavior (the residual the key closes)", async () => {
    const user = await seedUser();
    const { token } = await seedAdmin();
    const body = { wallet_adjustment: 5, note: "بدون مفتاح" };

    const first = await patchAdjust(token, user.id, body);
    expect(first.status).toBe(200);
    // No key → no durable guard (phase-1 tolerant contract, same as the
    // loyalty route): a keyless re-save is a REAL second adjustment. The
    // admin UI's r99 stable-intent keys are what make this unreachable
    // from the dashboard.
    const again = await patchAdjust(token, user.id, body);
    expect(again.status).toBe(200);
    expect(await balanceOf(user.id)).toBe(10);
    expect(await ledgerRowCount(user.id)).toBe(2);
  });
});

describe("R108 — the in-tx claim (AdjustmentService race window, service level)", () => {
  it("a same-key claim colliding INSIDE the transaction rolls the wallet write back with the ledger", async () => {
    const user = await seedUser();
    const { adminId } = await seedAdmin();
    const options = { adminId, note: "خدمة - نفس المفتاح", idempotencyKey: "u1:adjust-svc-key-1" };

    // First call commits the +7 adjustment AND claims the key in-tx.
    const first = await AdjustmentService.adjust(user.id, 7, options);
    expect(first.walletBalance).toBe(7);
    expect(await ledgerRowCount(user.id)).toBe(1);

    // Second call with the same key bypasses the route pre-check (this is
    // the concurrent double-click shape): the wallet UPDATE + ledger
    // insert succeed FIRST, then the claim hits 23505 → AdjustmentError
    // 409 → the WHOLE transaction rolls back. The delta can never land
    // twice even inside the pre-check race window.
    await expect(AdjustmentService.adjust(user.id, 7, options)).rejects.toMatchObject({
      statusCode: 409,
      code: "CONCURRENCY_ERROR",
      message: expect.stringContaining("تم تطبيق هذا التعديل مسبقاً"),
    } satisfies Partial<AdjustmentError>);

    expect(await balanceOf(user.id)).toBe(7); // rolled back, not 14
    expect(await ledgerRowCount(user.id)).toBe(1); // the loser's row died in tx

    // A different key is a fresh service-level intent and applies.
    const second = await AdjustmentService.adjust(user.id, 3, {
      adminId,
      note: "خدمة - مفتاح جديد",
      idempotencyKey: "u1:adjust-svc-key-2",
    });
    expect(second.walletBalance).toBe(10);
    expect(await ledgerRowCount(user.id)).toBe(2);
  });
});
