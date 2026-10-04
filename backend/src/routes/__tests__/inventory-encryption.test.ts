import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  initTestDb,
  resetTestDb,
  auditLogsTable,
  inventoryTable,
  productsTable,
  execTestSql,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { decrypt, isEncrypted } from "../../lib/encryption";
import { adminProductsRouter } from "../admin/products";

/**
 * F7 (round-94 A4 → C5): inventory `extra_details` (gift codes, recovery
 * notes — the ONLY deliverable for code products) was stored in
 * plaintext while `account_password` sat in AES-256-GCM. A DB dump /
 * backup leak exposed every deliverable code. The upload route now
 * encrypts extraDetails exactly like the password; safeDecrypt (which
 * passes legacy plaintext through unchanged) keeps every read path
 * working — the admin preview endpoint decrypts for dedup, and the
 * checkout→orders copy is decrypted at the API boundary.
 *
 * A5-10: the upload (up to 500 credential-bearing units) now writes a
 * product.inventory.upload audit row like its sibling admin writes.
 */

const AUDIT_DDL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_actor_type') THEN
    CREATE TYPE audit_actor_type AS ENUM ('user', 'admin', 'system');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  actor_id integer,
  actor_type audit_actor_type NOT NULL DEFAULT 'system',
  action varchar(100) NOT NULL,
  target_type varchar(50),
  target_id integer,
  metadata text,
  ip varchar(45),
  user_agent varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminProductsRouter);
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
    .values({ username: "admin_inv", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function seedProduct(): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Gift Card Product", price: "5.00" })
    .returning();
  return p.id;
}

async function postInventory(
  url: string,
  token: string,
  productId: number,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}/api/admin/products/${productId}/inventory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function getInventory(url: string, token: string, productId: number) {
  const res = await fetch(`${url}/api/admin/products/${productId}/inventory`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function inventoryRows(productId: number) {
  return db.select().from(inventoryTable).where(eq(inventoryTable.productId, productId));
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(AUDIT_DDL);
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE audit_logs RESTART IDENTITY"));
});

describe("POST /admin/products/:id/inventory — F7 encryption at rest", () => {
  it("encrypts code-product extraDetails (GCM ciphertext, decrypts to the code)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const productId = await seedProduct();

      const res = await postInventory(url, token, productId, {
        entries: [{ kind: "code", extra: "GIFT-CODE-4477" }],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ added: 1, skipped_duplicates: 0 });

      const rows = await inventoryRows(productId);
      expect(rows).toHaveLength(1);
      expect(rows[0].accountPassword).toBeNull();
      expect(rows[0].extraDetails).not.toBeNull();
      expect(isEncrypted(rows[0].extraDetails)).toBe(true);
      expect(rows[0].extraDetails).not.toContain("GIFT-CODE-4477");
      expect(decrypt(rows[0].extraDetails!)).toBe("GIFT-CODE-4477");
    } finally {
      close();
    }
  });

  it("encrypts the credentials-path extra too (recovery notes), keeps the password encrypted", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const productId = await seedProduct();

      await postInventory(url, token, productId, {
        entries: [{ kind: "credentials", email: "a@t.local", password: "pw1", extra: "2FA: 9981" }],
      });
      const rows = await inventoryRows(productId);
      expect(isEncrypted(rows[0].accountPassword!)).toBe(true);
      expect(decrypt(rows[0].accountPassword!)).toBe("pw1");
      expect(isEncrypted(rows[0].extraDetails!)).toBe(true);
      expect(decrypt(rows[0].extraDetails!)).toBe("2FA: 9981");
    } finally {
      close();
    }
  });

  it("encrypts the legacy bulk_text single-column path as well", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const productId = await seedProduct();

      await postInventory(url, token, productId, { bulk_text: "SOLO-CODE-1234" });
      const rows = await inventoryRows(productId);
      expect(rows).toHaveLength(1);
      expect(isEncrypted(rows[0].extraDetails!)).toBe(true);
      expect(decrypt(rows[0].extraDetails!)).toBe("SOLO-CODE-1234");
    } finally {
      close();
    }
  });

  it("GET inventory decrypts extra_details for the admin dedup preview", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const productId = await seedProduct();
      await postInventory(url, token, productId, {
        entries: [{ kind: "code", extra: "GIFT-CODE-4477" }],
      });

      const res = await getInventory(url, token, productId);
      expect(res.status).toBe(200);
      const items = res.body.items as Array<{ extra_details: string | null }>;
      expect(items).toHaveLength(1);
      expect(items[0].extra_details).toBe("GIFT-CODE-4477");
    } finally {
      close();
    }
  });

  it("server-side dedup still catches a re-uploaded code (keyed on the DECRYPTED value)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const productId = await seedProduct();

      await postInventory(url, token, productId, {
        entries: [{ kind: "code", extra: "GIFT-CODE-4477" }],
      });
      const res = await postInventory(url, token, productId, {
        entries: [{ kind: "code", extra: "GIFT-CODE-4477" }],
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: "INVALID_DATA",
        details: { skipped_duplicates: 1 },
      });
      expect(await inventoryRows(productId)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("writes a product.inventory.upload audit row (A5-10)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const admin = await seedAdmin();
      const adminId = (await db.select().from(adminUsersTable).limit(1))[0].id;
      const productId = await seedProduct();

      await postInventory(url, admin, productId, {
        entries: [
          { kind: "code", extra: "GIFT-1" },
          { kind: "code", extra: "GIFT-2" },
        ],
      });

      const audits = await db
        .select()
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "product.inventory.upload"));
      expect(audits).toHaveLength(1);
      expect(audits[0].actorId).toBe(adminId);
      expect(audits[0].targetType).toBe("product");
      expect(audits[0].targetId).toBe(productId);
      expect(JSON.parse(audits[0].metadata!)).toMatchObject({ added: 2, skipped_duplicates: 0 });
    } finally {
      close();
    }
  });
});
