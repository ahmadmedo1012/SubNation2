import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, sessionsTable, usersTable } from "../../test/db";
import { __clearSessionValidityCacheForTests, isSessionRowLive } from "../session-liveness";

/**
 * 93-A1 S1/S2 (round-93) — shared session-row liveness probe.
 *
 * Extracted verbatim from requireUser so the Socket.IO handshake gate
 * and /api/auth/probe enforce the exact same revocation semantics as
 * every authed HTTP request. These tests pin the probe contract the
 * three surfaces now share:
 *
 *   - row exists + unexpired  → live
 *   - row deleted (logout / logout-all / user deletion) → dead
 *   - row expired             → dead
 *   - 60 s cache              → a deleted row stays "live" until the
 *                                cache entry ages out (documented
 *                                trade-off, mirrors requireUser)
 */

let userSeq = 0;
async function seedSession(options: { expiresInMs?: number } = {}): Promise<string> {
  userSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9100${String(userSeq).padStart(5, "0")}` })
    .returning();
  const sessionId = randomUUID();
  await db.insert(sessionsTable).values({
    id: sessionId,
    userId: u.id,
    expiresAt: new Date(Date.now() + (options.expiresInMs ?? 30 * 24 * 60 * 60 * 1000)),
  });
  return sessionId;
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  __clearSessionValidityCacheForTests();
});

describe("isSessionRowLive (93-A1 S1/S2 shared probe)", () => {
  it("live row → true", async () => {
    const sessionId = await seedSession();
    await expect(isSessionRowLive(sessionId)).resolves.toBe(true);
  });

  it("row deleted (logout / logout-all) → false", async () => {
    const sessionId = await seedSession();
    await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
    await expect(isSessionRowLive(sessionId)).resolves.toBe(false);
  });

  it("row expired (expires_at in the past) → false", async () => {
    const sessionId = await seedSession({ expiresInMs: -1000 });
    await expect(isSessionRowLive(sessionId)).resolves.toBe(false);
  });

  it("never-existing row → false", async () => {
    await expect(isSessionRowLive(randomUUID())).resolves.toBe(false);
  });

  it("boundary: expires_at exactly now is NOT live (gte(now) is exclusive of elapsed time)", async () => {
    const sessionId = await seedSession({ expiresInMs: 1 });
    await new Promise((r) => setTimeout(r, 5)); // let it tick past
    await expect(isSessionRowLive(sessionId)).resolves.toBe(false);
  });

  describe("60 s in-process cache (documented propagation trade-off)", () => {
    it("a row deleted right after a live probe stays cached-live until the TTL ages out", async () => {
      const sessionId = await seedSession();
      // First probe caches the row as live for 60 s.
      await expect(isSessionRowLive(sessionId)).resolves.toBe(true);

      // Revoke AFTER the probe.
      await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));

      // Still "live" — served from cache, exactly like requireUser's
      // behavior on the HTTP surface (revocation propagates within
      // ≤ 60 s + cache lifetime).
      await expect(isSessionRowLive(sessionId)).resolves.toBe(true);

      // After the cache entry expires, the DB is consulted again.
      const originalNow = Date.now;
      const start = Date.now();
      Date.now = () => start + 61_000;
      try {
        await expect(isSessionRowLive(sessionId)).resolves.toBe(false);
      } finally {
        Date.now = originalNow;
      }
    });

    it("cache is keyed per sessionId — unrelated revocations don't poison other sessions", async () => {
      const a = await seedSession();
      const b = await seedSession();
      await expect(isSessionRowLive(a)).resolves.toBe(true);
      await db.delete(sessionsTable).where(eq(sessionsTable.id, b));
      // b was never probed → no cache entry → straight DB verdict.
      await expect(isSessionRowLive(b)).resolves.toBe(false);
      // a's cached verdict unaffected.
      await expect(isSessionRowLive(a)).resolves.toBe(true);
    });
  });
});
