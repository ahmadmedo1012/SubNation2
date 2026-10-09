/**
 * R126-L3 (A2-2) — whatsapp load-failure taxonomy tests.
 *
 * A failed FIRST sessions load used to render the hand-rolled error
 * banner AND the «لا توجد جلسات بعد / أنشئ جلسة أولى للبدء» empty
 * state TOGETHER — an outage or expired gateway session masquerading
 * as a clean empty system (the B5-04 false-empty class the sibling
 * pages killed; R125-I5 added the skeleton but not the error branch).
 * The banner itself had no role="alert" and no retry — the only
 * recovery was the section-header refresh icon, with nothing pointing
 * at it.
 *
 * The fix follows the orders/tickets skeleton→error→empty precedence.
 * These tests pin:
 *
 *   1. A failed FIRST load renders the shared FetchErrorCard with its
 *      own retry — NEVER the «لا توجد جلسات بعد» empty state.
 *   2. The retry re-fetches and recovers once the gateway responds.
 *   3. A failed REFRESH of a rendered list keeps the stale rows and
 *      surfaces the inline banner (role="alert") with its own retry —
 *      the stale-keep idiom; no FetchErrorCard while rows stand.
 *
 * `@/lib/auth`, the admin shell and the toast hook are mocked at the
 * module boundary (whatsapp-session-actions.test.tsx pattern).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminWhatsAppPage from "@/pages/admin/whatsapp";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const SESSIONS = [
  { id: "sess-1", name: "subnation-otp", status: "ready" },
  { id: "sess-2", name: "subnation-alerts", status: "disconnected" },
];

/** Minimal Response-like object — avoids depending on a global Response. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  return render(
    <Router>
      <AdminWhatsAppPage />
    </Router>,
  );
}

/** The sessions list GET — every other method/URL falls through to ok. */
const sessionsGet =
  (over: { ok?: boolean; status?: number; body?: unknown }) =>
  async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/sessions") && method === "GET") return resLike(over);
    return resLike({ body: { sessions: SESSIONS } });
  };

describe("AdminWhatsAppPage — a failed load is an error, not a false empty (A2-2)", () => {
  beforeEach(() => {
    toastMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a failed FIRST load renders the error card with retry, never the empty state", async () => {
    fetchMock.mockImplementation(
      sessionsGet({ ok: false, status: 502, body: { error: "البوابة غير متاحة" } }),
    );

    renderPage();

    // The shared error card (role="alert" is built into FetchErrorCard)
    // — NOT the misleading «لا توجد جلسات بعد» pair.
    expect(await screen.findByText("تعذّر تحميل جلسات واتساب")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد جلسات بعد")).not.toBeInTheDocument();
    expect(screen.queryByText("أنشئ جلسة أولى للبدء.")).not.toBeInTheDocument();
    // The card carries its own recovery action.
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("the error card retry re-fetches and recovers once the gateway responds", async () => {
    fetchMock.mockImplementation(
      sessionsGet({ ok: false, status: 500, body: { error: "خلل داخلي" } }),
    );

    renderPage();
    expect(await screen.findByText("تعذّر تحميل جلسات واتساب")).toBeInTheDocument();

    // The gateway recovers — the retry lands the real list.
    fetchMock.mockImplementation(sessionsGet({ body: { sessions: SESSIONS } }));
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    await waitFor(() => {
      expect(screen.getByText("subnation-otp")).toBeInTheDocument();
    });
    expect(screen.queryByText("تعذّر تحميل جلسات واتساب")).not.toBeInTheDocument();
  });

  it("a failed REFRESH of a rendered list keeps the rows + inline banner (role=alert + retry)", async () => {
    // First load succeeds…
    fetchMock.mockImplementation(sessionsGet({ body: { sessions: SESSIONS } }));
    renderPage();
    expect(await screen.findByText("subnation-otp")).toBeInTheDocument();

    // …then a refresh fails (the gateway blips). The rows must keep
    // standing with the inline banner — not collapse to the error card
    // over an empty list.
    fetchMock.mockImplementation(
      sessionsGet({ ok: false, status: 502, body: { error: "البوابة غير متاحة" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));

    // The banner surfaces the server's own Arabic message.
    await waitFor(() => {
      expect(screen.getByText("البوابة غير متاحة")).toBeInTheDocument();
    });
    // Stale-keep: both rows survive the failed refresh.
    expect(screen.getByText("subnation-otp")).toBeInTheDocument();
    expect(screen.getByText("subnation-alerts")).toBeInTheDocument();
    // No FetchErrorCard while rows stand (that card is the FIRST-load
    // surface — the banner owns the stale-refresh case).
    expect(screen.queryByText("تعذّر تحميل جلسات واتساب")).not.toBeInTheDocument();

    // The banner announces itself and carries its own retry.
    const banner = screen.getByText("البوابة غير متاحة").closest("div");
    expect(banner).toHaveAttribute("role", "alert");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});
