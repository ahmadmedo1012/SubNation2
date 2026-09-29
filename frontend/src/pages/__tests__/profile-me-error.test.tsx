/**
 * R115 (A8 #4, P2) — profile identity card: /auth/me FAILURE branch.
 *
 * The card used to render as `user ? card : null`: a failed me query
 * (retry:false) silently vanished balance, points, referral code and tier
 * — the exact "money-datum silent vanish" pattern 93-C5/F-05 fixed on
 * wallet/loyalty/referrals/orders. profile.tsx was the one page missed.
 *
 * These tests pin:
 *   1. isError ⇒ a distinct error card with a retry button wired to the
 *      hook's refetch (outage ≠ empty — no silent identity vanish).
 *   2. The healthy path still renders the identity card (sanity).
 *
 * `@workspace/api-client-react`, `@/lib/auth` and the heavy session/auth
 * children are mocked at the module boundary; the raw
 * /api/auth/providers/linked probe is stubbed at the global fetch.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "@/pages/profile";
import { useGetMe } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  getGetMeQueryKey: () => ["/api/auth/me"],
  useGetMe: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test token", logout: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => ({
    confirm: vi.fn(async () => false),
    ConfirmDialog: () => null,
  }),
}));

vi.mock("@/components/SessionManager", () => ({ SessionManager: () => null }));
vi.mock("@/components/AuthProviders", () => ({ AuthProviders: () => null }));

type MeResult = ReturnType<typeof useGetMe>;

const ME_FIXTURE = {
  id: 7,
  phone: "0912345678",
  display_name: "سالم",
  wallet_balance: 145,
  loyalty_points: 80,
  loyalty_tier: "silver",
  referral_code: "SNXYZ99",
  linked_identities: [],
};

function resLike(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <ProfilePage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => resLike({ providers: [] })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfilePage — /auth/me failure no longer silently vanishes the identity card (R115 A8 #4)", () => {
  it("isError renders an error card with retry wired to the me query's refetch", async () => {
    const refetch = vi.fn();
    vi.mocked(useGetMe).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as MeResult);

    renderPage();

    expect(screen.getByText("تعذّر تحميل بيانات حسابك")).toBeInTheDocument();
    // NOT a silent vanish: some identity surface must exist, and the
    // quick links below stay (they don't depend on the me query).
    expect(screen.getByText("المحفظة")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("the healthy path still renders the identity card (sanity)", () => {
    vi.mocked(useGetMe).mockReturnValue({
      data: ME_FIXTURE,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as MeResult);

    renderPage();

    expect(screen.getByText("سالم")).toBeInTheDocument();
    expect(screen.getByText("SNXYZ99")).toBeInTheDocument();
    // The error card must not leak into the healthy render.
    expect(screen.queryByText("تعذّر تحميل بيانات حسابك")).not.toBeInTheDocument();
  });
});
