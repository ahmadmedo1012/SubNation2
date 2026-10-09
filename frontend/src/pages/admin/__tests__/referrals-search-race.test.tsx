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
 * R118 (A5 W-6) → R126-L7 (A10 §2.2 P2-3): migrated to vi.useFakeTimers
 * — the suite used to sleep real 340/800ms per test to orchestrate
 * the race interleavings (the documented retired flake pattern; top
 * candidate on a loaded 2-CPU runner). The repo's established
 * fake-timer idiom (global-search.test.tsx / whatsapp-phone-sign-in):
 * advance via act(vi.advanceTimersByTime) + a microtask flush; NEVER
 * waitFor/findBy (they poll on faked timers and hang). The 300ms
 * debounce and the mock's 700ms stale-response delay are FAKE timers,
 * so the "older response resolves after the newer one" interleaving
 * is driven deterministically by advancing exactly past each delay.
 *
 * Module-boundary mocks follow referrals-error-state.test.tsx.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  // R127-L1: the page rides the generated client now (useListAdminReferrals
  // → real customFetch) — the stub carries the headers/text() it parses
  // with (the security-error-state pattern).
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body ?? null)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  // R127-L1: the list rides useListAdminReferrals — fresh client per
  // render (retry: false; fake timers must not arm retry backoffs).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminReferralsPage />
      </Router>
    </QueryClientProvider>,
  );
}

/** Drains the promise continuations behind the mocked fetch (fake timers
 * freeze macrotasks — the global-search.test.tsx idiom). */
async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/** Advances fake time, then drains whatever the fired timers started. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flushAsync();
}

describe("AdminReferralsPage — debounced search races (R98-02)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
        // R127-L1: the response lands in the OLD key's cache (params in
        // the queryKey — the R98-02 seq guard, now structural).
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(resLike(payloadFor(STALE))), 700);
        });
      }
      // Initial mount fetch (no search param): the unfiltered list.
      return Promise.resolve(resLike(payloadFor(FRESH)));
    });

    renderPage();
    await flushAsync(); // the mount fetch (no search param) settles
    const input = screen.getByPlaceholderText("بحث برقم المُحيل أو المُحال...");

    // Type "abc" — the 300ms debounce fires on faked time; the "abc"
    // request goes in flight and stays pending on its own 700ms fake
    // timer.
    fireEvent.change(input, { target: { value: "abc" } });
    await advance(320);

    // Complete to "abcd" — its debounce fires and the newer response
    // (immediate) renders the FRESH referee phone.
    fireEvent.change(input, { target: { value: "abcd" } });
    await advance(320);
    expect(screen.getByText(FRESH, { selector: "span" })).toBeInTheDocument();

    // Advance WELL past the older response's 700ms delay — it resolves
    // now, after the newer one, on a request whose signal the mock
    // deliberately ignored. The stale referee phone must never appear.
    await advance(800);
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
    expect(screen.getByText(FRESH, { selector: "span" })).toBeInTheDocument();
  });

  it("hands the debounced request an AbortSignal so real runtimes kill the stale request", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(resLike(payloadFor(FRESH))));

    renderPage();
    await flushAsync(); // the mount fetch settles
    const input = screen.getByPlaceholderText("بحث برقم المُحيل أو المُحال...");

    fireEvent.change(input, { target: { value: "abc" } });
    await advance(320);

    const calls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/admin/referrals?"),
    );
    // R127-L1: the query's signal rides customFetch into fetch — the
    // debounced (300ms) request carries one (React Query hands every
    // active queryFn an AbortSignal; the mount fetch's URL carries no
    // "?" and is excluded by the filter above).
    const withSignal = calls.filter(
      (c) => (c[1] as { signal?: AbortSignal } | undefined)?.signal instanceof AbortSignal,
    );
    expect(withSignal.length).toBeGreaterThanOrEqual(1);
    // The second search's request carries a signal too (key swap →
    // fresh queryFn → fresh signal).
    fireEvent.change(input, { target: { value: "abcd" } });
    await advance(320);
    const afterSecond = fetchMock.mock.calls.filter((c) => String(c[0]).includes("search=abcd"));
    expect(afterSecond.length).toBeGreaterThanOrEqual(1);
    expect((afterSecond[0]![1] as { signal?: AbortSignal } | undefined)?.signal).toBeInstanceOf(
      AbortSignal,
    );
  });
});
