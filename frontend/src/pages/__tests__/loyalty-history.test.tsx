/**
 * R115 (A8 P2 + A12) — loyalty page: POINTS HISTORY rendering + the
 * de-hardcoded conversion gates.
 *
 * Two R115 surfaces of loyalty.tsx that were pinned NOWHERE:
 *
 *   1. POINTS HISTORY (GET /api/loyalty/ledger): rows / empty / error+retry
 *      — the points balance is finally explainable («why do I have exactly
 *      750 points?» is a list: purchase awards, referral credits,
 *      conversions out with their pinned lyd_credited, refund reversals).
 *   2. The conversion gates driven by API VALUES: min / multiples / step /
 *      max / placeholder / copy all derive from points_rate.points_per_lyd
 *      (fixture rate 50 — NOT the historical literal 100), tier rows + the
 *      progress bar derive from tier_thresholds (fixture 300/1500/4000),
 *      and the earn rate + honest «مزايا قريباً» perks copy are stated.
 *
 * Modeled on loyalty-convert-journey.test.tsx's fetch-router harness
 * (GET /api/loyalty, GET /api/loyalty/ledger, POST convert).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoyaltyPage from "@/pages/loyalty";
import { formatDate } from "@/lib/utils";

vi.mock("@workspace/api-client-react", () => ({
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const LEDGER_URL = "/api/loyalty/ledger";

interface PointsRow {
  id: number;
  type: string;
  type_label: string;
  points_delta: number;
  points_after: number;
  lyd_credited: number | null;
  created_at: string;
}

/** Mutable per-test fixtures. */
const state = {
  loyalty: {} as Record<string, unknown>,
  ledger: [] as PointsRow[],
  ledgerOk: true,
};

function loyaltyPayload(over: Record<string, unknown> = {}) {
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
    ...over,
  };
}

function ledgerRow(over: Partial<PointsRow>): PointsRow {
  return {
    id: 1,
    type: "purchase_award",
    type_label: "نقاط شراء",
    points_delta: 80,
    points_after: 80,
    lyd_credited: null,
    created_at: new Date("2026-09-29T10:00:00Z").toISOString(),
    ...over,
  };
}

function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn(async (input: string | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === LEDGER_URL) {
    if (!state.ledgerOk) return resLike({ ok: false, status: 500, body: { error: "boom" } });
    return resLike({ body: state.ledger });
  }
  if (url === "/api/loyalty/convert-points") {
    return resLike({ body: { message: "تم التحويل" } });
  }
  return resLike({ body: state.loyalty });
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

async function openConvertForm() {
  renderPage();
  return await screen.findByPlaceholderText(/عدد النقاط/);
}

beforeEach(() => {
  toastSpy.mockReset();
  fetchMock.mockClear();
  state.loyalty = loyaltyPayload();
  state.ledger = [];
  state.ledgerOk = true;
  localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoyaltyPage — the POINTS HISTORY (R115, A8 P2)", () => {
  it("renders ledger rows: labels, signed deltas, points_after, the conversion's lyd_credited, date", async () => {
    state.ledger = [
      ledgerRow({ id: 4, points_delta: 80, points_after: 80 }),
      ledgerRow({
        id: 3,
        type: "referral_credit",
        type_label: "نقاط إحالة",
        points_delta: 50,
        points_after: 130,
      }),
      ledgerRow({
        id: 2,
        type: "conversion_out",
        type_label: "تحويل إلى رصيد",
        points_delta: -100,
        points_after: 30,
        lyd_credited: 1,
      }),
      ledgerRow({
        id: 1,
        type: "refund_reversal",
        type_label: "استرداد نقاط",
        points_delta: -30,
        points_after: 50,
      }),
    ];
    renderPage();

    expect(await screen.findByText("نقاط شراء")).toBeInTheDocument();
    expect(screen.getByText("نقاط إحالة")).toBeInTheDocument();
    expect(screen.getByText("تحويل إلى رصيد")).toBeInTheDocument();
    expect(screen.getByText("استرداد نقاط")).toBeInTheDocument();

    // Signed deltas — «+» for awards, «-» for conversions/reversals.
    expect(screen.getByText("+80")).toBeInTheDocument();
    expect(screen.getByText("+50")).toBeInTheDocument();
    expect(screen.getByText("-100")).toBeInTheDocument();
    expect(screen.getByText("-30")).toBeInTheDocument();

    // The running balance per row.
    expect(screen.getByText("الرصيد: 130")).toBeInTheDocument();
    expect(screen.getByText("الرصيد: 30")).toBeInTheDocument();

    // Conversion rows pin the LYD they yielded (rate snapshot in-row).
    expect(screen.getByText("+1.00 د.ل")).toBeInTheDocument();

    // Date column via the shared formatter.
    expect(
      screen.getAllByText(`· ${formatDate(new Date("2026-09-29T10:00:00Z").toISOString())}`)
        .length,
    ).toBe(4);

    expect(screen.queryByText("لا توجد حركات نقاط بعد")).not.toBeInTheDocument();
  });

  it("an empty ledger renders the empty state, not an error", async () => {
    state.ledger = [];
    renderPage();

    expect(await screen.findByText("لا توجد حركات نقاط بعد")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل سجل النقاط")).not.toBeInTheDocument();
  });

  it("a failed ledger fetch is a distinct error with retry — the stats above stay rendered", async () => {
    state.ledgerOk = false;
    renderPage();

    // The page-level data (stats row) still loaded fine…
    expect(await screen.findByText("نقاطي")).toBeInTheDocument();

    // …while the history shows its OWN error card (outage ≠ empty).
    expect(await screen.findByText("تعذّر تحميل سجل النقاط")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد حركات نقاط بعد")).not.toBeInTheDocument();

    const ledgerCallsBefore = fetchMock.mock.calls.filter(([u]) => String(u) === LEDGER_URL).length;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([u]) => String(u) === LEDGER_URL).length;
      expect(calls).toBeGreaterThan(ledgerCallsBefore);
    });
  });
});

describe("LoyaltyPage — conversion gates + tiers driven by API values (R115, A12)", () => {
  it("derives min/step/max/placeholder from points_rate.points_per_lyd (fixture 50, not 100)", async () => {
    state.loyalty = loyaltyPayload({
      points: 500,
      tier_thresholds: { silver: 300, gold: 1500, platinum: 4000 },
      points_rate: { points_per_referral: 50, points_per_lyd: 50 },
      next_tier: { tier: "silver", label: "فضي", remaining: 120 },
    });
    const input = (await openConvertForm()) as HTMLInputElement;

    expect(input.getAttribute("min")).toBe("50");
    expect(input.getAttribute("step")).toBe("50");
    // max = floor(points / rate) * rate = floor(500/50)*50 = 500.
    expect(input.getAttribute("max")).toBe("500");
    expect(input.getAttribute("placeholder")).toBe("عدد النقاط (50، 100، ...)");
  });

  it("shows the persistent inline WHY: below-min and non-multiple values explain themselves", async () => {
    state.loyalty = loyaltyPayload({
      points_rate: { points_per_referral: 50, points_per_lyd: 50 },
    });
    const input = (await openConvertForm()) as HTMLInputElement;

    // Below the API min → inline min message (not only a post-submit toast).
    fireEvent.change(input, { target: { value: "30" } });
    expect(await screen.findByText("الحد الأدنى للتحويل 50 نقطة")).toBeInTheDocument();
    expect(screen.queryByText(/ستحصل على/)).not.toBeInTheDocument();

    // Non-multiple → inline multiples message.
    fireEvent.change(input, { target: { value: "75" } });
    expect(
      await screen.findByText(/يجب أن تكون النقاط من مضاعفات 50/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ستحصل على/)).not.toBeInTheDocument();

    // A valid multiple → the live preview returns (50 pts → 1.00 د.ل at 50:1).
    fireEvent.change(input, { target: { value: "50" } });
    expect(await screen.findByText(/ستحصل على 1\.00 د\.ل/)).toBeInTheDocument();
    expect(screen.queryByText(/مضاعفات/)).not.toBeInTheDocument();
  });

  it("the below-minimum branch quotes the API rate (points 40 < rate 50)", async () => {
    state.loyalty = loyaltyPayload({
      points: 40,
      points_rate: { points_per_referral: 50, points_per_lyd: 50 },
    });
    renderPage();

    expect(await screen.findByText(/إضافية للوصول للحد الأدنى \(50 نقطة\)/)).toBeInTheDocument();
    // No convert input while below the minimum.
    expect(screen.queryByPlaceholderText(/عدد النقاط/)).not.toBeInTheDocument();
  });

  it("tier rows + the progress bar derive from the API's tier_thresholds (300/1500/4000)", async () => {
    state.loyalty = loyaltyPayload({
      tier_thresholds: { silver: 300, gold: 1500, platinum: 4000 },
      next_tier: { tier: "silver", label: "فضي", remaining: 120 },
    });
    renderPage();
    await screen.findByText("كيف تكسب النقاط؟");

    // The tier rows quote the API thresholds — not the old literals.
    expect(screen.getByText("المستوى الفضي (300 د.ل إنفاق)")).toBeInTheDocument();
    expect(screen.getByText("المستوى الذهبي (1500 د.ل إنفاق)")).toBeInTheDocument();

    // Progress: 100 - (remaining 120 / silver 300)*100 = 60%.
    const bar = document.querySelector("div.bg-gradient-to-l") as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar!.style.width).toBe("60%");
  });

  it("falls back to the historical thresholds when the API omits tier_thresholds", async () => {
    const { tier_thresholds: _omit, ...withoutThresholds } = loyaltyPayload();
    void _omit;
    state.loyalty = withoutThresholds;
    renderPage();
    await screen.findByText("كيف تكسب النقاط؟");

    expect(screen.getByText("المستوى الفضي (500 د.ل إنفاق)")).toBeInTheDocument();
    expect(screen.getByText("المستوى الذهبي (2000 د.ل إنفاق)")).toBeInTheDocument();
  });

  it("states the earn rate explicitly and makes NO unbacked perk promises (A8 #6 + #7)", async () => {
    renderPage();
    await screen.findByText("كيف تكسب النقاط؟");

    // The earn rate is explicit (1 point per 1 LYD paid — policy value).
    expect(screen.getByText("نقطة لكل 1 د.ل مدفوع")).toBeInTheDocument();

    // Tiers are documented as progress markers — the unbacked
    // «مزايا إضافية»/«أولوية الدعم» promises are gone.
    expect(screen.getAllByText("مزايا قريباً").length).toBe(2);
    expect(screen.queryByText("مزايا إضافية")).not.toBeInTheDocument();
    expect(screen.queryByText("أولوية الدعم")).not.toBeInTheDocument();
    expect(
      screen.getByText(/المستويات مؤشرات تقدّم في هذه المرحلة/),
    ).toBeInTheDocument();
  });
});
