/**
 * Error-state tests for the loyalty page (B4 P1-3 + P1-7).
 *
 * The page previously fetched /api/loyalty with no `res.ok` check and no
 * error branch: an outage rendered a blank page under the header, and a
 * 5xx error envelope crashed the render at `data.points.toLocaleString()`
 * (ErrorBoundary). These tests lock in:
 *
 *   1. Network failure ⇒ distinct error card with a retry button.
 *   2. 5xx error envelope ⇒ same error card (no crash, no blank page).
 *   3. Retry re-fetches and recovers when the API comes back.
 *   4. Points-conversion failure ⇒ a persistent inline `role="alert"`
 *      banner on the money card (the old toast expired after 4s).
 *
 * R115 (A8 P2): the page now fires a SECOND mount fetch — GET
 * /api/loyalty/ledger for the points history. The old single-value mock
 * chain answered that second call with `undefined` (TypeError at
 * `.then`, every test red — see R115-I1's gate report). The stub is now
 * a URL router that serves BOTH endpoints; the ledger stays healthy by
 * default so the page-level error branches stay isolated under test.
 *
 * `@/lib/auth` is mocked (authenticated visitor), `fetch` is stubbed
 * per-test. A fresh QueryClient is created per render so cache state
 * never bleeds between tests.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoyaltyPage from "@/pages/loyalty";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const loyaltyPayload = {
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

/** Mutable per-test router state (both mount fetches read from it). */
const state = {
  /** null = healthy; "reject" = network-level failure; "500" = error envelope. */
  loyaltyFail: null as null | "reject" | "500",
  loyaltyBody: loyaltyPayload as Record<string, unknown>,
  ledger: [] as unknown[],
  ledgerOk: true,
};

/** Minimal Response-like object — avoids depending on a global Response. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** URL router: /api/loyalty (page data) × /api/loyalty/ledger (history)
 *  × /api/loyalty/convert-points (the money mutation). */
const fetchMock = vi.fn(async (input: string | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === "/api/loyalty/ledger") {
    if (!state.ledgerOk) return resLike({ ok: false, status: 500, body: { error: "boom" } });
    return resLike({ body: state.ledger });
  }
  if (url === "/api/loyalty/convert-points") {
    return resLike({ body: { message: "تم التحويل" } });
  }
  if (url === "/api/loyalty") {
    if (state.loyaltyFail === "reject") throw new TypeError("network down");
    if (state.loyaltyFail === "500")
      return resLike({ ok: false, status: 500, body: { error: "internal" } });
    return resLike({ body: state.loyaltyBody });
  }
  return resLike({ ok: false, status: 404, body: { error: "unexpected url" } });
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <LoyaltyPage />
      </Router>
    </QueryClientProvider>,
  );
}

/** Calls to the page-data endpoint only (the ledger fires in parallel). */
function loyaltyCalls(): number {
  return fetchMock.mock.calls.filter(([u]) => String(u) === "/api/loyalty").length;
}

describe("LoyaltyPage — load failures are distinct from empty data (B4 P1-3)", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    state.loyaltyFail = null;
    state.loyaltyBody = { ...loyaltyPayload };
    state.ledger = [];
    state.ledgerOk = true;
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the error card (not a blank page) when /api/loyalty is unreachable", async () => {
    state.loyaltyFail = "reject";

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل بيانات الولاء")).toBeInTheDocument();
    });
    // The stats grid must NOT render — an outage is not "no data".
    expect(screen.queryByText("نقاطي")).not.toBeInTheDocument();
  });

  it("renders the error card (no crash) when a 5xx error envelope arrives", async () => {
    // The historical bug: the {error} envelope was fed into the render
    // path and `data.points.toLocaleString()` threw into the boundary.
    state.loyaltyFail = "500";

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل بيانات الولاء")).toBeInTheDocument();
    });
    expect(screen.queryByText("نقاطي")).not.toBeInTheDocument();
  });

  it("retry button re-fetches and recovers once the API responds", async () => {
    state.loyaltyFail = "reject";

    renderPage();

    const retry = await screen.findByRole("button", { name: "إعادة المحاولة" });
    // The API comes back before the retry lands.
    state.loyaltyFail = null;
    fireEvent.click(retry);

    expect(await screen.findByText("نقاطي")).toBeInTheDocument();
    await waitFor(() => expect(loyaltyCalls()).toBeGreaterThanOrEqual(2));
  });

  it("shows a persistent inline alert when points conversion fails (B4 P1-7)", async () => {
    renderPage();

    // Wait for the conversion form (points >= 100 renders it).
    const input = await screen.findByPlaceholderText(/عدد النقاط/);
    fireEvent.change(input, { target: { value: "500" } });

    // The convert POST fails with a backend error envelope.
    fetchMock.mockImplementationOnce(async () =>
      resLike({ ok: false, status: 400, body: { error: "رصيد النقاط غير كافٍ" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "تحويل" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("رصيد النقاط غير كافٍ");
    // Persistent: still rendered after the toast's 4-second lifetime.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("the mount fetches BOTH endpoints — a broken ledger mock must not crash the page data (R115 regression guard)", async () => {
    renderPage();

    // Page data + history both resolved from the router.
    expect(await screen.findByText("نقاطي")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/loyalty/ledger")).toBe(true);
    });
    // The history's empty state is honest (ledgerOk stayed true).
    expect(await screen.findByText("لا توجد حركات نقاط بعد")).toBeInTheDocument();
  });
});
