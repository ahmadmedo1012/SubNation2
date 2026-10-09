/**
 * R115 (Part 11 + A1/A5) — the users edit dialog vs the derived-tier
 * contract (backend 6caa63b):
 *
 *   - loyalty_tier is NO LONGER EDITABLE: tiers derive strictly from
 *     net qualifying spend (computeTier on every purchase/refund would
 *     silently clobber any manual value). The dialog shows the CURRENT
 *     tier as read-only text with the derivation hint — the old
 *     override select (bronze/silver/gold/platinum) is gone entirely.
 *   - loyalty_points edits are MONEY (100:1 convertible): the field
 *     carries the dinar-value hint (points/100) and the note/scope
 *     contract.
 *   - If the backend 400s (e.g. a hypothetical tier edit, or any other
 *     guarded route message), the route's OWN Arabic wording is
 *     surfaced — not the generic code-map fallback.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (same pattern as
 * users-wallet-confirm.test.tsx).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminUsersPage from "@/pages/admin/users";
import { customFetch } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getListAdminUsersQueryKey: (params?: unknown) => ["/api/admin/users", params ?? null],
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    // R120-B4 (A2-F4): the wallet/points form is finance-gated —
    // default-grant keeps these tier tests scoped to their own concern.
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

const USER = {
  id: 16,
  phone: "0913456789",
  wallet_balance: 150,
  loyalty_points: 100,
  loyalty_tier: "bronze",
  order_count: 2,
  lifetime_spend: 200,
  created_at: "2026-08-01T10:00:00.000Z",
};

function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminUsersPage />
      </Router>
    </QueryClientProvider>,
  );
}

async function openEditModal() {
  // R123 (E3 P3b): the mobile edit button now carries the same
  // accessible name as its desktop twin — both render in jsdom (the
  // md:hidden/hid CSS classes do not unmount either), so scope by
  // all-matches and click the first (desktop) one.
  const editButtons = await screen.findAllByRole("button", { name: /تعديل المستخدم 0913456789/ });
  fireEvent.click(editButtons[0]);
  return screen.findByRole("dialog");
}

describe("AdminUsersPage — derived loyalty tier + points-as-money hints (R115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue([USER]);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the tier READ-ONLY with the derivation hint — no override select", async () => {
    renderPage();
    const dialog = await openEditModal();

    // The manual tier select is GONE: none of its options exist anywhere
    // in the dialog (the old TIERS list: برونزي/فضي/ذهبي/بلاتيني).
    const dialogSelects = within(dialog).queryAllByRole("combobox");
    expect(dialogSelects).toHaveLength(0);
    expect(within(dialog).queryByRole("option", { name: "ذهبي" })).not.toBeInTheDocument();

    // The current tier shows as read-only text + the derivation hint.
    // («المستوى»/«برونزي» each appear twice — the snapshot stat row and
    // this field — so anchor on the unique derivation hint and assert
    // its field carries the tier value.)
    const derivationHint = within(dialog).getByText(
      "مستوى مشتق من الإنفاق الصافي — لا يُعدّل يدويًا",
    );
    expect(derivationHint).toBeInTheDocument();
    const tierField = derivationHint.parentElement;
    expect(tierField?.textContent).toContain("برونزي");
    expect(within(dialog).getAllByText("برونزي").length).toBeGreaterThanOrEqual(2);
  });

  it("the points field carries the LYD-value hint (points/100)", async () => {
    renderPage();
    const dialog = await openEditModal();

    // 100 points pre-filled → 1.00 د.ل at the 100:1 conversion rate.
    const hint = within(dialog).getByText(/القيمة بالدينار:/);
    expect(hint.textContent).toContain("1.00 د.ل");
    expect(hint.textContent).toContain("كل 100 نقطة = 1 د.ل");
    expect(within(dialog).getByText(/صلاحية «المعاملات المالية»/)).toBeInTheDocument();

    // The hint follows the edited value (750 → 7.50 د.ل).
    const pointsInput = within(dialog).getByLabelText("نقاط الولاء");
    fireEvent.change(pointsInput, { target: { value: "750" } });
    expect(within(dialog).getByText(/القيمة بالدينار:/).textContent).toContain("7.50 د.ل");
  });

  it("surfaces the backend's OWN Arabic message when it 400s (e.g. the derived-tier rejection)", async () => {
    const TIER_400 =
      "مستوى الولاء مشتق تلقائياً من الإنفاق الصافي ولا يُعدّل يدوياً — عدّل الإنفاق أو راجع سياسة المستويات";
    fetchMock.mockResolvedValue(
      resLike({ ok: false, status: 400, body: { error: TIER_400, code: "INVALID_DATA" } }),
    );

    renderPage();
    const dialog = await openEditModal();

    // A points change + valid note → the points money-confirm (A2-5,
    // R126-L3) opens first; confirming it fires the PATCH, which the
    // backend rejects with its own Arabic wording.
    fireEvent.change(within(dialog).getByLabelText("نقاط الولاء"), {
      target: { value: "150" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText("سبب التعديل (3 أحرف على الأقل)"), {
      target: { value: "تسوية نقاط يدوية" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    const title = await screen.findByText("تأكيد تعديل النقاط");
    const confirmDialog = title.closest('[role="alertdialog"]') as HTMLElement;
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "تنفيذ التعديل" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // The route's specific Arabic wording surfaces — NOT the generic
    // INVALID_DATA code-map fallback.
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0].title).toBe("خطأ");
    expect(toastMock.mock.calls[0][0].description).toBe(TIER_400);
  });
});
