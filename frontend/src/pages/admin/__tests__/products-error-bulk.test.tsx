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

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminProductsPage from "@/pages/admin/products";
import {
  useCreateProduct,
  useDeleteProduct,
  useListAdminProducts,
  useUpdateProduct,
} from "@workspace/api-client-react";

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

const PRODUCT = (id: number, name: string, category = "streaming") => ({
  id,
  name,
  description: null,
  image_url: null,
  price: 20 + id,
  stock_count: 10,
  is_active: true,
  category,
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
    // R124-I5/C2 (A6 F4): the page now dereferences the stable `mutate`
    // at render time (useCallback dep for the memoized cards) instead of
    // lazily inside the click handler — the bare vi.fn() default
    // (undefined) would crash the render. The archive tests below
    // cancel before the confirm, so a no-op mutate is side-effect-free.
    (useDeleteProduct as unknown as Mock).mockReturnValue({ mutate: vi.fn() });
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
        return resLike({
          ok: false,
          status: 409,
          body: { error: "لا يمكن أرشفة منتج بمبيعات نشطة" },
        });
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
    expect(toastArg.title).toBe("تمت الأرشفة 2 منتجات");
    expect(toastArg.variant).toBe("success");
  });
});

describe("AdminProductsPage — honest one-way-door archive + #new deep link (R115 A9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductsResult(PRODUCTS);
    // The create editor needs live mutation stubs when it opens (the
    // #new deep-link test renders the create form — its submit button
    // reads createMutation.isPending / updateMutation.isPending).
    (useCreateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    (useUpdateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("the single-archive confirm names the one-way door (no restore exists — UI or API)", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "أرشفة Netflix 1M" }));
    const title = await screen.findByText("أرشفة المنتج؟");
    const dialog = title.closest('[role="alertdialog"]');
    if (!dialog) throw new Error("archive confirm dialog not rendered");

    // R115 (A9 P1): the old «يُخفى من المتجر وتبقى بياناته ومبيعاته»
    // implied recoverability that does not exist — the copy now states
    // the door is final from the UI and restoration requires direct
    // intervention (the list endpoint filters is_archived=false and no
    // restore path exists anywhere in the repo).
    expect(
      within(dialog as HTMLElement).getByText(/الأرشفة نهائية من الواجهة/),
    ).toBeInTheDocument();
    expect(within(dialog as HTMLElement).getByText(/تتطلب تدخلاً مباشراً/)).toBeInTheDocument();

    // Cancel — nothing is deleted (the copy test must stay side-effect-free).
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(screen.queryByText("أرشفة المنتج؟")).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the same one-way-door honesty rides the BULK archive confirm", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "تحديد Netflix 1M" }));
    fireEvent.click(screen.getByRole("button", { name: "أرشفة" }));
    const title = await screen.findByText("أرشفة المنتجات المحددة؟");
    const dialog = title.closest('[role="alertdialog"]');
    if (!dialog) throw new Error("bulk confirm dialog not rendered");
    expect(
      within(dialog as HTMLElement).getByText(/الأرشفة نهائية من الواجهة/),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "إلغاء" }));
  });

  it("the #new deep link (layout context action) opens the create editor and consumes the hash", async () => {
    // The layout's «إضافة منتج جديد» context action links to
    // /admin/products#new — the page used to read ?search only, so the
    // link landed on a closed form.
    window.history.replaceState({}, "", "/admin/products#new");

    renderPage();

    await screen.findAllByText("Netflix 1M");
    expect(screen.getByText("إضافة منتج جديد")).toBeInTheDocument();
    // The hash is consumed so a refresh doesn't reopen the form after
    // the operator closes it.
    expect(window.location.hash).toBe("");

    // Closing the form keeps it closed (no sticky #new state).
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(screen.queryByText("إضافة منتج جديد")).not.toBeInTheDocument());
  });

  it("a plain visit (no hash) keeps the create form closed", async () => {
    renderPage();

    await screen.findAllByText("Netflix 1M");
    expect(screen.queryByText("إضافة منتج جديد")).not.toBeInTheDocument();
  });
});

/** R120-B4 (A2-F2 + A2-F12) — server-side search wiring + honest
 *  header count + the accessible clear-search control. */
describe("AdminProductsPage — server-side search + honest catalog count (R120-B4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductsResult(PRODUCTS);
    (useCreateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    (useUpdateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("the search box feeds the SERVER-side ?search= after the 300ms debounce (not a client filter)", async () => {
    renderPage();
    const input = await screen.findByPlaceholderText("بحث في المنتجات…");

    fireEvent.change(input, { target: { value: "netflix" } });

    // Before the debounce settles, the initial (unsearched) params ride
    // the generated hook.
    expect(useListAdminProducts).toHaveBeenCalledWith({ search: undefined }, expect.anything());

    // After the 300ms debounce, the settled term enters the hook params
    // (the orders/users idiom — one request per typing pause).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 340));
    });
    expect(useListAdminProducts).toHaveBeenLastCalledWith({ search: "netflix" }, expect.anything());
  });

  it("a short catalog keeps the honest «في الكتالوج» total", async () => {
    renderPage();
    await screen.findAllByText("Netflix 1M");
    // 2 products < the 200-row server cap → the total IS known.
    expect(screen.getByText(/في الكتالوج/)).toBeInTheDocument();
    expect(screen.queryByText(/الأحدث أولاً/)).not.toBeInTheDocument();
  });

  it("a full 200-row cap page flips the header to «عرض N (الأحدث أولاً)» + the partial-data hint", async () => {
    // Exactly the backend cap (routes/admin/products.ts limit(200)) —
    // the old header claimed «200 منتج في الكتالوج», a false total:
    // older products beyond the cap were invisible to the list.
    mockProductsResult(Array.from({ length: 200 }, (_, i) => PRODUCT(i + 1, `Product ${i + 1}`)));
    renderPage();
    await screen.findAllByText("Product 1");

    expect(screen.getByText(/عرض 200/)).toBeInTheDocument();
    expect(screen.getByText(/الأحدث أولاً/)).toBeInTheDocument();
    expect(screen.queryByText(/في الكتالوج/)).not.toBeInTheDocument();
    // The category tabs are client-side over the capped window — the
    // hint says so (the orders honest-count discipline).
    expect(screen.getByText(/الفلاتر تعمل على المنتجات المعروضة فقط/)).toBeInTheDocument();
  });

  it("the clear-search control carries an accessible name and a padded hit area (A2-F12)", async () => {
    renderPage();
    const input = await screen.findByPlaceholderText("بحث في المنتجات…");
    fireEvent.change(input, { target: { value: "net" } });

    const clear = screen.getByRole("button", { name: "مسح البحث" });
    expect(clear.className).toContain("p-2");

    fireEvent.click(clear);
    expect(input).toHaveValue("");
  });
});

/** R126-L3 (A4-B-2 + A2/A8) — products writes keep the shared stats
 *  fresh AND bulk-failure reasons speak Arabic.
 *
 * A4-B-2: every products write path funnels through the page's
 * `invalidate()` (mutations, both bulk loops, stock set-count, the
 * variants dialog), and each moves stats fields (available_stock /
 * unsold_rows) — but the callback used to invalidate ONLY the products
 * list key, leaving the acting tab's dashboard + layout stats stale
 * for up to the 300s fallback. The orders/users/tickets co-invalidation
 * idiom now applies.
 *
 * A2/A8: the bulk loops' per-failure reasons used to fall back to a
 * bare English `HTTP 502` (and raw `e.message` for network failures)
 * inside the Arabic summary toast — they now route through
 * getErrorMessage (the Arabic guard).
 */
describe("AdminProductsPage — stats co-invalidation + Arabic bulk reasons (R126-L3)", () => {
  /** renderPage with an invalidateQueries spy on the fresh client. */
  function renderPageWithSpy() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const view = render(
      <QueryClientProvider client={client}>
        <Router>
          <AdminProductsPage />
        </Router>
      </QueryClientProvider>,
    );
    return { invalidateSpy, ...view };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockProductsResult(PRODUCTS);
    (useCreateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    (useUpdateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("a bulk archive invalidates the products key AND /api/admin/stats (A4-B-2)", async () => {
    fetchMock.mockResolvedValue(resLike({ ok: true }));

    const { invalidateSpy } = renderPageWithSpy();

    // Select both products, confirm the styled bulk dialog.
    fireEvent.click(screen.getByRole("button", { name: "تحديد Netflix 1M" }));
    fireEvent.click(screen.getByRole("button", { name: "تحديد Spotify 3M" }));
    fireEvent.click(screen.getByRole("button", { name: "أرشفة" }));
    const title = await screen.findByText("أرشفة المنتجات المحددة؟");
    const dialog = title.closest('[role="alertdialog"]');
    if (!dialog) throw new Error("bulk confirm dialog not rendered");
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "أرشفة" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const keys = invalidateSpy.mock.calls
      .map((call) => call[0])
      .filter((arg): arg is { queryKey: unknown[] } => Boolean(arg?.queryKey))
      .map((arg) => JSON.stringify(arg.queryKey));
    // The products list key (the mocked getListAdminProductsQueryKey()
    // shape)…
    expect(keys).toContain(JSON.stringify(["/api/admin/products", null]));
    // …AND the shared stats key — the co-invalidation the A4-B-2 audit
    // found missing on the whole products family.
    expect(keys).toContain(JSON.stringify(["/api/admin/stats"]));
  });

  it("a message-less failure body surfaces the Arabic generic, never a bare HTTP status (A2/A8)", async () => {
    // A proxy 502 with an unparseable/empty body — the exact shape that
    // used to land as "HTTP 502" inside the Arabic summary toast.
    fetchMock.mockResolvedValue(resLike({ ok: false, status: 502, body: null }));

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "تحديد Netflix 1M" }));
    fireEvent.click(screen.getByRole("button", { name: "تحديد Spotify 3M" }));
    fireEvent.click(screen.getByRole("button", { name: "أرشفة" }));
    const title = await screen.findByText("أرشفة المنتجات المحددة؟");
    const dialog = title.closest('[role="alertdialog"]');
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "أرشفة" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.variant).toBe("destructive");
    // The Arabic guard's fallback — never the English status line.
    expect(toastArg.description).toContain("حدث خطأ. حاول مرة أخرى");
    expect(toastArg.description).not.toContain("HTTP 502");
  });

  it("a network-level failure surfaces the Arabic connection line, not raw e.message (A2/A8)", async () => {
    // "Failed to fetch" — the browser's English TypeError that used to
    // ride the catch branch verbatim.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "تحديد Netflix 1M" }));
    fireEvent.click(screen.getByRole("button", { name: "تحديد Spotify 3M" }));
    fireEvent.click(screen.getByRole("button", { name: "أرشفة" }));
    const title = await screen.findByText("أرشفة المنتجات المحددة؟");
    const dialog = title.closest('[role="alertdialog"]');
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "أرشفة" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.description).toContain("تعذّر الاتصال بالخدمة");
    expect(toastArg.description).not.toContain("Failed to fetch");
  });
});

/**
 * R127-B2 (§A) — the LAST size-vs-membership select-all (the twin of
 * the R126-L3 orders fix; mirrored from orders-bulk-status.test.tsx).
 *
 * The toggle used to branch on `selectedIds.size === filtered.length`
 * — a SIZE test — while the rendered checkbox state (title/icon/text,
 * and now aria-pressed) uses MEMBERSHIP (`filtered.every((p) =>
 * selectedIds.has(p.id))`). Selections are never pruned on filter
 * change, so the category chip split the two:
 *
 *   - hidden-but-selected ids + visible-unselected rows → the
 *     unchecked button CLEARED the selection instead of selecting
 *     the visible rows (both feed the bulk archive/hide money
 *     actions — same blast radius orders had);
 *   - an extra hidden id alongside a fully-selected window → the
 *     checked button re-ran the select branch and the operator could
 *     never clear from the button.
 *
 * The category tabs filter CLIENT-side over the loaded rows (the
 * `filtered` memo), so flipping the chip mid-selection is the natural
 * way to hold out-of-filter ids — exactly what these two tests do.
 */
describe("AdminProductsPage — select-all branches on MEMBERSHIP, not size (R127-B2)", () => {
  // Two streaming + two music products — the category chips split
  // them 2/2 while the selection rides across the flip
  // (CATEGORY_FILTERS: «بث مباشر» = streaming, «موسيقى» = music).
  const MIXED = [
    PRODUCT(1, "Netflix 1M"),
    PRODUCT(2, "Hulu 1M"),
    PRODUCT(3, "Spotify 3M", "music"),
    PRODUCT(4, "Apple Music", "music"),
  ];

  /** The header select-all (text swaps with state; aria-pressed pins it). */
  const selectAllButton = () => screen.getByRole("button", { name: "تحديد الكل" });
  const deselectAllButton = () => screen.getByRole("button", { name: "إلغاء الكل" });

  /** The row selector's shared aria-pressed state (single layout — no
   *  desktop/mobile duplicate like orders has). */
  const rowSelected = (name: string): boolean =>
    screen.getByRole("button", { name: `تحديد ${name}` }).getAttribute("aria-pressed") === "true";

  beforeEach(() => {
    vi.clearAllMocks();
    mockProductsResult(MIXED);
    // Live mutation stubs (the memoized cards dereference `mutate` at
    // render time — see the first describe's R124-I5 note).
    (useDeleteProduct as unknown as Mock).mockReturnValue({ mutate: vi.fn() });
    (useCreateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    (useUpdateProduct as unknown as Mock).mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("visible-unselected rows with out-of-category selections: select-all SELECTS the visible rows (was: cleared)", async () => {
    renderPage();
    await screen.findAllByText("Netflix 1M");

    // Select the two MUSIC rows on the «الكل» view…
    fireEvent.click(screen.getByRole("button", { name: "تحديد Spotify 3M" }));
    fireEvent.click(screen.getByRole("button", { name: "تحديد Apple Music" }));
    expect(screen.getByText("2 منتج محدد")).toBeInTheDocument();

    // …then narrow the chip to «بث مباشر»: the two visible streaming
    // rows are UNSELECTED, yet the stale selection's SIZE (2) equals
    // the filtered LENGTH (2) — the old size-equality trap.
    fireEvent.click(screen.getByRole("button", { name: "بث مباشر" }));
    await waitFor(() => expect(screen.queryAllByText("Spotify 3M")).toHaveLength(0));
    expect(selectAllButton()).toHaveAttribute("aria-pressed", "false");

    // The unchecked select-all must SELECT the visible rows — the old
    // branch saw 2===2 and cleared the selection instead.
    fireEvent.click(selectAllButton());

    // The button flips to its checked face («إلغاء الكل», pressed).
    expect(deselectAllButton()).toHaveAttribute("aria-pressed", "true");
    expect(rowSelected("Netflix 1M")).toBe(true);
    expect(rowSelected("Hulu 1M")).toBe(true);
    // The bulk bar still reads a live selection count (the old branch
    // zeroed the set — the bar vanished entirely).
    expect(screen.getByText("2 منتج محدد")).toBeInTheDocument();
  });

  it("a fully-selected window with an extra hidden id: the checked select-all CLEARS (was: a silent re-select that pruned the hidden id)", async () => {
    renderPage();
    await screen.findAllByText("Netflix 1M");

    // Select three rows on «الكل»: both music rows + one streaming…
    fireEvent.click(screen.getByRole("button", { name: "تحديد Netflix 1M" }));
    fireEvent.click(screen.getByRole("button", { name: "تحديد Spotify 3M" }));
    fireEvent.click(screen.getByRole("button", { name: "تحديد Apple Music" }));
    expect(screen.getByText("3 منتج محدد")).toBeInTheDocument();

    // …then narrow to «موسيقى»: both visible rows are selected (the
    // button reads checked) but Netflix 1M rides hidden in the set —
    // size 3 ≠ length 2, so the old branch re-ran the SELECT side
    // and the checked button could never clear anything.
    fireEvent.click(screen.getByRole("button", { name: "موسيقى" }));
    await waitFor(() => expect(screen.queryAllByText("Netflix 1M")).toHaveLength(0));
    expect(deselectAllButton()).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(deselectAllButton());

    // Membership-keyed: checked → cleared (the hidden id goes with it
    // — «إلغاء الكل» semantics), never a silent re-select.
    expect(selectAllButton()).toHaveAttribute("aria-pressed", "false");
    expect(rowSelected("Spotify 3M")).toBe(false);
    expect(rowSelected("Apple Music")).toBe(false);
    // The bulk bar (gated on size > 0) is gone entirely.
    expect(screen.queryByText(/منتج محدد/)).not.toBeInTheDocument();
  });
});
