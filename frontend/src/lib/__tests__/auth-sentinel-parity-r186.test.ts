/**
 * R186-5 (fix-squad 5) — the auth-core pinning suite.
 *
 * Three audit-verified findings land here because each fix's guarantee
 * is otherwise un-pinned (the exact drift class this round exists to
 * close):
 *
 *   1. H-F1 (P2): user-session's 401 router now knows /api/coupons/admin
 *      is an ADMIN surface (mirroring admin-session's R122 A2-P2 arms).
 *      Before, a coupon-admin 401 through customFetch was misrouted to
 *      the USER expiry path — a valid user session torn down + full
 *      cache purge + /login redirect while the admin handler
 *      concurrently redirected to /admin/login. Pinned as the exact
 *      twin of admin-session.test.ts's coupon case, through the REAL
 *      router: delegation to the dynamically-imported admin handler
 *      (spied) + NO user-expiry side effects.
 *
 *   2. H-F6 (P3): COOKIE_AUTH_SENTINEL is hoisted to the cycle-free
 *      leaf lib/auth-sentinel (auth.tsx re-exports it; the token holder
 *      imports it — it could never import from auth.tsx, which imports
 *      the holder). The holder's filter (cookie sessions emit NO
 *      bearer) was previously pinned by NOTHING: one-sided drift would
 *      silently ship `Authorization: Bearer __cookie_session__` on
 *      every cookie-auth request.
 *
 *   3. B-F4 (P3): AuthContextType's logoutAllDevices member is deleted
 *      (zero production consumers; SessionManager owns the honest
 *      logout-all surface). Pinned with a whole-word source scan over
 *      non-test files (the R185 dead-export verification style) so the
 *      member cannot quietly reappear.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminHandlerSpy, toastMock, disconnectMock } = vi.hoisted(() => ({
  // Wraps the REAL handleAdminUnauthorized (implementation wired in the
  // mock factory below) so the delegation assertions observe the exact
  // function user-session's dynamic import resolved to.
  adminHandlerSpy: vi.fn(),
  toastMock: vi.fn(),
  disconnectMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  toast: toastMock,
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

vi.mock("@/lib/socket", () => ({
  // user-session + auth.tsx only consume disconnectSocket; the rest are
  // stubs for other importers of the mocked module in this graph.
  disconnectSocket: disconnectMock,
  reviveSocket: vi.fn(),
  connectSocket: vi.fn(async () => null),
  connectAdminSocket: vi.fn(async () => null),
  getSocket: vi.fn(async () => null),
  SOCKET_RESYNC_EVENT: "subnation:socket-resync",
  __resetSocketStateForTests: vi.fn(),
}));

vi.mock("@/lib/admin-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../admin-session")>();
  adminHandlerSpy.mockImplementation(actual.handleAdminUnauthorized);
  return { ...actual, handleAdminUnauthorized: adminHandlerSpy };
});

import { COOKIE_AUTH_SENTINEL as AUTH_EXPORTED_SENTINEL } from "../auth";
import { getUserAuthToken, setUserAuthToken } from "../auth-token-holder";
import { COOKIE_AUTH_SENTINEL } from "../auth-sentinel";
import { __resetAdminSessionForTests, setAdminSessionMirror } from "../admin-session";
import {
  USER_SESSION_EXPIRED_MESSAGE,
  __resetUserSessionForTests,
  handleUserUnauthorized,
  setUserSessionMirror,
} from "../user-session";

/** Source read relative to the frontend package root (taxonomy-suite idiom). */
const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

// ── H-F1: the 401 router's coupon-admin delegation ─────────────────────────

describe("handleUserUnauthorized — /api/coupons/admin is an ADMIN surface (R186 H-F1)", () => {
  beforeEach(() => {
    __resetUserSessionForTests();
    __resetAdminSessionForTests();
    adminHandlerSpy.mockClear();
    toastMock.mockClear();
    disconnectMock.mockClear();
    // Start on the coupon-admin page so both redirects are observable.
    window.history.pushState({}, "", "/admin/coupons");
  });

  it("delegates a coupon-admin 401 to the ADMIN handler — never the user expiry path", async () => {
    // BOTH sessions active: the pre-H-F1 misroute tore down the valid
    // user session + pushed /login while the admin handler
    // concurrently pushed /admin/login (double toast, conflicting nav).
    setAdminSessionMirror(true, vi.fn());
    const clearUser = vi.fn();
    setUserSessionMirror(true, clearUser);

    // A5-12: the FIRST admin-URL 401 defers through the dynamic import.
    const first = handleUserUnauthorized("/api/coupons/admin");
    expect(first).toBe(false);

    await vi.waitFor(() => {
      expect(adminHandlerSpy).toHaveBeenCalledWith("/api/coupons/admin");
    });
    // The admin handler actually ran: admin toast + /admin/login.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: "انتهت الجلسة — سجّل دخولك مجددًا",
      variant: "destructive",
    });
    expect(window.location.pathname).toBe("/admin/login");

    // The USER expiry path must NOT have run.
    expect(clearUser).not.toHaveBeenCalled();
    expect(disconnectMock).not.toHaveBeenCalled();

    // The handler ref is cached now — the next coupon-admin 401 decides
    // synchronously through the spied module (admin 15 s dedupe →
    // "handled"), exactly like the pre-A5-12 static delegation.
    const second = handleUserUnauthorized("/api/coupons/admin/42");
    expect(second).toBe(true);
    expect(adminHandlerSpy).toHaveBeenCalledWith("/api/coupons/admin/42");
    expect(clearUser).not.toHaveBeenCalled();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("delegates ABSOLUTE coupon-admin URLs too (base-URL deployments — the includes arm)", async () => {
    setAdminSessionMirror(true, vi.fn());
    const clearUser = vi.fn();
    setUserSessionMirror(true, clearUser);

    expect(handleUserUnauthorized("https://api.example.com/api/coupons/admin")).toBe(false);
    await vi.waitFor(() => {
      expect(adminHandlerSpy).toHaveBeenCalledWith("https://api.example.com/api/coupons/admin");
    });
    expect(window.location.pathname).toBe("/admin/login");
    expect(clearUser).not.toHaveBeenCalled();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it("storefront /api/coupons/validate stays a USER URL (prefix-precise, never a /api/coupons/ blanket)", async () => {
    const clearUser = vi.fn();
    setUserSessionMirror(true, clearUser);

    expect(handleUserUnauthorized("/api/coupons/validate")).toBe(true);
    await vi.waitFor(() => {
      expect(toastMock).toHaveBeenCalledTimes(1);
    });
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: USER_SESSION_EXPIRED_MESSAGE,
    });
    expect(clearUser).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/login");
    expect(adminHandlerSpy).not.toHaveBeenCalled();
  });
});

// ── H-F6: the sentinel parity + the holder's bearer filter ─────────────────

describe("COOKIE_AUTH_SENTINEL — one cycle-free source (R186 H-F6)", () => {
  it("auth.tsx's re-export and the leaf agree on the literal (the backend mint contract)", () => {
    expect(COOKIE_AUTH_SENTINEL).toBe("__cookie_session__");
    expect(AUTH_EXPORTED_SENTINEL).toBe(COOKIE_AUTH_SENTINEL);
  });

  it("getUserAuthToken filters the sentinel (cookie sessions emit NO bearer) and passes real JWTs through", () => {
    setUserAuthToken(COOKIE_AUTH_SENTINEL);
    expect(getUserAuthToken()).toBeNull();
    setUserAuthToken("jwt-real-token");
    expect(getUserAuthToken()).toBe("jwt-real-token");
    setUserAuthToken(null);
    expect(getUserAuthToken()).toBeNull();
  });

  it("source pin: the holder imports the leaf — no private literal re-declaration left to drift", () => {
    const holder = read("src/lib/auth-token-holder.ts");
    expect(holder).toContain('import { COOKIE_AUTH_SENTINEL } from "./auth-sentinel"');
    expect(holder).not.toContain('= "__cookie_session__"');
    const authSrc = read("src/lib/auth.tsx");
    expect(authSrc).toContain('export { COOKIE_AUTH_SENTINEL } from "./auth-sentinel"');
    expect(authSrc).not.toContain("export const COOKIE_AUTH_SENTINEL");
  });
});

// ── B-F4: the dead context member stays deleted ────────────────────────────

describe("logoutAllDevices — dead member deleted (R186 B-F4)", () => {
  it("no non-test file under frontend/src references it (whole-word scan)", () => {
    // The R185 dead-export verification style: SessionManager owns the
    // logout-all surface; any non-test reference here means the divergent
    // raw-fetch twin crept back into the auth context.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__") continue;
          walk(full);
        } else if (
          /\.(tsx?|jsx?)$/.test(entry.name) &&
          !/\.test\.(tsx?|jsx?)$/.test(entry.name) &&
          /\blogoutAllDevices\b/.test(readFileSync(full, "utf8"))
        ) {
          offenders.push(full);
        }
      }
    };
    walk(resolve(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
