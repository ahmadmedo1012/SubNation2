/**
 * 94-C2 (A2 P2-9) — promotions page load-failure + activation-confirm
 * tests.
 *
 * Two defects pinned:
 *
 *   1. `load()` had no `r.ok` check — a 401/500 JSON envelope parsed
 *      fine, `flash_sales` was missing ⇒ `[]` ⇒ the «لا توجد عروض
 *      بعد» empty state masqueraded as a clean history during an
 *      outage. Now: guarded parse → Arabic error toast.
 *   2. ACTIVATING a flash sale repriced the WHOLE store with one
 *      unconfirmed tap, while «الإيقاف» (the harmless direction) HAD
 *      a confirm — the price-changing action was the unconfirmed one.
 *      Now activation confirms first, with the discount % in the
 *      message; cancel performs no PATCH.
 *
 * `@/lib/auth`, the admin shell and the toast hook are mocked at the
 * module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminPromotionsPage from "@/pages/admin/promotions";

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

/** An INACTIVE sale with a future end — the «تفعيل» row. */
const STOPPED_SALE = {
  id: 7,
  title: "عرض الجمعة",
  discount_percent: 30,
  ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  is_active: false,
  is_currently_active: false,
  created_at: "2026-09-01T10:00:00.000Z",
};

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

function renderPage() {
  return render(
    <Router>
      <AdminPromotionsPage />
    </Router>,
  );
}

describe("AdminPromotionsPage — a failed load is an error toast, not a fake-clean history (A2 P2-9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an error envelope toasts the Arabic failure and NEVER renders the empty state", async () => {
    fetchMock.mockResolvedValue(
      resLike({ ok: false, status: 500, body: { error: "خطأ في الخادم" } }),
    );

    renderPage();

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("تعذّر تحميل العروض");
    expect(String(toastArg.description)).toContain("خطأ في الخادم");
    expect(toastArg.variant).toBe("destructive");
    // The outage is NOT presented as a clean, empty promotions
    // history.
    await waitFor(() => expect(screen.queryByText("لا توجد عروض بعد")).not.toBeInTheDocument());
    expect(screen.queryByText("عرض الجمعة")).not.toBeInTheDocument();
  });
});

describe("AdminPromotionsPage — activating a store-wide discount requires confirmation (A2 P2-9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    // Page load succeeds with one stopped sale.
    fetchMock.mockImplementation(async () => resLike({ body: { flash_sales: [STOPPED_SALE] } }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openActivateConfirm() {
    const activate = await screen.findByRole("button", { name: "تفعيل" });
    fireEvent.click(activate);
    const title = await screen.findByText("تفعيل العرض على كامل المتجر؟");
    const dialog = title.closest('[role="alertdialog"]');
    if (!dialog) throw new Error("activate confirm dialog not rendered");
    return dialog as HTMLElement;
  }

  it("the confirm states the discount % before any request; cancel fires no PATCH", async () => {
    renderPage();

    const dialog = await openActivateConfirm();
    // The operator sees the magnitude of the global price change.
    expect(within(dialog).getByText(/خصم 30%/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));
    await waitFor(() =>
      expect(screen.queryByText("تفعيل العرض على كامل المتجر؟")).not.toBeInTheDocument(),
    );

    // Only the initial GET happened — no PATCH to /flash-sales/7.
    const patchCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCalls).toHaveLength(0);
  });

  it("confirming fires the activation PATCH with is_active:true", async () => {
    renderPage();

    const dialog = await openActivateConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "تفعيل" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch?.[0]).toBe("/api/admin/flash-sales/7");
      expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ is_active: true });
    });
  });
});
