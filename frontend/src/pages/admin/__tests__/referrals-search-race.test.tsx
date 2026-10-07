/**
 * 98-F7 (R98-02 — A5 §2) — admin referrals search race tests.
 *
 * The page's hand-rolled fetchData + 300ms debounce had neither an
 * AbortController nor a sequence guard (the r97 race-audit wave covered
 * home/GlobalSearch/orders/users; referrals slipped through). Typing
 * "abc" then "abcd" raced two overlapping requests: the OLDER "abc"
 * response resolving late used to overwrite the newer list/stat cards
 * with results for a query nobody was looking at (setData was
 * last-ARRIVAL, not last-REQUEST).
 *
 * These tests pin the new contract:
 *
 *   1. A delayed older response that arrives AFTER the newer one must
 *      NOT overwrite the newer results (seq guard — exercised with a
 *      fetch mock that ignores the abort signal, i.e. the belt-only
 *      path).
 *   2. The debounced request carries an AbortSignal (GlobalSearch
 *      controller pattern) so real runtimes kill the stale request at
 *      the source.
 *
 * R118 (A5 W-6 follow-up): migration to vi.useFakeTimers is still PENDING —
 * the suite still sleeps real 340/700/800ms per test (known top flake
 * candidate on a loaded 2-CPU runner; green at R118 full gates). Convert
 * using the repo's fake-timer idiom (whatsapp-phone-sign-in.test.tsx):
 * act(vi.advanceTimersByTime) + microtask flush; NEVER waitFor/findBy
 * (they poll on faked timers and hang).
 *
 * Module-boundary mocks follow referrals-error-state.test.tsx.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminReferralsPage from "@/pages/admin/referrals";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    // R122 (A2-P1): the page gates the credit button on the finance
    // scope — default-grant keeps these race tests scoped to their own
    // concern (see referrals-finance-gate.test.tsx).
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

/** A list body carrying one referee phone — the row text we assert on. */
function payloadFor(refereePhone: string) {
  return {
    stats: { total: 1, credited: 0, pending: 1, total_points: 0 },
    top_referrers: [],
    list: [
      {
        id: 1,
        status: "pending" as const,
        created_at: "2026-09-01T10:00:00.000Z",
        credited_at: null,
        referrer_phone: "0911111111",
        referrer_id: 7,
        referee_phone: refereePhone,
        points_earned: 0,
      },
    ],
  };
}

const FRESH = "0955555555"; // the "abcd" (newer) result
const STALE = "0944444444"; // the "abc" (older) result

function resLike(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  return render(
    <Router>
      <AdminReferralsPage />
    </Router>,
  );
}

describe("AdminReferralsPage — debounced search races (R98-02)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a delayed OLDER response arriving last never overwrites the newer results", async () => {
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("search=abcd")) {
        // The newer query answers immediately.
        return Promise.resolve(resLike(payloadFor(FRESH)));
      }
      if (url.includes("search=abc")) {
        // The older query answers SLOWLY (700ms) — the fetch mock
        // deliberately IGNORES init.signal so the abort cannot save us:
        // only the seq guard can keep this response out of the state.
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(resLike(payloadFor(STALE))), 700);
        });
      }
      // Initial mount fetch (no search param): the unfiltered list.
      return Promise.resolve(resLike(payloadFor(FRESH)));
    });

    renderPage();
    const input = await screen.findByPlaceholderText("بحث برقم المُحيل أو المُحال...");

    // Type "abc" — first debounce fires after 300ms.
    fireEvent.change(input, { target: { value: "abc" } });
    await new Promise((r) => setTimeout(r, 340));

    // Complete to "abcd" — the newer request fires and lands.
    fireEvent.change(input, { target: { value: "abcd" } });
    await screen.findByText(FRESH, { selector: "span" });

    // Wait WELL past the older response's 700ms delay — it resolves now,
    // after the newer one. The stale referee phone must never appear.
    await new Promise((r) => setTimeout(r, 800));
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
    expect(screen.getByText(FRESH, { selector: "span" })).toBeInTheDocument();
  });

  it("hands the debounced request an AbortSignal so real runtimes kill the stale request", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(resLike(payloadFor(FRESH))));

    renderPage();
    const input = await screen.findByPlaceholderText("بحث برقم المُحيل أو المُحال...");

    fireEvent.change(input, { target: { value: "abc" } });
    await new Promise((r) => setTimeout(r, 340));

    const calls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/admin/referrals?"),
    );
    // The debounced (300ms) request carries a signal — mount + debounced
    // both fire here, at least one of them (the debounce) with a signal.
    const withSignal = calls.filter(
      (c) => (c[1] as { signal?: AbortSignal } | undefined)?.signal instanceof AbortSignal,
    );
    expect(withSignal.length).toBeGreaterThanOrEqual(1);
    // Only search-typed requests get the signal (mount fetch keeps its
    // legacy no-signal shape — the refresh button / status-filter path).
    fireEvent.change(input, { target: { value: "abcd" } });
    await new Promise((r) => setTimeout(r, 340));
    const afterSecond = fetchMock.mock.calls.filter((c) => String(c[0]).includes("search=abcd"));
    expect(afterSecond.length).toBeGreaterThanOrEqual(1);
    expect((afterSecond[0]![1] as { signal?: AbortSignal } | undefined)?.signal).toBeInstanceOf(
      AbortSignal,
    );
  });
});
