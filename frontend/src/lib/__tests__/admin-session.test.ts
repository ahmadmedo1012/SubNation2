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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

import {
  AdminSessionExpiredError,
  ADMIN_SESSION_EXPIRED_MESSAGE,
  __resetAdminSessionForTests,
  adminFetch,
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

// ── L13-2 (R143): the D-3 timeout wiring, pinned BEHAVIORALLY ──────────────
// D-3 (R142) landed `signal: init?.signal ?? (timeoutMs > 0 ?
// AbortSignal.timeout(timeoutMs) : undefined)` in adminFetch with only a
// source-level comment as its pin — a future refactor that drops the
// `signal:` line (or inverts the ?? precedence) ships green through the
// whole suite while re-opening the ~300 s operator lockup class across
// every adminFetch/adminFetchJson consumer. These tests assert the wire:
// the signal fetch actually receives, the SSE opt-out, the caller-signal
// precedence, and the 401 sentinel (the wrapper's other half).
describe("adminFetch — the 20 s timeout wiring (L13-2 / D-3 behavioral pin)", () => {
  beforeEach(() => {
    __resetAdminSessionForTests();
    toastMock.mockClear();
    window.history.pushState({}, "", "/admin/users");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function okResponse() {
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }

  /** Records the signal each fetch call receives; resolves immediately. */
  function recordingFetch() {
    const signals: Array<AbortSignal | null | undefined> = [];
    const stub = vi.fn(async (_url: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      return okResponse();
    });
    return { stub, signals };
  }

  /** A fetch stub that mirrors the browser's abort semantics (the
   * money-races neverResolvingFetch idiom): rejects the moment the
   * effective signal fires. */
  function hangingFetch() {
    const stub = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error("test stub expects a signal");
          signal.addEventListener("abort", () => {
            reject(new DOMException("This operation was aborted", "AbortError"));
          });
        }),
    );
    return { stub };
  }

  it("the DEFAULT call hands fetch a real, un-fired abort signal (the shared 20 s budget's carrier)", async () => {
    const { stub, signals } = recordingFetch();
    vi.stubGlobal("fetch", stub);

    await adminFetch("/api/admin/users/16", { method: "PATCH" });

    // The WIRING is what this case pins — without `signal:` in
    // adminFetch's fetch call this array holds `undefined` (the exact
    // silent regression L13-2 exists to catch). The 20 s value itself is
    // SHARED_ADMIN_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS, pinned to
    // 20_000 by money-races-r140.
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
    // The init the site wrote is preserved verbatim — only the timeout
    // signal is added.
    expect(stub.mock.calls[0][1]?.method).toBe("PATCH");
  });

  it("a custom timeoutMs produces a REAL abort at its deadline — the operator's modal re-arms, never a 300 s hang", async () => {
    const { stub } = hangingFetch();
    vi.stubGlobal("fetch", stub);

    const pending = adminFetch("/api/admin/users/16", { method: "PATCH" }, { timeoutMs: 25 });
    // AbortSignal.timeout(25) fires on the REAL clock (~ms of test time)
    // and the stub's abort listener rejects — the behavior the 10 L13-1
    // converted sites now inherit.
    await expect(pending).rejects.toThrow();
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("timeoutMs: 0 opts OUT of the bound entirely — fetch receives NO signal (the copilot SSE exemption)", async () => {
    const { stub, signals } = recordingFetch();
    vi.stubGlobal("fetch", stub);

    await adminFetch("/api/admin/copilot/ask", { method: "POST" }, { timeoutMs: 0 });

    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeUndefined();
  });

  it("a caller-provided init.signal WINS untouched (the ?? precedence contract)", async () => {
    const { signals } = recordingFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        signals.push(init?.signal ?? undefined);
        return okResponse();
      }),
    );

    const controller = new AbortController();
    await adminFetch("/api/admin/orders", { method: "GET", signal: controller.signal });

    // The EXACT caller signal, not a composite — a caller-managed abort
    // (React Query unmount cancellation) must keep its own semantics.
    expect(signals[0]).toBe(controller.signal);
  });

  it("an expired-session 401 throws the AdminSessionExpiredError sentinel AFTER the global toast + redirect", async () => {
    simulateAdminSession(vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 401, headers: { "content-type": "application/json" } }),
      ),
    );

    await expect(adminFetch("/api/admin/users/16", { method: "PATCH" })).rejects.toBeInstanceOf(
      AdminSessionExpiredError,
    );
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: ADMIN_SESSION_EXPIRED_MESSAGE,
      variant: "destructive",
    });
    expect(window.location.pathname).toBe("/admin/login");
  });

  it("non-401 responses return the Response UNTOUCHED (the drop-in contract the 10 L13-1 sites rely on)", async () => {
    const body = new Response(JSON.stringify({ updated: 2 }), {
      status: 207,
      headers: { "content-type": "application/json" },
    });
    const stub = vi.fn(async () => body);
    vi.stubGlobal("fetch", stub);

    const res = await adminFetch("/api/admin/orders/bulk-status", { method: "PATCH" });
    expect(res).toBe(body);
    expect(res.status).toBe(207);
  });
});
