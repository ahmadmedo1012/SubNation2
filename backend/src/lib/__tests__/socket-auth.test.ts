import { describe, expect, it } from "vitest";
import { signAdminToken, signUserToken } from "../jwt";
import {
  authenticateSocketHandshake,
  authorizeJoinAdmin,
  authorizeJoinUser,
  parseCookieHeader,
  type SocketIdentity,
} from "../socket";

// ─────────────────────────────────────────────────────────────────────
// SECURITY TEST SUITE for Socket.IO auth gate (audit P0-1).
//
// These tests exercise the pure functions that the io.use middleware
// + the join-user / join-admin handlers delegate to. They prove:
//
//   1. Connections without ANY valid token are rejected.
//   2. Connections with a malformed/expired token are rejected.
//   3. A valid user token CANNOT be used to forge a join-user with a
//      different userId.
//   4. A user-only socket CANNOT join the admin room by emitting
//      join-admin.
//   5. A valid admin token CAN join the admin room.
//   6. A socket holding BOTH tokens gets BOTH capabilities (rare,
//      but legitimate when an admin is also browsing as a user).
//   7. Cookie parsing tolerates malformed input (no DoS).
//
// Tests use the real signUserToken / signAdminToken — no mocks. The
// JWT secrets are loaded from process.env.SESSION_SECRET in the
// vitest setup; the test runner sets it the same way the runtime
// does.
// ─────────────────────────────────────────────────────────────────────

describe("parseCookieHeader", () => {
  it("returns empty object on missing/null/empty header", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
  });

  it("parses a single cookie", () => {
    expect(parseCookieHeader("auth_token=abc123")).toEqual({ auth_token: "abc123" });
  });

  it("parses multiple cookies", () => {
    const parsed = parseCookieHeader("auth_token=abc; admin_token=def; foo=bar");
    expect(parsed.auth_token).toBe("abc");
    expect(parsed.admin_token).toBe("def");
    expect(parsed.foo).toBe("bar");
  });

  it("decodes URL-encoded values", () => {
    expect(parseCookieHeader("k=hello%20world")).toEqual({ k: "hello world" });
  });

  it("tolerates malformed pieces without throwing (DoS defense)", () => {
    // Trailing semicolons, missing equals, empty names, lone =, all
    // safely ignored.
    const parsed = parseCookieHeader(";;;abc;auth_token=valid;=lone;extra==double");
    expect(parsed.auth_token).toBe("valid");
    expect(parsed.extra).toBe("=double");
    // No crash, no key for "abc" (no equals), no key for "" (empty name)
    expect(parsed[""]).toBeUndefined();
  });

  it("handles undecodable percent escapes by falling back to raw", () => {
    // %ZZ is not a valid percent-encoding. decodeURIComponent throws.
    // Parser must NOT propagate the error.
    expect(() => parseCookieHeader("k=%ZZ")).not.toThrow();
    const parsed = parseCookieHeader("k=%ZZ");
    expect(parsed.k).toBe("%ZZ");
  });
});

describe("authenticateSocketHandshake", () => {
  it("returns null when no cookie and no auth field is present", () => {
    expect(authenticateSocketHandshake({})).toBeNull();
    expect(authenticateSocketHandshake({ headers: {} })).toBeNull();
    expect(authenticateSocketHandshake({ headers: { cookie: "" } })).toBeNull();
  });

  it("returns null when cookies exist but neither token is set", () => {
    const handshake = { headers: { cookie: "session_id=foo; csrf=bar" } };
    expect(authenticateSocketHandshake(handshake)).toBeNull();
  });

  it("returns null when auth_token is malformed", () => {
    const handshake = {
      headers: { cookie: "auth_token=this-is-not-a-jwt" },
    };
    expect(authenticateSocketHandshake(handshake)).toBeNull();
  });

  it("returns null when auth_token has the wrong signature", () => {
    // Token signed with admin secret should NOT verify as a user token.
    const adminSigned = signAdminToken({ adminId: 1, role: "super_admin" });
    const handshake = { headers: { cookie: `auth_token=${adminSigned}` } };
    expect(authenticateSocketHandshake(handshake)).toBeNull();
  });

  it("verifies a valid user token from the cookie", () => {
    const token = signUserToken({ userId: 42 });
    const handshake = { headers: { cookie: `auth_token=${token}` } };
    const identity = authenticateSocketHandshake(handshake);
    expect(identity).not.toBeNull();
    expect(identity!.userId).toBe(42);
    expect(identity!.isAdmin).toBe(false);
    expect(identity!.adminId).toBeUndefined();
  });

  it("verifies a valid user token from handshake.auth.userToken", () => {
    const token = signUserToken({ userId: 7 });
    const identity = authenticateSocketHandshake({ auth: { userToken: token } });
    expect(identity).not.toBeNull();
    expect(identity!.userId).toBe(7);
  });

  it("verifies a valid admin token from the cookie", () => {
    const token = signAdminToken({ adminId: 99, role: "super_admin" });
    const handshake = { headers: { cookie: `admin_token=${token}` } };
    const identity = authenticateSocketHandshake(handshake);
    expect(identity).not.toBeNull();
    expect(identity!.adminId).toBe(99);
    expect(identity!.role).toBe("super_admin");
    expect(identity!.isAdmin).toBe(true);
  });

  it("attaches BOTH identities when both tokens are present", () => {
    const userTok = signUserToken({ userId: 5 });
    const adminTok = signAdminToken({ adminId: 1, role: "support" });
    const handshake = {
      headers: { cookie: `auth_token=${userTok}; admin_token=${adminTok}` },
    };
    const identity = authenticateSocketHandshake(handshake);
    expect(identity).not.toBeNull();
    expect(identity!.userId).toBe(5);
    expect(identity!.adminId).toBe(1);
    expect(identity!.isAdmin).toBe(true);
  });

  it("prefers cookie over handshake.auth when both supplied", () => {
    // Cookie holds userId=10, handshake.auth holds a token for userId=20.
    // The cookie path is checked first; once it succeeds, the auth
    // fallback is not consulted for the same slot.
    const cookieToken = signUserToken({ userId: 10 });
    const authToken = signUserToken({ userId: 20 });
    const handshake = {
      headers: { cookie: `auth_token=${cookieToken}` },
      auth: { userToken: authToken },
    };
    const identity = authenticateSocketHandshake(handshake);
    expect(identity!.userId).toBe(10);
  });
});

describe("authorizeJoinUser — forgery defense", () => {
  function makeIdentity(overrides: Partial<SocketIdentity> = {}): SocketIdentity {
    return { userId: 42, isAdmin: false, ...overrides };
  }

  it("returns null when identity is missing", () => {
    expect(authorizeJoinUser(undefined, 42)).toBeNull();
  });

  it("returns null when identity has no userId (admin-only socket)", () => {
    const identity: SocketIdentity = { adminId: 1, role: "support", isAdmin: true };
    expect(authorizeJoinUser(identity, 42)).toBeNull();
  });

  it("returns null when requested userId differs from verified userId", () => {
    // THE CORE FORGERY CASE: an attacker holds a valid token for
    // userId=42 but tries to join user:99. Must be rejected.
    expect(authorizeJoinUser(makeIdentity(), 99)).toBeNull();
    expect(authorizeJoinUser(makeIdentity(), "99")).toBeNull();
    expect(authorizeJoinUser(makeIdentity(), 0)).toBeNull();
    expect(authorizeJoinUser(makeIdentity(), -1)).toBeNull();
  });

  it("returns null on garbage payloads", () => {
    expect(authorizeJoinUser(makeIdentity(), null)).toBeNull();
    expect(authorizeJoinUser(makeIdentity(), undefined)).toBeNull();
    expect(authorizeJoinUser(makeIdentity(), "abc")).toBeNull();
    expect(authorizeJoinUser(makeIdentity(), {})).toBeNull();
    expect(authorizeJoinUser(makeIdentity(), [42])).toBeNull();
    expect(authorizeJoinUser(makeIdentity(), Number.NaN)).toBeNull();
    expect(authorizeJoinUser(makeIdentity(), Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns the verified userId when the requested id matches", () => {
    expect(authorizeJoinUser(makeIdentity({ userId: 42 }), 42)).toBe(42);
    // String coercion is fine — frontend sometimes sends as string.
    expect(authorizeJoinUser(makeIdentity({ userId: 42 }), "42")).toBe(42);
  });
});

describe("authorizeJoinAdmin — forgery defense", () => {
  it("rejects undefined identity", () => {
    expect(authorizeJoinAdmin(undefined)).toBe(false);
  });

  it("rejects user-only socket (no admin token)", () => {
    const identity: SocketIdentity = { userId: 42, isAdmin: false };
    expect(authorizeJoinAdmin(identity)).toBe(false);
  });

  it("rejects identity where isAdmin is anything other than true", () => {
    // Defense in depth: even if a user-controlled JSON ever leaked
    // truthy-but-not-`true` into socket.data.identity.isAdmin (e.g. a
    // string "true" from a misuse of JSON.parse), the strict equality
    // check rejects it.
    expect(
      authorizeJoinAdmin({ userId: 1, isAdmin: 1 as unknown as boolean }),
    ).toBe(false);
    expect(
      authorizeJoinAdmin({ userId: 1, isAdmin: "true" as unknown as boolean }),
    ).toBe(false);
  });

  it("accepts admin identity with isAdmin === true", () => {
    const identity: SocketIdentity = { adminId: 1, role: "super_admin", isAdmin: true };
    expect(authorizeJoinAdmin(identity)).toBe(true);
  });
});
