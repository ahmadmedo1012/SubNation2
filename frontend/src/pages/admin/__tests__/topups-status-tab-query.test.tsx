/**
 * R126-L3 (A1-10) — topups status-tab server-side query tests.
 *
 * The infinite query used to fetch ALL statuses and filter the tabs
 * CLIENT-side, so the PENDING tab over a partial window rendered the
 * hard «لا توجد طلبات قيد الانتظار» while pending rows older than
 * the newest 100 sat on unloaded pages — and the header chip / tab
 * count read 0 against the sidebar badge's server truth (two numbers
 * on one screen disagreeing about pending money).
 *
 * The queue now sends the backend's `?status=` param for the active
 * tab (per-tab query key — the tickets.tsx statusFilter idiom), so
 * page 1 of the pending tab IS the pending head. These tests pin:
 *
 *   1. The active tab drives the fetch URL: the default pending view
 *      sends ?status=pending; «الكل» drops the param; each status tab
 *      sends its own.
 *   2. The pending tab shows the server-filtered pending rows even
 *      when the all-tab's newest 100 rows are all approved — and the
 *      hard «لا توجد طلبات قيد الانتظار» only renders when the
 *      server-filtered page is genuinely empty.
 *   3. Tab counts stay honest: only the ACTIVE tab shows a count (the
 *      loaded window cannot speak for other statuses anymore — an
 *      accidental 0 on an inactive tab was the false-count half of
 *      A1-10).
 *
 * Mock idiom follows topups-approve-all.test.tsx (customFetch mocked at
 * the module boundary; the admin shell stubbed to a passthrough).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const topup = (id: number, status: string) => ({
  id,
  amount: 50,
  status,
  user_phone: `091${String(10_000_000 + id)}`,
  payment_method: "mobile_transfer",
  payment_reference: `REF-${id}`,
  created_at: "2026-09-01T10:00:00.000Z",
});

/** A FULL 100-row page of APPROVED topups — the all-tab's newest
 *  window with zero pending rows (the A1-10 false-empty setup). */
const APPROVED_PAGE = Array.from({ length: 100 }, (_, i) => topup(1000 + i, "approved"));
const PENDING_ROW = topup(7, "pending");

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

/** The list URLs customFetch was called with (page param present). */
function listUrls() {
  return (customFetch as unknown as Mock).mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/api/admin/topups?"));
}

/** A status-TAB button by its visible label (textContent prefix). The
 *  aria-labels of the bulk controls also mention the statuses («تحديد
 *  كل طلبات الشحن قيد الانتظار»), so role-name matching collides —
 *  the tab is the aria-pressed button whose text starts with the
 *  label. */
function statusTab(label: string): HTMLButtonElement {
  const tab = screen
    .getAllByRole("button")
    .find((b) => (b.textContent ?? "").trim().startsWith(label) && b.hasAttribute("aria-pressed"));
  if (!tab) throw new Error(`status tab not found: ${label}`);
  return tab as HTMLButtonElement;
}

describe("AdminTopupsPage — the status tab rides the server-side ?status= (A1-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue([PENDING_ROW]);
    window.history.replaceState(null, "", "/admin/topups");
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/admin/topups");
  });

  it("the active tab drives the fetch URL (all default / per-status / back to all)", async () => {
    (customFetch as unknown as Mock).mockResolvedValue([PENDING_ROW]);

    renderPage();

    // No ?status= on mount → the «الكل» default: the unfiltered fetch.
    await waitFor(() => {
      expect(screen.getByText(PENDING_ROW.user_phone)).toBeInTheDocument();
    });
    expect(listUrls().some((url) => !url.includes("status="))).toBe(true);

    // «قيد الانتظار» sends its own filter — the per-tab query key
    // restarts at page 1 with the server-side head.
    fireEvent.click(statusTab("قيد الانتظار"));
    await waitFor(() => {
      expect(listUrls().some((url) => url.includes("status=pending"))).toBe(true);
    });

    // Each status tab sends its own filter.
    fireEvent.click(statusTab("مرفوض"));
    await waitFor(() => {
      expect(listUrls().some((url) => url.includes("status=rejected"))).toBe(true);
    });
  });

  it("the pending tab shows the server-filtered head even when the all-tab window is all approved", async () => {
    (customFetch as unknown as Mock).mockImplementation((url: string) =>
      // The status-filtered endpoint answers with the pending head;
      // the unfiltered one returns the newest 100 approved rows (the
      // exact window that used to force a false «لا توجد طلبات قيد
      // الانتظار» on the client-filtered pending tab).
      String(url).includes("status=pending")
        ? Promise.resolve([PENDING_ROW])
        : Promise.resolve(APPROVED_PAGE),
    );

    renderPage();

    // The all-tab loads its approved window first…
    await waitFor(() => {
      expect(screen.getByText(APPROVED_PAGE[0].user_phone)).toBeInTheDocument();
    });

    // …then the pending tab surfaces the pending row straight from
    // the server-filtered head — no false-empty, no dependency on
    // load-more reaching the page that holds it.
    fireEvent.click(statusTab("قيد الانتظار"));
    await waitFor(() => {
      expect(screen.getByText(PENDING_ROW.user_phone)).toBeInTheDocument();
    });
    expect(screen.queryByText("لا توجد طلبات قيد الانتظار")).not.toBeInTheDocument();
    // The all-tab's approved rows are NOT in the pending window.
    expect(screen.queryByText(APPROVED_PAGE[0].user_phone)).not.toBeInTheDocument();
  });

  it("the hard pending-empty only renders when the server-filtered page is genuinely empty", async () => {
    (customFetch as unknown as Mock).mockImplementation((url: string) =>
      String(url).includes("status=pending") ? Promise.resolve([]) : Promise.resolve(APPROVED_PAGE),
    );

    renderPage();

    // The all-tab window loads first (100 approved rows)…
    await waitFor(() => {
      expect(screen.getByText(APPROVED_PAGE[0].user_phone)).toBeInTheDocument();
    });

    // …then the pending tab asks the server: zero pending rows — the
    // empty claim is now the SERVER's truth, not a client-filter
    // artifact over a partial window.
    fireEvent.click(statusTab("قيد الانتظار"));
    await waitFor(() => {
      expect(screen.getByText("لا توجد طلبات قيد الانتظار")).toBeInTheDocument();
    });
    // …and no load-more is offered over an empty server-filtered page
    // (a short page is the definite end).
    expect(screen.queryByRole("button", { name: /تحميل المزيد/ })).not.toBeInTheDocument();
  });

  it("tab counts stay honest — only the ACTIVE tab shows a count (A1-10)", async () => {
    // The all-tab holds a full page of approved rows; the pending head
    // holds one pending row.
    (customFetch as unknown as Mock).mockImplementation((url: string) =>
      String(url).includes("status=pending")
        ? Promise.resolve([PENDING_ROW])
        : Promise.resolve(APPROVED_PAGE),
    );

    renderPage();

    // Wait for the all-tab window to land (the tabs render before the
    // query resolves — the count arrives with the rows).
    await waitFor(() => {
      expect(screen.getByText(APPROVED_PAGE[0].user_phone)).toBeInTheDocument();
    });

    // The all-tab is active: its chip carries the loaded-window count
    // (100); the INACTIVE tabs carry no count — the loaded window
    // cannot speak for their statuses, and an accidental 0 was the
    // false-count half of the finding.
    expect(statusTab("الكل").textContent).toContain("100");
    expect(statusTab("قيد الانتظار").textContent?.trim()).toBe("قيد الانتظار");
    expect(statusTab("موافق عليه").textContent?.trim()).toBe("موافق عليه");
    expect(statusTab("مرفوض").textContent?.trim()).toBe("مرفوض");

    // Flipping to the pending tab flips whose count is claimable: the
    // server-filtered head's live count (1) — the all-tab's count is
    // no longer in this window, so it stops claiming one.
    fireEvent.click(statusTab("قيد الانتظار"));
    await waitFor(() => {
      expect(screen.getByText(PENDING_ROW.user_phone)).toBeInTheDocument();
    });
    expect(statusTab("قيد الانتظار").textContent).toContain("1");
    expect(statusTab("الكل").textContent?.trim()).toBe("الكل");
  });
});
