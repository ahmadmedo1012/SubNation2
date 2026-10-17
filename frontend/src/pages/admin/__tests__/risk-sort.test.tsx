/**
 * R160 — the admin risk ?sort= affordance (the risk half of the R158-A
 * P3 «no sort affordance on orders/coupons/risk tables»).
 *
 * The risk queue is CURSOR-paginated (next_cursor keyset), so a
 * client-side sort would only rank the loaded page — the R159-IMPL-B
 * users-directory mistake. The ordering therefore rides the validated
 * ?sort= param (backend routes/admin/risk.ts, whitelisted to
 * created_at/score × asc/desc; the cursor ENCODES the active sort's
 * keyset tuple). Pinned here:
 *
 *   1. whitelist parity — risk-meta's RISK_SORTS stays in lockstep
 *      with the generated ListAdminRiskEventsSort (the openapi truth),
 *      and the desktop toggle helper cycles desc↔asc with the ""
 *      default mapping (absent param IS created_at DESC);
 *   2. URL round-trip — a ?sort= deep link rehydrates the first
 *      request, and a desktop-header/mobile-chip flip writes ?sort=
 *      back via replaceState (the ?level= family's R123 idiom);
 *   3. aria-sort semantics — the sortable th elements carry the live
 *      ascending/descending/none state (the r140-l register's own
 *      rule: a th that grows a sort control MUST grow aria-sort);
 *   4. rendered row order follows the SERVER response — the page never
 *      re-sorts client-side;
 *   5. invalid-value tolerance — a garbage ?sort= degrades to the
 *      default ordering (param dropped) instead of a 400.
 *
 * `@/lib/auth` + the admin shell are mocked at the module boundary;
 * adminFetchJson rides the stubbed global fetch (the risk-load-more
 * harness pattern).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminRiskPage from "@/pages/admin/risk";
import { ListAdminRiskEventsSort } from "@workspace/api-client-react";
import { RISK_SORTS, nextRiskSort } from "@/components/admin/risk/risk-meta";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const DASHBOARD = {
  window_hours: 24,
  total: 2,
  by_level: { low: 0, medium: 2, high: 0, critical: 0 },
  unresolved: 0,
  top_rules: [],
  pipeline: { enabled: true },
};

const EVENT = (id: number, score: number, createdAt: string) => ({
  id,
  user_id: 7,
  user_phone: "0912345678",
  user_email: null,
  event_type: `rule_${id}`,
  score,
  level: "medium",
  confidence: 0.87,
  rule_fired: ["many_topups"],
  action_taken: "flag",
  ip_address: null,
  created_at: createdAt,
  shown_at: null,
});

/** Two rows the server already ordered by score desc (its job, not ours). */
const PAGE = {
  events: [EVENT(1, 90, "2026-09-03T10:00:00.000Z"), EVENT(2, 10, "2026-09-01T10:00:00.000Z")],
  next_cursor: null,
};

function resLike(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminRiskPage />
      </Router>
    </QueryClientProvider>,
  );
}

const urlSort = (): string | null => new URLSearchParams(window.location.search).get("sort");
const lastEventsUrl = (): string => {
  const calls = fetchMock.mock.calls.map((c) => String(c[0]));
  const eventsCalls = calls.filter((u) => u.includes("/api/admin/risk/events"));
  return eventsCalls.at(-1) ?? "";
};

describe("R160 — the risk sort whitelist (meta ↔ generated parity + the toggle helper)", () => {
  it("RISK_SORTS mirrors the generated ListAdminRiskEventsSort (the openapi truth)", () => {
    expect([...RISK_SORTS]).toEqual(Object.values(ListAdminRiskEventsSort));
  });

  it('nextRiskSort: the "" default maps through created_at DESC and every column toggles desc↔asc', () => {
    // Absent param IS newest-first — the first الوقت click flips to asc.
    expect(nextRiskSort("created_at", "")).toBe("created_at:asc");
    expect(nextRiskSort("created_at", "created_at:desc")).toBe("created_at:asc");
    expect(nextRiskSort("created_at", "created_at:asc")).toBe("created_at:desc");
    // Clicking a non-active column starts that column at desc.
    expect(nextRiskSort("score", "")).toBe("score:desc");
    expect(nextRiskSort("score", "score:desc")).toBe("score:asc");
    expect(nextRiskSort("score", "score:asc")).toBe("score:desc");
    // A score sort clicking الوقت returns to created_at desc.
    expect(nextRiskSort("created_at", "score:asc")).toBe("created_at:desc");
  });
});

describe("R160 — AdminRiskPage ?sort= (URL round-trip + aria-sort + request wiring)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/risk/dashboard")) return resLike(DASHBOARD);
      return resLike(PAGE);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("default render: no sort in the request, الوقت th aria-sort=descending, النقاط none, الأحدث chip pressed", async () => {
    renderPage();
    await screen.findByRole("link", { name: "فتح تحقيق الحدث رقم 1" });

    // The default ordering is newest-first: the request carries no sort.
    expect(lastEventsUrl()).not.toContain("sort=");
    // The th states are honest about that: created_at descending…
    const dateTh = screen.getByRole("button", { name: "ترتيب حسب الوقت" }).closest("th");
    expect(dateTh).toHaveAttribute("aria-sort", "descending");
    // …النقاط unsorted…
    const scoreTh = screen.getByRole("button", { name: "ترتيب حسب النقاط" }).closest("th");
    expect(scoreTh).toHaveAttribute("aria-sort", "none");
    // …and the mobile chip bar's default maps to الأحدث.
    expect(screen.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a ?sort= deep link rehydrates the first request (URL → state)", async () => {
    window.history.replaceState({}, "", "/admin/risk?sort=score%3Aasc");
    renderPage();

    await waitFor(() => expect(lastEventsUrl()).toContain("sort=score%3Aasc"));
  });

  it("desktop header click: toggle → request param, aria-sort, and the ?sort= write-back", async () => {
    renderPage();
    await screen.findByRole("link", { name: "فتح تحقيق الحدث رقم 1" });

    // Click النقاط: created_at-effective desc → that column's desc.
    // (Every flip changes the query key → the page rides its existing
    // loading branches until the new first page lands — the assertions
    // wait for the rows to come back, no new spinners.)
    fireEvent.click(screen.getByRole("button", { name: "ترتيب حسب النقاط" }));
    await waitFor(() => expect(lastEventsUrl()).toContain("sort=score%3Adesc"));
    expect(urlSort()).toBe("score:desc");
    const scoreTh = (await screen.findByRole("button", { name: "ترتيب حسب النقاط" })).closest("th");
    const dateTh = screen.getByRole("button", { name: "ترتيب حسب الوقت" }).closest("th");
    expect(scoreTh).toHaveAttribute("aria-sort", "descending");
    expect(dateTh).toHaveAttribute("aria-sort", "none");

    // Click again: desc → asc.
    fireEvent.click(screen.getByRole("button", { name: "ترتيب حسب النقاط" }));
    await waitFor(() => expect(lastEventsUrl()).toContain("sort=score%3Aasc"));
    expect(urlSort()).toBe("score:asc");
    const scoreThAsc = (await screen.findByRole("button", { name: "ترتيب حسب النقاط" })).closest(
      "th",
    );
    expect(scoreThAsc).toHaveAttribute("aria-sort", "ascending");

    // Click الوقت from a score sort: back to created_at desc (the
    // effective default — the first click, NOT a dead no-op).
    fireEvent.click(screen.getByRole("button", { name: "ترتيب حسب الوقت" }));
    await waitFor(() => expect(lastEventsUrl()).toContain("sort=created_at%3Adesc"));
    expect(urlSort()).toBe("created_at:desc");
  });

  it("mobile chip bar: a chip flip rides the same request + write-back (the shared FilterTabs control)", async () => {
    renderPage();
    await screen.findByRole("link", { name: "فتح تحقيق الحدث رقم 1" });

    fireEvent.click(screen.getByRole("button", { name: "الأقدم" }));
    await waitFor(() => expect(lastEventsUrl()).toContain("sort=created_at%3Aasc"));
    expect(urlSort()).toBe("created_at:asc");
    // The chips ride with the refetch cycle — wait for the pressed
    // state to move before asserting it.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "الأقدم" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "false");
  });

  it("rendered row order follows the SERVER response — the page never re-sorts client-side", async () => {
    // The server already ordered score desc: 90 before 10. If the page
    // re-sorted locally (the users-directory mistake), this flips. The
    // desktop rows' drill-in anchors (aria-named per event) are compared
    // by DOCUMENT ORDER — the row the server sent first renders first.
    renderPage();
    const link1 = await screen.findByRole("link", { name: "فتح تحقيق الحدث رقم 1" });
    const link2 = screen.getByRole("link", { name: "فتح تحقيق الحدث رقم 2" });

    expect(link1.compareDocumentPosition(link2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("an INVALID ?sort= deep link degrades to the default ordering (param dropped, no 400)", async () => {
    window.history.replaceState({}, "", "/admin/risk?sort=level%3Adesc");
    renderPage();

    await screen.findByRole("link", { name: "فتح تحقيق الحدث رقم 1" });
    expect(lastEventsUrl()).not.toContain("sort=");
    // The honest default UI: الوقت descending + الأحدث chip pressed.
    const dateTh = screen.getByRole("button", { name: "ترتيب حسب الوقت" }).closest("th");
    expect(dateTh).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("button", { name: "الأحدث" })).toHaveAttribute("aria-pressed", "true");
  });
});
