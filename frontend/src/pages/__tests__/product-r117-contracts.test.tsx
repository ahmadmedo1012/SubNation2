import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import ProductPage from "@/pages/product";
import { createElement } from "react";

/**
 * R117 product-page contracts (audit A2 findings F-1/F-2/F-3):
 *
 *   F-1 — the six END-column (buy-panel) blocks must carry a mobile
 *         side gutter (max-lg:px-5 / max-lg:mx-5). The desktop split
 *         (R116-S2) dissolved the old shared p-5 container and only
 *         compensated the START column — the variant selector, price
 *         box, trust badges and coupon rendered full-bleed against the
 *         card border on every phone.
 *
 *   F-3 — the FAQ accordion's DOM position must match its visual
 *         position (after the trust grid, before the coupon). It used
 *         to sit in DOM right after the features list inside the START
 *         section while rendering visually after trust — keyboard/AT
 *         users Tabbed across a visually distant jump (WCAG 1.3.2 /
 *         2.4.3).
 *
 *   F-2 — the sticky mobile buy bar must consume the
 *         useKeyboardVisibility hook (the hook value existed since R116
 *         but was never wired — dead listener, bar stayed under the iOS
 *         keyboard) and carry the short-viewport CSS fallback.
 */

const PRODUCT = {
  id: 42,
  slug: "r117-rich-product",
  name: "R117 منتج غني",
  description: "منتج بكل الحقول",
  category: "streaming",
  price: 25,
  price_from: true,
  sale_price: 20,
  image_url: null,
  is_active: true,
  is_available: true,
  stock_count: 8,
  discount_percent: 20,
  usage_terms: "شروط الاستخدام: جهاز واحد",
  order_count: 25,
  variants: [
    {
      id: 1,
      plan_label: "أساسي",
      duration_label: "شهر واحد",
      label: "أساسي — شهر واحد",
      price: 25,
      sale_price: 20,
      discount_percent: 20,
      is_available: true,
    },
    {
      id: 2,
      plan_label: "بريميوم",
      duration_label: "شهر واحد",
      label: "بريميوم — شهر واحد",
      price: 45,
      sale_price: 40,
      discount_percent: 11,
      is_available: true,
    },
  ],
};

const PRODUCT_ANY = {
  ...PRODUCT,
  description_long: "وصف طويل للمنتج",
  features: ["ميزة أولى", "ميزة ثانية"],
  faq: [
    { question: "سؤال أول؟", answer: "جواب أول." },
    { question: "سؤال ثانٍ؟", answer: "جواب ثانٍ." },
  ],
};

vi.mock("@workspace/api-client-react", async (orig) => {
  const actual = await orig<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetProduct: () => ({
      data: PRODUCT_ANY,
      isLoading: false,
      isError: false,
      error: null,
    }),
    useListProducts: () => ({ data: [PRODUCT_ANY], isLoading: false, isError: false }),
    useGetFlashSale: () => ({ data: { flash_sale: null } }),
    useGetCatalogStats: () => ({
      data: { available_products: 3, total_units: 9, lowest_price: 15, total_products: 3 },
    }),
    useGetProductRecommendations: () => ({ data: [], isLoading: false, isError: false }),
    getProduct: vi.fn(async () => PRODUCT_ANY),
    // Path 2 (slug URL — the canonical form) rides customFetch directly
    // (R116-S2): mock it too or the page shows the connection-error state.
    customFetch: vi.fn(async () => PRODUCT_ANY),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: null, user: null, loading: false }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: vi.fn() }),
}));

// F-2: controllable keyboard-visibility verdicts.
let keyboardVisible = false;
vi.mock("@/hooks/use-keyboard-visibility", () => ({
  useKeyboardVisibility: () => keyboardVisible,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  window.history.pushState({}, "", `/product/${PRODUCT.slug}`);
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        Router,
        null,
        createElement(Route, { path: "/product/:slug", component: ProductPage }),
      ),
    ),
  );
}

async function renderReady() {
  const rendered = renderPage();
  await waitFor(
    () => {
      expect(rendered.container.textContent).toContain("R117 منتج غني");
    },
    { timeout: 3000 },
  );
  return rendered;
}

beforeEach(() => {
  keyboardVisible = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("product page — mobile buy-panel gutters (R117 F-1)", () => {
  it("the END-column blocks carry a 20px mobile side gutter class", async () => {
    const { container } = await renderReady();
    // order-5 (variant selector wrapper) — plain wrapper → px-5
    const order5 = container.querySelector('[class*="order-5"]');
    expect(order5).toBeTruthy();
    expect(order5!.className).toContain("max-lg:px-5");
    // order-6 (price + stock) — tinted box → mx-5 (gutter OUTSIDE the border)
    const order6 = container.querySelector('[class*="order-6"]');
    expect(order6).toBeTruthy();
    expect(order6!.className).toContain("max-lg:mx-5");
    // order-9 (trust grid) — plain container → px-5
    const order9 = container.querySelector('[class*="order-9"]');
    expect(order9).toBeTruthy();
    expect(order9!.className).toContain("max-lg:px-5");
  });
});

describe("product page — FAQ DOM order matches visual order (R117 F-3)", () => {
  it("FAQ sits in DOM after the trust grid (and before the mobile coupon slot)", async () => {
    const { container } = await renderReady();
    const html = container.innerHTML;
    const faqPos = html.indexOf("الأسئلة الشائعة");
    const trustPos = html.indexOf("تسليم فوري"); // first TRUST_SIGNALS label
    expect(trustPos).toBeGreaterThan(-1);
    expect(faqPos).toBeGreaterThan(-1);
    // DOM order: trust (order-9) BEFORE FAQ (order-10)…
    expect(faqPos).toBeGreaterThan(trustPos);
    // …and FAQ before the CTA block (order-12) so <lg Tab order reads
    // straight down the visual stack.
    const cta = container.querySelector('[class*="order-12"]');
    expect(cta).toBeTruthy();
    const ctaPos = html.indexOf(cta!.outerHTML.split(">")[0]);
    expect(faqPos).toBeLessThan(ctaPos);
    // The FAQ block itself keeps order-10 (its <lg visual slot).
    const faqDetails = Array.from(container.querySelectorAll("details")).find((d) =>
      d.textContent?.includes("الأسئلة الشائعة"),
    );
    expect(faqDetails?.className).toContain("order-10");
  });
});

describe("product page — sticky buy bar keyboard wiring (R117 F-2)", () => {
  it("hides the sticky bar while the virtual keyboard is open", async () => {
    keyboardVisible = true;
    const { container } = await renderReady();
    const bar = container.querySelector('[class*="mobile-sticky-bottom-safe"], [class*="z-[45]"]');
    expect(bar).toBeTruthy();
    expect(bar!.className).toContain("hidden");
  });

  it("shows the sticky bar (with the short-viewport CSS fallback) when no keyboard", async () => {
    keyboardVisible = false;
    const { container } = await renderReady();
    const bar = Array.from(container.querySelectorAll("div")).find(
      (d) => d.className.includes("z-[45]") && d.className.includes("sm:hidden"),
    );
    expect(bar).toBeTruthy();
    // NOT hidden via the keyboard branch…
    expect(bar!.className).not.toMatch(/(^| )hidden( |$)/);
    // …but the [@media(max-height:480px)] fallback IS present.
    expect(bar!.className).toContain("[@media(max-height:480px)]:hidden");
  });
});
