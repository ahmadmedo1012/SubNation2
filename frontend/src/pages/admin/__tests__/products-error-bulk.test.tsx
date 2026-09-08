/**
 * 94-C2 (A2 P1-2 + P2-8) — products page false-empty + honest bulk
 * archive tests.
 *
 * Two defects pinned:
 *
 *   1. (P1-2) `isError`/`error` were never destructured from
 *      useListAdminProducts — a failed load (401/500/network) fell
 *      back to `data=[]` and rendered the «لا توجد منتجات» empty
 *      state: a false-empty catalog that survived the round-93
 *      error-card wave. Now: the referrals.tsx error-card idiom with
 *      a retry button, plus the inline banner when a refresh of an
 *      already-rendered catalog fails.
 *
 *   2. (P2-8) The bulk-archive loop's success toast was UNCONDITIONAL
 *      — a total failure rendered «خطأ» followed by a success-toned
 *      «تمت أرشفة 0 منتج» (same class as the topups B5-01 lie). Now
 *      the loop counts REAL outcomes per item (r.ok + parsed reason)
 *      and the summary toast reports "X من N" with per-failure
 *      reasons; success tone only when nothing failed.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell, the
 * forecast panel and the toast hook are mocked at the module boundary
 * (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminProductsPage from "@/pages/admin/products";
import { useListAdminProducts } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListAdminProducts: vi.fn(),
  useCreateProduct: vi.fn(),
  useUpdateProduct: vi.fn(),
  useDeleteProduct: vi.fn(),
  getListAdminProductsQueryKey: (params?: unknown) => ["/api/admin/products", params ?? null],
  // 93-C6: useAdminHeaders registers the global 401 observer through
  // this export — the mock must carry the module surface the page
  // graph imports.
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// The forecast panel and the inventory dialog fetch their own data —
// stubbed so the page test stays scoped to the catalog list.
vi.mock("@/components/admin/forecast/StockoutRiskPanel", () => ({
  StockoutRiskPanel: () => null,
}));
vi.mock("@/components/admin/InventoryUploadDialog", () => ({
  InventoryUploadDialog: () => null,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const PRODUCT = (id: number, name: string) => ({
  id,
  name,
  description: null,
  image_url: null,
  price: 20 + id,
  stock_count: 10,
  is_active: true,
  category: "streaming",
  usage_terms: null,
  order_count: 3,
  created_at: "2026-08-01T10:00:00.000Z",
});

const PRODUCTS = [PRODUCT(1, "Netflix 1M"), PRODUCT(2, "Spotify 3M")];

function mockProductsResult(data: unknown[], over: Record<string, unknown> = {}) {
  (useListAdminProducts as unknown as Mock).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  });
}

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminProductsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminProductsPage — a failed load is an error card, not a false-empty catalog (A2 P1-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the error card with retry when the catalog fetch fails", () => {
    const refetch = vi.fn();
    mockProductsResult([], { isError: true, error: new Error("HTTP 503"), refetch });

    renderPage();

    expect(screen.queryByText("لا توجد منتجات")).not.toBeInTheDocument();
    expect(screen.getByText("تعذّر تحميل المنتجات")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "إعادة المحاولة" });
    expect(retry).toBeInTheDocument();

    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the rendered catalog and surfaces a failed refresh inline", () => {
    mockProductsResult(PRODUCTS, { isError: true, error: new Error("HTTP 500") });

    renderPage();

    // Stale cards stay on screen…
    expect(screen.getByText("Netflix 1M")).toBeInTheDocument();
    // …and the failure is announced, not swallowed.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
    expect(screen.queryByText("لا توجد منتجات")).not.toBeInTheDocument();
  });
});

describe("AdminProductsPage — honest bulk-archive summaries (A2 P2-8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductsResult(PRODUCTS);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Selects both products, opens the styled bulk confirm and confirms. */
  async function confirmBulkArchive() {
    fireEvent.click(screen.getByRole("button", { name: "تحديد Netflix 1M" }));
    fireEvent.click(screen.getByRole("button", { name: "تحديد Spotify 3M" }));
    expect(screen.getByText("2 منتج محدد")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "أرشفة" }));
    const title = await screen.findByText("أرشفة المنتجات المحددة؟");
    const dialog = title.closest('[role="alertdialog"]');
    if (!dialog) throw new Error("bulk confirm dialog not rendered");
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "أرشفة" }));
  }

  it("reports a partial failure with per-item reasons — no success toast on top", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/admin/products/2") {
        return resLike({ ok: false, status: 409, body: { error: "لا يمكن أرشفة منتج بمبيعات نشطة" } });
      }
      return resLike({ ok: true });
    });

    renderPage();

    await confirmBulkArchive();

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("تمت الأرشفة — 1 من 2");
    expect(toastArg.description).toContain("فشلت 1 من 2");
    expect(toastArg.description).toContain("#2");
    expect(toastArg.description).toContain("لا يمكن أرشفة منتج بمبيعات نشطة");
    expect(toastArg.variant).toBe("destructive");
    // Exactly one toast — the old code stacked a success-toned
    // «تمت أرشفة 1 منتج» after the failure toast.
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("a TOTAL failure is a destructive error — never the success-toned «تمت أرشفة 0»", async () => {
    fetchMock.mockResolvedValue(
      resLike({ ok: false, status: 500, body: { error: "خطأ في الخادم" } }),
    );

    renderPage();

    await confirmBulkArchive();

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("خطأ");
    expect(toastArg.description).toContain("فشلت 2 من 2");
    expect(toastArg.description).toContain("#1");
    expect(toastArg.description).toContain("#2");
    expect(toastArg.variant).toBe("destructive");
    // The unconditional success toast is gone — nothing claims
    // "تمت أرشفة 0".
    expect(JSON.stringify(toastMock.mock.calls)).not.toContain("تمت الأرشفة 0");
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("a full success run still gets the success summary with counts", async () => {
    fetchMock.mockResolvedValue(resLike({ ok: true }));

    renderPage();

    await confirmBulkArchive();

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("✓ تمت الأرشفة 2 منتجات");
    expect(toastArg.variant).toBe("success");
  });
});
