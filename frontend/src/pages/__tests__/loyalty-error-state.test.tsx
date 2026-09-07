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
  points_rate: { points_per_referral: 50, points_per_lyd: 100 },
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

const fetchMock = vi.fn();

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

describe("LoyaltyPage — load failures are distinct from empty data (B4 P1-3)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the error card (not a blank page) when /api/loyalty is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

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
    fetchMock.mockResolvedValueOnce(resLike({ ok: false, status: 500, body: { error: "internal" } }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل بيانات الولاء")).toBeInTheDocument();
    });
    expect(screen.queryByText("نقاطي")).not.toBeInTheDocument();
  });

  it("retry button re-fetches and recovers once the API responds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(resLike({ body: loyaltyPayload }));

    renderPage();

    const retry = await screen.findByRole("button", { name: "إعادة المحاولة" });
    fireEvent.click(retry);

    expect(await screen.findByText("نقاطي")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a persistent inline alert when points conversion fails (B4 P1-7)", async () => {
    fetchMock.mockResolvedValueOnce(resLike({ body: loyaltyPayload }));

    renderPage();

    // Wait for the conversion form (points >= 100 renders it).
    const input = await screen.findByPlaceholderText(/عدد النقاط/);
    fireEvent.change(input, { target: { value: "500" } });

    // The convert POST fails with a backend error envelope.
    fetchMock.mockResolvedValueOnce(
      resLike({ ok: false, status: 400, body: { error: "رصيد النقاط غير كافٍ" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "تحويل" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("رصيد النقاط غير كافٍ");
    // Persistent: still rendered after the toast's 4-second lifetime.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
