/**
 * R122 (A2-P2) — AdminLayout "last updated" pill honesty + GlobalSearch
 * scope gating.
 *
 * Two defects from the R122-A2 audit pinned here:
 *
 *   1. (P2-1) The pill seeded `lastUpdated = new Date()` at mount and
 *      rendered an always-green pulsing dot — a fresh mount with a
 *      failing API read «الآن» while nothing had landed, and the dot
 *      stayed green through every badge-query error. The pill now
 *      derives from the REAL query state: gray while the first fetch is
 *      in flight, amber when a badge query sits in error (with the
 *      honest stale age), emerald pulse only once data actually landed.
 *
 *   2. (P2-3) GlobalSearch promised orders/users/products results to
 *      admins whose scopes 403 all three — a scoped operator typed a
 *      real query and got «لا نتائج» for sections they can never open.
 *      The palette now fetches/offers only the scoped-in sections, and
 *      the triggers hide entirely for a no-scope operator.
 *
 * Module mocks follow global-search.test.tsx / admin-layout-alerts
 * .test.tsx (the same AdminLayout surface); the auth mock reads from
 * hoisted mutable scope state.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AdminLayout } from "@/pages/admin/layout";

const { authState } = vi.hoisted(() => ({ authState: {} as Record<string, boolean> }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    adminLogout: vi.fn(),
    hasAdminPermission: (scope: string) => authState[scope] !== false,
  }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/components/admin/copilot/CopilotPanel", () => ({
  CopilotPanel: () => null,
}));

/** Minimal Response-like object (the global-search.test.tsx stub). */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
    },
  } as unknown as Response;
}

const fetchMock = vi.fn();

function routeBadgeFetch(over: { unread?: () => Response; stats?: () => Response } = {}) {
  return vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes("/api/admin/alerts/unread-count")) {
      return Promise.resolve(over.unread ? over.unread() : resLike({ body: { count: 0 } }));
    }
    if (url.includes("/api/admin/alerts/new")) {
      return Promise.resolve(resLike({ body: { alerts: [] } }));
    }
    if (url.includes("/api/admin/stats")) {
      return Promise.resolve(over.stats ? over.stats() : resLike({ body: {} }));
    }
    if (url.includes("?search=")) {
      return Promise.resolve(resLike({ body: [] }));
    }
    return Promise.resolve(resLike({ body: {} }));
  });
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminLayout>
        <div>page-body</div>
      </AdminLayout>
    </QueryClientProvider>,
  );
}

/** The pill's colored dot (top bar) — queried by its tailwind class. */
function pillDot(container: HTMLElement): string | null {
  const el = container.querySelector<HTMLElement>('[class*="rounded-full"][class*="w-1.5"]');
  return el ? el.className : null;
}

/** R125 (A6 B-15): the pill now renders the visible label
 *  (`hidden sm:inline`) PLUS an sr-only narrow-viewport twin carrying
 *  the same text for screen readers — pill-text assertions target the
 *  visible twin and tolerate the sr-only one. */
function visiblePillText(text: string): HTMLElement[] {
  return screen.getAllByText(text).filter((el) => !el.className.includes("sr-only"));
}

describe("AdminLayout last-updated pill — reflects real query state (R122 A2-P2)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sn_last_alert_id", "0");
    // The stats subscription needs finance OR support; grant finance so
    // both badge queries run (the alerts query runs for everyone).
    authState.finance = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("sn_last_alert_id");
    for (const k of Object.keys(authState)) delete authState[k];
  });

  it("healthy badge queries → emerald pulsing dot + the honest relative time", async () => {
    fetchMock.mockImplementation(routeBadgeFetch());

    const { container } = renderLayout();

    await waitFor(() => {
      expect(visiblePillText("الآن").length).toBeGreaterThan(0);
    });
    // Live = the emerald pulse (not the amber error dot, not the gray
    // in-flight dot).
    expect(pillDot(container)).toContain("bg-emerald-400");
    expect(pillDot(container)).toContain("animate-pulse");
  });

  it("a failing badge query → amber dot (no pulse) + «تعذّر التحديث», never a fake «الآن»", async () => {
    fetchMock.mockImplementation(
      routeBadgeFetch({
        unread: () => resLike({ ok: false, status: 500, body: { error: "x", code: "Y" } }),
      }),
    );

    const { container } = renderLayout();

    await waitFor(() => {
      expect(visiblePillText("تعذّر التحديث").length).toBeGreaterThan(0);
    });
    expect(pillDot(container)).toContain("bg-status-warning");
    expect(pillDot(container)).not.toContain("animate-pulse");
    expect(screen.queryAllByText("الآن")).toHaveLength(0);
  });

  it("before ANY data lands → gray dot + «جارٍ التحديث…», never a fake live signal", async () => {
    // Never-resolving fetches keep both badge queries in flight.
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    const { container } = renderLayout();

    await waitFor(() => {
      expect(visiblePillText("جارٍ التحديث…").length).toBeGreaterThan(0);
    });
    expect(pillDot(container)).toContain("bg-muted-foreground/60");
    expect(pillDot(container)).not.toContain("animate-pulse");
    expect(screen.queryAllByText("الآن")).toHaveLength(0);
  });
});

describe("GlobalSearch — scope-honest sections (R122 A2-P2)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sn_last_alert_id", "0");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("sn_last_alert_id");
    for (const k of Object.keys(authState)) delete authState[k];
  });

  it("fetches ONLY the scoped-in sections — a users-only admin never asks orders/products", async () => {
    // Support-style operator: users scope only.
    authState.orders = false;
    authState.users = true;
    authState.inventory = false;
    fetchMock.mockImplementation(routeBadgeFetch());

    renderLayout();

    const trigger = screen.getByRole("button", { name: /بحث\.\.\./ });
    fireEvent.click(trigger);

    const input = await screen.findByPlaceholderText("بحث في المستخدمين…");
    fireEvent.change(input, { target: { value: "0912" } });

    // The palette debounce is 220 ms real time — wait it out directly
    // (the fetch mock records every call; no waitFor polling needed).
    await new Promise((r) => setTimeout(r, 600));
    const allUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    const searchUrls = allUrls.filter((u) => u.includes("?search="));
    // Only the users endpoint is ever asked…
    expect(searchUrls.length).toBeGreaterThan(0);
    expect(searchUrls.every((u) => u.startsWith("/api/admin/users?search="))).toBe(true);
    expect(searchUrls.some((u) => u.includes("/api/admin/orders"))).toBe(false);
    expect(searchUrls.some((u) => u.includes("/api/admin/products"))).toBe(false);
  });

  it("a no-search-scope admin sees NO search triggers at all (the palette is unreachable)", async () => {
    authState.orders = false;
    authState.users = false;
    authState.inventory = false;
    fetchMock.mockImplementation(routeBadgeFetch());

    renderLayout();

    await waitFor(() => {
      expect(screen.getByText("page-body")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /بحث\.\.\./ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /بحث سريع/ })).not.toBeInTheDocument();
  });
});
