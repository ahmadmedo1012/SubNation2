import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { CheckoutService } from "../checkout.service";
import { __resetIdempotencyTableProbeForTests } from "../../lib/idempotency";

/**
 * R165 (the R162 ADR) — the order-group token through the REAL purchase
 * path (M4 transaction, informational column only):
 *
 *   1. the group rides the order row verbatim (recorded, never minted);
 *   2. an idempotent replay returns the stored row's group verbatim —
 *      replayOriginalOrder selects the whole row, zero changes;
 *   3. same unit key + a DIFFERENT group = a different body → the
 *      classified 409 IDEMPOTENCY_KEY_REUSE (the body-hash predicate
 *      fail-closes: never a second charge, never a silent second group);
 *   4. omitted → NULL group (legacy clients byte-compatible);
 *   5. N unit-orders of one attempt share ONE group — the multi-order
 *      contract (M4/M5/M6 all hold: N charges, N orders, N ledger rows,
 *      ONE group id);
 *   6. the group is never money: amounts/ledger untouched by its presence.
 */

const KEY = "group idem key 0001";
const GROUP = "11111111-2222-3333-4444-555555555555";
const GROUP_B = "99999999-8888-7777-6666-555555555555";

beforeAll(async () => {
  await initTestDb();
  // Mirror of the V1-M12 table (the checkout-idempotency.test.ts shape).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key text PRIMARY KEY,
      order_id integer REFERENCES orders(id) ON DELETE CASCADE,
      reference_type varchar(32) NOT NULL DEFAULT 'order',
      body_hash varchar(64),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  __resetIdempotencyTableProbeForTests();
});

beforeEach(async () => {
  await resetTestDb();
  __resetIdempotencyTableProbeForTests();
});

let phoneSeq = 913_800_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

async function seedProduct(price = "10.00", units = 5) {
  const [p] = await db.insert(productsTable).values({ name: "R165 Product", price }).returning();
  for (let i = 0; i < units; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `grp${i}@test.local`,
      accountPassword: `pw-${i}`,
    });
  }
  return p;
}

async function userBalance(userId: number): Promise<number> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return parseFloat(String(u.walletBalance));
}

describe("R165: the order-group token through purchase()", () => {
  it("the group rides the order row verbatim (recorded, never minted)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      orderGroupKey: GROUP,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.order.orderGroupId).toBe(GROUP);

    // The stored row itself (not just the envelope).
    const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, result.order.id));
    expect(row.orderGroupId).toBe(GROUP);
  });

  it("an idempotent replay returns the stored row's group verbatim", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    const first = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
      orderGroupKey: GROUP,
    });
    if (!first.ok) throw new Error("expected success");

    // The retry replays (same key, same body → same canonical hash —
    // the group field is part of the body, so this is the TRUE retry
    // contract: same key, same group).
    const second = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
      orderGroupKey: GROUP,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected replay");
    expect(second.idempotentReplay).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.orderGroupId).toBe(GROUP);
    // One charge, one order, one ledger row — the replay contract.
    expect(await userBalance(user.id)).toBe(40);
    expect(await db.select().from(ordersTable)).toHaveLength(1);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(1);
  });

  it("same unit key + re-minted group (client bug) → classified 409, fail-closed", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    const first = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
      idempotencyBodyHash: "h".repeat(64),
      orderGroupKey: GROUP,
    });
    expect(first.ok).toBe(true);

    // The client re-minted the group under the still-live unit key — the
    // BODY changed (order_group_id rides CreateOrderBody), so the route's
    // canonicalBodyHash computes a DIFFERENT value (simulated here with the
    // second hash — exactly what routes/orders.ts feeds the service for the
    // changed body). The durable reuse predicate classifies it instead of
    // replaying a different intent's result. Never a second charge, never
    // a silent second group. This is ADR §5's
    // "re-minted group → 409" row: fail-closed by construction.
    const second = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
      idempotencyBodyHash: "x".repeat(64),
      orderGroupKey: GROUP_B,
    });

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected failure");
    expect(second.reason).toBe("CONCURRENCY_ERROR");
    expect(second.code).toBe("IDEMPOTENCY_KEY_REUSE");

    expect(await userBalance(user.id)).toBe(40);
    expect(await db.select().from(ordersTable)).toHaveLength(1);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(1);
  });

  it("omitted → NULL group (legacy clients byte-compatible)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.order.orderGroupId).toBeNull();
  });

  it("N unit-orders of one attempt share ONE group (the multi-order contract)", async () => {
    const user = await seedUser("100.00");
    const product = await seedProduct("10.00", 3);

    // The checkout loop's shape: N unit-orders, each its own idempotency
    // key, ALL carrying the SAME group token.
    const results = [];
    for (let i = 0; i < 3; i++) {
      const r = await CheckoutService.purchase({
        userId: user.id,
        productId: product.id,
        idempotencyKey: `group unit key ${i}`,
        orderGroupKey: GROUP,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("expected success");
      results.push(r);
    }

    // 3 charges, 3 orders, 3 ledger rows — ONE group on every row.
    expect(await userBalance(user.id)).toBe(70);
    expect(await db.select().from(ordersTable)).toHaveLength(3);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(3);
    const orders = await db.select().from(ordersTable);
    expect(orders.map((o) => o.orderGroupId)).toEqual([GROUP, GROUP, GROUP]);

    // And a retry of ONE charged unit (its own key) replays its order —
    // the group on the replayed row is the SAME stored value.
    const replay = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: "group unit key 1",
      orderGroupKey: GROUP,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error("expected replay");
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.order.orderGroupId).toBe(GROUP);
    expect(await userBalance(user.id)).toBe(70); // still 3 charges
    expect(await db.select().from(ordersTable)).toHaveLength(3);
  });

  it("the group is never money: amounts + ledger identical with and without it", async () => {
    const userA = await seedUser("50.00");
    const userB = await seedUser("50.00");
    const product = await seedProduct();

    const withGroup = await CheckoutService.purchase({
      userId: userA.id,
      productId: product.id,
      orderGroupKey: GROUP,
    });
    const withoutGroup = await CheckoutService.purchase({
      userId: userB.id,
      productId: product.id,
    });
    if (!withGroup.ok || !withoutGroup.ok) throw new Error("expected successes");

    expect(withGroup.order.amount).toBe(withoutGroup.order.amount);
    expect(withGroup.finalPrice).toBe(withoutGroup.finalPrice);
    expect(withGroup.order.walletBalanceBefore).toBe(withoutGroup.order.walletBalanceBefore);
    expect(withGroup.order.walletBalanceAfter).toBe(withoutGroup.order.walletBalanceAfter);
    expect(await userBalance(userA.id)).toBe(await userBalance(userB.id));
  });
});
