import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, initTestDb, loginAttemptsTable } from "../../test/db";
import {
  calculateLockoutDuration,
  checkLockout,
  recordFailedAttempt,
  resetAttempts,
} from "../lockout";

/**
 * 93-A1 S12 (round-93) — lockout upsert atomicity.
 *
 * recordFailedAttempt used SELECT-then-INSERT: two concurrent FIRST
 * failures for a fresh identifier both saw "no row", both INSERTed, and
 * the loser crashed with an unhandled 23505 (unique index
 * idx_login_attempts_identifier) — the login route surfaced a 500
 * instead of a 401. It is now a single-statement
 * INSERT … ON CONFLICT DO UPDATE; these tests pin:
 *
 *   - the upsert counts correctly on both the insert and conflict paths
 *   - lockout activation + exponential duration match the JS formula
 *     (calculateLockoutDuration is the closed-form mirror of the SQL)
 *   - CONCURRENT first failures no longer raise (the S12 regression)
 *
 * login_attempts is not part of the shared test DDL (src/test/db.ts), so
 * this file owns its schema — mirroring shared/db schema/login_attempts.ts.
 */

async function fetchRow(identifier: string): Promise<{
  attemptCount: number;
  lockedUntil: Date | null;
} | null> {
  const [row] = await db
    .select({
      attemptCount: loginAttemptsTable.attemptCount,
      lockedUntil: loginAttemptsTable.lockedUntil,
    })
    .from(loginAttemptsTable)
    .where(eq(loginAttemptsTable.identifier, identifier))
    .limit(1);
  return row ?? null;
}

beforeAll(async () => {
  await initTestDb();
  // pglite executes ONE statement per prepared query — split the DDL.
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS login_attempts (
  id serial PRIMARY KEY,
  identifier varchar(100) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now()
)`),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts (identifier)`,
    ),
  );
});

beforeEach(async () => {
  await db.execute(sql.raw(`DELETE FROM login_attempts;`));
});

describe("recordFailedAttempt — single-statement upsert (93-A1 S12)", () => {
  it("first failure INSERTs {attemptCount: 1} with no lock", async () => {
    await recordFailedAttempt("user:alice");
    const row = await fetchRow("user:alice");
    expect(row).not.toBeNull();
    expect(row!.attemptCount).toBe(1);
    expect(row!.lockedUntil).toBeNull();
  });

  it("repeated failures increment through the conflict path", async () => {
    for (let i = 0; i < 4; i++) await recordFailedAttempt("user:alice");
    const row = await fetchRow("user:alice");
    expect(row!.attemptCount).toBe(4);
    expect(row!.lockedUntil).toBeNull();
  });

  it("the 5th failure activates the lock at the base duration (15 min)", async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt("user:alice");
    const row = await fetchRow("user:alice");
    expect(row!.attemptCount).toBe(5);
    expect(row!.lockedUntil).not.toBeNull();
    const minutes = (row!.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it("lockout duration follows the exponential formula (SQL ⇄ JS mirror)", async () => {
    // Cross-check every failure-count plateau against the JS function —
    // the SQL CASE inside the upsert must agree with it exactly.
    const counts = [5, 6, 9, 10, 11, 14, 15, 16, 20, 21];
    for (const n of counts) {
      await db.execute(sql.raw(`DELETE FROM login_attempts;`));
      const identifier = `user:form_${n}`;
      for (let i = 0; i < n; i++) await recordFailedAttempt(identifier);
      const row = await fetchRow(identifier);
      expect(row!.attemptCount).toBe(n);
      expect(row!.lockedUntil).not.toBeNull();

      const expectedMinutes = calculateLockoutDuration(n);
      const actualMinutes = (row!.lockedUntil!.getTime() - Date.now()) / 60_000;
      // ±2s of scheduling slack between the last insert and this read.
      expect(actualMinutes).toBeGreaterThan(expectedMinutes - 0.05);
      expect(actualMinutes).toBeLessThanOrEqual(expectedMinutes);
    }
  });

  it("S12 regression: concurrent FIRST failures for a fresh identifier do not 23505", async () => {
    // Exactly the race that produced 500s: N parallel attempts, zero
    // prior rows. Under the old SELECT-then-INSERT flow at least one
    // call raised a unique-violation; the upsert resolves them all.
    await expect(
      Promise.all(Array.from({ length: 8 }, () => recordFailedAttempt("user:racer"))),
    ).resolves.toBeDefined();

    const row = await fetchRow("user:racer");
    expect(row!.attemptCount).toBe(8);
    expect(row!.lockedUntil).not.toBeNull(); // 8 ≥ 5 → locked
  });

  it("S12 regression: concurrent failures on an EXISTING row stay lossless", async () => {
    await recordFailedAttempt("user:seeded"); // row exists, count 1
    await expect(
      Promise.all(Array.from({ length: 4 }, () => recordFailedAttempt("user:seeded"))),
    ).resolves.toBeDefined();
    const row = await fetchRow("user:seeded");
    expect(row!.attemptCount).toBe(5); // 1 + 4, no lost increments
  });
});

describe("checkLockout / resetAttempts — behaviour unchanged by the upsert", () => {
  it("checkLockout reports locked=true with lockedUntil while the lock is live", async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt("user:locked");
    const verdict = await checkLockout("user:locked");
    expect(verdict.locked).toBe(true);
    expect(verdict.attemptCount).toBe(5);
    expect(verdict.lockedUntil).not.toBeNull();
  });

  it("an expired lock resets the counter (keep the row for tracking)", async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt("user:expired");
    // Force the lock into the past.
    await db.execute(
      sql`UPDATE login_attempts SET locked_until = now() - interval '1 minute' WHERE identifier = ${"user:expired"}`,
    );
    const verdict = await checkLockout("user:expired");
    expect(verdict.locked).toBe(false);
    expect(verdict.attemptCount).toBe(0);
    // Row survives, reset — the identifier stays tracked.
    const row = await fetchRow("user:expired");
    expect(row).not.toBeNull();
    expect(row!.attemptCount).toBe(0);
  });

  it("resetAttempts clears count + lock (successful login)", async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt("user:reset");
    await resetAttempts("user:reset");
    const verdict = await checkLockout("user:reset");
    expect(verdict.locked).toBe(false);
    expect(verdict.attemptCount).toBe(0);
  });
});

// Guard against accidental identifier drift between this file's helpers
// and the real drizzle schema import path.
it("calculateLockoutDuration — documented exponential backoff", () => {
  expect(calculateLockoutDuration(5)).toBe(15);
  expect(calculateLockoutDuration(6)).toBe(30);
  expect(calculateLockoutDuration(10)).toBe(30);
  expect(calculateLockoutDuration(11)).toBe(60);
  expect(calculateLockoutDuration(15)).toBe(60);
  expect(calculateLockoutDuration(16)).toBe(120);
});
