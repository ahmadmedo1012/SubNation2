import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProductPage from "@/pages/product";

/**
 * R111 (D2-F2) — the product page must thread its REAL stock signal into
 * the Product JSON-LD.
 *
 * buildProductLd used to assert InStock for every active product; with the
 * live catalog at 45/45 active products and zero deliverable stock, the
 * structured data contradicted the page UI («نفد المخزون» next to an
 * InStock Offer). The page now passes the same `is_available` its buy
 * button gates on, so the Offer and the UI can never disagree.
 *
 * These tests render the REAL page module and read the JSON-LD the JsonLd
 * component injected into document.head — no useSeo mocking, the full
 * buildProductLd payload is certified end-to-end.
 */

/** The live-catalog money shape: active product, EMPTY deliverable shelf. */
const OUT_OF_STOCK_PRODUCT = {
  id: 5,
  // slug: null — same as the sibling product suites: a non-null slug makes
  // the page replaceState to the canonical slug URL mid-test, wouter
  // re-matches, and the slug-path query (a REAL fetch) then runs against
  // jsdom's network. The availability threading is slug-independent.
  slug: null,
  name: "Netflix شهر",
  description: "اشتراك شهري",
  category: "streaming",
  price: 49,
  sale_price: null,
  image_url: null,
  is_active: true,
  is_available: false, // ← the buy button disables on exactly this
  stock_count: 0,
  discount_percent: null,
  usage_terms: null,
};

const IN_STOCK_PRODUCT = {
  ...OUT_OF_STOCK_PRODUCT,
  is_available: true,
  stock_count: 7,
};

let currentProduct: typeof OUT_OF_STOCK_PRODUCT;

/** R124 (A10-F1): per-test query-state overrides for the 404 suite —
 * spread over the default { data, isLoading: false } shape so a test
 * can drive the page's isNotFoundError branch (error.status === 404). */
let queryOverrides: Partial<{
  data: typeof OUT_OF_STOCK_PRODUCT | undefined;
  isError: boolean;
  error: { status?: number } | null;
}> = {};

vi.mock("@workspace/api-client-react", () => ({
  createOrder: vi.fn(),
  // Sufficient wallet balance so the in-stock case renders the real buy
  // CTA (an insufficient balance swaps it for the top-up prompt — the
  // sibling buy-intent suite mocks 1,000,000 for the same reason).
  getMe: vi.fn(async () => ({ id: 7, wallet_balance: 1_000_000 })),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  getGetProductQueryKey: (id: number | string) => [`/api/products/${id}`],
  getGetProductRecommendationsQueryKey: (id: number | string) => [
    `/api/products/${id}/recommendations`,
  ],
  useGetMe: () => ({ data: { id: 7, wallet_balance: 1_000_000 }, isLoading: false }),
  useGetProduct: () => ({ data: currentProduct, isLoading: false, ...queryOverrides }),
  useGetProductRecommendations: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: vi.fn() }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Numeric legacy URL — the same path the sibling product-page suites use
  // (the by-id query rides the mocked orval client; the page then
  // replaceState's to the canonical slug form once data.slug is present).
  window.history.pushState({}, "", `/product/${currentProduct.id}`);
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <Route path="/product/:slug" component={ProductPage} />
      </Router>
    </QueryClientProvider>,
  );
}

/** The Product block the page injected into <head> (null = none emitted). */
function readProductLd(): { offers?: { availability?: string } } | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    const parsed = JSON.parse(script.textContent ?? "{}") as Record<string, unknown>;
    if (parsed["@type"] === "Product") return parsed as { offers?: { availability?: string } };
  }
  return null;
}

/** A head meta's content (seo-money-pages-r120 pattern). */
function metaContent(selector: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(selector)?.content ?? null;
}

beforeEach(() => {
  toastSpy.mockReset();
  queryOverrides = {};
});

describe("ProductPage — Product LD availability threading (D2-F2)", () => {
  it("active product with zero deliverable stock → Offer says OutOfStock, matching the «نفد المخزون» UI", async () => {
    currentProduct = OUT_OF_STOCK_PRODUCT;
    renderPage();

    // The UI's own stock verdict (the same signal the buy button uses)…
    // (Several surfaces carry the phrase — the status pill, the disabled
    // CTA, the sticky bar — so assert "at least one", not uniqueness.)
    expect(await screen.findAllByText(/نفد المخزون/)).not.toHaveLength(0);

    // …and the structured data agrees now.
    const ld = readProductLd();
    expect(ld).not.toBeNull();
    expect(ld!.offers?.availability).toBe("https://schema.org/OutOfStock");
  });

  it("active product with deliverable stock → Offer says InStock", async () => {
    currentProduct = IN_STOCK_PRODUCT;
    renderPage();

    expect(await screen.findByRole("button", { name: /اشترِ الآن/ })).toBeInTheDocument();

    const ld = readProductLd();
    expect(ld).not.toBeNull();
    expect(ld!.offers?.availability).toBe("https://schema.org/InStock");
  });
});

// ── R124 (A10-F1): unknown product → the noindex 404 surface ─────────────

describe("ProductPage — unknown product 404 SEO (R124 A10-F1)", () => {
  it("404 → not-found UI + noindex,follow + a SELF canonical (never the homepage's)", async () => {
    // The numeric by-id query 404s — the page's isNotFoundError branch.
    queryOverrides = { data: undefined, isError: true, error: { status: 404 } };
    currentProduct = OUT_OF_STOCK_PRODUCT; // renderPage() uses its id for the URL
    renderPage();

    // The honest not-found UI (an outage instead renders «تعذّر تحميل
    // المنتج» + retry — the 404/outage split is the R117 contract).
    expect(await screen.findByText("المنتج غير موجود")).toBeInTheDocument();

    // The 404 SEO branch owns the head — NOT the App-level fallback's
    // index,follow — and the canonical is the phantom URL itself, not
    // the homepage (Google flags homepage-canonicalized soft-404s; this
    // is the exact regression this suite pins: the noindex input existed
    // but was dead until the !product branch rendered the seoBlock,
    // category.tsx A7-F1 pattern).
    expect(document.title).toBe("المنتج غير موجود — SubNation");
    expect(metaContent('meta[name="robots"]')).toBe("noindex,follow");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${window.location.origin}/product/${OUT_OF_STOCK_PRODUCT.id}`,
    );

    // No structured data on the not-found surface (no Product/Offer LD
    // for a product that does not exist).
    expect(readProductLd()).toBeNull();
  });
});
