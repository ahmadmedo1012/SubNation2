/**
 * R115 (Part 15 / A5 P1-1) + R181 — the pricing SETTINGS screen.
 *
 * The read-only profit/margin calculator simulator that used to share
 * this page was retired in R181 (with its POST /api/admin/pricing/calculate
 * endpoint); what remains is the REAL pricing system's operating surface:
 *
 *   1. The two-step recompute (A5 P1-1): «معاينة التغييرات» POSTs
 *      ?dry_run=true (ZERO writes — the destructive hook is NOT
 *      called), renders counts + the BEFORE→AFTER sample, and the
 *      destructive confirm then carries the preview counts.
 *   2. The max_total_discount_pct config input (policy 7): bounded
 *      10–95 with the same validation UX as rate/markup, rides the
 *      PUT body, and the one-line stacking explainer renders.
 *   3. R181 regression: the page renders NO simulator surface — no
 *      product/variant picker, no «إعادة الحساب», no risk badges —
 *      and the title is the settings title «إعدادات التسعير».
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell, the
 * toast hook and the confirm hook are mocked at the module boundary
 * (vitest-config pattern); the dry-run rides the stubbed global fetch.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminPricingPage from "@/pages/admin/pricing";

/**
 * Captured interactions with the mocked generated client + confirm
 * hook (vi.hoisted so the module factories can close over them).
 */
const h = vi.hoisted(() => {
  return {
    updateConfigBodies: [] as Array<Record<string, unknown>>,
    recomputeCalls: 0,
    confirmCalls: [] as Array<{
      title: string;
      description: string;
      destructive?: boolean;
    }>,
    confirmResult: true,
  };
});

vi.mock("@workspace/api-client-react", () => {
  const PRICING_CONFIG = {
    usd_to_lyd: 10,
    markup_percent: 100,
    max_total_discount_pct: 50,
  };
  return {
    getGetAdminPricingConfigQueryKey: () => ["/api/admin/pricing/config"],
    getListAdminProductsQueryKey: () => ["/api/admin/products"],
    useGetAdminPricingConfig: () => ({
      data: PRICING_CONFIG,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useUpdateAdminPricingConfig: ({
      mutation,
    }: {
      mutation?: { onSuccess?: (data: unknown) => void };
    }) => ({
      isPending: false,
      mutate: (vars: { data: Record<string, unknown> }) => {
        h.updateConfigBodies.push(vars.data);
        mutation?.onSuccess?.({ ...PRICING_CONFIG, ...vars.data });
      },
    }),
    useRecomputeCatalogPrices: ({
      mutation,
    }: {
      mutation?: { onSuccess?: (data: unknown) => void };
    }) => ({
      isPending: false,
      mutate: () => {
        h.recomputeCalls += 1;
        mutation?.onSuccess?.({
          variants_updated: 3,
          products_updated: 2,
          usd_to_lyd: 10,
          markup_percent: 100,
        });
      },
    }),
    setUnauthorizedHandler: vi.fn(),
  };
});

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

vi.mock("@/hooks/useConfirm", () => ({
  useConfirm: () => ({
    confirm: async (opts: { title: string; description: string; destructive?: boolean }) => {
      h.confirmCalls.push(opts);
      return h.confirmResult;
    },
    ConfirmDialog: () => null,
  }),
}));

// ── the dry-run payload (vi.mock factories may only close over hoisted
// state) ────────────────────────────────────────────────────────────────

const DRY_RUN = {
  dry_run: true,
  variants_drifted: 3,
  products_affected: 2,
  sample: [
    { variant_id: 11, product_id: 1, price_before: 100, price_after: 110, delta: 10 },
    { variant_id: 27, product_id: 3, price_before: 200, price_after: 190, delta: -10 },
  ],
  usd_to_lyd: 10,
  markup_percent: 100,
  note: "معاينة فقط — لم يُعدّل أي سعر.",
};

/** Minimal Response-like object. */
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
        <AdminPricingPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminPricingPage — the two-step recompute (A5 P1-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateConfigBodies = [];
    h.recomputeCalls = 0;
    h.confirmCalls = [];
    h.confirmResult = true;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("«معاينة التغييرات» is a ZERO-WRITE dry run that renders counts + the BEFORE→AFTER sample", async () => {
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/pricing/recompute")) {
        return Promise.resolve(resLike({ body: DRY_RUN }));
      }
      return Promise.resolve(resLike({ body: {} }));
    });

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "معاينة التغييرات" }));

    // The dry-run contract: POST + ?dry_run=true.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/pricing/recompute?dry_run=true");
    expect(init.method).toBe("POST");

    // The preview card: counts + the sample rows + the backend note.
    expect(await screen.findByText("معاينة إعادة الاحتساب")).toBeInTheDocument();
    expect(screen.getByText("باقة سينحرف سعرها")).toBeInTheDocument();
    expect(screen.getByText("منتجًا يتأثر")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("110.00 د.ل")).toBeInTheDocument();
    expect(within(table).getByText("100.00 د.ل")).toBeInTheDocument();
    expect(within(table).getByText("+10.00 د.ل")).toBeInTheDocument();
    expect(within(table).getByText("-10.00 د.ل")).toBeInTheDocument();
    // The backend note rides the preview (the header's «معاينة فقط…»
    // sub-label also matches the prefix — at least one occurrence).
    expect(screen.getAllByText(/معاينة فقط — لم يُعدّل أي سعر/).length).toBeGreaterThan(0);

    // ZERO writes: the destructive hook was NOT called by the preview.
    expect(h.recomputeCalls).toBe(0);
  });

  it("the destructive confirm carries the preview counts; approving fires the real recompute", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(resLike({ body: DRY_RUN })));

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "معاينة التغييرات" }));
    await screen.findByText("معاينة إعادة الاحتساب");

    // Step 2: the existing destructive confirm — now preview-armed.
    fireEvent.click(screen.getByRole("button", { name: "إعادة احتساب أسعار الكتالوج" }));
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    const confirm = h.confirmCalls[0];
    expect(confirm.title).toBe("إعادة احتساب أسعار الكتالوج؟");
    expect(confirm.destructive).toBe(true);
    expect(confirm.description).toContain("المعاينة: 3 باقة ستنحرف عبر 2 منتجات");
    expect(confirm.description).toContain("لا يمكن التراجع بعد التنفيذ");

    // Approved → the REAL recompute hook fires (once).
    await waitFor(() => expect(h.recomputeCalls).toBe(1));
  });

  it("a failed dry run surfaces the error and renders NO preview card", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        resLike({ ok: false, status: 500, body: { error: "خطأ في الخادم", code: "INTERNAL" } }),
      ),
    );

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "معاينة التغييرات" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0].title).toBe("تعذّرت المعاينة");
    expect(screen.queryByText("معاينة إعادة الاحتساب")).not.toBeInTheDocument();
    expect(h.recomputeCalls).toBe(0);
  });
});

describe("AdminPricingPage — max_total_discount_pct config (policy 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateConfigBodies = [];
    h.recomputeCalls = 0;
    h.confirmCalls = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the seeded cap input with the one-line stacking explainer", () => {
    renderPage();

    const capInput = screen.getByLabelText("سقف الخصم المجمّع (%)");
    expect((capInput as HTMLInputElement).value).toBe("50");
    expect(
      screen.getByText("سقف الخصم المجمّع (تخفيضات + كوبون) — 50% = خط التعادل عند هامش 100%"),
    ).toBeInTheDocument();
  });

  it("rejects out-of-bounds values (10–95) and blocks the save — same UX as rate/markup", () => {
    renderPage();

    const capInput = screen.getByLabelText("سقف الخصم المجمّع (%)");
    const save = screen.getByRole("button", { name: "حفظ الإعدادات" });
    // Seeded = effective → not dirty → save disabled.
    expect(save).toBeDisabled();

    fireEvent.change(capInput, { target: { value: "5" } });
    expect(screen.getByRole("alert").textContent).toBe("سقف الخصم يجب أن يكون بين 10 و 95");
    expect(save).toBeDisabled();

    fireEvent.change(capInput, { target: { value: "99" } });
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(save).toBeDisabled();

    // A valid cap change re-opens the save and rides the PUT body.
    fireEvent.change(capInput, { target: { value: "60" } });
    expect(screen.queryByText("سقف الخصم يجب أن يكون بين 10 و 95")).not.toBeInTheDocument();
    expect(save).toBeEnabled();
    fireEvent.click(save);

    expect(h.updateConfigBodies).toHaveLength(1);
    expect(h.updateConfigBodies[0]).toMatchObject({
      usd_to_lyd: 10,
      markup_percent: 100,
      max_total_discount_pct: 60,
    });
  });
});

describe("AdminPricingPage — R181: the calculator simulator is gone, the settings remain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateConfigBodies = [];
    h.recomputeCalls = 0;
    h.confirmCalls = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the settings title + the real config card, and NO simulator affordance", () => {
    renderPage();

    // The settings screen identity.
    expect(screen.getByRole("heading", { name: "إعدادات التسعير" })).toBeInTheDocument();
    expect(screen.getByText("إعدادات التسعير العامة")).toBeInTheDocument();

    // The simulator's surfaces are all gone: no manual recalc button,
    // no product/variant picker, no custom sandbox inputs, no coupon
    // code field, no referred-buyer toggle, no outputs card.
    expect(screen.queryByRole("button", { name: "إعادة الحساب" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/منتج/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/سعر مخصص|السعر المخصص/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/كوبون|كود الكوبون/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/مُحال|مشتري مُحال/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/حالة الربح|هامش الربح|أسوأ حالة|حدود الأمان/),
    ).not.toBeInTheDocument();
    // No calculate call ever fires on this page anymore.
    const calculateCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/api/admin/pricing/calculate"),
    );
    expect(calculateCalls).toHaveLength(0);
  });
});
