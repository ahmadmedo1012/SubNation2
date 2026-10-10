/**
 * R125 (A6 B-7 / B-11 / B-12 / B-15) — admin shell semantics.
 *
 * The admin chrome carried four 4.1.2-class gaps the storefront had
 * already fixed (R124-A5 #3/#4):
 *
 *   1. No skip-to-content link — App.tsx excluded admin from the V2-H1
 *      skip link while its sidebar repeats 18 nav links + search +
 *      logout before the content on EVERY route (B-7, 2.4.1).
 *   2. The top-bar hamburger and the sidebar-collapse chevron were
 *      icon-only with no accessible name; the hamburger also hid its
 *      expanded state (B-11).
 *   3. Nav links marked the active item visually only — no
 *      aria-current="page" (B-12; storefront Navbar/MobileNav have it).
 *   4. The mobile drawer announced itself (role=dialog + Esc) but
 *      focus never moved in, Tab walked out of the "modal", and
 *      closing dropped focus to <body> (B-15).
 *
 * Render assertions ride the REAL AdminLayout (module-boundary mocks
 * follow admin-layout-alerts.test.tsx). The skip link itself lives in
 * App.tsx's AppRoutes (whose render needs the full auth-provider
 * tree), so its half is pinned as a static source contract — the same
 * pwa-offline-shell / route-change-focus.test.tsx pattern App.tsx's
 * own <main> contract already uses.
 *
 * NOTE (cross-lane): the A10 C-15 "one h1 per page" assertion is
 * deliberately absent — demoting the top-bar <h1> would leave
 * dashboard.tsx and whatsapp.tsx (other lanes' files) with NO h1
 * until they grow their own; the demotion must land after them.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AdminLayout } from "@/pages/admin/layout";

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

const fetchMock = vi.fn(() => Promise.resolve(resLike({ body: { count: 0 } })));

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

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("sn_last_alert_id", "0");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("sn_last_alert_id");
});

describe("App.tsx skip link — admin is no longer excluded (R125 A6 B-7)", () => {
  const appText = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

  it("targets #main-content and renders for admin too (condition no longer guards on !isAdmin)", () => {
    // Static contract on the source (pwa-offline-shell /
    // route-change-focus.test.tsx pattern): the skip-link anchor is
    // governed by the chromeless guard ONLY. Before R125 this block
    // read `{!isAdmin && !isChromeless && (` — 18 sidebar links before
    // content with no bypass on every admin route.
    expect(appText).toContain('{!isChromeless && (\n        <a\n          href="#main-content"');
    expect(appText).not.toContain(
      '{!isAdmin && !isChromeless && (\n        <a\n          href="#main-content"',
    );
    // …and the visible-on-focus styling + Arabic label survive.
    expect(appText).toContain("focus:not-sr-only");
    expect(appText).toContain("تخطّى إلى المحتوى الرئيسي");
  });
});

describe("AdminLayout nav — aria-current on the active item (R125 A6 B-12)", () => {
  it('the active route\'s link carries aria-current="page"; siblings do not', () => {
    window.history.pushState({}, "", "/admin/alerts");
    renderLayout();

    const active = screen.getByRole("link", { name: /التنبيهات/ });
    expect(active).toHaveAttribute("aria-current", "page");

    const sibling = screen.getByRole("link", { name: /المنتجات/ });
    expect(sibling).not.toHaveAttribute("aria-current");
  });
});

describe("AdminLayout chrome controls — names + expanded state (R125 A6 B-11)", () => {
  it("the sidebar collapse chevron is named and exposes its expanded state", () => {
    renderLayout();

    const collapse = screen.getByRole("button", { name: "تصغير القائمة الجانبية" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapse);
    expect(collapse).toHaveAttribute("aria-expanded", "false");
  });

  it("the hamburger is named, exposes expanded state, and controls the drawer id", () => {
    renderLayout();

    const hamburger = screen.getByRole("button", { name: "فتح قائمة الإدارة" });
    expect(hamburger).toHaveAttribute("aria-expanded", "false");
    expect(hamburger).toHaveAttribute("aria-controls", "admin-mobile-drawer");
    // Closed: the controlled element is not in the DOM yet.
    expect(document.getElementById("admin-mobile-drawer")).toBeNull();

    fireEvent.click(hamburger);
    const drawer = document.getElementById("admin-mobile-drawer");
    expect(drawer).not.toBeNull();
    expect(drawer).toHaveAttribute("role", "dialog");
    expect(hamburger).toHaveAttribute("aria-expanded", "true");
    // State-aware name: the same control now promises CLOSING.
    expect(screen.getByRole("button", { name: "إغلاق قائمة الإدارة" })).toBe(hamburger);
  });
});

describe("AdminLayout mobile drawer — focus move-in, trap target, return (R125 A6 B-15)", () => {
  it("opening moves focus into the dialog; Esc closes and returns focus to the hamburger", () => {
    renderLayout();

    const hamburger = screen.getByRole("button", { name: "فتح قائمة الإدارة" });
    fireEvent.click(hamburger);

    // Focus moved INTO the dialog (it used to stay in the page behind
    // the aria-modal backdrop).
    expect(document.getElementById("admin-mobile-drawer")).toHaveFocus();

    // 93-C7/C-UX3's Esc contract still holds — now with focus return.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.getElementById("admin-mobile-drawer")).toBeNull();
    expect(hamburger).toHaveFocus();
  });

  it("the drawer contains the nav links it traps (the Tab cycle has targets)", async () => {
    renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "فتح قائمة الإدارة" }));

    const drawer = document.getElementById("admin-mobile-drawer")!;
    const focusables = drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
    );
    // 18-item nav (RBAC filter keeps all with the all-scopes mock) +
    // search hint + logout — a Tab walk that previously crossed into
    // the page behind the "modal".
    expect(focusables.length).toBeGreaterThan(3);
    await waitFor(() => expect(screen.getByText("page-body")).toBeInTheDocument());
  });
});

describe("AdminLayout collapsed sidebar — icon-only links keep their names (R128 A6 P3-1)", () => {
  // A6's (d) sweep: collapsing the rail hid every NavItem <span> and the
  // logout label with NO aria-label/title — 18 unnamed controls, the one
  // systemic 4.1.2 gap left in the app. The fix carries the expanded
  // label verbatim via aria-label + title, ONLY while collapsed (never
  // fighting the visible text).
  it("collapsed: nav links + logout are findable by name and carry a hover title", () => {
    window.history.pushState({}, "", "/admin/alerts");
    renderLayout();

    fireEvent.click(screen.getByRole("button", { name: "تصغير القائمة الجانبية" }));

    const alerts = screen.getByRole("link", { name: "التنبيهات" });
    expect(alerts).toHaveAttribute("aria-label", "التنبيهات");
    expect(alerts).toHaveAttribute("title", "التنبيهات");

    const logout = screen.getByRole("button", { name: "خروج" });
    expect(logout).toHaveAttribute("aria-label", "خروج");
    expect(logout).toHaveAttribute("title", "خروج");

    // The active item's aria-current survives the collapse too.
    expect(alerts).toHaveAttribute("aria-current", "page");
  });

  it("expanded: the name comes from the visible text — no aria-label override", () => {
    renderLayout();

    // Collapsed → expanded again.
    const collapse = screen.getByRole("button", { name: "تصغير القائمة الجانبية" });
    fireEvent.click(collapse);
    fireEvent.click(collapse);

    const alerts = screen.getByRole("link", { name: "التنبيهات" });
    expect(alerts).not.toHaveAttribute("aria-label");
    expect(alerts).not.toHaveAttribute("title");
  });
});
