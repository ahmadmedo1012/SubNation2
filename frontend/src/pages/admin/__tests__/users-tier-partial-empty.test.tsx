/**
 * R125-I4 (A1-7 — P3) + A10 §C-30 — users tier-filter partial-window
 * empty tests.
 *
 * The tier filter runs CLIENT-SIDE over the accumulated pages, so a
 * tier can read «لا مستخدمين بمستوى X» while matching users sit on
 * UNLOADED pages (hasNextPage=true) — the hard EmptyState asserted
 * global emptiness over a partial window (the exact R115 A9 P2
 * false-empty orders killed; users even had the sibling honesty hint
 * for sort, but not for the tier-empty claim).
 *
 * The orders.tsx partial-empty block now keeps the load-more visible
 * + the honest incompleteness hint instead. These tests pin:
 *
 *   1. A zero-match tier over a full (partial) page renders the
 *      incompleteness block — NEVER the hard EmptyState claim — with
 *      «تحميل المزيد» + «مسح الفلاتر» both offered.
 *   2. Loading the next page appends in place; the matching gold user
 *      surfaces and the partial block disappears.
 *   3. A zero-match tier over a provably-complete window (single
 *      short page) keeps the honest hard EmptyState.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (users-wallet-confirm
 * pattern); the tier filter is pinned via ?tier= (the deep-link
 * contract) — no panel interaction needed.
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

const USER = (id: number, tier = "bronze") => ({
  id,
  phone: `09${String(10_000_000 + id)}`,
  wallet_balance: 150,
  loyalty_points: 100,
  loyalty_tier: tier,
  order_count: 2,
  lifetime_spend: 200,
  created_at: "2026-08-01T10:00:00.000Z",
});

const GOLD_USER = USER(999, "gold");

/** A FULL 100-row page of bronze users — the window is provably partial. */
const PAGE_ONE = Array.from({ length: 100 }, (_, i) => USER(i + 1));
/** The short page 2 carries the one gold user. */
const PAGE_TWO = [GOLD_USER];

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

describe("AdminUsersPage — tier-empty over a partial window stays honest (A1-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/admin/users?tier=gold");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/admin/users");
  });

  it("a zero-match tier over loaded pages shows the incompleteness block, never the hard empty claim", async () => {
    (customFetch as unknown as Mock).mockResolvedValue(PAGE_ONE);

    renderPage();

    // The honest partial-window wording (not the global-emptiness claim).
    await waitFor(() => {
      expect(screen.getByText("لا مستخدمين بمستوى ذهبي ضمن الصفحات المحمّلة")).toBeInTheDocument();
    });
    expect(screen.queryByText("لا يوجد مستخدمون")).not.toBeInTheDocument();
    // The recovery affordances: keep loading OR clear the filter.
    expect(screen.getByRole("button", { name: /تحميل المزيد/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "مسح الفلاتر" })).toBeInTheDocument();
  });

  it("loading the next page surfaces the gold user and dissolves the partial block", async () => {
    (customFetch as unknown as Mock).mockImplementation((url: string) =>
      // The frozen ?page=&limit= contract — page 2 carries the match.
      String(url).includes("page=2") ? Promise.resolve(PAGE_TWO) : Promise.resolve(PAGE_ONE),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("لا مستخدمين بمستوى ذهبي ضمن الصفحات المحمّلة")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /تحميل المزيد/ }));

    // The gold user surfaces — the partial block is gone (real rows).
    await waitFor(() => {
      expect(screen.getAllByText(GOLD_USER.phone).length).toBeGreaterThan(0);
    });
    expect(
      screen.queryByText("لا مستخدمين بمستوى ذهبي ضمن الصفحات المحمّلة"),
    ).not.toBeInTheDocument();
  });

  it("a zero-match tier over a provably-complete window keeps the honest hard EmptyState", async () => {
    // A single SHORT page (no hasNextPage) — the emptiness is real.
    (customFetch as unknown as Mock).mockResolvedValue([USER(1)]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("لا مستخدمين بمستوى ذهبي")).toBeInTheDocument();
    });
    // The partial-window claim is NOT made over a complete window.
    expect(
      screen.queryByText("لا مستخدمين بمستوى ذهبي ضمن الصفحات المحمّلة"),
    ).not.toBeInTheDocument();
  });
});
