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
