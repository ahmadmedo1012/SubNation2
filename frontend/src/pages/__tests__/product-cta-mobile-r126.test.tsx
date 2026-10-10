/**
 * R126-L6 (A9-4 + A9-5 + A13-F12) — product-page CTA contracts.
 *
 * A9-4 (P3, mobile sticky bar): the R124-F4 guest add-to-cart fix lived
 * exclusively inside the desktop `hidden sm:block` block — the compact
 * sticky bar never received onAddToCart, so the <640px majority (Libya
 * is mobile-majority) had no way to park a variant selection in the
 * cart. Pinned here: BOTH surfaces (desktop block + sticky bar) render
 * a guarded add-to-cart control, and the sticky one drives the same
 * handleAddToCart path — the LOCAL cart line (addItem), never a server
 * cart POST, and never a login redirect (the guest gate is checkout's
 * job: /login?redirect=/checkout).
 *
 * A9-5 (P3, branch precedence): the `!token` branch used to precede
 * `!product.is_available`, so a GUEST on a sold-out product saw
 * «تسجيل الدخول للشراء» beside the «نفد المخزون» chip — a purchase
 * promise the page itself denied (and post-login the CTA flipped to
 * the disabled state anyway). Pinned here: sold-out renders the honest
 * disabled state for EVERYONE (guests included), with the «بدائل»
 * recovery link.
 *
 * A13-F12 (P3, contrast): the selected variant pill's 12px-bold price
 * rode text-primary (rgb(220,24,64) = 3.76:1 on the dark card — under
 * the 4.5:1 AA floor). Pinned here: the pill's price span carries the
 * both-theme-safe --status-error ink (5.05–6.39:1; see the product.tsx
 * comment for the full math), not --primary.
 *
 * Harness: the product-price-honesty.test.tsx pattern — numeric-id URL
 * (slug: null keeps the slug-redirect effect inert), the api-client
 * mocked at the module boundary, auth/cart/toast mocked per-lane.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductPage from "@/pages/product";

const getProductMock = vi.fn();
const addItemMock = vi.fn();
const toastSpy = vi.fn();
const fetchSpy = vi.fn();

// Per-test mutable auth state (the A9-4 guest tests and the A9-4 authed
// twin share every other mock).
let authToken: string | null = null;

const VARIANT_PRODUCT = {
  id: 11,
  slug: null,
  name: "Spotify بريميوم",
  description: "اشتراك شهري",
  category: "music",
  price: 25,
  price_from: true,
  sale_price: 20,
  discount_percent: 20,
  image_url: null,
  is_active: true,
  is_available: true,
  stock_count: 9,
  usage_terms: null,
  order_count: 0,
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

const pageProduct = { current: VARIANT_PRODUCT };

vi.mock("@workspace/api-client-react", () => ({
  createOrder: vi.fn(),
  getProduct: (...args: unknown[]) => getProductMock(...(args as [])),
  getMe: vi.fn(async () => ({ id: 7, wallet_balance: 51 })),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  getGetProductQueryKey: (id: number) => [`/api/products/${id}`],
  getGetProductRecommendationsQueryKey: (id: number) => [`/api/products/${id}/recommendations`],
  useGetMe: () => ({
    // Solvent user — the authed CTA lands on the buy branch (not the
    // «تحتاج إضافة» one), which is where the compact add-to-cart lives.
    data: { id: 7, wallet_balance: 1_000_000 },
    isLoading: false,
  }),
  useGetProduct: () => ({
    data: pageProduct.current,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGetProductRecommendations: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: authToken, user: null, loading: false }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: addItemMock }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// The sticky bar's keyboard-visibility hook rides visualViewport, which
// jsdom lacks — pin the bar visible (the r117-contracts idiom).
vi.mock("@/hooks/use-keyboard-visibility", () => ({
  useKeyboardVisibility: () => false,
}));

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.pushState({}, "", `/product/${pageProduct.current.id}`);
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <Route path="/product/:slug" component={ProductPage} />
      </Router>
    </QueryClientProvider>,
  );
}

/** The compact sticky bar container (sm:hidden + z-[45] chrome). */
function stickyBar(container: HTMLElement): HTMLElement {
  const bar = Array.from(container.querySelectorAll("div")).find(
    (d) => d.className.includes("z-[45]") && d.className.includes("sm:hidden"),
  );
  expect(bar).toBeTruthy();
  return bar as HTMLElement;
}

beforeEach(() => {
  getProductMock.mockReset();
  addItemMock.mockClear();
  toastSpy.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  localStorage.clear();
  authToken = null;
  pageProduct.current = VARIANT_PRODUCT;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("A9-4 — the sticky mobile bar carries the guest add-to-cart (R126-L6)", () => {
  it("renders the guarded add-to-cart on BOTH surfaces (desktop block + sticky bar)", () => {
    const { container } = renderPage();

    // Desktop full-width secondary + sticky icon-button share the same
    // accessible name — both must exist (the pre-fix bug: exactly one,
    // inside the display:none-on-mobile container).
    const addButtons = screen.getAllByRole("button", {
      name: "أضف للسلة — سجّل الدخول عند إتمام الطلب",
    });
    expect(addButtons).toHaveLength(2);
    // …and the sticky bar is one of them (the compact surface is wired,
    // not just the desktop twin).
    expect(stickyBar(container).textContent).toContain("سجّل دخولك للشراء");
    expect(stickyBar(container).querySelector("button[aria-label]")).not.toBeNull();
  });

  it("the STICKY add-to-cart drives the local cart: variant-aware addItem, toast, NO login redirect, NO fetch", async () => {
    const { container } = renderPage();

    // Pick the pricier option (v2: base 100, sale 80) — the A9-4
    // scenario is a guest who opened the PDP to pick a VARIANT.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "3 أشهر — 80.00 د.ل" }));
    });

    const addButtons = screen.getAllByRole("button", {
      name: "أضف للسلة — سجّل الدخول عند إتمام الطلب",
    });
    // DOM order: desktop block first, sticky bar second — click the
    // STICKY one (the mobile surface under test).
    const stickyAdd = addButtons[1]!;
    expect(stickyBar(container).contains(stickyAdd)).toBe(true);

    await act(async () => {
      fireEvent.click(stickyAdd);
    });

    // The local cart line mirrors the SELECTED variant (the exact
    // handleAddToCart contract — localStorage cart, never a server POST).
    expect(addItemMock).toHaveBeenCalledTimes(1);
    expect(addItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: VARIANT_PRODUCT.id,
        variantId: 2,
        variantLabel: "3 أشهر",
        priceLYD: 100,
        salePriceLYD: 80,
      }),
    );
    // Confirmation toast (the add succeeded from the bar itself).
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "أُضيف إلى السلة" }));
    // Guest gate intact: no navigation to /login (the cart page owns
    // that funnel)…
    expect(window.location.pathname).toBe(`/product/${VARIANT_PRODUCT.id}`);
    // …and no server call of ANY kind fired by the add (cart writes are
    // local — addItem is the whole story).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the authed sticky bar carries the add-to-cart too (compact twin of the desktop secondary)", async () => {
    authToken = "test-token";
    renderPage();

    // The compact buy CTA («اشترِ» exact — the desktop one reads
    // «اشترِ الآن — …»).
    expect(screen.getByRole("button", { name: "اشترِ" })).toBeEnabled();
    // Desktop secondary + compact icon-button (distinct accessible names).
    expect(
      screen.getByRole("button", { name: "أضف للسلة — أكمل الشراء مع منتجات أخرى" }),
    ).toBeInTheDocument();
    const stickyAdd = screen.getByRole("button", { name: "أضف للسلة" });
    expect(stickyAdd).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(stickyAdd);
    });
    expect(addItemMock).toHaveBeenCalledTimes(1);
    expect(addItemMock).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 1, priceLYD: 25, salePriceLYD: 20 }),
    );
  });
});

describe("A9-5 — availability outranks auth on the CTA (R126-L6)", () => {
  it("a GUEST on a sold-out product gets the sold-out state, NOT the login CTA", async () => {
    pageProduct.current = { ...VARIANT_PRODUCT, is_available: false, stock_count: 0 };
    const { container } = renderPage();

    // No login-purchase promise anywhere (the old first-branch bug).
    expect(screen.queryByRole("button", { name: "سجّل دخولك للشراء" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تسجيل الدخول للشراء" })).not.toBeInTheDocument();
    // No add-to-cart either — the availability gate holds for guests.
    expect(screen.queryAllByRole("button", { name: /أضف للسلة/ })).toHaveLength(0);

    // Desktop: the honest disabled state.
    expect(
      screen.getByRole("button", { name: "نفد المخزون — غير متاح للشراء حالياً" }),
    ).toBeDisabled();

    // Sticky bar: strike price + «نفد المخزون» + the «بدائل» recovery.
    const bar = stickyBar(container);
    expect(bar.textContent).toContain("نفد المخزون");
    const altButton = getByTextExact(bar, "بدائل");
    expect(altButton).not.toBeNull();

    // The recovery link routes guests to the category (a better answer
    // than the login wall the old branch promised).
    await act(async () => {
      fireEvent.click(altButton!);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/category/music");
    });
  });

  it("an authed user on a sold-out product keeps the (pre-existing) sold-out state", () => {
    authToken = "test-token";
    pageProduct.current = { ...VARIANT_PRODUCT, is_available: false, stock_count: 0 };
    renderPage();

    expect(
      screen.getByRole("button", { name: "نفد المخزون — غير متاح للشراء حالياً" }),
    ).toBeDisabled();
    expect(screen.queryAllByRole("button", { name: /أضف للسلة/ })).toHaveLength(0);
  });
});

describe("A13-F12 — the selected variant pill's sale price rides the AA status ink (R126-L6)", () => {
  it("the selected pill's 12px-bold price span is text-status-error (was text-primary, 3.76:1)", () => {
    renderPage();

    // The default (cheapest) selection's pill — aria-label carries the
    // effective sale price.
    const selectedPill = screen.getByRole("button", { name: "شهر واحد — 20.00 د.ل" });
    expect(selectedPill).toHaveAttribute("aria-pressed", "true");
    const priceSpan = selectedPill.querySelector("span.text-status-error");
    expect(priceSpan).not.toBeNull();
    expect(priceSpan!.textContent).toContain("20.00 د.ل");
    // The failing token is gone from the pill's price.
    expect(selectedPill.querySelector("span.text-primary")).toBeNull();
  });
});

describe("R128-IMP-1 — RTL anchor + compact-bar craft on the PDP", () => {
  it('A2-F1: the h1 keeps dir="auto" isolation AND pins text-right (Latin names don\'t float off the RTL reading edge)', () => {
    renderPage();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAttribute("dir", "auto");
    // dir=auto resolves a pure-Latin name to ltr → text-align:start
    // computed LEFT (measured 41px void off the right reading line on
    // «Lifetime Cloud Storage»); the physical class re-anchors it.
    expect(h1.className).toContain("text-right");
  });

  it("B13 §7.1: the guest compact price stack can't grow the bar at 320px (min-w-0 + truncate)", () => {
    const { container } = renderPage();
    const bar = stickyBar(container);
    // The price stack is the flex child next to the shrink-0 CTA —
    // without min-w-0 a 4+-digit price is an unbreakable min-content
    // that pushes the bar past the viewport.
    const stack = bar.querySelector("div.flex-1.min-w-0");
    expect(stack).toBeInstanceOf(HTMLElement);
    const priceLine = stack!.firstElementChild as HTMLElement;
    expect(priceLine.className).toContain("truncate");
    expect(priceLine.className).toContain("tabular-nums");
  });

  it("A6 P4-4: the solvent compact bar reads «رصيد كافٍ» with lucide Check, not a ✓ text glyph", () => {
    authToken = "test-token";
    renderPage();

    const okLine = screen.getByText("رصيد كافٍ", { selector: "span" });
    // The icon is a real lucide <svg>, aria-hidden decorative.
    const icon = okLine.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
    // No ✓ text-glyph survives anywhere on the page.
    expect(screen.queryByText("✓", { exact: false })).not.toBeInTheDocument();
  });
});

/** Exact-text lookup scoped to a container (the bar renders «بدائل»
 * inside a button; the desktop twin's label is a longer sentence). */
function getByTextExact(container: HTMLElement, text: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) ??
    null
  );
}
