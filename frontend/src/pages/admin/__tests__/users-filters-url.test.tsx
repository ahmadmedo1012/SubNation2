/**
 * R125-I4 (A1-1 — P2) + A10 §C-11 — users «مسح الفلاتر» URL write-back
 * tests.
 *
 * The empty-state CTA called setSearch/setTierFilter but never
 * syncFilterParams — ?tier= (and ?sort=) survived in the address bar,
 * so a refresh (or a copy-pasted link) silently re-applied a filter
 * the operator believes they removed, on the directory that lists
 * wallet balances. The fix is the ONE clearAllFilters handler (also
 * resets sortBy, consistent with the panel's «إعادة ضبط», and strips
 * the ?search= deep-link param of the same resurrection class).
 *
 * These tests pin:
 *
 *   1. A tier-filtered empty state with ?tier=&sort= in the URL clears
 *      BOTH params on «مسح الفلاتر» (the URL no longer resurrects
 *      the filter on refresh).
 *   2. The rows return once the filter is cleared.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (users-wallet-confirm
 * pattern); the URL is driven via history.replaceState (the
 * home-filters-url harness — wouter v3 dispatches on it).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminUsersPage from "@/pages/admin/users";
import { customFetch } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getListAdminUsersQueryKey: (params?: unknown) => ["/api/admin/users", params ?? null],
  setUnauthorizedHandler: vi.fn(),
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

/** A bronze user — with ?tier=gold pinned, the directory reads empty. */
const USER = {
  id: 16,
  phone: "0913456789",
  wallet_balance: 150,
  loyalty_points: 100,
  loyalty_tier: "bronze",
  order_count: 2,
  lifetime_spend: 200,
  created_at: "2026-08-01T10:00:00.000Z",
};

const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminUsersPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminUsersPage — «مسح الفلاتر» writes the clear back to the URL (A1-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A single short page — the tier-empty is the HARD empty state
    // (the partial-window variant has its own suite).
    (customFetch as unknown as Mock).mockResolvedValue([USER]);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // Deep-link state: a gold tier filter + a non-default sort pinned.
    window.history.replaceState(null, "", "/admin/users?tier=gold&sort=spend_desc");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/admin/users");
  });

  it("clearing the tier filter drops ?tier=&?sort= from the address bar and returns the rows", async () => {
    renderPage();

    // The tier filter (initialized from ?tier=gold) empties the view.
    await waitFor(() => {
      expect(screen.getByText("لا مستخدمين بمستوى ذهبي")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "مسح الفلاتر" }));

    // The URL no longer carries the filter — a refresh cannot
    // resurrect it.
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    // …and the directory returns (the bronze row is back).
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /تعديل المستخدم 0913456789/ }).length,
      ).toBeGreaterThan(0);
    });
  });

  it("the ?search= deep-link param rides the same resurrection class — stripped with the rest", async () => {
    // A search that matches nothing (server-side) + no tier filter:
    // the CTA clears the search AND its URL param.
    (customFetch as unknown as Mock).mockResolvedValue([]);
    window.history.replaceState(null, "", "/admin/users?search=0999");

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('لا نتائج لـ "0999"')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "مسح الفلاتر" }));

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
  });
});
