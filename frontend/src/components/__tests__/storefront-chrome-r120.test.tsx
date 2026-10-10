/**
 * R120-B1 regressions — storefront chrome (MobileNav / Navbar drawer /
 * Footer band / button-in-Link elimination).
 *
 *   • A3-F1: MobileNav renders for GUESTS with safe tabs (it used to
 *     return null — guests' only navigation was the hamburger drawer),
 *     and the guest drawer in Navbar now carries the 7 categories +
 *     العروض + support with a body scroll-lock while open.
 *   • A1-F8/A3-F5: the authed tab set swaps الولاء for السلة with the
 *     live cart count badge (9+ cap, cart idiom).
 *   • A4-F1: no `<a><button>` interactive nesting anywhere in the
 *     rendered Navbar or the home guest hero (one CTA = one tab stop).
 *   • A1-F13/A7-F10: the Footer carries a compact category + support
 *     link band above the legal row (internal-linking SEO).
 *
 * Module mocks follow navbar-mobile-fit.test.tsx (Navbar) and
 * home-secondary-widgets.test.tsx (HomePage) patterns.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileNav } from "@/components/layout/MobileNav";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import HomePage from "@/pages/home";

// ── Shared mock state ────────────────────────────────────────────────────
const authState = vi.hoisted(() => ({ token: null as string | null }));
const cartState = vi.hoisted(() => ({ itemCount: 0 }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: authState.token, logout: () => {} }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ itemCount: cartState.itemCount }),
  useCartState: () => ({
    items: [],
    itemCount: cartState.itemCount,
    totalLYD: 0,
    isLoaded: true,
  }),
  // ProductCard rides the commands context (R111-F4-F1) — the home
  // grid tests render real cards, so the mock must cover it too.
  useCartCommands: () => ({ addItem: vi.fn() }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: () => {} }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetMeQueryKey: () => ["me"],
  useGetMe: () => ({ data: undefined, isError: false }),
  getListOrdersQueryKey: (params: unknown) => ["/api/orders", params],
  useListOrders: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  getGetCatalogStatsQueryKey: () => ["catalog-stats"],
  useGetCatalogStats: () => ({ data: undefined, isPending: false, isError: false }),
  getListProductsQueryKey: (params: unknown) => ["/api/products", params],
  useListProducts: () => ({
    data: productsFixture.data,
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/layout/NotificationBell", () => ({
  NotificationBell: () => null,
}));

vi.mock("@/hooks/useSeo", () => ({
  useSeo: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

/** Mutable products fixture — home-ordering tests swap it per case. */
const productsFixture = vi.hoisted(() => ({
  data: [] as Array<Record<string, unknown>>,
}));

beforeEach(() => {
  authState.token = null;
  cartState.itemCount = 0;
  productsFixture.data = [];
  window.history.pushState({}, "", "/");
});

// ── MobileNav ────────────────────────────────────────────────────────────
describe("MobileNav — guest rendering + cart tab (R120-B1 / A3-F1 + A1-F8)", () => {
  it("renders for GUESTS with the 4 safe tabs and no auth-only tabs", () => {
    render(
      <Router>
        <MobileNav />
      </Router>,
    );
    const nav = screen.getByRole("navigation");
    expect(nav).toBeInTheDocument();
    for (const label of ["الرئيسية", "الكتالوج", "السلة", "تسجيل الدخول"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
    for (const authOnly of ["المحفظة", "طلباتي", "الولاء", "حسابي"]) {
      expect(screen.queryByText(authOnly)).not.toBeInTheDocument();
    }
    // The guest grid spans 4 columns (5-tab contract is auth-only).
    const grid = nav.querySelector("div.grid") as HTMLElement;
    expect(grid.className).toContain("grid-cols-4");
  });

  it("authed: السلة replaces الولاء and carries the live count badge (9+ cap)", () => {
    authState.token = "test-token";
    cartState.itemCount = 12;
    const { container } = render(
      <Router>
        <MobileNav />
      </Router>,
    );
    expect(screen.queryByText("الولاء")).not.toBeInTheDocument();
    const cartTab = screen.getByRole("link", { name: /السلة/ });
    expect(cartTab).toHaveAttribute("href", "/cart");
    // 12 items → capped badge «9+» (Navbar cart/bell idiom).
    expect(container.textContent).toContain("9+");
    const grid = screen.getByRole("navigation").querySelector("div.grid") as HTMLElement;
    expect(grid.className).toContain("grid-cols-5");
  });

  it("guest cart tab announces the count via its accessible name (cart idiom)", () => {
    cartState.itemCount = 2;
    render(
      <Router>
        <MobileNav />
      </Router>,
    );
    // formatCount idiom: «السلة، 2 منتجان» (Navbar cart link parity).
    expect(screen.getByRole("link", { name: "السلة، 2 منتجان" })).toBeInTheDocument();
  });

  it("stays hidden on the auth pages (everyone) — and RENDERS for guests on product pages (R120-B7)", () => {
    window.history.pushState({}, "", "/login");
    const { unmount } = render(
      <Router>
        <MobileNav />
      </Router>,
    );
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    unmount();

    // R120-B7 (reviewer finding): the former guest /product/* guard is
    // gone — the guest sticky buy bar now pins ABOVE the nav via the
    // shared mobile-sticky-above-nav clearance, so the guest nav renders
    // on product detail like everywhere else (no thumb-zone exception).
    window.history.pushState({}, "", "/product/netflix-1m");
    render(
      <Router>
        <MobileNav />
      </Router>,
    );
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /السلة/ })).toBeInTheDocument();
  });
});

// ── Navbar guest drawer ──────────────────────────────────────────────────
describe("Navbar — guest drawer: categories + scroll-lock + a11y (R120-B1 / A3-F1 + A4-F5)", () => {
  it("the hamburger discloses the drawer (aria-expanded/aria-controls) with category + support links", () => {
    render(
      <Router>
        <Navbar />
      </Router>,
    );
    const burger = screen.getByRole("button", { name: "القائمة" });
    expect(burger).toHaveAttribute("aria-expanded", "false");
    expect(burger).toHaveAttribute("aria-controls", "guest-menu");

    fireEvent.click(burger);
    expect(burger).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("guest-menu")).toBeInTheDocument();
    // Category shortcuts (7) + flash-sales + support + auth rows.
    expect(screen.getByRole("link", { name: "بث مباشر" })).toHaveAttribute(
      "href",
      "/category/streaming",
    );
    expect(screen.getByRole("link", { name: "أدوات SEO" })).toHaveAttribute(
      "href",
      "/category/seo-tools",
    );
    expect(screen.getByRole("link", { name: "العروض" })).toHaveAttribute("href", "/flash-sales");
    expect(screen.getByRole("link", { name: "الدعم الفني" })).toHaveAttribute("href", "/support");
    expect(screen.getByRole("link", { name: "تسجيل الدخول" })).toHaveAttribute("href", "/login");
  });

  it("body scroll locks while the drawer is open and restores on close", () => {
    render(
      <Router>
        <Navbar />
      </Router>,
    );
    const burger = screen.getByRole("button", { name: "القائمة" });
    fireEvent.click(burger);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(burger);
    expect(document.body.style.overflow).toBe("");
  });
});

// ── Button-in-Link elimination (A4-F1) ───────────────────────────────────
describe("no <a><button> interactive nesting in the storefront shell (R120-B1 / A4-F1)", () => {
  it("Navbar (guest): zero button descendants inside links", () => {
    const { container } = render(
      <Router>
        <Navbar />
      </Router>,
    );
    expect(container.querySelectorAll("a button")).toHaveLength(0);
  });

  it("home guest hero: zero button descendants inside links (CTAs are styled Links)", () => {
    productsFixture.data = [];
    const { container } = render(
      <Router>
        <HomePage />
      </Router>,
    );
    expect(container.querySelectorAll("a button")).toHaveLength(0);
    // The hero CTAs are links with the button look — one tab stop each.
    expect(screen.getByRole("link", { name: "إنشاء حساب مجاني" })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(screen.getByRole("link", { name: /لدي حساب — تسجيل الدخول/ })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});

// ── Home grid ordering + h1 prose (A3-F3 + A7-F12) ───────────────────────
describe("home — available products lead the default grid; sold-out cards navigate (R120-B1)", () => {
  const SOLD_OUT = {
    id: 1,
    slug: "netflix-1m",
    name: "Netflix شهر",
    description: null,
    image_url: null,
    price: 75,
    category: "streaming",
    is_available: false,
    stock_count: 0,
  };
  const AVAILABLE = {
    id: 2,
    slug: "chatgpt-plus",
    name: "ChatGPT Plus شهر",
    description: null,
    image_url: null,
    price: 120,
    category: "ai-tools",
    is_available: true,
    stock_count: 7,
  };

  it("default view: the available card leads, the sold-out card follows AND still navigates", () => {
    productsFixture.data = [SOLD_OUT, AVAILABLE];
    const { container } = render(
      <Router>
        <HomePage />
      </Router>,
    );
    const productLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href^="/product/"]'),
    );
    expect(productLinks.length).toBe(2);
    expect(productLinks[0].getAttribute("href")).toBe("/product/chatgpt-plus");
    expect(productLinks[1].getAttribute("href")).toBe("/product/netflix-1m");
    // The sold-out card is a live link (no aria-disabled) — not a dead tap.
    expect(productLinks[1].hasAttribute("aria-disabled")).toBe(false);
  });

  it("an explicit user sort wins over the availability re-order", async () => {
    // ?sort=popular is a user-expressed ordering intent — the sold-out
    // first position (server order) must survive.
    window.history.replaceState({}, "", "/?sort=popular");
    productsFixture.data = [SOLD_OUT, AVAILABLE];
    const { container } = render(
      <Router>
        <HomePage />
      </Router>,
    );
    const productLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href^="/product/"]'),
    );
    expect(productLinks[0].getAttribute("href")).toBe("/product/netflix-1m");
  });

  it("the h1 reads as one contiguous phrase with a real space (A7-F12)", () => {
    productsFixture.data = [];
    render(
      <Router>
        <HomePage />
      </Router>,
    );
    const h1 = document.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toContain("الرقمية في ليبيا");
    expect(h1!.textContent).not.toContain("الرقميةفي");
  });
});

// ── Footer band (A1-F13 + A7-F10) ────────────────────────────────────────
describe("Footer — compact category + support band above the legal row (R120-B1)", () => {
  it("links the 7 live categories, العروض, and the support cluster", () => {
    render(
      <Router>
        <Footer />
      </Router>,
    );
    const band = screen.getByRole("navigation", { name: "الفئات" });
    expect(band.querySelector('a[href="/category/streaming"]')).toBeInTheDocument();
    expect(band.querySelector('a[href="/category/education"]')).toBeInTheDocument();
    expect(band.querySelectorAll("a").length).toBe(8); // 7 categories + العروض
    const support = screen.getByRole("navigation", { name: "المساعدة والدعم" });
    expect(support.querySelector('a[href="/support"]')).toBeInTheDocument();
    expect(support.querySelector('a[href="/terms"]')).toBeInTheDocument();
    expect(support.querySelector('a[href="/status"]')).toBeInTheDocument();
  });

  it("keeps the legal row last (band sits above it)", () => {
    render(
      <Router>
        <Footer />
      </Router>,
    );
    const footer = document.querySelector("footer") as HTMLElement;
    const privacy = screen.getByText("سياسة الخصوصية");
    const categories = screen.getByRole("navigation", { name: "الفئات" });
    // DOCUMENT_POSITION_FOLLOWING: the legal row renders AFTER the band.
    expect(
      categories.compareDocumentPosition(privacy as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(footer.className).toContain("mobile-nav-footer-pad");
  });
});

// ── A11y tails (R128-IMP-4 / A13-F4 + F9 — B1 item 9) ────────────────────
describe("storefront chrome a11y tails — cart badge live regions + footer heading level (R128-IMP-4)", () => {
  it("Navbar: the cart badge sits in a polite live region (count changes announce; A13-F4)", () => {
    cartState.itemCount = 3;
    render(
      <Router>
        <Navbar />
      </Router>,
    );
    // The Link's accessible name carries the count (pre-existing idiom)…
    const cartLink = screen.getByRole("link", { name: "السلة، 3 منتجات" });
    expect(cartLink).toHaveAttribute("href", "/cart");
    // …but name changes are never ANNOUNCED — the stable icon wrapper
    // (the badge's parent) is the polite live region so N→M count
    // changes reach SR users without re-navigating the header. It must
    // NOT be the badge span itself: a key-remounted badge (MobileNav's
    // num-pop idiom) mounts a fresh live region per change, which
    // announces nothing.
    const liveRegion = cartLink.querySelector('div[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.textContent).toBe("3");
    expect(liveRegion!.querySelector("span")).not.toHaveAttribute("aria-live");
  });

  it("MobileNav: the cart tab's badge sits in a polite live region (A13-F4)", () => {
    authState.token = "test-token";
    cartState.itemCount = 2;
    render(
      <Router>
        <MobileNav />
      </Router>,
    );
    const cartTab = screen.getByRole("link", { name: "السلة، 2 منتجان" });
    // The STABLE icon wrapper carries the live region (the badge span
    // itself is key-remounted per count change for the num-pop
    // animation — a fresh live region announces nothing).
    const liveRegion = cartTab.querySelector('span[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.textContent).toBe("2");
  });

  it("Footer: column titles are h2 — no 1→3 heading skip on short pages (A13-F9)", () => {
    render(
      <Router>
        <Footer />
      </Router>,
    );
    // On /flash-sales and /cart the footer is the only content after the
    // page h1, so its column titles used to produce an h1 → h3 skip.
    // They are h2 now, and no h3 may come back.
    const cats = screen.getByRole("navigation", { name: "الفئات" });
    expect(cats.querySelector("h2")?.textContent).toBe("الفئات");
    const support = screen.getByRole("navigation", { name: "المساعدة والدعم" });
    expect(support.querySelector("h2")?.textContent).toBe("المساعدة والدعم");
    expect(document.querySelector("footer h3")).toBeNull();
  });
});
