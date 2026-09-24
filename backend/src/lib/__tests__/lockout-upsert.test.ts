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
 * r110 (R110-01): recordFailedAttempt/calculateLockoutDuration take an
 * optional per-namespace policy {maxAttempts, baseLockoutMinutes} — the
 * second describe block pins the parameterized envelope against the
 * same SQL mirror, using the exact numbers the admin-login route passes
 * for its global `admin-username:` key (10 failures / 15-min base).
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

// ── r110 (R110-01): parameterized policy — the admin-username namespace ──────

describe("recordFailedAttempt with a custom policy — r110 admin-username envelope (10 failures / 15 min)", () => {
  // Exactly what routes/admin/auth.ts passes for its GLOBAL per-username
  // password key (USERNAME_LOCKOUT_POLICY) — deliberately double the
  // default 5-failure threshold to blunt the spoofed-username lockout
  // trade-off, same 15-min base + doubling shape as every other key.
  const POLICY = { maxAttempts: 10, baseLockoutMinutes: 15 };

  it("9 failures stay unlocked; the 10th locks at the base 15-min duration", async () => {
    for (let i = 0; i < 9; i++) await recordFailedAttempt("admin-username:root", POLICY);
    let row = await fetchRow("admin-username:root");
    expect(row!.attemptCount).toBe(9);
    expect(row!.lockedUntil).toBeNull();

    await recordFailedAttempt("admin-username:root", POLICY);
    row = await fetchRow("admin-username:root");
    expect(row!.attemptCount).toBe(10);
    expect(row!.lockedUntil).not.toBeNull();
    const minutes = (row!.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it("lockout duration follows the parameterized exponential formula (SQL ⇄ JS mirror)", async () => {
    // Cross-check every failure-count plateau against the JS function —
    // the parameterized SQL CASE must agree with the parameterized
    // calculateLockoutDuration exactly (same invariant as the default
    // envelope's mirror test above).
    const counts = [10, 11, 20, 21];
    for (const n of counts) {
      await db.execute(sql.raw(`DELETE FROM login_attempts;`));
      const identifier = `admin-username:form_${n}`;
      for (let i = 0; i < n; i++) await recordFailedAttempt(identifier, POLICY);
      const row = await fetchRow(identifier);
      expect(row!.attemptCount).toBe(n);
      expect(row!.lockedUntil).not.toBeNull();

      const expectedMinutes = calculateLockoutDuration(n, POLICY);
      const actualMinutes = (row!.lockedUntil!.getTime() - Date.now()) / 60_000;
      // ±3s of scheduling slack between the last insert and this read.
      expect(actualMinutes).toBeGreaterThan(expectedMinutes - 0.05);
      expect(actualMinutes).toBeLessThanOrEqual(expectedMinutes);
    }
  });

  it("an expired policy lock decays the counter (same forced-expiry as the default envelope)", async () => {
    for (let i = 0; i < 10; i++) await recordFailedAttempt("admin-username:expired", POLICY);
    // Force the lock into the past.
    await db.execute(
      sql`UPDATE login_attempts SET locked_until = now() - interval '1 minute' WHERE identifier = ${"admin-username:expired"}`,
    );
    const verdict = await checkLockout("admin-username:expired");
    expect(verdict.locked).toBe(false);
    expect(verdict.attemptCount).toBe(0);
    const row = await fetchRow("admin-username:expired");
    expect(row).not.toBeNull();
    expect(row!.attemptCount).toBe(0);
  });

  it("resetAttempts clears a policy-locked envelope (successful login)", async () => {
    for (let i = 0; i < 10; i++) await recordFailedAttempt("admin-username:reset", POLICY);
    await resetAttempts("admin-username:reset");
    const verdict = await checkLockout("admin-username:reset");
    expect(verdict.locked).toBe(false);
    expect(verdict.attemptCount).toBe(0);
  });

  it("no-policy callers keep the default 5/15 envelope (pre-existing keys unchanged)", async () => {
    for (let i = 0; i < 4; i++) await recordFailedAttempt("user:default");
    let row = await fetchRow("user:default");
    expect(row!.attemptCount).toBe(4);
    expect(row!.lockedUntil).toBeNull();
    await recordFailedAttempt("user:default"); // 5th — DEFAULT threshold
    row = await fetchRow("user:default");
    expect(row!.attemptCount).toBe(5);
    expect(row!.lockedUntil).not.toBeNull(); // 5 ≥ 5 → locked at 15 min
  });

  it("calculateLockoutDuration — policy overrides shift the plateau, defaults are untouched", () => {
    expect(calculateLockoutDuration(10, POLICY)).toBe(15);
    expect(calculateLockoutDuration(11, POLICY)).toBe(30);
    expect(calculateLockoutDuration(20, POLICY)).toBe(30);
    expect(calculateLockoutDuration(21, POLICY)).toBe(60);
    // Defaults (no policy) — same numbers the block above pinned pre-r110.
    expect(calculateLockoutDuration(5)).toBe(15);
    expect(calculateLockoutDuration(6)).toBe(30);
    expect(calculateLockoutDuration(11)).toBe(60);
  });
});

// ── B2-F1 (R111, round-111 B2 audit): identifier clamp to varchar(100) ──────
//
// The admin login route composes `admin:${username}:${ip}` /
// `admin-username:${username}` from the SUBMITTED username, and the
// generated AdminLoginBody schema has no username bound — a 100+ char
// username overflowed login_attempts.identifier with SQLSTATE 22001 →
// 500 + a Sentry event per failed attempt (empirically reproduced),
// breaking the uniform-401 parity of the 98-F3/R110-01 branches.
// recordFailedAttempt/checkLockout/resetAttempts now clamp the
// identifier to the column length BEFORE any SQL.

describe("B2-F1 — identifier clamp to varchar(100) (R111)", () => {
  it("a 150-char identifier (composed admin-login key) stores clamped, never 22001", async () => {
    // The exact live crash shape: a long username inside the per-(username,ip) key.
    const longKey = `admin:${"u".repeat(130)}:127.0.0.1`;
    expect(longKey.length).toBeGreaterThan(100);

    await recordFailedAttempt(longKey);
    const stored = await fetchRow(longKey.slice(0, 100));
    expect(stored).not.toBeNull();
    expect(stored!.attemptCount).toBe(1);
  });

  it("checkLockout consults the SAME clamped key — the envelope still locks at 5 failures", async () => {
    const longKey = `admin-username:${"x".repeat(120)}`;
    for (let i = 0; i < 4; i++) await recordFailedAttempt(longKey);
    expect((await checkLockout(longKey)).locked).toBe(false);
    await recordFailedAttempt(longKey); // 5th
    const verdict = await checkLockout(longKey);
    expect(verdict.locked).toBe(true);
    expect(verdict.lockedUntil).not.toBeNull();
  });

  it("resetAttempts clears the clamped envelope (a correct login self-heals the counter)", async () => {
    const longKey = `admin:${"y".repeat(150)}:10.0.0.1`;
    for (let i = 0; i < 5; i++) await recordFailedAttempt(longKey);
    expect((await checkLockout(longKey)).locked).toBe(true);
    await resetAttempts(longKey);
    expect((await checkLockout(longKey)).locked).toBe(false);
  });

  it("two identifiers sharing the first 100 chars share ONE envelope (merged, not split)", async () => {
    // Truncation necessarily merges keys with a common 100-char prefix —
    // both name nonexistent admins, so a shared envelope is the accepted
    // (documented) trade-off vs. a 500 on the money-adjacent auth path.
    const a = `admin:${"a".repeat(90)}SUFFIX-A:1.2.3.4`;
    const b = `admin:${"a".repeat(90)}SUFFIX-B:5.6.7.8`;
    await recordFailedAttempt(a);
    await recordFailedAttempt(b);
    const row = await fetchRow(a.slice(0, 100));
    expect(row!.attemptCount).toBe(2);
  });
});
