import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  initTestDb,
  resetTestDb,
  sessionsTable,
  usersTable,
} from "../../test/db";
import { signAdminToken, signUserToken } from "../jwt";
import {
  authenticateSocketHandshake,
  stripIdentityForLiveness,
  verifySocketIdentityLive,
  type SocketIdentity,
} from "../socket";
import { __clearSessionValidityCacheForTests } from "../session-liveness";

/**
 * 93-A1 S1 (round-93) — Socket.IO revocation parity.
 *
 * Before this fix the WS handshake verified the JWT ONLY. A user token
 * whose session row was deleted (logout / logout-all) kept its socket —
 * and its user:<id> room membership streaming wallet/order events — for
 * up to 30 days; a soft-disabled admin kept admin-room (live order PII)
 * for the full 8 h admin JWT life. The HTTP surface closed this in
 * round-5 (H1); these tests pin the WS parity added now:
 *
 *   - handshake identity now carries sessionId (the claim requireUser reads)
 *   - verifySocketIdentityLive consults sessions + admin_users.isActive
 *   - stripIdentityForLiveness degrades mixed identities instead of
 *     killing a live component
 *
 * The io.use wiring / periodic re-verify delegate to exactly these
 * functions (see socket.ts layer 2b) — same pure-function testing
 * philosophy as socket-auth.test.ts.
 */

let userSeq = 0;
async function seedUserAndSession(options: { expiresInMs?: number } = {}): Promise<{
  userId: number;
  sessionId: string;
}> {
  userSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9200${String(userSeq).padStart(5, "0")}` })
    .returning();
  const sessionId = randomUUID();
  await db.insert(sessionsTable).values({
    id: sessionId,
    userId: u.id,
    expiresAt: new Date(Date.now() + (options.expiresInMs ?? 30 * 24 * 60 * 60 * 1000)),
  });
  return { userId: u.id, sessionId };
}

async function seedAdmin(options: { isActive?: boolean } = {}): Promise<number> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `admin_${randomUUID().slice(0, 8)}`,
      passwordHash: "not-a-real-hash",
      isActive: options.isActive ?? true,
    })
    .returning();
  return a.id;
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  __clearSessionValidityCacheForTests();
});

describe("authenticateSocketHandshake — sessionId capture (93-A1 S1)", () => {
  it("captures sessionId from the user token payload", () => {
    const token = signUserToken({ userId: 42, sessionId: "sess-1234" });
    const identity = authenticateSocketHandshake({
      headers: { cookie: `auth_token=${token}` },
    });
    expect(identity).not.toBeNull();
    expect(identity!.userId).toBe(42);
    expect(identity!.sessionId).toBe("sess-1234");
  });

  it("legacy user token without sessionId leaves sessionId undefined", () => {
    const token = signUserToken({ userId: 42 });
    const identity = authenticateSocketHandshake({
      headers: { cookie: `auth_token=${token}` },
    });
    expect(identity!.sessionId).toBeUndefined();
  });
});

describe("verifySocketIdentityLive — user component", () => {
  it("live session row → ok", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    const identity: SocketIdentity = { userId, sessionId, isAdmin: false };
    const result = await verifySocketIdentityLive(identity);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("session row deleted (logout / logout-all / user deletion) → session_revoked", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
    const result = await verifySocketIdentityLive({ userId, sessionId, isAdmin: false });
    expect(result).toEqual({
      ok: false,
      userRevoked: true,
      reason: "session_revoked",
    });
  });

  it("expired session row → session_revoked", async () => {
    const { userId, sessionId } = await seedUserAndSession({ expiresInMs: -1000 });
    const result = await verifySocketIdentityLive({ userId, sessionId, isAdmin: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("session_revoked");
    expect(result.userRevoked).toBe(true);
  });

  it("legacy token without sessionId skips the row check (requireUser semantics)", async () => {
    const result = await verifySocketIdentityLive({ userId: 424242, isAdmin: false });
    expect(result.ok).toBe(true);
  });
});

describe("verifySocketIdentityLive — admin component", () => {
  it("active admin → ok", async () => {
    const adminId = await seedAdmin({ isActive: true });
    const identity: SocketIdentity = { adminId, role: "admin", isAdmin: true };
    const result = await verifySocketIdentityLive(identity);
    expect(result.ok).toBe(true);
  });

  it("soft-disabled admin (is_active=false) → admin_inactive", async () => {
    const adminId = await seedAdmin({ isActive: false });
    const result = await verifySocketIdentityLive({ adminId, role: "admin", isAdmin: true });
    expect(result).toEqual({
      ok: false,
      adminRevoked: true,
      reason: "admin_inactive",
    });
  });

  it("deleted admin row → admin_missing", async () => {
    const adminId = await seedAdmin({ isActive: true });
    await db.delete(adminUsersTable).where(eq(adminUsersTable.id, adminId));
    const result = await verifySocketIdentityLive({ adminId, role: "admin", isAdmin: true });
    expect(result).toEqual({
      ok: false,
      adminRevoked: true,
      reason: "admin_missing",
    });
  });
});

describe("verifySocketIdentityLive — mixed identity (user + admin on one socket)", () => {
  it("both live → ok, nothing stripped", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    const adminId = await seedAdmin({ isActive: true });
    const identity: SocketIdentity = {
      userId,
      sessionId,
      adminId,
      role: "admin",
      isAdmin: true,
    };
    const result = await verifySocketIdentityLive(identity);
    expect(result.ok).toBe(true);
    // The strip rule returns the SAME reference when ok.
    expect(stripIdentityForLiveness(identity, result)).toBe(identity);
  });

  it("user revoked + admin live → adminRevoked=false, userRevoked=true; admin component survives the strip", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
    const adminId = await seedAdmin({ isActive: true });
    const identity: SocketIdentity = {
      userId,
      sessionId,
      adminId,
      role: "admin",
      isAdmin: true,
    };
    const result = await verifySocketIdentityLive(identity);
    expect(result.ok).toBe(false);
    expect(result.userRevoked).toBe(true);
    // adminRevoked is only set when the admin check fails — absent means live.
    expect(result.adminRevoked).toBeUndefined();

    const remaining = stripIdentityForLiveness(identity, result);
    expect(remaining).not.toBeNull();
    expect(remaining!.userId).toBeUndefined();
    expect(remaining!.sessionId).toBeUndefined();
    expect(remaining!.adminId).toBe(adminId);
    expect(remaining!.isAdmin).toBe(true);
  });

  it("user live + admin disabled → user component survives the strip", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    const adminId = await seedAdmin({ isActive: false });
    const identity: SocketIdentity = {
      userId,
      sessionId,
      adminId,
      role: "admin",
      isAdmin: true,
    };
    const result = await verifySocketIdentityLive(identity);
    expect(result.adminRevoked).toBe(true);

    const remaining = stripIdentityForLiveness(identity, result);
    expect(remaining).not.toBeNull();
    expect(remaining!.userId).toBe(userId);
    expect(remaining!.isAdmin).toBe(false);
    expect(remaining!.adminId).toBeUndefined();
  });

  it("both revoked → strip yields null (socket must be disconnected)", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
    const adminId = await seedAdmin({ isActive: false });
    const identity: SocketIdentity = {
      userId,
      sessionId,
      adminId,
      role: "admin",
      isAdmin: true,
    };
    const result = await verifySocketIdentityLive(identity);
    expect(result.ok).toBe(false);
    expect(result.userRevoked).toBe(true);
    expect(result.adminRevoked).toBe(true);
    expect(stripIdentityForLiveness(identity, result)).toBeNull();
  });
});

describe("stripIdentityForLiveness — defensive shapes", () => {
  it("liveness ok → same identity object back", () => {
    const identity: SocketIdentity = { userId: 1, isAdmin: false };
    expect(stripIdentityForLiveness(identity, { ok: true })).toBe(identity);
  });

  it("userRevoked flag on an identity without userId → no strip (cannot strip what is not there)", () => {
    const identity: SocketIdentity = { adminId: 1, role: "admin", isAdmin: true };
    const remaining = stripIdentityForLiveness(identity, {
      ok: false,
      userRevoked: true,
      reason: "session_revoked",
    });
    expect(remaining).toBe(identity); // same reference — nothing stripped
  });

  it("adminRevoked flag on a user-only identity → identity unchanged", () => {
    const identity: SocketIdentity = { userId: 5, isAdmin: false };
    const remaining = stripIdentityForLiveness(identity, {
      ok: false,
      adminRevoked: true,
      reason: "admin_inactive",
    });
    expect(remaining).toBe(identity);
  });

  it("user-only identity with revoked session → null (full disconnect)", () => {
    const identity: SocketIdentity = { userId: 5, sessionId: "s", isAdmin: false };
    expect(
      stripIdentityForLiveness(identity, {
        ok: false,
        userRevoked: true,
        reason: "session_revoked",
      }),
    ).toBeNull();
  });
});

describe("end-to-end handshake verdict for a revoked token (S1 attack scenario)", () => {
  it("a signature-valid token whose session was deleted fails the liveness gate exactly like requireUser would", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    // Victim logs out all devices — the sessions row disappears…
    await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
    // …but the ATTACKER still holds the JWT (stolen copy, 30-day life).
    const stolenToken = signUserToken({ userId, sessionId });

    // Handshake still verifies the JWT (cryptographically sound)…
    const identity = authenticateSocketHandshake({
      headers: { cookie: `auth_token=${stolenToken}` },
    });
    expect(identity).not.toBeNull();
    expect(identity!.userId).toBe(userId);

    // …but the liveness layer — the S1 fix — rejects it, so the io.use
    // gate never admits the socket to user:<id>.
    const liveness = await verifySocketIdentityLive(identity!);
    expect(liveness.ok).toBe(false);
    expect(stripIdentityForLiveness(identity!, liveness)).toBeNull();
  });
});
