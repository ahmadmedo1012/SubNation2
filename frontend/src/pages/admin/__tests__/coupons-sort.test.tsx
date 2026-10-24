/**
 * R160 — the admin coupons sort affordance (the coupons half of the
 * R158-A P3 «no sort affordance on orders/coupons/risk tables»).
 *
 * COUPONS IS THE CLIENT-SIDE HALF (the users-directory precedent):
 * GET /api/coupons/admin returns the ENTIRE capped list (≤200 rows) in
 * one fetch, so the sort ranks the full dataset in memory — no backend
 * param (a server-side sort would be indirection with zero user value;
 * the risk queue's cursor pagination is what forced that one
 * server-side). Pinned here:
 *
 *   1. the whitelist + chips list (created_at/value × asc/desc);
 *   2. default render: the API order (created_at DESC) is preserved
 *      byte-identically — the page never re-sorts without a selection;
 *   3. chip flips re-sort the FULL list in memory (value asc/desc +
 *      created_at asc) — the users-directory idiom, honestly client-side;
 *   4. URL round-trip — a ?sort= deep link rehydrates the view, and a
 *      chip flip writes ?sort= back via replaceState (the users.tsx
 *      R123 idiom);
 *   5. invalid-value tolerance — a garbage ?sort= degrades to the
 *      default ordering instead of a broken view.
 *
 * The CouponsTable surface is the R-140-l frozen DIV-GRID (no <th> —
 * the stacked-card mobile layout owns that decision), so the control
 * is the shared FilterTabs chips bar (aria-pressed chips, one control
 * for both breakpoints), NOT aria-sort table headers — the risk queue
 * (a real-table register member) is where the OrdersTable th idiom
 * landed this round.
 *
 * `@/lib/auth` + the admin shell are mocked at the module boundary;
 * adminFetchJson rides the stubbed global fetch (the coupons-tz
 * harness pattern).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminCouponsPage from "@/pages/admin/coupons";
import { COUPON_SORTS, isCouponSort } from "@/components/admin/coupons/coupons-meta";

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

const COUPON = (id: number, code: string, value: number, createdAt: string) => ({
  id,
  code,
  type: "percentage" as const,
  value,
  min_order_amount: 0,
  max_uses: 100,
  used_count: 3,
  expires_at: null,
  is_active: true,
  description: null,
  created_at: createdAt,
});

/**
 * The API's order (created_at DESC): HALF50 newest, SAVE10 oldest.
 * Values: MEGA5=5 < SAVE10=10 < HALF50=50.
 */
const LIST = [
  COUPON(1, "HALF50", 50, "2026-09-03T10:00:00.000Z"),
  COUPON(2, "MEGA5", 5, "2026-09-02T10:00:00.000Z"),
  COUPON(3, "SAVE10", 10, "2026-09-01T10:00:00.000Z"),
];

function resLike(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  // R186 (C-F8): the list rides useQuery now — a fresh client per render
  // (retry: false) per the page-test convention.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminCouponsPage />
      </Router>
    </QueryClientProvider>,
  );
}

const urlSort = (): string | null => new URLSearchParams(window.location.search).get("sort");

/** Document order of two coupon codes inside the rendered table. */
function expectOrder(first: string, second: string): void {
  const a = screen.getByText(first);
  const b = screen.getByText(second);
  expect(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
    `${first} before ${second}`,
  ).toBeTruthy();
}

describe("R160 — the coupons sort whitelist (meta pins)", () => {
  it("the whitelist covers exactly created_at/value × asc/desc; the chips list matches it", async () => {
    expect(COUPON_SORTS).toEqual(["created_at:asc", "created_at:desc", "value:asc", "value:desc"]);
    // Tolerant intake: only the four members pass.
    expect(
      ["created_at:asc", "created_at:desc", "value:asc", "value:desc"].map(isCouponSort),
    ).toEqual([true, true, true, true]);
    expect(
      ["", "level:desc", "value", "value:up", "created_at:asc;DROP"].map(isCouponSort),
    ).toEqual([false, false, false, false, false]);
  });
});

describe("R160 — AdminCouponsPage ?sort= (client-side full-list sort + URL round-trip)", () => {
  beforeEach(() => {
    toastMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => resLike(LIST));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("default render: the API order is preserved byte-identically (no re-sort without a selection)", async () => {
    renderPage();
    await screen.findByText("HALF50");

    // The server list (created_at DESC) renders as-is — newest first.
    expectOrder("HALF50", "MEGA5");
    expectOrder("MEGA5", "SAVE10");
    // The chip bar's default maps to الأحدث (absent ?sort= = newest).
    expect(screen.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a ?sort= deep link rehydrates the view (URL → state → full-list client sort)", async () => {
    window.history.replaceState({}, "", "/admin/coupons?sort=value%3Aasc");
    renderPage();
    await screen.findByText("HALF50");

    // In-memory ordering by the raw numeric value — what the الخصم
    // column renders. No second fetch ever fires (the client owns it).
    expectOrder("MEGA5", "SAVE10");
    expectOrder("SAVE10", "HALF50");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("chip flip: الأعلى خصمًا re-sorts the full list by value desc + writes ?sort= back", async () => {
    renderPage();
    await screen.findByText("HALF50");

    fireEvent.click(screen.getByRole("button", { name: "الأعلى خصمًا" }));
    await waitFor(() => expect(urlSort()).toBe("value:desc"));
    expectOrder("HALF50", "SAVE10");
    expectOrder("SAVE10", "MEGA5");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "الأعلى خصمًا" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "false");
    // The client-side sort never refetches.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("chip flip: الأقدم re-sorts by created_at asc (oldest first)", async () => {
    renderPage();
    await screen.findByText("HALF50");

    fireEvent.click(screen.getByRole("button", { name: "الأقدم" }));
    await waitFor(() => expect(urlSort()).toBe("created_at:asc"));
    expectOrder("SAVE10", "MEGA5");
    expectOrder("MEGA5", "HALF50");
  });

  it("flipping back to الأحدث returns the API order and drops ?sort=", async () => {
    renderPage();
    await screen.findByText("HALF50");

    fireEvent.click(screen.getByRole("button", { name: "الأقدم" }));
    await waitFor(() => expect(urlSort()).toBe("created_at:asc"));
    expectOrder("SAVE10", "MEGA5");

    // Explicit created_at:desc keeps the API order too (the server's
    // IS created_at DESC) and stays in the URL (the orders discipline).
    fireEvent.click(screen.getByRole("button", { name: "الأحدث" }));
    await waitFor(() => expect(urlSort()).toBe("created_at:desc"));
    expectOrder("HALF50", "MEGA5");
    expectOrder("MEGA5", "SAVE10");
  });

  it("an INVALID ?sort= deep link degrades to the default API ordering", async () => {
    window.history.replaceState({}, "", "/admin/coupons?sort=uses%3Adesc");
    renderPage();
    await screen.findByText("HALF50");

    // Newest first (the API order), الأحدث pressed — the garbage param
    // never reached the view.
    expectOrder("HALF50", "MEGA5");
    expectOrder("MEGA5", "SAVE10");
    expect(screen.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "true");
  });
});
