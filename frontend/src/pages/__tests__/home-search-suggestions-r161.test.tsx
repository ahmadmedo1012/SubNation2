/**
 * R161-B — the home search dropdown's live product suggestions.
 *
 * The typing-time affordance this round ships: while the user types
 * (debounced 300ms, ≥2 chars), the page fetches the SAME list
 * projection the grid rides (/api/products?search=…&fields=list) and
 * the dropdown renders up to 5 product rows (name / category chip /
 * price) + a «عرض كل النتائج» affordance ABOVE the history section.
 *
 * Harness = the two sibling idioms fused:
 *   • home-search-history-a11y.test.tsx — the api-client hooks mocked
 *     at the module boundary, useSeo stubbed, history via localStorage;
 *   • admin global-search.test.tsx — vi.useFakeTimers with the
 *     act(advance) + microtask-flush discipline (NEVER waitFor/findBy
 *     on faked timers), the routed fetch mock, and the wouter
 *     LocationProbe for navigation assertions.
 *
 * The suggestion fetch rides the page-owned listProducts imperative
 * call (the R136 single-data-owner contract; the R144 adoption gate
 * forbids a new raw fetch), so stubbing global fetch exercises the
 * REAL debounce → client → state wiring end to end.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Router, useLocation } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/pages/home";
import { categoryLabel } from "@/lib/utils";
import {
  useGetCatalogStats,
  useGetMe,
  useListOrders,
  useListProducts,
} from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListProducts: vi.fn(),
  useGetCatalogStats: vi.fn(),
  useGetMe: vi.fn(),
  useListOrders: vi.fn(),
  getListProductsQueryKey: (params: unknown) => ["/api/products", params],
  getGetCatalogStatsQueryKey: () => ["/api/catalog-stats"],
  getGetMeQueryKey: () => ["/api/auth/me"],
  getListOrdersQueryKey: (params: unknown) => ["/api/orders", params],
  // R161: the page's suggestion fetch rides the generated IMPERATIVE
  // client (listProducts → customFetch → global fetch), so the mock is a
  // faithful customFetch twin: same URL the real client builds, throws
  // on !ok, JSON-parses the body. The per-test global-fetch stubs below
  // therefore exercise the real debounce → client → state wiring.
  listProducts: async (
    params?: { search?: string; fields?: string },
    options?: { signal?: AbortSignal },
  ) => {
    const url = `/api/products?search=${encodeURIComponent(params?.search ?? "")}&fields=${params?.fields ?? "list"}`;
    const res = await fetch(url, { signal: options?.signal });
    if (!res.ok) throw new Error(`products ${res.status}`);
    return res.json();
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: null }),
}));

vi.mock("@/hooks/useSeo", () => ({
  useSeo: () => null,
}));

function mockHooks() {
  vi.mocked(useListProducts).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListProducts>);
  vi.mocked(useGetCatalogStats).mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGetCatalogStats>);
  vi.mocked(useGetMe).mockReturnValue({
    data: undefined,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGetMe>);
  vi.mocked(useListOrders).mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListOrders>);
}

/** The list-projection rows the suggestion dropdown renders. */
const SUGGEST_ROW = (id: number, name: string) => ({
  id,
  slug: `p-${id}`,
  name,
  image_url: null,
  price: 25,
  price_from: id === 1,
  category: "streaming",
  is_available: true,
  stock_count: 5,
});

const ROWS = [
  SUGGEST_ROW(1, "Netflix Premium"),
  SUGGEST_ROW(2, "Netflix Standard"),
  SUGGEST_ROW(3, "Netflix Family"),
];

/** Minimal Response-like object (the global-search resLike idiom). */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = [] } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Routes fetch: ONLY the suggestion endpoint matters (every query hook
 * is module-mocked). `respond` maps the decoded search query to its
 * Response — slow/stale interleavings are built per test.
 */
function routeSuggest(respond: (q: string) => Promise<Response> | Response) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    const q = decodeURIComponent(url.split("search=")[1]?.split("&")[0] ?? "");
    return respond(q);
  });
}

const fetchMock = routeSuggest(() => resLike({ body: ROWS }));

function LocationProbe() {
  const [loc] = useLocation();
  return <div data-testid="location-probe">{loc}</div>;
}

function renderPage() {
  return render(
    <Router>
      <LocationProbe />
      <HomePage />
    </Router>,
  );
}

/** Drains the promise continuations behind the mocked fetch (fake timers freeze macrotasks). */
async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  // The page's commits ride startTransition + wouter re-renders on the
  // monkey-patched history events — React's concurrent scheduler pays
  // those on a MACROtask (MessageChannel), which the microtask rounds
  // above never reach. Yield a REAL macrotask (MessageChannel is not
  // faked by vi.useFakeTimers) inside the act scope so the scheduler
  // work lands inside act too.
  await act(async () => {
    await new Promise<void>((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    });
  });
}

/** Advances fake time, then drains whatever the fired timers started. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flushAsync();
}

function typeInto(value: string) {
  const input = screen.getByLabelText("البحث في المنتجات");
  fireEvent.change(input, { target: { value } });
  return input;
}

function suggestionListbox() {
  return screen.getByRole("listbox", { name: "منتجات مطابقة" });
}

describe("HomePage — live product suggestions (R161-B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHooks();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    // URL reset lives in BEFOREEach only: at afterEach time the tree is
    // still mounted (RTL's cleanup runs after the file's hooks — LIFO),
    // and wouter monkey-patches history.replaceState to re-render every
    // useLocation consumer, which would fire act warnings post-test.
    window.history.replaceState(null, "", "/");
    localStorage.removeItem("subnation_search_history");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.removeItem("subnation_search_history");
  });

  it("rapid typing fires exactly ONE fetch — debounced, with the row vocabulary + view-all affordance", async () => {
    // A response on its own 50ms fake timer keeps the loading window
    // observable mid-flight (an instant promise resolves inside the
    // async act that fires the debounce).
    const delayed = routeSuggest(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(resLike({ body: ROWS })), 50);
        }),
    );
    vi.stubGlobal("fetch", delayed);

    renderPage();
    expect(delayed).not.toHaveBeenCalled();

    // Three rapid keystrokes → one debounce window → one request for
    // the final value (the page's existing debounce idiom, extended).
    typeInto("نت");
    typeInto("نتفلكس اشتراك");
    typeInto("نتفلكس");
    await advance(299);
    expect(delayed).not.toHaveBeenCalled();

    await advance(1); // the 300ms debounce fires; the response is pending
    // The subtle spinner row is the loading state (never blocks input).
    expect(screen.getByRole("status").textContent).toContain("جارٍ البحث");

    await advance(50); // the response lands
    expect(delayed).toHaveBeenCalledTimes(1);
    expect(String(delayed.mock.calls[0]![0])).toBe(
      `/api/products?search=${encodeURIComponent("نتفلكس")}&fields=list`,
    );

    const listbox = suggestionListbox();
    const options = within(listbox).getAllByRole("option");
    // 3 product rows + the view-all row.
    expect(options).toHaveLength(4);
    // Row vocabulary: name + the categoryLabel chip + the price
    // (formatCurrency) + the «تبدأ من» qualifier for variant products.
    // The chip label is asserted VIA categoryLabel (not a literal) so
    // the taxonomy lane's label rename cannot break this pin.
    expect(options[0].textContent).toContain("Netflix Premium");
    expect(options[0].textContent).toContain(categoryLabel("streaming"));
    expect(options[0].textContent).toContain("تبدأ من");
    expect(options[0].textContent).toContain("25.00 د.ل");
    expect(options[3].textContent).toContain("عرض كل النتائج");
  });

  it("inputs under 2 chars never fetch and render no panel", async () => {
    renderPage();

    typeInto("ن");
    await advance(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    const input = screen.getByLabelText("البحث في المنتجات");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // Clearing a settled query back under the gate fires nothing new
    // and drops the stale rows.
    typeInto("نتفلكس");
    await advance(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    typeInto("");
    await advance(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox", { name: "منتجات مطابقة" })).not.toBeInTheDocument();
  });

  it("a late-resolving OLDER response is dropped — rows match the newer query", async () => {
    // "نت" answers SLOWLY (400ms) with a stale-looking row; the full
    // query answers immediately. The mock deliberately IGNORES the
    // abort signal (belt-only path): only the generation guard keeps
    // the stale response out.
    const racing = routeSuggest((q) => {
      if (q === "نت") {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(resLike({ body: [SUGGEST_ROW(9, "STALE RESULT")] })), 400);
        });
      }
      return resLike({ body: [SUGGEST_ROW(10, "FRESH RESULT")] });
    });
    vi.stubGlobal("fetch", racing);

    renderPage();
    const input = typeInto("نت");
    await advance(300); // the "نت" request goes in flight (pending 400ms)
    expect(racing).toHaveBeenCalledTimes(1);

    // Complete the query — the second debounce fires; the NEWER
    // response lands immediately.
    fireEvent.change(input, { target: { value: "نتفلكس" } });
    await advance(300);
    expect(screen.getByText("FRESH RESULT")).toBeInTheDocument();

    // Advance WELL past the older response's 400ms delay — it resolves
    // now, AFTER the newer one, and must be dropped.
    await advance(400);
    expect(screen.queryByText("STALE RESULT")).not.toBeInTheDocument();
    expect(screen.getByText("FRESH RESULT")).toBeInTheDocument();
  });

  it("a failed fetch falls back silently — no panel, no error surface, the history stays", async () => {
    localStorage.setItem("subnation_search_history", JSON.stringify(["سبوتيفاي"]));
    const failing = routeSuggest(() => resLike({ ok: false, status: 500, body: { error: "خطأ" } }));
    vi.stubGlobal("fetch", failing);

    renderPage();
    typeInto("نتفلكس");
    await advance(300);

    // Never an error surface: no rows, no error copy — and the history
    // section is the honest fallback ("the history stays"; the grid
    // owns the no-results verdict on Enter).
    expect(screen.queryByRole("listbox", { name: "منتجات مطابقة" })).not.toBeInTheDocument();
    expect(screen.queryByText(/تعذّر/)).not.toBeInTheDocument();
    const history = screen.getByRole("listbox", { name: "عمليات البحث السابقة" });
    expect(within(history).getAllByRole("option")).toHaveLength(1);
  });

  it("a settled zero-match query also falls back to the history", async () => {
    localStorage.setItem("subnation_search_history", JSON.stringify(["سبوتيفاي"]));
    const empty = routeSuggest(() => resLike({ body: [] }));
    vi.stubGlobal("fetch", empty);

    renderPage();
    typeInto("zz");
    await advance(300);

    expect(screen.queryByRole("listbox", { name: "منتجات مطابقة" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "عمليات البحث السابقة" })).toBeInTheDocument();
  });

  it("Escape dismisses the dropdown and keeps the typed text", async () => {
    renderPage();
    const input = typeInto("نتفلكس");
    await advance(300);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(suggestionListbox()).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // The dismissal never eats the query (preventDefault against the
    // type=search quick-clear).
    expect(input).toHaveValue("نتفلكس");
  });

  it("↑/↓ move the aria-activedescendant highlight; Enter navigates the highlighted row, commits on the view-all row, and plain-commits with no highlight", async () => {
    renderPage();
    const input = typeInto("نتفلكس");
    await advance(300);

    const listbox = suggestionListbox();
    const options = within(listbox).getAllByRole("option");

    // No highlight initially.
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(options[0]).toHaveAttribute("aria-selected", "false");

    // ↓ highlights row 0, then row 1 — aria-selected + the id mirror.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", "home-search-sug-0");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", "home-search-sug-1");

    // ↑ walks back and clears past the top (no wrap in either direction).
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).not.toHaveAttribute("aria-activedescendant");

    // Enter with NO highlight = today's plain commit (the URL mirror).
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    fireEvent.keyDown(input, { key: "Enter" });
    await flushAsync();
    expect(String(replaceSpy.mock.calls.at(-1)?.[2])).toMatch(/search=/);
    replaceSpy.mockRestore();

    // Re-open (the commit dismissed the dropdown): clear + retype so
    // the change events actually fire (React dedupes same-value input
    // events) and the suggestions effect re-arms.
    typeInto("");
    typeInto("نتفلكس");
    await advance(300);
    const options2 = within(suggestionListbox()).getAllByRole("option");
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    // 3 rows + view-all: the highlight rests on the LAST option (no wrap).
    expect(options2[3]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", "home-search-sug-all");

    // Enter on a highlighted PRODUCT row navigates to its PDP.
    fireEvent.keyDown(input, { key: "ArrowUp" }); // back to row 2 (Family)
    fireEvent.keyDown(input, { key: "Enter" });
    await flushAsync();
    expect(screen.getByTestId("location-probe").textContent).toBe("/product/p-3");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("clicking a suggestion row navigates to the product and closes the dropdown", async () => {
    renderPage();
    typeInto("نتفلكس");
    await advance(300);

    fireEvent.click(screen.getByText("Netflix Standard"));
    await flushAsync();
    expect(screen.getByTestId("location-probe").textContent).toBe("/product/p-2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("the view-all row commits the search (same as Enter)", async () => {
    renderPage();
    typeInto("نتفلكس");
    await advance(300);

    const replaceSpy = vi.spyOn(window.history, "replaceState");
    fireEvent.click(screen.getByText("عرض كل النتائج"));
    await flushAsync();
    expect(String(replaceSpy.mock.calls.at(-1)?.[2])).toMatch(/search=/);
    // The commit writes the history (the R94-A1 #16 single-owner path).
    expect(JSON.parse(localStorage.getItem("subnation_search_history")!)).toContain("نتفلكس");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    replaceSpy.mockRestore();
  });
});

describe("HomePage — search chrome floors (R161-B: audit F#4 + F#7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHooks();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    localStorage.setItem("subnation_search_history", JSON.stringify(["نتفلكس"]));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.removeItem("subnation_search_history");
  });

  it("the search input and sort select reach the 44px floor on mobile and stay compact ≥md", () => {
    renderPage();

    const input = screen.getByLabelText("البحث في المنتجات");
    expect(input.className).toContain("h-11");
    expect(input.className).toContain("md:h-10");
    // The iOS-zoom-safe mobile text size stays exactly as-is (the
    // shared Input family's text-base baseline — no override here).
    expect(input.className).not.toMatch(/(^|["` ])text-sm[" ]/);

    const select = screen.getByLabelText("ترتيب المنتجات");
    expect(select.className).toContain("h-11");
    expect(select.className).toContain("md:h-10");
  });

  it("the dropdown flips ABOVE the field when there is no room below (audit F#7)", async () => {
    // The 1280×800 audit geometry: the input sits ~40px above the
    // fold. jsdom's innerHeight is 768 — a wrapper bottom of 750
    // leaves 18px (< the 320px panel budget) → flip up.
    const gBCR = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ bottom: 750 } as DOMRect);

    renderPage();
    const input = screen.getByLabelText("البحث في المنتجات");
    fireEvent.focus(input); // opens the history dropdown

    // The panel container is the input's next sibling.
    let container = input.nextElementSibling as HTMLElement;
    expect(container.className).toContain("bottom-full");
    expect(container.className).not.toContain("top-full");

    // Plenty of room below → the default downward panel returns.
    gBCR.mockReturnValue({ bottom: 200 } as DOMRect);
    fireEvent.blur(input, { relatedTarget: document.body });
    await advance(250); // past the 200ms blur guard
    fireEvent.focus(input);
    container = input.nextElementSibling as HTMLElement;
    expect(container.className).toContain("top-full");
    expect(container.className).not.toContain("bottom-full");

    gBCR.mockRestore();
  });
});
