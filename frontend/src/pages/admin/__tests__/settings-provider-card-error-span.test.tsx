/**
 * B14-14 (R127-L11) — the provider card's inline error span was dead UI.
 *
 * settings/provider-card.tsx rendered `{error && <span …>{error}</span>}`
 * in the expanded actions row, but `error` was only ever CLEARED
 * (`setError("")` at save() start) — never set — so every save failure
 * surfaced ONLY via the destructive toast; the designed inline
 * affordance (the message pinned next to the «حفظ التغييرات» button)
 * could never appear.
 *
 * These tests pin the restored wiring (the card's first render suite —
 * A10's settings coverage was 2 source-scan pins + the 2FA/account
 * suite; the provider card itself had none):
 *
 *   1. A failed save surfaces the Arabic message BOTH in the inline
 *      span AND in the toast (both channels, one message).
 *   2. A subsequent successful save clears the span — `setError("")`
 *      at save() start keeps every retry clean — and fires onUpdate
 *      with the server's authoritative enabled/config.
 *
 * Module-boundary mocks follow settings-2fa-re-enroll.test.tsx (the
 * real AdminSessionExpiredError survives via importActual — the card's
 * session-expiry early-return is class-identity based).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderCard, type AuthProvider } from "@/pages/admin/settings/provider-card";
import { AdminSessionExpiredError, adminFetchJson } from "@/lib/admin-session";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/lib/admin-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-session")>();
  // Only the fetcher is stubbed — AdminSessionExpiredError stays the
  // REAL class so the card's instanceof early-return keeps its
  // class-identity semantics.
  return { ...actual, adminFetchJson: vi.fn() };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

// A minimal OAuth provider card (google) with one non-secret field —
// enough to expand the card and reach the actions row.
const PROVIDER: AuthProvider = {
  id: "google",
  label: "Google",
  icon: "google",
  color: "",
  auth_type: "oauth_redirect",
  description: "الدخول عبر حساب Google",
  setup_url: "https://example.com/setup",
  fields: [{ key: "client_id", label: "معرّف العميل", isSecret: false, placeholder: "123…" }],
  enabled: false,
  config: {},
};

function renderCard(onUpdate = vi.fn()) {
  render(<ProviderCard provider={PROVIDER} adminToken="test-admin-token" onUpdate={onUpdate} />);
  // Expand the card — the actions row (save button + error span) only
  // renders in the expanded body.
  fireEvent.click(screen.getByRole("button", { name: "إظهار إعدادات Google" }));
  return { onUpdate };
}

describe("ProviderCard — B14-14: the inline error span is wired (R127-L11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a failed save surfaces the Arabic message in the inline span AND the toast (both channels)", async () => {
    // adminFetchJson rejects a plain Error — the catch's
    // `err instanceof Error ? err.message : …` arm (real adminFetchJson
    // throws Errors whose message is already the Arabic body message,
    // via getErrorMessage + the fallbackError option).
    (adminFetchJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("رمز غير صالح"));
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));

    // The designed affordance: the message pinned next to the save
    // button (this span was unreachable before the fix — `error` was
    // never set).
    expect(await screen.findByText("رمز غير صالح")).toBeInTheDocument();
    // The toast channel still fires with the SAME message.
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "خطأ",
          description: "رمز غير صالح",
          variant: "destructive",
        }),
      );
    });
  });

  it("a subsequent successful save clears the span and fires onUpdate (every retry starts clean)", async () => {
    const fetchMock = adminFetchJson as ReturnType<typeof vi.fn>;
    // First save fails (span appears)…
    fetchMock.mockRejectedValueOnce(new Error("رمز غير صالح"));
    const { onUpdate } = renderCard();

    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));
    expect(await screen.findByText("رمز غير صالح")).toBeInTheDocument();

    // …then the operator fixes the field and saves successfully — the
    // setError("") at save() start clears the stale error, and the
    // card settles on the server's authoritative state.
    fetchMock.mockResolvedValueOnce({ enabled: true, config: { client_id: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));

    await waitFor(() => {
      expect(screen.queryByText("رمز غير صالح")).not.toBeInTheDocument();
    });
    // The success confirmation («تم الحفظ») replaces the button label.
    expect(await screen.findByText("تم الحفظ")).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "google", enabled: true, config: { client_id: "abc" } }),
    );
    // Exactly ONE toast fired — the first save's failure. The success
    // path toasts nothing (the «تم الحفظ» confirmation is the card's
    // own affordance).
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("session expiry still stays quiet: no span, no toast (the global handler owns that surface)", async () => {
    // The sentinel takes no arguments — its message is the fixed
    // ADMIN_SESSION_EXPIRED_MESSAGE.
    (adminFetchJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AdminSessionExpiredError(),
    );
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));

    // The early return happens BEFORE setError — the redirecting page
    // never paints a stale inline error.
    await waitFor(() => {
      expect(toastMock).not.toHaveBeenCalled();
    });
    expect(screen.queryByText("انتهت الجلسة")).not.toBeInTheDocument();
  });

  it("a technical English rejection collapses to the Arabic generic — never the raw HTTP noise (R148 3-errcopy)", async () => {
    // A gateway/customFetch-shaped rejection with NO Arabic suffix — the
    // old raw extractor rendered "HTTP 409 Conflict" verbatim in the
    // inline span AND the toast (the R96 96-F7 leak class). The catch
    // now routes through getErrorMessage.
    (adminFetchJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("HTTP 409 Conflict"),
    );
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));

    // Both channels carry the shared Arabic network copy…
    expect(
      await screen.findByText("تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "خطأ",
          description: "تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.",
          variant: "destructive",
        }),
      );
    });
    // …and the technical English never lands anywhere on the card.
    expect(document.body.textContent).not.toContain("HTTP 409");
    expect(document.body.textContent).not.toContain("Conflict");
  });
});

/** R187E-F5 — the "[SET]" secret placeholder was unreachable dead code.
 *
 * The server masks configured secrets as the literal "[SET]" string
 * (services/auth-settings-store.ts buildMaskedConfig); the card rendered
 * that literal as the password input's VALUE, so the designed
 * «••••••••••• (مُعيَّن)» placeholder — which only renders on an EMPTY
 * value — could never appear for any configured secret. The input now
 * renders empty (the placeholder visible) while the STATE keeps "[SET]"
 * until the operator types, so an untouched save PATCHes the exact mask
 * the backend already skips (routes/auth-settings.ts:794).
 */
describe('ProviderCard — R187E-F5: a configured secret shows its placeholder, not the "[SET]" literal', () => {
  const SECRET_PROVIDER: AuthProvider = {
    id: "google",
    label: "Google",
    icon: "google",
    color: "",
    auth_type: "oauth_redirect",
    description: "الدخول عبر حساب Google",
    setup_url: "https://example.com/setup",
    fields: [
      { key: "client_id", label: "معرّف العميل", isSecret: false, placeholder: "123…" },
      { key: "client_secret", label: "الرمز السري", isSecret: true, placeholder: "abc…" },
    ],
    enabled: true,
    config: { client_id: "123.apps.google", client_secret: "[SET]" },
  };

  function renderSecretCard(onUpdate = vi.fn()) {
    render(
      <ProviderCard provider={SECRET_PROVIDER} adminToken="test-admin-token" onUpdate={onUpdate} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "إظهار إعدادات Google" }));
    return { onUpdate };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("the masked secret input is EMPTY with the «(مُعيَّن)» placeholder visible — never the literal [SET]", () => {
    renderSecretCard();

    // The secret label carries the «سري» badge beside it — regex match.
    const secret = screen.getByLabelText(/^الرمز السري/) as HTMLInputElement;
    expect(secret).toHaveValue("");
    expect(secret).toHaveAttribute("placeholder", "••••••••••• (مُعيَّن)");
    // Still a password field until revealed.
    expect(secret).toHaveAttribute("type", "password");
    // The literal mask never renders into the DOM as the value.
    expect(secret.value).not.toBe("[SET]");
    // The non-secret field keeps its real value untouched.
    expect(screen.getByLabelText("معرّف العميل") as HTMLInputElement).toHaveValue(
      "123.apps.google",
    );
  });

  it('an untouched save PATCHes the "[SET]" mask — behavior-identical (the backend skips it)', async () => {
    const fetchMock = adminFetchJson as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      enabled: true,
      config: { client_id: "123.apps.google", client_secret: "[SET]" },
    });
    const { onUpdate } = renderSecretCard();

    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    // The body carried the untouched state: the mask (not "") — the
    // display change never altered the save contract. adminFetchJson's
    // call shape is (url, init) — the JSON body rides init.body.
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, string>;
    expect(body.client_secret).toBe("[SET]");
    expect(body.client_id).toBe("123.apps.google");
  });

  it("typing a new secret replaces the mask in state (the operator's edit wins)", async () => {
    const fetchMock = adminFetchJson as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      enabled: true,
      config: { client_id: "123.apps.google", client_secret: "[SET]" },
    });
    renderSecretCard();

    fireEvent.change(screen.getByLabelText(/^الرمز السري/), {
      target: { value: "new-secret-456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التغييرات" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, string>;
    expect(body.client_secret).toBe("new-secret-456");
  });
});
