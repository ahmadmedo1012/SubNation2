import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, initTestDb } from "../../test/db";
import { authProviderPublicRouter, isTelegramCallbackSameOrigin } from "../auth-settings";

/**
 * B1-1 (R111, round-111 B1 audit) — login-CSRF on
 * GET /api/auth/telegram/callback.
 *
 * This GET was the only session-MINT endpoint outside the CSRF Origin
 * gate (createCsrfGate in app.ts is POST/PUT/DELETE/PATCH-only). A
 * Telegram payload is signed with the BOT's key, so an attacker can mint
 * a validly-signed payload for their OWN account and lure it through the
 * victim's browser (img tag / fetch / pasted link): the callback silently
 * Set-Cookies an auth_token bound to the ATTACKER's account — the exact
 * 98-F3 class (the victim then tops up the attacker's wallet).
 *
 * The fix is a fail-closed same-origin gate on the payload-bearing
 * (session-mint) shape:
 *   - Sec-Fetch-Site present → only "same-origin" passes (cross-site
 *     blocks the subresource attack; "none" blocks the pasted-link
 *     attack; "same-site" is still cross-origin for apex/www).
 *   - else Referer must match the configured origin allow-list exactly
 *     (scheme+host, no string prefixes).
 *   - neither header → blocked. The current frontend never sends a
 *     browser here with a payload (return_to is the SPA route, which
 *     POSTs to /api/auth/telegram — already behind the CSRF gate), so
 *     the gate breaks no product flow. State-nonce upgrade path is
 *     documented in the route.
 *
 * The no-payload shapes (cancelled / relayed ?error=) mint nothing and
 * stay ungated.
 */

// system_settings is not part of the shared pglite harness DDL — create
// it so a gate-passing request reaches the deterministic
// `provider_disabled` branch (no Telegram bot token configured) instead
// of dying at the settings SELECT.
const SYSTEM_SETTINGS_DDL = `CREATE TABLE IF NOT EXISTS system_settings (
  key varchar(255) PRIMARY KEY,
  value text NOT NULL
);`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authProviderPublicRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

/** A payload-bearing (session-mint) callback URL — hash + auth_date present. */
const MINT_URL = "/api/auth/telegram/callback?hash=abc&auth_date=123";

async function get(
  url: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; location: string | null; setCookies: string[] }> {
  const res = await fetch(`${url}${path}`, {
    method: "GET",
    redirect: "manual",
    headers,
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    setCookies: res.headers.getSetCookie(),
  };
}

const ALLOWED = ["https://subnation.ly", "https://www.subnation.ly"];
let savedEnv: string | undefined;

beforeAll(async () => {
  await initTestDb();
  await db.execute(sql.raw(SYSTEM_SETTINGS_DDL));
  // Deterministic allow-list for the integration block (the predicate
  // reads env at request time, so this is safe to set here).
  savedEnv = process.env.CSRF_ALLOWED_ORIGINS;
  process.env.CSRF_ALLOWED_ORIGINS = ALLOWED.join(",");
});

afterAll(() => {
  if (savedEnv === undefined) {
    delete process.env.CSRF_ALLOWED_ORIGINS;
  } else {
    process.env.CSRF_ALLOWED_ORIGINS = savedEnv;
  }
});

// ── 1) The predicate (pure) ───────────────────────────────────────────────────

describe("isTelegramCallbackSameOrigin (B1-1 predicate)", () => {
  it("Sec-Fetch-Site: same-origin → allowed", () => {
    expect(isTelegramCallbackSameOrigin({ "sec-fetch-site": "same-origin" }, ALLOWED)).toBe(true);
  });

  it.each(["cross-site", "same-site", "none"])(
    "Sec-Fetch-Site: %s → blocked (the subresource / sibling-origin / pasted-link shapes)",
    (value) => {
      expect(isTelegramCallbackSameOrigin({ "sec-fetch-site": value }, ALLOWED)).toBe(false);
    },
  );

  it("no Sec-Fetch-Site + a Referer on the allow-list → allowed (legacy browsers)", () => {
    expect(isTelegramCallbackSameOrigin({ referer: "https://subnation.ly/login" }, ALLOWED)).toBe(
      true,
    );
    expect(
      isTelegramCallbackSameOrigin({ referer: "https://www.subnation.ly/auth/callback" }, ALLOWED),
    ).toBe(true);
  });

  it("no Sec-Fetch-Site + a foreign Referer → blocked", () => {
    expect(
      isTelegramCallbackSameOrigin({ referer: "https://evil.example.com/attacker.html" }, ALLOWED),
    ).toBe(false);
  });

  it("a lookalike Referer does NOT pass (exact origin compare, F-009 discipline)", () => {
    expect(
      isTelegramCallbackSameOrigin({ referer: "https://subnation.ly.evil.com/x" }, ALLOWED),
    ).toBe(false);
  });

  it("neither header → blocked (fail closed — no headerless mints)", () => {
    expect(isTelegramCallbackSameOrigin({}, ALLOWED)).toBe(false);
  });

  it("no headers and an empty allow-list → blocked (fail closed on misconfiguration too)", () => {
    expect(isTelegramCallbackSameOrigin({ referer: "https://subnation.ly/login" }, [])).toBe(false);
  });
});

// ── 2) The route (integration) ────────────────────────────────────────────────

describe("GET /api/auth/telegram/callback — B1-1 session-mint gate", () => {
  it.each([
    ["cross-site subresource (img/fetch)", { "Sec-Fetch-Site": "cross-site" }],
    ["pasted-link navigation", { "Sec-Fetch-Site": "none" }],
    ["sibling subdomain (cross-origin same-site)", { "Sec-Fetch-Site": "same-site" }],
    ["headerless legacy client", {}],
    ["foreign Referer", { Referer: "https://evil.example.com/a.html" }],
    ["lookalike Referer", { Referer: "https://subnation.ly.evil.com/a.html" }],
  ])(
    "a payload-bearing request from a %s → 302 csrf_blocked and NO session cookie minted",
    async (_label, headers) => {
      const { url, close } = await listen(buildApp());
      try {
        const res = await get(url, MINT_URL, headers);
        expect(res.status).toBe(302);
        expect(res.location).toContain("error=csrf_blocked");
        expect(res.setCookies.some((c) => c.startsWith("auth_token="))).toBe(false);
      } finally {
        close();
      }
    },
  );

  it("a same-origin request passes the gate and continues to the (deterministic) provider check", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, MINT_URL, { "Sec-Fetch-Site": "same-origin" });
      // The gate let it THROUGH — the redirect is the provider-disabled
      // reason (no bot token configured in the harness), NOT csrf_blocked,
      // and still no cookie was minted.
      expect(res.status).toBe(302);
      expect(res.location).not.toContain("csrf_blocked");
      expect(res.location).toContain("error=provider_disabled");
      expect(res.setCookies.some((c) => c.startsWith("auth_token="))).toBe(false);
    } finally {
      close();
    }
  });

  it("an allowed Referer (legacy browser, no Sec-Fetch-Site) passes the gate too", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, MINT_URL, { Referer: "https://subnation.ly/login" });
      expect(res.status).toBe(302);
      expect(res.location).not.toContain("csrf_blocked");
    } finally {
      close();
    }
  });

  it("the no-payload (cancelled) shape is NOT gated — cross-site still gets the cancelled redirect", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, "/api/auth/telegram/callback", {
        "Sec-Fetch-Site": "cross-site",
      });
      expect(res.status).toBe(302);
      expect(res.location).toContain("error=cancelled");
    } finally {
      close();
    }
  });

  it("the relayed ?error= forward is NOT gated (no mint, no redirect rewriting)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await get(url, "/api/auth/telegram/callback?error=relay_msg", {
        "Sec-Fetch-Site": "cross-site",
      });
      expect(res.status).toBe(302);
      expect(res.location).toContain("error=relay_msg");
    } finally {
      close();
    }
  });
});
