/**
 * R146 (audit-frontend-pages F4) — per-route document.title for the eight
 * storefront account routes, the admin-document-title.test.tsx idiom
 * (R125 A6 B-1) applied to the buyer side.
 *
 * None of wallet / orders / order-detail / loyalty / referrals / profile /
 * login / register set a title: the App fallback's generic «SubNation —
 * سوق الاشتراكات الرقمية» owned the head on all of them, so RouteAnnouncer
 * (which announces only title CHANGES and deliberately skips same-title
 * navigations) gave a screen-reader user NO cue across the whole account
 * surface (WCAG 2.4.2 + 4.1.3), and multi-tab sighted users couldn't tell
 * wallet from orders by tab.
 *
 * Each page now mounts a useSeo block (notifications.tsx's shape — title
 * + path + robots: "noindex,follow"). These tests pin, for every route:
 *   1. mounting the page stamps its natural Arabic title (consistent
 *      with the page's own header copy) into document.title;
 *   2. the robots directive the App fallback already stamped arrives
 *      from the page block itself (the belt-and-braces contract).
 *
 * Harness: the per-page suites' union — the generated client is mocked at
 * the module boundary (wallet/order-detail orval hooks per
 * wallet-return-affordance-r143, useGetOrder per order-refund-receipt),
 * its customFetch delegates to a URL router (referrals-page.test.tsx's
 * idiom) for the orders/loyalty/referrals/profile riders, and the heavy
 * auth children are stubbed per login-account-intent-r128.
 */

import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import WalletPage from "@/pages/wallet";
import OrdersPage from "@/pages/orders";
import OrderDetailPage from "@/pages/order-detail";
import LoyaltyPage from "@/pages/loyalty";
import ReferralsPage from "@/pages/referrals";
import ProfilePage from "@/pages/profile";

vi.mock("@workspace/api-client-react", () => ({
  // wallet's orval hooks (wallet-return-affordance-r143.test.tsx's factory)
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListTopupsQueryKey: () => ["/api/wallet/topups"],
  getGetWalletLedgerQueryKey: () => ["/api/wallet/ledger"],
  getGetMeQueryKey: () => ["/api/auth/me"],
  useGetMe: vi.fn(() => ({
    data: {
      id: 7,
      phone: "0912345678",
      display_name: "سالم",
      wallet_balance: 145,
      loyalty_points: 80,
      loyalty_tier: "silver",
      referral_code: "SNXYZ99",
      linked_identities: [],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useGetWallet: vi.fn(() => ({
    data: { balance: 150, loyalty_points: 0, loyalty_tier: "bronze" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useListTopups: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useGetWalletLedger: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useCreateTopup: vi.fn(() => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() })),
  // order-detail's orval hook (order-refund-receipt.test.tsx's factory)
  useGetOrder: vi.fn(() => ({
    data: {
      id: 93,
      order_code: "SNDB93OK",
      product_id: 3,
      product_name: "Netflix شهر",
      product_image_url: null,
      variant_id: null,
      status: "completed",
      amount: 160,
      created_at: "2026-10-01T12:00:00.000Z",
      delivered_email: "buyer@example.com",
      delivered_password: "hunter2",
      delivered_extra_details: null,
      delivered_usage_terms: null,
      discount_amount: 0,
      coupon_code: null,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
  getGetOrderQueryKey: (code: string) => [`/api/orders/${code}`],
  // loyalty's convert mutation (import-time export, click-time rider)
  convertPoints: vi.fn(),
  // the customFetch riders (orders/loyalty/referrals/profile) — the
  // URL-router idiom (referrals-page.test.tsx): parsed JSON per endpoint.
  customFetch: vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/orders")) return []; // the paged plain array
    if (url === "/api/loyalty/ledger") return [];
    if (url === "/api/loyalty/referrals") return [];
    if (url === "/api/loyalty")
      return {
        points: 500,
        tier: "silver",
        lifetime_spend: 1200,
        referral_code: "SNABC12",
        referral_link: "",
        referrals_total: 3,
        referrals_credited: 2,
        referrals_pending: 1,
        points_value_lyd: "5.00",
        next_tier: { tier: "gold", label: "ذهبي", remaining: 800 },
        tier_thresholds: { silver: 500, gold: 2000, platinum: 5000 },
        points_rate: { points_per_referral: 50, points_per_lyd: 100 },
      };
    if (url === "/api/auth/providers/linked") return { providers: [] };
    throw new Error(`unexpected url: ${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token", logout: vi.fn() }),
}));

// vi.hoisted: use-socket imports the bare `toast` at module scope, so the
// mock factory must own the spy before any importer evaluates (the
// order-refund-receipt.test.tsx idiom).
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock }),
  toast: toastMock,
}));

vi.mock("@/hooks/useConfirm", () => ({
  useConfirm: () => ({
    confirm: vi.fn(async () => false),
    ConfirmDialog: () => null,
  }),
}));

vi.mock("@/components/SessionManager", () => ({ SessionManager: () => null }));
vi.mock("@/components/auth/AuthProviders", () => ({ AuthProviders: () => null }));
vi.mock("@/components/auth/AuthErrorBanner", () => ({ AuthErrorBanner: () => null }));
vi.mock("@/components/auth/WhatsAppPhoneSignIn", () => ({ WhatsAppPhoneSignIn: () => null }));
vi.mock("@/components/layout/Logo", () => ({ Logo: () => null }));
vi.mock("@/hooks/usePublicAuthProviders", () => ({
  usePublicAuthProviders: () => ({ whatsappEnabled: false, whatsappStatus: "disabled" }),
}));

function renderAt(path: string, ui: React.ReactElement) {
  window.history.pushState({}, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>{ui}</Router>
    </QueryClientProvider>,
  );
}

function metaRobots(): string | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null;
}

describe("R146-F4 — the eight storefront account routes stamp their document.title", () => {
  beforeEach(() => {
    toastMock.mockClear();
  });

  it.each([
    ["/login", <LoginPage />, "تسجيل الدخول — SubNation"],
    ["/register", <RegisterPage />, "إنشاء حساب جديد — SubNation"],
    ["/wallet", <WalletPage />, "المحفظة — SubNation"],
    ["/orders", <OrdersPage />, "طلباتي — SubNation"],
    ["/orders/SNDB93OK", <OrderDetailPage />, "تفاصيل الطلب — SubNation"],
    ["/loyalty", <LoyaltyPage />, "الولاء والإحالة — SubNation"],
    ["/referrals", <ReferralsPage />, "برنامج الإحالة — SubNation"],
    ["/profile", <ProfilePage />, "حسابي — SubNation"],
  ])(
    "%s sets its page title (and the noindex directive from the page block)",
    async (path, ui, title) => {
      renderAt(path, ui);

      expect(document.title).toBe(title);
      // The page-level block carries the directive itself (the fallback's
      // noindex now rides the page block — the belt-and-braces contract).
      expect(metaRobots()).toBe("noindex,follow");
      // Flush the account pages' post-mount async probes (profile's
      // linked-providers effect) inside act — no stray state updates.
      await act(async () => {});
    },
  );
});
