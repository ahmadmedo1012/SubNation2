/**
 * R118-B1c (A4 F-4) — totp_secret encrypted at rest.
 *
 * admin_users.totp_secret used to hold the base32 secret in plaintext: a
 * DB-dump leak that defeated argon2id (or any SQL read) also defeated the
 * second factor — the attacker could mint valid TOTP codes offline. The
 * fix encrypts the CONTENT of the column with the same AES-256-GCM
 * helpers as the inventory credentials (v2 blob on write, safeDecrypt on
 * read), with zero API-contract change and zero migration (the live value
 * is NULL — no admin is enrolled yet).
 *
 * Locked behaviours (real DB, real otplib, real routes — no mocks):
 *
 *   - /2fa/setup stores a v2 ciphertext, NOT the plaintext; the response
 *     still returns the plaintext secret + otpauth URL (enrollment UX);
 *   - /2fa/verify-setup verifies against the DECRYPTED secret and flips
 *     totp_enabled on success;
 *   - /login meets the enabled-2FA admin with requires_2fa, and
 *     /login/verify-2fa completes with a code minted from the returned
 *     secret — the full end-to-end flow against encrypted storage;
 *   - legacy PLAINTEXT secrets still verify (safeDecrypt passthrough);
 *   - an undecryptable secret blob fails with the uniform 401, never a
 *     500, and never mints a session;
 *   - a wrong code against encrypted storage stays the plain 401.
 *
 * login_attempts DDL: the shared test DDL does not carry it (same as
 * 2fa-setup-password.test.ts — the verify-2fa per-admin lockout needs it).
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import express, { type Express } from "express";
import { generateSecret, generateSync } from "otplib";
import { adminUsersTable, adminSessionsTable, db, initTestDb, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { hashPassword } from "../../../lib/crypto";
import { adminAuthRouter } from "../auth";

const ADMIN_PASSWORD = "CorrectHorse-Battery-R118!";

/** A valid 32-byte hex key that is NOT the test env's ENCRYPTION_KEY. */
const WRONG_KEY = "ff".repeat(32);

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

async function seedAdmin(options: {
  totpEnabled?: boolean;
  totpSecret?: string | null;
}): Promise<{ adminId: number; username: string; token: string }> {
  adminSeq += 1;
  const username = `admin_totp_${String(adminSeq).padStart(3, "0")}`;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username,
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      isActive: true,
      totpEnabled: options.totpEnabled ?? false,
      totpSecret: options.totpSecret ?? null,
    })
    .returning();
  return { adminId: a.id, username, token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

async function fetchRow(adminId: number): Promise<typeof adminUsersTable.$inferSelect> {
  const [row] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.id, adminId))
    .limit(1);
  return row!;
}

interface JsonBody {
  status: number;
  body: Record<string, unknown>;
  cookies: string[];
}

async function postJson(url: string, path: string, body: unknown, token?: string): Promise<JsonBody> {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    cookies: res.headers.getSetCookie(),
  };
}

beforeAll(async () => {
  await initTestDb();
  // pglite executes ONE statement per prepared query — split the DDL
  // (same shape as 2fa-setup-password.test.ts; the verify-2fa per-admin
  // lockout reads/writes login_attempts).
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

describe("R118-B1c (A4 F-4) — TOTP secret encrypted at rest", () => {
  it("/2fa/setup stores a v2 CIPHERTEXT, returns the PLAINTEXT secret (contract unchanged)", async () => {
    const admin = await seedAdmin({ totpEnabled: false });
    const { url, close } = await listen(buildApp());
    try {
      const res = await postJson(url, "/api/admin/2fa/setup", {}, admin.token);
      expect(res.status).toBe(200);
      const secret = res.body.secret;
      expect(typeof secret).toBe("string");
      expect((secret as string).length).toBeGreaterThan(0);
      expect(res.body.otpauth_url).toContain("SubNation");

      const row = await fetchRow(admin.adminId);
      // Encrypted at rest: v2 blob that is NOT the plaintext response…
      expect(row.totpSecret).not.toBe(secret);
      expect((row.totpSecret as string).startsWith("v2:")).toBe(true);
      // …and does not CONTAIN it either (GCM, not encoding).
      expect((row.totpSecret as string).includes(secret as string)).toBe(false);
      expect(row.totpEnabled).toBe(false);
    } finally {
      close();
    }
  });

  it("end-to-end: setup → verify-setup (code from the returned secret) → login challenge → verify-2fa session", async () => {
    const admin = await seedAdmin({ totpEnabled: false });
    const { url, close } = await listen(buildApp());
    try {
      // Step 1: enrollment mints the encrypted secret.
      const setup = await postJson(url, "/api/admin/2fa/setup", {}, admin.token);
      expect(setup.status).toBe(200);
      const secret = setup.body.secret as string;

      // Step 2: verify-setup with a REAL authenticator code — the route
      // must decrypt the stored blob to verify it.
      const verifySetup = await postJson(url, "/api/admin/2fa/verify-setup", {
        code: generateSync({ secret }),
      }, admin.token);
      expect(verifySetup.status).toBe(200);
      expect(verifySetup.body.success).toBe(true);
      expect((await fetchRow(admin.adminId)).totpEnabled).toBe(true);

      // Step 3: password login now meets the TOTP challenge.
      const login = await postJson(url, "/api/admin/login", {
        username: admin.username,
        password: ADMIN_PASSWORD,
      });
      expect(login.status).toBe(200);
      expect(login.body.requires_2fa).toBe(true);
      const tempToken = login.body.temp_token as string;
      expect(typeof tempToken).toBe("string");

      // Step 4: verify-2fa with a fresh code mints the full session.
      const verify2fa = await postJson(url, "/api/admin/login/verify-2fa", {
        temp_token: tempToken,
        code: generateSync({ secret }),
      });
      expect(verify2fa.status).toBe(200);
      expect(verify2fa.body.display_name).toBe("Admin");
      // R97-02: the session rides an httpOnly cookie, no token in the body.
      expect(verify2fa.body.token).toBeUndefined();
      expect(
        verify2fa.cookies.some((c) => c.startsWith("admin_token=")),
      ).toBe(true);

      // A durable, revocable session row exists (A8-01 chain intact).
      const sessions = await db
        .select()
        .from(adminSessionsTable)
        .where(eq(adminSessionsTable.adminId, admin.adminId));
      expect(sessions).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("legacy PLAINTEXT secret still verifies (pre-encryption enrollment / hand-seeded row)", async () => {
    // A REAL base32 secret (minted by the same generator the setup path
    // uses) seeded directly as plaintext — the safeDecrypt passthrough
    // keeps it working with zero migration.
    const plaintextSecret = generateSecret();
    const admin = await seedAdmin({ totpEnabled: true, totpSecret: plaintextSecret });
    const { url, close } = await listen(buildApp());
    try {
      const login = await postJson(url, "/api/admin/login", {
        username: admin.username,
        password: ADMIN_PASSWORD,
      });
      expect(login.body.requires_2fa).toBe(true);

      const verify2fa = await postJson(url, "/api/admin/login/verify-2fa", {
        temp_token: login.body.temp_token,
        code: generateSync({ secret: plaintextSecret }),
      });
      expect(verify2fa.status).toBe(200);
      expect(verify2fa.cookies.some((c) => c.startsWith("admin_token="))).toBe(true);
    } finally {
      close();
    }
  });

  it("undecryptable secret blob → uniform 401, never a 500, never a session", async () => {
    // A v1 blob under a key nobody configured (the rotation-that-forgot
    // shape). Both verify paths must fail CLOSED with the same envelope.
    const admin = await seedAdmin({
      totpEnabled: true,
      totpSecret: encryptV1WithKey("some-old-secret", WRONG_KEY),
    });
    const { url, close } = await listen(buildApp());
    try {
      const login = await postJson(url, "/api/admin/login", {
        username: admin.username,
        password: ADMIN_PASSWORD,
      });
      expect(login.body.requires_2fa).toBe(true);

      const verify2fa = await postJson(url, "/api/admin/login/verify-2fa", {
        temp_token: login.body.temp_token,
        code: "123456",
      });
      expect(verify2fa.status).toBe(401);
      expect(verify2fa.body.code).toBe("UNAUTHORIZED");

      const sessions = await db
        .select()
        .from(adminSessionsTable)
        .where(eq(adminSessionsTable.adminId, admin.adminId));
      expect(sessions).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("a wrong code against ENCRYPTED storage stays the plain 401 (and records the lockout attempt)", async () => {
    const admin = await seedAdmin({ totpEnabled: false });
    const { url, close } = await listen(buildApp());
    try {
      const setup = await postJson(url, "/api/admin/2fa/setup", {}, admin.token);
      const secret = setup.body.secret as string;
      const verifySetup = await postJson(url, "/api/admin/2fa/verify-setup", {
        code: generateSync({ secret }),
      }, admin.token);
      expect(verifySetup.status).toBe(200);

      const login = await postJson(url, "/api/admin/login", {
        username: admin.username,
        password: ADMIN_PASSWORD,
      });
      const verify2fa = await postJson(url, "/api/admin/login/verify-2fa", {
        temp_token: login.body.temp_token,
        code: "000000",
      });
      expect(verify2fa.status).toBe(401);
      expect(verify2fa.body.code).toBe("UNAUTHORIZED");
      expect(verify2fa.cookies).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("/2fa/verify-setup with a wrong code → 401, totpEnabled stays false", async () => {
    const admin = await seedAdmin({ totpEnabled: false });
    const { url, close } = await listen(buildApp());
    try {
      const setup = await postJson(url, "/api/admin/2fa/setup", {}, admin.token);
      expect(setup.status).toBe(200);

      const bad = await postJson(url, "/api/admin/2fa/verify-setup", { code: "000000" }, admin.token);
      expect(bad.status).toBe(401);
      expect((await fetchRow(admin.adminId)).totpEnabled).toBe(false);
    } finally {
      close();
    }
  });

  it("NULL secret (the live production shape — no admin enrolled) keeps the existing 400/401 contracts", async () => {
    const admin = await seedAdmin({ totpEnabled: false, totpSecret: null });
    const { url, close } = await listen(buildApp());
    try {
      // No setup yet → verify-setup 400 (unchanged).
      const noSetup = await postJson(url, "/api/admin/2fa/verify-setup", { code: "123456" }, admin.token);
      expect(noSetup.status).toBe(400);

      // totpEnabled=false + NULL secret → plain login, no 2FA challenge.
      const login = await postJson(url, "/api/admin/login", {
        username: admin.username,
        password: ADMIN_PASSWORD,
      });
      expect(login.status).toBe(200);
      expect(login.body.requires_2fa).toBeUndefined();
    } finally {
      close();
    }
  });
});
