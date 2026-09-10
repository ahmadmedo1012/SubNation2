/**
 * F10 (round-94 A4) — durable idempotency on the customer money path.
 *
 * The HTTP middleware dedupes via Redis (24h TTL, header-gated) — soft.
 * This suite pins the transactional backstop (lib/idempotency.ts +
 * idempotency_keys table):
 *
 *   1. first purchase with a key → order + ATOMIC key claim (same tx);
 *   2. retry with the SAME key → the ORIGINAL order is replayed
 *      (idempotentReplay: true) — no second charge, no second order, no
 *      second ledger row. Crucially the replay runs BEFORE the balance
 *      check: a retry after the debit already landed replays the order
 *      instead of failing with INSUFFICIENT_BALANCE;
 *   3. claim collision (SQLSTATE 23505 — same-key purchase committed
 *      concurrently, simulated with the tx-interleave harness) → full
 *      rollback + classified CONCURRENCY_ERROR fallback — never a
 *      second charge, never a raw 500;
 *   4. different keys / no key → independent purchases (legacy parity);
 *   5. table missing (pre-V1-M12 deploy) → SQLSTATE 42P01 degrades to
 *      the exact legacy behavior (pass-through), money unaffected.
 */

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
import { interleaveWriterAfterSelect } from "./helpers/tx-interleave";

const KEY = "test idem key 0001";
const KEY_B = "test idem key 0002";

beforeAll(async () => {
  await initTestDb();
  // Mirror of the V1-M12 table (shared/db/src/schema/idempotency-keys.ts).
  // resetTestDb's TRUNCATE ... CASCADE reaches it through the orders FK.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key text PRIMARY KEY,
      order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  __resetIdempotencyTableProbeForTests();
});
beforeEach(async () => {
  await resetTestDb();
  __resetIdempotencyTableProbeForTests();
});

let phoneSeq = 913_300_000;
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
  const [p] = await db.insert(productsTable).values({ name: "F10 Product", price }).returning();
  for (let i = 0; i < units; i++) {
    await db.insert(inventoryTable).values({
      productId: p.id,
      accountEmail: `acct${i}@test.local`,
      accountPassword: `pw-${i}`,
    });
  }
  return p;
}

async function userBalance(userId: number): Promise<number> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return parseFloat(String(u.walletBalance));
}

describe("F10: durable idempotency — replay semantics", () => {
  it("first purchase claims the key atomically with the order", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    const result = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.idempotentReplay).toBeUndefined(); // first execution, not a replay

    // The claim row: user-scoped key → this order.
    const keys = await db.execute(sql`SELECT key, order_id FROM idempotency_keys`);
    const rows = (keys as unknown as { rows?: Array<{ key: string; order_id: number }> }).rows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(`u${user.id}:${KEY}`);
    expect(rows[0].order_id).toBe(result.order.id);

    expect(await userBalance(user.id)).toBe(40);
  });

  it("retry with the SAME key → the ORIGINAL order replayed: one charge, one order, one ledger row", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    const first = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
    });
    if (!first.ok) throw new Error("expected success");

    const second = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected success");
    expect(second.idempotentReplay).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(second.finalPrice).toBe(first.finalPrice);

    // Money invariant: debited EXACTLY once.
    expect(await userBalance(user.id)).toBe(40);
    expect(await db.select().from(ordersTable)).toHaveLength(1);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(1);
    // Only one inventory unit consumed.
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.filter((i) => i.isSold)).toHaveLength(1);
  });

  it("the replay short-circuits BEFORE the balance check — a drained wallet still gets its order back", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    const first = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
    });
    if (!first.ok) throw new Error("expected success");

    // The network-timeout scenario: the client never saw the 201 and
    // retries — but meanwhile the debit already landed and (say) the
    // balance was spent elsewhere. The retry must return the original
    // order, NOT "insufficient balance".
    await db.update(usersTable).set({ walletBalance: "0.00" }).where(eq(usersTable.id, user.id));

    const retry = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
    });

    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error("expected replay");
    expect(retry.idempotentReplay).toBe(true);
    expect(retry.order.id).toBe(first.order.id);
    expect(await userBalance(user.id)).toBe(0); // no phantom second debit
  });

  it("different keys are independent purchases (both charge)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    const a = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
    });
    const b = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY_B,
    });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(await userBalance(user.id)).toBe(30);
    expect(await db.select().from(ordersTable)).toHaveLength(2);
  });

  it("per-user scoping: the same key string from ANOTHER user does not replay someone else's order", async () => {
    const userA = await seedUser("50.00");
    const userB = await seedUser("50.00");
    const product = await seedProduct();

    const a = await CheckoutService.purchase({
      userId: userA.id,
      productId: product.id,
      idempotencyKey: KEY,
    });
    if (!a.ok) throw new Error("expected success");

    const b = await CheckoutService.purchase({
      userId: userB.id,
      productId: product.id,
      idempotencyKey: KEY, // same raw string, different buyer
    });

    // B bought their OWN unit — never A's order (no IDOR-flavored replay).
    expect(b.ok).toBe(true);
    if (!b.ok) throw new Error("expected success");
    expect(b.idempotentReplay).toBeUndefined();
    expect(b.order.userId).toBe(userB.id);
    expect(b.order.id).not.toBe(a.order.id);
    expect(await userBalance(userA.id)).toBe(40);
    expect(await userBalance(userB.id)).toBe(40);
  });
});

describe("F10: claim collision (SQLSTATE 23505) — never a second charge", () => {
  it("same-key winner commits between our lookup and our claim → full rollback + retryable CONCURRENCY_ERROR", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    // A real order row the FK can point at (the "winner's" order —
    // committed earlier in production; seeded here so the writer's
    // INSERT satisfies the orders FK on this session).
    const [seedOrder] = await db
      .insert(ordersTable)
      .values({
        orderCode: "SNSEED000001",
        userId: user.id,
        productId: product.id,
        amount: "10.00",
        walletBalanceBefore: "50.00",
        walletBalanceAfter: "40.00",
        status: "completed",
        deliveredAt: new Date(),
      })
      .returning({ id: ordersTable.id });

    // The product freshness re-check is the FIRST tx select — its 3-key
    // projection identifies it for the interleave hook.
    const isProductFreshnessSelect = (fields: unknown): boolean =>
      !!fields &&
      typeof fields === "object" &&
      Object.keys(fields as object).length === 3 &&
      "price" in (fields as object) &&
      "isActive" in (fields as object) &&
      "isArchived" in (fields as object);

    const restore = interleaveWriterAfterSelect(db, {
      matchSelectFields: isProductFreshnessSelect,
      // The "concurrent same-key purchase" claims the key on this
      // transaction's own session right after our re-reads started —
      // our in-tx claim INSERT then collides with the PK exactly as it
      // would against a committed concurrent winner in production.
      // (The writer's row rolls back with our failed tx in this harness
      // — production's winner commits independently, which is what the
      // post-collision re-read would replay. Certified here: the
      // collision is CLASSIFIED and nothing double-charges.)
      writer: async (realTx) => {
        await realTx.execute(
          sql`INSERT INTO idempotency_keys (key, order_id)
              VALUES (${"u" + user.id + ":" + KEY}, ${seedOrder.id})`,
        );
      },
    });

    let result: Awaited<ReturnType<typeof CheckoutService.purchase>>;
    try {
      result = await CheckoutService.purchase({
        userId: user.id,
        productId: product.id,
        idempotencyKey: KEY,
      });
    } finally {
      restore();
    }

    // The fallback envelope: retryable 409-class conflict — NOT a raw
    // 500, NOT a second charge.
    expect(result).toMatchObject({ ok: false, reason: "CONCURRENCY_ERROR" });

    // Zero money movement from THIS request: balance, orders, ledger,
    // inventory all untouched by the loser (the seeded row above is the
    // simulated winner's, not ours).
    expect(await userBalance(user.id)).toBe(50);
    const orders = await db.select().from(ordersTable);
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(seedOrder.id);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => !i.isSold)).toBe(true);
  });
});

describe("F10: legacy degradation while the table is missing (pre-V1-M12)", () => {
  it("42P01 → pass-through: purchases work, keys are ignored, retries re-execute (pre-F10 behavior)", async () => {
    const user = await seedUser("50.00");
    const product = await seedProduct();

    // Simulate the pre-migration deploy.
    await db.execute(sql`DROP TABLE idempotency_keys`);
    __resetIdempotencyTableProbeForTests();

    const first = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
    });
    expect(first.ok).toBe(true); // no crash from the missing table

    // The probe latched: the second call skips the guard entirely — the
    // documented legacy behavior (the HTTP middleware remains the only
    // dedup layer until V1-M12 lands).
    const second = await CheckoutService.purchase({
      userId: user.id,
      productId: product.id,
      idempotencyKey: KEY,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected success");
    expect(second.idempotentReplay).toBeUndefined();

    expect(await userBalance(user.id)).toBe(30); // two charges, legacy semantics
    expect(await db.select().from(ordersTable)).toHaveLength(2);
  });
});
