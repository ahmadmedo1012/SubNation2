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

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
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
    // R186 (C-F4): the live config the mocked query serves — mutable so
    // the remote-drift test can land a REFRESHED rule (config B) on an
    // already-mounted page, exactly like the shared query key refetch.
    pricingConfig: {
      usd_to_lyd: 10,
      markup_percent: 100,
      max_total_discount_pct: 50,
    } as { usd_to_lyd: number; markup_percent: number; max_total_discount_pct: number },
  };
});

vi.mock("@workspace/api-client-react", () => {
  return {
    getGetAdminPricingConfigQueryKey: () => ["/api/admin/pricing/config"],
    getListAdminProductsQueryKey: () => ["/api/admin/products"],
    useGetAdminPricingConfig: () => ({
      data: h.pricingConfig,
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
        mutation?.onSuccess?.({ ...h.pricingConfig, ...vars.data });
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
    h.pricingConfig = { usd_to_lyd: 10, markup_percent: 100, max_total_discount_pct: 50 };
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
    // R187L-F1: the preview counts ride formatCount (VARIANT/PRODUCT
    // forms) — 3 → «باقات» (few), 2 → «منتجان» (dual), never the frozen
    // «باقة» + the 1/other-only «منتجات».
    expect(confirm.description).toContain("المعاينة: 3 باقات ستنحرف عبر 2 منتجان");
    expect(confirm.description).not.toContain("3 باقة ");
    expect(confirm.description).not.toContain("2 منتجات");
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

  // R187E-F3: a preview is a function of the rule (the page's own
  // contract at pricing.tsx:263-265) — a successful SAVE changes the
  // rule, so the preview card must unmount. The input-seeding effect
  // can't do it: onSuccess re-seeds the operator's exact typed values
  // (same strings), so the effect never re-fires and the stale
  // old-rule sample used to linger beside the new rule — with the
  // destructive recompute confirm still citing its old-rule counts.
  it("a successful SAVE drops the preview card (a save changes the rule the preview was computed under)", async () => {
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/pricing/recompute")) {
        return Promise.resolve(resLike({ body: DRY_RUN }));
      }
      return Promise.resolve(resLike({ body: {} }));
    });

    renderPage();

    // The finding's exact sequence: the operator's edits happen FIRST
    // (the draft is already dirty), THEN the preview runs (the dry-run
    // computes under the SERVER's old rule — rate 10), THEN the save
    // commits the draft. An edit AFTER the preview would clear it via
    // the input effect; this order leaves only onSuccess to do it.
    const rateInput = screen.getByLabelText("سعر الصرف — دينار لكل دولار ($1 =)");
    fireEvent.change(rateInput, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "معاينة التغييرات" }));
    expect(await screen.findByText("معاينة إعادة الاحتساب")).toBeInTheDocument();

    // Step 2: save the operator's exact typed values (the PUT).
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));

    expect(h.updateConfigBodies).toHaveLength(1);
    expect(h.updateConfigBodies[0]).toMatchObject({ usd_to_lyd: 12 });

    // The save's onSuccess re-seeds the SAME typed strings — so the
    // stale-preview-clearing effect never fires; only the explicit
    // setDryRun(null) unmounts the card.
    await waitFor(() => {
      expect(screen.queryByText("معاينة إعادة الاحتساب")).not.toBeInTheDocument();
    });
    expect((rateInput as HTMLInputElement).value).toBe("12");
    // And the recompute confirm no longer carries the stale preview
    // counts (the "no preview" arm).
    fireEvent.click(screen.getByRole("button", { name: "إعادة احتساب أسعار الكتالوج" }));
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0].description).not.toContain("المعاينة: 3");
  });
});

describe("AdminPricingPage — max_total_discount_pct config (policy 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateConfigBodies = [];
    h.recomputeCalls = 0;
    h.confirmCalls = [];
    h.pricingConfig = { usd_to_lyd: 10, markup_percent: 100, max_total_discount_pct: 50 };
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

/** R186 (C-F4) — "dirty" means OPERATOR edits, not remote drift.
 *
 * The seed-once ref made a REMOTE rule change (another admin's save →
 * the shared pricing-config query key refetches) leave an UNTOUCHED
 * form reading dirty against the live config: the save button enabled
 * and the beforeunload armed for a form nobody edited — and saving at
 * that moment silently reverted the other admin's rule to the stale
 * seed. The seed guard now keys on operator input ownership: a pristine
 * form re-seeds to the remote rule; an edited one keeps the draft.
 *
 * The refresh lands through a wrapper-triggered re-render (the mocked
 * query serves the mutated hoisted config) — the form itself receives
 * ZERO user events in the drift test.
 */
describe("AdminPricingPage — a remote rule drift re-seeds a PRISTINE form (R186 C-F4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateConfigBodies = [];
    h.recomputeCalls = 0;
    h.confirmCalls = [];
    h.pricingConfig = { usd_to_lyd: 10, markup_percent: 100, max_total_discount_pct: 50 };
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Renders the page inside a wrapper whose state flip simulates the
   *  query refetch landing (new data identity, no form user events). The
   *  page element is minted INSIDE the wrapper so each flip re-renders it
   *  (the same-element-identity bail-out would otherwise skip it). */
  function renderWithRefetchLanding() {
    let landRefetch!: () => void;
    const LandingWrapper = () => {
      const [, setTick] = useState(0);
      landRefetch = () => setTick((n) => n + 1);
      return (
        <Router>
          <AdminPricingPage />
        </Router>
      );
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const utils = render(
      <QueryClientProvider client={client}>
        <LandingWrapper />
      </QueryClientProvider>,
    );
    return {
      ...utils,
      landRefetch: () => act(() => landRefetch()),
    };
  }

  it("config A → refetched config B (different rate), zero form events: inputs re-seed to B and save stays disabled", async () => {
    const { landRefetch } = renderWithRefetchLanding();

    const rateInput = screen.getByLabelText("سعر الصرف — دينار لكل دولار ($1 =)");
    const save = screen.getByRole("button", { name: "حفظ الإعدادات" });
    // Seeded from config A; nothing edited → save disabled.
    expect((rateInput as HTMLInputElement).value).toBe("10");
    expect(save).toBeDisabled();

    // The remote drift lands: another admin saved rate 11.5 and the
    // shared query key refetched. ZERO user events on this form.
    h.pricingConfig = { usd_to_lyd: 11.5, markup_percent: 100, max_total_discount_pct: 50 };
    landRefetch();

    // The pristine form ADOPTS the remote rule (was: stale seed read
    // dirty — save enabled + beforeunload armed for an untouched form).
    await waitFor(() => {
      expect((rateInput as HTMLInputElement).value).toBe("11.5");
    });
    expect(save).toBeDisabled();
    expect(h.updateConfigBodies).toHaveLength(0);
  });

  it("an OPERATOR-edited form keeps the draft over the drift (ownership, not staleness)", async () => {
    const { landRefetch } = renderWithRefetchLanding();

    const rateInput = screen.getByLabelText("سعر الصرف — دينار لكل دولار ($1 =)");
    fireEvent.change(rateInput, { target: { value: "12" } });
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();

    // The same remote drift lands — the operator's draft survives.
    h.pricingConfig = { usd_to_lyd: 11.5, markup_percent: 100, max_total_discount_pct: 50 };
    landRefetch();

    await waitFor(() => {
      expect((rateInput as HTMLInputElement).value).toBe("12");
    });
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
    expect(h.updateConfigBodies).toHaveLength(0);
  });

  it("a successful save re-arms re-adoption: the NEXT remote drift re-seeds the committed form", async () => {
    const { landRefetch } = renderWithRefetchLanding();

    const rateInput = screen.getByLabelText("سعر الصرف — دينار لكل دولار ($1 =)");
    fireEvent.change(rateInput, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));

    // The save's onSuccess re-seeds to the server-rounded values, and
    // the invalidateQueries refetch lands the SAME saved rule (the mock
    // serves the merged config — the real refetch's answer).
    h.pricingConfig = { usd_to_lyd: 12, markup_percent: 100, max_total_discount_pct: 50 };
    landRefetch();

    // Saved and settled: the committed draft no longer counts as an
    // operator edit — the form is NOT dirty against the landed rule.
    await waitFor(() => expect((rateInput as HTMLInputElement).value).toBe("12"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();
    });

    // A later remote drift re-adopts (no second false-dirty window).
    h.pricingConfig = { usd_to_lyd: 13, markup_percent: 100, max_total_discount_pct: 50 };
    landRefetch();
    await waitFor(() => {
      expect((rateInput as HTMLInputElement).value).toBe("13");
    });
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();
  });
});

describe("AdminPricingPage — R181: the calculator simulator is gone, the settings remain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateConfigBodies = [];
    h.recomputeCalls = 0;
    h.confirmCalls = [];
    h.pricingConfig = { usd_to_lyd: 10, markup_percent: 100, max_total_discount_pct: 50 };
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
