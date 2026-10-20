/**
 * R-140-g — JSON-LD structured-data completeness (the per-page freeze).
 *
 * Lane inventory (what each page emits, verified at r140 head):
 *   product.tsx  → Product (+Offer: API-threaded price / LYD / ItemAvailability)
 *                  + BreadcrumbList (الرئيسية → الفئة → المنتج)
 *                  + FAQPage (gated on the curated product faq)      [via
 *                  useSeo(productSeoInput(...)) — the R137 verbatim extract
 *                  components/product/product-seo.ts]
 *   category.tsx → BreadcrumbList (الرئيسية → الفئة) + FAQPage (meta.faqs)
 *                  + ItemList (the page's products, home's builder twin)
 *   home.tsx     → Organization + WebSite (+SearchAction) + ItemList
 *   support.tsx  → FAQPage (the static SUPPORT_FAQ canon)
 *
 * Judgment calls this suite FREEZES:
 *   1. NO AggregateRating on Product — the generated Product DTO
 *      (shared/api-client-react api.schemas.ts) carries no rating /
 *      review / reviewCount surface; its `order_count` counts PURCHASES,
 *      not reviews. Fabricating stars is the rich-results spam class
 *      Google penalizes. (See the R-140-g note on ProductLdInput.)
 *   2. support's FAQPage is safe to freeze into ld+json because
 *      SUPPORT_FAQ is a static in-repo module — NOT API-driven — and is
 *      single-sourced with the visible accordion (Google's parity rule).
 *   3. Prices are NEVER constants: offers.price is the API number
 *      stringified by Number#toFixed(2) (Western digits, LYD).
 *
 * METHOD — three layers:
 *   • pure-builder pins (required keys on every build* function);
 *   • BEHAVIORAL per-page pins (the r120/product-seo-availability
 *     harness: real page modules rendered at jsdom, the LD read back
 *     out of the <script type="application/ld+json"> nodes JsonLd
 *     appended to document.head — no useSeo mocking, the full
 *     page → useSeo → JsonLd → head pipeline certified);
 *   • source-scan pins (the emission call exists in every page file).
 *
 * Note the .ts extension: JSX-free on purpose — the pages are .tsx
 * modules but the harness composes them with React.createElement, so
 * this suite needs no JSX of its own.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonLd } from "@/components/seo/JsonLd";
import { SUPPORT_FAQ } from "@/components/support/support-faq";
import { CartProvider } from "@/lib/cart";
import {
  buildBreadcrumbLd,
  buildFaqLd,
  buildItemListLd,
  buildOrganizationLd,
  buildProductLd,
  buildWebsiteLd,
  type ProductLdInput,
} from "@/lib/seo-builders";
import CategoryPage from "@/pages/category";
import HomePage from "@/pages/home";
import ProductPage from "@/pages/product";
import SupportPage from "@/pages/support";

// ── Fixtures & shared state ─────────────────────────────────────────────────

/** seo-builders' getOrigin(): no VITE_APP_ORIGIN under vitest → the
 *  DEFAULT_ORIGIN every LD URL is absolutized against. */
const ORIGIN = "https://subnation.ly";

/**
 * The PDP fixture: slug-less on purpose (the sibling product suites'
 * trick — a non-null slug makes the page replaceState to the canonical
 * slug URL mid-test, wouter re-matches, and the slug-path query then
 * runs a REAL fetch against jsdom's network). `order_count: 11` is the
 * no-fabrication probe: purchases, NOT reviews — the Product LD must
 * not dress it up as AggregateRating.
 */
const PDP_PRODUCT = {
  id: 5,
  slug: null,
  name: "Netflix شهر",
  description: "اشتراك شهري",
  description_long: null,
  faq: null,
  features: null,
  seo_title: null,
  seo_description: null,
  image_url: "/products/netflix.webp",
  price: 49,
  price_from: false,
  category: "streaming",
  is_active: true,
  usage_terms: null,
  stock_count: 7,
  is_available: true,
  sale_price: null,
  discount_percent: null,
  order_count: 11,
  variants: [],
};

/** A list-endpoint-shaped row (home/category grids + ItemList LD). */
const LIST_PRODUCT = {
  id: 7,
  slug: "expressvpn-12m",
  name: "ExpressVPN — 12 شهراً",
  category: "vpn",
  image_url: "/products/expressvpn.webp",
  price: 120,
  price_from: false,
  sale_price: 90,
  discount_percent: 25,
  is_active: true,
  is_available: true,
  stock_count: 5,
  order_count: 11,
  variant_count: 0,
};

/** Mutable per-test mock state (read lazily inside the mock closures). */
const state = {
  products: [] as unknown[],
  product: undefined as typeof PDP_PRODUCT | undefined,
};

vi.mock("@workspace/api-client-react", () => ({
  // The union of RUNTIME bindings the four pages (+ RecommendationsSection)
  // import — every component-level import is type-only (erased).
  createOrder: vi.fn(),
  customFetch: vi.fn(),
  getGetCatalogStatsQueryKey: () => ["/api/catalog-stats"],
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetProductQueryKey: (id: number | string) => [`/api/products/${id}`],
  getGetProductRecommendationsQueryKey: (id: number | string) => [
    `/api/products/${id}/recommendations`,
  ],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: (p: unknown) => ["/api/orders", p],
  getListProductsQueryKey: (p: unknown) => ["/api/products", p],
  getMe: vi.fn(),
  getProduct: vi.fn(),
  // stats stay pending → the hero stats widgets render skeletons and
  // never dereference an undefined CatalogStats.
  useGetCatalogStats: () => ({ data: undefined, isPending: true }),
  useGetMe: () => ({ data: undefined, isLoading: false }),
  useGetProduct: () => ({
    data: state.product,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGetProductRecommendations: () => ({ data: [], isLoading: false, isError: false }),
  useListOrders: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useListProducts: () => ({
    data: state.products,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

// Every page (and nothing else in the render tree) reads only `token`
// from the auth context — an anonymous shape drives all four pages.
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: null }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

beforeEach(() => {
  state.products = [];
  state.product = undefined;
  window.history.pushState({}, "", "/");
});

// The support page stubs the global fetch (its ticket inbox is
// auth-gated — anonymous never fetches, but the stub keeps any future
// mount-time fetch from hitting jsdom's network).
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Head readers (seo-money-pages-r120 pattern) ────────────────────────────

type Json = Record<string, unknown>;

function readLdBlocks(): Json[] {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].map((script) =>
    JSON.parse(script.textContent ?? "{}"),
  );
}

function ldTypes(): string[] {
  return readLdBlocks().map((block) => String(block["@type"]));
}

function ldOf(type: string): Json {
  const block = readLdBlocks().find((b) => b["@type"] === type);
  expect(block, `expected an emitted ${type} JSON-LD block`).toBeDefined();
  return block as Json;
}

// ── Render harness ─────────────────────────────────────────────────────────

function renderRoute(pattern: string, component: ComponentType, url: string) {
  window.history.pushState({}, "", url);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        CartProvider,
        null,
        createElement(Router, null, createElement(Route, { path: pattern, component })),
      ),
    ),
  );
}

// ── Source-scan helpers (money-path-chrome-r139 idiom) ────────────────────

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Strip BOTH comment kinds so pins read CODE, not the R-140-g prose
 *  that legitimately names the contracts (e.g. the AggregateRating
 *  judgment note names the forbidden keys).
 *
 *  LINE-COMMENTS-FIRST — the r140-a craft lesson (found live on
 *  product.tsx): the file's own header says `@/components/product/*
 *  (verbatim moves…` — a LINE comment whose prose glob contains `/*`.
 *  A block-first stripper opens a PHANTOM comment at that glob and
 *  swallows ~28 KB of code (including the useSeo call this suite
 *  pins). Stripping line comments first removes the glob-bearing prose
 *  before the block pass ever sees it; `//` inside block comments is
 *  then harmless (the block pass eats the whole comment anyway), and
 *  protocol strings (`https://…`, always preceded by ":") never match
 *  the (^|\s)// line-comment opener. */
function stripComments(src: string): string {
  return src.replace(/(^|\s)\/\/[^\n]*/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, " ");
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Pure builders — required keys + no-fabrication
// ════════════════════════════════════════════════════════════════════════════

describe("R-140-g — buildProductLd (pure): the required Product/Offer keys", () => {
  const BASE: ProductLdInput = {
    id: 7,
    slug: "expressvpn-12m",
    name: "ExpressVPN — 12 شهراً",
    price: 120,
  };

  it("@type/@context/@id/url are slug-canonical and absolute", () => {
    const ld = buildProductLd(BASE);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Product");
    expect(ld["@id"]).toBe(`${ORIGIN}/product/expressvpn-12m`);
    expect(ld.url).toBe(`${ORIGIN}/product/expressvpn-12m`);
    // slug-less legacy rows fall back to the numeric id.
    expect(buildProductLd({ ...BASE, slug: null })["@id"]).toBe(`${ORIGIN}/product/7`);
  });

  it("Offer: API price → Western-digit 2dp string, LYD, NewCondition, InStock default", () => {
    const offers = buildProductLd(BASE).offers as Json;
    expect(offers.price).toBe("120.00");
    expect(offers.priceCurrency).toBe("LYD");
    expect(offers.itemCondition).toBe("https://schema.org/NewCondition");
    expect(offers.availability).toBe("https://schema.org/InStock");
    expect(offers.url).toBe(`${ORIGIN}/product/expressvpn-12m`);
    // R166 (F2): the seller Organization — Google's recommended Offer
    // field; SubNation IS the seller (field-mirrored with the backend
    // shell builder so raw and hydrated LD agree).
    expect(offers.seller).toEqual({ "@type": "Organization", name: "SubNation" });
    // Fractional API prices stay Western digits (never ٤٩٫٥٠).
    expect((buildProductLd({ ...BASE, price: 49.5 }).offers as Json).price).toBe("49.50");
    // priceValidUntil: end-of-current-year + 1 (the Merchant-required
    // future date) — mirrored from the same clock the builder reads.
    const year = new Date().getUTCFullYear() + 1;
    expect(offers.priceValidUntil).toBe(`${year}-12-31`);
  });

  it("availability follows the REAL stock/active signals (the D2-F2 contract)", () => {
    const oos = buildProductLd({ ...BASE, isAvailable: false }).offers as Json;
    expect(oos.availability).toBe("https://schema.org/OutOfStock");
    const inactive = buildProductLd({ ...BASE, isActive: false }).offers as Json;
    expect(inactive.availability).toBe("https://schema.org/OutOfStock");
  });

  it("image absolutizes site-relative DB paths; missing image falls back to the logo", () => {
    // R174: art URLs carry the version (?v= — lib/product-art) so
    // crawlers re-fetch replaced art immediately.
    expect(buildProductLd({ ...BASE, imageUrl: "/products/x.webp" }).image).toBe(
      `${ORIGIN}/products/x.webp?v=r176`,
    );
    expect(buildProductLd({ ...BASE, imageUrl: null }).image).toBe(`${ORIGIN}/subnation-logo.png`);
  });

  it("description precedence descriptionLong → description → name; sku is slug-based", () => {
    expect(
      buildProductLd({ ...BASE, description: "short", descriptionLong: "long form" }).description,
    ).toBe("long form");
    expect(buildProductLd({ ...BASE, description: "short" }).description).toBe("short");
    expect(buildProductLd(BASE).description).toBe(BASE.name);
    expect(buildProductLd(BASE).sku).toBe("subnation-expressvpn-12m");
  });

  it("NO AggregateRating / reviewCount / ratingValue — the no-fabrication guard", () => {
    // The builder's input type carries no rating fields at all; the
    // output must not invent them either (order_count-style purchase
    // counters live on the DTO, NOT on ProductLdInput — see the R-140-g
    // judgment note on ProductLdInput in lib/seo-builders.ts).
    const serialized = JSON.stringify(buildProductLd(BASE));
    expect(serialized).not.toMatch(/aggregateRating|reviewCount|ratingValue|"reviews"/);
    expect("aggregateRating" in buildProductLd(BASE)).toBe(false);
  });
});

describe("R-140-g — the graph/collection builders (pure)", () => {
  it("buildBreadcrumbLd: sequential positions + absolutized relative hrefs", () => {
    const ld = buildBreadcrumbLd([
      { name: "الرئيسية", href: "/" },
      { name: "شبكات VPN", href: "/category/vpn" },
      { name: "ExpressVPN", href: "/product/expressvpn-12m" },
    ]);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "شبكات VPN", item: `${ORIGIN}/category/vpn` },
      {
        "@type": "ListItem",
        position: 3,
        name: "ExpressVPN",
        item: `${ORIGIN}/product/expressvpn-12m`,
      },
    ]);
    // Already-absolute hrefs pass through untouched; bare paths get "/".
    const mixed = buildBreadcrumbLd([
      { name: "a", href: "https://example.com/x" },
      { name: "b", href: "support" },
    ]).itemListElement as Json[];
    expect(mixed[0].item).toBe("https://example.com/x");
    expect(mixed[1].item).toBe(`${ORIGIN}/support`);
    // R178 (RH-55): category passes the shell's @id so hydration merges the
    // two BreadcrumbList definitions instead of adding an anonymous second.
    const identified = buildBreadcrumbLd(
      [{ name: "الرئيسية", href: "/" }],
      "/category/vpn#breadcrumb",
    );
    expect(identified["@id"]).toBe(`${ORIGIN}/category/vpn#breadcrumb`);
    const absolute = buildBreadcrumbLd(
      [{ name: "الرئيسية", href: "/" }],
      "https://subnation.ly/category/vpn#breadcrumb",
    );
    expect(absolute["@id"]).toBe("https://subnation.ly/category/vpn#breadcrumb");
  });

  it("buildItemListLd: slug-canonical URLs + sequential positions", () => {
    const ld = buildItemListLd([
      { id: 9, slug: "expressvpn-12m", name: "ExpressVPN" },
      { id: 12, slug: null, name: "Legacy" },
    ]);
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        url: `${ORIGIN}/product/expressvpn-12m`,
        name: "ExpressVPN",
      },
      { "@type": "ListItem", position: 2, url: `${ORIGIN}/product/12`, name: "Legacy" },
    ]);
  });

  it("buildWebsiteLd: inLanguage ar + the REAL SearchAction (?search= drives home)", () => {
    const site = buildWebsiteLd();
    expect(site["@type"]).toBe("WebSite");
    expect(site.url).toBe(ORIGIN);
    expect(site.inLanguage).toBe("ar");
    expect((site.publisher as Json)["@id"]).toBe(`${ORIGIN}/#organization`);
    const action = site.potentialAction as Json;
    expect(action["@type"]).toBe("SearchAction");
    expect((action.target as Json).urlTemplate).toBe(`${ORIGIN}/?search={search_term_string}`);
    expect(action["query-input"]).toBe("required name=search_term_string");
  });

  it("buildOrganizationLd: the graph node — @id, name, Libya area, absolute logo", () => {
    const org = buildOrganizationLd();
    expect(org["@type"]).toBe("Organization");
    expect(org["@id"]).toBe(`${ORIGIN}/#organization`);
    expect(org.name).toBe("SubNation");
    expect(org.url).toBe(ORIGIN);
    expect(org.logo).toBe(`${ORIGIN}/subnation-logo.png`);
    expect((org.areaServed as Json).name).toBe("Libya");
    expect((org.address as Json).addressCountry).toBe("LY");
  });

  it("buildFaqLd: Question/acceptedAnswer shape, verbatim pass-through", () => {
    const ld = buildFaqLd([{ question: "س؟", answer: "ج." }]);
    expect(ld["@type"]).toBe("FAQPage");
    expect(ld.mainEntity).toEqual([
      {
        "@type": "Question",
        name: "س؟",
        acceptedAnswer: { "@type": "Answer", text: "ج." },
      },
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. The JsonLd emitter contract
// ════════════════════════════════════════════════════════════════════════════

describe("R-140-g — JsonLd emitter: managed scripts, escaping, cleanup", () => {
  it("one managed script per block; </script> sequences defused; removed on unmount", () => {
    const blocks = [
      {
        "@context": "https://schema.org",
        "@type": "Thing",
        name: "</script><script>alert(1)</script>",
      },
    ];
    const { unmount } = render(createElement(JsonLd, { blocks }));

    const scripts = [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ] as HTMLScriptElement[];
    expect(scripts).toHaveLength(1);
    expect(scripts[0].dataset.managedBy).toBe("seo-jsonld");
    // The payload defuses the closing-tag sequence…
    expect(scripts[0].textContent).toContain("\\u003c/script\\u003e");
    expect(scripts[0].textContent).not.toContain("</script>");
    // …while still round-tripping to the ORIGINAL value (JSON.parse
    // unescapes \u003c back to <).
    expect((JSON.parse(scripts[0].textContent ?? "{}") as Json).name).toBe(
      "</script><script>alert(1)</script>",
    );

    unmount();
    expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0);
  });

  it("empty blocks → nothing emitted (no thin/empty ld+json script)", () => {
    render(createElement(JsonLd, { blocks: [] }));
    expect(document.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Behavioral per-page pins (real page modules → real head)
// ════════════════════════════════════════════════════════════════════════════

describe("R-140-g — product.tsx: Product + Offer + BreadcrumbList end-to-end", () => {
  it("Product LD carries the API-threaded price/currency/availability + absolute identity", () => {
    state.product = PDP_PRODUCT;
    renderRoute("/product/:slug", ProductPage, `/product/${PDP_PRODUCT.id}`);

    const ld = ldOf("Product");
    expect(ld.name).toBe("Netflix شهر");
    expect(ld.description).toBe("اشتراك شهري");
    expect(ld["@id"]).toBe(`${ORIGIN}/product/5`);
    expect(ld.url).toBe(`${ORIGIN}/product/5`);
    expect(ld.image).toBe(`${ORIGIN}/products/netflix.webp?v=r176`);
    const offers = ld.offers as Json;
    expect(offers.price).toBe("49.00"); // the API number, stringified — never a constant
    expect(offers.priceCurrency).toBe("LYD");
    expect(offers.availability).toBe("https://schema.org/InStock");
    // R166 (F2): the Offer seller rides the emitted page LD too (the
    // same Organization node the backend shell builder mirrors).
    expect(offers.seller).toEqual({ "@type": "Organization", name: "SubNation" });
  });

  it("BreadcrumbList: the الرئيسية → الفئة → المنتج chain with absolute items", () => {
    state.product = PDP_PRODUCT;
    renderRoute("/product/:slug", ProductPage, `/product/${PDP_PRODUCT.id}`);

    expect(ldOf("BreadcrumbList").itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: `${ORIGIN}/` },
      // R161-C: the streaming crumb rides the honest on-demand
      // viewing-platforms label (categoryLabel, re-pinned).
      {
        "@type": "ListItem",
        position: 2,
        name: "منصات المشاهدة",
        item: `${ORIGIN}/category/streaming`,
      },
      { "@type": "ListItem", position: 3, name: "Netflix شهر", item: `${ORIGIN}/product/5` },
    ]);
  });

  it("NO AggregateRating on the emitted Product — the DTO's order_count is purchases, not reviews", () => {
    state.product = PDP_PRODUCT;
    renderRoute("/product/:slug", ProductPage, `/product/${PDP_PRODUCT.id}`);

    const serialized = JSON.stringify(readLdBlocks().find((b) => b["@type"] === "Product"));
    expect(serialized).not.toMatch(/aggregateRating|reviewCount|ratingValue/);
  });

  it("out-of-stock product → Offer availability OutOfStock (UI/LD agreement)", () => {
    state.product = { ...PDP_PRODUCT, is_available: false, stock_count: 0 };
    renderRoute("/product/:slug", ProductPage, `/product/${PDP_PRODUCT.id}`);

    expect((ldOf("Product").offers as Json).availability).toBe("https://schema.org/OutOfStock");
  });
});

describe("R-140-g — category.tsx: BreadcrumbList + FAQPage + ItemList end-to-end", () => {
  it("the full three-block set is emitted for a known slug", () => {
    state.products = [LIST_PRODUCT];
    renderRoute("/category/:slug", CategoryPage, "/category/vpn");
    expect(ldTypes()).toEqual(expect.arrayContaining(["BreadcrumbList", "FAQPage", "ItemList"]));
  });

  it("BreadcrumbList: الرئيسية → الفئة (label verbatim, absolute URL)", () => {
    state.products = [LIST_PRODUCT];
    renderRoute("/category/:slug", CategoryPage, "/category/vpn");
    expect(ldOf("BreadcrumbList").itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "الرئيسية", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "شبكات VPN", item: `${ORIGIN}/category/vpn` },
    ]);
  });

  it("ItemList: the page's products, slug-canonical URLs", () => {
    state.products = [LIST_PRODUCT];
    renderRoute("/category/:slug", CategoryPage, "/category/vpn");
    expect(ldOf("ItemList").itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        url: `${ORIGIN}/product/expressvpn-12m`,
        name: "ExpressVPN — 12 شهراً",
      },
    ]);
  });

  it("FAQPage carries the category canon Q&A verbatim", () => {
    state.products = [LIST_PRODUCT];
    renderRoute("/category/:slug", CategoryPage, "/category/vpn");
    const first = (ldOf("FAQPage").mainEntity as Json[])[0];
    expect(first["@type"]).toBe("Question");
    expect(first.name).toBe("هل استخدام VPN قانوني في ليبيا؟");
    expect((first.acceptedAnswer as Json)["@type"]).toBe("Answer");
  });

  it("empty category → Breadcrumb + FAQ still ship, ItemList is suppressed (thin-LD guard)", () => {
    state.products = [];
    renderRoute("/category/:slug", CategoryPage, "/category/vpn");
    expect(ldTypes()).toEqual(expect.arrayContaining(["BreadcrumbList", "FAQPage"]));
    expect(ldTypes()).not.toContain("ItemList");
  });
});

describe("R-140-g — home.tsx: Organization + WebSite + ItemList end-to-end", () => {
  it("the full three-block set is emitted once the catalog loads", () => {
    state.products = [LIST_PRODUCT];
    renderRoute("/", HomePage, "/");
    expect(ldTypes()).toEqual(expect.arrayContaining(["Organization", "WebSite", "ItemList"]));
  });

  it("Organization: the graph node with @id, name, Libya area, absolute logo", () => {
    state.products = [LIST_PRODUCT];
    renderRoute("/", HomePage, "/");
    const org = ldOf("Organization");
    expect(org["@id"]).toBe(`${ORIGIN}/#organization`);
    expect(org.name).toBe("SubNation");
    expect((org.areaServed as Json).name).toBe("Libya");
    expect(org.logo).toBe(`${ORIGIN}/subnation-logo.png`);
  });

  it("WebSite: inLanguage ar, publisher graph-linked, REAL SearchAction target", () => {
    state.products = [LIST_PRODUCT];
    renderRoute("/", HomePage, "/");
    const site = ldOf("WebSite");
    expect(site.inLanguage).toBe("ar");
    expect((site.publisher as Json)["@id"]).toBe(`${ORIGIN}/#organization`);
    const action = site.potentialAction as Json;
    expect((action.target as Json).urlTemplate).toBe(`${ORIGIN}/?search={search_term_string}`);
    expect(action["query-input"]).toBe("required name=search_term_string");
  });

  it("ItemList: the loaded catalog with slug URLs; empty catalog → suppressed", () => {
    state.products = [LIST_PRODUCT];
    const withCatalog = renderRoute("/", HomePage, "/");
    expect(ldOf("ItemList").itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        url: `${ORIGIN}/product/expressvpn-12m`,
        name: "ExpressVPN — 12 شهراً",
      },
    ]);

    // Unmount BEFORE the second render — RTL's cleanup only runs in
    // afterEach, so the first page's head scripts would otherwise
    // still be live and the ItemList of render #1 would mask the guard.
    withCatalog.unmount();
    state.products = [];
    renderRoute("/", HomePage, "/");
    expect(ldTypes()).not.toContain("ItemList");
  });
});

describe("R-140-g — support.tsx: FAQPage from the static canon end-to-end", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: () => Promise.resolve([]) })),
    );
  });

  it("FAQPage: every SUPPORT_FAQ Q&A, Question/Answer shape, verbatim Arabic", () => {
    renderRoute("/support", SupportPage, "/support");
    const entity = ldOf("FAQPage").mainEntity as Json[];
    expect(entity).toHaveLength(SUPPORT_FAQ.length);
    expect(entity[0]["@type"]).toBe("Question");
    expect(entity[0].name).toBe(SUPPORT_FAQ[0].question);
    expect((entity[0].acceptedAnswer as Json).text).toBe(SUPPORT_FAQ[0].answer);
  });

  it("the same Q&A renders visibly on the page (Google's parity rule)", async () => {
    renderRoute("/support", SupportPage, "/support");
    expect(await screen.findByText(SUPPORT_FAQ[0].question)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Source-scan pins — the emission call exists in every page file
// ════════════════════════════════════════════════════════════════════════════

describe("R-140-g — the per-page emission calls exist in source", () => {
  it("product.tsx calls useSeo(productSeoInput(...)); product-seo.ts builds the trio", () => {
    const page = stripComments(read("src/pages/product.tsx"));
    expect(page).toContain("useSeo(");
    expect(page).toContain("productSeoInput({");
    const seo = stripComments(read("src/components/product/product-seo.ts"));
    expect(seo).toContain("buildProductLd({");
    expect(seo).toContain("buildBreadcrumbLd([");
    expect(seo).toContain("buildFaqLd(productFaqs)");
  });

  it("category.tsx builds Breadcrumb + ItemList + FAQ", () => {
    const page = stripComments(read("src/pages/category.tsx"));
    expect(page).toContain("buildBreadcrumbLd(");
    expect(page).toContain("#breadcrumb");
    expect(page).toContain("buildItemListLd(");
    expect(page).toContain("buildFaqLd(meta.faqs)");
  });

  it("home.tsx builds Organization + WebSite + ItemList", () => {
    const page = stripComments(read("src/pages/home.tsx"));
    expect(page).toContain("buildOrganizationLd()");
    expect(page).toContain("buildWebsiteLd()");
    expect(page).toContain("buildItemListLd(");
  });

  it("support.tsx builds FAQPage from the static SUPPORT_FAQ module", () => {
    const page = stripComments(read("src/pages/support.tsx"));
    expect(page).toContain("buildFaqLd(SUPPORT_FAQ)");
    // The volatility judgment: the FAQ is NOT API-driven — no FAQ fetch.
    expect(page).not.toMatch(/\/api\/[a-z-]*faq/);
  });

  it("seo-builders.ts: DEFAULT_ORIGIN, LYD currency, no fabricated prices or ratings", () => {
    const builders = stripComments(read("src/lib/seo-builders.ts"));
    expect(builders).toContain('DEFAULT_ORIGIN = "https://subnation.ly"');
    expect(builders).toContain('priceCurrency: "LYD"');
    // No fabricated review/rating machinery anywhere in the builders.
    expect(builders).not.toMatch(/aggregateRating|reviewCount|ratingValue/);
    // No hardcoded monetary constant — offers.price only ever comes
    // from the caller's API number.
    expect(builders).not.toMatch(/price:\s*\d/);
  });
});
