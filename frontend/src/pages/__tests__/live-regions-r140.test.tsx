/**
 * R140-k — live-region contracts for money-adjacent async state.
 *
 * THE SILENCE MAP this suite freezes (before → after):
 *
 *   CART BADGE (Navbar) — the count's live announcement was the badge
 *   wrapper's BARE NUMBER (contextless "3", capped "9+", silent on the
 *   1→0 removal — the R128-IMP-4 comment itself documented those holes
 *   and delegated to the toasts). The toasts cover add/remove only at
 *   their call sites; THREE paths changed the count with zero
 *   announcement anywhere: the undo toast's «تراجع» re-add (no toast of
 *   its own), a cross-tab `storage` re-sync (another tab's mutation),
 *   and a checkout completed in a second tab. AFTER: a dedicated
 *   sr-only polite region (the RouteAnnouncer idiom, app/routes.tsx
 *   F3-07) announces every post-load DELTA with the toast-family
 *   Arabic verbatim («أُضيف إلى السلة» / «تمت إزالة المنتج») + the
 *   formatCount total; the badge span is aria-hidden visual chrome so
 *   the bare number no longer double-announces; the count keeps its
 *   link accessible name («السلة، N منتجات») for focus/navigation.
 *
 *   BALANCE (BalanceCard) / POINTS (StatsRow) — the totals were plain
 *   text swaps. The mutation toasts announce the DELTA (topup-approved
 *   «X د.ل أُضيفت إلى رصيدك», convert «تم التحويل» + the server's
 *   «تم تحويل N نقطة إلى X د.ل») via sonner's polite live region —
 *   verified below against the installed dist — but the NEW TOTAL was
 *   silent until re-navigation. AFTER: sr-only polite regions announce
 *   the total on every post-mount change (mount-silent by
 *   construction: the region + its first value appear together, and
 *   live regions never announce mount-time content), through the SAME
 *   formatters as the visible numbers (formatCurrency / formatCount —
 *   no digit fabrication).
 *
 *   THE RULE (c) — polite (role="status" / aria-live="polite") for
 *   state updates; assertive (role="alert") ONLY for errors the user
 *   must act on. The money-error contract (inline + persistent) is
 *   already owned by ConvertPointsCard's role="alert" banner +
 *   FetchErrorCard (the shared outage idiom) — pinned here as the ONLY
 *   assertive surfaces in this lane; every region this round ADDS is
 *   polite, and no new assertive region exists anywhere in the four
 *   touched files.
 *
 * Module mocks follow storefront-chrome-r120.test.tsx (Navbar) with the
 * importOriginal spread so the REAL cartChangeAnnouncement flows
 * through the mocked module — the render pins exercise the exact
 * production strings end-to-end.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Navbar } from "@/components/layout/Navbar";
import { BalanceCard } from "@/components/wallet/BalanceCard";
import { StatsRow } from "@/components/loyalty/StatsRow";
import { cartChangeAnnouncement } from "@/lib/cart";
import type { LoyaltyData } from "@/components/loyalty/loyalty-meta";
import type { WalletInfo } from "@workspace/api-client-react";

// ── Shared mock state (storefront-chrome-r120 idiom) ──────────────────────
const authState = vi.hoisted(() => ({ token: null as string | null }));
const cartState = vi.hoisted(() => ({ itemCount: 0, isLoaded: false }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: authState.token, logout: () => {} }),
}));

// importOriginal spread: useCart is overridden (mutable itemCount +
// isLoaded to drive the announcer's load gate), everything else —
// cartChangeAnnouncement included — stays the REAL module so the
// rendered strings are the production strings.
vi.mock("@/lib/cart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cart")>();
  return {
    ...actual,
    useCart: () => ({ itemCount: cartState.itemCount, isLoaded: cartState.isLoaded }),
  };
});

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: () => {} }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetMeQueryKey: () => ["me"],
  useGetMe: () => ({ data: undefined, isError: false }),
}));

vi.mock("@/components/layout/NotificationBell", () => ({
  NotificationBell: () => null,
}));

beforeEach(() => {
  authState.token = null;
  cartState.itemCount = 0;
  cartState.isLoaded = false;
  window.history.pushState({}, "", "/");
});

// ── Source-scan fixtures (the r139/r140 LINE-COMMENTS-FIRST craft) ────────
/** LINE-COMMENTS-FIRST stripper: full-line `//` notes die BEFORE block
 *  comments, so a `//` note quoting a `/*` glob can never open a
 *  phantom block — only live markup is the contract. */
function stripComments(src: string): string {
  return src.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Comment-stripped + whitespace-normalized source. */
function live(src: string): string {
  return stripComments(src).replace(/\s+/g, " ");
}

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

const navbarSrc = live(read("src/components/layout/Navbar.tsx"));
const cartSrc = live(read("src/lib/cart.tsx"));
const balanceSrc = live(read("src/components/wallet/BalanceCard.tsx"));
const statsSrc = live(read("src/components/loyalty/StatsRow.tsx"));
const convertSrc = live(read("src/components/loyalty/ConvertPointsCard.tsx"));
const loyaltyPageSrc = live(read("src/pages/loyalty.tsx"));
const sonnerWrapperSrc = read("src/components/ui/sonner.tsx");
const sonnerDist = read("node_modules/sonner/dist/index.js");

// ── (a) cartChangeAnnouncement — the exact Arabic contracts ────────────────
describe("R140-k (a) — cartChangeAnnouncement: the toast-family Arabic verbatim + formatCount totals", () => {
  it("no transition, no announcement (null)", () => {
    expect(cartChangeAnnouncement(3, 3)).toBeNull();
    expect(cartChangeAnnouncement(0, 0)).toBeNull();
  });

  it("adds announce «أُضيف إلى السلة» with the formatCount total (one/two/few/many)", () => {
    // The R128-documented hole: the 0→1 badge mount never announced.
    expect(cartChangeAnnouncement(0, 1)).toBe("أُضيف إلى السلة — 1 منتج");
    expect(cartChangeAnnouncement(1, 2)).toBe("أُضيف إلى السلة — 2 منتجان");
    expect(cartChangeAnnouncement(2, 3)).toBe("أُضيف إلى السلة — 3 منتجات");
    expect(cartChangeAnnouncement(11, 12)).toBe("أُضيف إلى السلة — 12 منتجاً");
  });

  it("removals announce «تمت إزالة المنتج» with the remaining total, and the drain lands on «السلة فارغة»", () => {
    // The other R128 hole: the 1→0 badge unmount (removals are never
    // announced by live regions) — and the cart page's clear flow rides
    // «تم إفراغ السلة» while checkout's clear() says nothing cart-side.
    expect(cartChangeAnnouncement(5, 3)).toBe("تمت إزالة المنتج — 3 منتجات");
    expect(cartChangeAnnouncement(2, 1)).toBe("تمت إزالة المنتج — 1 منتج");
    expect(cartChangeAnnouncement(2, 0)).toBe("تمت إزالة المنتج — السلة فارغة");
  });

  it("digits ride the shared Latin-digit grouping (the en-US money/count register — no Arabic-Indic fabrication)", () => {
    // 1200 → CLDR "other" («منتج») with the 1,200 grouping.
    expect(cartChangeAnnouncement(1199, 1200)).toBe("أُضيف إلى السلة — 1,200 منتج");
  });
});

// ── (a) Navbar — the announcer region + the badge layering ─────────────────
describe("R140-k (a) — Navbar: the sr-only cart-change announcer", () => {
  function announcer(container: HTMLElement): HTMLElement {
    const region = container.querySelector('div[role="status"][aria-live="polite"].sr-only');
    expect(region).not.toBeNull();
    return region as HTMLElement;
  }

  it("the region exists — polite, role=status, sr-only (the RouteAnnouncer idiom) — and starts silent", () => {
    cartState.itemCount = 0;
    cartState.isLoaded = true;
    const { container } = render(
      <Router>
        <Navbar />
      </Router>,
    );
    expect(announcer(container).textContent).toBe("");
  });

  it("a load is not a change: the isLoaded gate keeps the persisted cart silent on first observation", () => {
    cartState.itemCount = 3;
    cartState.isLoaded = false;
    const { container, rerender } = render(
      <Router>
        <Navbar />
      </Router>,
    );
    // The provider's mount-time localStorage read resolves in one commit:
    // isLoaded flips with the hydrated count — nothing may announce.
    cartState.itemCount = 7;
    cartState.isLoaded = true;
    rerender(
      <Router>
        <Navbar />
      </Router>,
    );
    expect(announcer(container).textContent).toBe("");
  });

  it("an add announces «أُضيف إلى السلة — N …» (covers the undo re-add + cross-tab sync the toasts never reach)", async () => {
    cartState.itemCount = 2;
    cartState.isLoaded = true;
    const { container, rerender } = render(
      <Router>
        <Navbar />
      </Router>,
    );
    cartState.itemCount = 5;
    rerender(
      <Router>
        <Navbar />
      </Router>,
    );
    await waitFor(() =>
      expect(announcer(container).textContent).toBe("أُضيف إلى السلة — 5 منتجات"),
    );
    // The link's accessible name still carries the same count (the
    // navigation/focus exposure — same plural words as the announcer).
    expect(screen.getByRole("link", { name: "السلة، 5 منتجات" })).toBeInTheDocument();
  });

  it("a removal announces «تمت إزالة المنتج — …», and the drain to empty lands on «السلة فارغة»", async () => {
    cartState.itemCount = 2;
    cartState.isLoaded = true;
    const { container, rerender } = render(
      <Router>
        <Navbar />
      </Router>,
    );
    cartState.itemCount = 0;
    rerender(
      <Router>
        <Navbar />
      </Router>,
    );
    await waitFor(() =>
      expect(announcer(container).textContent).toBe("تمت إزالة المنتج — السلة فارغة"),
    );
  });

  it("the badge span is aria-hidden visual chrome and the R128-IMP-4 wrapper contract survives (no double announce)", () => {
    cartState.itemCount = 3;
    cartState.isLoaded = true;
    const { container } = render(
      <Router>
        <Navbar />
      </Router>,
    );
    const cartLink = screen.getByRole("link", { name: "السلة، 3 منتجات" });
    // The stable icon wrapper remains the R128-pinned polite region whose
    // textContent is the badge number (storefront-chrome-r120 parity)…
    const badgeWrapper = cartLink.querySelector('div[aria-live="polite"]');
    expect(badgeWrapper).not.toBeNull();
    expect(badgeWrapper!.textContent).toBe("3");
    // …but the badge span itself is hidden from AT — its bare, capped
    // ("9+") number no longer double-announces against the announcer.
    const badgeSpan = badgeWrapper!.querySelector("span");
    expect(badgeSpan).toHaveAttribute("aria-hidden", "true");
    // The announcer is the ONLY sr-only region in the Navbar.
    expect(container.querySelectorAll(".sr-only")).toHaveLength(1);
  });
});

// ── (b) BalanceCard — the new-total announcer ──────────────────────────────
describe("R140-k (b) — BalanceCard: the balance total is announced on change", () => {
  const walletFixture = (balance: number) =>
    ({ balance, loyalty_tier: "bronze", loyalty_points: 10 }) as unknown as WalletInfo;

  const renderCard = (wallet: WalletInfo | undefined, loading: boolean, error = false) =>
    render(
      <BalanceCard
        wallet={wallet}
        loading={loading}
        error={error}
        onRetry={() => {}}
        glowRef={{ current: null }}
        glowStyle={{ animationPlayState: "running" }}
      />,
    );

  it("loading and error branches carry NO balance announcer (outage ≠ empty; FetchErrorCard owns the error surface)", () => {
    const { container: loadingContainer } = renderCard(undefined, true);
    expect(loadingContainer.querySelector('div[aria-live="polite"].sr-only')).toBeNull();
    const { container: errorContainer } = renderCard(undefined, false, true);
    expect(errorContainer.querySelector('div[aria-live="polite"].sr-only')).toBeNull();
    // The error branch's assertive surface is the shared FetchErrorCard
    // (role="alert") — the money-error contract, not a new region.
    expect(errorContainer.querySelector('div[role="alert"]')).not.toBeNull();
  });

  it("the wallet branch carries a polite sr-only region with the SAME formatCurrency total as the visible number", () => {
    const { container } = renderCard(walletFixture(25), false);
    const region = container.querySelector('div[role="status"][aria-live="polite"].sr-only');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe("الرصيد المتاح الآن 25.00 د.ل");
    // The visible hero renders the identical formatted amount.
    expect(screen.getByText("25.00 د.ل")).toBeInTheDocument();
  });

  it("a post-mount balance change rewrites the announcement (the mutation landed — audibly)", () => {
    const { container, rerender } = renderCard(walletFixture(25), false);
    rerender(
      <BalanceCard
        wallet={walletFixture(40)}
        loading={false}
        error={false}
        onRetry={() => {}}
        glowRef={{ current: null }}
        glowStyle={{ animationPlayState: "running" }}
      />,
    );
    const region = container.querySelector('div[role="status"][aria-live="polite"].sr-only');
    expect(region!.textContent).toBe("الرصيد المتاح الآن 40.00 د.ل");
  });
});

// ── (b) StatsRow — the loyalty points total ────────────────────────────────
describe("R140-k (b) — StatsRow: the points total is announced on change", () => {
  const loyaltyFixture = (points: number): LoyaltyData => ({
    points,
    tier: "bronze",
    lifetime_spend: 0,
    referral_code: "SN-TEST",
    referral_link: "https://subnation.ly/r/SN-TEST",
    referrals_total: 0,
    referrals_credited: 0,
    referrals_pending: 0,
    points_value_lyd: "7.50",
    next_tier: null,
    points_rate: { points_per_referral: 50, points_per_lyd: 100 },
  });

  it("the points tile carries a polite sr-only region with the formatCount total (same Latin digits as the visible tile)", () => {
    const { container } = render(<StatsRow data={loyaltyFixture(750)} tierProgressPercent={0} />);
    const region = container.querySelector('div[role="status"][aria-live="polite"].sr-only');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe("نقاطي الآن 750 نقطة");
    expect(screen.getByText("750")).toBeInTheDocument();
  });

  it("a post-conversion points drop rewrites the announcement", () => {
    const { container, rerender } = render(
      <StatsRow data={loyaltyFixture(750)} tierProgressPercent={0} />,
    );
    rerender(<StatsRow data={loyaltyFixture(250)} tierProgressPercent={0} />);
    const region = container.querySelector('div[role="status"][aria-live="polite"].sr-only');
    expect(region!.textContent).toBe("نقاطي الآن 250 نقطة");
  });
});

// ── (b) sonner — the toast fleet's live-region verification ────────────────
describe("R140-k (b) — sonner toasts ARE announced (the installed dist, verified)", () => {
  it("the Toaster container is a polite live region announcing added toast text (title + description)", () => {
    // sonner 2.0.7 dist: the <section> that wraps every toast renders
    // aria-live="polite" + aria-relevant="additions text" — every money
    // toast («تم اعتماد طلب الشحن» + «X د.ل أُضيفت إلى رصيدك», «تم
    // التحويل», «تمت إزالة المنتج», checkout's «تم إتمام الطلب») is a
    // polite announcement. If a sonner upgrade ever drops this, the pin
    // trips and the announcement inventory must be consciously redone.
    expect(sonnerDist).toContain('"aria-live": "polite"');
    expect(sonnerDist).toContain('"aria-relevant": "additions text"');
  });

  it("our wrapper labels the region + close buttons in Arabic (the R124-A5 language contract, read-only)", () => {
    expect(sonnerWrapperSrc).toContain('containerAriaLabel="الإشعارات"');
    expect(sonnerWrapperSrc).toContain('closeButtonAriaLabel: "إغلاق"');
  });
});

// ── (c) THE RULE — the polite/assertive split, source-scanned ──────────────
describe("R140-k (c) — polite for state, assertive ONLY for actionable errors", () => {
  it("every region this round adds is polite: Navbar + BalanceCard + StatsRow carry NO assertive literal", () => {
    for (const [name, src] of [
      ["Navbar.tsx", navbarSrc],
      ["BalanceCard.tsx", balanceSrc],
      ["StatsRow.tsx", statsSrc],
    ] as const) {
      expect(src, name).not.toContain('role="alert"');
      expect(src, name).not.toContain('aria-live="assertive"');
    }
  });

  it("Navbar wires the announcer through cartChangeAnnouncement with the isLoaded load-gate", () => {
    expect(navbarSrc).toContain("cartChangeAnnouncement(prevCartCountRef.current, itemCount)");
    expect(navbarSrc).toContain("if (!isLoaded) return;");
    expect(navbarSrc).toMatch(/const \[cartAnnouncement, setCartAnnouncement\] = useState\(""\)/);
  });

  it("lib/cart.tsx owns the announcement builder + the shared plural table (the cart-domain idiom, beside lineStockNotice)", () => {
    expect(cartSrc).toContain("export function cartChangeAnnouncement(");
    expect(cartSrc).toContain("export const CART_COUNT_FORMS");
    // The exact Arabic strings, verbatim from the toast family.
    expect(cartSrc).toContain("أُضيف إلى السلة — ");
    expect(cartSrc).toContain("تمت إزالة المنتج — ");
    expect(cartSrc).toContain("السلة فارغة");
    // (d): the totals ride the shared formatters — no digit fabrication.
    expect(cartSrc).toContain("formatCount(nextCount, CART_COUNT_FORMS)");
  });

  it("BalanceCard announces the total through formatCurrency (the visible number's own formatter)", () => {
    expect(balanceSrc).toContain("الرصيد المتاح الآن ${formatCurrency(wallet.balance ?? 0)}");
  });

  it("StatsRow announces the points total through formatCount (the wallet family's plural table)", () => {
    expect(statsSrc).toContain("نقاطي الآن ${formatCount(data.points, POINTS_COUNT_FORMS)}");
    expect(statsSrc).toContain("const POINTS_COUNT_FORMS = {");
  });

  it("ConvertPointsCard's ONLY assertive surface is the persistent convertError banner (the money-error contract: inline + assertive once)", () => {
    // role="alert" appears exactly once in the file — on the
    // persistent failure banner (cleared only when a new attempt
    // starts). Mounting announces the summary text assertively ONCE,
    // pointing AT the inline error — exactly rule (c).
    expect(convertSrc.match(/role="alert"/g)).toHaveLength(1);
    expect(convertSrc).not.toContain('aria-live="assertive"');
  });

  it("the loyalty convert flow's toasts document the delta announcements (success + destructive failure — polite via sonner)", () => {
    expect(loyaltyPageSrc).toContain('toast({ title: "تم التحويل", description: result.message })');
    expect(loyaltyPageSrc).toContain(
      'toast({ title: "خطأ", description: message, variant: "destructive" })',
    );
    // …and the inline + persistent banner stays the owner of the error
    // (the toast is the echo, not the record).
    expect(loyaltyPageSrc).toContain("setConvertError(message)");
  });
});

// ── (a) read-only verification — the referral page (140-e's fresh clean) ───
describe("R140-k — referrals.tsx verification (read-only, report-only)", () => {
  const referralsSrc = live(read("src/pages/referrals.tsx"));

  it("carries no hand-rolled live region and no assertive surface beyond the shared FetchErrorCard", () => {
    // Verified clean by 140-e: the full-load error surface IS the
    // shared FetchErrorCard; a background-refresh failure with stale
    // data on screen is NOT an error screen. The page's money datum
    // (points earned) refreshes silently behind the notification-new →
    // bell toast path — flagged for the orchestrator, not edited here
    // (this page is read-only in this lane).
    expect(referralsSrc).not.toContain('role="alert"');
    expect(referralsSrc).not.toContain('aria-live="assertive"');
  });
});
