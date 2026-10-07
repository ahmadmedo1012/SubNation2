/**
 * R120-B3 (A7-F1 + A7-F2 + A7-F6) — the money pages' SEO regression suite.
 *
 * A7-F1 (P1): category.tsx and flash-sales.tsx used to call
 *   `useSeo({...})` as a statement — discarding the returned element, so
 *   MetaTags/JsonLd never mounted. All 7 category landing pages +
 *   /flash-sales shipped the DEFAULT title, the homepage canonical and
 *   ZERO JSON-LD (Breadcrumb/FAQ/ItemList) in the deployed bundle. These
 *   tests render the REAL page modules and read the head the components
 *   actually wrote — the regression is now impossible to reintroduce
 *   without a red build (the exact class the r103 V3-A1 audit caught via
 *   headless Chromium, pinned here at jsdom level instead).
 *
 * A7-F2 (P1): /support's anonymous hard-redirect to /login is pinned as
 *   GONE — the FAQ surface (accordion + FAQPage JSON-LD + meta) must
 *   render for logged-out visitors with a login CTA, not a redirect.
 *
 * A7-F6 (P2): og:image dims default to the REAL /opengraph.jpg
 *   1280×720 (the old hardcoded 1200×630 lied about every image).
 *
 * Harness notes (the established page-suite pattern):
 *   - data hooks are mocked at the module boundary (vitest config's
 *     documented pattern) — no network, no react-query engine;
 *   - MetaTags/JsonLd write document.head directly, so the assertions
 *     read document.title + the injected <script type="application/ld+json">
 *     nodes (product-seo-availability.test.tsx's readProductLd pattern);
 *   - jsdom's document.head starts EMPTY — MetaTags upserts create every
 *     tag, and JsonLd removes its scripts on unmount (RTL afterEach).
 */

import { render, screen } from "@testing-library/react";
import { Route, Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CategoryPage from "@/pages/category";
import FlashSalesPage from "@/pages/flash-sales";
import SupportPage from "@/pages/support";
import { CartProvider } from "@/lib/cart";
import { useGetFlashSale, useListProducts, type Product } from "@workspace/api-client-react";

// ── Module-boundary mocks ──────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useListProducts: vi.fn(),
  useGetFlashSale: vi.fn(),
  getListProductsQueryKey: (params: unknown) => ["/api/products", params],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

const { useAuth } = vi.mocked(await import("@/lib/auth"));

type ProductsResult = ReturnType<typeof useListProducts>;
type FlashResult = ReturnType<typeof useGetFlashSale>;

function mockProducts(over: Partial<ProductsResult>) {
  vi.mocked(useListProducts).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as ProductsResult);
}

function mockFlashSale(flash_sale: FlashResult["data"]) {
  vi.mocked(useGetFlashSale).mockReturnValue({
    data: { flash_sale },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as FlashResult);
}

/** A live-catalog-shaped product with a slug + a real flash-sale discount. */
const VPN_PRODUCT: Product = {
  id: 7,
  slug: "expressvpn-12m",
  name: "ExpressVPN — 12 شهراً",
  category: "vpn",
  image_url: "/products/expressvpn.webp",
  price: 120,
  sale_price: 90,
  discount_percent: 25,
  is_active: true,
  is_available: true,
  stock_count: 5,
  order_count: 11,
};

// ── Head readers ───────────────────────────────────────────────────────────

/** Parsed JSON-LD blocks injected by JsonLd (product-seo-availability pattern). */
function readLdBlocks(): Array<Record<string, unknown>> {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].map((script) =>
    JSON.parse(script.textContent ?? "{}"),
  ) as Array<Record<string, unknown>>;
}

function ldTypes(): string[] {
  return readLdBlocks().map((block) => String(block["@type"]));
}

function metaContent(selector: string): string | null {
  return document.head.querySelector<HTMLMetaElement>(selector)?.content ?? null;
}

/** seo-builders' getOrigin() — no env override in tests, so its
 * DEFAULT_ORIGIN ("https://subnation.ly") builds every LD URL.
 * MetaTags' getAppOrigin() instead falls back to jsdom's origin for the
 * canonical link — both are asserted with their OWN value below. */
const LD_ORIGIN = "https://subnation.ly";
const CANONICAL_ORIGIN = window.location.origin;

// ── A7-F1: /category/:slug ─────────────────────────────────────────────────

describe("R120-B3 A7-F1 — CategoryPage renders its SEO block (was: useSeo discarded)", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/category/vpn");
  });

  it("known slug → category metaTitle in <title>, index,follow, and Breadcrumb+FAQ+ItemList JSON-LD", () => {
    mockProducts({ data: [VPN_PRODUCT] });

    render(
      <CartProvider>
        <Router>
          <Route path="/category/:slug" component={CategoryPage} />
        </Router>
      </CartProvider>,
    );

    // The category map's metaTitle (categories.ts vpn entry) — NOT the
    // app default. This is the exact line the discarded-return bug broke.
    expect(document.title).toBe("اشتراكات VPN في ليبيا — ExpressVPN و CyberGhost و IPVanish");
    expect(metaContent('meta[name="robots"]')).toBe("index,follow");

    // The three structured-data blocks the page assembles (the old bug
    // shipped zero of them on all 7 landing pages).
    expect(ldTypes()).toEqual(expect.arrayContaining(["BreadcrumbList", "FAQPage", "ItemList"]));

    // ItemList URLs are slug-canonical (/product/expressvpn-12m, not /product/7).
    const itemList = readLdBlocks().find((b) => b["@type"] === "ItemList");
    expect(itemList?.itemListElement).toEqual([
      expect.objectContaining({
        url: `${LD_ORIGIN}/product/expressvpn-12m`,
        name: VPN_PRODUCT.name,
      }),
    ]);

    // Canonical points at THIS category, not the homepage.
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${CANONICAL_ORIGIN}/category/vpn`,
    );

    // og:image dims default to the REAL /opengraph.jpg size (A7-F6).
    expect(metaContent('meta[property="og:image:width"]')).toBe("1280");
    expect(metaContent('meta[property="og:image:height"]')).toBe("720");
  });

  it("unknown slug → the noindex not-found surface still gets its title + robots applied", () => {
    window.history.pushState({}, "", "/category/gaming");
    mockProducts({ data: [] });

    render(
      <CartProvider>
        <Router>
          <Route path="/category/:slug" component={CategoryPage} />
        </Router>
      </CartProvider>,
    );

    expect(document.title).toBe("صفحة غير موجودة — SubNation");
    expect(metaContent('meta[name="robots"]')).toBe("noindex,follow");
    // No structured data on the not-found surface.
    expect(readLdBlocks()).toHaveLength(0);
  });
});

// ── A7-F1: /flash-sales ────────────────────────────────────────────────────

describe("R120-B3 A7-F1 — FlashSalesPage renders its SEO block + ItemList LD", () => {
  it("on-sale catalog → page title + slug-URL ItemList JSON-LD", () => {
    mockProducts({ data: [VPN_PRODUCT] });
    mockFlashSale(null);

    render(
      <Router>
        <FlashSalesPage />
      </Router>,
    );

    expect(document.title).toBe("عروض فلاش — SubNation");

    // ItemList names the on-sale products with slug URLs (home.tsx idiom).
    const types = ldTypes();
    expect(types).toContain("ItemList");
    const itemList = readLdBlocks().find((b) => b["@type"] === "ItemList");
    expect(itemList?.itemListElement).toEqual([
      expect.objectContaining({
        url: `${LD_ORIGIN}/product/expressvpn-12m`,
        name: VPN_PRODUCT.name,
      }),
    ]);

    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      `${CANONICAL_ORIGIN}/flash-sales`,
    );
  });

  it("empty/no-sale catalog → NO ItemList LD (thin structured data is worse than none)", () => {
    mockProducts({ data: [] });
    mockFlashSale(null);

    render(
      <Router>
        <FlashSalesPage />
      </Router>,
    );

    expect(document.title).toBe("عروض فلاش — SubNation");
    expect(ldTypes()).not.toContain("ItemList");
  });
});

// ── A7-F2: /support anonymous ──────────────────────────────────────────────

describe("R120-B3 A7-F2 — anonymous /support: public FAQ surface, no redirect", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.pushState({}, "", "/support");
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    useAuth.mockReturnValue({ token: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the FAQ + FAQPage JSON-LD + login CTA for a logged-out visitor (no /login redirect)", async () => {
    render(
      <Router>
        <SupportPage />
      </Router>,
    );

    // The visible FAQ accordion renders (find — mount settles inside act()).
    expect(await screen.findByText("هل أحصل على مكافأة عند دعوة أصدقائي؟")).toBeInTheDocument();

    // The FAQPage structured data rides the public surface.
    expect(ldTypes()).toContain("FAQPage");

    // The auth CTA deep-links back to /support (the guarded-page
    // convention), replacing the old hard redirect.
    const cta = screen.getByRole("link", { name: /سجّل الدخول لفتح تذكرة/ });
    expect(cta).toHaveAttribute("href", "/login?redirect=/support");

    // The ticket inbox is auth-gated: no ticket fetch fires anonymously…
    expect(fetchSpy).not.toHaveBeenCalled();
    // …and the page is still on /support (no wouter navigation happened).
    expect(window.location.pathname).toBe("/support");

    // SEO meta still applies for the public surface.
    expect(document.title).toBe("الدعم والأسئلة الشائعة — SubNation");
    expect(metaContent('meta[name="robots"]')).toBe("index,follow");
  });
});
