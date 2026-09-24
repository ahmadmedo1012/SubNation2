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
 *   - row exists + unexpired + OWNED BY THE CALLER → live
 *   - row deleted (logout / logout-all / user deletion) → dead
 *   - row expired             → dead
 *   - row belongs to ANOTHER user → dead (B1-4, R111 — the ownership
 *     predicate the admin twin isValidAdminSession always had)
 *   - 60 s cache              → a deleted row stays "live" until the
 *                                cache entry ages out (documented
 *                                trade-off, mirrors requireUser)
 */

let userSeq = 0;
async function seedUser(): Promise<number> {
  userSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9100${String(userSeq).padStart(5, "0")}` })
    .returning();
  return u.id;
}

async function seedSession(options: { expiresInMs?: number; userId?: number } = {}) {
  const userId = options.userId ?? (await seedUser());
  const sessionId = randomUUID();
  await db.insert(sessionsTable).values({
    id: sessionId,
    userId,
    expiresAt: new Date(Date.now() + (options.expiresInMs ?? 30 * 24 * 60 * 60 * 1000)),
  });
  return { sessionId, userId };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  __clearSessionValidityCacheForTests();
});

describe("isSessionRowLive (93-A1 S1/S2 shared probe)", () => {
  it("live row owned by the caller → true", async () => {
    const { sessionId, userId } = await seedSession();
    await expect(isSessionRowLive(sessionId, userId)).resolves.toBe(true);
  });

  it("row deleted (logout / logout-all) → false", async () => {
    const { sessionId, userId } = await seedSession();
    await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
    await expect(isSessionRowLive(sessionId, userId)).resolves.toBe(false);
  });

  it("row expired (expires_at in the past) → false", async () => {
    const { sessionId, userId } = await seedSession({ expiresInMs: -1000 });
    await expect(isSessionRowLive(sessionId, userId)).resolves.toBe(false);
  });

  it("never-existing row → false", async () => {
    const userId = await seedUser();
    await expect(isSessionRowLive(randomUUID(), userId)).resolves.toBe(false);
  });

  it("boundary: expires_at exactly now is NOT live (gte(now) is exclusive of elapsed time)", async () => {
    const { sessionId, userId } = await seedSession({ expiresInMs: 1 });
    await new Promise((r) => setTimeout(r, 5)); // let it tick past
    await expect(isSessionRowLive(sessionId, userId)).resolves.toBe(false);
  });

  // ── B1-4 (R111, round-111 B1 audit): ownership predicate ────────────────
  //
  // The admin twin (isValidAdminSession) always paired the sid with the
  // token's adminId; the user probe used to match on the sid ALONE, so a
  // session row belonging to user B was "live" for a token claiming
  // user A. Structurally impossible when sids are minted with their
  // tokens — the predicate "costs nothing" and closes the confusion
  // forever (the admin twin's exact wording).
  describe("B1-4 — userId ownership predicate (admin-twin parity)", () => {
    it("a live session row owned by ANOTHER user → false (no mint for the wrong principal)", async () => {
      const owner = await seedUser();
      const { sessionId } = await seedSession({ userId: owner });
      const intruder = await seedUser();

      await expect(isSessionRowLive(sessionId, owner)).resolves.toBe(true);
      await expect(isSessionRowLive(sessionId, intruder)).resolves.toBe(false);
    });

    it("the cache is keyed per (sessionId, userId) — a cached-live verdict for the owner never leaks to another user's probe", async () => {
      const owner = await seedUser();
      const { sessionId } = await seedSession({ userId: owner });
      const intruder = await seedUser();

      // Warm the cache with the OWNER's live verdict.
      await expect(isSessionRowLive(sessionId, owner)).resolves.toBe(true);
      // The intruder's probe must still hit the DB and answer false —
      // the old single-key cache would have served the owner's 60 s
      // cached "live" to anyone probing the same sid.
      await expect(isSessionRowLive(sessionId, intruder)).resolves.toBe(false);
      // Owner's cached verdict unaffected.
      await expect(isSessionRowLive(sessionId, owner)).resolves.toBe(true);
    });

    it("a deleted row stays cached-live for its owner only until the TTL ages out", async () => {
      const { sessionId, userId } = await seedSession();
      await expect(isSessionRowLive(sessionId, userId)).resolves.toBe(true);

      await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
      await expect(isSessionRowLive(sessionId, userId)).resolves.toBe(true);

      const originalNow = Date.now;
      const start = Date.now();
      Date.now = () => start + 61_000;
      try {
        await expect(isSessionRowLive(sessionId, userId)).resolves.toBe(false);
      } finally {
        Date.now = originalNow;
      }
    });

    it("cache is keyed per sessionId — unrelated revocations don't poison other sessions", async () => {
      const a = await seedSession();
      const b = await seedSession();
      await expect(isSessionRowLive(a.sessionId, a.userId)).resolves.toBe(true);
      await db.delete(sessionsTable).where(eq(sessionsTable.id, b.sessionId));
      // b was never probed → no cache entry → straight DB verdict.
      await expect(isSessionRowLive(b.sessionId, b.userId)).resolves.toBe(false);
      // a's cached verdict unaffected.
      await expect(isSessionRowLive(a.sessionId, a.userId)).resolves.toBe(true);
    });
  });
});
