import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * R118-A5 TOP-20 #7 [P2] — the sessions half of routes/auth.ts
 * (GET/DELETE /sessions, /logout, /logout-all-devices,
 * /onboarding/complete). Only /probe and /providers/unlink were
 * route-tested before this suite.
 *
 * Pinned contracts:
 *
 *   - POST /logout deletes the CURRENT session row (V1-H3: a stolen
 *     token does not survive logout) and leaves the user's OTHER
 *     devices alone;
 *   - POST /logout-all-devices revokes EVERY session row for the caller
 *     — including the current one (the route deletes by user_id first,
 *     then clears the cookie; the current device is logged out WITH the
 *     rest, it does not survive) — while another user's sessions are
 *     untouched;
 *   - GET /sessions lists the caller's LIVE sessions only (expired rows
 *     excluded), newest-first, with the current flag on the caller's own
 *     session;
 *   - DELETE /sessions/:id is ownership-scoped: another user's session
 *     id → 404 (no cross-user revocation, no silent success);
 *   - POST /onboarding/complete marks the caller onboarded (step 5) and
 *     is idempotent.
 *
 * Harness: real authRouter + requireUser over the pglite fixture DB with
 * live sessions rows (same shape as auth-unlink.test.ts, whose DDL
 * block this file mirrors — auth_activity is required because logout
 * paths logAuthActivity).
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

let phoneSeq = 0;
async function seedUser(): Promise<{ id: number }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `94801${String(phoneSeq).padStart(5, "0")}` })
    .returning();
  return { id: u.id };
}

/** Create a session row + the matching token for a user. */
async function createSession(userId: number, expiresInMs = 30 * 24 * 60 * 60 * 1000) {
  const sessionId = randomUUID();
  await db.insert(sessionsTable).values({
    id: sessionId,
    userId,
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0",
    ipAddress: "127.0.0.1",
    expiresAt: new Date(Date.now() + expiresInMs),
  });
  return { sessionId, token: signUserToken({ userId, sessionId }) };
}

async function sessionIdsFor(userId: number): Promise<string[]> {
  const rows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(eq(sessionsTable.userId, userId));
  return rows.map((r) => r.id);
}

async function request(
  url: string,
  method: string,
  path: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> | null; setCookie: string | null }> {
  const res = await fetch(`${url}/api/auth${path}`, {
    method,
    headers: token ? { Cookie: `auth_token=${token}` } : {},
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    setCookie: res.headers.get("set-cookie"),
  };
}

beforeAll(async () => {
  await initTestDb();
  // user_auth_identities + auth_activity are not part of the shared test
  // DDL — this file owns them (same blocks as auth-unlink.test.ts; the
  // logout paths logAuthActivity into auth_activity).
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

describe("POST /api/auth/logout (R118-A5 #7)", () => {
  it("revokes the CURRENT session row and leaves the user's other devices logged in", async () => {
    const user = await seedUser();
    const current = await createSession(user.id);
    const otherDevice = await createSession(user.id);

    const { url, close } = await listen(buildApp());
    try {
      const res = await request(url, "POST", "/logout", current.token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });

      // The current session row is GONE (V1-H3 — the JWT is dead
      // server-side, not just the cookie)…
      const remaining = await sessionIdsFor(user.id);
      expect(remaining).toHaveLength(1);
      expect(remaining).not.toContain(current.sessionId);
      // …while the other device keeps its session.
      expect(remaining).toContain(otherDevice.sessionId);

      // The auth cookie is cleared on the response.
      expect(res.setCookie).toContain("auth_token=");
      expect(res.setCookie).toContain("Expires=Thu, 01 Jan 1970");
    } finally {
      close();
    }
  });

  it("the revoked token no longer passes requireUser (session row is the revocation truth)", async () => {
    const user = await seedUser();
    const current = await createSession(user.id);
    const { url, close } = await listen(buildApp());
    try {
      expect((await request(url, "POST", "/logout", current.token)).status).toBe(200);
      __clearSessionValidityCacheForTests();
      const after = await request(url, "GET", "/sessions", current.token);
      expect(after.status).toBe(401);
    } finally {
      close();
    }
  });
});

describe("POST /api/auth/logout-all-devices (R118-A5 #7)", () => {
  it("revokes EVERY session for the caller — including the current one — and leaves other users untouched", async () => {
    const user = await seedUser();
    const current = await createSession(user.id);
    await createSession(user.id);
    await createSession(user.id);
    const stranger = await seedUser();
    const strangerSession = await createSession(stranger.id);

    const { url, close } = await listen(buildApp());
    try {
      const res = await request(url, "POST", "/logout-all-devices", current.token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });

      // The route deletes by user_id — the caller's CURRENT session dies
      // with the rest (deviation from the A5 sketch, which expected the
      // current session to survive; the code's device list is backed by
      // these rows and the cookie is cleared right after).
      expect(await sessionIdsFor(user.id)).toHaveLength(0);
      // Cross-user isolation: the stranger's session survives.
      expect(await sessionIdsFor(stranger.id)).toEqual([strangerSession.sessionId]);
      expect(res.setCookie).toContain("auth_token=");
    } finally {
      close();
    }
  });
});

describe("GET /api/auth/sessions (R118-A5 #7)", () => {
  it("lists the caller's LIVE sessions only (expired excluded), newest-first, current flag on the caller's own session", async () => {
    const user = await seedUser();
    const older = await createSession(user.id);
    const current = await createSession(user.id);
    // An EXPIRED session row — filtered out by the expires_at >= now gate.
    await createSession(user.id, -60_000);
    const stranger = await seedUser();
    await createSession(stranger.id);

    const { url, close } = await listen(buildApp());
    try {
      const res = await request(url, "GET", "/sessions", current.token);
      expect(res.status).toBe(200);
      const sessions = (res.body?.sessions ?? []) as Array<Record<string, unknown>>;
      expect(sessions).toHaveLength(2);

      const ids = sessions.map((s) => s.id as string);
      expect(ids).toContain(older.sessionId);
      expect(ids).toContain(current.sessionId);
      // The stranger's session never appears.
      const strangerIds = await sessionIdsFor(stranger.id);
      expect(ids).not.toContain(strangerIds[0]);

      // Newest-first ordering.
      expect(ids[0]).toBe(current.sessionId);
      // The current flag marks exactly the caller's own session…
      const flagged = sessions.filter((s) => s.current === true);
      expect(flagged).toHaveLength(1);
      expect(flagged[0].id).toBe(current.sessionId);
      // …and the response shape is the device-list contract.
      expect(sessions[0]).toMatchObject({
        id: current.sessionId,
        device: expect.any(String),
        user_agent: expect.stringContaining("Chrome"),
        ip: "127.0.0.1",
        created_at: expect.any(String),
        expires_at: expect.any(String),
        lastActive: expect.any(String),
      });
    } finally {
      close();
    }
  });

  it("401 without a token", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await request(url, "GET", "/sessions");
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});

describe("DELETE /api/auth/sessions/:id (R118-A5 #7)", () => {
  it("deletes the caller's OWN session", async () => {
    const user = await seedUser();
    const victim = await createSession(user.id);
    const keeper = await createSession(user.id);

    const { url, close } = await listen(buildApp());
    try {
      const res = await request(url, "DELETE", `/sessions/${victim.sessionId}`, keeper.token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
      expect(await sessionIdsFor(user.id)).toEqual([keeper.sessionId]);
    } finally {
      close();
    }
  });

  it("another user's session id → 404 (ownership-scoped — no cross-user revocation, no silent success)", async () => {
    const attacker = await seedUser();
    const attackerSession = await createSession(attacker.id);
    const victim = await seedUser();
    const victimSession = await createSession(victim.id);

    const { url, close } = await listen(buildApp());
    try {
      const res = await request(
        url,
        "DELETE",
        `/sessions/${victimSession.sessionId}`,
        attackerSession.token,
      );
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: "NOT_FOUND" });
      // The victim's session is untouched.
      expect(await sessionIdsFor(victim.id)).toEqual([victimSession.sessionId]);
      // The attacker's own session survives the refused request.
      expect(await sessionIdsFor(attacker.id)).toEqual([attackerSession.sessionId]);
    } finally {
      close();
    }
  });
});

describe("POST /api/auth/onboarding/complete (R118-A5 #7)", () => {
  it("marks the caller onboarded (step 5) and is idempotent", async () => {
    const user = await seedUser();
    const session = await createSession(user.id);

    const { url, close } = await listen(buildApp());
    try {
      const first = await request(url, "POST", "/onboarding/complete", session.token);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ success: true });

      let [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
      expect(row.onboardedAt).toBeInstanceOf(Date);
      expect(row.onboardingStep).toBe(5);

      // Re-completing stays a success and never duplicates or regresses.
      const second = await request(url, "POST", "/onboarding/complete", session.token);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ success: true });
      [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
      expect(row.onboardedAt).toBeInstanceOf(Date);
      expect(row.onboardingStep).toBe(5);

      // Another user is NOT marked by proxy.
      const stranger = await seedUser();
      const [strangerRow] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, stranger.id));
      expect(strangerRow.onboardedAt).toBeNull();
    } finally {
      close();
    }
  });
});

// R122 (A5-P2-3): GET /sessions and GET /providers/linked were the only
// authenticated user GETs without Cache-Control: no-store — /me, /probe and
// six whole routers (orders, wallet, support, notifications, cart, loyalty)
// already carry it. The device list (session ids, IPs, UAs) and the linked
// provider list (provider_uid, emails, phones) are per-user PII that an
// intermediary or a future "cache everything" edge rule must never serve
// stale — especially after logout.
describe("R122 (A5-P2-3) — no-store on the two straggler authenticated GETs", () => {
  it("GET /sessions ships Cache-Control: no-store", async () => {
    const user = await seedUser();
    const session = await createSession(user.id);
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/auth/sessions`, {
        headers: { Cookie: `auth_token=${session.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });

  it("GET /providers/linked ships Cache-Control: no-store", async () => {
    const user = await seedUser();
    const session = await createSession(user.id);
    // One linked identity so the payload genuinely carries the PII shape.
    await db.insert(userAuthIdentitiesTable).values({
      userId: user.id,
      provider: "telegram",
      providerUid: "123456789",
      phone: "0910000001",
    });
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/auth/providers/linked`, {
        headers: { Cookie: `auth_token=${session.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = (await res.json()) as { providers: unknown[] };
      expect(body.providers).toHaveLength(1);
    } finally {
      close();
    }
  });
});
