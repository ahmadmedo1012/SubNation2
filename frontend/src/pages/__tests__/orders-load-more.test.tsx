/**
 * R120-B7 (reviewer finding — A6-F1 UI consumption): the orders page
 * walks past the 200-row cap.
 *
 * The route grew an additive ?page= param in R120-B6/A6-F1 but no
 * frontend consumed it — a reseller past 200 orders could never reach
 * order #201+ (the exact user-visible harm the P2 described). The page
 * now rides the accumulating useInfiniteQuery idiom (admin/orders.tsx
 * 94-C2 A2 P1-1): a real QueryClient + the mocked global fetch (the
 * generated client can't express `page` until the orval/zod alignment
 * lands — see the api-zod hand-edit note; the page fetches the raw
 * /api/orders?page=N URL like admin tickets).
 *
 * Pinned here:
 *   • the first page is requested with ?page=1;
 *   • a FULL page shows the honest «عرض N (الأحدث أولاً)» badge (never
 *     a grand total the plain-array contract can't know) + the
 *     «تحميل المزيد» button;
 *   • load-more appends page 2, DEDUPS a row repeated across pages
 *     (offsets shift when a purchase lands between page requests), and
 *     hides once a page comes back short (the definite end);
 *   • a single SHORT page keeps the plain known-total badge and no
 *     load-more;
 *   • a failed fetch surfaces the error card, never the empty state
 *     (the queryFn's !r.ok branch).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrdersPage from "@/pages/orders";
import { formatCount } from "@/lib/utils";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const ORDER_COUNT_FORMS = {
  one: "طلب",
  two: "طلبان",
  few: "طلبات",
  many: "طلباً",
  other: "طلب",
} as const;

const ORDER = (i: number) => ({
  id: i,
  order_code: `SNDB${String(i).padStart(4, "0")}`,
  status: "completed",
  amount: 25,
  product_name: `منتج رقم ${i}`,
  product_image_url: null,
  variant_label: null,
  created_at: "2026-09-08T10:00:00.000Z",
});

/** Minimal Response-like object — avoids depending on a global Response
 * (the alerts-load-more.test.tsx idiom). */
const jsonRes = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

const fetchMock = vi.fn<typeof fetch>();
let pageOne: unknown[] = [];
let pageTwo: unknown[] = [];

beforeEach(() => {
  pageOne = Array.from({ length: 200 }, (_, i) => ORDER(i + 1));
  // 3 rows, one of which repeats page 1's id=1 → dedup leaves 2 new.
  pageTwo = [ORDER(201), ORDER(1), ORDER(202)];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    return jsonRes(url.includes("page=2") ? pageTwo : pageOne);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <OrdersPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("OrdersPage — A6-F1 UI consumption: walking past the 200-row cap (R120-B7)", () => {
  it("requests page 1 and shows the honest «عرض N» badge + load-more on a full page", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/منتج رقم 1$/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/orders?page=1");
    // Full page → the total is NOT provably known: the badge says what
    // the list SHOWS (admin/orders.tsx honesty idiom), not a total.
    expect(
      screen.getByText(`عرض ${formatCount(200, ORDER_COUNT_FORMS)} (الأحدث أولاً)`),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /تحميل المزيد/ })).toBeInTheDocument();
  });

  it("load-more appends the next page, dedups repeated rows, and hides at the definite end", async () => {
    renderPage();

    const loadMore = await screen.findByRole("button", { name: /تحميل المزيد/ });
    fireEvent.click(loadMore);

    // Page 2 carried 3 rows but one repeats id=1 → 200 + 2 = 202.
    await waitFor(() => expect(screen.getByText(/منتج رقم 202$/)).toBeInTheDocument());
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("page=2");
    expect(
      screen.getByText(`عرض ${formatCount(202, ORDER_COUNT_FORMS)} (الأحدث أولاً)`),
    ).toBeInTheDocument();
    // Page 2 came back short → the definite end: no more load-more.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /تحميل المزيد/ })).not.toBeInTheDocument(),
    );
  });

  it("a single SHORT page keeps the plain known-total badge and no load-more", async () => {
    pageOne = [ORDER(1), ORDER(2), ORDER(3)];
    renderPage();

    await waitFor(() => expect(screen.getByText(/منتج رقم 3$/)).toBeInTheDocument());
    // One short page → the total IS provably known: plain count, no «عرض».
    expect(screen.getByText(formatCount(3, ORDER_COUNT_FORMS))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /تحميل المزيد/ })).not.toBeInTheDocument();
  });

  it("a failed fetch surfaces the error card, never the empty state (the !r.ok branch)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonRes({ error: "انتهت الجلسة", code: "UNAUTHORIZED" }, false, 401),
    );
    renderPage();

    expect(await screen.findByText("تعذّر تحميل الطلبات")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد طلبات بعد")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});
