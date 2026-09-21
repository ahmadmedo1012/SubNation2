import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminUsersTable,
  db,
  initTestDb,
  productsTable,
  resetTestDb,
} from "../../test/db";
import { signAdminToken } from "../jwt";
import { hasPermission, requirePermission } from "../permissions";
import { requireAdmin } from "../../middlewares/requireAdmin";

/**
 * AUD103-5-F1 (r103, P1): RBAC enforcement had ZERO test coverage — a
 * regression that flipped hasPermission to `return true` (or dropped a
 * requirePermission from a route) passed the entire suite. This suite
 * pins both layers:
 *
 *   1. The pure predicate (wildcard / exact / wrong / empty / null).
 *   2. The route guard end-to-end: a narrowly-scoped admin is 403'd by
 *      requirePermission BEFORE the handler runs (no side effects), and
 *      the "all" wildcard passes every scope.
 */

// ── 1. Pure predicate ───────────────────────────────────────────────────────

describe("hasPermission — the RBAC predicate (AUD103-5-F1)", () => {
  it("the 'all' wildcard satisfies every scope", () => {
    for (const scope of ["orders", "finance", "inventory", "support", "users", "admins", "settings"]) {
      expect(hasPermission(["all"], scope as never)).toBe(true);
    }
  });

  it("an exact scope match passes", () => {
    expect(hasPermission(["orders"], "orders")).toBe(true);
    expect(hasPermission(["orders", "finance"], "finance")).toBe(true);
  });

  it("a wrong scope fails", () => {
    expect(hasPermission(["orders"], "finance")).toBe(false);
  });

  it("empty / null / undefined grant sets fail closed", () => {
    expect(hasPermission([], "orders")).toBe(false);
    expect(hasPermission(null, "orders")).toBe(false);
    expect(hasPermission(undefined, "orders")).toBe(false);
  });
});

// ── 2. Route guard end-to-end ───────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // A stand-in privileged mutation: inserts a product row ONLY when the
  // guard chain (requireAdmin → requirePermission("finance")) lets it
  // through — mirrors the parent-mount shape routes/admin/index.ts uses.
  app.post(
    "/api/admin/guarded",
    requireAdmin,
    requirePermission("finance"),
    async (_req, res) => {
      await db.insert(productsTable).values({ name: "side-effect", price: "1.00" });
      res.status(201).json({ ok: true });
    },
  );
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

let adminSeq = 0;
async function seedAdmin(permissions: string[]): Promise<string> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `rbac_admin_${adminSeq}`,
      passwordHash: "x",
      isActive: true,
      permissions,
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("requirePermission — route guard (AUD103-5-F1)", () => {
  it("a wrong-scope admin gets 403 and the handler NEVER runs (no side effect)", async () => {
    const token = await seedAdmin(["orders"]); // not finance
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/guarded`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `admin_token=${token}` },
        body: "{}",
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("FORBIDDEN");
      // THE critical assertion: the guarded mutation did not happen.
      const rows = await db.select().from(productsTable);
      expect(rows).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("an exact-scope admin passes (200-side effect lands)", async () => {
    const token = await seedAdmin(["finance"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/guarded`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `admin_token=${token}` },
        body: "{}",
      });
      expect(res.status).toBe(201);
      const rows = await db.select().from(productsTable);
      expect(rows).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("the 'all' wildcard passes any scope", async () => {
    const token = await seedAdmin(["all"]);
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/admin/guarded`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `admin_token=${token}` },
        body: "{}",
      });
      expect(res.status).toBe(201);
    } finally {
      close();
    }
  });
});
