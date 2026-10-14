import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  initTestDb,
  resetTestDb,
  auditLogsTable,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
  execTestSql,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminProductsRouter } from "../admin/products";
import { interleaveWriterAfterSelect } from "../../services/__tests__/helpers/tx-interleave";

/**
 * R143 (L9-3) — the set-count trim race regression.
 *
 * The trim used to be a check-then-act pair OUTSIDE any transaction:
 * SELECT the oldest unsold ids → DELETE by id list with NO is_sold
 * predicate. The checkout claim takes the SAME oldest-first rows
 * (manual.provider.ts's ordered FOR UPDATE SKIP LOCKED pools), so a
 * purchase committing between the two statements had its claimed unit
 * DELETED by the trim: `orders.inventory_id` flipped to NULL (ON DELETE
 * SET NULL) and the sold-at provenance row vanished — while the route
 * answered 200 having "trimmed" a unit that was no longer the
 * operator's to trim.
 *
 * The fix mirrors the repo's conditional-claim idiom: SELECT + DELETE
 * inside one transaction, the DELETE re-asserting `is_sold = false`.
 * This test simulates the buyer inside the window with the
 * tx-interleave harness (the writer commits on the real tx session —
 * READ COMMITTED semantics), and pins all three honest outcomes: the
 * claimed unit SURVIVES, its order link stays intact, and the audit row
 * records the ACTUAL (reduced) removed count.
 */

const AUDIT_DDL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_actor_type') THEN
    CREATE TYPE audit_actor_type AS ENUM ('user', 'admin', 'system');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  actor_id integer,
  actor_type audit_actor_type NOT NULL DEFAULT 'system',
  action varchar(100) NOT NULL,
  target_type varchar(50),
  target_id integer,
  metadata text,
  ip varchar(45),
  user_agent varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminProductsRouter);
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

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_trim", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function seedFiveUnits(): Promise<{ product: number; units: number[] }> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Trim Race Product", price: "10.00" })
    .returning();
  const units: number[] = [];
  for (let i = 0; i < 5; i++) {
    const [u] = await db
      .insert(inventoryTable)
      .values({
        productId: p.id,
        accountEmail: `trim${i}@test.local`,
        accountPassword: `pw-${i}`,
      })
      .returning({ id: inventoryTable.id });
    units.push(u.id);
  }
  return { product: p.id, units };
}

async function seedOrderFor(userId: number, productId: number, inventoryId: number) {
  await db.insert(ordersTable).values({
    orderCode: `TRIM-${inventoryId}`,
    userId,
    productId,
    inventoryId,
    amount: "10.00",
    status: "completed",
  });
}

async function setCount(
  url: string,
  token: string,
  productId: number,
  count: number,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin/products/${productId}/inventory/set-count`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ count }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** writeAuditLog is fire-and-forget — poll briefly for the row. */
async function waitForAuditRow(action: string): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 20; i++) {
    const rows = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.action, action))
      .limit(1);
    if (rows.length > 0)
      return JSON.parse(String(rows[0].metadata ?? "{}")) as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

let app: Express;
let url: string;
let close: () => void;

beforeAll(async () => {
  await initTestDb();
  await execTestSql(AUDIT_DDL);
  app = buildApp();
  const server = await listen(app);
  url = server.url;
  close = server.close;
});

afterAll(() => close());

describe("R143 (L9-3): set-count trim — guarded DELETE under the claim race", () => {
  let token: string;

  beforeEach(async () => {
    await resetTestDb();
    token = await seedAdmin();
  });

  it("a unit claimed between the trim's SELECT and DELETE survives, its order link stays intact, and the audit records the reduced count", async () => {
    const { product, units } = await seedFiveUnits();
    const [user] = await db
      .insert(usersTable)
      .values({ phone: "09100000009", walletBalance: "50.00" })
      .returning();
    // The buyer's order already references the OLDEST unit (ids ascend).
    const claimedId = units[0]!;
    await seedOrderFor(user.id, product, claimedId);

    // Simulate the buyer's committed claim inside the trim transaction's
    // SELECT→DELETE window (same harness idiom as checkout-claim-race).
    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: (fields) =>
        fields !== undefined && (fields as Record<string, unknown>).id === inventoryTable.id,
      writer: (realTx) =>
        realTx.execute(
          sql`UPDATE inventory SET is_sold = true, sold_at = now()
             WHERE id = ${claimedId} AND is_sold = false`,
        ),
    });

    let response: { status: number; body: Record<string, unknown> | null };
    try {
      // 5 unsold → target 2 ⇒ surplus 3 (units 1,2,3) — the buyer claims
      // unit 1 inside the window.
      response = await setCount(url, token, product, 2);
    } finally {
      restore();
    }

    expect(response.status).toBe(200);
    expect(response.body?.success).toBe(true);

    // The claimed unit SURVIVED the trim (the old unguarded DELETE would
    // have removed it — order link severed, provenance gone).
    const claimed = await db.select().from(inventoryTable).where(eq(inventoryTable.id, claimedId));
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.isSold).toBe(true);
    expect(claimed[0]!.soldAt).not.toBeNull();

    // The order's inventory link is intact (ON DELETE SET NULL never fired).
    const order = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.orderCode, `TRIM-${claimedId}`));
    expect(order).toHaveLength(1);
    expect(order[0]!.inventoryId).toBe(claimedId);

    // The two REMAINING oldest unsold units were trimmed; the sold unit
    // left the unsold pool on its own, so unsold lands exactly on target.
    const remaining = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product));
    expect(remaining.map((r) => r.id).sort((a, b) => a - b)).toEqual(
      [claimedId, units[3]!, units[4]!].sort((a, b) => a - b),
    );
    const [unsoldRow] = await db
      .select({ unsold: sql<number>`count(*)::int` })
      .from(inventoryTable)
      .where(sql`${inventoryTable.productId} = ${product} AND ${inventoryTable.isSold} = false`);
    expect(Number(unsoldRow?.unsold ?? 0)).toBe(2);

    // The audit row records the ACTUAL removed count (2 of the requested 3).
    const auditMeta = await waitForAuditRow("product.inventory.set-count");
    expect(auditMeta).not.toBeNull();
    expect(auditMeta?.removed).toBe(2);
  });

  it("control leg: no interleaving — the plain trim still removes exactly the surplus", async () => {
    const { product, units } = await seedFiveUnits();

    const response = await setCount(url, token, product, 2);

    expect(response.status).toBe(200);
    const remaining = await db
      .select({ id: inventoryTable.id })
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product));
    // Oldest three removed, newest two kept.
    expect(remaining.map((r) => r.id).sort((a, b) => a - b)).toEqual(
      [units[3]!, units[4]!].sort((a, b) => a - b),
    );
    const auditMeta = await waitForAuditRow("product.inventory.set-count");
    expect(auditMeta?.removed).toBe(3);
  });
});
