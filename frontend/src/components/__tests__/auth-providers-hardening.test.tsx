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
  // R144-C1/C2 (L16-3): real Response objects — AuthProviders' probe
  // rides customFetch (via use-public-auth-providers), which reads
  // .text()/.headers; the minimal ok/json-only stub predated the
  // wrapper. `ok` is always consistent with `status` here.
  const { status = 200, body = {} } = over;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

// ── R145 (D7 honesty): the renderability gate ───────────────────────────────
// The live /api/auth/providers response ships a Google row with
// enabled=true + has_config=true (the DB's firebase_enabled flag) while
// the PRODUCTION build carries no VITE_FIREBASE_* env — the button painted
// as a normal available option and the click died in ProviderButton's
// «Firebase Google غير مفعلة» arm (the live VLM audit read that dead
// button as a co-equal primary: "the eye jumps straight to the social
// login buttons"). The fix: renderableProviders() drops what THIS client
// cannot execute. These legs pin the gate's truth table.
describe("AuthProviders — R145 (D7): unavailable providers are never presented as options", () => {
  // The sentinel pattern: every negative leg pairs the dropped row with a
  // row that DOES render, then awaits the renderable one — proving the
  // .then(setProviders) chain landed BEFORE asserting the absence (an
  // assertion raced ahead of the microtask would false-pass forever).
  const appleRow = {
    id: "apple",
    label: "Apple",
    color: "#000",
    icon: "apple",
    auth_type: "oauth_redirect",
    enabled: true,
    has_config: true,
  };
  const googleRow = {
    id: "google",
    label: "Google",
    color: "#4285F4",
    icon: "google",
    auth_type: "client_side",
    enabled: true,
    has_config: true,
    client_id: null,
  };

  it("a client_side Google row is hidden while this build lacks the Firebase env (the live dead-button class)", async () => {
    firebaseConfigured.configured = false;
    fetchMock.mockResolvedValue(resLike({ body: { providers: [googleRow, appleRow] } }));

    renderProviders();

    // The renderable peer proves the list landed…
    expect(await screen.findByRole("button", { name: "المتابعة عبر Apple" })).toBeInTheDocument();
    // …and Google is not presented as an available option. No fake-error
    // line either — the load SUCCEEDED; the row simply isn't presentable.
    expect(screen.queryByRole("button", { name: "المتابعة عبر Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the same Google row renders once Firebase IS configured (the click path is real)", async () => {
    firebaseConfigured.configured = true;
    fetchMock.mockResolvedValue(resLike({ body: { providers: [googleRow] } }));

    renderProviders();

    expect(await screen.findByRole("button", { name: "المتابعة عبر Google" })).toBeInTheDocument();
    // The API row wins over the client seed (no duplicate google button).
    expect(screen.getAllByRole("button", { name: "المتابعة عبر Google" })).toHaveLength(1);
  });

  it.each([
    ["enabled: false", { enabled: false, has_config: true }],
    ["has_config: false", { enabled: true, has_config: false }],
  ])(
    "an oauth_redirect row with %s is dropped, not rendered disabled-looking",
    async (_label, flags) => {
      fetchMock.mockResolvedValue(
        resLike({
          body: {
            providers: [
              { ...appleRow, ...flags },
              // The landed sentinel: a renderable telegram widget row.
              {
                id: "telegram",
                label: "Telegram",
                color: "#2AABEE",
                icon: "telegram",
                auth_type: "widget",
                enabled: true,
                has_config: true,
                bot_username: "SubNation_USERS_bot",
                bot_id: "8884466008",
              },
            ],
          },
        }),
      );

      renderProviders();

      expect(await screen.findByTestId("telegram-button")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "المتابعة عبر Apple" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );
});
