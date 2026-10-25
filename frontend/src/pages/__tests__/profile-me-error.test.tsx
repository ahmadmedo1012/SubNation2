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
 *   3. R135 (FE-4): the linked-providers rows keep their camelCase wire
 *      shape (provider/providerUid/…) — the contract LinkedProviderRow
 *      now types; a "fix" toward the orval LinkedIdentity's snake_case
 *      (provider_uid — the /auth/me linked_identities shape, a different
 *      surface) would break the row render + unlink payload here.
 *
 * `@workspace/api-client-react`, `@/lib/auth` and the heavy session/auth
 * children are mocked at the module boundary; the raw
 * /api/auth/providers/linked probe is stubbed at the global fetch.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  // R144-C1 (L16-3): profile.tsx now imports customFetch too — the
  // factory must cover it (vitest throws on missing mock exports) and
  // honor the WRAPPER contract (parse the body, throw on non-2xx), so
  // the component's `data.providers` read sees the parsed payload.
  customFetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await globalThis.fetch(input, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test token", logout: vi.fn() }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useConfirm", () => ({
  useConfirm: () => ({
    confirm: vi.fn(async () => false),
    ConfirmDialog: () => null,
  }),
}));

vi.mock("@/components/SessionManager", () => ({ SessionManager: () => null }));
// R187 (B-F5 pin): a REAL button, not a null stub — the link-more gate's
// absence is only observable if the mocked AuthProviders actually renders
// an affordance (queryByRole(/Google/) against a null mock passes
// vacuously, on BOTH sides of the gate).
vi.mock("@/components/auth/AuthProviders", () => ({
  AuthProviders: () => <button type="button">Google</button>,
}));

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
  // R144-C1 (L16-3): real Response objects — profile.tsx rides
  // customFetch, which reads .text()/.headers; the minimal ok/json-only
  // stub predated the wrapper.
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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

  it("the healthy path still renders the identity card (sanity)", async () => {
    vi.mocked(useGetMe).mockReturnValue({
      data: ME_FIXTURE,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as MeResult);

    renderPage();

    // R118-B2 (A5 W-4): settle the mount-time /auth/providers/linked probe
    // (stubbed at the global fetch below) before asserting. The probe
    // resolves AFTER a synchronous test body returns, and its post-await
    // state updates (setLinkedProviders + setLoadingProviders(false))
    // were the source of this suite's 2 act() warnings — updates landed
    // outside any act scope. Draining the promise chain inside act
    // absorbs them; NO assertions changed.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("سالم")).toBeInTheDocument();
    expect(screen.getByText("SNXYZ99")).toBeInTheDocument();
    // The error card must not leak into the healthy render.
    expect(screen.queryByText("تعذّر تحميل بيانات حسابك")).not.toBeInTheDocument();
  });

  it("R135 (FE-4): linked provider rows render off the camelCase wire shape (typing regression for LinkedProviderRow)", async () => {
    vi.mocked(useGetMe).mockReturnValue({
      data: ME_FIXTURE,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as MeResult);

    // The /api/auth/providers/linked response — the drizzle camelCase row
    // the backend serializes verbatim (routes/auth.ts:202-216). The row
    // render reads provider/providerUid/email; the unlink aria-label +
    // payload ride the same pair.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        resLike({
          providers: [
            {
              provider: "google.com",
              providerUid: "g-uid-135",
              firebaseUid: null,
              email: "user@gmail.com",
              phone: null,
              emailVerified: true,
              phoneVerified: false,
              linkedAt: "2026-10-01T00:00:00.000Z",
            },
          ],
        }),
      ),
    );

    renderPage();
    // R144-C1 (L16-3): the linked-providers fetch rides customFetch —
    // one more async hop (fetch → .text() → parse) than the old raw
    // .json(), so the settle uses waitFor instead of the fixed
    // microtask count.
    await waitFor(() => expect(screen.getByText("Google")).toBeInTheDocument());
    expect(screen.getByText("user@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "فصل Google" })).toBeInTheDocument();
    // The advice card is correctly absent — one provider IS linked.
    expect(screen.queryByText("حماية حسابك")).not.toBeInTheDocument();
  });

  it("B-F10 (R186): the providers-error retry button rides the 44px touch floor (className pin)", async () => {
    vi.mocked(useGetMe).mockReturnValue({
      data: ME_FIXTURE,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as MeResult);

    // /auth/me is healthy; the linked-providers probe FAILS — the in-card
    // error row (its OWN retry, not the me-error FetchErrorCard's) renders.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "internal" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    renderPage();

    expect(await screen.findByText("تعذّر تحميل الحسابات المرتبطة")).toBeInTheDocument();
    // The row's ONLY recovery affordance sits on the app-wide 44px floor
    // (the status-page className-pin style) — it measured ~28px before.
    const retry = screen.getByRole("button", { name: "إعادة المحاولة" });
    expect(retry.className).toContain("min-h-11");
    expect(retry.className).toContain("inline-flex");
  });

  it("R187 (B-F5): a failed providers probe renders NO link-your-account affordance (false-empty evidence)", async () => {
    vi.mocked(useGetMe).mockReturnValue({
      data: ME_FIXTURE,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as MeResult);

    // The probe 500s — the provider list is UNKNOWN, not empty. The
    // link-more block must not render the Google affordance (the
    // R94-A1 #8 advice-card gate this sibling missed): a user whose
    // google.com identity EXISTS would be told to link it again.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "internal" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    renderPage();

    // The in-card error row renders (the honest state for a failed probe)…
    expect(await screen.findByText("تعذّر تحميل الحسابات المرتبطة")).toBeInTheDocument();
    // …while the link-more affordance does NOT (the mocked AuthProviders
    // renders a real Google button — see the module mock note above).
    expect(screen.queryByRole("button", { name: /Google/ })).toBeNull();
  });
});
