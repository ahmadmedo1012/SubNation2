/**
 * R-140-l — SEMANTICS-DEPTH pin suite (headings · landmarks · tables).
 *
 * The r124 craft-floor + r139 visual passes left the admin table register
 * and the five storefront pages visually settled; this suite freezes the
 * RESIDUAL SEMANTIC depth this round verified or fixed:
 *
 *   1. THE REAL-TABLE REGISTER (7 files ride an actual <table>): every
 *      <th> carries scope="col" (the 96-F7 idiom — RecomputePreviewCard
 *      was the one unscoped money table, fixed R-140-l); every <table>
 *      carries an Arabic aria-label (the family's naming idiom extended
 *      to the register); thead/tbody structure with NO tfoot (the
 *      honest-counts bands are divs outside the table — the r139
 *      register) and NO scope="row" (rows are td data, no row headers).
 *   2. NO SORTABLE HEADERS exist anywhere in the register — sorting
 *      rides aria-pressed chips in the filter panels (users' client-side
 *      sort) — so no th is interactive and none carries aria-sort. If a
 *      th ever grows a sort control it MUST also grow aria-sort
 *      (auto/ascending/descending): this pin trips first.
 *   3. Selection semantics: the orders select-all + per-row selectors
 *      are named + stateful (aria-label + aria-pressed, the F3-08 fix).
 *   4. Empty states swap the tables OUT (no tbody that renders zero
 *      rows): the page-level guards are pinned so a refactor that lets
 *      an empty <tbody> ship trips here.
 *   5. The div-grid register members (coupons/referrals) STAY div-grids
 *      — the responsive stacked-card layout is honest as content; the
 *      no-role="table" decision is frozen with its rationale in-source.
 *   6. Storefront headings: h1 exactly once per RENDERED view on every
 *      owned page (source counts are branch-aware: order-detail's 3 h1s
 *      and onboarding's 2 h1s sit in mutually-exclusive branches — the
 *      two RENDER tests below prove the per-view invariant live), the
 *      ladder sequential (h1→h2, no skips), card titles ride the
 *      family's font-bold h2 register.
 *   7. Receipt semantics: orders/order-detail carry NO table markup —
 *      the money rows are the family's div label/value idiom (the
 *      wallet-statement register), frozen here so a future "upgrade"
 *      to a bare unnamed <table> is a conscious decision.
 *   8. Landmarks: the app shell owns the ONE <main> (routes.tsx);
 *      admin/layout's scroll column is a div now (was a nested second
 *      main — the R-140-l fix); none of the owned pages nests
 *      main/nav/header/footer; the credentials card rides the family's
 *      section + aria-labelledby binding (the WalletStatementCard
 *      idiom).
 *   9. RTL isolations frozen: order codes / coupon codes / phones /
 *      referral codes / countdown labels ride structural dir="ltr"
 *      (or dir="auto" for mixed free text) at leaf level.
 *
 * stripComments(): rationale comments NAME the pinned tokens (e.g. this
 * round's "no aria-sort" notes), so raw scans would false-count them.
 * LINE-COMMENTS-FIRST ordering (the r139 account-suite / r140-a craft).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Line-comments-first stripper (see suite docblock). */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

/* ── The admin REAL-table register (files that ride an actual <table>) ── */
const REAL_TABLES: Record<string, string> = {
  "src/components/admin/orders/OrdersTable.tsx": "جدول الطلبات",
  "src/components/admin/users/UsersDesktopTable.tsx": "جدول المستخدمين",
  "src/components/admin/security/AuditTrailTable.tsx": "سجل إجراءات المسؤولين",
  "src/components/admin/risk/RiskEventsTable.tsx": "جدول أحداث المخاطر",
  "src/components/admin/product-variants/VariantRows.tsx": "جدول باقات المنتج",
  "src/components/admin/InventoryUploadDialog.tsx": "معاينة أسطر المخزون",
  "src/components/admin/pricing/RecomputePreviewCard.tsx": "عينة الأسعار قبل وبعد",
};
const strippedRealTables = Object.fromEntries(
  Object.keys(REAL_TABLES).map((f) => [f, stripComments(read(f))]),
);

const ORDERS_PAGE = stripComments(read("src/pages/orders.tsx"));
const ORDER_DETAIL = stripComments(read("src/pages/order-detail.tsx"));
const PROFILE = stripComments(read("src/pages/profile.tsx"));
const ONBOARDING = stripComments(read("src/pages/onboarding.tsx"));
const FLASH_SALES = stripComments(read("src/pages/flash-sales.tsx"));
const ADMIN_ORDERS_PAGE = stripComments(read("src/pages/admin/orders.tsx"));
const ADMIN_USERS_PAGE = stripComments(read("src/pages/admin/users.tsx"));
const ADMIN_RISK_PAGE = stripComments(read("src/pages/admin/risk.tsx"));
const ADMIN_SECURITY_PAGE = stripComments(read("src/pages/admin/security.tsx"));
const ADMIN_LAYOUT = stripComments(read("src/pages/admin/layout.tsx"));
const ROUTES = stripComments(read("src/app/routes.tsx"));
const COUPONS_TABLE = stripComments(read("src/components/admin/coupons/CouponsTable.tsx"));
const REFERRALS_TABLE = stripComments(read("src/components/admin/referrals/ReferralsTable.tsx"));
const DESKTOP_ORDER_ROW = stripComments(read("src/components/admin/orders/DesktopOrderRow.tsx"));

const count = (src: string, re: RegExp): number => (src.match(re) ?? []).length;
const thCount = (src: string): number => count(src, /<th[\s>]/g);

/* ══════════════════════════════════════════════════════════════════
 * A. THE REAL-TABLE REGISTER
 * ══════════════════════════════════════════════════════════════════ */
describe("R-140-l — the admin real-table register: scope + accessible name", () => {
  for (const [file, label] of Object.entries(REAL_TABLES)) {
    const src = strippedRealTables[file];
    it(`${file}: every <th> carries scope="col" (96-F7 idiom, no unscoped header)`, () => {
      const ths = thCount(src);
      expect(ths, `${file} th census`).toBeGreaterThanOrEqual(4);
      expect(count(src, /scope="col"/g), `${file} scope census`).toBe(ths);
      expect(src).not.toContain('scope="row"');
    });

    it(`${file}: the <table> carries its Arabic aria-label («${label}»)`, () => {
      expect(src).toMatch(new RegExp(`<table[^>]*aria-label="${label}"`));
      // No visible <caption> by family decision — the aria-label is the
      // invisible naming channel (semantics-only, zero visual delta).
      expect(src).not.toContain("<caption");
    });

    it(`${file}: thead/tbody structure, NO tfoot (the r139 div band owns the counts)`, () => {
      expect(src).toContain("<thead");
      expect(src).toContain("<tbody");
      expect(src).not.toContain("<tfoot");
    });

    it(`${file}: no interactive/sortable header (sort rides aria-pressed chips; no aria-sort)`, () => {
      // The register's th elements are plain scoped headers — the users
      // console sorts via the filter panel's aria-pressed chip bar, the
      // rest don't sort at all. A th that grows a sort control MUST
      // carry aria-sort (auto/ascending/descending) — this pin trips
      // the day someone wires one without it.
      expect(src).not.toContain("aria-sort");
      expect(src).not.toMatch(/<th[^>]*onClick/);
      expect(src).not.toMatch(/<th[^>]*\sonKeyDown/);
    });
  }

  it("RecomputePreviewCard: the money sample keeps the r139 byte pins over the scoped th", () => {
    const src = strippedRealTables["src/components/admin/pricing/RecomputePreviewCard.tsx"];
    // R141: whitespace-free matching for the two header pins — r140 added
    // scope="col" (this register's one unscoped table) and prettier
    // wrapped each th's text onto its own line, so the byte-adjacent
    // `…font-semibold">الباقة` pins broke on pure layout. The pinned
    // contract is the class string + the cell text on the SAME th, not
    // their line adjacency (the component's own note: «Classes
    // byte-identical»).
    const squash = (s: string): string => s.replace(/\s+/g, "");
    expect(squash(src)).toContain(squash('text-right font-semibold">الباقة'));
    expect(squash(src)).toContain(squash('text-left font-semibold">السعر الحالي'));
    expect(src).toContain('"border-b border-border/60 bg-muted/30 text-muted-foreground"');
  });
});

describe("R-140-l — selection semantics on the orders money table", () => {
  it("the select-all is named + stateful (aria-label + aria-pressed, the F3-08 fix)", () => {
    const src = strippedRealTables["src/components/admin/orders/OrdersTable.tsx"];
    expect(src).toContain('aria-label="تحديد كل الطلبات المعروضة للإجراء الجماعي"');
    expect(src).toContain("aria-pressed={allFilteredSelected}");
  });

  it("every row selector is named + stateful (the bulk-refund input is never visual-only)", () => {
    expect(DESKTOP_ORDER_ROW).toContain("aria-label={`تحديد الطلب ${order.order_code}");
    expect(DESKTOP_ORDER_ROW).toContain("aria-pressed={isSelected}");
  });
});

describe("R-140-l — empty states swap the tables out (no zero-row tbody)", () => {
  it("admin/orders: filtered.length === 0 renders OrdersEmptyResults, not the table", () => {
    expect(ADMIN_ORDERS_PAGE).toContain("filtered.length === 0 ?");
    expect(ADMIN_ORDERS_PAGE).toContain("<OrdersEmptyResults");
  });
  it("admin/users: sorted.length === 0 renders the EmptyState, not the table", () => {
    expect(ADMIN_USERS_PAGE).toContain("sorted.length === 0 ?");
    expect(ADMIN_USERS_PAGE).toContain("<EmptyState");
  });
  it("admin/risk: events.length === 0 renders the EmptyState, not the table", () => {
    expect(ADMIN_RISK_PAGE).toContain("events.length === 0 &&");
    expect(ADMIN_RISK_PAGE).toContain("<EmptyState");
  });
  it("admin/security: auditLogs.length === 0 renders the EmptyState, not the table", () => {
    expect(ADMIN_SECURITY_PAGE).toContain("auditLogs.length === 0 ?");
    expect(ADMIN_SECURITY_PAGE).toContain("<EmptyState");
  });
  it("VariantRows: variants.length === 0 renders the empty card, not the table", () => {
    const src = strippedRealTables["src/components/admin/product-variants/VariantRows.tsx"];
    expect(src).toContain("variants.length === 0 ?");
  });
  it("InventoryUploadDialog: the preview table mounts only under parsed.entries.length > 0", () => {
    const src = strippedRealTables["src/components/admin/InventoryUploadDialog.tsx"];
    expect(src).toContain("parsed.entries.length > 0 &&");
  });
});

describe("R-140-l — the div-grid register members stay div-grids (frozen decision)", () => {
  it("CouponsTable/ReferralsTable carry no table markup and no role=table retrofit", () => {
    for (const src of [COUPONS_TABLE, REFERRALS_TABLE]) {
      expect(src).not.toContain("<table");
      expect(src).not.toContain("<th");
      expect(src).not.toContain('role="table"');
      expect(src).not.toContain('role="row"');
      expect(src).not.toContain('role="cell"');
    }
  });
  it("the coupons mobile rows carry their in-cell field labels (the header↔cell relation)", () => {
    expect(COUPONS_TABLE).toContain("md:hidden text-3xs font-bold");
  });
});

/* ══════════════════════════════════════════════════════════════════
 * B. STOREFRONT HEADINGS
 * ══════════════════════════════════════════════════════════════════ */
describe("R-140-l — h1-once + sequential ladder per owned page (source census)", () => {
  it("orders.tsx: exactly one h1, no deeper headings (the list rows are lines, not sections)", () => {
    expect(count(ORDERS_PAGE, /<h1[\s>]/g)).toBe(1);
    expect(count(ORDERS_PAGE, /<h[23456][\s>]/g)).toBe(0);
    expect(ORDERS_PAGE).toContain('<h1 className="text-2xl font-bold">طلباتي</h1>');
  });

  it("profile.tsx: one h1, two h2 card titles, h1 precedes the h2s (sequential)", () => {
    expect(count(PROFILE, /<h1[\s>]/g)).toBe(1);
    expect(count(PROFILE, /<h2[\s>]/g)).toBe(2);
    expect(PROFILE.indexOf("<h1")).toBeLessThan(PROFILE.indexOf("<h2"));
    expect(count(PROFILE, /<h[3456][\s>]/g)).toBe(0);
  });

  it("flash-sales.tsx: exactly one h1 (the grid page owns no section headings)", () => {
    expect(count(FLASH_SALES, /<h1[\s>]/g)).toBe(1);
    expect(count(FLASH_SALES, /<h[23456][\s>]/g)).toBe(0);
  });

  it("order-detail.tsx: 3 branch-exclusive h1s (main + two error views) + 4 branch-exclusive h2 card titles", () => {
    // Each RENDERED view carries exactly one h1 — the source holds three
    // because the connection-error / 404 branches replace the whole page
    // (family precedent: category's error branch + not-found ride h1).
    // The h2s: the credentials card, the decrypt-failure alert, the prep
    // card and the refund/fail terminal — one per mutually-exclusive card.
    expect(count(ORDER_DETAIL, /<h1[\s>]/g)).toBe(3);
    expect(count(ORDER_DETAIL, /<h2[\s>]/g)).toBe(4);
    expect(count(ORDER_DETAIL, /<h[3456][\s>]/g)).toBe(0);
    expect(ORDER_DETAIL).toContain('<h1 className="font-bold text-lg mb-1">تعذّر تحميل الطلب</h1>');
    expect(ORDER_DETAIL).toContain('<h1 className="font-bold text-lg mb-1">الطلب غير موجود</h1>');
  });

  it("onboarding.tsx: 2 branch-exclusive h1s (one per step view), no orphaned h2", () => {
    expect(count(ONBOARDING, /<h1[\s>]/g)).toBe(2);
    expect(count(ONBOARDING, /<h[23456][\s>]/g)).toBe(0);
    expect(ONBOARDING).toContain('<h1 className="text-xl font-bold">جاهز للبدء</h1>');
    expect(ONBOARDING).not.toContain('<h2 className="text-xl font-bold">جاهز للبدء</h2>');
  });
});

describe("R-140-l — order-detail: the credentials card is a bound section (WalletStatementCard idiom)", () => {
  it("section aria-labelledby + the h2 id pair, exactly once", () => {
    expect(count(ORDER_DETAIL, /aria-labelledby="order-credentials-heading"/g)).toBe(1);
    expect(count(ORDER_DETAIL, /id="order-credentials-heading"/g)).toBe(1);
    expect(ORDER_DETAIL).toContain("<section");
    // The family's ONE section-binding idiom — no other section on the page.
    expect(count(ORDER_DETAIL, /<section[\s>]/g)).toBe(1);
  });
});

describe("R-140-l — receipt-row semantics frozen (the div label/value idiom, not tables)", () => {
  it("orders.tsx + order-detail.tsx ship NO table markup (no bare unnamed money tables)", () => {
    for (const src of [ORDERS_PAGE, ORDER_DETAIL]) {
      expect(src).not.toContain("<table");
      expect(src).not.toContain("<th");
      expect(src).not.toContain('role="table"');
      expect(src).not.toContain("<dl");
    }
  });
  it("the receipt hairline rhythm rides the money rows (the r139 /20 register)", () => {
    expect(ORDER_DETAIL).toContain("divide-y divide-border/20");
    expect(ORDER_DETAIL).toContain("border-t border-border/20");
  });
});

/* ══════════════════════════════════════════════════════════════════
 * C. LANDMARKS
 * ══════════════════════════════════════════════════════════════════ */
describe("R-140-l — one <main> app-wide (the app shell owns it)", () => {
  it('routes.tsx carries exactly the one <main id="main-content">', () => {
    expect(count(ROUTES, /<main[\s>]/g)).toBe(1);
    expect(ROUTES).toContain('id="main-content"');
  });
  it("admin/layout.tsx nests NO second main (the scroll column is a div, R-140-l fix)", () => {
    expect(ADMIN_LAYOUT).not.toContain("<main");
    expect(ADMIN_LAYOUT).toContain('<div className="flex-1 overflow-auto min-w-0">');
  });
  it("no owned page nests main/nav/header/footer elements (chrome is the shell's job)", () => {
    for (const src of [ORDERS_PAGE, ORDER_DETAIL, PROFILE, ONBOARDING, FLASH_SALES]) {
      expect(src).not.toContain("<main");
      expect(src).not.toContain("<nav");
      expect(src).not.toMatch(/<header[\s>]/);
      expect(src).not.toMatch(/<footer[\s>]/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
 * D. RTL isolations (structural, leaf-level)
 * ══════════════════════════════════════════════════════════════════ */
describe("R-140-l — bidi isolations on codes/phones/countdowns", () => {
  it("orders.tsx: the order-code chip + the coupon chip isolate their LTR runs", () => {
    expect(count(ORDERS_PAGE, /dir="ltr"/g)).toBeGreaterThanOrEqual(2);
    expect(ORDERS_PAGE).toContain("{order.order_code}");
    expect(ORDERS_PAGE).toContain('<span dir="ltr">');
  });
  it("order-detail.tsx: the copyable order code, the coupon token and the credential values isolate; free text rides dir=auto", () => {
    // R146 (F6 pin update): the credential values' dir="ltr" rides the
    // shared components/product/CopyField now — the pin follows the
    // page ∪ extract surface (product-decomposition-r135's idiom) after
    // the near-duplicate merge; the count and intent are unchanged.
    const surface = ORDER_DETAIL + stripComments(read("src/components/product/CopyField.tsx"));
    expect(count(surface, /dir="ltr"/g)).toBeGreaterThanOrEqual(3);
    expect(count(ORDER_DETAIL, /dir="auto"/g)).toBeGreaterThanOrEqual(1);
  });
  it("profile.tsx: phone run, Latin brand token and the mono referral code isolate", () => {
    expect(count(PROFILE, /dir="ltr"/g)).toBeGreaterThanOrEqual(3);
    expect(PROFILE).toContain('lang="en"');
  });
  it("flash-sales.tsx: the countdown label is one structural LTR run", () => {
    expect(FLASH_SALES).toContain('<span dir="ltr">{timeLabel}</span>');
  });
});

/* ══════════════════════════════════════════════════════════════════
 * E. RENDER pins — the per-view h1 invariant, live
 * ══════════════════════════════════════════════════════════════════ */
vi.mock("@workspace/api-client-react", () => ({
  useGetOrder: vi.fn(),
  getGetOrderQueryKey: (code: string) => [`/api/orders/${code}`],
  useGetMe: vi.fn(() => ({ data: { id: 1 } })),
  getGetMeQueryKey: () => ["/api/auth/me"],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import { useGetOrder } from "@workspace/api-client-react";
import OrderDetailPage from "@/pages/order-detail";
import { OnboardingPage } from "@/pages/onboarding";

type GetOrderResult = ReturnType<typeof useGetOrder>;

describe("R-140-l — order-detail renders exactly one h1 per view (live)", () => {
  beforeEach(() => {
    toastSpy.mockReset();
    vi.mocked(useGetOrder).mockReset();
  });

  it("the 404 view: one h1, and it names the state («الطلب غير موجود»)", () => {
    vi.mocked(useGetOrder).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { name: "ApiError", status: 404, message: "الطلب غير موجود" },
      refetch: vi.fn(),
    } as unknown as GetOrderResult);

    window.history.pushState({}, "", "/orders/SNDOESNOTEXIST");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <OrderDetailPage />
        </Router>
      </QueryClientProvider>,
    );

    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toBe("الطلب غير موجود");
    // And no h2 exists on this view (the ladder is h1-only here).
    expect(container.querySelectorAll("h2")).toHaveLength(0);
  });

  it("the connection-error view: one h1 («تعذّر تحميل الطلب»)", () => {
    vi.mocked(useGetOrder).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { name: "ApiError", status: 502, message: "bad gateway" },
      refetch: vi.fn(),
    } as unknown as GetOrderResult);

    window.history.pushState({}, "", "/orders/SNNETWORKDOWN");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <OrderDetailPage />
        </Router>
      </QueryClientProvider>,
    );

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("تعذّر تحميل الطلب");
  });
});

describe("R-140-l — onboarding renders exactly one h1 per step view (live)", () => {
  it("step 1 carries the welcome h1; advancing to step 2 swaps in its own h1 — never two, never zero", () => {
    window.history.pushState({}, "", "/onboarding");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <OnboardingPage />
        </Router>
      </QueryClientProvider>,
    );

    // Step 1: exactly one h1 (the welcome heading).
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("مرحباً بك");

    // Advance — the step views are mutually exclusive.
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    // Step 2: still exactly one h1, now the step's own title.
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.textContent).toBe("جاهز للبدء");
    // No orphaned h2 survives the swap.
    expect(container.querySelectorAll("h2")).toHaveLength(0);
  });
});
