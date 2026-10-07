import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import express, { type Express } from "express";
import { generateSecret, generateSync } from "otplib";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminAuthRouter } from "../auth";

/**
 * R122 (A5-P2) — POST /api/admin/2fa/verify-setup per-admin attempt lockout.
 *
 * The sibling /login/verify-2fa has carried the H10 lockout since H10
 * ("TOTP codes are only 6 digits — without a per-admin attempt lockout
 * this endpoint was a cheap online brute-force"), but verify-setup verified
 * codes with nothing but the anonymous apiLimiter budget (admin requests
 * carry no user token). A stolen full session + an abandoned pending
 * enrollment (totpSecret set, totpEnabled=false) left the 10^6 keyspace
 * guessable — and a success flipped totpEnabled under a secret the real
 * admin never scanned (account lockout-DoS until reset).
 *
 * Locked behaviours (the exact H10 idiom, same `admin-2fa:{adminId}` key):
 *
 *   - 5 wrong codes → each 401; the 6th, even with the CORRECT code, is a
 *     429 ACCOUNT_LOCKED (checked BEFORE verification) and totpEnabled
 *     stays false;
 *   - a successful verify RESETS the counter (post-success failures start
 *     a fresh envelope, they don't continue the pre-success one);
 *   - an undecryptable secret blob is NOT the admin's guess — the uniform
 *     401 fires without recording an attempt (mirrors verify-2fa), so it
 *     can never lock the admin out of a retry.
 *
 * login_attempts is not part of the shared test DDL — this file owns its
 * schema (mirrors shared/db schema/login_attempts.ts, same as
 * 2fa-setup-password.test.ts / 2fa-totp-encryption.test.ts).
 */

/** A valid 32-byte hex key that is NOT the test env's ENCRYPTION_KEY. */
const WRONG_KEY = "ee".repeat(32);

/** Mint a LEGACY v1 blob with an arbitrary key (mirrors lib/encryption v1). */
function encryptV1WithKey(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminAuthRouter);
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

let adminSeq = 0;

/**
 * Seed an admin with a PENDING enrollment: a real, plaintext base32 secret
 * (safeDecrypt's legacy passthrough keeps it verifiable) + totpEnabled=false
 * — the exact abandoned-setup shape the A5 scenario describes.
 */
async function seedPendingAdmin(
  totpSecret: string | null = generateSecret(),
): Promise<{ adminId: number; secret: string; token: string }> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `admin_vslock_${String(adminSeq).padStart(3, "0")}`,
      passwordHash: "not-a-real-hash",
      isActive: true,
      totpEnabled: false,
      totpSecret,
    })
    .returning();
  return {
    adminId: a.id,
    secret: totpSecret ?? "",
    token: signAdminToken({ adminId: a.id, role: "admin" }),
  };
}

async function fetchRow(adminId: number): Promise<typeof adminUsersTable.$inferSelect> {
  const [row] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);
  return row!;
}

/** A code minted from a DIFFERENT secret — deterministically wrong for the
 * admin's real secret (unlike a fixed "000000", which has a 1e-6 chance of
 * being the live window's code). */
function wrongCode(): string {
  return generateSync({ secret: generateSecret() });
}

interface VerifyResponse {
  status: number;
  body: { success?: boolean; error?: string; code?: string };
}

async function postVerifySetup(url: string, token: string, code: string): Promise<VerifyResponse> {
  const res = await fetch(`${url}/api/admin/2fa/verify-setup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return { status: res.status, body: (await res.json()) as VerifyResponse["body"] };
}

beforeAll(async () => {
  await initTestDb();
  // pglite executes ONE statement per prepared query — split the DDL.
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS login_attempts (
  id serial PRIMARY KEY,
  identifier varchar(100) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now()
)`),
  );
  await db.execute(
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_login_attempts_identifier ON login_attempts (identifier)`,
    ),
  );
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw(`DELETE FROM login_attempts;`));
});

describe("R122 (A5-P2) — POST /api/admin/2fa/verify-setup attempt lockout", () => {
  it("5 wrong codes → 401s; the 6th, even with the CORRECT code, is 429 ACCOUNT_LOCKED and nothing is enabled", async () => {
    const admin = await seedPendingAdmin();
    const { url, close } = await listen(buildApp());
    try {
      for (let i = 0; i < 5; i++) {
        const res = await postVerifySetup(url, admin.token, wrongCode());
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHORIZED");
      }

      // The lockout check runs BEFORE code verification — a correct code
      // does not bypass an engaged lock.
      const locked = await postVerifySetup(
        url,
        admin.token,
        generateSync({ secret: admin.secret }),
      );
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe("ACCOUNT_LOCKED");

      // The enrollment was never completed.
      expect((await fetchRow(admin.adminId)).totpEnabled).toBe(false);
    } finally {
      close();
    }
  });

  it("a successful verify RESETS the counter — post-success failures start a fresh envelope", async () => {
    const admin = await seedPendingAdmin();
    const { url, close } = await listen(buildApp());
    try {
      // Four failures (count=4, one short of the 5-attempt lock)…
      for (let i = 0; i < 4; i++) {
        expect((await postVerifySetup(url, admin.token, wrongCode())).status).toBe(401);
      }
      // …then the correct code completes the enrollment and resets.
      const ok = await postVerifySetup(url, admin.token, generateSync({ secret: admin.secret }));
      expect(ok.status).toBe(200);
      expect(ok.body.success).toBe(true);
      expect((await fetchRow(admin.adminId)).totpEnabled).toBe(true);

      // Without the reset, the NEXT wrong code would be attempt #5 (lock
      // set) and the one after that a 429. With the reset both are plain
      // 401s from the fresh envelope.
      expect((await postVerifySetup(url, admin.token, wrongCode())).status).toBe(401);
      expect((await postVerifySetup(url, admin.token, wrongCode())).status).toBe(401);
    } finally {
      close();
    }
  });

  it("an undecryptable secret blob is NOT the admin's guess — the uniform 401 never records an attempt (mirrors verify-2fa)", async () => {
    // A v1 blob under a key nobody configured (the rotation-that-forgot
    // shape from 2fa-totp-encryption.test.ts). safeDecrypt fails; the route
    // answers the same 401 but must NOT increment the lockout counter.
    const admin = await seedPendingAdmin(encryptV1WithKey("some-old-secret", WRONG_KEY));
    const { url, close } = await listen(buildApp());
    try {
      for (let i = 0; i < 6; i++) {
        const res = await postVerifySetup(url, admin.token, "123456");
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHORIZED");
      }
      // Six failures, zero recorded — no 429 ever fires on this path.
      const recorded = await db.execute(
        sql`SELECT attempt_count FROM login_attempts WHERE identifier = ${`admin-2fa:${admin.adminId}`}`,
      );
      expect(recorded.rows).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("no pending enrollment → the unchanged 400 (contract preserved)", async () => {
    const admin = await seedPendingAdmin(null);
    const { url, close } = await listen(buildApp());
    try {
      const res = await postVerifySetup(url, admin.token, "123456");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_DATA");
    } finally {
      close();
    }
  });
});
