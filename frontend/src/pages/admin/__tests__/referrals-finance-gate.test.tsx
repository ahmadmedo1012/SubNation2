/**
 * R122 (A2-P1) — referral credit-button finance gate.
 *
 * The «منح نقاط» POST is finance-gated server-side (backend
 * routes/admin/referrals.ts — requirePermission("finance"), the B1-3
 * rationale: points are LYD-convertible money a scoped users-admin must
 * not mint), but the page is mounted users-scope — a users-only operator
 * saw the button enabled on every pending row, confirmed the dialog, and
 * only THEN hit the 403. The R120-B4 (A2-F4) parity sweep fixed this
 * class in users.tsx (canEditMoney) and orders.tsx (canBulkRefund) but
 * missed referrals.tsx.
 *
 * These tests pin the same idiom here:
 *
 *   1. A finance-scoped admin gets an ENABLED credit button on pending
 *      rows (the gate must not over-block the legitimate operator).
 *   2. A users-only admin gets the button DISABLED with the honest
 *      «يتطلب صلاحية المالية» reason — and clicking it fires NO
 *      request (no confirm dialog, no credit POST).
 *
 * `@/lib/auth`, the admin shell and the toast hook are mocked at the
 * module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminReferralsPage from "@/pages/admin/referrals";

// R122 (A2-P1): the finance scope is the variable under test — a mutable
// authState lets each case grant/deny exactly the scopes it needs (the
// orders-bulk-status.test.tsx mock pattern).
const authState: Record<string, boolean> = {};
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: (scope: string) => authState[scope] !== false,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

/** A pending row is the only shape that renders the «منح نقاط» button. */
const pendingPayload = {
  stats: { total: 1, credited: 0, pending: 1, total_points: 0 },
  top_referrers: [],
  list: [
    {
      id: 101,
      status: "pending",
      created_at: "2026-09-01T10:00:00.000Z",
      credited_at: null,
      referrer_phone: "0911111111",
      referrer_id: 7,
      referee_phone: "0922222222",
      points_earned: 50,
    },
  ],
};

function resLike(body: unknown) {
  // R127-L1: the REAL customFetch (generated client) parses this stub —
  // headers + text() required.
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body ?? null)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  // R127-L1: the list rides useListAdminReferrals — fresh client per
  // render (retry: false).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminReferralsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminReferralsPage — credit button finance gate (R122 A2-P1)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => resLike(pendingPayload));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // Reset to "super admin" so a forgotten grant cannot leak into the
    // next case.
    for (const k of Object.keys(authState)) delete authState[k];
  });

  it("renders an ENABLED credit button for a finance-scoped admin", async () => {
    authState["finance"] = true;

    renderPage();

    const credit = await screen.findByRole("button", { name: /منح نقاط/ });
    expect(credit).toBeEnabled();
    // No misleading reason tooltip on the enabled state.
    expect(credit).not.toHaveAttribute("title", "يتطلب صلاحية المالية");
  });

  it("renders the credit button DISABLED with the honest reason for a users-only admin", async () => {
    authState["finance"] = false;

    renderPage();

    const credit = await screen.findByRole("button", { name: /منح نقاط/ });
    expect(credit).toBeDisabled();
    expect(credit).toHaveAttribute("title", "يتطلب صلاحية المالية");
  });

  it("a disabled-gate click fires NO request — the 403 mid-flow is unreachable", async () => {
    authState["finance"] = false;

    renderPage();

    const credit = await screen.findByRole("button", { name: /منح نقاط/ });
    // The list fetches have already settled; nothing else may follow.
    const listCalls = fetchMock.mock.calls.length;
    fireEvent.click(credit);

    // No confirm dialog opens (nothing to confirm — the action is
    // scoped out) and no credit POST fires.
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBe(listCalls);
    });
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("/credit"))).toBe(true);
  });
});
