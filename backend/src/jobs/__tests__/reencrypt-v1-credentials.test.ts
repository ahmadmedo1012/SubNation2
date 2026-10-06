/**
 * R118-B1c (A4 F-2) — the v1→v2 credential re-encrypt one-shot.
 * R119-B1 (A1 F-1) — the SECOND pass: mid-rotation v2 re-keying.
 *
 * The job upgrades legacy prefixless AES-256-GCM blobs
 * (`iv:tag:ct`, every pre-R118 row incl. the 15 live credential blobs) to
 * the versioned `v2:` format under the current ENCRYPTION_KEY, and (since
 * R119-B1) re-keys v2 blobs the PREVIOUS key minted. Locked behaviours
 * (real pglite DB, real encryption lib — the only mocks are none):
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
 *
 * R119-B1 (A1 F-1) additions — rotation #2 regression + the v2 pass:
 *
 *   - full second-rotation story against the REAL modules: v2 minted
 *     under key A survives a boot on key B via the PREV fallback, is
 *     re-keyed to v2-under-B by the job's second pass (through the PUBLIC
 *     entry point the boot one-shot registers), still decrypts with PREV
 *     dropped, and a third rotation (key C, PREV=B) works the same — N
 *     rotations, not one;
 *   - with PREV unset the v2 pass does not even SCAN (steady-state boot
 *     cost identical to the R118 ship);
 *   - with PREV armed, current-key v2 rows are probed but skipped
 *     byte-identically (idempotence — no churn rewrite, no updated_at
 *     bump);
 *   - a v2 blob dead under BOTH keys lands in its own failed bucket
 *     with a DISTINCT deduped alert (reencrypt-v2:undecryptable) — the
 *     operator can tell it apart from the v1 undecryptables;
 *   - the v2 re-key keeps the optimistic-WHERE race guard (stale
 *     candidate → 0 rows, newer value wins).
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
import { __resetEncryptionKeyCacheForTests, decrypt, encrypt } from "../../lib/encryption";
import {
  reencryptMidRotationV2Blobs,
  reencryptV1CredentialBlobs,
  upgradeV1Candidates,
  upgradeV2Candidates,
} from "../reencrypt-v1-credentials";

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
// R119-B1 (A1 F-1): the rotation tests below simulate new processes by
// switching ENCRYPTION_KEY itself — capture the module-load value (the
// vitest synthetic bootstrap, src/test/env.ts) and restore it after every
// test so later suites in this file always start from the same generation.
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY as string;

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
  process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  delete process.env.ENCRYPTION_KEY_PREV;
  __resetEncryptionKeyCacheForTests();
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
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

describe("R119-B1 (A1 F-1) — mid-rotation v2 re-key pass (rotation #2+ survival)", () => {
  // Key generations for the rotation stories. KEY_A is the module-load
  // ENCRYPTION_KEY (the vitest synthetic bootstrap); B and C are fresh
  // 32-byte hex keys standing in for the 2nd/3rd generations.
  const KEY_B = "22".repeat(32);
  const KEY_C = "33".repeat(32);

  it("full second-rotation story: v2-under-A survives key B, is re-keyed by the job, and rotation #3 (key C) works too", async () => {
    const KEY_A = ORIGINAL_KEY;

    // (a) The R118 steady state after rotation #1: encrypt() mints v2
    // under the then-current key A. Nothing v1 is left on disk.
    process.env.ENCRYPTION_KEY = KEY_A;
    delete process.env.ENCRYPTION_KEY_PREV;
    __resetEncryptionKeyCacheForTests();
    const blobUnderA = encrypt("rotation-2-secret");
    expect(blobUnderA.startsWith("v2:")).toBe(true);
    const invId = await seedInventory(blobUnderA, null);

    // Rotation #2: the process re-boots with key B current, key A parked
    // in PREV. The mid-rotation READ path survives via the R119-B1 v2
    // fallback (pre-R119 this is where checkout died with
    // INVENTORY_CORRUPT and 2FA failed behind a wrong-code 401).
    process.env.ENCRYPTION_KEY = KEY_B;
    process.env.ENCRYPTION_KEY_PREV = KEY_A;
    __resetEncryptionKeyCacheForTests();
    expect(decrypt((await fetchInventory(invId)).accountPassword!)).toBe("rotation-2-secret");

    // (b) The boot one-shot (its PUBLIC entry — what boot-one-shots.ts
    // registers) drains v1 (nothing left) and re-keys the mid-rotation
    // v2 blob to v2-under-B.
    const outcome = await reencryptV1CredentialBlobs();
    expect(outcome).toEqual({ scanned: 0, upgraded: 0, stale: 0, failed: 0 }); // v1 pass: nothing to do
    const blobUnderB = (await fetchInventory(invId)).accountPassword!;
    expect(blobUnderB.startsWith("v2:")).toBe(true);
    expect(blobUnderB).not.toBe(blobUnderA); // actually re-encrypted (fresh IV)

    // (c) PREV dropped — the steady state under key B ALONE still
    // decrypts, proving the blob is now key-B material (not a fallback
    // rescue) and the rotation has fully completed.
    delete process.env.ENCRYPTION_KEY_PREV;
    __resetEncryptionKeyCacheForTests();
    expect(decrypt(blobUnderB)).toBe("rotation-2-secret");

    // (d) Rotation #3 (key C current, key B in PREV): the same story
    // repeats — the mechanism supports N rotations, not just one.
    process.env.ENCRYPTION_KEY = KEY_C;
    process.env.ENCRYPTION_KEY_PREV = KEY_B;
    __resetEncryptionKeyCacheForTests();
    expect(decrypt(blobUnderB)).toBe("rotation-2-secret"); // fallback read again
    const outcome3 = await reencryptV1CredentialBlobs();
    expect(outcome3).toEqual({ scanned: 0, upgraded: 0, stale: 0, failed: 0 });
    const blobUnderC = (await fetchInventory(invId)).accountPassword!;
    delete process.env.ENCRYPTION_KEY_PREV;
    __resetEncryptionKeyCacheForTests();
    expect(decrypt(blobUnderC)).toBe("rotation-2-secret"); // pure key-C material now
  });

  it("with PREV unset, the v2 pass must not even scan (steady-state boot cost identical to the R118 ship)", async () => {
    const blob = encrypt("steady-state-v2");
    const invId = await seedInventory(blob, null);
    // PREV is deleted by beforeEach — the armed-gate must short-circuit
    // before any SELECT runs.
    const outcome = await reencryptMidRotationV2Blobs();
    expect(outcome).toEqual({ scanned: 0, upgraded: 0, stale: 0, failed: 0 });
    expect((await fetchInventory(invId)).accountPassword).toBe(blob);
  });

  it("with PREV armed, current-key v2 rows are probed but skipped byte-identically (idempotent — no churn rewrite)", async () => {
    const blob = encrypt("current-generation"); // v2 under the current key
    const invId = await seedInventory(blob, null);
    process.env.ENCRYPTION_KEY_PREV = OTHER_KEY;
    __resetEncryptionKeyCacheForTests();

    const outcome = await reencryptMidRotationV2Blobs();
    expect(outcome).toEqual({ scanned: 1, upgraded: 0, stale: 0, failed: 0 });
    // Byte-identical: the pass re-keys MID-ROTATION material only — the
    // steady state is never rewritten (no new IV, no updated_at bump).
    expect((await fetchInventory(invId)).accountPassword).toBe(blob);
  });

  it("a v2 blob dead under BOTH keys → v2 failed bucket, row untouched, DISTINCT v2 alert (not the v1 one)", async () => {
    // Minted under a THIRD key nobody configured: current key cannot read
    // it, PREV cannot read it. The R118 job would have reported zero
    // failures here (nothing matches its v1 scan) — R119-A1 finding P1.
    process.env.ENCRYPTION_KEY_PREV = OTHER_KEY;
    __resetEncryptionKeyCacheForTests();
    const deadV2 = `v2:${encryptV1WithKey("dead-under-both", "aa".repeat(32))}`;
    const invId = await seedInventory(deadV2, null);

    const outcome = await reencryptMidRotationV2Blobs();
    expect(outcome).toEqual({ scanned: 1, upgraded: 0, stale: 0, failed: 1 });

    // Never destroyed — recoverable only via manual key recovery.
    expect((await fetchInventory(invId)).accountPassword).toBe(deadV2);

    // Distinct deduped alert, so the operator can tell "v2 undecryptable
    // under both keys" (corruption / older-than-PREV) apart from the v1
    // condition (fixable by setting ENCRYPTION_KEY_PREV).
    const v2Alerts = await db
      .select()
      .from(adminAlertsTable)
      .where(eq(adminAlertsTable.dedupeKey, "reencrypt-v2:undecryptable"));
    expect(v2Alerts).toHaveLength(1);
    const v1Alerts = await db
      .select()
      .from(adminAlertsTable)
      .where(eq(adminAlertsTable.dedupeKey, "reencrypt-v1:undecryptable"));
    expect(v1Alerts).toHaveLength(0);
  });

  it("v1 and v2 undecryptables coexist: BOTH alerts fire, each with its own dedupe key and message", async () => {
    process.env.ENCRYPTION_KEY_PREV = OTHER_KEY;
    __resetEncryptionKeyCacheForTests();
    const orphanedV1 = encryptV1WithKey("orphaned-v1", "aa".repeat(32));
    const deadV2 = `v2:${encryptV1WithKey("dead-v2", "bb".repeat(32))}`;
    // One row, both conditions: account_password is dead v1 material,
    // extra_details is dead v2 material.
    const invId = await seedInventory(orphanedV1, deadV2);

    const outcome = await reencryptV1CredentialBlobs();
    // The PUBLIC return carries the v1 pass's counters only (the shape
    // every existing caller was built around)…
    expect(outcome).toEqual({ scanned: 1, upgraded: 0, stale: 0, failed: 1 });
    // …while the v2 pass (run inside the same one-shot) drains its own
    // failed bucket and raises its own alert.
    const v1Alerts = await db
      .select()
      .from(adminAlertsTable)
      .where(eq(adminAlertsTable.dedupeKey, "reencrypt-v1:undecryptable"));
    expect(v1Alerts).toHaveLength(1);
    const v2Alerts = await db
      .select()
      .from(adminAlertsTable)
      .where(eq(adminAlertsTable.dedupeKey, "reencrypt-v2:undecryptable"));
    expect(v2Alerts).toHaveLength(1);
    expect(v1Alerts[0].title).not.toBe(v2Alerts[0].title);

    // Both rows survive untouched.
    const inv = await fetchInventory(invId);
    expect(inv.accountPassword).toBe(orphanedV1);
    expect(inv.extraDetails).toBe(deadV2);
  });

  it("the v2 re-key keeps the optimistic-WHERE race guard: a stale v2 candidate commits 0 rows", async () => {
    // Mid-rotation blob (minted under the key now parked in PREV), but a
    // concurrent writer replaced the row before our UPDATE committed.
    process.env.ENCRYPTION_KEY_PREV = KEY_B;
    __resetEncryptionKeyCacheForTests();
    const midRotation = `v2:${encryptV1WithKey("mid-rotation-race", KEY_B)}`;
    const invId = await seedInventory(midRotation, null);
    const newerV2 = encrypt("newer-concurrent-write"); // fresh current-key v2
    await db
      .update(inventoryTable)
      .set({ accountPassword: newerV2 })
      .where(eq(inventoryTable.id, invId));

    const outcome = await upgradeV2Candidates([
      { table: "inventory", column: "account_password", id: invId, value: midRotation },
    ]);
    expect(outcome).toEqual({ scanned: 1, upgraded: 0, stale: 1, failed: 0 });

    // The newer value won — nothing was overwritten.
    const inv = await fetchInventory(invId);
    expect(inv.accountPassword).toBe(newerV2);
    expect(decrypt(inv.accountPassword!)).toBe("newer-concurrent-write");
  });
});
