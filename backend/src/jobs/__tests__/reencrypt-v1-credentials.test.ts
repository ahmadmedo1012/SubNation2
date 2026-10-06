/**
 * R118-B1c (A4 F-2) — the v1→v2 credential re-encrypt one-shot.
 *
 * The job upgrades legacy prefixless AES-256-GCM blobs
 * (`iv:tag:ct`, every pre-R118 row incl. the 15 live credential blobs) to
 * the versioned `v2:` format under the current ENCRYPTION_KEY. Locked
 * behaviours (real pglite DB, real encryption lib — the only mocks are
 * none):
 *
 *   - v1 rows across EVERY target column upgrade to v2 with the plaintext
 *     bit-for-bit preserved (decrypt(new) === original secret);
 *   - plaintext / NULL / already-v2 values are never touched (the email
 *     columns are plaintext-by-design and out of scope);
 *   - the second run is a pure no-op (0 candidates, 0 updates);
 *   - rotation window: a v1 blob minted under the key now parked in
 *     ENCRYPTION_KEY_PREV decrypts via the fallback and lands as v2
 *     under the CURRENT key;
 *   - an undecryptable v1 blob (wrong key, no fallback) is left
 *     untouched, counted as failed, and raises the deduped admin alert;
 *   - concurrency: a STALE candidate (the row already changed between
 *     scan and UPDATE) commits 0 rows — the optimistic WHERE never
 *     clobbers newer data (upgraded === 0, stale === 1, row keeps its
 *     current value);
 *   - varchar budget: a 512-char v1 blob in a varchar(512) column whose
 *     v2 form (+3 chars) would not fit is failed loudly, not 22001'd;
 *     the v1 blob survives (still decryptable by the reader path).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  initTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
  adminAlertsTable,
} from "../../test/db";
import {
  __resetEncryptionKeyCacheForTests,
  decrypt,
  encrypt,
} from "../../lib/encryption";
import { reencryptV1CredentialBlobs, upgradeV1Candidates } from "../reencrypt-v1-credentials";

/** A valid 32-byte hex key that is NOT the test env's ENCRYPTION_KEY. */
const OTHER_KEY = "ff".repeat(32);

/** Mint a LEGACY v1 blob (`iv:tag:ct`, no prefix) with an arbitrary key. */
function encryptV1WithKey(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

const ORIGINAL_PREV = process.env.ENCRYPTION_KEY_PREV;

async function seedProduct(): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Reencrypt Product", price: "10.00" })
    .returning();
  return p.id;
}

async function seedUser(): Promise<number> {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9199${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}` })
    .returning();
  return u.id;
}

async function seedOrder(password: string | null, extra: string | null): Promise<number> {
  const productId = await seedProduct();
  const userId = await seedUser();
  const [o] = await db
    .insert(ordersTable)
    .values({
      orderCode: `ORD-${Math.random().toString(36).slice(2, 10)}`,
      userId,
      productId,
      amount: "10.00",
      status: "completed",
      deliveredPassword: password,
      deliveredExtraDetails: extra,
    })
    .returning();
  return o.id;
}

async function seedInventory(password: string | null, extra: string | null): Promise<number> {
  const productId = await seedProduct();
  const [inv] = await db
    .insert(inventoryTable)
    .values({ productId, accountPassword: password, extraDetails: extra })
    .returning();
  return inv.id;
}

async function fetchInventory(id: number) {
  const [row] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, id)).limit(1);
  return row!;
}

async function fetchOrder(id: number) {
  const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
  return row!;
}

async function fetchAdmin(id: number) {
  const [row] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id)).limit(1);
  return row!;
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  delete process.env.ENCRYPTION_KEY_PREV;
  __resetEncryptionKeyCacheForTests();
});

afterEach(() => {
  if (ORIGINAL_PREV === undefined) {
    delete process.env.ENCRYPTION_KEY_PREV;
  } else {
    process.env.ENCRYPTION_KEY_PREV = ORIGINAL_PREV;
  }
  __resetEncryptionKeyCacheForTests();
});

describe("R118-B1c (A4 F-2) — v1→v2 re-encrypt one-shot", () => {
  it("upgrades every v1 blob across all target columns, plaintext preserved, exact counts", async () => {
    const pwV1 = encryptV1WithKey("pw-secret-1", process.env.ENCRYPTION_KEY as string);
    const extraV1 = encryptV1WithKey("GIFT-CODE-4477", process.env.ENCRYPTION_KEY as string);
    const invId = await seedInventory(pwV1, extraV1);

    const orderPwV1 = encryptV1WithKey("delivered-pw", process.env.ENCRYPTION_KEY as string);
    const orderExtraV1 = encryptV1WithKey("2FA: 9981", process.env.ENCRYPTION_KEY as string);
    const orderId = await seedOrder(orderPwV1, orderExtraV1);

    const totpV1 = encryptV1WithKey("JBSWY3DPEHPK3PXP", process.env.ENCRYPTION_KEY as string);
    const [admin] = await db
      .insert(adminUsersTable)
      .values({ username: "reencrypt_admin", passwordHash: "x", totpSecret: totpV1 })
      .returning();

    const outcome = await reencryptV1CredentialBlobs();
    expect(outcome).toEqual({ scanned: 5, upgraded: 5, stale: 0, failed: 0 });

    const inv = await fetchInventory(invId);
    expect(inv.accountPassword!.startsWith("v2:")).toBe(true);
    expect(inv.accountPassword).not.toBe(pwV1);
    expect(decrypt(inv.accountPassword!)).toBe("pw-secret-1");
    expect(inv.extraDetails!.startsWith("v2:")).toBe(true);
    expect(decrypt(inv.extraDetails!)).toBe("GIFT-CODE-4477");

    const order = await fetchOrder(orderId);
    expect(order.deliveredPassword!.startsWith("v2:")).toBe(true);
    expect(decrypt(order.deliveredPassword!)).toBe("delivered-pw");
    expect(order.deliveredExtraDetails!.startsWith("v2:")).toBe(true);
    expect(decrypt(order.deliveredExtraDetails!)).toBe("2FA: 9981");

    const adminRow = await fetchAdmin(admin.id);
    expect(adminRow.totpSecret!.startsWith("v2:")).toBe(true);
    expect(decrypt(adminRow.totpSecret!)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("never touches plaintext, NULL, or already-v2 values (and skips the by-design plaintext email columns)", async () => {
    const alreadyV2 = encrypt("already-current");
    const invId = await seedInventory(alreadyV2, null);
    // A plaintext email beside the ciphertext — emails are plaintext BY
    // DESIGN (bulk-import dedup compares them lowercased) and must never
    // be treated as upgrade material.
    await db.execute(
      sql`UPDATE inventory SET account_email = 'plain@test.local' WHERE id = ${invId}`,
    );
    const plainOrderId = await seedOrder("legacy-plain-pw", "legacy-plain-extra");

    const outcome = await reencryptV1CredentialBlobs();
    expect(outcome).toEqual({ scanned: 0, upgraded: 0, stale: 0, failed: 0 });

    const inv = await fetchInventory(invId);
    expect(inv.accountPassword).toBe(alreadyV2); // byte-identical
    expect(inv.accountEmail).toBe("plain@test.local"); // untouched
    expect(inv.extraDetails).toBeNull();

    const order = await fetchOrder(plainOrderId);
    expect(order.deliveredPassword).toBe("legacy-plain-pw"); // plaintext passthrough by design
    expect(order.deliveredExtraDetails).toBe("legacy-plain-extra");
  });

  it("second run is a pure no-op (idempotence — everything is v2)", async () => {
    const invId = await seedInventory(
      encryptV1WithKey("first-pass", process.env.ENCRYPTION_KEY as string),
      null,
    );
    const first = await reencryptV1CredentialBlobs();
    expect(first.upgraded).toBe(1);

    const second = await reencryptV1CredentialBlobs();
    expect(second).toEqual({ scanned: 0, upgraded: 0, stale: 0, failed: 0 });

    const inv = await fetchInventory(invId);
    expect(decrypt(inv.accountPassword!)).toBe("first-pass");
  });

  it("rotation window: a v1 blob under ENCRYPTION_KEY_PREV decrypts via the fallback and lands as v2 under the CURRENT key", async () => {
    // The old process encrypted with OTHER_KEY; the operator rotated:
    // ENCRYPTION_KEY (test env default) is now current, OTHER_KEY parked
    // in ENCRYPTION_KEY_PREV.
    process.env.ENCRYPTION_KEY_PREV = OTHER_KEY;
    __resetEncryptionKeyCacheForTests();
    const oldKeyBlob = encryptV1WithKey("pre-rotation-credential", OTHER_KEY);
    const invId = await seedInventory(oldKeyBlob, null);

    const outcome = await reencryptV1CredentialBlobs();
    expect(outcome).toEqual({ scanned: 1, upgraded: 1, stale: 0, failed: 0 });

    const inv = await fetchInventory(invId);
    expect(inv.accountPassword!.startsWith("v2:")).toBe(true);
    // Decrypts with the CURRENT key (no fallback needed after upgrade).
    delete process.env.ENCRYPTION_KEY_PREV;
    __resetEncryptionKeyCacheForTests();
    expect(decrypt(inv.accountPassword!)).toBe("pre-rotation-credential");
  });

  it("undecryptable v1 blob (wrong key, no fallback) → failed bucket, row byte-identical, deduped admin alert raised", async () => {
    const orphaned = encryptV1WithKey("orphaned-secret", OTHER_KEY);
    const invId = await seedInventory(orphaned, null);

    const outcome = await reencryptV1CredentialBlobs();
    expect(outcome).toEqual({ scanned: 1, upgraded: 0, stale: 0, failed: 1 });

    // The v1 blob survives untouched — recoverable once the key is fixed.
    const inv = await fetchInventory(invId);
    expect(inv.accountPassword).toBe(orphaned);

    // Alert convention: one deduped admin_alerts row for the condition.
    const alerts = await db
      .select()
      .from(adminAlertsTable)
      .where(eq(adminAlertsTable.dedupeKey, "reencrypt-v1:undecryptable"));
    expect(alerts).toHaveLength(1);
  });

  it("concurrency: a STALE candidate commits 0 rows — the optimistic WHERE never clobbers a newer value", async () => {
    // Simulate the race: the scanner read a v1 blob, but a concurrent
    // writer re-saved the row as a fresh v2 blob before the UPDATE.
    const oldV1 = encryptV1WithKey("stale-race-secret", process.env.ENCRYPTION_KEY as string);
    const invId = await seedInventory(oldV1, null);
    const newerV2 = encrypt("newer-concurrent-write");
    await db
      .update(inventoryTable)
      .set({ accountPassword: newerV2 })
      .where(eq(inventoryTable.id, invId));

    const outcome = await upgradeV1Candidates([
      { table: "inventory", column: "account_password", id: invId, value: oldV1 },
    ]);
    expect(outcome).toEqual({ scanned: 1, upgraded: 0, stale: 1, failed: 0 });

    // The newer value won — nothing was overwritten.
    const inv = await fetchInventory(invId);
    expect(inv.accountPassword).toBe(newerV2);
    expect(decrypt(inv.accountPassword!)).toBe("newer-concurrent-write");
  });

  it("stale + fresh candidates in one batch: only the fresh row upgrades", async () => {
    const staleV1 = encryptV1WithKey("stale-one", process.env.ENCRYPTION_KEY as string);
    const freshV1 = encryptV1WithKey("fresh-one", process.env.ENCRYPTION_KEY as string);
    const staleId = await seedInventory(staleV1, null);
    const freshId = await seedInventory(freshV1, null);
    // The stale row moved on between "scan" and "update".
    const replaced = encrypt("replaced-by-writer");
    await db
      .update(inventoryTable)
      .set({ accountPassword: replaced })
      .where(eq(inventoryTable.id, staleId));

    const outcome = await upgradeV1Candidates([
      { table: "inventory", column: "account_password", id: staleId, value: staleV1 },
      { table: "inventory", column: "account_password", id: freshId, value: freshV1 },
    ]);
    expect(outcome).toEqual({ scanned: 2, upgraded: 1, stale: 1, failed: 0 });
    expect((await fetchInventory(staleId)).accountPassword).toBe(replaced);
    expect(decrypt((await fetchInventory(freshId)).accountPassword!)).toBe("fresh-one");
  });

  it("varchar budget: a 512-char v1 blob whose v2 form would not fit varchar(512) is failed loudly, not 22001'd", async () => {
    // 227-byte plaintext → v1 blob of exactly 512 chars; v2 adds 3.
    const edgePlaintext = "x".repeat(227);
    const edgeV1 = encryptV1WithKey(edgePlaintext, process.env.ENCRYPTION_KEY as string);
    expect(edgeV1.length).toBe(512);
    const invId = await seedInventory(edgeV1, null);

    const outcome = await reencryptV1CredentialBlobs();
    expect(outcome).toEqual({ scanned: 1, upgraded: 0, stale: 0, failed: 1 });

    // The v1 blob survives and still decrypts (reader path intact).
    const inv = await fetchInventory(invId);
    expect(inv.accountPassword).toBe(edgeV1);
    expect(decrypt(inv.accountPassword!)).toBe(edgePlaintext);
  });

  it("v2-shaped GARBAGE is skipped by the scan (never upgrade material, never destroyed)", async () => {
    const orderId = await seedOrder("v2:not:hex:garbage", null);
    const outcome = await reencryptV1CredentialBlobs();
    expect(outcome).toEqual({ scanned: 0, upgraded: 0, stale: 0, failed: 0 });
    const order = await fetchOrder(orderId);
    expect(order.deliveredPassword).toBe("v2:not:hex:garbage");
  });

  it("upgradeV1Candidates ignores non-v1 and unknown-target input (belt + braces)", async () => {
    const invId = await seedInventory("plain", null);
    const outcome = await upgradeV1Candidates([
      { table: "inventory", column: "account_password", id: invId, value: "plain" },
      { table: "inventory", column: "account_password", id: invId, value: encrypt("v2") },
      // @ts-expect-error — an out-of-roster target must be skipped, not run
      { table: "inventory", column: "account_email", id: invId, value: "x:y:z" },
    ]);
    expect(outcome).toEqual({ scanned: 0, upgraded: 0, stale: 0, failed: 0 });
    expect((await fetchInventory(invId)).accountPassword).toBe("plain");
  });
});
