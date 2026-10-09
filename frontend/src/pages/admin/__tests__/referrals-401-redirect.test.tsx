/**
 * R126-L3 (A4-B-1) — referrals list GET rides the console's uniform
 * 401 contract.
 *
 * `fetchData`'s list GET was the console's LAST silent-401: the page
 * imported `isAdminUnauthorized` but used it only on the credit POST,
 * so an expired session fell into the `!ok` branch and rendered an
 * Arabic error card («فشل تحميل الإحالات (HTTP 401)») the operator
 * could hammer «إعادة المحاولة» on forever — instead of the global
 * «انتهت الجلسة» toast + login redirect every other admin page
 * performs.
 *
 * These tests pin:
 *
 *   1. A 401 on the LIST fetch routes through isAdminUnauthorized with
 *      the referrals URL — and when the handler claims it (expired
 *      session), the page renders NO local error card: the global
 *      toast + redirect own the surface.
 *   2. When the handler does NOT claim it (non-admin URL shape /
 *      dedupe-window edge), the normal error card still applies — the
 *      guard only short-circuits handled session expiries.
 *
 * `@/lib/admin-session` is mocked at the module boundary so the spy
 * controls the claim; the rest follows referrals-error-state.test.tsx.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminReferralsPage from "@/pages/admin/referrals";

const { isAdminUnauthorizedMock } = vi.hoisted(() => ({
  isAdminUnauthorizedMock: vi.fn(),
}));

vi.mock("@/lib/admin-session", () => ({
  isAdminUnauthorized: isAdminUnauthorizedMock,
  // use-admin-headers registers the session mirror through this export
  // (the module surface the page graph imports).
  setAdminSessionMirror: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

/** Minimal Response-like object — avoids depending on a global Response. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  return render(
    <Router>
      <AdminReferralsPage />
    </Router>,
  );
}

describe("AdminReferralsPage — the list GET's 401 rides the global handler (A4-B-1)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    isAdminUnauthorizedMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a 401 on the list fetch is claimed by isAdminUnauthorized — no local error card", async () => {
    // The global handler claims the 401 (expired admin session): it has
    // already toasted «انتهت الجلسة» and initiated the login redirect.
    isAdminUnauthorizedMock.mockReturnValue(true);
    fetchMock.mockResolvedValue(resLike({ ok: false, status: 401, body: {} }));

    renderPage();

    // The guard ran — with the LIST URL (the exact gap A4-B-1 flags:
    // previously only the credit POST reached it).
    await waitFor(() => expect(isAdminUnauthorizedMock).toHaveBeenCalled());
    const [res, url] = isAdminUnauthorizedMock.mock.calls[0] as [{ status: number }, string];
    expect(res.status).toBe(401);
    expect(url).toBe("/api/admin/referrals?");

    // The page treated the request as HANDLED: its own error card
    // («تعذّر تحميل الإحالات») never renders — the global toast +
    // redirect own the surface, and no retry loop can start.
    await waitFor(() => {
      expect(screen.queryByText("تعذّر تحميل الإحالات")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).not.toBeInTheDocument();
    // Exactly one list GET — the guard short-circuits before the !ok
    // branch's error state can ask for more.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an unclaimed 401 (handler returns false) still falls through to the error card", async () => {
    // The handler declines the claim (not an admin-URL shape / already
    // inside the dedupe window) — the page's normal error path applies.
    isAdminUnauthorizedMock.mockReturnValue(false);
    fetchMock.mockResolvedValue(resLike({ ok: false, status: 401, body: {} }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل الإحالات")).toBeInTheDocument();
    });
    expect(isAdminUnauthorizedMock).toHaveBeenCalled();
  });
});
