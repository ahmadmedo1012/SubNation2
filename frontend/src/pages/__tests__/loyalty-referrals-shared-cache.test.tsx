/**
 * R120-B5 (A5-F4/F5/F6) — ONE cache identity for GET /api/loyalty.
 *
 * Before R120, loyalty.tsx and referrals.tsx kept TWO independent copies
 * of the same endpoint's data: loyalty a raw-fetch + useState local copy,
 * referrals a react-query entry keyed ["loyalty-overview", token]. The
 * twin caches drifted exactly where it hurts — a points conversion on
 * /loyalty refreshed only the page it ran on, so /referrals kept showing
 * the pre-convert balance for up to the 60 s staleTime.
 *
 * Both pages now subscribe to the SAME token-less ["loyalty","overview"]
 * entry (loyalty.tsx's LOYALTY_OVERVIEW_QUERY_KEY). These tests pin:
 *
 *   1. SHARED IDENTITY: both pages mounted together under one
 *      QueryClient issue exactly ONE request to /api/loyalty — two
 *      observers, one cache entry, zero duplicate traffic. If either
 *      page drifts its key tuple, two entries mount and this fails.
 *   2. CROSS-PAGE FRESHNESS: after loyalty's convert mutation succeeds,
 *      the shared entry is invalidated — a referrals observer mounted on
 *      the same client re-renders with the deducted balance WITHOUT a
 *      page reload (the ≤60 s staleness bug).
 *
 * Harness: loyalty's queryFn is raw global fetch (stubbed per-test with a
 * URL router); referrals' is customFetch — mocked at the module boundary
 * to DELEGATE to the same stubbed fetch so both pages share one network
 * counter (their production fetchers differ, the endpoint does not).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoyaltyPage from "@/pages/loyalty";
import ReferralsPage from "@/pages/referrals";

// Referrals consumes customFetch; loyalty consumes raw global fetch.
// One router behind both so the shared-entry assertion counts network
// identity, not transport mechanism.
const convertCalls: Array<{ points: number }> = [];
const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === "/api/loyalty/ledger") return resLike({ body: state.ledger });
  if (url === "/api/loyalty/referrals") return resLike({ body: [] });
  if (url === "/api/loyalty/convert-points") {
    convertCalls.push(JSON.parse(String(init?.body ?? "{}")) as { points: number });
    return resLike({ body: { message: "تم تحويل النقاط بنجاح" } });
  }
  if (url === "/api/loyalty") return resLike({ body: loyaltyPayload(state.points) });
  return resLike({ ok: false, status: 404, body: { error: `unexpected url: ${url}` } });
});

vi.mock("@workspace/api-client-react", () => ({
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  customFetch: (input: string | URL, init?: RequestInit) => fetchMock(input, init),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test token" }),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const state = { points: 500, ledger: [] as unknown[] };

function loyaltyPayload(points: number) {
  return {
    points,
    tier: "silver",
    lifetime_spend: 1200,
    referral_code: "SNABC12",
    referral_link: "",
    referrals_total: 3,
    referrals_credited: 2,
    referrals_pending: 1,
    points_value_lyd: (points / 100).toFixed(2),
    next_tier: { tier: "gold", label: "ذهبي", remaining: 800 },
    points_rate: { points_per_referral: 50, points_per_lyd: 100 },
  };
}

/** Minimal Response-like object (the loyalty harness shape). */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function callsTo(url: string): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]) === url).length;
}

function renderBoth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        {/* Both pages mounted at once: two observers on ONE endpoint. */}
        <LoyaltyPage />
        <ReferralsPage />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockClear();
  convertCalls.length = 0;
  toastMock.mockClear();
  state.points = 500;
  state.ledger = [];
  localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loyalty ↔ referrals — ONE shared cache identity for /api/loyalty (R120-B5, A5-F4/F5)", () => {
  it("both pages mounted together fetch /api/loyalty exactly once (two observers, one entry)", async () => {
    renderBoth();

    // Both pages render their live data off the shared entry…
    expect(await screen.findByText("نقاطي")).toBeInTheDocument(); // loyalty
    expect(await screen.findByText("إجمالي الإحالات")).toBeInTheDocument(); // referrals
    expect(screen.getAllByText("SNABC12").length).toBeGreaterThan(0); // both show the code

    // …and the endpoint was hit exactly ONCE for the pair of observers.
    // A drifted key tuple (token re-added, different family) would mount
    // a second entry and fire a second request.
    await waitFor(() => {
      expect(callsTo("/api/loyalty")).toBe(1);
    });
    expect(callsTo("/api/loyalty/ledger")).toBe(1); // loyalty's history twin
    expect(callsTo("/api/loyalty/referrals")).toBe(1); // referrals' events twin
  });

  it("a points conversion on /loyalty refreshes the referrals observer's balance (no ≤60s staleness)", async () => {
    renderBoth();

    // Pre-convert: referrals' points-rate banner renders (overview live).
    await screen.findByText("إجمالي الإحالات");

    // Convert 300 points on the loyalty page → server drops to 200.
    state.points = 200;
    const input = await screen.findByPlaceholderText(/عدد النقاط/);
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "تحويل" }));

    await waitFor(() => expect(convertCalls).toHaveLength(1));

    // The shared entry was invalidated and refetched — the referrals
    // observer re-renders the overview-derived banner rate and, on the
    // loyalty side, the deducted 200-point tile. Both pages now read
    // the post-convert truth without any reload.
    expect(await screen.findByText("200")).toBeInTheDocument();
    await waitFor(() => {
      expect(callsTo("/api/loyalty")).toBeGreaterThanOrEqual(2);
    });
  });
});
