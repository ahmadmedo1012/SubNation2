import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  adminUsersTable,
  copilotActionsTable,
  db,
  initTestDb,
  resetTestDb,
  systemSettingsTable,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { clearPhaseFlagsCache } from "../../services/copilot/phase-flags";
import { copilotRouter } from "../admin/copilot";

/**
 * R146 (audit finding 2) — the copilot scope-refusal forensics contract
 * (specs/010-ai-admin-copilot T146): an out-of-scope 403 on /ask or /draft
 * must leave a copilot_actions row with outcome="refused" BEFORE the
 * response. The requireCopilotPermission middleware that specified this was
 * never mounted on any route, so the row now lands inline in the two route
 * handlers (the 403 envelopes stay byte-identical — also pinned here).
 *
 * Also pins finding 3 on the same path: an over-long x-correlation-id is
 * bounded to the varchar(64) correlation_id column at extraction.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", copilotRouter);
  return app;
}

async function listen(): Promise<{ url: string; close: () => void }> {
  const app = buildApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let adminSeq = 0;
async function seedScopedAdmin(permissions: string[]): Promise<{ id: number; token: string }> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `copilot_refusal_${adminSeq}`,
      passwordHash: "x",
      isActive: true,
      permissions,
    })
    .returning();
  return { id: a.id, token: signAdminToken({ adminId: a.id, role: "admin" }) };
}

async function actionsFor(adminId: number) {
  return db.select().from(copilotActionsTable).where(eq(copilotActionsTable.adminId, adminId));
}

async function post(
  url: string,
  path: string,
  token: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

beforeAll(async () => {
  await initTestDb();
  // The scope gate sits AFTER copilotLlmAvailable() in both routes — a
  // synthetic key keeps them from answering 503 before the refusal branch.
  // No LLM call ever runs: the 403 fires before copilotChat.
  process.env.COPILOT_API_KEY = "test-key";
});

afterAll(() => {
  delete process.env.COPILOT_API_KEY;
});

beforeEach(async () => {
  await resetTestDb();
  // Phase gates: ask needs phase1, draft needs phase2 (the
  // copilot-error-envelope.test.ts seeding idiom).
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, "copilot.phases"));
  await db.execute(
    sql`INSERT INTO system_settings (key, value)
        VALUES ('copilot.phases', ${JSON.stringify({
          phase1_enabled: true,
          phase2_enabled: true,
          phase3_enabled: true,
          phase3_high_risk_enabled: false,
        })})`,
  );
  clearPhaseFlagsCache();
});

describe("R146 finding 2 — out-of-scope 403 leaves the copilot_actions refusal row", () => {
  it("POST /copilot/ask with no copilot-visible scope → 403 (byte-identical envelope) + ONE refused row", async () => {
    // "support" is a real permission but maps to zero copilot tools — the
    // exact probe shape the spec wanted forensically reconcilable.
    const admin = await seedScopedAdmin(["support"]);
    const { url, close } = await listen();
    try {
      const res = await post(url, "/api/admin/copilot/ask", admin.token, {
        intent_text: "كم سعر المنتج 12؟",
      });
      expect(res.status).toBe(403);
      expect(res.text).toBe(
        '{"error":"ليس لديك أي صلاحية تخوّلك استخدام المساعد","code":"COPILOT_OUT_OF_SCOPE"}',
      );

      const rows = await actionsFor(admin.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        adminId: admin.id,
        intentText: "كم سعر المنتج 12؟",
        actionClass: "refusal",
        riskTier: "low",
        outcome: "refused",
        failureReason: "out_of_scope: missing scope inventory|admins|users",
      });
    } finally {
      close();
    }
  });

  it("POST /copilot/draft with no draft scope → 403 (byte-identical envelope) + ONE refused row", async () => {
    const admin = await seedScopedAdmin(["support"]);
    const { url, close } = await listen();
    try {
      const res = await post(url, "/api/admin/copilot/draft", admin.token, {
        intent_text: "غيّر سعر المنتج 12",
      });
      expect(res.status).toBe(403);
      expect(res.text).toBe(
        '{"error":"ليس لديك صلاحية لطرح تعديلات","code":"COPILOT_OUT_OF_SCOPE"}',
      );

      const rows = await actionsFor(admin.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        adminId: admin.id,
        intentText: "غيّر سعر المنتج 12",
        actionClass: "refusal",
        riskTier: "low",
        outcome: "refused",
        failureReason: "out_of_scope: missing scope inventory",
      });
    } finally {
      close();
    }
  });

  it("an empty-intent 400 writes NO copilot_actions row (validation precedes the scope gate)", async () => {
    const admin = await seedScopedAdmin(["support"]);
    const { url, close } = await listen();
    try {
      const res = await post(url, "/api/admin/copilot/ask", admin.token, { intent_text: "" });
      expect(res.status).toBe(400);
      expect(await actionsFor(admin.id)).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("R146 finding 3 — a 100-char x-correlation-id is stored bounded to the varchar(64) column", async () => {
    const admin = await seedScopedAdmin(["support"]);
    const longId = "c".repeat(100);
    const { url, close } = await listen();
    try {
      const res = await post(
        url,
        "/api/admin/copilot/draft",
        admin.token,
        { intent_text: "غيّر سعر المنتج 13" },
        { "x-correlation-id": longId },
      );
      expect(res.status).toBe(403);
      const rows = await actionsFor(admin.id);
      expect(rows).toHaveLength(1);
      // Unbounded this insert threw SQLSTATE 22001 (raw 500 AFTER the LLM
      // round-trip on the non-refusal paths); the slice keeps it storable.
      expect(rows[0].correlationId).toBe("c".repeat(64));
    } finally {
      close();
    }
  });
});
