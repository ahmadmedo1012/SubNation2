import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../test/db";
import type { Socket } from "socket.io";
import { ADMIN_ALERTS_ROOM, reverifyAndEnforce, type SocketIdentity } from "../socket";

/**
 * R127-B6-1 (B6 sockets audit) — alert-room scope reconciliation in
 * reverifyAndEnforce.
 *
 * The AUD103-3-F2 (r103) reconciliation block ("a scope granted or
 * removed mid-connection takes effect within one re-verify interval")
 * sat AFTER the `if (liveness.ok) return;` early return — its guard
 * tested `liveness.ok` on a path only reachable when `liveness.ok` is
 * false, so it was dead code. A `support` scope revoked on an otherwise
 * ACTIVE admin (scope revocation ≠ session revocation — liveness stays
 * ok) kept streaming admin-alert-new PII (product names, coupon codes,
 * risk references) on the WS surface for the life of the connection
 * while the HTTP side correctly 403'd.
 *
 * These tests pin the moved block against the real DB probe
 * (verifySocketIdentityLive consults admin_users.permissions):
 *   1. healthy admin + support scope → stays/joined in the alert room;
 *   2. scope REVOKED (admin still active) → the next re-verify tick
 *      EVICTS from the alert room WITHOUT disconnecting the socket;
 *   3. scope GRANTED mid-connection → the next tick joins the room;
 *   4. "all" wildcard still passes hasAlertScope;
 *   5. a revoked admin session (adminRevoked path) still leaves BOTH
 *      admin rooms — the reconciliation must not shadow the revocation
 *      enforcement below it.
 */

/** Minimal Socket stand-in covering the surface reverifyAndEnforce
 * touches: data.identity, room join/leave bookkeeping, disconnect flag
 * and the handshake headers recordRejection's getRemoteAddr reads. */
function fakeSocket(identity: SocketIdentity): {
  socket: Socket;
  rooms: Set<string>;
  state: { disconnected: boolean };
} {
  const rooms = new Set<string>();
  const state = { disconnected: false };
  const socket = {
    id: `sock-${randomUUID().slice(0, 8)}`,
    data: { identity },
    handshake: { headers: {} as Record<string, unknown>, address: "127.0.0.1" },
    join: (room: string) => {
      rooms.add(room);
    },
    leave: (room: string) => {
      rooms.delete(room);
    },
    disconnect: () => {
      state.disconnected = true;
    },
  } as unknown as Socket;
  return { socket, rooms, state };
}

async function seedAdmin(permissions: string[]): Promise<number> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `admin_${randomUUID().slice(0, 8)}`,
      passwordHash: "not-a-real-hash",
      isActive: true,
      permissions,
    })
    .returning();
  return a.id;
}

async function setAdminPermissions(adminId: number, permissions: string[]): Promise<void> {
  await db.update(adminUsersTable).set({ permissions }).where(eq(adminUsersTable.id, adminId));
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("reverifyAndEnforce — alert-room scope reconciliation (R127-B6-1)", () => {
  it("healthy admin holding the support scope stays in the alert room across a re-verify tick", async () => {
    const adminId = await seedAdmin(["support", "orders"]);
    const made = fakeSocket({ adminId, role: "admin", isAdmin: true });
    made.rooms.add(ADMIN_ALERTS_ROOM); // joined at connect by the best-effort read

    await reverifyAndEnforce(made.socket);

    expect(made.rooms.has(ADMIN_ALERTS_ROOM)).toBe(true);
    expect(made.state.disconnected).toBe(false);
  });

  it("support scope REVOKED (admin still active) → the next tick EVICTS from the alert room without disconnecting", async () => {
    // R127-B6-1's exact attack scenario: the admin is active (liveness
    // ok — scope revocation is NOT session revocation) but the support
    // scope is gone. The old dead-code block never ran on this path.
    const adminId = await seedAdmin(["support"]);
    const made = fakeSocket({ adminId, role: "admin", isAdmin: true });
    made.rooms.add(ADMIN_ALERTS_ROOM);

    // The scope is revoked server-side between ticks.
    await setAdminPermissions(adminId, ["orders", "users"]);

    await reverifyAndEnforce(made.socket);

    expect(made.rooms.has(ADMIN_ALERTS_ROOM)).toBe(false);
    // Liveness is ok — the socket itself must survive (admin-room
    // counter events are scope-free by design).
    expect(made.state.disconnected).toBe(false);
  });

  it("support scope GRANTED mid-connection → the next tick JOINS the alert room", async () => {
    // The symmetric case the r103 comment promised: an operator promoted
    // to support starts receiving live alerts within one interval,
    // without a reconnect.
    const adminId = await seedAdmin(["orders"]);
    const made = fakeSocket({ adminId, role: "admin", isAdmin: true });
    expect(made.rooms.has(ADMIN_ALERTS_ROOM)).toBe(false);

    await setAdminPermissions(adminId, ["orders", "support"]);

    await reverifyAndEnforce(made.socket);

    expect(made.rooms.has(ADMIN_ALERTS_ROOM)).toBe(true);
  });

  it('"all" wildcard keeps the alert room (hasAlertScope parity with the HTTP mount)', async () => {
    const adminId = await seedAdmin(["all"]);
    const made = fakeSocket({ adminId, role: "admin", isAdmin: true });
    made.rooms.add(ADMIN_ALERTS_ROOM);

    await reverifyAndEnforce(made.socket);

    expect(made.rooms.has(ADMIN_ALERTS_ROOM)).toBe(true);
  });

  it("a non-admin identity on the healthy path touches no rooms (no accidental joins)", async () => {
    // Legacy user token without sessionId skips the session-row probe
    // (requireUser semantics) → liveness ok without seeding.
    const made = fakeSocket({ userId: 7, isAdmin: false });
    await reverifyAndEnforce(made.socket);
    expect(made.rooms.size).toBe(0);
    expect(made.state.disconnected).toBe(false);
  });

  it("revoked admin session still leaves BOTH admin rooms (reconciliation must not shadow enforcement)", async () => {
    // Belt-and-braces: the moved block runs only on the healthy path;
    // the adminRevoked path below it keeps its room-eviction + strip
    // behavior (pinned in socket-revocation.test.ts at the pure level).
    const adminId = await seedAdmin(["support"]);
    const made = fakeSocket({
      adminId,
      role: "admin",
      isAdmin: true,
      adminSessionId: "sess-" + randomUUID(),
    });
    made.rooms.add("admin-room");
    made.rooms.add(ADMIN_ALERTS_ROOM);

    // Soft-disable the admin → adminRevoked → strip → hard disconnect.
    await db
      .update(adminUsersTable)
      .set({ isActive: false })
      .where(eq(adminUsersTable.id, adminId));

    await reverifyAndEnforce(made.socket);

    expect(made.rooms.has("admin-room")).toBe(false);
    expect(made.rooms.has(ADMIN_ALERTS_ROOM)).toBe(false);
    expect(made.state.disconnected).toBe(true);
  });
});
