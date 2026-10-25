/**
 * R187 (D-F5) — per-row busy survives OVERLAPPING actions on the
 * coupons and promotions consoles.
 *
 * The R186 (C-F10) topups fix (the processingIds Set) never reached
 * these siblings: coupons' `toggling`/`archiving` and promotions'
 * `busyId` were still single-id models, so starting row B's action
 * cleared row A's spinner while A's PATCH was in flight — and A's
 * finally then cleared B's mid-flight busy (the exact overlap class).
 *
 * Ported from the topups-overlap-busy-r186 harness: two deferred
 * requests on different rows → BOTH rows stay disabled until EACH
 * resolves. Money stayed contained server-side on every one of these
 * (PATCH/DELETE idempotency + status guards); the casualty was the
 * busy contract.
 *
 * Module-boundary mocks follow the coupons-tz-roundtrip /
 * promotions-activate-confirm harnesses.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminCouponsPage from "@/pages/admin/coupons";
import AdminPromotionsPage from "@/pages/admin/promotions";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token", hasAdminPermission: () => true }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const fetchMock = vi.fn();

function renderPage(Page: typeof AdminCouponsPage | typeof AdminPromotionsPage) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <Page />
      </Router>
    </QueryClientProvider>,
  );
}

// ── coupons: two active rows, toggle PATCHes gated per id ────────────────

const COUPONS = [
  {
    id: 1,
    code: "SUMMER20",
    type: "percentage",
    value: 20,
    min_order_amount: 0,
    max_uses: null,
    used_count: 0,
    expires_at: null,
    is_active: true,
    description: null,
    created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    id: 2,
    code: "RAMADAN25",
    type: "fixed",
    value: 5,
    min_order_amount: 0,
    max_uses: null,
    used_count: 0,
    expires_at: null,
    is_active: true,
    description: null,
    created_at: "2026-09-02T10:00:00.000Z",
  },
];

describe("AdminCouponsPage — per-row busy survives overlapping toggles (R187 D-F5)", () => {
  let gateA: { promise: unknown; resolve: (v: unknown) => void };
  let gateB: { promise: unknown; resolve: (v: unknown) => void };

  beforeEach(() => {
    vi.clearAllMocks();
    toastMock.mockReset();
    gateA = deferred<unknown>();
    gateB = deferred<unknown>();
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const url = String(input);
      if (method === "PATCH") {
        if (url.endsWith("/api/coupons/admin/1")) return gateA.promise;
        if (url.endsWith("/api/coupons/admin/2")) return gateB.promise;
      }
      return Promise.resolve(resLike({ body: COUPONS }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("toggling A then B keeps BOTH rows busy; resolving A leaves B disabled; resolving B re-enables", async () => {
    renderPage(AdminCouponsPage);
    await screen.findByText("SUMMER20");

    // Toggle A (PATCH gated in flight)…
    fireEvent.click(screen.getByRole("button", { name: "تعطيل الكوبون SUMMER20" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH"),
      ).toHaveLength(1),
    );
    // …then toggle B while A is still in flight (the overlap the old
    // single-id model broke on).
    fireEvent.click(screen.getByRole("button", { name: "تعطيل الكوبون RAMADAN25" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH"),
      ).toHaveLength(2),
    );

    // Both rows busy: each row's IN-FLIGHT action (the toggle PATCH)
    // disables. The archive sibling keeps its own busy set — the
    // pre-existing per-button semantics this fix does not change.
    for (const code of ["SUMMER20", "RAMADAN25"]) {
      expect(screen.getByRole("button", { name: `تعطيل الكوبون ${code}` })).toBeDisabled();
    }

    // A lands → A's row re-enables…
    gateA.resolve(resLike({ body: {} }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "تعطيل الكوبون SUMMER20" })).toBeEnabled();
    });

    // …but B's PATCH is STILL in flight — its row stays disabled (the
    // old single-id model re-enabled B here via setToggling(null)).
    expect(screen.getByRole("button", { name: "تعطيل الكوبون RAMADAN25" })).toBeDisabled();

    // B lands → its own row re-enables cleanly (the set empties).
    gateB.resolve(resLike({ body: {} }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "تعطيل الكوبون RAMADAN25" })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "أرشفة الكوبون RAMADAN25" })).toBeEnabled();
  });
});

// ── promotions: two stopped sales, activation PATCHes gated per id ───────

const futureIso = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const SALES = [
  {
    id: 7,
    title: "عرض الجمعة",
    discount_percent: 30,
    ends_at: futureIso(24),
    is_active: false,
    is_currently_active: false,
    created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    id: 8,
    title: "عرض الصيف",
    discount_percent: 15,
    ends_at: futureIso(48),
    is_active: false,
    is_currently_active: false,
    created_at: "2026-09-02T10:00:00.000Z",
  },
];

/** The row that renders the given sale — scoped by its unique title
 *  heading (two stopped sales render two «تفعيل» buttons + the confirm
 *  dialog carries its own, so an unscoped getByRole is ambiguous). */
function rowScope(title: string) {
  const h3 = screen.getByText(title);
  const row = h3.closest('div[class*="bg-card"]') as HTMLElement;
  return within(row);
}

async function confirmActivate(title: string) {
  fireEvent.click(rowScope(title).getByRole("button", { name: "تفعيل" }));
  const dialogTitle = await screen.findByText("تفعيل العرض على كامل المتجر؟");
  const dialog = dialogTitle.closest('[role="alertdialog"]') as HTMLElement;
  fireEvent.click(within(dialog).getByRole("button", { name: "تفعيل" }));
  await waitFor(() => {
    expect(screen.queryByText("تفعيل العرض على كامل المتجر؟")).not.toBeInTheDocument();
  });
}

describe("AdminPromotionsPage — per-row busy survives overlapping activations (R187 D-F5)", () => {
  let gateA: { promise: unknown; resolve: (v: unknown) => void };
  let gateB: { promise: unknown; resolve: (v: unknown) => void };

  beforeEach(() => {
    vi.clearAllMocks();
    toastMock.mockReset();
    gateA = deferred<unknown>();
    gateB = deferred<unknown>();
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "PATCH") {
        if (url.endsWith("/api/admin/flash-sales/7")) return gateA.promise;
        if (url.endsWith("/api/admin/flash-sales/8")) return gateB.promise;
      }
      return Promise.resolve(resLike({ body: { flash_sales: SALES } }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("activating A then B keeps BOTH rows busy; resolving A leaves B disabled; resolving B re-enables", async () => {
    renderPage(AdminPromotionsPage);
    await screen.findByText("عرض الجمعة");

    // Activate A (PATCH gated in flight)…
    await confirmActivate("عرض الجمعة");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH"),
      ).toHaveLength(1),
    );
    // …then activate B while A is still in flight.
    await confirmActivate("عرض الصيف");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH"),
      ).toHaveLength(2),
    );

    // Both rows busy: the remaining تفعيل + the archive buttons disable.
    for (const title of ["عرض الجمعة", "عرض الصيف"]) {
      expect(rowScope(title).getByRole("button", { name: "تفعيل" })).toBeDisabled();
      expect(
        rowScope(title).getByRole("button", { name: `إيقاف وأرشفة العرض «${title}»` }),
      ).toBeDisabled();
    }

    // A lands → A's row re-enables…
    gateA.resolve(resLike({ body: {} }));
    await waitFor(() => {
      expect(rowScope("عرض الجمعة").getByRole("button", { name: "تفعيل" })).toBeEnabled();
    });

    // …but B's PATCH is STILL in flight — its row stays disabled.
    expect(rowScope("عرض الصيف").getByRole("button", { name: "تفعيل" })).toBeDisabled();
    expect(
      rowScope("عرض الصيف").getByRole("button", { name: "إيقاف وأرشفة العرض «عرض الصيف»" }),
    ).toBeDisabled();

    // B lands → its own row re-enables cleanly.
    gateB.resolve(resLike({ body: {} }));
    await waitFor(() => {
      expect(rowScope("عرض الصيف").getByRole("button", { name: "تفعيل" })).toBeEnabled();
    });
    expect(
      rowScope("عرض الصيف").getByRole("button", { name: "إيقاف وأرشفة العرض «عرض الصيف»" }),
    ).toBeEnabled();
  });
});
