/**
 * R187 (H-F2) — the admin session-guard fetch is bounded at 10 s.
 *
 * app/routes.tsx's AdminProtectedRoutes queryFn raw-fetched
 * /api/admin/session with ONLY TanStack's unmount signal: a black-holed
 * TCP left sessionQuery.isPending forever, and with retry:false + no
 * error card the whole admin console sat on the route skeleton
 * indefinitely. Every sibling session-validity probe is bounded
 * (auth.tsx's boot probes 10 s since R116 A5-2, adminFetch/customFetch
 * 20 s) — this was the last unbounded one on the admin path.
 *
 * Pinned here (the custom-fetch-network.test.ts harness idioms — the
 * controllable AbortSignal.timeout/any statics + a hanging fetch):
 *   1. a never-resolving guard fetch rejects WITHIN 10 s and the guard
 *      FALLS THROUGH TO RENDERING CHILDREN (the documented
 *      transient-failure posture — same as a 5xx: the locally-valid
 *      session stays, the admin pages surface their own errors);
 *   2. a healthy 200 renders children with no timer advance at all
 *      (the merged signal changes nothing on the fast path).
 *
 * The page registry is stubbed at the module boundary (the heavy lazy
 * pages are irrelevant to the guard's own state machine); the guard
 * component itself is the REAL one (exported for this pin — the
 * R129-B1 ProductsAliasRedirect precedent).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminProtectedRoutes } from "@/app/routes";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    setAdminToken: vi.fn(),
  }),
}));

vi.mock("@/app/page-registry", () => {
  // Every page name app/routes.tsx imports becomes a one-line stub —
  // the guard's state machine is the unit under test, not the pages.
  const stub = (testId: string) => () => <div data-testid={testId} />;
  return {
    HomePage: stub("page-home"),
    AuthCallbackPage: stub("page-auth-callback"),
    TelegramCallbackPage: stub("page-telegram-callback"),
    LoginPage: stub("page-login"),
    LoyaltyPage: stub("page-loyalty"),
    OnboardingPage: stub("page-onboarding"),
    OrderDetailPage: stub("page-order-detail"),
    OrdersPage: stub("page-orders"),
    ProductPage: stub("page-product"),
    CategoryPage: stub("page-category"),
    ProfilePage: stub("page-profile"),
    ReferralsPage: stub("page-referrals"),
    NotificationsPage: stub("page-notifications"),
    RegisterPage: stub("page-register"),
    SupportPage: stub("page-support"),
    TermsPage: stub("page-terms"),
    WalletPage: stub("page-wallet"),
    CartPage: stub("page-cart"),
    CheckoutPage: stub("page-checkout"),
    FlashSalesPage: stub("page-flash-sales"),
    AdminLoginPage: stub("page-admin-login"),
    AdminDashboardPage: stub("page-admin-dashboard"),
    AdminTopupsPage: stub("page-admin-topups"),
    AdminOrdersPage: stub("page-admin-orders"),
    AdminProductsPage: stub("page-admin-products"),
    AdminPricingPage: stub("page-admin-pricing"),
    AdminUsersPage: stub("page-admin-users"),
    AdminSettingsPage: stub("page-admin-settings"),
    AdminSecurityPage: stub("page-admin-security"),
    AdminTicketsPage: stub("page-admin-tickets"),
    AdminReferralsPage: stub("page-admin-referrals"),
    AdminCouponsPage: stub("page-admin-coupons"),
    AdminPromotionsPage: stub("page-admin-promotions"),
    AdminAlertsPage: stub("page-admin-alerts"),
    AdminSystemPage: stub("page-admin-system"),
    AdminAdminsPage: stub("page-admin-admins"),
    AdminRiskPage: stub("page-admin-risk"),
    AdminRiskEventPage: stub("page-admin-risk-event"),
    AdminEnrichmentPage: stub("page-admin-enrichment"),
    AdminWhatsAppPage: stub("page-admin-whatsapp"),
    StatusPage: stub("page-status"),
  };
});

// ── Fake AbortSignal statics (custom-fetch-network.test.ts idiom) ───────────

type Statics = {
  timeout?: (ms: number) => AbortSignal;
  any?: (signals: AbortSignal[]) => AbortSignal;
};

let savedTimeout: Statics["timeout"];
let savedAny: Statics["any"];
let timeoutCalls: number[] = [];

function timeoutController(): { signal: AbortSignal; fire: () => void } {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    fire: () =>
      controller.abort(
        typeof DOMException === "function"
          ? new DOMException("signal timed out", "TimeoutError")
          : Object.assign(new Error("signal timed out"), { name: "TimeoutError" }),
      ),
  };
}

function installTimeoutStub() {
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    writable: true,
    value: (ms: number) => {
      timeoutCalls.push(ms);
      const { signal, fire } = timeoutController();
      setTimeout(fire, ms);
      return signal;
    },
  });
}

/** A real merge: aborts when ANY input aborts (first reason wins). */
function installAnyStub() {
  Object.defineProperty(AbortSignal, "any", {
    configurable: true,
    writable: true,
    value: (signals: AbortSignal[]) => {
      const controller = new AbortController();
      for (const signal of signals) {
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      }
      return controller.signal;
    },
  });
}

function restoreAbortStatics() {
  for (const [key, saved] of [
    ["timeout", savedTimeout],
    ["any", savedAny],
  ] as const) {
    if (saved !== undefined) {
      Object.defineProperty(AbortSignal, key, {
        configurable: true,
        writable: true,
        value: saved,
      });
    } else {
      delete (AbortSignal as Statics)[key];
    }
  }
}

/** A fetch that never resolves until its request signal aborts. */
function hangingSignalAwareFetch() {
  return vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // hangs forever (the pre-R187 shape)
        signal.addEventListener(
          "abort",
          () => {
            reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true },
        );
      }),
  );
}

function renderGuard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminProtectedRoutes />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminProtectedRoutes — the 10 s session-guard budget (R187 H-F2)", () => {
  beforeEach(() => {
    savedTimeout = (AbortSignal as Statics).timeout;
    savedAny = (AbortSignal as Statics).any;
    timeoutCalls = [];
    installTimeoutStub();
    installAnyStub();
    vi.useFakeTimers();
    window.history.pushState(null, "", "/admin");
    // The transient-failure posture intentionally warns (a real network
    // ceiling hit is worth DevTools visibility) — silence it in jsdom.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreAbortStatics();
    window.history.pushState(null, "", "/");
  });

  it("a never-resolving guard fetch rejects within 10 s and the guard falls through to the admin children", async () => {
    const fetchMock = hangingSignalAwareFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderGuard();

    // While the guard fetch is in flight: the admin route skeleton,
    // NOT the page children.
    expect(screen.queryByTestId("page-admin-dashboard")).not.toBeInTheDocument();

    // The budget is 10 s — still pending at 9.999 s (the old unbounded
    // fetch NEVER settles; this advance is a no-op on the pre-fix
    // shape).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(screen.queryByTestId("page-admin-dashboard")).not.toBeInTheDocument();

    // …then the ceiling fires: the query rejects (TimeoutError) and the
    // guard renders the children — the documented transient-failure
    // posture (identical to the 5xx branch: keep the locally-valid
    // session, let the admin pages surface their own API failures).
    // The drain runs one millisecond at a time: the rejection →
    // query-error dispatch → observer notify → re-render chain rides a
    // faked setTimeout(0) per hop (testing-library's waitFor polls on
    // faked timers and never fires — the whatsapp-suite file header's
    // own lesson).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    for (let i = 0; i < 10 && !screen.queryByTestId("page-admin-dashboard"); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
    }
    expect(screen.getByTestId("page-admin-dashboard")).toBeInTheDocument();
    expect(timeoutCalls).toContain(10_000);

    // Belt: the abort was OUR timeout, not the caller's — the component
    // is still mounted and the unmount signal never aborted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a healthy 200 renders the admin children with no timer advance (fast path unchanged)", async () => {
    vi.useRealTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ valid: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderGuard();

    expect(await screen.findByTestId("page-admin-dashboard")).toBeInTheDocument();
  });
});
