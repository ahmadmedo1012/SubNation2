/**
 * R186 (B-F3) — the Telegram callback's open-redirect guard is the
 * canonical one.
 *
 * readRedirectTarget was a module-local, byte-identical fork of
 * lib/utils.sanitizeInternalPath — the guard extracted in R123-E4a
 * precisely so every auth surface (login, register, wallet) shares ONE
 * implementation. The fork is deleted; the page reads ?redirect=
 * through the canonical helper.
 *
 * Pinned here:
 *   1. source pin (the decomposition-suite idiom): the page calls
 *      sanitizeInternalPath( and defines no local readRedirectTarget;
 *   2. behavior: a successful Telegram mint with ?redirect=//evil.com
 *      lands on "/" (protocol-relative targets are rejected — the
 *      open-redirect class the guard exists for);
 *   3. behavior: a same-origin ?redirect=/checkout still lands on
 *      /checkout (identical semantics to the fork — the fix must not be
 *      over-strict and break the checkout return path).
 *
 * Harness: the auth-callback twin's guarded-page idiom (wouter Router +
 * the mocked global fetch over the real POST; customFetch rides fetch).
 */

import { act, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TelegramCallbackPage from "@/pages/telegram-callback";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ setToken: vi.fn() }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // A successful mint: the POST answers { token, is_new_user: false }.
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ token: "tg-token", is_new_user: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState(null, "", "/");
});

/** The #tgAuthResult= fragment Telegram appends on success. */
function tgFragment(): string {
  const payload = JSON.stringify({
    id: 42,
    auth_date: 1_761_000_000,
    hash: "abc123",
    first_name: "T",
  });
  return `#tgAuthResult=${btoa(payload)}`;
}

/** Render at `path` and drain the mint → navigate chain INSIDE act
 *  until the browser URL settles on `expectedPathname`, then UNMOUNT —
 *  wouter patches history, so the afterEach URL reset would otherwise fire
 *  a location event into the still-mounted Router (an unwrapped React
 *  update on every leg whose landing actually changed the URL). */
async function renderAndAwaitLanding(path: string, expectedPathname: string) {
  window.history.pushState(null, "", path);
  const view = render(
    <Router>
      <TelegramCallbackPage />
    </Router>,
  );
  await act(async () => {
    // fetch → .text() → parse → navigate is a handful of microtask hops
    // (history.replaceState itself is synchronous) — drain inside the
    // act scope so the Router's location-driven re-render lands wrapped.
    for (let i = 0; i < 20 && window.location.pathname !== expectedPathname; i++) {
      await Promise.resolve();
    }
  });
  expect(window.location.pathname).toBe(expectedPathname);
  view.unmount();
}

describe("TelegramCallbackPage — the redirect guard is the canonical sanitizeInternalPath (B-F3/R186)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/pages/telegram-callback.tsx"), "utf8");

  it("reads ?redirect= through lib/utils' canonical guard — no local fork remains", () => {
    expect(source).toContain("sanitizeInternalPath(");
    expect(source).not.toContain("function readRedirectTarget");
    expect(source).not.toContain("readRedirectTarget(");
  });

  it('a protocol-relative ?redirect=//evil.com is rejected — the successful mint lands on "/"', async () => {
    await renderAndAwaitLanding(
      `/auth/telegram-callback?redirect=${encodeURIComponent("//evil.com")}${tgFragment()}`,
      "/",
    );

    expect(window.location.pathname).toBe("/");
    // Belt check: the browser never followed the cross-origin target.
    expect(window.location.host).not.toContain("evil");
  });

  it("a same-origin ?redirect=/checkout still lands on /checkout (identical semantics to the fork)", async () => {
    await renderAndAwaitLanding(
      `/auth/telegram-callback?redirect=${encodeURIComponent("/checkout")}${tgFragment()}`,
      "/checkout",
    );

    expect(window.location.pathname).toBe("/checkout");
  });
});

// ── R187 (C-F2) — the query-string fallback never forwards OUR routing
// params into the signed payload ────────────────────────────────────────────
describe("TelegramCallbackPage — the query fallback excludes ?redirect from the HMAC payload (C-F2/R187)", () => {
  it("a query-string payload with ?redirect= POSTs a body carrying NO redirect key", async () => {
    // No fragment → the defence-in-depth query fallback builds the
    // data object. ?redirect is OUR own routing param, never part of
    // the Telegram HMAC: forwarding it guaranteed bad_signature for
    // every flow carrying a return path.
    await renderAndAwaitLanding(
      "/auth/telegram-callback?redirect=%2Fcheckout&id=42&hash=abc123&auth_date=1761000000&first_name=T",
      "/checkout",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/auth/telegram");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    // The Telegram auth fields ride the payload…
    expect(body).toMatchObject({ id: "42", hash: "abc123", auth_date: "1761000000" });
    // …our own routing param never does (nor the referral param).
    expect(body).not.toHaveProperty("redirect");
    expect(body).not.toHaveProperty("ref");
  });
});

// ── R187 (C-F5) — the error legs keep the return path ──────────────────────
describe("TelegramCallbackPage — /login?error= legs carry the sanitized redirect (C-F5/R187)", () => {
  /** Renders at `path`, drains to /login, returns the settled search. */
  async function renderAndAwaitLoginError(path: string): Promise<string> {
    window.history.pushState(null, "", path);
    const view = render(
      <Router>
        <TelegramCallbackPage />
      </Router>,
    );
    await act(async () => {
      for (let i = 0; i < 20 && window.location.pathname !== "/login"; i++) {
        await Promise.resolve();
      }
    });
    expect(window.location.pathname).toBe("/login");
    const search = window.location.search;
    view.unmount();
    return search;
  }

  it("a mint that returns no token keeps ?redirect=/checkout on the /login?error= hop", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "تعذّر التحقق", reason: "bad_signature" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const search = await renderAndAwaitLoginError(
      `/auth/telegram-callback?redirect=${encodeURIComponent("/checkout")}${tgFragment()}`,
    );

    // The reason rides first, the guarded return path second — the
    // exact format the backend's loginErrorRedirect emits (C-F5).
    expect(search).toBe("?error=bad_signature&redirect=%2Fcheckout");
  });

  it("the cancelled leg (no usable payload) keeps the return path too", async () => {
    // ?redirect present, no fragment, no id/hash/auth_date → the
    // decode returns null → the cancelled navigation.
    const search = await renderAndAwaitLoginError(
      `/auth/telegram-callback?redirect=${encodeURIComponent("/checkout")}`,
    );

    expect(search).toBe("?error=cancelled&redirect=%2Fcheckout");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an open-redirect value is still dropped on the error legs (the guard runs there too)", async () => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const search = await renderAndAwaitLoginError(
      `/auth/telegram-callback?redirect=${encodeURIComponent("//evil.com")}${tgFragment()}`,
    );

    // The network-level catch leg: the reason rides, the rejected
    // protocol-relative target does not.
    expect(search).toBe("?error=server_error");
    expect(window.location.host).not.toContain("evil");
  });
});
