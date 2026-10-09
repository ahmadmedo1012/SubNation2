/**
 * 97-F5 (R97-02 coordination — backend 97-F2) — admin login no longer
 * reads a body token; the httpOnly cookie is the sole session transport.
 *
 * /api/admin/login and /api/admin/login/verify-2fa used to return a
 * `token` field the page stored via setAdminToken. 97-F2 removed the
 * field from both bodies (the cookie they Set-Cookie is the session —
 * a body token kept a full-session JWT readable from JS memory). With
 * the old page code, login would set adminToken=null (dead gate) and
 * verify-2fa would HARD-FAIL on `!data?.token`.
 *
 * The new flow bootstraps the in-memory session exactly like the boot
 * path: /api/admin/probe verifies the cookie round-trip, then the page
 * sets the COOKIE_AUTH_SENTINEL + permissions and navigates. These
 * tests pin:
 *
 *   1. non-2FA login success → probe bootstrap → sentinel + navigate;
 *   2. verify-2fa success with a token-less 2xx body → same bootstrap
 *      (the old code path would have thrown) + the temp_token (2FA
 *      challenge credential) is what the verify request carries;
 *   3. a cookie that did NOT round-trip (blocked/embedded) → honest
 *      inline Arabic error, no navigation, adminToken stays null;
 *   4. wrong-OTP 401 keeps the inline error (96-F7 behavior intact).
 *
 * The REAL AuthProvider renders around the page (the fix spans the
 * page + the provider's exported sentinel).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminLoginPage from "@/pages/admin/login";
import { AuthProvider, COOKIE_AUTH_SENTINEL, useAuth } from "@/lib/auth";
import { useAdminLogin } from "@workspace/api-client-react";

const mutateMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useAdminLogin: vi.fn(() => ({ mutate: mutateMock, isPending: false })),
  // Stubs for the other importers of the mocked module in this graph
  // (AuthProvider imports the me query-key helper).
  getGetMeQueryKey: () => ["/api/auth/me"],
}));

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * The probe's view of the admin cookie. The verify-2fa mock flips it to
 * true — simulating the backend's Set-Cookie side effect — exactly like
 * the real endpoint establishes the session.
 */
let adminCookieLive = false;

const fetchMock = vi.fn(
  (
    input: unknown,
    // The verify-2fa call passes (url, RequestInit) — carrying the arg
    // in the signature types mock.calls' [1] for the body assertion below.
    _init?: RequestInit,
  ): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
    const url = typeof input === "string" ? input : String(input);
    if (url === "/api/admin/probe") {
      return Promise.resolve(
        jsonResponse(
          200,
          adminCookieLive
            ? { authenticated: true, admin: { id: 1, display_name: "root", permissions: ["all"] } }
            : { authenticated: false },
        ),
      );
    }
    if (url === "/api/admin/login/verify-2fa") {
      adminCookieLive = true; // the Set-Cookie side effect
      // R97-02 shape: display_name/role/permissions — NO token field.
      return Promise.resolve(
        jsonResponse(200, { display_name: "root", role: "admin", permissions: ["all"] }),
      );
    }
    // /api/auth/probe + anything else: unauthenticated.
    return Promise.resolve(jsonResponse(200, { authenticated: false }));
  },
);

function Harness() {
  const { adminToken, adminPermissions } = useAuth();
  return (
    <>
      <span data-testid="admin-token-state">{adminToken ?? "admin-signed-out"}</span>
      <span data-testid="admin-permissions">{adminPermissions.join(",")}</span>
      <AdminLoginPage />
    </>
  );
}

function renderLogin() {
  // The AuthProvider's admin probe only fires on /admin* boots — start
  // on the login page like a real operator would.
  window.history.pushState({}, "", "/admin/login");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Router>
          <Harness />
        </Router>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

type LoginConfig = {
  mutation?: {
    onSuccess?: (data: unknown) => void;
    onError?: (err: unknown) => void;
  };
};

/** The mutation CONFIG the page passed to useAdminLogin (last render). */
function lastLoginConfig(): LoginConfig | undefined {
  const calls = vi.mocked(useAdminLogin).mock.calls as unknown as Array<[LoginConfig?] | []>;
  return calls[calls.length - 1]?.[0];
}

function fillCredentials() {
  fireEvent.change(screen.getByLabelText("اسم المستخدم"), {
    target: { value: "root" },
  });
  fireEvent.change(screen.getByLabelText("كلمة المرور"), {
    target: { value: "hunter2" },
  });
}

function submitForm() {
  fireEvent.submit(document.querySelector("form")!);
}

/** Simulates the orval mutation settling — the mock never runs callbacks. */
async function settleLoginSuccess(body: unknown) {
  await act(async () => {
    lastLoginConfig()?.mutation?.onSuccess?.(body);
  });
}

/**
 * R126-L2 (A3-2): Simulates the orval mutation REJECTING — the real
 * client rejects with customFetch's ApiError (technical English prefix
 * on .message, the parsed body on .data).
 */
async function settleLoginError(err: unknown) {
  await act(async () => {
    lastLoginConfig()?.mutation?.onError?.(err);
  });
}

/** The customFetch ApiError shape for a JSON error body. */
function apiErrorLike(status: number, statusText: string, data: unknown) {
  const body = data as { error?: string } | null;
  const message = body?.error
    ? `HTTP ${status} ${statusText}: ${body.error}`
    : `HTTP ${status} ${statusText}`;
  return Object.assign(new Error(message), {
    name: "ApiError",
    status,
    statusText,
    data,
  });
}

beforeEach(() => {
  mutateMock.mockReset();
  vi.mocked(useAdminLogin).mockClear();
  adminCookieLive = false;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminLoginPage — password-step error banner speaks Arabic only (R126-L2 / A3-2)", () => {
  it("a 401 ApiError renders the server's Arabic message with NO English HTTP prefix", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText("لوحة الإدارة")).toBeInTheDocument());

    fillCredentials();
    submitForm();
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

    // The real mutation's rejection shape: .message carries customFetch's
    // technical prefix, .data carries the parsed backend body. The old
    // code read .message verbatim → «HTTP 401 Unauthorized: اسم المستخدم
    // أو كلمة المرور غير صحيحة» in the banner.
    await settleLoginError(
      apiErrorLike(401, "Unauthorized", {
        error: "اسم المستخدم أو كلمة المرور غير صحيحة",
        code: "UNAUTHORIZED",
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("اسم المستخدم أو كلمة المرور غير صحيحة");
    expect(alert.textContent).not.toContain("HTTP");
    expect(alert.textContent).not.toContain("Unauthorized");
  });

  it("a 429 lockout ApiError keeps the server's minutes — no «Too Many Requests»", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText("لوحة الإدارة")).toBeInTheDocument());

    fillCredentials();
    submitForm();
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

    await settleLoginError(
      apiErrorLike(429, "Too Many Requests", {
        error: "الحساب مقفل بسبب محاولات فاشلة. حاول بعد 5 دقيقة.",
        code: "ACCOUNT_LOCKED",
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("الحساب مقفل بسبب محاولات فاشلة. حاول بعد 5 دقيقة.");
    expect(alert.textContent).not.toContain("HTTP");
    expect(alert.textContent).not.toContain("Too Many Requests");
  });

  it("a network-level failure (non-ApiError) speaks the shared Arabic network copy", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText("لوحة الإدارة")).toBeInTheDocument());

    fillCredentials();
    submitForm();
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

    // The old code surfaced this verbatim («Failed to fetch»).
    await settleLoginError(new TypeError("Failed to fetch"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّر الاتصال بالخدمة");
    expect(alert.textContent).not.toContain("Failed to fetch");
  });
});

describe("AdminLoginPage — cookie-only session bootstrap (97-F5 / R97-02)", () => {
  it("non-2FA login: no body token is read — the probe bootstraps the sentinel + permissions + navigation", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText("لوحة الإدارة")).toBeInTheDocument());

    fillCredentials();
    submitForm();
    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith({ data: { username: "root", password: "hunter2" } });
    });

    // The (mocked) login endpoint just Set-Cookied the session…
    adminCookieLive = true;
    // …and answered with the R97-02 body: NO token field at all.
    await settleLoginSuccess({ display_name: "root", role: "admin", permissions: ["orders"] });

    // The session state comes from the probe round-trip, not the body.
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent(COOKIE_AUTH_SENTINEL);
    });
    // Permissions bootstrap from the PROBE's admin shape (the session's
    // own source of truth), not from the possibly-stale login body.
    await waitFor(() => {
      expect(screen.getByTestId("admin-permissions")).toHaveTextContent("all");
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/probe",
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("verify-2fa success: a token-LESS 2xx body bootstraps the session (the old code hard-failed here)", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText("لوحة الإدارة")).toBeInTheDocument());

    fillCredentials();
    submitForm();
    // /login answered with the 2FA challenge (temp_token stays — it is
    // a 10-minute challenge credential, NOT a session).
    await settleLoginSuccess({ requires_2fa: true, temp_token: "temp-123" });
    await waitFor(() => expect(screen.getByText("المصادقة الثنائية")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("رمز التحقق (6 أرقام)"), {
      target: { value: "123456" },
    });
    submitForm();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/login/verify-2fa",
        expect.objectContaining({ method: "POST" }),
      );
    });
    // The verify request carries the CHALLENGE token + the code — never
    // a session credential in the body.
    const verifyCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/admin/login/verify-2fa",
    )!;
    expect(JSON.parse((verifyCall[1] as RequestInit).body as string)).toEqual({
      temp_token: "temp-123",
      code: "123456",
    });

    // Token-less 2xx + live cookie → probe bootstrap → sentinel + panel.
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent(COOKIE_AUTH_SENTINEL);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin");
    });
  });

  it("a cookie that did not round-trip surfaces an honest inline error (no navigation, no sentinel)", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText("لوحة الإدارة")).toBeInTheDocument());

    fillCredentials();
    submitForm();
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));

    // The login "succeeded" server-side, but the cookie never landed in
    // this browser (third-party-cookie blocking / exotic embedding) —
    // the probe is the honest arbiter.
    await settleLoginSuccess({ display_name: "root", role: "admin", permissions: [] });

    await waitFor(() => {
      expect(screen.getByText(/تعذّر تثبيت جلسة الإدارة/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("admin-token-state")).toHaveTextContent("admin-signed-out");
    expect(window.location.pathname).toBe("/admin/login");
    // Inline error styling (role=alert) — not a toast, not silence.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("wrong OTP keeps the inline Arabic error and never bootstraps (96-F7 intact)", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText("لوحة الإدارة")).toBeInTheDocument());

    fillCredentials();
    submitForm();
    await settleLoginSuccess({ requires_2fa: true, temp_token: "temp-456" });
    await waitFor(() => expect(screen.getByText("المصادقة الثنائية")).toBeInTheDocument());

    // Swap the global fetch: the verify endpoint now answers the honest
    // 401 envelope (wrong TOTP) and the probe stays unauthenticated.
    // (Body without a `code` — getErrorMessage then passes the route's
    // precise Arabic sentence through verbatim.)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String(input);
        if (url === "/api/admin/login/verify-2fa") {
          return jsonResponse(401, { error: "رمز التحقق غير صحيح" });
        }
        return jsonResponse(200, { authenticated: false });
      }),
    );

    fireEvent.change(screen.getByLabelText("رمز التحقق (6 أرقام)"), {
      target: { value: "000000" },
    });
    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("رمز التحقق غير صحيح");
    expect(screen.getByTestId("admin-token-state")).toHaveTextContent("admin-signed-out");
    expect(window.location.pathname).toBe("/admin/login");
  });

  it("97-F5 (F-08 pattern): Enter while the 2FA verify is in flight is a NO-OP (no double verify)", async () => {
    renderLogin();
    await waitFor(() => expect(screen.getByText("لوحة الإدارة")).toBeInTheDocument());

    fillCredentials();
    submitForm();
    await settleLoginSuccess({ requires_2fa: true, temp_token: "temp-789" });
    await waitFor(() => expect(screen.getByText("المصادقة الثنائية")).toBeInTheDocument());

    // The verify request HANGS (flaky network) — isVerifying stays true
    // and the submit button renders disabled. Enter (implicit form
    // submission) must NOT bypass that disabled state.
    type Res = { ok: boolean; status: number; json: () => Promise<unknown> };
    let releaseVerify!: (v: Res) => void;
    const hangingVerify = new Promise<Res>((resolve) => {
      releaseVerify = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown): Promise<Res> => {
        const url = typeof input === "string" ? input : String(input);
        if (url === "/api/admin/login/verify-2fa") return hangingVerify;
        if (url === "/api/admin/probe") {
          return jsonResponse(
            200,
            adminCookieLive
              ? { authenticated: true, admin: { id: 1, permissions: ["all"] } }
              : { authenticated: false },
          );
        }
        return jsonResponse(200, { authenticated: false });
      }),
    );

    fireEvent.change(screen.getByLabelText("رمز التحقق (6 أرقام)"), {
      target: { value: "123456" },
    });
    submitForm();
    await waitFor(() => {
      expect(
        vi.mocked(fetch).mock.calls.filter((c) => String(c[0]) === "/api/admin/login/verify-2fa"),
      ).toHaveLength(1);
    });

    // Double-Enter while disabled — the guard in handleSubmit (the exact
    // button predicate) plus the same-tick ref must swallow both.
    submitForm();
    submitForm();
    expect(
      vi.mocked(fetch).mock.calls.filter((c) => String(c[0]) === "/api/admin/login/verify-2fa"),
    ).toHaveLength(1);

    // The hung response finally lands (cookie Set-Cookied) — the flow
    // completes normally through the probe bootstrap.
    adminCookieLive = true;
    await act(async () => {
      releaseVerify(jsonResponse(200, { display_name: "root", role: "admin" }));
    });
    await waitFor(() => {
      expect(screen.getByTestId("admin-token-state")).toHaveTextContent(COOKIE_AUTH_SENTINEL);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin");
    });
  });
});
