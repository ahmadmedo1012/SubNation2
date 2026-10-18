/**
 * R153 (Phase C) — the admin alert toast poller race, pinned.
 *
 * The poller (pages/admin/layout.tsx) previously had no in-flight
 * guard and no stable toast ids: the socket event (ADMIN_ALERT_NEW_
 * EVENT), the 5-minute interval and the visibility catch-up could all
 * fire poll() while a previous delivery was still in flight — two
 * overlapping /new fetches each toasted the SAME alerts with no id to
 * dedupe on. And /new?since= caps at LIMIT 50: a burst larger than
 * 50 advanced lastId past alerts the operator never saw.
 *
 * Pinned here (the admin-layout-alerts.test.tsx harness idiom):
 *   1. two rapid poll triggers (the socket event fired twice) produce
 *      exactly ONE /new fetch while the first is in flight;
 *   2. toasts carry the stable `admin-alert-<id>` id (Sonner's dedupe
 *      key, the bell's notif-<id> idiom);
 *   3. a full 50-alert page is followed by a second fetch until a
 *      short page — every alert in a >50 burst gets its toast and
 *      lastId only advances past alerts the operator was shown.
 */

import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AdminLayout } from "@/pages/admin/layout";
import { ADMIN_ALERT_NEW_EVENT } from "@/lib/socket-events";
import { toast } from "@/hooks/useToast";

const { authState } = vi.hoisted(() => ({
  authState: { finance: true, support: true } as Record<string, boolean>,
}));

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

vi.mock("@/hooks/useToast", () => ({
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

const fetchMock = vi.fn();

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

/** Count of /api/admin/alerts/new calls the mock has served. */
function newAlertsCalls(): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/admin/alerts/new")).length;
}

function alert(i: number, type = "low_stock") {
  return { id: i, type, message: `alert-${i}` };
}

describe("R153 — the admin alert toast poller race hardening", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sn_last_alert_id", "0");
    authState.support = true;
    vi.mocked(toast).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("sn_last_alert_id");
  });

  it("two rapid poll triggers while a delivery is in flight → exactly ONE /new fetch (in-flight guard)", async () => {
    let release: (() => void) | null = null;
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/alerts/new")) {
        // Hang the /new response until the test releases it.
        return new Promise<Response>((resolve) => {
          release = () => resolve(resLike({ body: { alerts: [] } }) as Response);
        });
      }
      return Promise.resolve(resLike({ body: { count: 0 } }));
    });

    renderLayout();
    await waitFor(() => expect(newAlertsCalls()).toBeGreaterThanOrEqual(1));

    // The socket event fires twice while the first delivery hangs.
    window.dispatchEvent(new Event(ADMIN_ALERT_NEW_EVENT));
    window.dispatchEvent(new Event(ADMIN_ALERT_NEW_EVENT));
    const callsAtDoubleFire = newAlertsCalls();
    expect(callsAtDoubleFire).toBe(1); // the guard ate both re-entries

    // TS's closure-assignment tracking can't see the mock set `release`;
    // widen the narrowed null back to the union before the optional call.
    (release as (() => void) | null)?.();
    await waitFor(() => {
      // After release, the next trigger may poll again — but during the
      // in-flight window there was never a second concurrent fetch.
      expect(newAlertsCalls()).toBeLessThanOrEqual(2);
    });
  });

  it("toasts carry the stable admin-alert-<id> id (the dedupe key)", async () => {
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/alerts/new")) {
        return Promise.resolve(resLike({ body: { alerts: [alert(41), alert(42)] } }));
      }
      return Promise.resolve(resLike({ body: { count: 0 } }));
    });

    renderLayout();
    await waitFor(() => expect(vi.mocked(toast).mock.calls.length).toBeGreaterThanOrEqual(2));

    const ids = vi.mocked(toast).mock.calls.map((c) => (c[0] as { id?: string }).id);
    expect(ids).toContain("admin-alert-41");
    expect(ids).toContain("admin-alert-42");
    // lastId advanced past what was shown.
    expect(localStorage.getItem("sn_last_alert_id")).toBe("42");
  });

  it("a full 50-alert page loops until the short page — a >50 burst toasts ALL of them", async () => {
    let servedPages = 0;
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/alerts/new")) {
        servedPages += 1;
        if (servedPages === 1) {
          // Exactly the LIMIT 50 — the old code stopped here and the
          // remaining alerts were never toasted.
          return Promise.resolve(
            resLike({ body: { alerts: Array.from({ length: 50 }, (_, i) => alert(i + 1)) } }),
          );
        }
        return Promise.resolve(resLike({ body: { alerts: [alert(51), alert(52)] } }));
      }
      return Promise.resolve(resLike({ body: { count: 0 } }));
    });

    renderLayout();
    await waitFor(() => {
      expect(servedPages).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      // All 52 alerts got a toast (ids prove the full sweep + no dupes).
      const ids = new Set(vi.mocked(toast).mock.calls.map((c) => (c[0] as { id?: string }).id));
      expect(ids.size).toBe(52);
      expect(ids.has("admin-alert-1")).toBe(true);
      expect(ids.has("admin-alert-50")).toBe(true);
      expect(ids.has("admin-alert-52")).toBe(true);
    });
    expect(localStorage.getItem("sn_last_alert_id")).toBe("52");
  });
});
