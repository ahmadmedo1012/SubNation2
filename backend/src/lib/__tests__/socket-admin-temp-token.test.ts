import { describe, expect, it } from "vitest";
import { signAdminToken, signUserToken } from "../jwt";
import { authenticateSocketHandshake, authorizeJoinAdmin } from "../socket";

/**
 * SEC-92-02 (round-92 B1 security audit) — Socket.IO admin identity must
 * reject the 2FA TEMP token.
 *
 * The temp token is minted by POST /api/admin/login when TOTP is enabled;
 * holding it proves password possession only. requireAdmin rejects it
 * everywhere, but authenticateSocketHandshake used to accept it as a FULL
 * admin identity → the socket was auto-joined to "admin-room" (live
 * order/topup/alert admin events, PII-bearing payloads) — a 2FA bypass
 * for the real-time surface.
 *
 * Tested via the exported pure handshake-auth function — the io.use()
 * middleware and the auto-join in io.on("connection") both delegate to
 * the identity it returns (identity.isAdmin === true is the exact
 * condition guarding `socket.join("admin-room")`).
 */

const TEMP_ADMIN = signAdminToken({ adminId: 9, role: "super_admin", isTemp: true });
const FULL_ADMIN = signAdminToken({ adminId: 9, role: "super_admin" });

describe("authenticateSocketHandshake — 2FA temp token (SEC-92-02)", () => {
  it("temp admin token alone → null (connection rejected, no admin identity)", () => {
    const identity = authenticateSocketHandshake({
      headers: { cookie: `admin_token=${TEMP_ADMIN}` },
    });
    expect(identity).toBeNull();
  });

  it("temp admin token via handshake.auth.adminToken → null", () => {
    const identity = authenticateSocketHandshake({ auth: { adminToken: TEMP_ADMIN } });
    expect(identity).toBeNull();
  });

  it("temp admin token + valid USER token → user identity only; NO admin identity, no admin-room join", () => {
    const identity = authenticateSocketHandshake({
      headers: { cookie: `auth_token=${signUserToken({ userId: 42 })}; admin_token=${TEMP_ADMIN}` },
    });
    // Connection accepted as the verified USER — but the temp admin token
    // must not elevate it.
    expect(identity).not.toBeNull();
    expect(identity!.userId).toBe(42);
    expect(identity!.isAdmin).toBe(false);
    expect(identity!.adminId).toBeUndefined();
    expect(identity!.role).toBeUndefined();
    // The exact predicate guarding socket.join("admin-room"):
    expect(authorizeJoinAdmin(identity ?? undefined)).toBe(false);
  });

  it("full admin token → admin identity intact (isAdmin true, admin-room join allowed)", () => {
    const identity = authenticateSocketHandshake({
      headers: { cookie: `admin_token=${FULL_ADMIN}` },
    });
    expect(identity).not.toBeNull();
    expect(identity!.adminId).toBe(9);
    expect(identity!.role).toBe("super_admin");
    expect(identity!.isAdmin).toBe(true);
    expect(authorizeJoinAdmin(identity ?? undefined)).toBe(true);
  });

  it("legacy admin token without isTemp claim (pre-2FA) still accepted", () => {
    const legacy = signAdminToken({ adminId: 3, role: "admin" });
    const identity = authenticateSocketHandshake({
      headers: { cookie: `admin_token=${legacy}` },
    });
    expect(identity).not.toBeNull();
    expect(identity!.isAdmin).toBe(true);
  });

  it("isTemp must be strictly true — falsy values do not strip admin identity", () => {
    const weird = signAdminToken({ adminId: 4, role: "admin", isTemp: 0 });
    const identity = authenticateSocketHandshake({
      headers: { cookie: `admin_token=${weird}` },
    });
    expect(identity).not.toBeNull();
    expect(identity!.isAdmin).toBe(true);
  });
});
