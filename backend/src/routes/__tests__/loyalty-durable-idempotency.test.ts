import express from "express";
import cookieParser from "cookie-parser";
import { sql } from "drizzle-orm";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { db, initTestDb, resetTestDb, usersTable, walletLedgerTable } from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { __resetIdempotencyTableProbeForTests } from "../../lib/idempotency";
import { loyaltyRouter } from "../loyalty";
import { POINTS_PER_LYD } from "../../lib/loyalty-policy";

/**
 * R102 (loyalty durable guard) — convert-points transactional idempotency.
 *
 * The route's Redis middleware is a pass-through during Redis outages, so
 * before R102 a lost response + manual retry in that window double-converted
 * points. The durable backstop (same idempotency_keys table as checkout's
 * F10, claimed inside the conversion transaction with
 * reference_type='loyalty.convert') closes it:
 *   - same key retry → 409, points converted ONCE, single ledger row;
 *   - a DIFFERENT key is a fresh intent and succeeds;
 *   - keyless requests keep the legacy tolerant behavior.
 */

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/loyalty", loyaltyRouter);
  return app;
}

const app = buildApp();

let phoneSeq = 91_900_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUserWithPoints(points: number) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "0.00", loyaltyPoints: points })
    .returning();
  return u;
}

async function call(
  path: string,
  token: string,
  body: unknown,
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
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${token}`,
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

beforeAll(async () => {
  await initTestDb();
  // Mirror of the V1-M12+V1-M19 table shape (nullable order_id +
  // reference_type discriminator).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key text PRIMARY KEY,
      order_id integer REFERENCES orders(id) ON DELETE CASCADE,
      reference_type varchar(32) NOT NULL DEFAULT 'order',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  __resetIdempotencyTableProbeForTests();
});
beforeEach(async () => {
  await resetTestDb();
  __resetIdempotencyTableProbeForTests();
});

describe("R102 — loyalty convert-points durable idempotency", () => {
  it("same-key retry after a lost response converts ONCE (409 + single ledger row)", async () => {
    const points = POINTS_PER_LYD * 5; // 5 LYD worth
    const user = await seedUserWithPoints(points);
    const token = signUserToken({ userId: user.id });

    const first = await call(
      "/api/loyalty/convert-points",
      token,
      { points },
      {
        "Idempotency-Key": "loyalty-retry-key-0001",
      },
    );
    expect(first.status).toBe(200);
    expect(first.body.new_points).toBe(0);

    // The retry that motivated the whole guard: response lost (client
    // assumes failure), same key re-sent. Durable claim → 409, and the
    // balance/points reflect exactly ONE conversion.
    const retry = await call(
      "/api/loyalty/convert-points",
      token,
      { points },
      {
        "Idempotency-Key": "loyalty-retry-key-0001",
      },
    );
    expect(retry.status).toBe(409);

    const [after] = await db
      .select({ balance: usersTable.walletBalance, pts: usersTable.loyaltyPoints })
      .from(usersTable)
      .where(sql`${usersTable.id} = ${user.id}`);
    expect(Number(after.balance)).toBe(5);
    expect(after.pts).toBe(0);

    const ledgerRows = await db
      .select()
      .from(walletLedgerTable)
      .where(sql`${walletLedgerTable.userId} = ${user.id}`);
    expect(ledgerRows).toHaveLength(1);
  });

  it("a DIFFERENT key is a fresh intent and converts again (real second conversion)", async () => {
    const points = POINTS_PER_LYD * 2;
    const user = await seedUserWithPoints(points * 2);
    const token = signUserToken({ userId: user.id });

    const first = await call(
      "/api/loyalty/convert-points",
      token,
      { points },
      {
        "Idempotency-Key": "loyalty-fresh-key-0001",
      },
    );
    expect(first.status).toBe(200);

    const second = await call(
      "/api/loyalty/convert-points",
      token,
      { points },
      {
        "Idempotency-Key": "loyalty-fresh-key-0002",
      },
    );
    expect(second.status).toBe(200);

    const [after] = await db
      .select({ balance: usersTable.walletBalance })
      .from(usersTable)
      .where(sql`${usersTable.id} = ${user.id}`);
    expect(Number(after.balance)).toBe(4); // two real conversions
  });

  it("keyless requests keep the tolerant legacy behavior", async () => {
    const points = POINTS_PER_LYD * 3;
    const user = await seedUserWithPoints(points);
    const token = signUserToken({ userId: user.id });

    const res = await call("/api/loyalty/convert-points", token, { points });
    expect(res.status).toBe(200);
    // Keyless second call also succeeds — phase-1 tolerant contract
    // (documented in the middleware); the durable guard only engages
    // when the client sends a key.
    const again = await call("/api/loyalty/convert-points", token, { points });
    expect(again.status).toBe(400); // insufficient points now — honest refusal
  });
});
