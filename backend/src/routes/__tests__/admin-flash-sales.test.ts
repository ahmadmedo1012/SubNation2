import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminUsersTable, db, flashSalesTable, initTestDb, resetTestDb } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminFlashSalesRouter } from "../admin/flash-sales";

/**
 * AUD103-5-F2 (r103, P1): the flash-sale discount ceiling (95%) had ZERO
 * test coverage — the router was never mounted in any test file, so a
 * regression that raised MAX_DISCOUNT_PERCENT (the "free goods" guard the
 * coupon-stacking ceiling depends on) passed the whole suite. This suite
 * pins the cap on BOTH create and update, the lower bound, and the
 * boundary value 95 itself.
 */

const MAX_CAP = 95;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminFlashSalesRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
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

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "flash_admin", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function postFlash(url: string, token: string, discount: number) {
  const res = await fetch(`${url}/api/admin/flash-sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `admin_token=${token}` },
    body: JSON.stringify({
      title: "cap test",
      discount_percent: discount,
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("admin flash-sales — discount cap (AUD103-5-F2)", () => {
  it(`POST with discount_percent ${MAX_CAP + 1} → 400 + NO row written`, async () => {
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await postFlash(url, token, MAX_CAP + 1);
      expect(res.status).toBe(400);
      expect(res.body.details).toMatchObject({ field: "discount_percent" });
      const rows = await db.select().from(flashSalesTable);
      expect(rows).toHaveLength(0);
    } finally {
      close();
    }
  });

  it(`POST at the boundary ${MAX_CAP} → 201 (the cap itself is legal)`, async () => {
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const res = await postFlash(url, token, MAX_CAP);
      expect(res.status).toBe(201);
      const rows = await db.select().from(flashSalesTable);
      expect(rows).toHaveLength(1);
      expect(parseFloat(String(rows[0].discountPercent))).toBe(MAX_CAP);
    } finally {
      close();
    }
  });

  it("POST with -1 / non-finite → 400 (0 is legal by design — MIN bound)", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      for (const bad of [-1, Number.POSITIVE_INFINITY]) {
        const res = await postFlash(url, token, bad);
        expect(res.status).toBe(400);
      }
      expect(await db.select().from(flashSalesTable)).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("PATCH an existing sale above the cap → 400 (the update path is capped too)", async () => {
    const token = await seedAdmin();
    const [sale] = await db
      .insert(flashSalesTable)
      .values({
        title: "existing",
        discountPercent: "50",
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        isActive: false, // inactive so the singleton index doesn't interfere
      })
      .returning();

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/flash-sales/${sale.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: `admin_token=${token}` },
        body: JSON.stringify({ discount_percent: 99 }),
      });
      expect(res.status).toBe(400);
      // The stored discount is unchanged.
      const [row] = await db.select().from(flashSalesTable).where(eq(flashSalesTable.id, sale.id));
      expect(parseFloat(String(row.discountPercent))).toBe(50);
    } finally {
      close();
    }
  });
});
