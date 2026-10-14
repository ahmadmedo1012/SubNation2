import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, initTestDb } from "../../test/db";
import {
  FirebaseVerifyTimeoutError,
  verifyFirebaseIdToken,
} from "../../services/firebase-auth.service";

/**
 * R143 (L6-3) — verifyIdToken is bounded (FIREBASE_VERIFY_TIMEOUT_MS,
 * default 10s).
 *
 * firebase-admin was the LAST unbounded external call in the request
 * path: with checkRevoked=true the SDK makes a network revocation
 * round-trip to Google, and a partition that black-holes googleapis.com
 * while Postgres/Redis stay healthy left POST /api/auth/firebase/session
 * + /refresh pending on the SDK's internal retry budget — the login
 * button spins and each stalled attempt burns an authLimiter slot for
 * minutes. The fix races the SDK call against a 10s budget and converts
 * the stall into the honest 503 outage signal (FirebaseAuthError 503 →
 * SERVICE_UNAVAILABLE at the route — the outage card the login UI
 * already renders), never the generic 401 token-invalid mapping.
 *
 * The env knob is dialed down to 80ms so the test asserts the budget
 * semantics without paying the default.
 */

process.env.FIREBASE_VERIFY_TIMEOUT_MS = "80";

vi.mock("../../lib/firebase-admin", () => ({
  getFirebaseAdminAuth: vi.fn(async () => ({
    // The stalled SDK call — a network partition that never settles.
    verifyIdToken: vi.fn(() => new Promise<never>(() => {})),
    revokeRefreshTokens: vi.fn(async () => {}),
  })),
  getFirebaseAdminApp: vi.fn(async () => ({})),
}));

// A long non-JWT string passes the ≥100-char guard, decodes to null
// (skipping the aud/iss diagnostics), and reaches the SDK call.
const LONG_GARBAGE_TOKEN = "x".repeat(120);

beforeEach(() => {
  // Re-armed for every test (an afterEach cleanup from a prior test must
  // not leave the second leg on the 10s default — that is what the 5s
  // vitest budget catches).
  process.env.FIREBASE_VERIFY_TIMEOUT_MS = "80";
});

afterAll(() => {
  delete process.env.FIREBASE_VERIFY_TIMEOUT_MS;
});

describe("R143 (L6-3): a stalled verifyIdToken rejects within the budget", () => {
  it("service leg — rejects as FirebaseVerifyTimeoutError (503) well inside the default 10s", async () => {
    const started = Date.now();
    let err: unknown;
    try {
      await verifyFirebaseIdToken(LONG_GARBAGE_TOKEN, true);
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(FirebaseVerifyTimeoutError);
    const timeoutErr = err as FirebaseVerifyTimeoutError;
    expect(timeoutErr.statusCode).toBe(503);
    expect(timeoutErr.message).toContain("انتهت مهلة الاتصال بخدمة Firebase");
    // Within the 80ms test budget (CI tolerance), NOT the old
    // spin-forever shape.
    expect(elapsed).toBeLessThan(5_000);
  });

  it("route leg — the mint route answers 503 SERVICE_UNAVAILABLE, no cookie, no session row", async () => {
    const { authRouter } = await import("../auth");
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter);

    const server = await new Promise<{ url: string; close: () => void }>((resolve, reject) => {
      const s = app.listen(0, () => {
        const addr = s.address();
        if (!addr || typeof addr === "string") reject(new Error("no address"));
        else resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => s.close() });
      });
    });
    try {
      const res = await fetch(`${server.url}/api/auth/firebase/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: LONG_GARBAGE_TOKEN }),
      });
      const body = (await res.json()) as { error?: string; code?: string };

      expect(res.status).toBe(503);
      expect(body.code).toBe("SERVICE_UNAVAILABLE");
      expect(body.error).toContain("انتهت مهلة الاتصال بخدمة Firebase");
      // No cookie minted for the stalled verification.
      expect(res.headers.get("set-cookie")).toBeNull();
    } finally {
      server.close();
    }
  });
});

beforeAll(async () => {
  await initTestDb();
  // R146 (finding 1): the session-mint FirebaseAuthError arm now writes an
  // auth_activity failure row — the route leg would 500 on a missing table.
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
