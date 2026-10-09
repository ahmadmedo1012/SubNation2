/**
 * R122 (A2-P2) — topups BulkConfirmModal note field.
 *
 * The bulk approve/reject loops stamped every row with the boilerplate
 * «تمت الموافقة الجماعية»/«مرفوض جماعياً» while the single-reject modal
 * had a real note field — the audit trail the note column and the
 * ledgers carry lost the operator's reasoning for every bulk action.
 * The modal now carries the same optional note input (RejectModal's
 * field), threaded into both money loops. These tests pin:
 *
 *   1. A typed note rides EVERY row's POST body (approveAll loop).
 *   2. An empty note keeps the old boilerplate fallback — the ledger
 *      always carries some reason (optional, never blank).
 *
 * Module mocks follow topups-approve-all.test.tsx (the same surface).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminTopupsPage from "@/pages/admin/topups";
import { approveTopup, customFetch } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getListAdminTopupsQueryKey: () => ["admin-topups"],
  approveTopup: vi.fn(),
  rejectTopup: vi.fn(),
  // 93-C6: useAdminHeaders registers the global 401 observer through
  // this export — the mock must carry the module surface the page
  // graph imports.
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
    id: 21,
    amount: 50,
    status: "pending",
    user_phone: "0911111111",
    payment_method: "mobile_transfer",
    created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    id: 22,
    amount: 75,
    status: "pending",
    user_phone: "0912222222",
    payment_method: "mobile_transfer",
    created_at: "2026-09-01T11:00:00.000Z",
  },
];

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
        <AdminTopupsPage />
      </Router>
    </QueryClientProvider>,
  );
}

/** The BulkConfirmModal overlay scope (topups-approve-all.test.tsx idiom). */
function bulkDialog() {
  const overlay = screen.getByText("تأكيد الموافقة الجماعية").closest("div.fixed");
  if (!overlay) throw new Error("bulk confirm modal not rendered");
  return within(overlay as HTMLElement);
}

describe("AdminTopupsPage — BulkConfirmModal note rides the money loop (R122 A2-P2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue(PENDING);
    // R127-L1 (B1 §3.2): the approveAll loop rides the generated
    // approveTopup fetcher — the body assertions moved to the fetcher
    // mock's call surface (id, {admin_note}, options).
    (approveTopup as unknown as Mock).mockResolvedValue({ success: true });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(resLike());
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a typed note rides EVERY approve row's admin_note body", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /موافقة الكل/ }));
    // The optional note field (labelled, per the modal's a11y contract).
    const noteField = bulkDialog().getByLabelText(/سبب المعالجة الجماعية/);
    fireEvent.change(noteField, { target: { value: "مطابقة كشف حسابات المساء" } });
    fireEvent.click(bulkDialog().getByRole("button", { name: "موافقة" }));

    await waitFor(() => expect(approveTopup).toHaveBeenCalledTimes(2));
    for (const call of (approveTopup as unknown as Mock).mock.calls) {
      const [id, body] = call as [number, { admin_note?: string }, unknown];
      expect([21, 22]).toContain(id);
      expect(body.admin_note).toBe("مطابقة كشف حسابات المساء");
    }
    // R127-L1 (B1 §3.2 + A4 B-13): the per-item Idempotency-Key pin —
    // one FRESH key per row (F-008), never one key for the whole bulk
    // (the backend dedupe is per-(admin, route, key); a shared key
    // would let only the first call commit).
    const keys = (approveTopup as unknown as Mock).mock.calls.map(
      (call) =>
        ((call[2] as { headers?: Record<string, string> } | undefined)?.headers ?? {})[
          "Idempotency-Key"
        ],
    );
    expect(keys).toHaveLength(2);
    expect(keys.every((k: unknown) => typeof k === "string" && k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(2); // distinct per row
  });

  it("an empty note keeps the boilerplate fallback (the ledger never goes blank)", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /موافقة الكل/ }));
    // Leave the optional field untouched.
    fireEvent.click(bulkDialog().getByRole("button", { name: "موافقة" }));

    await waitFor(() => expect(approveTopup).toHaveBeenCalledTimes(2));
    for (const call of (approveTopup as unknown as Mock).mock.calls) {
      const [, body] = call as [number, { admin_note?: string }, unknown];
      expect(body.admin_note).toBe("تمت الموافقة الجماعية");
    }
  });
});
