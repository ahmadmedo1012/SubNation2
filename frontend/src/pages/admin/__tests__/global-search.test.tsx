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
 * R118-B6 (A5 W-6): migrated to vi.useFakeTimers — the suite used to
 * sleep real 260/500ms per test to orchestrate the race interleavings
 * (top flake candidate on a loaded 2-CPU runner). The repo's
 * established fake-timer idiom (whatsapp-phone-sign-in.test.tsx):
 * advance via act(vi.advanceTimersByTime) + a microtask flush; NEVER
 * waitFor/findBy (they poll on faked timers and hang). The 220ms
 * debounce and the mock's 400ms stale-response delay are now FAKE
 * timers, so the "older response resolves after the newer one"
 * interleaving is driven deterministically by advancing exactly past
 * each delay.
 *
 * The auth hook, theme, copilot panel and toast hook are mocked at
 * the module boundary; fetch is routed per URL.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
function routeSearch(respond: (q: string) => Promise<Response> | Response, searchOk = true) {
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

/** Drains the promise continuations behind the mocked fetch (fake timers freeze macrotasks). */
async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/** Advances fake time, then drains whatever the fired timers started. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flushAsync();
}

function openPaletteAndType(value: string) {
  fireEvent.click(screen.getByRole("button", { name: /بحث\.\.\./ }));
  // The palette renders in the same commit as the click — no findBy
  // needed (and none possible: it polls on faked timers).
  const input = screen.getByPlaceholderText("بحث في الطلبات، المستخدمين، المنتجات…");
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("AdminLayout GlobalSearch — no more silent failures or stale races (A2 P2-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sn_last_alert_id", "0");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.removeItem("sn_last_alert_id");
  });

  it("an error envelope (r.ok=false) stays an honest 'no results' — not a crash or fake rows", async () => {
    const failing = routeSearch(() => [], false);
    vi.stubGlobal("fetch", failing);

    renderLayout();
    openPaletteAndType("ab");

    // The 220ms debounce fires on faked time; the failure path renders
    // the honest empty state (and never throws on the envelope body).
    // R125 (A6 B-9): the sr-only live line mirrors the same text — the
    // assertion accepts the twin and requires the VISIBLE one.
    await advance(220);
    const matches = screen.getAllByText(/لا نتائج لـ "ab"/);
    expect(matches.some((el) => !el.className.includes("sr-only"))).toBe(true);
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
    const input = openPaletteAndType("ab");
    // The first debounce (220ms) fires on faked time — the "ab" request
    // goes in flight and stays pending on its own 400ms fake timer.
    await advance(220);

    // Complete to "abc" — the change aborts the older controller, but
    // the mock deliberately IGNORES the abort signal (belt-only path):
    // only the ordering guard can keep the stale response out.
    fireEvent.change(input, { target: { value: "abc" } });
    // The second debounce fires; the NEWER response lands immediately.
    await advance(220);
    expect(screen.getByText("نتيجة حديثة FRESH")).toBeInTheDocument();

    // Advance WELL past the older response's 400ms delay — it resolves
    // now, AFTER the newer one, and must be dropped.
    await advance(400);
    expect(screen.queryByText("نتيجة قديمة STALE")).not.toBeInTheDocument();
    expect(screen.getByText("نتيجة حديثة FRESH")).toBeInTheDocument();
  });

  it("clicking an orders result navigates WITH the query (?search= survives)", async () => {
    renderLayout();
    openPaletteAndType("abc");

    await advance(220);
    const row = screen.getByText("نتيجة صحيحة");
    fireEvent.click(row.closest('[role="option"]')!);

    // wouter's navigate commits synchronously inside the click's act
    // scope; the microtask flush absorbs the post-click state updates.
    await flushAsync();
    expect(screen.getByTestId("location-probe").textContent).toBe("/admin/orders?search=abc");
  });
});

describe("AdminLayout GlobalSearch — palette a11y contract (R125 A6 B-9)", () => {
  /**
   * The overlay claimed role="dialog" aria-modal="true" without
   * enforcing any of it: Tab walked out of the "modal" into the page
   * behind, closing it dropped focus to <body>, the listbox carried
   * non-option children, and result changes were unannounced. The
   * palette now traps Tab, returns focus to the invoker, groups its
   * listbox sections, and mirrors the result state in an sr-only
   * polite live line.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sn_last_alert_id", "0");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.removeItem("sn_last_alert_id");
  });

  it("Esc closes the palette and returns focus to the trigger (was dropped to <body>)", async () => {
    renderLayout();
    const trigger = screen.getByRole("button", { name: /بحث\.\.\./ });
    trigger.focus();
    fireEvent.click(trigger);

    const input = screen.getByPlaceholderText("بحث في الطلبات، المستخدمين، المنتجات…");
    expect(input).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    await flushAsync();

    expect(
      screen.queryByPlaceholderText("بحث في الطلبات، المستخدمين، المنتجات…"),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("Tab cycles INSIDE the palette — no walk into the page behind the aria-modal", async () => {
    renderLayout();
    openPaletteAndType("abc");
    await advance(220); // results land: the mock answers all three
    // sections, so three options exist.

    const input = screen.getByPlaceholderText("بحث في الطلبات، المستخدمين، المنتجات…");
    expect(input).toHaveFocus();

    // Tab from the input moves to the FIRST option — inside the overlay.
    fireEvent.keyDown(input, { key: "Tab" });
    const options = screen.getAllByRole("option");
    expect(options.length).toBe(3);
    expect(options[0]).toHaveFocus();

    // Shift+Tab from the first option wraps back to the input (the
    // trap cycle — a native Shift+Tab would leave the palette).
    fireEvent.keyDown(options[0], { key: "Tab", shiftKey: true });
    expect(input).toHaveFocus();
  });

  it("result sections are role=group (legal listbox children) with labels", async () => {
    renderLayout();
    openPaletteAndType("abc");
    await advance(220);

    const listbox = screen.getByRole("listbox");
    // The routed mock answers all three scoped sections with the same
    // row shape — three groups, one per section.
    const groups = within(listbox).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "الطلبات",
      "المستخدمون",
      "المنتجات",
    ]);
    // The visible headers are aria-hidden — the group names carry them once.
    for (const g of groups) expect(g.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("the sr-only live line announces the result count (and the no-results state)", async () => {
    renderLayout();
    openPaletteAndType("abc");
    await advance(220);

    const live = document.querySelector('div[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live!.className).toContain("sr-only");
    // formatCount idiom: the mock answers all three sections → 3 results
    // → Arabic plural "few" → «3 نتائج».
    expect(live!.textContent).toBe("3 نتائج");

    // The failing-search case announces the honest no-results line too.
    const failing = routeSearch(() => [], false);
    vi.stubGlobal("fetch", failing);
    const input = screen.getByPlaceholderText("بحث في الطلبات، المستخدمين، المنتجات…");
    fireEvent.change(input, { target: { value: "zz" } });
    await advance(220);
    expect(live!.textContent).toBe(`لا نتائج لـ "zz"`);
  });
});
