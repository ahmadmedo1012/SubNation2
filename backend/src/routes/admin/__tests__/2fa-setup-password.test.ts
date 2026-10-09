import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { adminUsersTable, db, initTestDb, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { hashPassword } from "../../../lib/crypto";
import { decrypt } from "../../../lib/encryption";
import { adminAuthRouter } from "../auth";

/**
 * 93-A1 S5 (round-93) — POST /api/admin/2fa/setup password re-entry.
 *
 * Before the fix the endpoint overwrote totpSecret + flipped totpEnabled
 * to false with nothing but the session cookie. An attacker holding an
 * 8h admin session could silently remove 2FA — and the compromise stayed
 * persistent after the session expired (the next password-only login
 * meets no TOTP challenge). /change-password and /profile already demand
 * current_password for equally high-leverage mutations; /2fa/setup must
 * too whenever the call would DISABLE an enabled 2FA.
 *
 * Locked behaviours (backend-first — the current admin UI sends no body,
 * so fresh enrollment stays password-optional; the disable case is the
 * actual S5 persistence vector and is now gated):
 *
 *   - totpEnabled=true  + no current_password      → 400 (gate)
 *   - totpEnabled=true  + wrong current_password    → 401 (+ lockout ramp)
 *   - totpEnabled=true  + correct current_password  → 200, secret rotated,
 *                                                      totpEnabled → false
 *   - totpEnabled=false + no current_password       → 200 (fresh enrollment)
 *   - totpEnabled=false + correct password          → 200
 *   - totpEnabled=false + WRONG password            → 401, secret untouched
 *   - 5 wrong passwords on the disable path         → 429 ACCOUNT_LOCKED
 *     (a stolen session cannot brute-force the re-auth gate)
 *
 * login_attempts is not part of the shared test DDL — this file owns its
 * schema (mirrors shared/db schema/login_attempts.ts, same as
 * lib/__tests__/lockout-upsert.test.ts).
 */

const ADMIN_PASSWORD = "CorrectHorse-Battery-93!";

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
  totpSecret?: string;
}): Promise<{ adminId: number; username: string; token: string }> {
  adminSeq += 1;
  const username = `admin_2fa_${String(adminSeq).padStart(3, "0")}`;
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
  // Bearer transport — requireAdmin falls back from req.cookies to the
  // Authorization header, so no cookie-parser is needed here.
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

interface SetupResponse {
  status: number;
  body: { secret?: string; otpauth_url?: string; error?: string; code?: string };
}

async function postSetup(
  url: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<SetupResponse> {
  const res = await fetch(`${url}/api/admin/2fa/setup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as SetupResponse["body"] };
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

describe("POST /api/admin/2fa/setup — fresh enrollment (totpEnabled=false)", () => {
  it("succeeds with NO body (the admin UI's current shape — enrollment must not break)", async () => {
    const admin = await seedAdmin({ totpEnabled: false });
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await postSetup(url, admin.token);
      expect(status).toBe(200);
      expect(typeof body.secret).toBe("string");
      expect(body.secret!.length).toBeGreaterThan(0);
      expect(body.otpauth_url).toContain("SubNation");

      const row = await fetchRow(admin.adminId);
      // R118-B1c (A4 F-4): the secret is stored ENCRYPTED at rest (v2
      // blob) — the response alone carries the plaintext, for enrollment.
      expect(row.totpSecret).not.toBe(body.secret);
      expect(row.totpSecret!.startsWith("v2:")).toBe(true);
      expect(decrypt(row.totpSecret!)).toBe(body.secret);
      // Enrollment is a two-step flow: enabled only after verify-setup.
      expect(row.totpEnabled).toBe(false);
    } finally {
      close();
    }
  });

  it("accepts a CORRECT current_password when one is presented", async () => {
    const admin = await seedAdmin({ totpEnabled: false });
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await postSetup(url, admin.token, {
        current_password: ADMIN_PASSWORD,
      });
      expect(status).toBe(200);
    } finally {
      close();
    }
  });

  it("rejects a WRONG current_password — never accept a silently-wrong credential", async () => {
    const admin = await seedAdmin({
      totpEnabled: false,
      totpSecret: "preexisting-fake-secret",
    });
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await postSetup(url, admin.token, {
        current_password: "wrong-password-entirely",
      });
      expect(status).toBe(401);
      expect(body.code).toBe("UNAUTHORIZED");
      // The pre-existing secret must NOT have been rotated on failure.
      const row = await fetchRow(admin.adminId);
      expect(row.totpSecret).toBe("preexisting-fake-secret");
    } finally {
      close();
    }
  });
});

describe("POST /api/admin/2fa/setup — disabling an ENABLED 2FA (the S5 vector)", () => {
  it("requires current_password: no body → 400, row untouched", async () => {
    const admin = await seedAdmin({
      totpEnabled: true,
      totpSecret: "enabled-fake-secret",
    });
    const { url, close } = await listen(buildApp());
    try {
      // The exact S5 attack: session-only request, no password proof.
      const { status, body } = await postSetup(url, admin.token);
      expect(status).toBe(400);
      expect(body.code).toBe("INVALID_DATA");

      const row = await fetchRow(admin.adminId);
      expect(row.totpSecret).toBe("enabled-fake-secret");
      expect(row.totpEnabled).toBe(true); // 2FA still on — attack blocked
    } finally {
      close();
    }
  });

  // R125-I5 (A3-1): the frontend re-enroll flow now sends current_password
  // on the rotate path — these two pin the gate's VALUE discipline so a
  // present-but-empty or wrong-typed field can never slip past the 400
  // (both must land on the same gate as a missing body).
  it("an EMPTY-STRING current_password is treated as missing → 400, row untouched", async () => {
    const admin = await seedAdmin({
      totpEnabled: true,
      totpSecret: "enabled-fake-secret",
    });
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await postSetup(url, admin.token, { current_password: "" });
      expect(status).toBe(400);
      expect(body.code).toBe("INVALID_DATA");

      const row = await fetchRow(admin.adminId);
      expect(row.totpEnabled).toBe(true);
      expect(row.totpSecret).toBe("enabled-fake-secret");
    } finally {
      close();
    }
  });

  it("a NON-STRING current_password is treated as missing → 400 (typeof gate)", async () => {
    const admin = await seedAdmin({
      totpEnabled: true,
      totpSecret: "enabled-fake-secret",
    });
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await postSetup(url, admin.token, { current_password: 12345678 });
      expect(status).toBe(400);

      const row = await fetchRow(admin.adminId);
      expect(row.totpEnabled).toBe(true);
      expect(row.totpSecret).toBe("enabled-fake-secret");
    } finally {
      close();
    }
  });

  it("wrong current_password → 401, row untouched", async () => {
    const admin = await seedAdmin({
      totpEnabled: true,
      totpSecret: "enabled-fake-secret",
    });
    const { url, close } = await listen(buildApp());
    try {
      const { status } = await postSetup(url, admin.token, {
        current_password: "not-the-password",
      });
      expect(status).toBe(401);
      const row = await fetchRow(admin.adminId);
      expect(row.totpEnabled).toBe(true);
      expect(row.totpSecret).toBe("enabled-fake-secret");
    } finally {
      close();
    }
  });

  it("correct current_password → 200, secret rotated AND totpEnabled flipped off (documented rotation semantics)", async () => {
    const admin = await seedAdmin({
      totpEnabled: true,
      totpSecret: "enabled-fake-secret",
    });
    const { url, close } = await listen(buildApp());
    try {
      const { status, body } = await postSetup(url, admin.token, {
        current_password: ADMIN_PASSWORD,
      });
      expect(status).toBe(200);
      expect(typeof body.secret).toBe("string");

      const row = await fetchRow(admin.adminId);
      // R118-B1c: rotation stores the NEW secret encrypted (v2 blob that
      // decrypts to the response secret); the old value is gone.
      expect(row.totpSecret!.startsWith("v2:")).toBe(true);
      expect(decrypt(row.totpSecret!)).toBe(body.secret);
      expect(row.totpSecret).not.toBe("enabled-fake-secret");
      expect(row.totpEnabled).toBe(false);
    } finally {
      close();
    }
  });

  it("repeated wrong passwords ramp into the lockout (429) — a stolen session cannot brute-force the re-auth gate", async () => {
    const admin = await seedAdmin({
      totpEnabled: true,
      totpSecret: "enabled-fake-secret",
    });
    const { url, close } = await listen(buildApp());
    try {
      let lastStatus = 0;
      for (let i = 0; i < 5; i++) {
        const res = await postSetup(url, admin.token, { current_password: `wrong-${i}` });
        lastStatus = res.status;
        expect(res.status).toBe(401);
      }
      // 5 failures recorded → the identifier is locked; even the CORRECT
      // password is now rejected with 429 ACCOUNT_LOCKED.
      const locked = await postSetup(url, admin.token, { current_password: ADMIN_PASSWORD });
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe("ACCOUNT_LOCKED");

      const row = await fetchRow(admin.adminId);
      expect(row.totpEnabled).toBe(true); // still protected
      expect(lastStatus).toBe(401);
    } finally {
      close();
    }
  });
});
