/**
 * 94-C2 (A2 P2-3) — GlobalSearch command-palette tests (layout.tsx).
 *
 * Three defects pinned:
 *
 *   1. No AbortController / no ordering guard: typing "abc" then
 *      "abcd" raced two overlapping fetches; a late-resolving OLDER
 *      response overwrote the newer results while its finally()
 *      cleared the loading flag early. Now every keystroke aborts the
 *      previous request and stale responses are dropped.
 *   2. `r.json()` without `r.ok`: an error envelope (401/500) parsed
 *      to a non-array and silently became "لا نتائج" during an
 *      outage. Now !ok → [] with the parse guarded.
 *   3. `goTo("/admin/orders")` dropped the query — clicking a result
 *      abandoned what the operator just searched for. Now the three
 *      goTo* helpers carry `?search=` and the orders/users/products
 *      pages consume it on arrival.
 *
 * The auth hook, theme, copilot panel and toast hook are mocked at
 * the module boundary; fetch is routed per URL.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, useLocation, useSearch } from "wouter";
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

// The copilot panel fetches its own history — stubbed so the palette
// test stays scoped to the GlobalSearch requests.
vi.mock("@/components/admin/copilot/CopilotPanel", () => ({
  CopilotPanel: () => null,
}));

/** Minimal Response-like object — avoids depending on a global Response. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const ORDER = (name: string) => ({
  id: 1,
  order_code: "SN-1001",
  user_phone: "0911111111",
  product_name: name,
  amount: 25,
  status: "completed",
  created_at: "2026-09-01T10:00:00.000Z",
});

/** Routes fetch: badge/poll endpoints + the three search endpoints. */
function routeSearch(
  respond: (q: string) => Promise<Response> | Response,
  searchOk = true,
) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/admin/alerts/unread-count")) {
      return resLike({ body: { count: 0 } });
    }
    if (url.includes("/api/admin/alerts/new")) {
      return resLike({ body: { alerts: [] } });
    }
    const q = decodeURIComponent(url.split("search=")[1] ?? "");
    if (!searchOk) {
      // An error envelope — parses as JSON but is NOT a result array.
      return resLike({ ok: false, status: 500, body: { error: "خطأ في الخادم" } });
    }
    return respond(q);
  });
}

const fetchMock = routeSearch(() => resLike({ body: [ORDER("نتيجة صحيحة")] }));

function LocationProbe() {
  // wouter v3: useLocation carries the path, useSearch the query —
  // the probe concatenates them to assert the FULL deep-link.
  const [loc] = useLocation();
  const search = useSearch();
  return <div data-testid="location-probe">{loc + (search ? `?${search}` : "")}</div>;
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminLayout>
          <LocationProbe />
        </AdminLayout>
      </Router>
    </QueryClientProvider>,
  );
}

async function openPaletteAndType(value: string) {
  fireEvent.click(screen.getByRole("button", { name: /بحث\.\.\./ }));
  const input = await screen.findByPlaceholderText("بحث في الطلبات، المستخدمين، المنتجات…");
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("AdminLayout GlobalSearch — no more silent failures or stale races (A2 P2-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sn_last_alert_id", "0");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("sn_last_alert_id");
  });

  it("an error envelope (r.ok=false) stays an honest 'no results' — not a crash or fake rows", async () => {
    const failing = routeSearch(() => [], false);
    vi.stubGlobal("fetch", failing);

    renderLayout();
    await openPaletteAndType("ab");

    // The 220ms debounce settles; the failure path renders the
    // honest empty state (and never throws on the envelope body).
    await screen.findByText(/لا نتائج لـ "ab"/);
  });

  it("a late-resolving OLDER response is dropped — results match the typed query", async () => {
    // "ab" answers SLOWLY (400ms) with a wrong-looking row; "abc"
    // answers immediately with the right one.
    const racing = routeSearch((q) => {
      if (q === "ab") {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(resLike({ body: [ORDER("نتيجة قديمة STALE")] })), 400);
        });
      }
      return resLike({ body: [ORDER("نتيجة حديثة FRESH")] });
    });
    vi.stubGlobal("fetch", racing);

    renderLayout();
    const input = await openPaletteAndType("ab");
    // Wait past the first debounce so the "ab" request is in flight…
    await new Promise((r) => setTimeout(r, 260));
    fireEvent.change(input, { target: { value: "abc" } });

    // The newer response lands…
    await screen.findByText("نتيجة حديثة FRESH");
    // …and the stale one NEVER overwrites it, even after it resolves.
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText("نتيجة قديمة STALE")).not.toBeInTheDocument();
  });

  it("clicking an orders result navigates WITH the query (?search= survives)", async () => {
    renderLayout();
    await openPaletteAndType("abc");

    const row = await screen.findByText("نتيجة صحيحة");
    fireEvent.click(row.closest('[role="option"]')!);

    await waitFor(() => {
      const probe = screen.getByTestId("location-probe");
      expect(probe.textContent).toBe("/admin/orders?search=abc");
    });
  });
});
