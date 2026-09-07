import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import {
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
  walletLedgerTable,
} from "@workspace/db";
import { CheckoutService } from "../../services/checkout.service";

/**
 * R93-DATA (round-93 post-deploy live audit) — inventory deliverability gate.
 *
 * Live evidence that motivated the guard: every unsold unit of products 1-12
 * (59 units, seeded 2026-08-25) stores account_password ciphertext that fails
 * GCM authentication with the current ENCRYPTION_KEY (wrong/rotated key at
 * load time). Before the guard, a buyer of those products was CHARGED and
 * then received delivered_password: null at the API boundary — money for
 * nothing. The guard fails the transaction closed BEFORE any mutation:
 * nothing charged, nothing claimed, and a deduped admin alert names the unit.
 *
 * These tests pin the three-way contract:
 *   1. wrong-key ciphertext → INVENTORY_CORRUPT, zero money movement,
 *      inventory row untouched, alert created;
 *   2. legacy PLAINTEXT credentials still sell (passthrough by design);
 *   3. current-key ciphertext still sells (the normal encrypted path).
 */

/** AES-256-GCM encrypt with an arbitrary key — mirrors lib/encryption format. */
function encryptWithKey(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

// A valid 32-byte hex key that is NOT the test env's ENCRYPTION_KEY.
const WRONG_KEY = "ff".repeat(32);

async function seedUserWithBalance(balance: string) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9${Math.floor(Math.random() * 1e8)}`, walletBalance: balance })
    .returning();
  return u;
}

async function seedProductWithPassword(password: string | null) {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Guard Product", price: "10.00" })
    .returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "acct@test.local",
    accountPassword: password,
  });
  return p;
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("R93-DATA — checkout inventory deliverability gate", () => {
  it("wrong-key ciphertext → INVENTORY_CORRUPT with ZERO money movement and an admin alert", async () => {
    const user = await seedUserWithBalance("50.00");
    const product = await seedProductWithPassword(encryptWithKey("real-secret", WRONG_KEY));

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });

    expect(result).toMatchObject({ ok: false, reason: "INVENTORY_CORRUPT" });

    // Nothing charged: balance unchanged, no ledger row, no order row.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
    const ledger = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.userId, user.id));
    expect(ledger).toHaveLength(0);
    const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, user.id));
    expect(orders).toHaveLength(0);

    // The claim rolled back — the unit is still unsold and retryable after
    // the operator re-uploads stock.
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv).toHaveLength(1);
    expect(inv[0].isSold).toBe(false);

    // The operator alert fired (deduped per product — asserted loosely here;
    // the dedupe window behaviour itself is covered by alert-hygiene tests).
    const alerts = await db.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      `SELECT type, title FROM admin_alerts WHERE type = 'inventory_corrupt'` as any,
    );
    const rows = (alerts as unknown as { rows?: Array<{ type: string }> }).rows ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].type).toBe("inventory_corrupt");
  });

  it("empty unit (no password AND no email) → INVENTORY_CORRUPT too", async () => {
    const user = await seedUserWithBalance("50.00");
    const [p] = await db
      .insert(productsTable)
      .values({ name: "Empty Product", price: "10.00" })
      .returning();
    await db.insert(inventoryTable).values({ productId: p.id });

    const result = await CheckoutService.purchase({ userId: user.id, productId: p.id });
    expect(result).toMatchObject({ ok: false, reason: "INVENTORY_CORRUPT" });

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(50);
  });

  it("legacy PLAINTEXT password still sells (passthrough, no gate trip)", async () => {
    const user = await seedUserWithBalance("50.00");
    const product = await seedProductWithPassword("plain-legacy-pw");

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(true);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(40);
  });

  it("current-key ciphertext still sells — the normal encrypted path", async () => {
    const user = await seedUserWithBalance("50.00");
    // Encrypt with the ACTUAL test ENCRYPTION_KEY (set by src/test/env.ts).
    const product = await seedProductWithPassword(
      encryptWithKey("current-key-secret", process.env.ENCRYPTION_KEY as string),
    );

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(true);

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(40);
  });
});
