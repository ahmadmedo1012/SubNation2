/**
 * 98-F7 (r97 F-11 — raw-fetch hardening) — AuthProviders load-failure tests.
 *
 * The providers fetch was `.then((r) => r.json())` with no r.ok and no
 * shape validation: an error envelope (401/503 JSON) parsed into an
 * object without `providers` and silently degraded the list; a 503 HTML
 * body threw an uncaught rejection; and when neither the server list
 * NOR the Firebase fallback existed, the component returned null — a
 * silent dead zone under the password form.
 *
 * Contract pinned here:
 *
 *   1. Non-OK HTTP ⇒ no fake provider list; with no Firebase fallback
 *      an honest Arabic error renders (role=alert) instead of null.
 *   2. 200 with a non-array `providers` ⇒ same honest path (shape guard).
 *   3. Network failure + Firebase configured ⇒ the degraded
 *      Google-only button still renders (unchanged UX).
 *   4. Healthy response ⇒ the server list renders.
 */

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AuthProviders } from "@/components/AuthProviders";

const firebaseConfigured = vi.hoisted(() => ({ configured: false }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ setToken: vi.fn() }),
}));

vi.mock("@/lib/firebase", () => ({
  isFirebaseAuthConfigured: () => firebaseConfigured.configured,
}));

vi.mock("@/lib/firebase-auth", () => ({
  FirebaseLinkConsentRequiredError: class extends Error {},
  exchangeFirebaseIdToken: vi.fn(),
  signInWithFirebaseGoogle: vi.fn(),
}));

vi.mock("@/components/TelegramLoginButton", () => ({
  TelegramLoginButton: () => <div data-testid="telegram-button" />,
}));

vi.mock("@/components/LinkConsentModal", () => ({
  LinkConsentModal: () => <div data-testid="link-consent-modal" />,
}));

function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const fetchMock = vi.fn();

// R104 (AG2-5): AuthProviders now rides the shared module-level
// single-flight cache (fetchPublicAuthProviders) — reset it between
// cases so each one observes ITS OWN mocked response.
import { __resetPublicAuthProvidersCacheForTests } from "@/hooks/use-public-auth-providers";

function renderProviders() {
  return render(
    <Router>
      <AuthProviders dividerLabel="أو" />
    </Router>,
  );
}

beforeEach(() => {
  __resetPublicAuthProvidersCacheForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  firebaseConfigured.configured = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthProviders — honest load failures (r97 F-11 hardening)", () => {
  it.each([401, 503])(
    "HTTP %i with no Firebase fallback renders the Arabic error, never a fake list",
    async (status) => {
      fetchMock.mockResolvedValue(resLike({ ok: false, status, body: { error: "unavailable" } }));

      renderProviders();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("تعذّر تحميل طرق تسجيل الدخول");
      // No provider button was fabricated from the error envelope.
      expect(screen.queryByRole("button", { name: /المتابعة عبر/ })).not.toBeInTheDocument();
    },
  );

  it("a 200 with a non-array providers body is an honest error, not a crash", async () => {
    fetchMock.mockResolvedValue(resLike({ body: { providers: "oops" } }));

    renderProviders();

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل طرق تسجيل الدخول");
  });

  it("a network failure with Firebase configured keeps the degraded Google-only button", async () => {
    firebaseConfigured.configured = true;
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderProviders();

    expect(await screen.findByRole("button", { name: "المتابعة عبر Google" })).toBeInTheDocument();
    // And no error line — the degraded state IS functional.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a healthy response renders the server list", async () => {
    fetchMock.mockResolvedValue(
      resLike({
        body: {
          providers: [
            {
              id: "apple",
              label: "Apple",
              color: "#000",
              icon: "apple",
              auth_type: "oauth_redirect",
              enabled: true,
              has_config: true,
            },
          ],
        },
      }),
    );

    renderProviders();

    expect(await screen.findByRole("button", { name: "المتابعة عبر Apple" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
