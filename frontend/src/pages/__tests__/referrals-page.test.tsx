/**
 * R118-B6 (audit R118-A5 #11, P2) — referrals page tests.
 *
 * /referrals was the last money-data page with ZERO tests: it renders
 * the buyer's referral code/link, the points_earned summary (money-
 * adjacent — points convert to wallet balance at 100:1) and the
 * referral history. These tests pin the CURRENT contracts of
 * pages/referrals.tsx:
 *
 *   1. A failed overview query renders the DISTINCT error card with a
 *      retry that re-runs BOTH queries — an outage must never
 *      masquerade as the "no referrals yet" empty state (the
 *      93-C5/F-05 error-as-empty class; the page's loadError branch).
 *   2. The retry button is wired to both queries' refetch and
 *      recovers the page once the API answers again.
 *   3. The link CopyBtn writes the full deep link —
 *      `${origin}/register?ref=CODE` — to the REAL clipboard API.
 *   4. The «نقاط مكتسبة» stat sums points_earned of CREDITED events
 *      only — pending events render their own state, never points.
 *   5. Healthy overview + zero events renders the honest empty state.
 *
 * Page-test conventions (vitest.config.ts header + profile/orders page
 * tests): `@workspace/api-client-react` (only `customFetch` is
 * consumed by this page) and `@/lib/auth`/`@/hooks/useToast` are
 * mocked at the module boundary; the REAL react-query engine runs
 * behind a fresh QueryClient (retry: false) so the error/retry
 * transitions are exercised for real. Real timers throughout — the
 * page itself arms no timers on the happy/error paths.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import ReferralsPage from "@/pages/referrals";

const { customFetchMock, toastMock } = vi.hoisted(() => ({
  customFetchMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: customFetchMock,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

/** The /api/loyalty overview payload the page's LoyaltyOverview maps. */
const OVERVIEW = {
  points: 500,
  referral_code: "SNXYZ99",
  referrals_credited: 2,
  referrals_pending: 1,
  referrals_total: 3,
  points_rate: { points_per_referral: 50 },
};

/** A /api/loyalty/referrals event row (shape of ReferralEvent). */
function event(
  id: number,
  status: "pending" | "credited",
  pointsEarned: number,
): Record<string, unknown> {
  return {
    id,
    status,
    phone_masked: `••••${id}`,
    created_at: "2026-09-01T10:00:00.000Z",
    credited_at: status === "credited" ? "2026-09-02T10:00:00.000Z" : null,
    points_earned: pointsEarned,
  };
}

/** Mutable per-test router state (both mount queries read from it). */
const state = {
  overviewFail: false,
  eventsFail: false,
  events: [] as Array<Record<string, unknown>>,
};

function callsTo(url: string): number {
  return customFetchMock.mock.calls.filter((c) => String(c[0]) === url).length;
}

beforeEach(() => {
  customFetchMock.mockReset();
  toastMock.mockClear();
  state.overviewFail = false;
  state.eventsFail = false;
  state.events = [];
  // URL router: /api/loyalty (overview) × /api/loyalty/referrals
  // (history). A network-level rejection models the outage the page's
  // error branch is contractually distinct from "no data";
  // state.eventsFail models a 200 whose JSON body is NOT an array
  // (the B-F6/R186 shape-guard leg).
  customFetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url === "/api/loyalty") {
      if (state.overviewFail) throw new TypeError("Failed to fetch");
      return OVERVIEW;
    }
    if (url === "/api/loyalty/referrals") {
      if (state.eventsFail) return { notifications: [] };
      return [...state.events];
    }
    throw new Error(`unexpected url: ${url}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <ReferralsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("ReferralsPage — outage ≠ empty, copy + points contracts (R118-A5 #11)", () => {
  it("a failed overview query renders the error card, never the empty state (93-C5/F-05)", async () => {
    state.overviewFail = true; // events query stays healthy — isolated branch

    renderPage();

    expect(await screen.findByText("تعذّر تحميل بيانات الإحالات")).toBeInTheDocument();
    // The outage must NOT masquerade as "no referrals yet"…
    expect(screen.queryByText("لا توجد إحالات بعد")).not.toBeInTheDocument();
    // …and the stats grid (the money-adjacent surface) must not render.
    expect(screen.queryByText("إجمالي الإحالات")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
    // The first-error effect fired exactly one destructive toast.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "خطأ في التحميل", variant: "destructive" }),
    );
  });

  it("retry re-runs BOTH queries and the page recovers once the API answers", async () => {
    state.overviewFail = true;

    renderPage();
    const retry = await screen.findByRole("button", { name: "إعادة المحاولة" });

    // The API comes back before the retry lands.
    state.overviewFail = false;
    fireEvent.click(retry);

    expect(await screen.findByText("إجمالي الإحالات")).toBeInTheDocument();
    expect(await screen.findByText("SNXYZ99")).toBeInTheDocument();
    // Both the overview AND the events query were re-fetched (the
    // retry button is wired to both refetch calls).
    await waitFor(() => {
      expect(callsTo("/api/loyalty")).toBe(2);
      expect(callsTo("/api/loyalty/referrals")).toBe(2);
    });
  });

  it("the link CopyBtn writes the full ?ref=CODE deep link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom ships no Async Clipboard API — install the mock the real
    // copyToClipboard helper (@/lib/utils) branches on. NOT mocked at
    // the module boundary: the page's helper chain runs for real, so
    // the test certifies the link actually REACHES the clipboard API.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    // jsdom reports no isSecureContext (undefined → falsy) — the real
    // helper would dive into the execCommand fallback (unimplemented in
    // jsdom: copy fails + the fallback textarea leaks into the body).
    // Shadow it with an own property so the primary clipboard branch is
    // taken, exactly like a real https origin.
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    try {
      renderPage();
      await screen.findByText("SNXYZ99");

      // The link field shows the full deep link…
      const link = `${window.location.origin}/register?ref=SNXYZ99`;
      expect(screen.getByText(link)).toBeInTheDocument();
      // …and its copy button (the sm «نسخ», not «نسخ الرمز») pushes
      // exactly that string to the clipboard, flipping to the copied
      // label. R123-E4a (P3-g): the shared CopyButton (components/
      // CopyButton.tsx) — the sm variant announces «تم».
      fireEvent.click(screen.getByRole("button", { name: "نسخ" }));
      expect(await screen.findByRole("button", { name: "تم" })).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(link);
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
      Reflect.deleteProperty(window, "isSecureContext");
    }
  });

  it("«نقاط مكتسبة» sums points_earned of CREDITED events only", async () => {
    // 50 + 30 credited; the pending 40 must NOT count toward the sum.
    state.events = [event(1, "credited", 50), event(2, "credited", 30), event(3, "pending", 40)];

    renderPage();
    await screen.findByText("إجمالي الإحالات");

    // The stat label renders while queries load — wait for the summed
    // VALUE (events query settles) before the sync assertions below.
    expect(await screen.findByText("80")).toBeInTheDocument();
    // Credited rows show their earned points chips…
    expect(screen.getByText("+50 نقطة")).toBeInTheDocument();
    expect(screen.getByText("+30 نقطة")).toBeInTheDocument();
    // …the pending row never earns: no +40 chip, its own state instead.
    expect(screen.queryByText("+40 نقطة")).not.toBeInTheDocument();
    expect(screen.getAllByText("قيد الانتظار").length).toBeGreaterThanOrEqual(2); // stat label + the pending row
    // All three history rows rendered.
    expect(screen.getByText("••••1")).toBeInTheDocument();
    expect(screen.getByText("••••2")).toBeInTheDocument();
    expect(screen.getByText("••••3")).toBeInTheDocument();
  });

  it("healthy overview with zero events renders the honest empty state", async () => {
    renderPage();

    expect(await screen.findByText("لا توجد إحالات بعد")).toBeInTheDocument();
    expect(screen.getByText("شارك رابطك مع أصدقائك وابدأ في كسب النقاط")).toBeInTheDocument();
    // Not an error — the code card still renders with live data.
    expect(screen.queryByText("تعذّر تحميل بيانات الإحالات")).not.toBeInTheDocument();
    expect(screen.getByText("SNXYZ99")).toBeInTheDocument();
  });

  it("a 200 with a NON-ARRAY referrals body renders the error card, never the empty state (B-F6/R186 shape guard)", async () => {
    // A well-formed-JSON but wrong-shaped 200 (proxy envelope, future API
    // shape change) used to degrade to `[]` — zeroed stats + «لا توجد
    // إحالات بعد» masking a contract drift. The queryFn now throws into
    // the page's loadError → FetchErrorCard derivation.
    state.eventsFail = true;

    renderPage();

    expect(await screen.findByText("تعذّر تحميل بيانات الإحالات")).toBeInTheDocument();
    // Crucially NOT the false empty state, and NOT the money-adjacent
    // stats grid either.
    expect(screen.queryByText("لا توجد إحالات بعد")).not.toBeInTheDocument();
    expect(screen.queryByText("إجمالي الإحالات")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});

// ── R187 (B-F2 / B-F4): the LTR phone run + the truncated-window chip ────
describe("ReferralsPage — R187 account-page fixes", () => {
  it("the masked-phone run carries dir=ltr (B-F2: the mask's internal neutrals flip in the RTL base)", async () => {
    // "091****567" is the backend mask's exact class (routes/loyalty.ts):
    // Latin digits with NEUTRAL asterisks between them — under the RTL
    // base direction the Unicode bidi algorithm visually reorders the
    // segments ("567****091"). The <p> is the referral-code sibling's
    // dir="ltr" twin.
    state.events = [{ ...event(1, "pending", 40), phone_masked: "091****567" }];

    renderPage();

    const phone = await screen.findByText("091****567");
    expect(phone.tagName).toBe("P");
    expect(phone).toHaveAttribute("dir", "ltr");
  });

  it("a full 200-row window captions «عرض آخر 200 إحالة», never the raw window count (B-F4)", async () => {
    // The backend caps GET /api/loyalty/referrals at 200 rows/page and
    // this page fetches page 1 only — a full window is TRUNCATED while
    // the stat tiles above carry the TRUE aggregate (referrals_total).
    // The chip states what's shown (the WalletStatementCard honesty
    // idiom), never the window count presented as the total.
    state.events = Array.from({ length: 200 }, (_, i) => event(i + 1, "credited", 50));

    renderPage();
    await screen.findByText("••••1");

    expect(screen.getByText("عرض آخر 200 إحالة")).toBeInTheDocument();
    // …and the plain-count branch (the raw window count) does not render.
    expect(screen.queryByText("200")).not.toBeInTheDocument();
  });
});

// ── B-F9 (R186): handleShare failure discrimination ──────────────────────
// navigator.share rejects BOTH for user cancel (AbortError — a silent
// no-op by design) and for real failures; the old bare `catch {}` swallowed
// both, leaving a real failure with ZERO feedback while the no-share-API
// arm got the clipboard fallback toast for the same intent.
describe("ReferralsPage — a real navigator.share failure routes to the clipboard fallback; a user cancel stays silent (B-F9)", () => {
  /** Installs the web-share + clipboard seams (jsdom ships neither). */
  function installShareSeams(shareImpl?: () => Promise<void>) {
    const writeText = vi.fn().mockResolvedValue(undefined);
    if (shareImpl) {
      Object.defineProperty(navigator, "share", {
        value: shareImpl,
        configurable: true,
      });
    }
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    // jsdom reports no isSecureContext (undefined → falsy) — shadow it so
    // copyToClipboard takes the primary clipboard branch, exactly like a
    // real https origin (the CopyBtn leg's idiom above).
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });
    return { writeText };
  }

  function cleanupShareSeams() {
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(window, "isSecureContext");
  }

  async function clickShare() {
    renderPage();
    await screen.findByText("SNXYZ99");
    fireEvent.click(screen.getByRole("button", { name: "مشاركة الرابط" }));
  }

  it("a non-AbortError share rejection fires the copied-to-clipboard fallback toast", async () => {
    // A REAL failure (invalid data / permission) — not a user cancel.
    const { writeText } = installShareSeams(() => Promise.reject(new Error("share failed")));

    try {
      await clickShare();

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.objectContaining({ title: "تم نسخ الرسالة", description: "شاركها مع أصدقائك!" }),
        );
      });
      // The fallback actually reached the clipboard with the share text.
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(String(writeText.mock.calls[0][0])).toContain("SNXYZ99");
    } finally {
      cleanupShareSeams();
    }
  });

  it("an AbortError rejection (user cancel) stays silent — no toast, no clipboard write", async () => {
    const cancel = Object.assign(new Error("user cancel"), { name: "AbortError" });
    const { writeText } = installShareSeams(() => Promise.reject(cancel));

    try {
      await clickShare();

      // Drain the share rejection chain — nothing may fire.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(toastMock).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      cleanupShareSeams();
    }
  });
});
