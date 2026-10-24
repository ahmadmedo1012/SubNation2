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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminPromotionsPage from "@/pages/admin/promotions";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token", hasAdminPermission: () => true }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
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
  // R186 (C-F8): the list rides useQuery now — a fresh client per render
  // (retry: false) per the page-test convention.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminPromotionsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminPromotionsPage — create-form field guards render INLINE, not as toasts (R158 admin polish)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    // Page load succeeds with one stopped sale (the create CTA is
    // enabled — no active sale).
    fetchMock.mockImplementation(async () => resLike({ body: { flash_sales: [STOPPED_SALE] } }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** datetime-local value helper (local wall-clock format). */
  const localDateTime = (offsetMs: number): string => {
    const d = new Date(Date.now() + offsetMs);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  async function openCreateForm() {
    fireEvent.click(await screen.findByRole("button", { name: "إنشاء عرض" }));
    expect(await screen.findByText("إنشاء عرض جديد")).toBeInTheDocument();
  }

  it("the 0–95 discount guard surfaces under its field (role=alert), never as a toast; no POST fires", async () => {
    renderPage();
    await openCreateForm();

    fireEvent.change(screen.getByLabelText("نسبة الخصم (%)"), { target: { value: "99" } });
    fireEvent.change(screen.getByLabelText("ينتهي في"), {
      target: { value: localDateTime(60 * 60 * 1000) },
    });
    // Submit the FORM directly — the number input's own max="95" makes
    // an out-of-range value HTML-invalid, so a button-click submit is
    // blocked by constraint validation before the page's JS backstop
    // ever runs (the guard exists for browsers/paths that skip it;
    // this is how we exercise it in jsdom).
    const form = screen.getByText("إنشاء عرض جديد").closest("form")!;
    fireEvent.submit(form);

    // The inline field error (the coupons valueError idiom — R158)…
    expect(await screen.findByText("نسبة الخصم بين 0 و 95.")).toBeInTheDocument();
    expect(screen.getByText("نسبة الخصم بين 0 و 95.")).toHaveAttribute("role", "alert");
    // …NOT a toast, and the create POST never fired.
    expect(toastMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST"),
    ).toHaveLength(0);
  });

  it("the ends-at guard surfaces under its field; editing the field clears the stale error", async () => {
    renderPage();
    await openCreateForm();

    // Valid discount, but a PAST expiry — the 5-minute floor trips.
    fireEvent.change(screen.getByLabelText("نسبة الخصم (%)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("ينتهي في"), {
      target: { value: localDateTime(-24 * 60 * 60 * 1000) },
    });
    const form = screen.getByText("إنشاء عرض جديد").closest("form")!;
    fireEvent.submit(form);

    expect(
      await screen.findByText("وقت الانتهاء يجب أن يكون بعد 5 دقائق على الأقل."),
    ).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST"),
    ).toHaveLength(0);

    // Any edit to the guarded field clears the stale error
    // (re-validated on the next submit — the coupons idiom).
    fireEvent.change(screen.getByLabelText("ينتهي في"), {
      target: { value: localDateTime(24 * 60 * 60 * 1000) },
    });
    await waitFor(() =>
      expect(
        screen.queryByText("وقت الانتهاء يجب أن يكون بعد 5 دقائق على الأقل."),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("AdminPromotionsPage — a failed load is an error toast, not a fake-clean history (A2 P2-9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an error envelope surfaces the Arabic failure card and NEVER renders the empty state (R186 C-F8: the query error state)", async () => {
    fetchMock.mockResolvedValue(
      resLike({ ok: false, status: 500, body: { error: "خطأ في الخادم" } }),
    );

    renderPage();

    // The outage is NOT presented as a clean, empty promotions history —
    // the 94-C2 (A2 P2-9) error card renders with the server's own
    // Arabic message (R186 C-F8: the load-error toast retired with the
    // hand-rolled loader — a 5-min poll failure would re-toast forever;
    // the card + its retry carry the recovery).
    expect(await screen.findByText("خطأ في الخادم")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("لا توجد عروض بعد")).not.toBeInTheDocument());
    expect(screen.queryByText("عرض الجمعة")).not.toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
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

  it("R186 (C-F9): the confirm composes ONE direction word — «وينتهي خلال ساعتين», never the doubled «حتى خلال»", async () => {
    // A sale ending exactly 2 hours out: formatRelativeTime's own
    // output carries the direction («خلال ساعتين»), so the sentence
    // must compose «وينتهي …» — the old copy prefixed «حتى …» and read
    // «فورًا حتى خلال ساعتين» (a doubled preposition, the 93-C6/F-06
    // class this helper's other consumers already killed).
    const endingSoon = {
      ...STOPPED_SALE,
      ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    };
    fetchMock.mockImplementation(async () => resLike({ body: { flash_sales: [endingSoon] } }));

    renderPage();
    const dialog = await openActivateConfirm();
    const description = within(dialog).getByText(/ينتهي/).textContent ?? "";
    expect(description).toMatch(/وينتهي خلال ساعتين\./);
    expect(description).not.toMatch(/حتى خلال/);
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

  it("while the activation PATCH is in flight, the row's actions disable — a double-click cannot re-fire it (R147 2-c D3)", async () => {
    // Park the PATCH on a gate the test releases — the store-repricing
    // request is exactly the double-click race the coupons.tsx per-row
    // busy idiom exists for; the row's activate + delete buttons must
    // disable for that window.
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "PATCH"
        ? gate.then(() => resLike({ body: {} }))
        : Promise.resolve(resLike({ body: { flash_sales: [STOPPED_SALE] } })),
    );

    renderPage();
    const dialog = await openActivateConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "تفعيل" }));

    // In-flight: the confirm dialog is gone and the ROW's «تفعيل» (the
    // only one left) is disabled…
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "تفعيل" })).toBeDisabled();
    });
    // …alongside its destructive sibling.
    expect(screen.getByRole("button", { name: "حذف العرض «عرض الجمعة» نهائياً" })).toBeDisabled();

    // Release the PATCH — exactly ONE fired, then the success toast.
    release();
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تم التفعيل", variant: "success" }),
      );
    });
    const patches = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patches).toHaveLength(1);
  });

  it("an HTTP-prefixed rejection surfaces the server's Arabic suffix — never the English HTTP noise (R148 3-errcopy)", async () => {
    // A gateway/customFetch-shaped rejection ("HTTP <status> <text>:
    // <server message>") — the catch's old raw extractor rendered it
    // verbatim into the Arabic toast (the R96 96-F7 leak class).
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "PATCH"
        ? Promise.reject(new Error("HTTP 400 Bad Request: لا يمكن تفعيل عرضين نشطين في نفس الوقت"))
        : Promise.resolve(resLike({ body: { flash_sales: [STOPPED_SALE] } })),
    );

    renderPage();
    const dialog = await openActivateConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "تفعيل" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("تعذّر التحديث");
    // The server's own Arabic wording survives…
    expect(toastArg.description).toBe("لا يمكن تفعيل عرضين نشطين في نفس الوقت");
    // …and the technical English prefix never lands in the toast.
    expect(String(toastArg.description)).not.toMatch(/^HTTP/);
    expect(String(toastArg.description)).not.toContain("Bad Request");
    expect(toastArg.variant).toBe("destructive");
  });
});
