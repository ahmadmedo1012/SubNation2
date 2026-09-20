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
 * 98-F3 (R98-A1 P2-3/P2-4) — POST /api/auth/providers/unlink.
 *
 * Two defects these tests pin:
 *
 *   1. The "last auth method" check used to read ONE unordered identity
 *      row (limit(1), no ORDER BY) — for a user with ≥2 identities the
 *      scan-order row is arbitrary, so unlinking a method that ANOTHER
 *      method exists for was refused whenever the arbitrary row happened
 *      to be the target. The fix counts OTHER identities instead of
 *      peeking at one row.
 *
 *   2. Non-string provider/provider_uid passed the truthiness gate, hit
 *      no rows (driver serializes 5 → '5'), deleted nothing — and the
 *      route answered {success:true}. Strict type/trim/length validation
 *      + .returning() deleted-count now answer 400 (shape) and honest
 *      404 (unknown pair) respectively.
 *
 * Harness: real authRouter + requireUser over the pglite fixture DB with
 * a live sessions row (same shape as auth-probe-revocation.test.ts, which
 * this file's DDL block mirrors).
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

interface SeededSession {
  userId: number;
  token: string;
}

async function seedUser(): Promise<SeededSession> {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(91_500_000 + Math.floor(Math.random() * 1e6)) })
    .returning();
  const sessionId = randomUUID();
  await db.insert(sessionsTable).values({
    id: sessionId,
    userId: u.id,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  return { userId: u.id, token: signUserToken({ userId: u.id, sessionId }) };
}

/** 1 + n identities (telegram + google + …) for one user. */
async function seedIdentities(
  userId: number,
  specs: Array<{ provider: string; providerUid: string }>,
): Promise<void> {
  for (const spec of specs) {
    await db.insert(userAuthIdentitiesTable).values({
      userId,
      provider: spec.provider,
      providerUid: spec.providerUid,
    });
  }
}

async function postUnlink(
  url: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/auth/providers/unlink`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

async function identityCount(userId: number): Promise<number> {
  const rows = await db
    .select({ id: userAuthIdentitiesTable.id })
    .from(userAuthIdentitiesTable)
    .where(eq(userAuthIdentitiesTable.userId, userId));
  return rows.length;
}

beforeAll(async () => {
  await initTestDb();
  // user_auth_identities + auth_activity are not part of the shared test
  // DDL — this file owns them (mirrors shared/db/src/schema, same blocks
  // as auth-probe-revocation.test.ts; logAuthActivity inserts into
  // auth_activity on every unlink).
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
  user_id integer,
  identifier varchar(255) NOT NULL,
  action varchar(50) NOT NULL,
  provider varchar(50),
  success boolean NOT NULL,
  ip_address varchar(45),
  user_agent text,
  failure_reason varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
)`),
  );
});

beforeEach(async () => {
  await resetTestDb();
  __clearSessionValidityCacheForTests();
});

describe("98-F3 — POST /api/auth/providers/unlink", () => {
  it("3 identities, unlinking ANY of the three → success regardless of row scan order", async () => {
    const { url, close } = await listen(buildApp());
    try {
      // Unlink EVERY ordering position from a fresh 3-identity seed: the
      // count-based check must never refuse an unlink while ≥1 other
      // identity exists (the old limit(1) peek refused non-deterministic
      // targets).
      for (const target of [
        { provider: "google.com", provider_uid: "g-222" },
        { provider: "telegram.org", provider_uid: "tg-111" },
        { provider: "whatsapp", provider_uid: "wa-333" },
      ]) {
        await resetTestDb();
        __clearSessionValidityCacheForTests();
        const fresh = await seedUser();
        await seedIdentities(fresh.userId, [
          { provider: "telegram.org", providerUid: "tg-111" },
          { provider: "google.com", providerUid: "g-222" },
          { provider: "whatsapp", providerUid: "wa-333" },
        ]);
        const res = await postUnlink(url, fresh.token, target);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true });
        expect(await identityCount(fresh.userId)).toBe(2);
      }
    } finally {
      close();
    }
  });

  it("non-string provider/provider_uid → 400 (no silent no-op success)", async () => {
    const { userId, token } = await seedUser();
    await seedIdentities(userId, [
      { provider: "telegram.org", providerUid: "tg-111" },
      { provider: "google.com", providerUid: "g-222" },
    ]);

    const { url, close } = await listen(buildApp());
    try {
      const res = await postUnlink(url, token, { provider: 5, provider_uid: 7 });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      // Nothing was deleted.
      expect(await identityCount(userId)).toBe(2);
    } finally {
      close();
    }
  });

  it("an over-length provider (>100 chars) → 400", async () => {
    const { userId, token } = await seedUser();
    await seedIdentities(userId, [
      { provider: "telegram.org", providerUid: "tg-111" },
      { provider: "google.com", providerUid: "g-222" },
    ]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await postUnlink(url, token, {
        provider: "x".repeat(101),
        provider_uid: "g-222",
      });
      expect(res.status).toBe(400);
      expect(await identityCount(userId)).toBe(2);
    } finally {
      close();
    }
  });

  it("an UNKNOWN (provider, provider_uid) pair → honest 404, not {success:true}", async () => {
    const { userId, token } = await seedUser();
    await seedIdentities(userId, [
      { provider: "telegram.org", providerUid: "tg-111" },
      { provider: "google.com", providerUid: "g-222" },
    ]);

    const { url, close } = await listen(buildApp());
    try {
      const res = await postUnlink(url, token, {
        provider: "google.com",
        provider_uid: "never-linked",
      });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: "مزود المصادقة غير مرتبط" });
      expect(await identityCount(userId)).toBe(2);
    } finally {
      close();
    }
  });

  it("unlinking the LAST remaining identity → 400 «لا يمكن فصل آخر طريقة مصادقة»", async () => {
    const { userId, token } = await seedUser();
    await seedIdentities(userId, [
      { provider: "telegram.org", providerUid: "tg-111" },
      { provider: "google.com", providerUid: "g-222" },
    ]);

    const { url, close } = await listen(buildApp());
    try {
      // Unlink down to one identity…
      const first = await postUnlink(url, token, {
        provider: "google.com",
        provider_uid: "g-222",
      });
      expect(first.status).toBe(200);
      expect(await identityCount(userId)).toBe(1);
      // …then the last one must be refused.
      const second = await postUnlink(url, token, {
        provider: "telegram.org",
        provider_uid: "tg-111",
      });
      expect(second.status).toBe(400);
      expect(second.body).toMatchObject({ error: "لا يمكن فصل آخر طريقة مصادقة" });
      expect(await identityCount(userId)).toBe(1);
    } finally {
      close();
    }
  });

  it("2 identities where BOTH rows could match the old arbitrary-peek refusal → both unlinkable", async () => {
    // The exact P2-3 reproduction shape: a user with exactly 2
    // identities, unlinking one while the other remains. The old code
    // refused whenever the arbitrary first row was the TARGET — pin both
    // orderings by unlinking each in turn from a fresh seed.
    for (const target of [
      { provider: "telegram.org", provider_uid: "tg-A" },
      { provider: "firebase.com", provider_uid: "fb-B" },
    ]) {
      await resetTestDb();
      __clearSessionValidityCacheForTests();
      const { userId, token } = await seedUser();
      await seedIdentities(userId, [
        { provider: "telegram.org", providerUid: "tg-A" },
        { provider: "firebase.com", providerUid: "fb-B" },
      ]);
      const { url, close } = await listen(buildApp());
      try {
        const res = await postUnlink(url, token, target);
        expect(res.status).toBe(200);
        expect(await identityCount(userId)).toBe(1);
      } finally {
        close();
      }
    }
  });
});
