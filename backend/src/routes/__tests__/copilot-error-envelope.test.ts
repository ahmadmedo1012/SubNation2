import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, resetTestDb, systemSettingsTable } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { clearPhaseFlagsCache } from "../../services/copilot/phase-flags";
import { copilotRouter } from "../admin/copilot";

/**
 * R125-I6 (A8 B-2): the copilot error envelope is byte-pinned.
 *
 * All 47 hand-rolled `{error, code}` sites across the four copilot route
 * files (previews ×31, draft ×7, ask ×5, settings ×3) were swapped to the
 * shared createErrorResponse helper — mechanically identical output, the
 * point being typo-proof ErrorCode members instead of string literals.
 * This suite pins that the swap really is byte-identical: each reachable
 * envelope is asserted on the RAW response text (exact JSON, exact key
 * order, no extra `details` key leaking into the serialization).
 *
 * Coverage picks one representative shape per file/family (the executor-
 * dependent stale/cooldown/failure envelopes need the full confirm
 * machinery and are covered by their service suites; the spread-merged
 * extra-field shapes keep their fields by construction):
 *   previews — 404 / 410 consumed / 410 expired / 409 cancel-consumed
 *   ask      — 400 invalid intent_text
 *   draft    — 400 invalid intent_text
 *   settings — 403 non-super-admin PATCH
 *
 * Harness: copilot_previews is not part of the shared harness DDL, so the
 * table is provisioned per-file (the copilot-history-contract convention);
 * phase flags are seeded into system_settings so the ask/draft POSTs pass
 * their requireCopilotPhase gates (defaults are all-off).
 */

const COPILOT_PREVIEWS_DDL = `
CREATE TABLE copilot_previews (
  id varchar(32) PRIMARY KEY,
  admin_id integer NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  intent_text text NOT NULL,
  tool_name varchar(100) NOT NULL,
  action_class varchar(50) NOT NULL,
  risk_tier varchar(20) NOT NULL,
  affected_ids jsonb NOT NULL,
  affected_entity_type varchar(50) NOT NULL,
  record_versions jsonb NOT NULL,
  preview_payload jsonb NOT NULL,
  model_id varchar(64) NOT NULL,
  correlation_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  confirmed_once_at timestamptz,
  cooldown_starts_at timestamptz,
  confirmed_twice_at timestamptz
);
`;

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
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let adminSeq = 0;
async function seedAdmin(permissions: string[] = ["all"]): Promise<string> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `copilot_env_${adminSeq}`,
      passwordHash: "x",
      isActive: true,
      permissions,
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function seedPreview(
  adminId: number,
  overrides: Partial<{ id: string; consumedAt: Date | null; expiresAt: Date }>,
): Promise<string> {
  const id = overrides.id ?? `01ENVELOPE${Math.floor(Math.random() * 1e6)}`;
  await db.execute(
    sql`INSERT INTO copilot_previews
        (id, admin_id, intent_text, tool_name, action_class, risk_tier,
         affected_ids, affected_entity_type, record_versions, preview_payload,
         model_id, correlation_id, expires_at, consumed_at)
        VALUES (${id}, ${adminId}, ${"غيّر سعر المنتج"}, ${"draft_catalog_edit"},
                ${"catalog_edit"}, ${"low"}, ${"[]"}::jsonb, ${"product"},
                ${"{}"}::jsonb, ${"{}"}::jsonb, ${"test-model"}, ${"corr-" + id},
                ${(overrides.expiresAt ?? new Date(Date.now() + 60_000)).toISOString()}::timestamptz,
                ${overrides.consumedAt ? overrides.consumedAt.toISOString() : null}::timestamptz)`,
  );
  return id;
}

/** Raw fetch returning status + UNPARSED text — the byte-identity pin. */
async function raw(
  url: string,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  return { status: res.status, text: await res.text() };
}

async function adminIdFor(token: string): Promise<number> {
  // signAdminToken fixtures carry no sid in non-production; the seeded id
  // is the only admin — resolve it for preview ownership seeding.
  const [row] = await db.select({ id: adminUsersTable.id }).from(adminUsersTable).limit(1);
  expect(row).toBeTruthy();
  return row.id;
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("DROP TABLE IF EXISTS copilot_previews"));
  await db.execute(sql.raw(COPILOT_PREVIEWS_DDL));
  // Phase gates: ask needs phase1, draft needs phase2 — seed both on.
  // system_settings is NOT in the harness TRUNCATE list (the pricing
  // suites rely on it being untouched), so clear the key explicitly.
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, "copilot.phases"));
  await db.execute(
    sql`INSERT INTO system_settings (key, value)
        VALUES ('copilot.phases', ${JSON.stringify({
          phase1_enabled: true,
          phase2_enabled: true,
          phase3_enabled: false,
          phase3_high_risk_enabled: false,
        })})`,
  );
  clearPhaseFlagsCache();
});

describe("copilot error envelopes — byte-identical after the createErrorResponse swap (R125-I6, A8 B-2)", () => {
  it("GET previews/:id unknown → 404 {error, code} exactly (no details key)", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen();
    try {
      const res = await raw(url, "/api/admin/copilot/previews/01NOPE", token);
      expect(res.status).toBe(404);
      expect(res.text).toBe('{"error":"المعاينة غير موجودة","code":"COPILOT_PREVIEW_NOT_FOUND"}');
    } finally {
      close();
    }
  });

  it("GET previews/:id consumed → 410 COPILOT_PREVIEW_CONSUMED", async () => {
    const token = await seedAdmin();
    const adminId = await adminIdFor(token);
    const id = await seedPreview(adminId, { consumedAt: new Date(Date.now() - 60_000) });
    const { url, close } = await listen();
    try {
      const res = await raw(url, `/api/admin/copilot/previews/${id}`, token);
      expect(res.status).toBe(410);
      expect(res.text).toBe(
        '{"error":"المعاينة استُهلكت بالفعل","code":"COPILOT_PREVIEW_CONSUMED"}',
      );
    } finally {
      close();
    }
  });

  it("GET previews/:id expired → 410 COPILOT_PREVIEW_EXPIRED", async () => {
    const token = await seedAdmin();
    const adminId = await adminIdFor(token);
    const id = await seedPreview(adminId, { expiresAt: new Date(Date.now() - 60_000) });
    const { url, close } = await listen();
    try {
      const res = await raw(url, `/api/admin/copilot/previews/${id}`, token);
      expect(res.status).toBe(410);
      expect(res.text).toBe('{"error":"انتهت صلاحية المعاينة","code":"COPILOT_PREVIEW_EXPIRED"}');
    } finally {
      close();
    }
  });

  it("POST previews/:id/cancel on a consumed preview → 409 COPILOT_PREVIEW_CONSUMED", async () => {
    const token = await seedAdmin();
    const adminId = await adminIdFor(token);
    const id = await seedPreview(adminId, { consumedAt: new Date(Date.now() - 60_000) });
    const { url, close } = await listen();
    try {
      const res = await raw(url, `/api/admin/copilot/previews/${id}/cancel`, token, {
        method: "POST",
      });
      expect(res.status).toBe(409);
      expect(res.text).toBe(
        '{"error":"تعذّر إلغاء معاينة مستهلكة","code":"COPILOT_PREVIEW_CONSUMED"}',
      );
    } finally {
      close();
    }
  });

  it("POST /copilot/ask with an empty intent → 400 COPILOT_INVALID_INPUT (Arabic envelope)", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen();
    try {
      const res = await raw(url, "/api/admin/copilot/ask", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent_text: "" }),
      });
      expect(res.status).toBe(400);
      expect(res.text).toBe(
        '{"error":"النص مطلوب (بين حرف و4000 حرف)","code":"COPILOT_INVALID_INPUT"}',
      );
    } finally {
      close();
    }
  });

  it("POST /copilot/draft with an empty intent → 400 COPILOT_INVALID_INPUT", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen();
    try {
      const res = await raw(url, "/api/admin/copilot/draft", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent_text: "" }),
      });
      expect(res.status).toBe(400);
      expect(res.text).toBe(
        '{"error":"نص الأمر مطلوب (من 1 إلى 4000 حرف)","code":"COPILOT_INVALID_INPUT"}',
      );
    } finally {
      close();
    }
  });

  it("PATCH /copilot/settings without admins/settings scope → 403 FORBIDDEN", async () => {
    // A support-scoped admin: authenticated, under-scoped — the string
    // literal "FORBIDDEN" is now the ErrorCode.FORBIDDEN member.
    // R128 (B14-13 / B1 item 4): the actionable code-map wording — was
    // bare «غير مصرح», which under the server-message-priority rule
    // outranked the map's form.
    const token = await seedAdmin(["support"]);
    const { url, close } = await listen();
    try {
      const res = await raw(url, "/api/admin/copilot/settings", token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase1_enabled: true }),
      });
      expect(res.status).toBe(403);
      expect(res.text).toBe(
        '{"error":"لا تملك صلاحية الوصول إلى هذه الصفحة","code":"FORBIDDEN"}',
      );
    } finally {
      close();
    }
  });
});
