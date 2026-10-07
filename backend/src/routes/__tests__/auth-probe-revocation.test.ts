import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  sessionsTable,
  userAuthIdentitiesTable,
  usersTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { authRouter } from "../auth";
import { __clearSessionValidityCacheForTests } from "../../lib/session-liveness";

/**
 * 93-A1 S2 (round-93) — /api/auth/probe revocation parity.
 *
 * /probe deliberately bypasses requireUser (so anonymous cold boots
 * don't paint console-visible 401s) — but it used to verify the JWT
 * ALONE: a stolen token whose session row was deleted by logout /
 * logout-all / user deletion still received `authenticated: true` plus
 * the full profile (phone, email, wallet_balance, loyalty_points,
 * referral_code) and every linked identity for the token's remaining
 * 30-day life. /me rejects that token; /probe must too — while keeping
 * the 200-always contract.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
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

let phoneSeq = 91_400_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

interface SeededSession {
  userId: number;
  sessionId: string;
  token: string;
}

async function seedSession(): Promise<SeededSession> {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), displayName: "Probe Test User" })
    .returning();
  const sessionId = randomUUID();
  await db.insert(sessionsTable).values({
    id: sessionId,
    userId: u.id,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  await db.insert(userAuthIdentitiesTable).values({
    userId: u.id,
    provider: "telegram.org",
    providerUid: `probe-${u.id}`,
  });
  return {
    userId: u.id,
    sessionId,
    token: signUserToken({ userId: u.id, sessionId }),
  };
}

async function probe(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${url}/api/auth/probe`, { headers });
  const body = (await res.json()) as any;
  return { status: res.status, body };
}

beforeAll(async () => {
  await initTestDb();
  // user_auth_identities is not part of the shared test DDL — this file
  // owns it (mirrors shared/db/src/schema/user_auth_identities.ts).
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
});

beforeEach(async () => {
  await resetTestDb();
  __clearSessionValidityCacheForTests();
});

describe("GET /api/auth/probe — session revocation parity (93-A1 S2)", () => {
  it("anonymous request → 200 { authenticated: false } (unchanged contract)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await probe(url, {});
      expect(status).toBe(200);
      expect(body.authenticated).toBe(false);
      expect(body.user).toBeUndefined();
    } finally {
      close();
    }
  });

  it("live session → 200 { authenticated: true, user, linked_identities } (unchanged)", async () => {
    const seeded = await seedSession();
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await probe(url, { Cookie: `auth_token=${seeded.token}` });
      expect(status).toBe(200);
      expect(body.authenticated).toBe(true);
      expect(body.user.phone).toBeDefined();
      expect(Array.isArray(body.user.linked_identities)).toBe(true);
    } finally {
      close();
    }
  });

  it("session row DELETED (logout / logout-all) → 200 { authenticated: false }, no PII", async () => {
    const seeded = await seedSession();
    await db.delete(sessionsTable).where(eq(sessionsTable.id, seeded.sessionId));
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await probe(url, { Cookie: `auth_token=${seeded.token}` });
      expect(status).toBe(200); // 200-always contract preserved
      expect(body.authenticated).toBe(false);
      expect(body.user).toBeUndefined();
    } finally {
      close();
    }
  });

  it("session row EXPIRED → 200 { authenticated: false }", async () => {
    const [u] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
    const sessionId = randomUUID();
    await db.insert(sessionsTable).values({
      id: sessionId,
      userId: u.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    const token = signUserToken({ userId: u.id, sessionId });
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await probe(url, { Cookie: `auth_token=${token}` });
      expect(body.authenticated).toBe(false);
    } finally {
      close();
    }
  });

  it("works via Authorization: Bearer header too (the stolen-JWT copy channel)", async () => {
    const seeded = await seedSession();
    await db.delete(sessionsTable).where(eq(sessionsTable.id, seeded.sessionId));
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await probe(url, { Authorization: `Bearer ${seeded.token}` });
      expect(body.authenticated).toBe(false);
    } finally {
      close();
    }
  });

  it("legacy token WITHOUT sessionId still authenticates OUTSIDE production (fixtures)", async () => {
    const [u] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
    const legacyToken = signUserToken({ userId: u.id }); // no sessionId claim
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await probe(url, { Cookie: `auth_token=${legacyToken}` });
      expect(body.authenticated).toBe(true);
    } finally {
      close();
    }
  });

  it("legacy sid-less token is REJECTED in production — no authenticated:true, no PII (R120-B6/A8-F1)", async () => {
    // requireUser (r103, AUD103-3-F5) and the admin probe both fail-closed
    // on sid-less tokens in production — the user probe used to hand the
    // full profile to an unrevokable legacy token. Mirror test: flip
    // NODE_ENV just for the request (the route reads it per-request).
    const [u] = await db.insert(usersTable).values({ phone: nextPhone() }).returning();
    const legacyToken = signUserToken({ userId: u.id }); // no sessionId claim
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await probe(url, { Cookie: `auth_token=${legacyToken}` });
      expect(status).toBe(200); // 200-always contract preserved
      expect(body.authenticated).toBe(false);
      expect(body.user).toBeUndefined();
    } finally {
      close();
      if (previousEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousEnv;
      }
    }
  });

  it("sid-carrying token still authenticates in production (only the sid-less branch fails closed)", async () => {
    const seeded = await seedSession();
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await probe(url, { Cookie: `auth_token=${seeded.token}` });
      expect(body.authenticated).toBe(true);
      expect(body.user.phone).toBeDefined();
    } finally {
      close();
      if (previousEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousEnv;
      }
    }
  });

  it("garbage token → 200 { authenticated: false } (unchanged)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { body } = await probe(url, { Cookie: "auth_token=not-a-jwt" });
      expect(body.authenticated).toBe(false);
    } finally {
      close();
    }
  });
});
