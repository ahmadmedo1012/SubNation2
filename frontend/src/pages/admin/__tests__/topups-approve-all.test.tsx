/**
 * B5-01 (round-92 audit) — topups `approveAll` guard tests.
 *
 * `approveAll` previously ran its sequential money loop with no busy
 * state: the "موافقة الكل" button stayed enabled (a double-click started
 * TWO parallel loops, each minting fresh Idempotency-Keys), the
 * confirmation was a raw `window.confirm`, a 50-item queue had zero UI
 * feedback, and failures were reported as bare counts. These tests pin:
 *
 *   1. The raw window.confirm is gone — the file's BulkConfirmModal
 *      opens instead (a11y-complete, RTL-styled).
 *   2. While the loop runs, the confirm + trigger buttons are disabled
 *      and hammering them fires no second loop (double-loop prevention).
 *   3. A live "جاري done/total..." progress counter renders.
 *   4. Mixed results produce ONE summary toast: X نجحت / Y فشلت with
 *      per-item failure reasons (#id: reason).
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell
 * (`@/pages/admin/layout`) and the toast hook are mocked at the module
 * boundary — the vitest config's documented pattern for page-level
 * component tests (see src/pages/__tests__/orders-error-state.test.tsx).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminTopupsPage from "@/pages/admin/topups";
import { useListAdminTopups } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListAdminTopups: vi.fn(),
  getListAdminTopupsQueryKey: () => ["admin-topups"],
  approveTopup: vi.fn(),
  rejectTopup: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

// The admin shell (sidebar / socket / copilot) is out of scope for
// page-level tests — stub it to a passthrough.
vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

type TopupsResult = ReturnType<typeof useListAdminTopups>;

const PENDING = [
  {
    id: 11,
    amount: 50,
    status: "pending",
    user_phone: "0911111111",
    payment_method: "mobile_transfer",
    created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    id: 12,
    amount: 75,
    status: "pending",
    user_phone: "0912222222",
    payment_method: "mobile_transfer",
    created_at: "2026-09-01T11:00:00.000Z",
  },
  {
    id: 13,
    amount: 100,
    status: "pending",
    user_phone: "0913333333",
    payment_method: "mobile_transfer",
    created_at: "2026-09-01T12:00:00.000Z",
  },
];

function mockTopupsResult(data: unknown[]) {
  (useListAdminTopups as unknown as Mock).mockReturnValue({
    data,
    isLoading: false,
    refetch: vi.fn(),
  } as unknown as TopupsResult);
}

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

/** The BulkConfirmModal overlay — scoped so the modal's "موافقة" button
 *  stays distinguishable from the per-row approve buttons of the same
 *  accessible name. */
function bulkDialog() {
  const overlay = screen.getByText("تأكيد الموافقة الجماعية").closest("div.fixed");
  if (!overlay) throw new Error("bulk confirm modal not rendered");
  return within(overlay as HTMLElement);
}

describe("AdminTopupsPage — approveAll money loop is guarded + observable (B5-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTopupsResult(PENDING);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { clipboard?: unknown }).clipboard;
    delete (window as { isSecureContext?: unknown }).isSecureContext;
  });

  it("replaces the raw window.confirm with the styled BulkConfirmModal", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    fetchMock.mockResolvedValue(resLike());

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /موافقة الكل/ }));

    // The styled modal opened with the pending count — not the native dialog.
    expect(bulkDialog().getByText("3 طلب سيتم معالجته")).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("busy state blocks re-click (no second parallel loop) and renders live progress", async () => {
    // Gate items 11 + 12 so the loop is observably paused mid-flight.
    const gate11 = deferred<Response>();
    const gate12 = deferred<Response>();
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/topups/11/approve")) return gate11.promise;
      if (url.includes("/api/admin/topups/12/approve")) return gate12.promise;
      return resLike({ ok: true });
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /موافقة الكل/ }));
    fireEvent.click(bulkDialog().getByRole("button", { name: "موافقة" }));

    // The first loop item is in flight: exactly ONE approve request.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Busy: the modal confirm AND the header trigger are disabled…
    const busyButtons = screen.getAllByRole("button", { name: /جاري 0\/3/ });
    expect(busyButtons).toHaveLength(2);
    for (const btn of busyButtons) expect(btn).toBeDisabled();

    // …and hammering them again starts no second loop.
    for (const btn of busyButtons) fireEvent.click(btn);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Live progress counter renders (modal subtitle/button + trigger).
    expect(screen.getAllByText("جاري 0/3...").length).toBeGreaterThan(0);

    gate11.resolve(resLike({ ok: true }));
    await waitFor(() => expect(screen.getAllByText("جاري 1/3...").length).toBeGreaterThan(0));
    gate12.resolve(resLike({ ok: true }));

    // Loop completes → single summary toast.
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("summarizes mixed results in ONE toast: X نجحت / Y فشلت + per-item reasons", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/topups/13/approve")) {
        return resLike({ ok: false, status: 409, body: { error: "الطلب قيد المعالجة" } });
      }
      return resLike({ ok: true });
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /موافقة الكل/ }));
    fireEvent.click(bulkDialog().getByRole("button", { name: "موافقة" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("✓ تمت الموافقة على 2 من 3 طلب");
    expect(toastArg.description).toContain("نجحت 2");
    expect(toastArg.description).toContain("فشلت 1");
    // Which topup failed, and why (the per-item failure collection).
    expect(toastArg.description).toContain("#13");
    expect(toastArg.description).toContain("الطلب قيد المعالجة");
    expect(toastArg.variant).toBe("destructive");
  });

  it("a full-success run gets a single success summary toast", async () => {
    fetchMock.mockResolvedValue(resLike({ ok: true }));

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /موافقة الكل/ }));
    fireEvent.click(bulkDialog().getByRole("button", { name: "موافقة" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0].title).toBe("✓ تمت الموافقة على 3 طلب");
    expect(toastMock.mock.calls[0][0].variant).toBe("success");
    // Exactly one summary toast — not one per item, not a second error toast.
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("CopyButton routes through the shared clipboard helper: failures surface, not swallow (B6)", async () => {
    fetchMock.mockResolvedValue(resLike({ ok: true, body: [] }));
    renderPage();

    // Clipboard API present but DENIES the write. The previous raw
    // `navigator.clipboard.writeText(text).catch(() => {})` swallowed
    // this rejection and still flipped to the "copied" check icon.
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const copyBtn = screen.getAllByRole("button", { name: "نسخ" })[0];
    fireEvent.click(copyBtn);

    // The shared helper was asked to write…
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("0911111111"));
    // …and its boolean result drives a failure state instead of a
    // false "copied" success.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "فشل النسخ" })).toBeInTheDocument(),
    );
  });
});
