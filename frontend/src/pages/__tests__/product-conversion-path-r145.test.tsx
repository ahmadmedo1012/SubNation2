import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import ProductPage from "@/pages/product";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * R145 (145-C, PDP lane) — the conversion-path recomposition pins
 * (defect map D3 P0 + D9 P2, live-site VLM audit).
 *
 *   D3 — the usage-terms block used to sit BETWEEN the price and the
 *        buy CTA as a warning-tinted wall of dense Arabic text (on the
 *        audited products ~300px tall — it pushed the desktop CTA
 *        below the first viewport). It now closes the buy panel BELOW
 *        the CTA area as a quiet native-<details> disclosure: resting
 *        border-border/20 hairline + text-muted-foreground, NO warning
 *        tint at rest, full operator text preserved inside (the honesty
 *        contract is reposition/de-emphasize, never delete). Pinned
 *        here: DOM position (after the order-12 CTA wrapper — mobile
 *        Tab order keeps matching the visual order), the collapsed
 *        default, the quiet rest register, and the preserved content.
 *
 *   D9 — the reading column (description + description_long) rides
 *        text-base (16px) — the primary reading content on the
 *        mobile-majority surface (11px micro-type floor untouched);
 *        the breadcrumb row steps up from text-muted-foreground to
 *        text-foreground/70 while the current crumb keeps
 *        text-foreground + font-bold (current > parents hierarchy).
 *
 *   D3 mobile half — the sticky buy bar was audited and verified
 *        ALREADY compliant (solid bg-card + border-t + hairline-glow +
 *        the solid default-variant buy CTA since r138); its byte-exact
 *        chrome stays pinned by money-path-chrome-r139 /
 *        product-cta-mobile-r126 (not re-pinned here — one owner per
 *        contract). This file pins the recomposition the round added.
 */

const PRODUCT = {
  id: 42,
  slug: "r145-terms-product",
  name: "R145 منتج بشروط",
  description: "وصف قصير للقراءة",
  description_long: "وصف طويل للمنتج بمحتوى SEO",
  features: ["ميزة أولى"],
  category: "streaming",
  price: 25,
  price_from: true,
  sale_price: 20,
  image_url: null,
  is_active: true,
  is_available: true,
  stock_count: 8,
  discount_percent: 20,
  usage_terms: "شروط الاستخدام: جهاز واحد فقط، بدون مشاركة بيانات الدخول مع أي شخص آخر.",
  order_count: 25,
  faq: [{ question: "سؤال أول؟", answer: "جواب أول." }],
  variants: [
    {
      id: 1,
      plan_label: null,
      duration_label: "شهر واحد",
      label: "شهر واحد",
      price: 25,
      sale_price: 20,
      discount_percent: 20,
      is_available: true,
    },
    {
      id: 2,
      plan_label: null,
      duration_label: "3 أشهر",
      label: "3 أشهر",
      price: 100,
      sale_price: 80,
      discount_percent: 20,
      is_available: true,
    },
  ],
};

vi.mock("@workspace/api-client-react", async (orig) => {
  const actual = await orig<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetProduct: () => ({
      data: PRODUCT,
      isLoading: false,
      isError: false,
      error: null,
    }),
    useListProducts: () => ({ data: [PRODUCT], isLoading: false, isError: false }),
    useGetFlashSale: () => ({ data: { flash_sale: null } }),
    useGetCatalogStats: () => ({
      data: { available_products: 3, total_units: 9, lowest_price: 15, total_products: 3 },
    }),
    useGetProductRecommendations: () => ({ data: [], isLoading: false, isError: false }),
    getProduct: vi.fn(async () => PRODUCT),
    customFetch: vi.fn(async () => PRODUCT),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: null, user: null, loading: false }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: vi.fn() }),
}));

vi.mock("@/hooks/use-keyboard-visibility", () => ({
  useKeyboardVisibility: () => false,
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
      expect(rendered.container.textContent).toContain("R145 منتج بشروط");
    },
    { timeout: 3000 },
  );
  return rendered;
}

beforeEach(() => {
  window.history.pushState({}, "", `/product/${PRODUCT.slug}`);
});

afterEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, "", "/");
});

describe("R145 (D3) — the usage-terms disclosure sits BELOW the CTA area, quiet at rest", () => {
  it("the terms <details> renders after the order-12 CTA wrapper in DOM (Tab order = visual order)", async () => {
    const { container } = await renderReady();
    const html = container.innerHTML;

    const cta = container.querySelector('[class*="order-12"]');
    expect(cta).toBeTruthy();
    const ctaPos = html.indexOf(cta!.outerHTML.split(">")[0]);
    expect(ctaPos).toBeGreaterThan(-1);

    const terms = container.querySelector('details[class*="order-13"]');
    expect(terms).toBeTruthy();
    const termsPos = html.indexOf(terms!.outerHTML.split(">")[0]);
    expect(termsPos).toBeGreaterThan(-1);

    // R145 (D3): the old order put the warning wall between price
    // (order-6) and the CTA; the recomposition has it close the panel.
    expect(termsPos).toBeGreaterThan(ctaPos);
    // …and still after the FAQ (order-10) — the R117 F-3 DOM-order
    // contract chain stays monotonic: FAQ → CTA → terms.
    const faqDetails = Array.from(container.querySelectorAll("details")).find((d) =>
      d.textContent?.includes("الأسئلة الشائعة"),
    );
    expect(faqDetails?.className).toContain("order-10");
    expect(html.indexOf(faqDetails!.outerHTML.split(">")[0])).toBeLessThan(termsPos);
  });

  it("collapses by default and rests quiet: hairline border + muted ink, NO warning tint at rest", async () => {
    const { container } = await renderReady();
    const terms = container.querySelector('details[class*="order-13"]') as HTMLElement;
    expect(terms).toBeTruthy();

    // Collapsed disclosure (no `open` attribute) — the pre-purchase
    // terms are one tap away, not a standing wall.
    expect(terms).not.toHaveAttribute("open");
    // The summary names the section with the operator-facing label.
    expect(terms.querySelector("summary")?.textContent).toContain("شروط الاستخدام");

    // Quiet rest register (the R145 de-emphasis): /20 hairline edge +
    // muted ink on the shell. The warning vocabulary is GONE at rest.
    expect(terms.className).toContain("border-border/20");
    expect(terms.className).not.toContain("status-warning");
    const summary = terms.querySelector("summary") as HTMLElement;
    expect(summary.className).toContain("text-muted-foreground");
    expect(summary.className).not.toContain("status-warning");
  });

  it("the honesty contract holds: the FULL operator terms text stays in the DOM", async () => {
    const { container } = await renderReady();
    // The complete usage_terms string renders inside the disclosure
    // (collapsed <details> keeps its content in the DOM for shoppers
    // AND crawlers — repositioned, never deleted).
    expect(container.textContent).toContain(
      "شروط الاستخدام: جهاز واحد فقط، بدون مشاركة بيانات الدخول مع أي شخص آخر.",
    );
    // The body div keeps the quiet reading register.
    const body = container.querySelector('details[class*="order-13"] > div') as HTMLElement;
    expect(body?.className).toContain("text-muted-foreground");
    expect(body?.className).toContain("border-t border-border/20");
  });
});

describe("R145 (D9) — the reading column + breadcrumb contrast step", () => {
  it("description + description_long ride text-base (16px reading column; 11px floor untouched)", async () => {
    const { container } = await renderReady();

    const short = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("وصف قصير للقراءة"),
    );
    expect(short).toBeTruthy();
    expect(short!.className).toContain("text-base");
    expect(short!.className).not.toContain("text-sm");

    const long = Array.from(container.querySelectorAll("div")).find(
      (d) => d.textContent === "وصف طويل للمنتج بمحتوى SEO",
    );
    expect(long).toBeTruthy();
    expect(long!.className).toContain("text-base");
  });

  it("the breadcrumb row steps up to text-foreground/70; the current crumb stays foreground+bold", async () => {
    const { container } = await renderReady();

    const nav = container.querySelector('nav[aria-label="مسار التنقّل"]') as HTMLElement;
    expect(nav).toBeTruthy();
    // R145 (D9): one step up from text-muted-foreground — the parent
    // segments were the audit's "too light" crumbs.
    expect(nav.className).toContain("text-foreground/70");
    expect(nav.className).not.toContain("text-muted-foreground");

    // The current crumb keeps the stronger register — hierarchy
    // (current > parents) survives the row's step up.
    const current = nav.querySelector('span[aria-current="page"]') as HTMLElement;
    expect(current).toBeTruthy();
    expect(current.className).toContain("text-foreground");
    expect(current.className).toContain("font-bold");
  });
});

describe("R145 (D3) — source pins: the panel order chain + the sticky bar's verified stance", () => {
  const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
  const panel = read("src/components/product/BuyPanelColumn.tsx");

  it("BuyPanelColumn: no order-7 terms block remains between price and CTA; order-13 closes the column", () => {
    // The retired mid-panel slot is gone…
    expect(panel).not.toContain("order-7");
    // …the disclosure owns the LAST flex slot after the CTA wrapper.
    expect(panel).toContain("order-12");
    expect(panel).toContain("order-13");
    // …and the warning-tinted resting classes are retired from the
    // panel source (severity lives in the alert/confirm families).
    expect(panel).not.toContain("bg-status-warning/8");
    expect(panel).not.toContain("status-warning");
  });

  it("product.tsx: the sticky buy bar chrome stays byte-identical (the R145 VERIFIED decision)", () => {
    // The audited-and-already-compliant bar (r138 chrome): this pin is
    // the R145 lane's OWN freeze so the round's "no change needed"
    // verdict cannot silently regress while the PDP is being edited
    // around it. money-path-chrome-r139 owns the fuller contract.
    const page = read("src/pages/product.tsx");
    expect(page).toContain(
      "sm:hidden z-[45] bg-card border-t border-border/35 px-4 pt-3 shadow-[0_-1px_2px_rgb(0_0_0/0.3),0_-10px_28px_-14px_rgb(0_0_0/0.4)]",
    );
    // The solid default-variant buy CTA (never outline/ghost on the
    // primary money path) is pinned by money-path-chrome-r139's
    // four-branch ladder — not duplicated here.
  });
});
