import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { createSign, generateKeyPairSync } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb } from "../../test/db";
import { authProviderPublicRouter } from "../auth-settings";
import { __testResetJwksCache, startTelegramOidcFlow } from "../../services/telegram-oidc-flow";
import {
  __test as stateTestHooks,
  consumeTelegramOidcState,
  storeTelegramOidcState,
} from "../../lib/telegram-oidc-states";

/**
 * R191 (backend mobile contracts) — the Telegram OIDC NATIVE bridge, end to
 * end through the REAL route pair, REAL state store and REAL flow service;
 * only the Telegram side (oauth.telegram.org token + JWKS endpoints) is
 * mocked at the fetch boundary with a locally generated RSA keypair (the
 * telegram-oidc-flow.test.ts idiom).
 *
 * Pinned contracts:
 *   - GET /api/auth/telegram/oidc/login?native=1 → the state record carries
 *     native: true (verified by consuming it directly);
 *   - the callback then 302s to subnation://auth/callback#token=<jwt> — the
 *     app's own URL scheme, token URL-encoded in the FRAGMENT — and the
 *     fragment token is the SAME jwt the httpOnly cookie carries;
 *   - a state WITHOUT the native flag keeps the ordinary web redirect
 *     (/auth/callback, no token in the URL);
 *   - the native state stays SINGLE-USE: a replayed callback fails closed
 *     (/login?error=oidc_state, no second mint).
 */

const ORIGIN = "https://subnation.ly";
const CLIENT_ID = "1234567890";
const CLIENT_SECRET = "oidc-native-test-secret";
const BOT_TOKEN = "1234567890:AAH-test-bot-token";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-r191-native-key";
const PUBLIC_JWK = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };

/** Sign an RS256 JWT the way Telegram would (feeds the fetch mock). */
function signIdToken(claims: Record<string, unknown>): string {
  const header = { alg: "RS256", kid: KID, typ: "JWT" };
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

function validClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://oauth.telegram.org",
    aud: CLIENT_ID,
    sub: "1234123412341234123",
    iat: now,
    exp: now + 3600,
    id: 987_111_222,
    name: "Native Tester",
    given_name: "Native",
    family_name: "Tester",
    preferred_username: "native_tester",
    ...over,
  };
}

/** The fetch mock — token endpoint + JWKS endpoint, real net for the rest. */
const ORIGINAL_FETCH = globalThis.fetch;
let nextIdToken = "unconfigured";

function installFetchMock(): void {
  globalThis.fetch = (async (input: Parameters<typeof ORIGINAL_FETCH>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth.telegram.org/.well-known/jwks.json") {
      return new Response(
        JSON.stringify({ keys: [{ ...PUBLIC_JWK, kid: KID, alg: "RS256", use: "sig" }] }),
        { status: 200 },
      );
    }
    if (url === "https://oauth.telegram.org/token") {
      return new Response(
        JSON.stringify({ access_token: "at", token_type: "Bearer", id_token: nextIdToken }),
        { status: 200 },
      );
    }
    return ORIGINAL_FETCH(input, init);
  }) as typeof fetch;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authProviderPublicRouter);
  return app;
}

async function listen(): Promise<{ url: string; close: () => void }> {
  const app = buildApp();
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

async function get(url: string, path: string) {
  const res = await fetch(`${url}${path}`, { redirect: "manual" });
  return {
    status: res.status,
    location: res.headers.get("location"),
    setCookie: res.headers.get("set-cookie"),
  };
}

async function seedOidcSettings(): Promise<void> {
  await db.execute(
    sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify({
      enabled: true,
      bot_token: BOT_TOKEN,
      oidc_client_id: CLIENT_ID,
      oidc_client_secret: CLIENT_SECRET,
    })})`,
  );
}

/**
 * Start a flow through the REAL login route, then arm the token mock with
 * an id_token whose nonce matches the state (the flow test's
 * consume-then-re-store trick: the callback consumes the state for real).
 */
async function startNativeFlow(url: string, query: string): Promise<string> {
  const login = await get(url, `/api/auth/telegram/oidc/login?${query}`);
  expect(login.status).toBe(302);
  expect(login.location).toContain("https://oauth.telegram.org/auth");
  const state = new URL(login.location!).searchParams.get("state");
  expect(state).toBeTruthy();

  const stored = await consumeTelegramOidcState(state!);
  expect(stored).not.toBeNull();
  await storeTelegramOidcState(state!, stored!);
  nextIdToken = signIdToken(validClaims({ nonce: stored!.nonce }));
  return state!;
}

beforeAll(async () => {
  await initTestDb();
  // Tables the shared harness DDL does not carry (the flow test's block).
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS system_settings (
  key varchar(255) PRIMARY KEY,
  value text NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
)`),
  );
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS user_auth_identities (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(50) NOT NULL,
  provider_uid varchar(255) NOT NULL,
  firebase_uid varchar(255),
  email varchar(255),
  phone varchar(20),
  email_verified boolean NOT NULL DEFAULT false,
  phone_verified boolean NOT NULL DEFAULT false,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
)`),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_identities_provider_uid ON user_auth_identities (provider, provider_uid)`,
    ),
  );
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS auth_activity (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE CASCADE,
  identifier varchar(255) NOT NULL,
  action varchar(50) NOT NULL,
  provider varchar(50) NOT NULL,
  success boolean NOT NULL DEFAULT false,
  failure_reason text,
  ip_address varchar(45),
  user_agent varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
)`),
  );
  process.env.APP_ORIGINS = ORIGIN;
  installFetchMock();
});

afterAll(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.APP_ORIGINS;
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw(`DELETE FROM user_auth_identities;`));
  await db.execute(sql.raw(`DELETE FROM system_settings;`));
  await db.execute(sql.raw(`DELETE FROM auth_activity;`));
  await seedOidcSettings();
  stateTestHooks.resetMemoryStore();
  __testResetJwksCache();
  nextIdToken = "unconfigured";
});

describe("R191 — the native OIDC bridge (?native=1)", () => {
  it("the login route binds native: true into the server-held state", async () => {
    const { url, close } = await listen();
    try {
      const state = await startNativeFlow(url, "native=1");
      // Verified inside the helper's consume: re-verify the flag directly.
      const stored = await consumeTelegramOidcState(state);
      expect(stored?.native).toBe(true);
    } finally {
      close();
    }
  });

  it("a native flow mints → callback 302s to subnation://auth/callback#token=<jwt> (the fragment token IS the cookie token)", async () => {
    const { url, close } = await listen();
    try {
      const state = await startNativeFlow(url, "native=1");

      const res = await get(
        url,
        `/api/auth/telegram/oidc/callback?code=native-code&state=${state}`,
      );
      expect(res.status).toBe(302);
      expect(res.location).toBeTruthy();
      expect(res.location!.startsWith("subnation://auth/callback#token=")).toBe(true);

      // The token rides the FRAGMENT (never a query string) and is the
      // SAME jwt the httpOnly cookie carries.
      const fragmentToken = decodeURIComponent(
        res.location!.slice("subnation://auth/callback#token=".length),
      );
      expect(fragmentToken.split(".")).toHaveLength(3); // a real JWT shape
      expect(res.setCookie).toContain(`auth_token=${fragmentToken}`);
      expect(res.setCookie).toContain("HttpOnly");

      // The login itself landed (the user + session row exist — the same
      // audit path as web logins).
      const users = (await db.execute(
        sql`SELECT count(*) AS c FROM users WHERE telegram_id = '987111222'`,
      )) as unknown as { rows: Array<{ c: string }> };
      expect(Number(users.rows[0]?.c)).toBe(1);
      const activity = (await db.execute(
        sql`SELECT count(*) AS c FROM auth_activity WHERE provider = 'telegram' AND success = true`,
      )) as unknown as { rows: Array<{ c: string }> };
      expect(Number(activity.rows[0]?.c)).toBe(1);
    } finally {
      close();
    }
  });

  it("the `native=true` spelling is accepted too", async () => {
    const { url, close } = await listen();
    try {
      const state = await startNativeFlow(url, "native=true");
      const res = await get(url, `/api/auth/telegram/oidc/callback?code=c2&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.location!.startsWith("subnation://auth/callback#token=")).toBe(true);
    } finally {
      close();
    }
  });

  it("the native state stays SINGLE-USE: a replayed callback fails closed", async () => {
    const { url, close } = await listen();
    try {
      const state = await startNativeFlow(url, "native=1");
      const first = await get(url, `/api/auth/telegram/oidc/callback?code=c3&state=${state}`);
      expect(first.location!.startsWith("subnation://auth/callback#token=")).toBe(true);

      // Replay the SAME state — consumed, so closed. No second mint.
      const replay = await get(url, `/api/auth/telegram/oidc/callback?code=c3&state=${state}`);
      expect(replay.status).toBe(302);
      expect(replay.location).toBe("/login?error=oidc_state");
      expect(replay.setCookie).toBeNull();
    } finally {
      close();
    }
  });

  it("a state WITHOUT the native flag keeps the ordinary WEB redirect (no token in the URL)", async () => {
    const { url, close } = await listen();
    try {
      // The service-level web start (native omitted) + the route without
      // the param — both must produce a web-shaped flow.
      const state = await startNativeFlow(url, "redirect=%2Fwallet");
      const stored = await consumeTelegramOidcState(state);
      expect(stored?.native).toBe(false);
      await storeTelegramOidcState(state, stored!);
      nextIdToken = signIdToken(validClaims({ nonce: stored!.nonce }));

      const res = await get(url, `/api/auth/telegram/oidc/callback?code=web-code&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.location).toBe("/wallet"); // the stored web redirect, honored
      expect(res.location).not.toContain("token");
      expect(res.location).not.toContain("subnation://");
      expect(res.setCookie).toContain("auth_token=");
    } finally {
      close();
    }
  });

  it("a login WITHOUT the native param stores native: false (the plain web default)", async () => {
    const start = await startTelegramOidcFlow({
      originHeader: ORIGIN,
      redirect: null,
      referralCode: null,
    });
    if ("error" in start) throw new Error(`start failed: ${start.error}`);
    const stored = await consumeTelegramOidcState(start.state);
    expect(stored?.native).toBe(false);
  });
});
