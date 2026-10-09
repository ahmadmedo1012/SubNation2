/**
 * R126-L3 (A4-B-1) → R127-L1 (B1 §3.3) — referrals list GET rides the
 * console's uniform 401 contract.
 *
 * `fetchData`'s list GET was the console's LAST silent-401: the page
 * imported `isAdminUnauthorized` but used it only on the credit POST,
 * so an expired session fell into the `!ok` branch and rendered an
 * Arabic error card («فشل تحميل الإحالات (HTTP 401)») the operator
 * could hammer «إعادة المحاولة» on forever — instead of the global
 * «انتهت الجلسة» toast + login redirect every other admin page
 * performs.
 *
 * R127-L1 reframe: the page rides the generated client now, so the 401
 * contract is STRUCTURAL — customFetch fires the registered global
 * handler (via the real useAdminHeaders) BEFORE throwing ApiError, and
 * the page's loadError suppresses the ApiError 401 shape locally
 * (isSessionExpiredError, the alerts.tsx duck-type). These tests pin:
 *
 *   1. A 401 on the list fetch routes through the global
 *      handleAdminUnauthorized with the referrals URL — and the query
 *      errors SILENTLY: no local error card, no retry loop can start
 *      (the global toast + redirect own the surface).
 *   2. A non-401 failure (5xx envelope) still falls through to the
 *      error card — the quiet path only short-circuits session
 *      expiries, never real outages.
 *
 * `@/lib/admin-session` is mocked at the module boundary so the spy
 * controls the global handler claim (it is what useAdminHeaders
 * registers with customFetch); the rest follows
 * referrals-error-state.test.tsx.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminReferralsPage from "@/pages/admin/referrals";

const { handleAdminUnauthorizedMock } = vi.hoisted(() => ({
  handleAdminUnauthorizedMock: vi.fn(),
}));

vi.mock("@/lib/admin-session", () => ({
  // R127-L1: the page no longer calls isAdminUnauthorized itself — the
  // global handler is registered (via useAdminHeaders) as customFetch's
  // 401 observer; the spy below is what runs when a 401 arrives.
  handleAdminUnauthorized: handleAdminUnauthorizedMock,
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

/** Minimal Response-like object — the REAL customFetch parses it
 * (headers + text(), the R127-L1 generated-client stub shape). */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body ?? null)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  // R127-L1: the list rides useListAdminReferrals — fresh client,
  // retry: false (a 401 must not re-fire behind the redirect).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminReferralsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminReferralsPage — the list GET's 401 rides the global handler (A4-B-1 / R127-L1)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    handleAdminUnauthorizedMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a 401 on the list fetch fires the global handler with the referrals URL — no local error card", async () => {
    // The global handler claims the 401 (expired admin session): it has
    // already toasted «انتهت الجلسة» and initiated the login redirect.
    handleAdminUnauthorizedMock.mockReturnValue(true);
    fetchMock.mockResolvedValue(resLike({ ok: false, status: 401, body: {} }));

    renderPage();

    // The global handler ran — with the LIST URL (customFetch invokes
    // the registered observer BEFORE throwing the ApiError).
    await waitFor(() => expect(handleAdminUnauthorizedMock).toHaveBeenCalled());
    expect(handleAdminUnauthorizedMock.mock.calls[0]![0]).toContain("/api/admin/referrals");

    // The page treated the request as HANDLED: its own error card
    // («تعذّر تحميل الإحالات») never renders — the global toast +
    // redirect own the surface, and no retry loop can start.
    await waitFor(() => {
      expect(screen.queryByText("تعذّر تحميل الإحالات")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).not.toBeInTheDocument();
    // Exactly one list GET — the ApiError 401 is suppressed locally, so
    // no error-state retry asks for more.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a non-401 failure still falls through to the error card (the quiet path is 401-only)", async () => {
    // A 5xx outage is NOT a session expiry — the normal error path
    // applies (the old test's "handler declines" case, reframed: the
    // guard only short-circuits session expiries, never outages).
    handleAdminUnauthorizedMock.mockReturnValue(false);
    fetchMock.mockResolvedValue(resLike({ ok: false, status: 500, body: { error: "internal" } }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل الإحالات")).toBeInTheDocument();
    });
    // The global handler was never asked (only 401s reach it).
    expect(handleAdminUnauthorizedMock).not.toHaveBeenCalled();
  });
});
