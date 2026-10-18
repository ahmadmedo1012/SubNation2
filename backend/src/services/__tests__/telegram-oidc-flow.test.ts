import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createHash, createSign, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, initTestDb, resetTestDb, userAuthIdentitiesTable, usersTable } from "../../test/db";
import {
  __test,
  __testResetJwksCache,
  completeTelegramOidcLogin,
  startTelegramOidcFlow,
} from "../telegram-oidc-flow";
import { consumeTelegramOidcState, __test as stateTestHooks } from "../../lib/telegram-oidc-states";

// R166-B6: the OIDC primitives are test-only surface now — the production
// export surface is the two flow entry-points (+ their result types).
const { TELEGRAM_OIDC_AUTH_ENDPOINT, generatePkcePair, verifyTelegramOidcIdToken } = __test;

/**
 * R154 (P2) — the modern Telegram Login OIDC flow, per the official
 * manual-implementation spec (core.telegram.org/bots/telegram-login):
 *
 *   • the authorization URL carries scope `openid profile` — NO phone
 *     scope (registration is phone-free), no telegram:bot_access;
 *   • PKCE S256: the challenge is the base64url SHA-256 of a 43-128-char
 *     verifier, and the token exchange carries the verifier;
 *   • the ID token is validated for REAL: RS256 signature against the
 *     JWKS, then iss / aud / exp / iat / nonce, and the classic `id`
 *     claim (never `sub`) is the users.telegram_id linkage key;
 *   • a valid token logs an EXISTING Telegram account in (no duplicate
 *     user) and registers a first-time user without any phone step;
 *   • every tampered/expired/replayed shape fails closed with a specific
 *     reason and no session.
 *
 * The Telegram side (oauth.telegram.org token + JWKS endpoints) is mocked
 * at the fetch boundary with a locally generated RSA keypair; the USER +
 * SESSION side is the real database path.
 */

const CLIENT_ID = "1234567890";
const CLIENT_SECRET = "oidc-test-secret-not-real";
const BOT_TOKEN = "1234567890:AAH-test-bot-token";
const ORIGIN = "https://subnation.ly";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-r154-key";
const PUBLIC_JWK = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };

/** R156: the live oauth.telegram.org JWKS carries one key per documented
 * algorithm (RS256 default, ES256, EdDSA — live-fetched 2026-10). The
 * mock mirrors that shape; the flow must verify against any of them. */
const EC_KID = "oidc-es256-1";
const { privateKey: ecPrivateKey, publicKey: ecPublicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const EC_JWK = ecPublicKey.export({ format: "jwk" }) as {
  kty: string;
  crv: string;
  x: string;
  y: string;
};
const ED_KID = "oidc-eddsa-1";
const { privateKey: edPrivateKey, publicKey: edPublicKey } = generateKeyPairSync("ed25519");
const ED_JWK = edPublicKey.export({ format: "jwk" }) as {
  kty: string;
  crv: string;
  x: string;
};

/** Sign an RS256 JWT the way Telegram would (used by the fetch mock). */
function signIdToken(claims: Record<string, unknown>, headerOver: Record<string, unknown> = {}) {
  const header = { alg: "RS256", kid: KID, typ: "JWT", ...headerOver };
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** DER ECDSA → JOSE raw r||s (Node signs DER; JWTs carry raw). */
function derToJose(der: Buffer): Buffer {
  const readInt = (off: number): { value: Buffer; next: number } => ({
    value: der.subarray(off + 2, off + 2 + der[off + 1]!),
    next: off + 2 + der[off + 1]!,
  });
  const r = readInt(2);
  const s = readInt(r.next);
  const fixed = (v: Buffer): Buffer => {
    // Strip DER's non-negative sign byte, then left-pad to 32.
    const t = v.length === 33 ? v.subarray(1) : v;
    const out = Buffer.alloc(32);
    t.copy(out, 32 - t.length);
    return out;
  };
  return Buffer.concat([fixed(r.value), fixed(s.value)]);
}

/** Sign an ES256 (P-256) JWT the way Telegram would. */
function signEs256IdToken(claims: Record<string, unknown>): string {
  const header = { alg: "ES256", kid: EC_KID, typ: "JWT" };
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const raw = derToJose(cryptoSign("sha256", Buffer.from(signingInput, "utf8"), ecPrivateKey));
  return `${signingInput}.${raw.toString("base64url")}`;
}

/** Sign an EdDSA (Ed25519) JWT the way Telegram would. */
function signEdDsaIdToken(claims: Record<string, unknown>): string {
  const header = { alg: "EdDSA", kid: ED_KID, typ: "JWT" };
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const raw = cryptoSign(null, Buffer.from(signingInput, "utf8"), edPrivateKey);
  return `${signingInput}.${raw.toString("base64url")}`;
}

function validClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://oauth.telegram.org",
    aud: CLIENT_ID,
    sub: "1234123412341234123",
    iat: now,
    exp: now + 3600,
    id: 987_654_321,
    name: "Ahmed Ali",
    given_name: "Ahmed",
    family_name: "Ali",
    preferred_username: "ahmed_ali",
    picture: "https://cdn4.telesco.pe/file/test.jpg",
    nonce: "PLACEHOLDER",
    ...over,
  };
}

/** The fetch mock — token endpoint + JWKS endpoint, real net for the rest. */
const ORIGINAL_FETCH = globalThis.fetch;
let nextIdToken = "unconfigured";
/** R155: when set, the token mock answers 200 + {"error": <this>} — the
 * live-verified shape Telegram reports OAuth failures in. */
let nextTokenError: string | null = null;
let tokenEndpointCalls = 0;
let lastTokenRequestBody: URLSearchParams | null = null;

function installFetchMock(): void {
  globalThis.fetch = (async (input: Parameters<typeof ORIGINAL_FETCH>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth.telegram.org/.well-known/jwks.json") {
      return new Response(
        JSON.stringify({
          keys: [
            { ...PUBLIC_JWK, kid: KID, alg: "RS256", use: "sig" },
            { ...EC_JWK, kid: EC_KID, alg: "ES256", use: "sig" },
            { ...ED_JWK, kid: ED_KID, alg: "EdDSA", use: "sig" },
          ],
        }),
        { status: 200 },
      );
    }
    if (url === "https://oauth.telegram.org/token") {
      tokenEndpointCalls += 1;
      lastTokenRequestBody = new URLSearchParams(String(init?.body ?? ""));
      if (nextTokenError !== null) {
        return new Response(JSON.stringify({ error: nextTokenError }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ access_token: "at", token_type: "Bearer", id_token: nextIdToken }),
        {
          status: 200,
        },
      );
    }
    return ORIGINAL_FETCH(input, init);
  }) as typeof fetch;
}

async function seedOidcSettings(config: Record<string, unknown>): Promise<void> {
  await db.execute(
    sql`INSERT INTO system_settings (key, value) VALUES ('auth.telegram', ${JSON.stringify({
      enabled: true,
      bot_token: BOT_TOKEN,
      ...config,
    })})`,
  );
}

async function startFlow(over: { redirect?: string | null; ref?: string | null } = {}) {
  const result = await startTelegramOidcFlow({
    originHeader: ORIGIN,
    redirect: over.redirect ?? null,
    referralCode: over.ref ?? null,
  });
  if ("error" in result) throw new Error(`start failed: ${result.error}`);
  return result;
}

let tgSeq = 700_000_000;
function nextTelegramId(): number {
  tgSeq += 1;
  return tgSeq;
}

beforeAll(async () => {
  await initTestDb();
  // Tables the shared harness DDL does not carry (same block as the
  // telegram-auth-double-submit suite).
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
  await seedOidcSettings({ oidc_client_id: CLIENT_ID, oidc_client_secret: CLIENT_SECRET });
  stateTestHooks.resetMemoryStore();
  __testResetJwksCache();
  tokenEndpointCalls = 0;
  lastTokenRequestBody = null;
  nextTokenError = null;
  nextIdToken = "unconfigured";
});

describe("R154 — the authorization request (startTelegramOidcFlow)", () => {
  it("builds the official authorization URL: code + PKCE S256 + openid profile ONLY", async () => {
    const { authorizationUrl, state } = await startFlow({ redirect: "/checkout", ref: "subref" });
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe(TELEGRAM_OIDC_AUTH_ENDPOINT);

    const params = url.searchParams;
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/telegram/oidc/callback`);
    expect(params.get("response_type")).toBe("code");
    // THE phone-free contract: openid + profile, never phone, never
    // telegram:bot_access.
    expect(params.get("scope")).toBe("openid profile");
    expect(params.get("scope")).not.toContain("phone");
    expect(params.get("scope")).not.toContain("bot_access");
    expect(params.get("code_challenge_method")).toBe("S256");

    // The state is real and bound: consuming it yields the verifier whose
    // S256 hash IS the code_challenge, the nonce, and the caller's
    // redirect + referral.
    const stored = await consumeTelegramOidcState(state);
    expect(stored).not.toBeNull();
    const challenge = Buffer.from(createHash("sha256").update(stored!.verifier).digest()).toString(
      "base64url",
    );
    expect(params.get("code_challenge")).toBe(challenge);
    expect(params.get("nonce")).toBe(stored!.nonce);
    expect(stored!.redirect).toBe("/checkout");
    expect(stored!.referralCode).toBe("SUBREF");
    // RFC 7636: verifier 43-128 chars.
    expect(stored!.verifier.length).toBeGreaterThanOrEqual(43);
    expect(stored!.verifier.length).toBeLessThanOrEqual(128);
  });

  it("generates PKCE pairs inside the RFC bounds (property)", () => {
    for (let i = 0; i < 10; i += 1) {
      const { verifier, challenge } = generatePkcePair();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(challenge).toBe(
        Buffer.from(createHash("sha256").update(verifier).digest()).toString("base64url"),
      );
    }
  });

  it("an external redirect target is dropped (open-redirect guard)", async () => {
    const { state } = await startFlow({ redirect: "https://evil.example.com/x", ref: null });
    const stored = await consumeTelegramOidcState(state);
    expect(stored?.redirect).toBeNull();
  });

  it("refuses to start when OIDC credentials are not configured (compatibility path)", async () => {
    await db.execute(sql.raw(`DELETE FROM system_settings;`));
    await seedOidcSettings({}); // enabled + bot_token only — no OIDC creds
    const result = await startTelegramOidcFlow({
      originHeader: ORIGIN,
      redirect: null,
      referralCode: null,
    });
    expect("error" in result && result.error).toBe("provider_disabled");
  });
});

describe("R154 — completing the flow (completeTelegramOidcLogin)", () => {
  it("a first-time Telegram user registers with NO phone step and lands in the same linkage shape", async () => {
    const tgId = nextTelegramId();
    const { state } = await startFlow({ ref: null });
    const stored = await consumeTelegramOidcState(state);
    // Re-store it (the consume above was the test's own read) — the flow
    // consumes it for real inside completeTelegramOidcLogin.
    await (async () => {
      const { storeTelegramOidcState } = await import("../../lib/telegram-oidc-states");
      await storeTelegramOidcState(state, stored!);
    })();
    nextIdToken = signIdToken(validClaims({ id: tgId, nonce: stored!.nonce }));

    const result = await completeTelegramOidcLogin({
      code: "auth-code-1",
      state,
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isNewUser).toBe(true);
    expect(typeof result.token).toBe("string");

    // The token exchange carried the PKCE verifier + Basic auth shape.
    expect(tokenEndpointCalls).toBe(1);
    expect(lastTokenRequestBody?.get("grant_type")).toBe("authorization_code");
    expect(lastTokenRequestBody?.get("code")).toBe("auth-code-1");
    expect(lastTokenRequestBody?.get("code_verifier")).toBe(stored!.verifier);

    // The user row: classic id linkage, tg_ placeholder phone (never a
    // real number), profile fields from the verified claims.
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramId, String(tgId)));
    expect(user).toBeDefined();
    expect(user.phone).toBe(`tg_${tgId}`);
    expect(user.displayName).toBe("Ahmed Ali");
    expect(user.photoUrl).toBe("https://cdn4.telesco.pe/file/test.jpg");
    expect(user.authProvider).toBe("telegram");

    // The identity mirror row (providers/linked).
    const identities = await db
      .select()
      .from(userAuthIdentitiesTable)
      .where(eq(userAuthIdentitiesTable.providerUid, String(tgId)));
    expect(identities).toHaveLength(1);
    expect(identities[0]!.provider).toBe("telegram.org");
  });

  it("an EXISTING Telegram account logs in — no duplicate user (widget/OIDC coexistence)", async () => {
    const tgId = nextTelegramId();
    const [existing] = await db
      .insert(usersTable)
      .values({ phone: `tg_${tgId}`, telegramId: String(tgId), authProvider: "telegram" })
      .returning();

    const { state } = await startFlow();
    const stored = await consumeTelegramOidcState(state);
    const { storeTelegramOidcState } = await import("../../lib/telegram-oidc-states");
    await storeTelegramOidcState(state, stored!);
    nextIdToken = signIdToken(validClaims({ id: tgId, nonce: stored!.nonce }));

    const result = await completeTelegramOidcLogin({
      code: "auth-code-2",
      state,
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isNewUser).toBe(false);

    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramId, String(tgId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(existing.id);
  });

  it("the flow's state is SINGLE-USE — a replayed callback fails closed", async () => {
    const { state } = await startFlow();
    const stored = await consumeTelegramOidcState(state);
    const { storeTelegramOidcState } = await import("../../lib/telegram-oidc-states");
    await storeTelegramOidcState(state, stored!);
    nextIdToken = signIdToken(validClaims({ id: nextTelegramId(), nonce: stored!.nonce }));

    const first = await completeTelegramOidcLogin({
      code: "c1",
      state,
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(first.ok).toBe(true);

    const replay = await completeTelegramOidcLogin({
      code: "c1",
      state,
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe("oidc_state");
  });

  it("an UNKNOWN state fails closed", async () => {
    const result = await completeTelegramOidcLogin({
      code: "c",
      state: "never-issued",
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("oidc_state");
  });

  // ── R155: Telegram reports OAuth failures as HTTP 200 + {"error":..."}
  // (live-verified against the real endpoint). The R154 code only checked
  // the HTTP status — every grant failure fell through to the misleading
  // `oidc_missing_id_token` with NO log line, hiding the discriminator
  // between an operator-fixable credential problem and a code problem.
  it('a 200 + {"error":"invalid_client"} exchange surfaces the operator-actionable reason', async () => {
    const { state } = await startFlow();
    nextTokenError = "invalid_client";

    const result = await completeTelegramOidcLogin({
      code: "rejected-code",
      state,
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The DISTINCT reason — the login page and the logs can now say the
    // BotFather Client ID/Secret pair itself was rejected.
    expect(result.reason).toBe("oidc_invalid_client");
    // Fail-closed: no user row was created from the rejected exchange.
    const users = await db.select().from(usersTable);
    expect(users).toHaveLength(0);
  });

  it('a 200 + {"error":"invalid_grant"} exchange is an oidc_token_exchange failure, NOT a misleading missing-id-token', async () => {
    const { state } = await startFlow();
    nextTokenError = "invalid_grant";

    const result = await completeTelegramOidcLogin({
      code: "expired-or-used-code",
      state,
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // R155 behavior change: a grant error in a 200 body used to be
    // classified as `oidc_missing_id_token` (the response DID carry an
    // error — the id_token was never "missing", the grant was refused).
    expect(result.reason).toBe("oidc_token_exchange");
    const after = await db.select().from(usersTable);
    expect(after).toHaveLength(0);
  });

  it("a 200 with NO error and NO id_token stays the honest oidc_missing_id_token", async () => {
    const { state } = await startFlow();
    // Not an error body — a genuinely id_token-less success shape.
    nextIdToken = "";

    const result = await completeTelegramOidcLogin({
      code: "c",
      state,
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("oidc_missing_id_token");
  });

  it("fails closed with a SPECIFIC reason for every tampered/invalid token shape", async () => {
    const now = Math.floor(Date.now() / 1000);
    // All tokens carry the CALLER's nonce ("x") except the nonce-mismatch
    // case itself — so each verdict isolates ITS OWN claim failure.
    const cases: Array<{ label: string; token: string; expected: string }> = [
      {
        label: "wrong issuer",
        token: signIdToken(validClaims({ iss: "https://evil.example", nonce: "x" })),
        expected: "wrong_issuer",
      },
      {
        label: "wrong audience",
        token: signIdToken(validClaims({ aud: "9999999999", nonce: "x" })),
        expected: "wrong_audience",
      },
      {
        label: "expired",
        token: signIdToken(validClaims({ exp: now - 10 * 60, nonce: "x" })),
        expected: "expired",
      },
      {
        label: "issued in the future",
        token: signIdToken(validClaims({ iat: now + 20 * 60, nonce: "x" })),
        expected: "issued_in_future",
      },
      {
        label: "nonce mismatch",
        token: signIdToken(validClaims({ nonce: "attacker-nonce" })),
        expected: "nonce_mismatch",
      },
      {
        label: "missing classic id claim",
        token: signIdToken(validClaims({ id: undefined, nonce: "x" })),
        expected: "missing_id_claim",
      },
    ];
    for (const c of cases) {
      const verdict = await verifyTelegramOidcIdToken(c.token, { clientId: CLIENT_ID, nonce: "x" });
      expect(verdict.ok, c.label).toBe(false);
      if (!verdict.ok) expect(verdict.reason, c.label).toBe(c.expected);
    }
  });

  it("rejects alg-confusion and tampered signatures and unknown kids", async () => {
    // alg=HS256 header (signature garbage) — algorithm pinning.
    const hs = signIdToken(validClaims(), { alg: "HS256", kid: undefined });
    const hsVerdict = await verifyTelegramOidcIdToken(hs, { clientId: CLIENT_ID, nonce: "x" });
    expect(hsVerdict.ok).toBe(false);
    if (!hsVerdict.ok) expect(hsVerdict.reason).toBe("bad_algorithm");

    // Tampered payload (valid RS256 shape, signature over other bytes).
    const real = signIdToken(validClaims());
    const [h, , s] = real.split(".");
    const tamperedClaims = validClaims({ id: 111_222_333 });
    const forgedPayload = Buffer.from(JSON.stringify(tamperedClaims)).toString("base64url");
    const forged = `${h}.${forgedPayload}.${s}`;
    const forgedVerdict = await verifyTelegramOidcIdToken(forged, {
      clientId: CLIENT_ID,
      nonce: "x",
    });
    expect(forgedVerdict.ok).toBe(false);
    if (!forgedVerdict.ok) expect(forgedVerdict.reason).toBe("bad_signature");

    // Unknown kid — a JWKS rotation window fails closed.
    const unknownKid = signIdToken(validClaims(), { kid: "rotated-away" });
    const kidVerdict = await verifyTelegramOidcIdToken(unknownKid, {
      clientId: CLIENT_ID,
      nonce: "x",
    });
    expect(kidVerdict.ok).toBe(false);
    if (!kidVerdict.ok) expect(kidVerdict.reason).toBe("unknown_key");

    // Garbage token.
    const garbage = await verifyTelegramOidcIdToken("not-a-jwt", {
      clientId: CLIENT_ID,
      nonce: "x",
    });
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.reason).toBe("malformed_token");
  });

  it("a VALID token verifies and maps the documented claims (incl. the sub≠id discipline)", async () => {
    const tgId = nextTelegramId();
    const token = signIdToken(validClaims({ id: tgId }));
    const verdict = await verifyTelegramOidcIdToken(token, {
      clientId: CLIENT_ID,
      nonce: "PLACEHOLDER",
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    // The linkage key is the CLASSIC id — not `sub` (an internal
    // identifier of a different shape entirely).
    expect(verdict.identity.telegramId).toBe(String(tgId));
    expect(verdict.identity.telegramId).not.toBe("1234123412341234123");
    expect(verdict.identity.username).toBe("ahmed_ali");
    expect(verdict.identity.displayName).toBe("Ahmed Ali");
  });

  it("refuses when OIDC is not configured (no credentials → no flow)", async () => {
    await db.execute(sql.raw(`DELETE FROM system_settings;`));
    await seedOidcSettings({});
    const result = await completeTelegramOidcLogin({
      code: "c",
      state: "s",
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("provider_disabled");
  });
});

describe("R156 — the documented auth-code reality (the production fix)", () => {
  // ROOT CAUSE (live production, 2026-10-17): the /auth parameter table
  // documents NO nonce parameter and the discovery doc's claims_supported
  // omits it — the auth-code id_token legitimately arrives nonce-less,
  // so the R154 hard nonce requirement failed EVERY real login with
  // oidc_invalid_token («تعذر التحقق من هوية Telegram»). The nonce stays
  // enforced whenever Telegram actually echoes one.
  it("a nonce-LESS token verifies — the documented auth-code shape that failed every production login", async () => {
    const token = signIdToken(validClaims({ nonce: undefined }));
    const verdict = await verifyTelegramOidcIdToken(token, {
      clientId: CLIENT_ID,
      nonce: "stored-flow-nonce",
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.identity.telegramId).toBe("987654321");
  });

  it("the full production shape — nonce-less token end-to-end — registers and mints a session", async () => {
    const tgId = nextTelegramId();
    const { state } = await startFlow();
    const stored = await consumeTelegramOidcState(state);
    const { storeTelegramOidcState } = await import("../../lib/telegram-oidc-states");
    await storeTelegramOidcState(state, stored!);
    nextIdToken = signIdToken(validClaims({ id: tgId, nonce: undefined }));

    const result = await completeTelegramOidcLogin({
      code: "c-nonceless",
      state,
      originHeader: ORIGIN,
      client: { ipAddress: "127.0.0.1", userAgent: "vitest" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isNewUser).toBe(true);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.telegramId, String(tgId)));
    expect(user).toBeDefined();
  });

  it("ES256 (P-256) and EdDSA (Ed25519) tokens verify — the documented opt-in algorithms", async () => {
    const esId = nextTelegramId();
    const es = signEs256IdToken(validClaims({ id: esId, nonce: undefined }));
    const esVerdict = await verifyTelegramOidcIdToken(es, {
      clientId: CLIENT_ID,
      nonce: "stored",
    });
    expect(esVerdict.ok).toBe(true);
    if (!esVerdict.ok) return;
    expect(esVerdict.identity.telegramId).toBe(String(esId));

    const edId = nextTelegramId();
    const ed = signEdDsaIdToken(validClaims({ id: edId, nonce: undefined }));
    const edVerdict = await verifyTelegramOidcIdToken(ed, {
      clientId: CLIENT_ID,
      nonce: "stored",
    });
    expect(edVerdict.ok).toBe(true);
    if (!edVerdict.ok) return;
    expect(edVerdict.identity.telegramId).toBe(String(edId));
  });

  it("ES256K is refused, a tampered ES256 signature dies, and a kid/alg cross-mismatch never verifies", async () => {
    // ES256K: Node verifies no secp256k1 and Telegram rejects the profile
    // scope this flow requires when ES256K is selected — refused outright.
    const es256k = signIdToken(validClaims(), { alg: "ES256K", kid: EC_KID });
    const es256kVerdict = await verifyTelegramOidcIdToken(es256k, {
      clientId: CLIENT_ID,
      nonce: "x",
    });
    expect(es256kVerdict.ok).toBe(false);
    if (!es256kVerdict.ok) expect(es256kVerdict.reason).toBe("bad_algorithm");

    // Tampered payload under a REAL ES256 signature.
    const real = signEs256IdToken(validClaims({ nonce: undefined }));
    const [h, , s] = real.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify(validClaims({ id: 111_222_333, nonce: undefined })),
    ).toString("base64url");
    const forged = `${h}.${forgedPayload}.${s}`;
    const forgedVerdict = await verifyTelegramOidcIdToken(forged, {
      clientId: CLIENT_ID,
      nonce: "x",
    });
    expect(forgedVerdict.ok).toBe(false);
    if (!forgedVerdict.ok) expect(forgedVerdict.reason).toBe("bad_signature");

    // An RS256-header token pointing at the ES256 key — the JWKS key's
    // own alg field must refuse the cross-binding.
    const cross = signIdToken(validClaims(), { alg: "RS256", kid: EC_KID });
    const crossVerdict = await verifyTelegramOidcIdToken(cross, {
      clientId: CLIENT_ID,
      nonce: "x",
    });
    expect(crossVerdict.ok).toBe(false);
    if (!crossVerdict.ok) expect(crossVerdict.reason).toBe("bad_signature");
  });

  it("aud-as-number and id-as-string shapes (API drift tolerance) verify", async () => {
    const token = signIdToken(
      validClaims({ aud: Number(CLIENT_ID), id: String(987_654_321), nonce: undefined }),
    );
    const verdict = await verifyTelegramOidcIdToken(token, {
      clientId: CLIENT_ID,
      nonce: "stored",
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.identity.telegramId).toBe("987654321");
  });

  it("a nonce the token DOES carry must still match — fail-closed, never skipped", async () => {
    const wrong = signIdToken(validClaims({ nonce: "attacker-nonce" }));
    const verdict = await verifyTelegramOidcIdToken(wrong, {
      clientId: CLIENT_ID,
      nonce: "stored-flow-nonce",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("nonce_mismatch");
      // The R156 failure detail names its exact check (type-only, no
      // token values) so the next live failure is diagnosable.
      expect(verdict.detail?.noncePresent).toBe(true);
      expect(verdict.detail?.alg).toBe("RS256");
      expect(verdict.detail?.kid).toBe(KID);
    }
  });
});
