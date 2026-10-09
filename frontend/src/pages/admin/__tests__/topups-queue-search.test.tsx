/**
 * R124-I5 (A6 F14a) — the topup money queue's search.
 *
 * The list route (routes/admin/topups.ts) supports ?status=&page=&limit=
 * but NO ?search= — so the search runs CLIENT-side over the accumulated
 * pages, with an honest partial-window hint while load-more remains
 * (the products.tsx capped-window discipline). These tests pin:
 *
 *   1. The 300ms-debounced filter matches by phone AND payment
 *      reference, and the header labels the result set honestly
 *      («نتائج البحث: N» — never «إجمالاً»).
 *   2. A non-matching query renders the search empty state (not the
 *      generic «لا توجد طلبات») whose «مسح البحث» CTA actually clears.
 *   3. While more pages exist (a full 100-row page ⇒ hasNextPage), the
 *      partial-window hint stays visible — the client-side search never
 *      claims to cover unloaded history.
 *
 * Mock idiom follows topups-approve-all.test.tsx (customFetch mocked at
 * the module boundary; the admin shell stubbed to a passthrough).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminTopupsPage from "@/pages/admin/topups";
import { customFetch } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getListAdminTopupsQueryKey: () => ["admin-topups"],
  approveTopup: vi.fn(),
  rejectTopup: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

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

const PENDING = [
  {
    id: 11,
    amount: 50,
    status: "pending",
    user_phone: "0911111111",
    payment_method: "mobile_transfer",
    payment_reference: "REF-AAA111",
    created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    id: 12,
    amount: 75,
    status: "pending",
    user_phone: "0912222222",
    payment_method: "mobile_transfer",
    payment_reference: "REF-BBB222",
    created_at: "2026-09-01T11:00:00.000Z",
  },
  {
    id: 13,
    amount: 100,
    status: "pending",
    user_phone: "0913333333",
    payment_method: "mobile_transfer",
    payment_reference: "REF-CCC333",
    created_at: "2026-09-01T12:00:00.000Z",
  },
];

/** A FULL page (TOPUPS_PAGE_SIZE rows) ⇒ hasNextPage=true — the
 *  partial-window honesty branch. Phones are zero-padded so every row
 *  key + visible phone stays unique. */
function fullPage() {
  return Array.from({ length: 100 }, (_, i) => ({
    id: 1000 + i,
    amount: 25,
    status: "pending",
    user_phone: `091${String(i).padStart(7, "0")}`,
    payment_method: "mobile_transfer",
    created_at: "2026-09-01T10:00:00.000Z",
  }));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminTopupsPage />
      </Router>
    </QueryClientProvider>,
  );
}

async function typeSearch(query: string) {
  const input = await screen.findByPlaceholderText("بحث برقم التحويل أو الهاتف…");
  fireEvent.change(input, { target: { value: query } });
  // Let the 300ms debounce settle inside act() (the repo idiom — a bare
  // waitFor leaves the setState outside React's act scope).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 340));
  });
}

describe("AdminTopupsPage — the money-queue search (R124-I5 A6 F14a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue(PENDING);
  });
  afterEach(() => {
    // Real timers — nothing to tear down; the repo debounce-test idiom
    // (products-error-bulk) lets each settle inside act().
  });

  it("debounced client-side filter matches by phone AND payment reference, with an honest result count", async () => {
    renderPage();
    expect(await screen.findByText("0911111111")).toBeInTheDocument();
    expect(screen.getByText("0912222222")).toBeInTheDocument();

    // Phone fragment → after the 300ms debounce only the matching card.
    await typeSearch("0912");
    expect(screen.queryByText("0911111111")).not.toBeInTheDocument();
    expect(screen.getByText("0912222222")).toBeInTheDocument();
    // The header keeps the loaded-window count; the FILTER's own result
    // set is labeled separately (never «إجمالاً»).
    expect(screen.getByText(/نتائج البحث/)).toBeInTheDocument();

    // Payment reference fragment → same client-side match.
    await typeSearch("CCC333");
    expect(screen.queryByText("0911111111")).not.toBeInTheDocument();
    expect(screen.getByText("0913333333")).toBeInTheDocument();
  });

  it("a non-matching query renders the search empty state whose مسح البحث CTA clears it", async () => {
    renderPage();
    expect(await screen.findByText("0911111111")).toBeInTheDocument();

    await typeSearch("لا-شيء-يطابق");
    // The SEARCH empty state (with the query echoed), not the generic
    // «لا توجد طلبات معلقة» claim.
    expect(await screen.findByText(/لا نتائج لـ/)).toBeInTheDocument();
    expect(screen.queryByText("لا توجد طلبات معلقة")).not.toBeInTheDocument();

    // The EmptyState's text CTA (the input's icon ✕ carries the same
    // accessible name — disambiguate by text content).
    const clearButtons = screen.getAllByRole("button", { name: "مسح البحث" });
    const cta = clearButtons.find((b) => b.textContent === "مسح البحث");
    expect(cta).toBeTruthy();
    fireEvent.click(cta as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText("0911111111")).toBeInTheDocument();
    });
    expect(screen.queryByText(/لا نتائج لـ/)).not.toBeInTheDocument();
  });

  it("while more pages exist, the search keeps the partial-window hint visible", async () => {
    (customFetch as unknown as Mock).mockResolvedValue(fullPage());
    renderPage();
    expect(await screen.findByText("0910000000")).toBeInTheDocument();

    // A query matching exactly one row of the loaded (full) page.
    await typeSearch("0910000001");
    expect(screen.queryByText("0910000000")).not.toBeInTheDocument();
    expect(screen.getByText(/البحث يعمل على الطلبات المعروضة فقط/)).toBeInTheDocument();
  });
});
