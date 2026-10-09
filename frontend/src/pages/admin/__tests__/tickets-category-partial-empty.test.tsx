/**
 * R126-L3 (A2-4) — tickets category-filter partial-window empty tests.
 *
 * The category filter runs CLIENT-side over the accumulated pages
 * (visibleTickets), so a category can read «لا توجد تذاكر» while
 * matching tickets sit on UNLOADED pages (hasNextPage=true) — and the
 * load-more button lived INSIDE the non-empty branch, so the hard
 * empty state hid the only path to the pages that contained the
 * category. The ?category= URL filter makes the dead-end shareable.
 *
 * The users.tsx A1-7 partial-empty block (R125-I4) is the mirrored
 * fix; these tests pin the tickets twin (the users-tier-partial-empty
 * test recipe):
 *
 *   1. A zero-match category over a full (partial) page renders the
 *      incompleteness block — NEVER the hard «لا توجد تذاكر» claim —
 *      with «تحميل المزيد» + «إلغاء فلتر الفئة» both offered.
 *   2. Loading the next page appends in place; the matching ticket
 *      surfaces and the partial block disappears.
 *   3. A zero-match category over a provably-complete window (single
 *      short page) keeps the honest hard empty — named for the active
 *      category, not a global-emptiness claim.
 *
 * `@/lib/auth`, the admin shell and the toast hook are mocked at the
 * module boundary (tickets-error-state.test.tsx pattern); the category
 * filter is pinned via ?category= (the deep-link contract).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminTicketsPage from "@/pages/admin/tickets";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const ticketSummary = (id: number, category: string) => ({
  id,
  user_phone: `091${String(10_000_000 + id)}`,
  user_display_name: null,
  user_email: null,
  user_auth_provider: null,
  title: `تذكرة رقم ${id}`,
  category,
  status: "open",
  created_at: "2026-09-01T10:00:00.000Z",
  reply_count: 0,
  last_reply_at: null,
  has_unread_admin: false,
});

/** A FULL 100-row page of billing tickets — the window is provably
 *  partial (the queue is ordered newest-first with no status filter). */
const PAGE_ONE = Array.from({ length: 100 }, (_, i) => ticketSummary(i + 1, "billing"));
/** The short page 2 carries the one technical ticket. */
const TECHNICAL = ticketSummary(999, "technical");

const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminTicketsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminTicketsPage — category-empty over a partial window stays honest (A2-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // The ?category= deep link (R123 E3 P3a) — the shareable dead-end
    // this finding is about. "technical" renders as «تقني».
    window.history.replaceState(null, "", "/admin/tickets?category=technical");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/admin/tickets");
  });

  it("a zero-match category over loaded pages shows the incompleteness block, never the hard empty claim", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(PAGE_ONE),
    } as unknown as Response);

    renderPage();

    // The honest partial-window wording (not the global-emptiness claim).
    await waitFor(() => {
      expect(screen.getByText("لا تذاكر بفئة تقني ضمن الصفحات المحمّلة")).toBeInTheDocument();
    });
    expect(screen.queryByText("لا توجد تذاكر")).not.toBeInTheDocument();
    // The recovery affordances: keep loading OR drop the category filter
    // (the load-more used to be trapped inside the non-empty branch).
    expect(screen.getByRole("button", { name: /تحميل المزيد/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إلغاء فلتر الفئة" })).toBeInTheDocument();
  });

  it("loading the next page surfaces the technical ticket and dissolves the partial block", async () => {
    fetchMock.mockImplementation(async (input: unknown) =>
      // The frozen ?page=&limit= contract — page 2 carries the match.
      String(input).includes("page=2")
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([TECHNICAL]),
          } as unknown as Response)
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(PAGE_ONE),
          } as unknown as Response),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("لا تذاكر بفئة تقني ضمن الصفحات المحمّلة")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /تحميل المزيد/ }));

    // The technical ticket surfaces — the partial block is gone.
    await waitFor(() => {
      expect(screen.getByText(TECHNICAL.title)).toBeInTheDocument();
    });
    expect(screen.queryByText("لا تذاكر بفئة تقني ضمن الصفحات المحمّلة")).not.toBeInTheDocument();
  });

  it("a zero-match category over a provably-complete window keeps the honest hard empty (category-named)", async () => {
    // A single SHORT page (no hasNextPage) — the emptiness is real, and
    // the hard state names the CATEGORY instead of claiming the whole
    // queue is empty (the users tier-empty wording).
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([ticketSummary(1, "billing")]),
    } as unknown as Response);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("لا توجد تذاكر بفئة تقني")).toBeInTheDocument();
    });
    // The partial-window claim is NOT made over a complete window.
    expect(screen.queryByText("لا تذاكر بفئة تقني ضمن الصفحات المحمّلة")).not.toBeInTheDocument();
  });
});
