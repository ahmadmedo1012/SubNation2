import express from "express";
import cookieParser from "cookie-parser";
import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import {
  db,
  execTestSql,
  initTestDb,
  resetTestDb,
  usersTable,
  ordersTable,
  walletTopupsTable,
  idempotencyKeysTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { __resetIdempotencyTableProbeForTests, claimIdempotencyKey } from "../../lib/idempotency";
import { applyIdempotencyDropOrderFkStage } from "../../migrate";
import { walletRouter } from "../wallet";

/**
 * R108 (final-hardening FH-A7 P0) — durable topup-create idempotency on
 * the POST-V1-M20 table shape.
 *
 * R104 added the in-tx `idempotency_keys` claim to POST /api/wallet/topups,
 * claiming with the WALLET_TOPUPS id — but V1-M12 had created
 * `order_id INTEGER REFERENCES orders(id)`, so every claim whose topup id
 * had no matching orders row died as SQLSTATE 23503 and rolled back the
 * whole submission (HTTP 500 on the customer's first money action). The
 * test suite never caught it because no wallet test created the table
 * (the 42P01 latch no-ops the claim). V1-M20 drops the FK — order_id is
 * a reference_type-discriminated polymorphic column with app-owned
 * integrity.
 *
 * Pins (FH-A7 P0 fix item 3):
 *   (a) same-key retry after a committed "lost response" (NO Redis mock —
 *       the production/target shape where the middleware is a pass-through)
 *       replays the ONE pending row (200 + Idempotent-Replayed envelope);
 *   (b) THE FK REGRESSION: a topup id that does NOT exist as an orders row
 *       must claim cleanly — the exact case that 500'd before V1-M20;
 *   (c) the V1-M20 stage itself: pre-fix FK shape → 23503 on a non-orders
 *       claim → stage drops ANY FK on the column (name-independent probe)
 *       → the same claim succeeds; re-runs are no-ops.
 */

// The POST-fix (V1-M20) shape: orders-idempotency-route.test.ts's DDL with
// the REFERENCES clause stripped — order_id is a plain integer column now.
const IDEMPOTENCY_DDL_POST_FIX = `
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  order_id integer,
  reference_type varchar(32) NOT NULL DEFAULT 'order',
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

// The PRE-fix (V1-M12 + V1-M19) shape: the FK that broke the topup claim.
const IDEMPOTENCY_DDL_PRE_FIX = `
DROP TABLE IF EXISTS idempotency_keys;
CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  order_id integer REFERENCES orders(id) ON DELETE CASCADE,
  reference_type varchar(32) NOT NULL DEFAULT 'order',
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/wallet", walletRouter);
  return app;
}

const app = buildApp();

let phoneSeq = 91_970_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser() {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "0.00" })
    .returning();
  return u;
}

function topupBody() {
  return {
    amount: 50,
    payment_method: "mobile_transfer",
    payment_network: "madar",
    sender_phone: "0913456789",
  };
}

async function postTopup(
  token: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}/api/wallet/topups`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${token}`,
            ...headers,
          },
          body: JSON.stringify(topupBody()),
        });
        const text = await res.text();
        resolve({ status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

async function pendingRowCount(userId: number): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(walletTopupsTable)
    .where(eq(walletTopupsTable.userId, userId));
  return Number(row?.c ?? 0);
}

async function orderCount(): Promise<number> {
  const [row] = await db.select({ c: count() }).from(ordersTable);
  return Number(row?.c ?? 0);
}

/** FK constraints currently declared on idempotency_keys.order_id. */
async function orderIdForeignKeys(): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute a
      ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid = 'idempotency_keys'::regclass
      AND a.attname = 'order_id'
  `);
  const rows = (res as unknown as { rows?: Array<{ conname: string }> }).rows ?? [];
  return rows.map((r) => r.conname);
}

/** Two-level SQLSTATE unwrap — drizzle wraps the driver error on .cause. */
function pgCode(err: unknown): string | undefined {
  const wrapper = err as { code?: string; cause?: { code?: string } } | null;
  return wrapper?.code ?? wrapper?.cause?.code;
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(IDEMPOTENCY_DDL_POST_FIX);
  __resetIdempotencyTableProbeForTests();
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE idempotency_keys"));
  // The probe latches per boot; re-arm after the (re)created table.
  __resetIdempotencyTableProbeForTests();
});

describe("R108 — durable topup-create idempotency on the V1-M20 shape", () => {
  it("(a) same-key retry after a lost response replays the ONE pending row (no Redis)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const key = { "Idempotency-Key": "topup durable key 0001" };

    // First submission commits (topup + in-tx durable claim). No Redis is
    // mocked — REDIS_URL is unset, exactly the production/target shape
    // where the HTTP middleware is a pass-through and the durable layer
    // is the only dedup.
    const first = await postTopup(token, key);
    expect(first.status).toBe(201);
    const firstId = first.body.id;

    // The response was "lost" (client retry, same key): the durable claim
    // must replay the original pending row — same contract as checkout.
    const retry = await postTopup(token, key);
    expect(retry.status).toBe(200); // replayed, not re-created
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(retry.body.id).toBe(firstId);

    expect(await pendingRowCount(user.id)).toBe(1);
  });

  it("(b) THE FK REGRESSION — a topup id with NO matching orders row claims cleanly (pre-V1-M20 this 500'd)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    // The whole point of the regression: after TRUNCATE ... RESTART
    // IDENTITY the topup serial starts at 1 while orders is EMPTY — the
    // claimed id cannot exist as an order. Before V1-M20 the in-tx claim
    // hit SQLSTATE 23503 (idempotency_keys_order_id_fkey) and rolled the
    // entire submission back → HTTP 500.
    expect(await orderCount()).toBe(0);

    const res = await postTopup(token, { "Idempotency-Key": "topup fk regression 1" });
    expect(res.status).toBe(201);

    // The claim committed WITH the topup row: wallet_topups.id stored in
    // the polymorphic order_id column, discriminated by reference_type.
    const [claim] = await db.select().from(idempotencyKeysTable);
    expect(claim.orderId).toBe(res.body.id);
    expect(claim.referenceType).toBe("topup.create");
    // And the id genuinely does not exist as an orders row — the case the
    // old FK forbade.
    expect(await orderCount()).toBe(0);
  });
});

describe("R108 — V1-M20 applyIdempotencyDropOrderFkStage (the migration that fixes the FK)", () => {
  it("drops the V1-M12 FK by probe (any name), unlocking non-orders claims; re-runs are no-ops", async () => {
    // Rebuild the PRE-fix shape (the live table carries the FK today).
    await execTestSql(IDEMPOTENCY_DDL_PRE_FIX);
    __resetIdempotencyTableProbeForTests();
    expect((await orderIdForeignKeys()).length).toBeGreaterThan(0);

    // The exact production failure: claiming a wallet_topups id that has
    // no orders row → 23503 → (in the route) whole-tx rollback → 500.
    let fkViolation: unknown;
    try {
      await claimIdempotencyKey(db, "u1:pre-fix-claim-1", 4242, "topup.create");
    } catch (err) {
      fkViolation = err;
    }
    expect(pgCode(fkViolation)).toBe("23503");

    // The stage: DROP CONSTRAINT IF EXISTS + a DO-block probe that drops
    // ANY remaining FK on order_id regardless of name.
    await applyIdempotencyDropOrderFkStage();
    expect(await orderIdForeignKeys()).toEqual([]);

    // The same claim now succeeds — this is the first-post-migration-topup
    // guarantee.
    await expect(
      claimIdempotencyKey(db, "u1:post-fix-claim-1", 4242, "topup.create"),
    ).resolves.toBeUndefined();

    // Idempotent re-run (boot reconcile re-executes every stage).
    await expect(applyIdempotencyDropOrderFkStage()).resolves.toBeUndefined();
    expect(await orderIdForeignKeys()).toEqual([]);

    // Restore the POST-fix shape for the suites above (beforeEach only
    // truncates, it does not re-create).
    await execTestSql(`
      DROP TABLE IF EXISTS idempotency_keys;
      CREATE TABLE idempotency_keys (
        key text PRIMARY KEY,
        order_id integer,
        reference_type varchar(32) NOT NULL DEFAULT 'order',
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    __resetIdempotencyTableProbeForTests();
  });
});
