/**
 * R183 — the admin panels' scope SELF-gates (the latent 403-burst class).
 *
 * The R182 round closed the two LIVE scope-blind fetches (settings'
 * mount pair, the dashboard's recent-orders stream). The R183 audit
 * found the same defect class LATENT on three more surfaces — queries
 * whose only scope gate was the parent page's early return, so the
 * page worked today but any future ungated mount (a dashboard widget, a
 * deep-link render during the redirect window) would fire a
 * guaranteed-403 poll:
 *
 *   • StockoutRiskPanel  — GET /api/admin/forecast/at-risk, refetch
 *     every 5 min, no `enabled` arm of its own.
 *   • TierPriceAuditPanel (products.tsx local) — GET
 *     /api/admin/products/tier-price-sweep, same shape.
 *   • enrichment.tsx's two queries — `enabled: canView` without the
 *     `!!adminToken` arm every sibling uses.
 *
 * All three gained the house idiom `enabled: !!adminToken && scope`.
 * This file pins it:
 *
 *   1. BEHAVIORAL (the R123 zero-bytes contract): the REAL
 *      StockoutRiskPanel rendered against the stubbed global fetch —
 *      a token-less OR inventory-less session sends ZERO bytes; a
 *      scoped session reaches the endpoint (the fetch is the pin).
 *   2. SOURCE pins for the two page-local surfaces (the R182
 *      admin-enrichment-truth idiom): the enabled arms must exist in
 *      products.tsx's TierPriceAuditPanel and enrichment.tsx's two
 *      queries.
 */

import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { StockoutRiskPanel } from "@/components/admin/forecast/StockoutRiskPanel";

// The R122 (A2-P2) hoisted-mutable auth idiom — the scope flips per test.
const { authState } = vi.hoisted(() => ({
  authState: { adminToken: "test-admin-token" as string | null, inventory: true },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: authState.adminToken,
    hasAdminPermission: (scope: string) => scope === "inventory" && authState.inventory,
  }),
}));

const fetchMock = vi.fn();

function resLike(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const AT_RISK_OK = {
  pipeline_state: "fresh",
  last_successful_run_at: new Date().toISOString(),
  data_freshness_hours: 1,
  rows: [],
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StockoutRiskPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(resLike(AT_RISK_OK) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  authState.adminToken = "test-admin-token";
  authState.inventory = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("R183 — StockoutRiskPanel scope self-gate (the zero-bytes contract)", () => {
  it("an inventory-scoped admin reaches the forecast endpoint (the gate never over-blocks)", async () => {
    renderPanel();
    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/forecast/at-risk")),
      ).toBe(true);
    });
  });

  it("an inventory-LESS admin sends ZERO bytes — no guaranteed-403 poll from an ungated mount", async () => {
    authState.inventory = false;
    renderPanel();
    // Give the (disabled) query a beat to prove it never fires.
    await new Promise((r) => setTimeout(r, 50));
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/forecast/at-risk")),
    ).toBe(false);
  });

  it("a token-less session (the 401-redirect window) sends ZERO bytes", async () => {
    authState.adminToken = null;
    renderPanel();
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source pins — the page-local enabled arms (the R182 admin-enrichment-truth idiom)
// ─────────────────────────────────────────────────────────────────────────────

const FRONTEND_SRC = resolvePath(__dirname, "../../..");

function src(rel: string): string {
  return readFileSync(resolvePath(FRONTEND_SRC, rel), "utf8");
}

describe("R183 — the page-local scope arms (source pins)", () => {
  it("products.tsx's TierPriceAuditPanel gates its sweep on `!!adminToken && canView`", () => {
    // R183 review F1: count, not contain — the page-level idiom satisfies
    // a bare contains() (a pre-R183 tautology). The panel's own arm makes
    // the count 2 (page gate + panel self-gate); deleting the panel's arm
    // fails this pin.
    const source = src("pages/admin/products.tsx");
    const arms = source.match(/enabled: !!adminToken && canView/g) ?? [];
    expect(arms.length, "the page gate + the panel's own self-gate").toBe(2);
    expect(source).toContain("const { adminToken, hasAdminPermission } = useAuth();");
  });

  it("enrichment.tsx's two queries carry the token-less arm", () => {
    const source = src("pages/admin/enrichment.tsx");
    const arms = source.match(/enabled: !!adminToken && canView,/g) ?? [];
    expect(arms.length, "both the drafts query and the status query need the arm").toBe(2);
  });

  it("StockoutRiskPanel.tsx gates its 5-minute poll on `!!adminToken && canView`", () => {
    const source = src("components/admin/forecast/StockoutRiskPanel.tsx");
    expect(source).toContain("enabled: !!adminToken && canView");
  });
});
