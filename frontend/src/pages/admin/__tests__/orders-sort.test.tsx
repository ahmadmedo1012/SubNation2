/**
 * R159 — the admin orders ?sort= affordance (the R158-A P3 / the R158
 * deferred ledger item "orders sort affordance (needs backend param)").
 *
 * Unlike the users directory's client-side chip sort, the orders list is
 * SERVER-paginated — a client-side sort could only rank the loaded
 * window. The ordering therefore rides the validated ?sort= param
 * (backend routes/admin/orders.ts, whitelisted to created_at/total ×
 * asc/desc) through the generated client's typed param. Pinned here:
 *
 *   1. whitelist parity — orders-meta's ORDER_SORTS stays in lockstep
 *      with the generated ListAdminOrdersSort (the openapi truth), and
 *      the desktop toggle helper cycles desc↔asc with the ""-default
 *      mapping (absent param IS created_at DESC);
 *   2. URL round-trip — a ?sort= deep link rehydrates the first
 *      request, and a desktop-header/mobile-chip flip writes ?sort=
 *      back via replaceState (the ?status=/?days= R123 idiom);
 *   3. aria-sort semantics — the sortable th elements carry the live
 *      ascending/descending/none state (the r140-l register's own rule:
 *      a th that grows a sort control MUST grow aria-sort);
 *   4. rendered row order follows the SERVER response — the page never
 *      re-sorts client-side (the users-page mistake this ledger item
 *      closes the door on);
 *   5. invalid-value tolerance — a garbage ?sort= degrades to the default
 *      ordering (param dropped) instead of a 400.
 *
 * Mocked at the module boundary exactly like the sibling render suites
 * (orders-false-empty-pagination.test.tsx), except the client mock
 * spreads the ORIGINAL module so the generated whitelist const stays
 * readable for the parity pin.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ReactNode } from "react";
import AdminOrdersPage from "@/pages/admin/orders";
import { listAdminOrders, ListAdminOrdersSort } from "@workspace/api-client-react";
import { ORDER_SORTS, nextOrderSort } from "@/components/admin/orders/orders-meta";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  // The real exports stay (ListAdminOrdersSort feeds the parity pin);
  // only the fetch surface is stubbed — same module surface the sibling
  // render suites mock, plus the original.
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    listAdminOrders: vi.fn(),
    getListAdminOrdersQueryKey: (params?: unknown) => ["/api/admin/orders", params ?? null],
  };
});

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
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const ORDER = (i: number, amount: number, createdAt: string) => ({
  id: i + 1,
  order_code: `SN-${1000 + i}`,
  user_phone: `0910000${String(i).padStart(3, "0")}`,
  product_name: `Product ${i}`,
  amount,
  status: "completed",
  created_at: createdAt,
});

/** Two rows the server already ordered by amount desc (its job, not ours). */
const ROWS = [ORDER(0, 30, "2026-09-03T10:00:00.000Z"), ORDER(1, 10, "2026-09-01T10:00:00.000Z")];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminOrdersPage />
      </Router>
    </QueryClientProvider>,
  );
}

const urlSort = (): string | null => new URLSearchParams(window.location.search).get("sort");
const lastParams = (): Record<string, unknown> =>
  (listAdminOrders as unknown as Mock).mock.calls.at(-1)?.[0] ?? {};

describe("R159 — the orders sort whitelist (meta ↔ generated parity + the toggle helper)", () => {
  it("ORDER_SORTS mirrors the generated ListAdminOrdersSort (the openapi truth)", () => {
    expect([...ORDER_SORTS]).toEqual(Object.values(ListAdminOrdersSort));
  });

  it('nextOrderSort: the "" default maps through created_at DESC and every column toggles desc↔asc', () => {
    // Absent param IS newest-first — the first التاريخ click flips to asc.
    expect(nextOrderSort("created_at", "")).toBe("created_at:asc");
    expect(nextOrderSort("created_at", "created_at:desc")).toBe("created_at:asc");
    expect(nextOrderSort("created_at", "created_at:asc")).toBe("created_at:desc");
    // Clicking a non-active column starts that column at desc.
    expect(nextOrderSort("total", "")).toBe("total:desc");
    expect(nextOrderSort("total", "total:desc")).toBe("total:asc");
    expect(nextOrderSort("total", "total:asc")).toBe("total:desc");
    // A total sort clicking التاريخ returns to created_at desc.
    expect(nextOrderSort("created_at", "total:asc")).toBe("created_at:desc");
  });
});

describe("R159 — AdminOrdersPage ?sort= (URL round-trip + aria-sort + request wiring)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAdminOrders as unknown as Mock).mockResolvedValue(ROWS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("default render: no sort in the request, التاريخ th aria-sort=descending, الأحدث chip pressed", async () => {
    renderPage();
    await screen.findAllByText("SN-1000");

    // The default ordering is newest-first: the request carries no sort.
    expect(lastParams().sort).toBeUndefined();
    // The th states are honest about that: created_at descending…
    const dateTh = screen.getByRole("button", { name: "ترتيب حسب التاريخ" }).closest("th");
    expect(dateTh).toHaveAttribute("aria-sort", "descending");
    // …المبلغ unsorted…
    const amountTh = screen.getByRole("button", { name: "ترتيب حسب المبلغ" }).closest("th");
    expect(amountTh).toHaveAttribute("aria-sort", "none");
    // …and the mobile chip bar's default maps to الأحدث.
    expect(screen.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a ?sort= deep link rehydrates the first request (URL → state)", async () => {
    window.history.replaceState({}, "", "/admin/orders?sort=total%3Aasc");
    renderPage();

    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "total:asc", page: 1 }));
  });

  it("desktop header click: toggle → request param, aria-sort, and the ?sort= write-back", async () => {
    renderPage();
    await screen.findAllByText("SN-1000");

    // Click المبلغ: created_at-effective desc → that column's desc.
    // (Every flip changes the query key → the page rides its existing
    // TableSkeleton loading state until the new first page lands — the
    // assertions wait for the table to come back, no new spinners.)
    fireEvent.click(screen.getByRole("button", { name: "ترتيب حسب المبلغ" }));
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "total:desc", page: 1 }));
    expect(urlSort()).toBe("total:desc");
    const amountTh = (await screen.findByRole("button", { name: "ترتيب حسب المبلغ" })).closest(
      "th",
    );
    const dateTh = screen.getByRole("button", { name: "ترتيب حسب التاريخ" }).closest("th");
    expect(amountTh).toHaveAttribute("aria-sort", "descending");
    expect(dateTh).toHaveAttribute("aria-sort", "none");

    // Click again: desc → asc.
    fireEvent.click(screen.getByRole("button", { name: "ترتيب حسب المبلغ" }));
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "total:asc" }));
    expect(urlSort()).toBe("total:asc");
    const amountThAsc = (await screen.findByRole("button", { name: "ترتيب حسب المبلغ" })).closest(
      "th",
    );
    expect(amountThAsc).toHaveAttribute("aria-sort", "ascending");

    // Click التاريخ from a total sort: back to created_at desc (the
    // effective default — the first click, NOT a dead no-op).
    fireEvent.click(screen.getByRole("button", { name: "ترتيب حسب التاريخ" }));
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "created_at:desc" }));
    expect(urlSort()).toBe("created_at:desc");
  });

  it("mobile chip bar: a chip flip rides the same request + write-back (the shared FilterTabs control)", async () => {
    renderPage();
    await screen.findAllByText("SN-1000");

    fireEvent.click(screen.getByRole("button", { name: "الأقل قيمة" }));
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "total:asc", page: 1 }));
    expect(urlSort()).toBe("total:asc");
    // The chips ride with the refetch cycle — wait for the pressed
    // state to move before asserting it.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "الأقل قيمة" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "false");
  });

  it("rendered row order follows the SERVER response — the page never re-sorts client-side", async () => {
    // The server already ordered amount desc: 30 before 10. If the page
    // re-sorted locally (the users-directory mistake), this flips. The
    // desktop table's tbody carries both codes — document order within
    // it is the rendered order.
    renderPage();
    await screen.findAllByText("SN-1000");

    const tbody = document.querySelector('table[aria-label="جدول الطلبات"] tbody');
    expect(tbody).not.toBeNull();
    const text = tbody?.textContent ?? "";
    expect(text.indexOf("SN-1000")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("SN-1000")).toBeLessThan(text.indexOf("SN-1001"));
  });

  it("clear-all resets ?sort= with the other URL params", async () => {
    window.history.replaceState({}, "", "/admin/orders?status=completed&sort=total%3Aasc");
    renderPage();
    await screen.findAllByText("SN-1000");

    fireEvent.click(screen.getByRole("button", { name: "مسح الكل" }));
    await waitFor(() => expect(lastParams().sort).toBeUndefined());
    expect(urlSort()).toBe(null);
    // The default state is back: التاريخ descending (the table rides the
    // refetch cycle — wait for it to reappear).
    const dateTh = (await screen.findByRole("button", { name: "ترتيب حسب التاريخ" })).closest("th");
    expect(dateTh).toHaveAttribute("aria-sort", "descending");
  });

  it("an INVALID ?sort= deep link degrades to the default ordering (param dropped, no 400)", async () => {
    window.history.replaceState({}, "", "/admin/orders?sort=amount%3Adesc");
    renderPage();

    await screen.findAllByText("SN-1000");
    expect(lastParams().sort).toBeUndefined();
    expect(lastParams()).not.toHaveProperty("status");
    // The honest default UI: التاريخ descending + الأحدث chip pressed.
    const dateTh = screen.getByRole("button", { name: "ترتيب حسب التاريخ" }).closest("th");
    expect(dateTh).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "true");
  });
});
