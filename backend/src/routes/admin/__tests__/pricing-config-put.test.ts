import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { eq, sql } from "drizzle-orm";

/**
 * R118-A5 TOP-20 #9 [P2] — PUT/GET /api/admin/pricing/config.
 *
 * The global pricing rule override had ZERO route tests (only the lib
 * bounds are unit-tested in lib/__tests__/pricing-config.test.ts). This
 * suite pins the HTTP contract:
 *
 *   - PUT in-bounds persists the rule (all three system_settings keys),
 *     answers the effective config, writes the pricing.config.update
 *     audit row, and bumps the catalog cache generation;
 *   - every out-of-bounds field (rate 0.05 / 2000, markup −1 / 10 001,
 *     cap 9.5 / 95.5) → 400 with the Arabic range message and NOTHING
 *     persisted;
 *   - an empty patch ({} / only unknown keys) → 400;
 *   - GET returns the effective rule (defaults with no overrides, the
 *     updated rule after a PUT).
 *
 * The catalog-cache module is mocked with a pass-through spy so the
 * bumpCatalogCache() side effect is assertable (same mock shape as
 * health-summary-wedge.test.ts's getRedisClient).
 */

vi.mock("../../../lib/catalog-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/catalog-cache")>();
  return { ...actual, bumpCatalogCache: vi.fn(actual.bumpCatalogCache) };
});

import {
  adminUsersTable,
  auditLogsTable,
  db,
  initTestDb,
  resetTestDb,
  systemSettingsTable,
} from "../../../test/db";
import { createAdminSession } from "../../../lib/admin-session";
import { __resetPricingConfigCache } from "../../../lib/pricing-config";
import { bumpCatalogCache } from "../../../lib/catalog-cache";
import { adminPricingConfigRouter } from "../pricing-config";

const RANGE_MESSAGE =
  "قيمة خارج النطاق المسموح (سعر الصرف 0.1–1000، الهامش 0–10000%، سقف الخصم المجمّع 10–95%)";

function buildApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/admin", adminPricingConfigRouter);
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

let adminToken: string;

async function seedAdmin(): Promise<void> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "pricing_put_admin", passwordHash: "x", isActive: true })
    .returning();
  const { token } = await createAdminSession({ adminId: a.id, role: "admin" });
  adminToken = token;
}

async function putConfig(
  url: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin/pricing/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function getConfig(
  url: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}/api/admin/pricing/config`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function settingsRows(): Promise<Array<{ key: string; value: string }>> {
  return db.select().from(systemSettingsTable);
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  // system_settings is in the harness DDL but NOT in the shared TRUNCATE
  // list (src/test/db.ts TABLES) — clear it here so each PUT scenario
  // starts from the compiled defaults.
  await db.execute(sql.raw("DELETE FROM system_settings;"));
  __resetPricingConfigCache();
  vi.clearAllMocks();
  await seedAdmin();
});

describe("PUT /api/admin/pricing/config (R118-A5 #9)", () => {
  it("an in-bounds patch updates the rule, persists all three settings keys, audits, and bumps the catalog cache", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, { usd_to_lyd: 5, markup_percent: 150 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        usd_to_lyd: 5,
        markup_percent: 150,
        max_total_discount_pct: 50, // untouched field keeps its default
      });

      // All three keys are persisted (savePricingConfig rewrites the row
      // set — the cache-bump keeps the public catalog in sync).
      const rows = await settingsRows();
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "pricing.usd_to_lyd", value: "5" }),
          expect.objectContaining({ key: "pricing.markup_percent", value: "150" }),
          expect.objectContaining({ key: "pricing.max_total_discount_pct", value: "50" }),
        ]),
      );

      // Audit trail: pricing.config.update with the patch + effective rule.
      const audits = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "pricing.config.update"));
      expect(audits).toHaveLength(1);
      const meta = JSON.parse(audits[0].metadata as string) as {
        usdToLyd: number;
        markupPercent: number;
        effective: { usdToLyd: number; markupPercent: number; maxTotalDiscountPct: number };
      };
      expect(meta.usdToLyd).toBe(5);
      expect(meta.markupPercent).toBe(150);
      expect(meta.effective).toMatchObject({ usdToLyd: 5, markupPercent: 150 });

      // The catalog cache generation was bumped.
      expect(bumpCatalogCache).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it.each([
    ["rate below the floor", { usd_to_lyd: 0.05 }],
    ["rate above the ceiling", { usd_to_lyd: 2000 }],
    ["markup negative", { markup_percent: -1 }],
    ["markup above 10,000%", { markup_percent: 10_001 }],
    ["discount cap below 10", { max_total_discount_pct: 9.5 }],
    ["discount cap above 95", { max_total_discount_pct: 95.5 }],
  ])("out-of-bounds %s → 400 with the range message, nothing persisted", async (_label, patch) => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, patch);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA", error: RANGE_MESSAGE });

      // Nothing persisted, no audit row, no cache bump.
      expect(await settingsRows()).toHaveLength(0);
      const audits = await db
        .select({ id: auditLogsTable.id })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "pricing.config.update"));
      expect(audits).toHaveLength(0);
      expect(bumpCatalogCache).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("an empty patch → 400 (لا توجد تغييرات) — including a body with only unknown keys", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const empty = await putConfig(url, {});
      expect(empty.status).toBe(400);
      expect(empty.body).toMatchObject({ code: "INVALID_DATA" });

      const unknownKeys = await putConfig(url, { nonsense: 1 });
      expect(unknownKeys.status).toBe(400);
      expect(await settingsRows()).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("a non-numeric field coerces to NaN → the same 400 range refusal (never persisted as NaN)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await putConfig(url, { usd_to_lyd: "not-a-number" });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: RANGE_MESSAGE });
      expect(await settingsRows()).toHaveLength(0);
    } finally {
      close();
    }
  });
});

describe("GET /api/admin/pricing/config (R118-A5 #9)", () => {
  it("returns the compiled defaults when no override exists", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await getConfig(url);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        usd_to_lyd: 10,
        markup_percent: 100,
        max_total_discount_pct: 50,
      });
    } finally {
      close();
    }
  });

  it("returns the EFFECTIVE rule after a PUT (override + untouched defaults)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      await putConfig(url, { markup_percent: 80 });
      const res = await getConfig(url);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        usd_to_lyd: 10,
        markup_percent: 80,
        max_total_discount_pct: 50,
      });
    } finally {
      close();
    }
  });

  it("requires an admin token → 401", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/pricing/config`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });
});

// R123-E5 (A6 P3): no-store parity with the 98-F3 pattern — the
// pricing rule is the catalog's single source of truth; an operator
// reading it must never see an intermediary's cached stale rule.
describe("R123-E5 — no-store on GET /api/admin/pricing/config", () => {
  it("the config read ships Cache-Control: no-store", async () => {
    // beforeEach already seeded the fixed-username admin + adminToken.
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/pricing/config`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      close();
    }
  });
});
