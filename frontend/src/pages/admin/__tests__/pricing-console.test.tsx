/**
 * R115 (Part 15 / A5) — the pricing page as an ECONOMICS CONSOLE.
 *
 * Behaviors pinned:
 *
 *   1. Variant-aware calculator (Part 13): a product selection offers
 *      the product's variant rows; picking one sends `variant_id` (the
 *      sellable unit checkout charges), while the auto default sends
 *      `product_id` (cheapest active variant).
 *   2. Risk states render WITH their WHY — the badge (آمن / تحت
 *      المراقبة / هامش ضعيف / خسارة) plus the backend's own Arabic
 *      warning text, never a bare color. The worst-case block, the
 *      guardrails block and the applied-config line (incl. the
 *      discount cap) all render from the API response.
 *   3. The two-step recompute (A5 P1-1): «معاينة التغييرات» POSTs
 *      ?dry_run=true (ZERO writes — the destructive hook is NOT
 *      called), renders counts + the BEFORE→AFTER sample, and the
 *      destructive confirm then carries the preview counts.
 *   4. The max_total_discount_pct config input (policy 7): bounded
 *      10–95 with the same validation UX as rate/markup, rides the
 *      PUT body, and the one-line stacking explainer renders.
 *   5. The referred-buyer hint uses result.referral_cost values from
 *      the API — the frozen «5 د.ل … + 0.50» constant is gone; before
 *      the first calculation the hint describes the mechanics without
 *      inventing numbers.
 *   6. R126-L3 (A2-9): a FAILED recalculation keeps the last successful
 *      result standing with a role="alert" stale-marker banner — the
 *      old `setResult(null)` collapsed the outputs card to the false
 *      «أدخل سعراً…» placeholder as if no calculation ever ran.
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
  const REFERRAL_COST = {
    welcome_bonus_lyd: 5,
    referrer_points: 50,
    referrer_lyd_value: 0.5,
    total_referral_cost_lyd: 5.5,
  };
  const CALC_RESPONSE_SAFE = {
    inputs: {
      product_id: 1,
      product_name: "Netflix",
      variant_id: 11,
      variant_label: "أساسي — شهر",
      price_source: "variant",
      list_price: 100,
      cost_price: 50,
      cost_usd: 5,
      coupon_code: null,
      simulate_referred: false,
    },
    config: { usd_to_lyd: 10, markup_percent: 100, max_total_discount_pct: 50 },
    flash_sale: null,
    coupon: null,
    pricing: { list_price: 100, base_price: 100, discount_amount: 0, final_price: 100 },
    loyalty: { points_earned: 100, lyd_accrued: 1, points_per_lyd: 100 },
    referral_cost: REFERRAL_COST,
    margins: {
      gross_lyd: 50,
      gross_pct: 50,
      net_lyd: 49,
      net_pct: 49,
      referral_adjusted_lyd: null,
      referral_adjusted_pct: null,
    },
    worst_case: {
      combined_discount_pct: 50,
      price: 50,
      gross_lyd: 0,
      contribution_lyd: -0.5,
      referred_contribution_lyd: -6,
    },
    guardrails: {
      break_even_price: 50,
      safe_min_price_incl_program: 55.56,
      max_safe_discount_pct: 50,
    },
    risk_state: "SAFE",
    warnings: [],
  };
  const CALC_RESPONSE_LOSS = {
    ...CALC_RESPONSE_SAFE,
    inputs: { ...CALC_RESPONSE_SAFE.inputs, variant_id: 12, variant_label: "بريميوم — 3 أشهر" },
    pricing: { list_price: 240, base_price: 240, discount_amount: 0, final_price: 240 },
    margins: {
      gross_lyd: -20,
      gross_pct: -8.33,
      net_lyd: -21,
      net_pct: -8.75,
      referral_adjusted_lyd: null,
      referral_adjusted_pct: null,
    },
    worst_case: {
      combined_discount_pct: 50,
      price: 120,
      gross_lyd: -140,
      contribution_lyd: -141,
      referred_contribution_lyd: -146.5,
    },
    guardrails: {
      break_even_price: 260,
      safe_min_price_incl_program: 288.89,
      max_safe_discount_pct: -8.3,
    },
    risk_state: "LOSS",
    warnings: [
      {
        severity: "loss",
        code: "loss_on_transaction",
        message_ar: "خسارة مباشرة: ستبيع بأقل من سعر التكلفة بمقدار 20.00 د.ل.",
      },
    ],
  };
  return {
    safeResponse: CALC_RESPONSE_SAFE,
    lossResponse: CALC_RESPONSE_LOSS,
    calcBodies: [] as Array<Record<string, unknown>>,
    calcResponse: null as unknown,
    calcError: null as unknown,
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
    useListAdminProducts: () => ({
      data: [
        {
          id: 1,
          name: "Netflix",
          price: 100,
          cost_price: null,
          category: "streaming",
          is_active: true,
          is_archived: false,
          stock_count: 5,
          order_count: 2,
          created_at: "2026-08-01T10:00:00.000Z",
          variants: [
            {
              id: 11,
              product_id: 1,
              plan_label: "أساسي",
              duration_label: "شهر",
              duration_days: 30,
              cost_price: 5,
              price_lyd: 100,
              is_active: true,
              sort_order: 0,
            },
            {
              id: 12,
              product_id: 1,
              plan_label: "بريميوم",
              duration_label: "3 أشهر",
              duration_days: 90,
              cost_price: 12,
              price_lyd: 240,
              is_active: false,
              sort_order: 1,
            },
          ],
        },
      ],
    }),
    useAdminPricingCalculate: ({
      mutation,
    }: {
      mutation?: { onSuccess?: (data: unknown) => void; onError?: (err: unknown) => void };
    }) => ({
      isPending: false,
      mutate: (vars: { data: Record<string, unknown> }) => {
        h.calcBodies.push(vars.data);
        if (h.calcError) {
          mutation?.onError?.(h.calcError);
          return;
        }
        mutation?.onSuccess?.(h.calcResponse ?? h.safeResponse);
      },
      // R125-I3: calculate() rides mutateAsync (the seq race-guard
      // refactor needs the response VALUE, not just the callback) — the
      // mock must honor both shapes.
      mutateAsync: async (vars: { data: Record<string, unknown> }) => {
        h.calcBodies.push(vars.data);
        if (h.calcError) throw h.calcError;
        return h.calcResponse ?? h.safeResponse;
      },
    }),
    setUnauthorizedHandler: vi.fn(),
  };
});

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

vi.mock("@/hooks/use-confirm", () => ({
  useConfirm: () => ({
    confirm: async (opts: { title: string; description: string; destructive?: boolean }) => {
      h.confirmCalls.push(opts);
      return h.confirmResult;
    },
    ConfirmDialog: () => null,
  }),
}));

// ── the dry-run payload (the calculator responses live in the hoisted
// `h` block above — vi.mock factories may only close over hoisted
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

/** Fires a manual calculate (the debounced auto-calc also works, but the
 *  button makes the intent explicit and the body deterministic). */
async function calculateNow() {
  fireEvent.click(screen.getByRole("button", { name: "إعادة الحساب" }));
  await waitFor(() => expect(h.calcBodies.length).toBeGreaterThan(0));
  return h.calcBodies[h.calcBodies.length - 1];
}

describe("AdminPricingPage — variant-aware calculator console (R115)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.calcBodies = [];
    h.calcResponse = null;
    h.calcError = null;
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

  it("offers the product's variants and sends variant_id for the chosen one (Part 13)", async () => {
    renderPage();

    // Default mode is the custom sandbox — no variant selector yet.
    expect(screen.queryByLabelText("الباقة (الخيار الفعلي عند الدفع)")).not.toBeInTheDocument();

    const productSelect = screen.getByLabelText("المنتج");
    fireEvent.change(productSelect, { target: { value: "1" } });

    const variantSelect = await screen.findByLabelText("الباقة (الخيار الفعلي عند الدفع)");
    const options = within(variantSelect).getAllByRole("option");
    // Auto default + the two variant rows.
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toContain("تلقائي — أرخص باقة نشطة");
    expect(options[1].textContent).toContain("أساسي");
    expect(options[1].textContent).toContain("100.00");
    // The inactive variant is labeled as such.
    expect(options[2].textContent).toContain("غير فعّالة");

    // Auto default → product_id mode (cheapest active variant, backend-side).
    let body = await calculateNow();
    expect(body).toMatchObject({ product_id: 1 });
    expect(body.variant_id).toBeUndefined();

    // A specific variant → variant_id mode (what checkout charges).
    fireEvent.change(variantSelect, { target: { value: "12" } });
    body = await calculateNow();
    expect(body).toMatchObject({ variant_id: 12 });
    expect(body.product_id).toBeUndefined();

    // Switching the product resets the variant choice.
    fireEvent.change(productSelect, { target: { value: "custom" } });
    fireEvent.change(productSelect, { target: { value: "1" } });
    const reselect = await screen.findByLabelText("الباقة (الخيار الفعلي عند الدفع)");
    expect((reselect as HTMLSelectElement).value).toBe("");
  });

  it("renders the risk state WITH its why-text, worst-case, guardrails and config line", async () => {
    h.calcResponse = h.lossResponse;
    renderPage();

    const priceInput = screen.getByLabelText("السعر (د.ل)");
    fireEvent.change(priceInput, { target: { value: "240" } });
    await calculateNow();

    // The badge — never a bare color: state label + the backend's own
    // Arabic loss warning ride together.
    const badge = screen.getByText("خسارة");
    expect(badge.closest("[data-risk-state]")?.getAttribute("data-risk-state")).toBe("LOSS");
    // The WHY text rides WITH the badge (and repeats in the warnings
    // list below — both carry the backend's Arabic wording).
    expect(
      screen.getAllByText(/ستبيع بأقل من سعر التكلفة بمقدار 20\.00 د\.ل/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/خسارة مباشرة/).length).toBeGreaterThan(0);

    // Worst-case block: deepest allowed stack + contribution rows.
    expect(screen.getByText("أسوأ حالة — أعمق خصم مسموح (50%)")).toBeInTheDocument();
    expect(screen.getByText("سعر التعادل (التكلفة)")).toBeInTheDocument();
    expect(screen.getByText("الحد الأدنى الآمن (شامل الولاء والإحالة)")).toBeInTheDocument();
    expect(screen.getByText("أقصى خصم آمن على السعر الحالي")).toBeInTheDocument();

    // The applied-config line names the rule that produced the numbers.
    expect(
      screen.getByText(/القاعدة المطبَّقة: 1\$ = 10\.00 د\.ل · هامش 100% · سقف الخصم المجمّع 50%/),
    ).toBeInTheDocument();

    // Switch to a SAFE response — the badge + threshold explainer.
    h.calcResponse = h.safeResponse;
    fireEvent.change(priceInput, { target: { value: "100" } });
    await calculateNow();
    expect(screen.getByText("آمن")).toBeInTheDocument();
    expect(screen.getByText(/الهامش الإجمالي ضمن النطاق المريح/)).toBeInTheDocument();
  });

  it("the referred-buyer hint uses the API's referral_cost values, not a frozen constant", async () => {
    h.calcResponse = h.safeResponse;
    renderPage();

    // Before the first calculation: mechanics only, no invented numbers.
    expect(
      screen.getByText("تُخصم مكافأة الترحيب للمُحال وقيمة نقاط المُحيل من الربح"),
    ).toBeInTheDocument();

    const priceInput = screen.getByLabelText("السعر (د.ل)");
    fireEvent.change(priceInput, { target: { value: "100" } });
    await calculateNow();

    // After: the exact values from result.referral_cost.
    expect(
      screen.getByText("يحسم 5.00 د.ل مكافأة الترحيب + 0.50 د.ل قيمة نقاط المُحيل"),
    ).toBeInTheDocument();
  });
});

describe("AdminPricingPage — the two-step recompute (A5 P1-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.calcBodies = [];
    h.calcResponse = null;
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

/**
 * R126-L3 (A2-9) — the calculator's failed-recalc stale-keep.
 *
 * `calculate()` runs on a 300ms debounce after EVERY input change, so
 * a transient 5xx on one keystroke used to run `setResult(null)` and
 * collapse the outputs card to «أدخل سعراً أو اختر منتجاً لرؤية
 * الحساب.» — a false-empty claim that the operator had never
 * calculated, right while they were READING the previous numbers.
 * The catch now keeps the previous result standing and surfaces a
 * role="alert" banner naming it stale (the orders/tickets stale-keep
 * precedence); a failed FIRST calculation renders the banner instead
 * of the placeholder (an outage is not "no input yet").
 */
describe("AdminPricingPage — a failed recalc keeps the last result standing (R126-L3 A2-9)", () => {
  /** An ApiError-shaped rejection with the backend's own Arabic
   *  wording — describeError passes Arabic messages through verbatim. */
  const GATEWAY_BLIP = { data: { error: "خلل مؤقت في محرك التسعير" } };

  beforeEach(() => {
    vi.clearAllMocks();
    h.calcBodies = [];
    h.calcResponse = null;
    h.calcError = null;
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

  it("a failed RECALC keeps the previous result + a stale-marker banner, never the false placeholder", async () => {
    h.calcResponse = h.safeResponse;
    renderPage();

    // First calculation lands a SAFE result…
    const priceInput = screen.getByLabelText("السعر (د.ل)");
    fireEvent.change(priceInput, { target: { value: "100" } });
    await calculateNow();
    expect(screen.getByText("آمن")).toBeInTheDocument();

    // …then the gateway blips on the next recalc.
    h.calcError = GATEWAY_BLIP;
    fireEvent.change(priceInput, { target: { value: "240" } });
    await calculateNow();

    // The destructive toast fired once for the blip…
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    // …but the STANDING surface is the banner (role=alert) + the stale
    // result, NOT the «أدخل سعراً…» false-empty placeholder.
    const banner = screen.getByText(/فشل تحديث الحاسبة/).closest('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(banner).toHaveTextContent(
      "النتيجة أدناه من آخر حساب ناجح وقد لا تطابق المدخلات الحالية",
    );
    expect(banner).toHaveTextContent("خلل مؤقت في محرك التسعير");
    expect(screen.getByText("آمن")).toBeInTheDocument();
    expect(screen.queryByText("أدخل سعراً أو اختر منتجاً لرؤية الحساب.")).not.toBeInTheDocument();
  });

  it("a recovery recalc clears the banner and lands the fresh result", async () => {
    h.calcResponse = h.safeResponse;
    renderPage();

    const priceInput = screen.getByLabelText("السعر (د.ل)");
    fireEvent.change(priceInput, { target: { value: "100" } });
    await calculateNow();

    h.calcError = GATEWAY_BLIP;
    fireEvent.change(priceInput, { target: { value: "240" } });
    await calculateNow();
    await waitFor(() => screen.getByText(/فشل تحديث الحاسبة/));

    // The gateway recovers — the next recalc succeeds.
    h.calcError = null;
    await calculateNow();

    await waitFor(() => expect(screen.queryByText(/فشل تحديث الحاسبة/)).not.toBeInTheDocument());
    expect(screen.getByText("آمن")).toBeInTheDocument();
  });

  it('a failed FIRST calculation renders the error banner, not the "no input yet" placeholder', async () => {
    h.calcError = GATEWAY_BLIP;
    renderPage();

    const priceInput = screen.getByLabelText("السعر (د.ل)");
    fireEvent.change(priceInput, { target: { value: "100" } });
    await calculateNow();

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    // The banner owns the card — an outage is not «أدخل سعراً…».
    const banner = screen.getByText(/تعذّر تشغيل الحاسبة/).closest('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(banner).toHaveTextContent("خلل مؤقت في محرك التسعير");
    expect(screen.queryByText("أدخل سعراً أو اختر منتجاً لرؤية الحساب.")).not.toBeInTheDocument();
  });
});

describe("AdminPricingPage — max_total_discount_pct config (policy 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.calcBodies = [];
    h.calcResponse = null;
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
