/**
 * 93-C6 / F-07 (round-93 — A5 S-3) — global admin session-expiry tests.
 *
 * The httpOnly admin cookie can expire MID-WORK: App.tsx's guard only
 * re-validates on mount/token-change, so every page fetch after expiry
 * returned 401 while the UI told the operator to RETRY a permanently
 * unauthenticated request. lib/admin-session is the single choke point
 * both fetch layers route through; these tests pin its contract:
 *
 *   1. admin-API 401 while a session is believed active → ONE Arabic
 *      toast + admin-token clear + soft SPA redirect to
 *      /admin/login?redirect=<current>.
 *   2. 15 s dedupe — the burst of parallel query failures that follows
 *      expiry produces one redirect, not six toasts.
 *   3. Non-admin URLs, auth-exempt endpoints (login/probe/session) and
 *      401s while logged out are NOT our business (false, no toast).
 *   4. isAdminUnauthorized maps Response objects onto the handler.
 *
 * Module-level test (no React): the handler must work from the
 * customFetch observer — outside any component tree.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

import {
  ADMIN_SESSION_EXPIRED_MESSAGE,
  __resetAdminSessionForTests,
  handleAdminUnauthorized,
  isAdminUnauthorized,
  setAdminSessionMirror,
} from "../admin-session";

function simulateAdminSession(clear: () => void = vi.fn()) {
  setAdminSessionMirror(true, clear);
}

describe("handleAdminUnauthorized — expired session mid-work (F-07/S-3)", () => {
  beforeEach(() => {
    __resetAdminSessionForTests();
    toastMock.mockClear();
    // Start each case on a deep admin page so the redirect param is
    // observable. jsdom supports history.pushState.
    window.history.pushState({}, "", "/admin/topups?filter=pending");
  });

  it("toasts once (Arabic), clears the token, and soft-redirects with ?redirect=", () => {
    const clear = vi.fn();
    simulateAdminSession(clear);

    const handled = handleAdminUnauthorized("/api/admin/topups");

    expect(handled).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: ADMIN_SESSION_EXPIRED_MESSAGE,
      variant: "destructive",
    });
    expect(clear).toHaveBeenCalledTimes(1);
    // Soft SPA navigation: URL moved to the login page carrying the
    // page the operator was on for a post-login return trip.
    expect(window.location.pathname).toBe("/admin/login");
    expect(window.location.search).toContain(
      `redirect=${encodeURIComponent("/admin/topups?filter=pending")}`,
    );
  });

  it("dedupes the 401 burst from parallel queries: one toast + one redirect", () => {
    simulateAdminSession(vi.fn());

    const first = handleAdminUnauthorized("/api/admin/orders");
    const second = handleAdminUnauthorized("/api/admin/users");
    const third = handleAdminUnauthorized("/api/admin/alerts");

    expect(first).toBe(true);
    // Handled (caller skips its own generic error toast)…
    expect(second).toBe(true);
    expect(third).toBe(true);
    // …but no additional toast / redirect side effects.
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("ignores 401s while no admin session is believed active (login page etc.)", () => {
    setAdminSessionMirror(false, null);

    expect(handleAdminUnauthorized("/api/admin/orders")).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/admin/topups");
  });

  it("never fires for storefront URLs or auth-exempt admin endpoints", () => {
    simulateAdminSession(vi.fn());

    // Storefront session 401 — C5's domain, not ours.
    expect(handleAdminUnauthorized("/api/auth/me")).toBe(false);
    // Wrong password on the login form is a 401 the form must own.
    expect(handleAdminUnauthorized("/api/admin/login")).toBe(false);
    expect(handleAdminUnauthorized("/api/admin/probe")).toBe(false);
    expect(handleAdminUnauthorized("/api/admin/session")).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/admin/topups");
  });

  it("a throwing clear callback must not break the redirect", () => {
    simulateAdminSession(() => {
      throw new Error("cleanup exploded");
    });

    expect(() => handleAdminUnauthorized("/api/admin/topups")).not.toThrow();
    expect(window.location.pathname).toBe("/admin/login");
  });

  it("treats absolute API origins as admin URLs too (base-URL deployments)", () => {
    simulateAdminSession(vi.fn());

    expect(handleAdminUnauthorized("https://api.example.com/api/admin/orders")).toBe(true);
    expect(window.location.pathname).toBe("/admin/login");
  });

  // R123 (E3 item 1): the admin coupon surface lives OUTSIDE the
  // /api/admin/ tree (backend routes/coupons.ts mounts it at
  // /api/coupons/admin with requireAdmin + finance scope). The
  // isAdminApiUrl extension was dormant until the coupons-page fetches
  // rode adminFetch/adminFetchJson — now a finance cookie expiring
  // mid-coupon-work reaches the global handler instead of a per-action
  // retry-loop toast. Pin BOTH sides of the coupling: the admin prefix
  // matches, the public /api/coupons/validate surface does not.
  it("handles 401s on /api/coupons/admin (the now-live coupon-surface extension) but not storefront coupon endpoints", () => {
    simulateAdminSession(vi.fn());

    expect(handleAdminUnauthorized("/api/coupons/admin")).toBe(true);
    expect(handleAdminUnauthorized("/api/coupons/admin/42")).toBe(true);
    expect(window.location.pathname).toBe("/admin/login");
    expect(toastMock).toHaveBeenCalledTimes(1);

    // The storefront validate endpoint is public — its 401s stay C5's
    // domain (prefix-precise match, never a /api/coupons/ blanket).
    expect(handleAdminUnauthorized("/api/coupons/validate")).toBe(false);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});

describe("isAdminUnauthorized — raw-fetch call-site helper", () => {
  beforeEach(() => {
    __resetAdminSessionForTests();
    toastMock.mockClear();
    window.history.pushState({}, "", "/admin/users");
  });

  it("maps a 401 Response onto the global handler", () => {
    simulateAdminSession(vi.fn());

    expect(isAdminUnauthorized({ status: 401 }, "/api/admin/users/16")).toBe(true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/admin/login");
  });

  it("passes non-401 statuses through untouched", () => {
    simulateAdminSession(vi.fn());

    expect(isAdminUnauthorized({ status: 500 }, "/api/admin/users/16")).toBe(false);
    expect(isAdminUnauthorized({ status: 409 }, "/api/admin/users/16")).toBe(false);
    expect(isAdminUnauthorized({ status: 403 }, "/api/admin/users/16")).toBe(false);
    expect(toastMock).not.toHaveBeenCalled();
  });
});
