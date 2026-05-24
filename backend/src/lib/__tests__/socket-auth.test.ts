import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { JWT_SECRET, signAdminToken, signUserToken } from "../jwt";
import {
  authenticateSocketHandshake,
  authorizeJoinAdmin,
  authorizeJoinUser,
  isOriginAllowed,
  parseCookieHeader,
  type SocketIdentity,
} from "../socket";

// ─────────────────────────────────────────────────────────────────────
// SECURITY TEST SUITE for Socket.IO auth gate (audit P0-1 + P0-2).
//
// Pure-function coverage. The middleware and event handlers in
// initSocket() delegate to these helpers; testing them in isolation
// gives us deterministic, fast assertions without spinning up a real
// socket.io server.
//
// What is NOT tested here, by design:
//   - Reconnect persistence — io.use runs per connection by socket.io
//     contract, so reconnect = re-auth. Library behavior, not ours.
//   - Concurrent socket isolation — each socket has its own
//     socket.data; library guarantee.
//   - Disconnect cleanup — socket.io handles room cleanup on
//     disconnect; library guarantee.
//   These would need a full integration harness (real http server +
//   real socket.io-client). Tracked separately if behavior ever
//   differs from the library's documented invariants.
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
    const parsed = parseCookieHeader(";;;abc;auth_token=valid;=lone;extra==double");
    expect(parsed.auth_token).toBe("valid");
    expect(parsed.extra).toBe("=double");
    expect(parsed[""]).toBeUndefined();
  });

  it("handles undecodable percent escapes by falling back to raw", () => {
    expect(() => parseCookieHeader("k=%ZZ")).not.toThrow();
    const parsed = parseCookieHeader("k=%ZZ");
    expect(parsed.k).toBe("%ZZ");
  });
});

describe("isOriginAllowed (P0-2)", () => {
  it("permissive in dev (empty allowlist) — all origins pass", () => {
    expect(isOriginAllowed("https://random.example.com", [])).toBe(true);
    expect(isOriginAllowed(undefined, [])).toBe(true);
    expect(isOriginAllowed("", [])).toBe(true);
  });

  it("strict in prod — only listed origins pass", () => {
    const list = ["https://subnation.ly", "https://www.subnation.ly"];
    expect(isOriginAllowed("https://subnation.ly", list)).toBe(true);
    expect(isOriginAllowed("https://www.subnation.ly", list)).toBe(true);
    expect(isOriginAllowed("https://evil.com", list)).toBe(false);
    expect(isOriginAllowed("https://subnation.ly.evil.com", list)).toBe(false);
    expect(isOriginAllowed("https://SUBNATION.LY", list)).toBe(false); // case-strict
  });

  it("strict mode rejects missing/empty origin", () => {
    const list = ["https://subnation.ly"];
    expect(isOriginAllowed(undefined, list)).toBe(false);
    expect(isOriginAllowed("", list)).toBe(false);
  });

  it("rejects non-string origin (defense vs. malformed proxy headers)", () => {
    const list = ["https://subnation.ly"];
    expect(isOriginAllowed(null as unknown as string, list)).toBe(false);
    expect(isOriginAllowed(123 as unknown as string, list)).toBe(false);
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
    const adminSigned = signAdminToken({ adminId: 1, role: "super_admin" });
    const handshake = { headers: { cookie: `auth_token=${adminSigned}` } };
    expect(authenticateSocketHandshake(handshake)).toBeNull();
  });

  it("rejects an EXPIRED user token (P0-2 — explicit expiry test)", () => {
    // Create a token that expired 10 seconds ago. jsonwebtoken's
    // numeric expiresIn is seconds-from-now; negative = already
    // expired. verifyUserTokenDetailed must surface this via its
    // "expired" reason path, and authenticateSocketHandshake treats
    // any verify-failure as "no identity" → null.
    const expired = jwt.sign({ userId: 42 }, JWT_SECRET, { expiresIn: -10 });
    const handshake = { headers: { cookie: `auth_token=${expired}` } };
    expect(authenticateSocketHandshake(handshake)).toBeNull();
  });

  it("rejects a tampered user token (signature mutated)", () => {
    const valid = signUserToken({ userId: 42 });
    // Flip the last character of the signature segment.
    const segments = valid.split(".");
    const tampered =
      segments[0] +
      "." +
      segments[1] +
      "." +
      segments[2].slice(0, -1) +
      (segments[2].endsWith("A") ? "B" : "A");
    const handshake = { headers: { cookie: `auth_token=${tampered}` } };
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

describe("authorizeJoinUser — forgery defense (legacy event compat)", () => {
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

describe("identity isolation (P0-2 — concurrent connection semantics)", () => {
  // Each call to authenticateSocketHandshake builds a fresh
  // SocketIdentity object. There is no cross-handshake state. This
  // is what guarantees concurrent connections cannot cross-pollute.
  it("two independent handshakes return distinct identity objects", () => {
    const tokA = signUserToken({ userId: 100 });
    const tokB = signUserToken({ userId: 200 });
    const idA = authenticateSocketHandshake({ headers: { cookie: `auth_token=${tokA}` } });
    const idB = authenticateSocketHandshake({ headers: { cookie: `auth_token=${tokB}` } });
    expect(idA).not.toBe(idB);
    expect(idA!.userId).toBe(100);
    expect(idB!.userId).toBe(200);
    // Mutating one MUST NOT affect the other.
    idA!.userId = 999;
    expect(idB!.userId).toBe(200);
  });

  it("the same handshake invoked twice returns separately-allocated objects", () => {
    const tok = signUserToken({ userId: 7 });
    const h = { headers: { cookie: `auth_token=${tok}` } };
    const id1 = authenticateSocketHandshake(h);
    const id2 = authenticateSocketHandshake(h);
    expect(id1).not.toBe(id2);
    expect(id1!.userId).toBe(id2!.userId);
  });
});
