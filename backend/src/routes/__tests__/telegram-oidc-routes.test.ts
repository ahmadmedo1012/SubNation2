import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import { authProviderPublicRouter } from "../auth-settings";
import { completeTelegramOidcLogin } from "../../services/telegram-oidc-flow";

/**
 * R154 (P2) — the OIDC route pair's transport contract:
 *
 *   GET /api/auth/telegram/oidc/login    → 302 to oauth.telegram.org/auth
 *   GET /api/auth/telegram/oidc/callback → error/cancellation/verdict 302s
 *
 * The heavy lifting (state store, PKCE, token exchange, ID-token
 * validation, user linkage) is pinned by telegram-oidc-flow.test.ts +
 * telegram-oidc-states.test.ts; this file pins the HTTP surface: the
 * redirect envelopes, the honest unconfigured path, and that no route
 * ever mints a session without the full flow behind it.
 *
 * R158 (B-F5): the happy-path gap — the file previously covered ONLY
 * failure/cancel branches (the one cookie assertion expected NULL).
 * completeTelegramOidcLogin is now mocked (default = the real
 * implementation, so the failure-path cases keep exercising the true
 * service) so the two mint paths are pinnable at the route layer: the
 * httpOnly auth_token cookie + the 302 target (default /auth/callback,
 * or the flow's stored redirect when one survives sanitization).
 */
vi.mock("../../services/telegram-oidc-flow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/telegram-oidc-flow")>();
  return {
    ...actual,
    // Default = the REAL implementation (the forged-state case below must
    // keep hitting the true state-store check); happy-path cases override
    // it per-test with mockResolvedValueOnce, which self-reverts.
    completeTelegramOidcLogin: vi.fn(actual.completeTelegramOidcLogin),
  };
});

const ORIGIN = "https://subnation.ly";
const CLIENT_ID = "1234567890";
const CLIENT_SECRET = "oidc-route-secret";

function buildApp(): Express {
  const app = express();
  app.use("/api/auth", authProviderPublicRouter);
  return app;
}

const app = buildApp();

async function listen(): Promise<{ url: string; close: () => void }> {
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

async function get(url: string, path: string, init?: RequestInit) {
  const res = await fetch(`${url}${path}`, { redirect: "manual", ...init });
  return {
    status: res.status,
    location: res.headers.get("location"),
    setCookie: res.headers.get("set-cookie"),
  };
}

beforeAll(async () => {
  await initTestDb();
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS system_settings (
  key varchar(255) PRIMARY KEY,
  value text NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
)`),
  );
  process.env.APP_ORIGINS = ORIGIN;
});

afterAll(() => {
  delete process.env.APP_ORIGINS;
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw(`DELETE FROM system_settings;`));
});

describe("R154 — GET /api/auth/telegram/oidc/login", () => {
  it("302s to oauth.telegram.org with the OIDC Authorization Code + PKCE parameters", async () => {
    await db.execute(
      sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify({
        enabled: true,
        bot_token: "1234567890:AAH-x",
        oidc_client_id: CLIENT_ID,
        oidc_client_secret: CLIENT_SECRET,
      })})`,
    );
    const { url, close } = await listen();
    try {
      const res = await get(url, "/api/auth/telegram/oidc/login?redirect=%2Fcheckout&ref=subref");
      expect(res.status).toBe(302);
      expect(res.location).toBeTruthy();
      const target = new URL(res.location!);
      expect(target.origin + target.pathname).toBe("https://oauth.telegram.org/auth");
      expect(target.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(target.searchParams.get("response_type")).toBe("code");
      expect(target.searchParams.get("scope")).toBe("openid profile");
      expect(target.searchParams.get("code_challenge_method")).toBe("S256");
      expect(target.searchParams.get("state")).toBeTruthy();
      expect(target.searchParams.get("code_challenge")).toBeTruthy();
      // redirect_uri is the registered callback on the CONFIGURED origin.
      expect(target.searchParams.get("redirect_uri")).toBe(
        `${ORIGIN}/api/auth/telegram/oidc/callback`,
      );
    } finally {
      close();
    }
  });

  it("redirects to /login?error=provider_disabled when OIDC credentials are not configured", async () => {
    await db.execute(
      sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify({
        enabled: true,
        bot_token: "1234567890:AAH-x",
      })})`,
    );
    const { url, close } = await listen();
    try {
      const res = await get(url, "/api/auth/telegram/oidc/login");
      expect(res.status).toBe(302);
      expect(res.location).toBe("/login?error=provider_disabled");
    } finally {
      close();
    }
  });
});

describe("R154 — GET /api/auth/telegram/oidc/callback", () => {
  it("an ?error= from Telegram forwards as an honest login-page error", async () => {
    const { url, close } = await listen();
    try {
      const res = await get(url, "/api/auth/telegram/oidc/callback?error=access_denied");
      expect(res.status).toBe(302);
      expect(res.location).toBe(`/login?error=${encodeURIComponent("access_denied")}`);
    } finally {
      close();
    }
  });

  it("an empty redirect (user cancelled) lands on /login?error=cancelled", async () => {
    const { url, close } = await listen();
    try {
      const res = await get(url, "/api/auth/telegram/oidc/callback");
      expect(res.status).toBe(302);
      expect(res.location).toBe("/login?error=cancelled");
    } finally {
      close();
    }
  });

  it("an unknown/expired state fails closed (no session cookie, honest reason)", async () => {
    await db.execute(
      sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify({
        enabled: true,
        bot_token: "1234567890:AAH-x",
        oidc_client_id: CLIENT_ID,
        oidc_client_secret: CLIENT_SECRET,
      })})`,
    );
    const { url, close } = await listen();
    try {
      const res = await get(url, "/api/auth/telegram/oidc/callback?code=x&state=forged");
      expect(res.status).toBe(302);
      expect(res.location).toBe("/login?error=oidc_state");
      // Never a mint on a forged state.
      expect(res.setCookie).toBeNull();
    } finally {
      close();
    }
  });

  // R158 (B-F5): the happy path — the ONLY mint surface in the pair. The
  // service is mocked per-case (mockResolvedValueOnce) because its real
  // battery needs a live Telegram token endpoint; what matters HERE is
  // the route wiring: cookie transport + redirect target.
  it("R158: a completed flow mints the httpOnly auth_token cookie and 302s to /auth/callback (no redirect stored)", async () => {
    vi.mocked(completeTelegramOidcLogin).mockResolvedValueOnce({
      ok: true,
      token: "oidc.happy.path.jwt",
      isNewUser: false,
      redirect: null,
    });
    const { url, close } = await listen();
    try {
      const res = await get(url, "/api/auth/telegram/oidc/callback?code=x&state=y");
      expect(res.status).toBe(302);
      // The cookie-bounce default post-login path — the JWT never rides
      // the URL (F-010 parity).
      expect(res.location).toBe("/auth/callback");
      expect(res.location).not.toContain("token");
      expect(res.setCookie).toContain("auth_token=oidc.happy.path.jwt");
      expect(res.setCookie).toContain("HttpOnly");
      expect(res.setCookie).toContain("Path=/");
    } finally {
      close();
    }
  });

  it("R158: the flow's stored redirect target round-trips — 302 lands on it, cookie still minted", async () => {
    vi.mocked(completeTelegramOidcLogin).mockResolvedValueOnce({
      ok: true,
      token: "oidc.redirect.jwt",
      isNewUser: true,
      redirect: "/checkout",
    });
    const { url, close } = await listen();
    try {
      const res = await get(url, "/api/auth/telegram/oidc/callback?code=x&state=y");
      expect(res.status).toBe(302);
      // The sanitized ?redirect= the login hop stored — honored on
      // completion (the service's sanitizeInternalPath pins the policy).
      expect(res.location).toBe("/checkout");
      expect(res.setCookie).toContain("auth_token=oidc.redirect.jwt");
      expect(res.setCookie).toContain("HttpOnly");
    } finally {
      close();
    }
  });
});
