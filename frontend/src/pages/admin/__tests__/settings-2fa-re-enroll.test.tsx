/**
 * R125-I5 (A3-1 P2) — settings 2FA re-enrollment flow + identity-card
 * role badge.
 *
 * The security tab's TwoFactorSetup used to be mounted unconditionally
 * with the same «إعداد المصادقة الثنائية» CTA for every admin. An
 * already-enrolled admin clicked it and hit the backend's S5 gate
 * (POST /api/admin/2fa/setup requires current_password whenever TOTP is
 * already enabled — rotating an enabled secret DISABLES 2FA until the
 * new one is verified) with a guaranteed 400 and no path forward: no
 * password field, no rotate affordance, nothing.
 *
 * These tests pin the new contract (the page's FIRST render suite —
 * A10 noted settings had only 2 source-scan copy pins):
 *
 *   1. An enrolled admin sees the «مفعّلة» status card + the rotate CTA
 *      — NEVER the fresh-enrollment CTA.
 *   2. The rotate path exposes a current-password field (label↔id).
 *   3. Submitting the rotate path sends `current_password` in the POST
 *      body and proceeds to the QR step on 200.
 *   4. The old dead-end is structurally unreachable: no POST fires
 *      without the password (the client-side gate).
 *   5. A backend rejection (the S5 gate's 429 lockout response) surfaces
 *      the Arabic message INSIDE the rotate form — the path forward
 *      stays visible. (A wrong-password 401 rides the global
 *      session-expiry handler instead — the same pre-existing collision
 *      /change-password has; see the worklog note.)
 *   6. A fresh admin gets the classic bodyless flow (the backend's
 *      optional-password branch stays optional — no regression).
 *   7. (A3-9) The account tab's identity card renders the Arabic role
 *      label instead of the raw English token, with a raw fallback for
 *      unknown values.
 *   8. (R126-L2 / A3-1 P1) The account tab's password-change form is
 *      HONEST about the A8-01 session-revocation semantics: the hint
 *      states every session ends (the old copy promised the opposite),
 *      and a successful change surfaces the backend's message, clears
 *      the dead in-memory session, and lands on /admin/login — no
 *      surprise-401 redirect.
 *   9. (R126-L2 / A3-3) The rotate gate's 429 lockout surfaces the
 *      server's specific wording (with the minute count) — the code map
 *      is now the fallback, not the winner.
 *
 * Module-boundary mocks follow whatsapp-session-actions.test.tsx.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminSettingsPage from "@/pages/admin/settings";

const { toastMock, setAdminTokenMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  // R126-L2 (A3-1): the password-change success path clears the
  // in-memory session — the mock must be a stable reference to pin it.
  setAdminTokenMock: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    setAdminToken: setAdminTokenMock,
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
  // admin-session.ts imports the module-level toast (the global 401
  // handler's copy) — expose the same spy so any accidental firing is
  // visible instead of a TypeError.
  toast: toastMock,
}));

// The QR tile is generated client-side via `import("qrcode")` after the
// backend mints the secret — mock the dynamic import (deterministic, no
// canvas work in jsdom).
vi.mock("qrcode", () => ({
  default: {
    toDataURL: (_url: string, cb: (err: Error | null, url: string) => void) =>
      cb(null, "data:image/png;base64,mock-qr"),
  },
}));

const SESSION_ENROLLED = {
  id: 1,
  username: "root",
  display_name: "المدير",
  role: "admin",
  totp_enabled: true,
  permissions: ["all"],
  created_at: "2026-01-01T00:00:00.000Z",
};

const SESSION_FRESH = {
  ...SESSION_ENROLLED,
  id: 2,
  username: "newbie",
  totp_enabled: false,
};

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
let sessionFixture: Record<string, unknown> = SESSION_ENROLLED;
let setupResponse: () => Response = () =>
  Promise.resolve(
    resLike({ body: { secret: "JBSWY3DPEHPK3PXP", otpauth_url: "otpauth://totp/SubNation" } }),
  );
// R126-L2 (A3-1): the backend's honest change-password 200 body — the
// message the success path must surface verbatim.
const CHANGE_PASSWORD_OK_MESSAGE = "تم تغيير كلمة المرور بنجاح — سيتم تسجيل خروجك من كل الجلسات";
let changePasswordResponse: () => Response = () =>
  Promise.resolve(resLike({ body: { success: true, message: CHANGE_PASSWORD_OK_MESSAGE } }));

function renderSettingsTab(tab: string) {
  window.history.replaceState(null, "", `/admin/settings?tab=${tab}`);
  return render(
    <Router>
      <AdminSettingsPage />
    </Router>,
  );
}

beforeEach(() => {
  toastMock.mockReset();
  setAdminTokenMock.mockReset();
  fetchMock.mockReset();
  // R125 fix (parent): both fixtures are module-level lets — reset them
  // HERE too, or a test that reassigns one (the 429 case) leaks its
  // response into every later test in the file (test-order coupling).
  sessionFixture = SESSION_ENROLLED;
  setupResponse = () =>
    Promise.resolve(
      resLike({ body: { secret: "JBSWY3DPEHPK3PXP", otpauth_url: "otpauth://totp/SubNation" } }),
    );
  changePasswordResponse = () =>
    Promise.resolve(resLike({ body: { success: true, message: CHANGE_PASSWORD_OK_MESSAGE } }));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/admin/session")) {
      return Promise.resolve(resLike({ body: sessionFixture }));
    }
    if (url === "/api/admin/settings") return Promise.resolve(resLike({ body: {} }));
    if (url === "/api/admin/settings/auth") {
      return Promise.resolve(resLike({ body: { providers: [] } }));
    }
    if (url === "/api/admin/2fa/setup") return setupResponse();
    if (url === "/api/admin/change-password") return changePasswordResponse();
    return Promise.resolve(resLike());
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("AdminSettingsPage security tab — 2FA re-enroll flow (A3-1 P2)", () => {
  it("an ENROLLED admin sees «المصادقة الثنائية مفعّلة» + the rotate CTA — never the fresh-enrollment CTA", async () => {
    sessionFixture = SESSION_ENROLLED;
    renderSettingsTab("security");

    expect(await screen.findByText("المصادقة الثنائية مفعّلة")).toBeInTheDocument();
    const rotate = await screen.findByRole("button", {
      name: /إعادة إعداد المصادقة الثنائية/,
    });
    expect(rotate).toBeInTheDocument();
    // The old dead-end CTA (fresh enrollment) must NOT render.
    expect(
      screen.queryByRole("button", { name: "إعداد المصادقة الثنائية" }),
    ).not.toBeInTheDocument();
  });

  it("the rotate CTA reveals a labeled current-password field; submitting carries current_password and reaches the QR step", async () => {
    sessionFixture = SESSION_ENROLLED;
    renderSettingsTab("security");

    fireEvent.click(await screen.findByRole("button", { name: /إعادة إعداد المصادقة الثنائية/ }));

    // A real label↔id pair (the r103 idiom) — the gate is honest about
    // what it asks for.
    const passwordInput = await screen.findByLabelText("كلمة المرور الحالية");
    fireEvent.change(passwordInput, { target: { value: "CorrectHorse-93!" } });
    fireEvent.click(screen.getByRole("button", { name: /متابعة/ }));

    await waitFor(() => {
      const setupCall = fetchMock.mock.calls.find(
        ([url]) => String(url) === "/api/admin/2fa/setup",
      );
      expect(setupCall).toBeTruthy();
      const init = (setupCall![1] ?? {}) as RequestInit;
      // THE pin: the rotate POST carries current_password (the S5 gate's
      // requirement) — the old no-body 400 dead-end is unreachable.
      expect(JSON.parse(String(init.body))).toEqual({
        current_password: "CorrectHorse-93!",
      });
    });

    // The QR step rendered (backend minted the new secret).
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
  });

  it("the enrolled branch never fires the bodyless POST: empty password → client gate, zero /2fa/setup calls", async () => {
    sessionFixture = SESSION_ENROLLED;
    renderSettingsTab("security");

    fireEvent.click(await screen.findByRole("button", { name: /إعادة إعداد المصادقة الثنائية/ }));
    // The متابعة button is disabled while the password is empty…
    const submit = screen.getByRole("button", { name: /متابعة/ });
    expect(submit).toBeDisabled();
    // …so even a forced submit cannot fire the request the backend
    // would 400.
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === "/api/admin/2fa/setup"),
    ).toHaveLength(0);
  });

  it("a backend rejection (429 lockout) surfaces the Arabic message INSIDE the rotate form", async () => {
    sessionFixture = SESSION_ENROLLED;
    setupResponse = () =>
      Promise.resolve(
        resLike({
          ok: false,
          status: 429,
          body: { error: "محاولات كثيرة. حاول بعد 15 دقيقة.", code: "ACCOUNT_LOCKED" },
        }),
      );
    renderSettingsTab("security");

    fireEvent.click(await screen.findByRole("button", { name: /إعادة إعداد المصادقة الثنائية/ }));
    fireEvent.change(await screen.findByLabelText("كلمة المرور الحالية"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /متابعة/ }));

    expect(
      // R126-L2 (A3-3): the server's specific Arabic message now wins
      // over the code map — the rotate gate's lockout text carries the
      // wait time («بعد 15 دقيقة») the generic ACCOUNT_LOCKED map entry
      // used to drop (the R125 pin asserted the map's text by design;
      // the priority flip supersedes it).
      await screen.findByText("محاولات كثيرة. حاول بعد 15 دقيقة."),
    ).toBeInTheDocument();
    // Still on the password step — no QR, no success.
    expect(screen.queryByText(/امسح رمز الاستجابة/)).not.toBeInTheDocument();
  });

  it("a FRESH admin keeps the bodyless enrollment flow (no regression on the optional-password branch)", async () => {
    sessionFixture = SESSION_FRESH;
    renderSettingsTab("security");

    // Wait for the session probe so the fresh branch is settled.
    await screen.findByRole("button", { name: "إعداد المصادقة الثنائية" });
    fireEvent.click(screen.getByRole("button", { name: "إعداد المصادقة الثنائية" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/admin/2fa/setup")).toBe(
        true,
      );
    });
    const setupCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/admin/2fa/setup")!;
    const init = (setupCall[1] ?? {}) as RequestInit;
    // Fresh enrollment stays bodyless — the backend's optional branch.
    expect(init.body).toBeUndefined();
  });

  it("the 6-digit verify input has a programmatic label (A6-B13) once the QR step renders", async () => {
    sessionFixture = SESSION_ENROLLED;
    renderSettingsTab("security");

    fireEvent.click(await screen.findByRole("button", { name: /إعادة إعداد المصادقة الثنائية/ }));
    fireEvent.change(await screen.findByLabelText("كلمة المرور الحالية"), {
      target: { value: "CorrectHorse-93!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /متابعة/ }));

    // The verify input resolves through its label, not just placeholder.
    expect(await screen.findByLabelText("رمز التحقق المكوّن من 6 أرقام")).toBeInTheDocument();
  });
});

describe("AdminSettingsPage account tab — identity card role badge (A3-9)", () => {
  it("renders the Arabic role label instead of the raw English token", async () => {
    sessionFixture = { ...SESSION_ENROLLED, role: "super_admin" };
    renderSettingsTab("account");

    expect(await screen.findByText("مسؤول رئيسي")).toBeInTheDocument();
    expect(screen.queryByText("super_admin")).not.toBeInTheDocument();
    expect(screen.queryByText("SUPER_ADMIN")).not.toBeInTheDocument();
  });

  it("unknown role values fall back to the raw token (never a wrong Arabic label)", async () => {
    sessionFixture = { ...SESSION_ENROLLED, role: "ops" };
    renderSettingsTab("account");

    expect(await screen.findByText("ops")).toBeInTheDocument();
  });
});

describe("AdminSettingsPage account tab — password-change honesty (R126-L2 / A3-1 P1)", () => {
  it("the form hint states the A8-01 truth: every session ends — the old «لن يتم إنهاء» promise is gone", async () => {
    sessionFixture = SESSION_ENROLLED;
    renderSettingsTab("account");

    // Wait for the session load so the password form is settled.
    expect(await screen.findByText("تغيير كلمة المرور")).toBeInTheDocument();
    // THE copy pin: the hint discloses the all-sessions revocation + the
    // re-login consequence (the backend revokes EVERY session — A8-01).
    expect(await screen.findByText(/سيتم إنهاء جميع الجلسات/)).toBeInTheDocument();
    expect(screen.getByText(/تسجيل الدخول مجدداً/)).toBeInTheDocument();
    // The old inverted promise must be gone entirely.
    expect(screen.queryByText(/لن يتم إنهاء/)).not.toBeInTheDocument();
  });

  it("a successful change surfaces the backend's message, clears the dead session, and lands on /admin/login", async () => {
    sessionFixture = SESSION_ENROLLED;
    renderSettingsTab("account");

    expect(await screen.findByText("تغيير كلمة المرور")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("كلمة المرور الحالية"), {
      target: { value: "OldPass-123" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), {
      target: { value: "NewPass-456" },
    });
    fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور الجديدة"), {
      target: { value: "NewPass-456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /تحديث كلمة المرور/ }));

    // The POST carried the sudo body.
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => String(url) === "/api/admin/change-password",
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        current_password: "OldPass-123",
        new_password: "NewPass-456",
      });
    });

    // THE honesty pin: the toast shows the BACKEND's message (all
    // sessions end) — not the old session-blind «تم تغيير كلمة المرور
    // بنجاح» — and it is the ONLY toast (no surprise «انتهت الجلسة»
    // from a 401 that no longer fires).
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ title: CHANGE_PASSWORD_OK_MESSAGE, variant: "success" }),
    );

    // The dead in-memory session is cleared proactively…
    await waitFor(() => expect(setAdminTokenMock).toHaveBeenCalledWith(null));
    // …and the page lands on the admin login deliberately — the current
    // session was revoked server-side (A8-01), so the operator re-logs
    // in instead of waiting for a 401 to bounce them.
    await waitFor(() => expect(window.location.pathname).toBe("/admin/login"));
  });
});
