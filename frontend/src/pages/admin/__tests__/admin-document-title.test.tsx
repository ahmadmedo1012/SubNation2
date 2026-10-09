/**
 * R125 (A6 B-1) — per-route document.title for the admin console.
 *
 * Admin never set document.title: the App-level fallback MetaTags
 * stamped the STOREFRONT title («SubNation — سوق الاشتراكات الرقمية»)
 * on every /admin/* route, and RouteAnnouncer (App.tsx) announces only
 * title CHANGES — so every admin→admin navigation was a silent URL
 * swap for screen-reader users (WCAG 2.4.2 + 4.1.3).
 *
 * AdminLayout now derives the title from the SAME PAGE_TITLES map that
 * drives the top-bar heading (itself derived from NAV_SECTIONS — drift
 * impossible by construction), and restores the app default on unmount
 * (so /admin/login, the one admin route without AdminLayout, never
 * inherits the last visited page's title).
 *
 * These tests pin:
 *   1. Each admin navigation sets document.title to the route's
 *      NAV_SECTIONS label + the admin suffix (3 nav routes + the
 *      risk-event detail fallback).
 *   2. Unmount restores the storefront default title.
 *
 * Module-boundary mocks follow admin-layout-alerts.test.tsx (the same
 * AdminLayout surface); the stats subscription rides the REAL generated
 * client through the stubbed global fetch.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, useLocation } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AdminLayout, NAV_SECTIONS } from "@/pages/admin/layout";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    adminLogout: vi.fn(),
    hasAdminPermission: () => true,
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

/** The app-level fallback MetaTags title (App.tsx) — the restore target. */
const STOREFRONT_DEFAULT_TITLE = "SubNation — سوق الاشتراكات الرقمية";

/** NAV_SECTIONS label for a nav href — the expected PAGE_TITLES value. */
function navLabel(href: string): string {
  const item = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.href === href);
  if (!item) throw new Error(`no NAV_SECTIONS entry for ${href}`);
  return item.label;
}

/** Wouter navigation button — drives AdminLayout's useLocation. */
function NavButton({ to }: { to: string }) {
  const [, navigate] = useLocation();
  return (
    <button type="button" onClick={() => navigate(to)}>
      {`اذهب إلى ${to}`}
    </button>
  );
}

function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  // The generated client's customFetch parses via .text() + JSON.parse
  // and infers the type from the content-type header (see
  // admin-layout-alerts.test.tsx for the full rationale).
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

const fetchMock = vi.fn(() => Promise.resolve(resLike({ body: { count: 0 } })));

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <NavButton to="/admin/alerts" />
        <NavButton to="/admin/topups" />
        <NavButton to="/admin/risk/events/42" />
        <AdminLayout>
          <div>page-body</div>
        </AdminLayout>
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminLayout — per-route document.title (R125 A6 B-1)", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sn_last_alert_id", "0");
    window.history.pushState({}, "", "/admin");
    document.title = STOREFRONT_DEFAULT_TITLE;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("sn_last_alert_id");
  });

  it("mounting an admin route stamps its NAV_SECTIONS label into document.title", () => {
    renderLayout();
    // /admin → «الرئيسية» (NAV_SECTIONS label — not the old hand-map's
    // drifted «لوحة التحكم»).
    expect(document.title).toBe(`${navLabel("/admin")} — SubNation الإدارة`);
  });

  it.each([
    ["/admin/alerts", "/admin/alerts"],
    ["/admin/topups", "/admin/topups"],
  ])("navigating to %s sets the route's title", (to) => {
    renderLayout();
    fireEvent.click(screen.getByRole("button", { name: `اذهب إلى ${to}` }));
    expect(document.title).toBe(`${navLabel(to)} — SubNation الإدارة`);
  });

  it("detail routes fall back to their explicit title (risk-event)", () => {
    renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "اذهب إلى /admin/risk/events/42" }));
    expect(document.title).toBe("تفاصيل الحدث — مراقبة المخاطر — SubNation الإدارة");
  });

  it("unmount restores the storefront default title", () => {
    const view = renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "اذهب إلى /admin/alerts" }));
    expect(document.title).toContain(navLabel("/admin/alerts"));

    view.unmount();
    expect(document.title).toBe(STOREFRONT_DEFAULT_TITLE);
  });
});
