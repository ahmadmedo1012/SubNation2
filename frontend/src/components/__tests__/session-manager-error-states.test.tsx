/**
 * R127 (B15-2) — SessionManager (/profile) state-honesty tests.
 *
 * Two defects pinned (the last false-empty + silent-failure pair in
 * the walked admin/storefront set):
 *
 *   1. False-empty on failure: the sessions fetch had NO r.ok guard —
 *      a 401/500/502 outage envelope parsed to {} → sessions=[] → the
 *      «لا توجد جلسات نشطة لعرضها.» empty state (the exact
 *      false-empty class the admin console systematically killed,
 *      B5-04). Now: an inline role=alert Arabic line (server wording
 *      via getErrorMessage, generic Arabic fallback otherwise) + a
 *      retry that re-runs the fetch — the card stays.
 *
 *   2. Silent logout-all failure: `if (response.ok) …` meant a FAILED
 *      logout-all was a silent no-op — the button clicks, nothing
 *      happens, and the user still believes every device was revoked.
 *      Now: a destructive toast (the console's getErrorMessage
 *      idiom); the confirm dialog itself is unchanged (its tests live
 *      in session-manager-confirm.test.tsx).
 *
 * The auth hook and the toast shim are mocked at the module boundary
 * (vitest-config pattern); the shared useConfirm AlertDialog runs for
 * real.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "@/components/SessionManager";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const fetchMock = vi.fn();

/** Minimal Response-like object — avoids depending on a global Response. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const SESSION = {
  id: "s1",
  device: "Chrome · Windows",
  lastActive: "2026-10-01T10:00:00.000Z",
  current: true,
};

/** Confirms the logout-all AlertDialog (waits out the load first). */
async function openConfirmAndAccept() {
  const trigger = await screen.findByRole("button", {
    name: /تسجيل الخروج من جميع الأجهزة/,
  });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد" }));
}

describe("SessionManager — honest load state (B15-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a failed sessions load (r.ok=false) is an inline Arabic error — never the false «لا توجد جلسات نشطة»", async () => {
    // A 503 outage with a message-less body — the exact envelope that
    // used to parse to {} and render the empty state.
    fetchMock.mockResolvedValueOnce(resLike({ ok: false, status: 503, body: {} }));

    render(<SessionManager />);

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    // getErrorMessage({}) — the generic Arabic fallback.
    expect(screen.getByText("حدث خطأ. حاول مرة أخرى")).toBeInTheDocument();
    // The false-empty line is gone on failure.
    expect(screen.queryByText("لا توجد جلسات نشطة لعرضها.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("a server-provided Arabic reason rides the error line verbatim (96-F7 guard)", async () => {
    fetchMock.mockResolvedValueOnce(
      resLike({ ok: false, status: 500, body: { error: "انتهت صلاحية الجلسة" } }),
    );

    render(<SessionManager />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("انتهت صلاحية الجلسة")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد جلسات نشطة لعرضها.")).not.toBeInTheDocument();
  });

  it("a network-level load failure surfaces the Arabic connection line, not the empty state", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<SessionManager />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText("تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى."),
    ).toBeInTheDocument();
    expect(screen.queryByText("لا توجد جلسات نشطة لعرضها.")).not.toBeInTheDocument();
  });

  it("«إعادة المحاولة» re-runs the fetch and recovers when the retry succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(resLike({ ok: false, status: 500, body: {} }))
      .mockResolvedValueOnce(resLike({ ok: true, body: { sessions: [SESSION] } }));

    render(<SessionManager />);
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    // The retried fetch succeeds → the session list replaces the error.
    expect(await screen.findByText("Chrome · Windows")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a SUCCESSFUL load with zero sessions still renders the honest empty state", async () => {
    // The r.ok guard must not eat the genuine empty list — an empty
    // sessions array on a 200 IS "no active sessions".
    fetchMock.mockResolvedValueOnce(resLike({ ok: true, body: { sessions: [] } }));

    render(<SessionManager />);

    expect(await screen.findByText("لا توجد جلسات نشطة لعرضها.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("SessionManager — logout-all failure is surfaced, not swallowed (B15-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // The sessions load succeeds in every test here — the logout-all
    // path is the subject.
    fetchMock.mockImplementation(async (input: unknown) => {
      if (String(input) === "/api/auth/sessions") {
        return resLike({ ok: true, body: { sessions: [SESSION] } });
      }
      return resLike({ ok: false, status: 500, body: { error: "تعذّر إتمام الطلب" } });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a FAILED logout-all fires a destructive toast with the server's Arabic reason (was: a silent no-op)", async () => {
    render(<SessionManager />);

    await openConfirmAndAccept();

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("فشل تسجيل الخروج من جميع الأجهزة");
    expect(toastArg.description).toBe("تعذّر إتمام الطلب");
    expect(toastArg.variant).toBe("destructive");
    // The session list is untouched — the failure state is honest in
    // BOTH directions (nothing was revoked, and the list still says so).
    expect(screen.getByText("Chrome · Windows")).toBeInTheDocument();
  });

  it("a network-level logout-all failure toasts the Arabic connection line — never a silent swallow", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      if (String(input) === "/api/auth/sessions") {
        return resLike({ ok: true, body: { sessions: [SESSION] } });
      }
      throw new TypeError("Failed to fetch");
    });

    render(<SessionManager />);

    await openConfirmAndAccept();

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("فشل تسجيل الخروج من جميع الأجهزة");
    expect(toastArg.description).toBe("تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.");
    expect(toastArg.variant).toBe("destructive");
  });

  it("a SUCCESSFUL logout-all fires no error toast (navigation proceeds — the fetch contract is pinned in the confirm suite)", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      if (String(input) === "/api/auth/sessions") {
        return resLike({ ok: true, body: { sessions: [SESSION] } });
      }
      // ok:true — jsdom cannot follow the window.location navigation,
      // so the assertion here is purely "no failure toast fired".
      return resLike({ ok: true, body: {} });
    });

    render(<SessionManager />);

    await openConfirmAndAccept();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(toastMock).not.toHaveBeenCalled();
  });
});
