/**
 * P0-sim (round-93 live simulation, 93-SIM-live-findings) — delivered
 * credentials serialization regression.
 *
 * Live-verified at subnation.ly: routes/orders.ts returned delivered_email
 * and delivered_extra_details RAW (still `iv:tag:ct` ciphertext) while
 * delivered_password went through safeDecrypt — the paying buyer saw hex
 * garbage as their account email on the purchase-success screen, the order
 * detail page, and the admin panel. delivered_extra_details /
 * delivered_usage_terms were additionally NOT gated on
 * status === "completed", so they leaked after refund.
 *
 * Fix under test (formatOrder + the wallet recent_orders mirror):
 *   - completed order → every delivered_* field is DECRYPTED plaintext
 *     (encrypted-at-rest rows) or legacy plaintext passed through;
 *   - refunded order → every delivered_* field is null, including
 *     extra_details (which RefundService now nulls in the refund tx) and
 *     usage_terms (API gate only — catalog text is not nulled in DB);
 *   - the same truth holds on GET /api/wallet's recent_orders block.
 *
 * Runs against the REAL ordersRouter + walletRouter over the pglite harness
 * (same app-mount pattern as refund-revocation.test.ts).
 */

import express from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Set BEFORE the first encrypt/decrypt call (safeDecrypt reads the key
// lazily per call — same pattern as safeDecrypt-gcm.test.ts). 32-byte hex,
// test-only.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "33".repeat(32);

import { encrypt } from "../../lib/encryption";
import { signUserToken } from "../../lib/jwt";
import { ordersRouter } from "../../routes/orders";
import { walletRouter } from "../../routes/wallet";
import { RefundService } from "../../services/refund.service";
import { db, initTestDb, resetTestDb, ordersTable, productsTable, usersTable } from "../../test/db";

const ADMIN_ID = 42;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/orders", ordersRouter);
  app.use("/api/wallet", walletRouter);
  return app;
}

const app = buildApp();

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_600_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

interface DeliveredFields {
  status: string;
  delivered_email: string | null;
  delivered_password: string | null;
  delivered_extra_details: string | null;
  delivered_usage_terms: string | null;
}

/**
 * Seed a COMPLETED order with ENCRYPTED-at-rest credential columns — the
 * production shape since V1-M7/H2 (checkout stores inventory ciphertext
 * as-is; email/extra ride the same encryption for legacy rows that were
 * backfilled).
 */
async function seedCompletedOrderEncrypted() {
  const [user] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "100.00" })
    .returning();
  const [product] = await db
    .insert(productsTable)
    .values({
      name: "Encrypted Creds Product",
      price: "30.00",
      usageTerms: "لا تغيّر كلمة المرور. استخدام شخصي فقط.",
    })
    .returning();
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode: "ENC-" + Math.floor(Math.random() * 1e6),
      userId: user.id,
      productId: product.id,
      amount: "30.00",
      status: "completed",
      deliveredEmail: encrypt("buyer-account@test.local"),
      deliveredPassword: encrypt("SuperSecret123"),
      deliveredExtraDetails: encrypt("RECOVERY-CODE-9981"),
      deliveredUsageTerms: product.usageTerms,
      deliveredAt: new Date(),
    })
    .returning();
  return { user, product, order };
}

/** Seed a COMPLETED order with LEGACY plaintext columns (pre-V1-M7 rows). */
async function seedCompletedOrderLegacy() {
  const [user] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "100.00" })
    .returning();
  const [product] = await db
    .insert(productsTable)
    .values({ name: "Legacy Creds Product", price: "10.00" })
    .returning();
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode: "LEG-" + Math.floor(Math.random() * 1e6),
      userId: user.id,
      productId: product.id,
      amount: "10.00",
      status: "completed",
      deliveredEmail: "legacy@test.local",
      deliveredPassword: "legacy-pw",
      deliveredExtraDetails: "legacy-extra",
      deliveredUsageTerms: "legacy-terms",
      deliveredAt: new Date(),
    })
    .returning();
  return { user, product, order };
}

async function getJson(path: string, token: string) {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      headers: { Cookie: `auth_token=${token}` },
    });
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  } finally {
    server.close();
  }
}

describe("P0-sim: formatOrder delivered-credential serialization (GET /api/orders)", () => {
  it("completed order decrypts email + extra_details (not raw iv:tag:ct hex)", async () => {
    const { user, order } = await seedCompletedOrderEncrypted();
    const token = signUserToken({ userId: user.id });

    const detail = (await getJson(`/api/orders/${order.orderCode}`, token)) as {
      status: number;
      body: DeliveredFields;
    };
    expect(detail.status).toBe(200);
    expect(detail.body.delivered_email).toBe("buyer-account@test.local");
    expect(detail.body.delivered_password).toBe("SuperSecret123");
    expect(detail.body.delivered_extra_details).toBe("RECOVERY-CODE-9981");
    expect(detail.body.delivered_usage_terms).toBe("لا تغيّر كلمة المرور. استخدام شخصي فقط.");
    // THE P0 pin: none of these may leak the raw ciphertext shape.
    for (const value of [
      detail.body.delivered_email,
      detail.body.delivered_password,
      detail.body.delivered_extra_details,
    ]) {
      expect(value).not.toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    }

    // Same truth on the list endpoint.
    const list = (await getJson("/api/orders", token)) as {
      status: number;
      body: DeliveredFields[];
    };
    expect(list.body).toHaveLength(1);
    expect(list.body[0].delivered_email).toBe("buyer-account@test.local");
    expect(list.body[0].delivered_extra_details).toBe("RECOVERY-CODE-9981");
  });

  it("legacy plaintext rows pass through unchanged (no decrypt-then-null regression)", async () => {
    const { user, order } = await seedCompletedOrderLegacy();
    const token = signUserToken({ userId: user.id });

    const detail = (await getJson(`/api/orders/${order.orderCode}`, token)) as {
      status: number;
      body: DeliveredFields;
    };
    expect(detail.body.delivered_email).toBe("legacy@test.local");
    expect(detail.body.delivered_password).toBe("legacy-pw");
    expect(detail.body.delivered_extra_details).toBe("legacy-extra");
    expect(detail.body.delivered_usage_terms).toBe("legacy-terms");
  });

  it("refunded order returns ALL delivered fields null — including extra_details and usage_terms", async () => {
    const { user, order } = await seedCompletedOrderEncrypted();
    const token = signUserToken({ userId: user.id });

    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    const detail = (await getJson(`/api/orders/${order.orderCode}`, token)) as {
      status: number;
      body: DeliveredFields;
    };
    expect(detail.body.status).toBe("refunded");
    expect(detail.body.delivered_email).toBeNull();
    expect(detail.body.delivered_password).toBeNull();
    // P0-sim chain: extra_details was the leak that survived refund (the
    // column was neither nulled by RefundService nor gated by formatOrder).
    expect(detail.body.delivered_extra_details).toBeNull();
    expect(detail.body.delivered_usage_terms).toBeNull();
  });

  it("failed order with stored credentials also gates every field (status-based, not refund-based)", async () => {
    const { user, order } = await seedCompletedOrderEncrypted();
    await db.update(ordersTable).set({ status: "failed" }).where(eq(ordersTable.id, order.id));
    const token = signUserToken({ userId: user.id });

    const detail = (await getJson(`/api/orders/${order.orderCode}`, token)) as {
      status: number;
      body: DeliveredFields;
    };
    expect(detail.body.status).toBe("failed");
    expect(detail.body.delivered_email).toBeNull();
    expect(detail.body.delivered_password).toBeNull();
    expect(detail.body.delivered_extra_details).toBeNull();
    expect(detail.body.delivered_usage_terms).toBeNull();
  });
});

describe("P0-sim: wallet recent_orders mirror (GET /api/wallet)", () => {
  it("B6-03 (R116): the summary NO LONGER decrypts — delivered_* null + has_credentials flag", async () => {
    const { user } = await seedCompletedOrderEncrypted();
    const token = signUserToken({ userId: user.id });

    const before = (await getJson("/api/wallet", token)) as {
      status: number;
      body: {
        balance: number;
        recent_orders: Array<{
          status: string;
          has_credentials: boolean;
          delivered_email: string | null;
          delivered_password: string | null;
          delivered_extra_details: string | null;
          delivered_usage_terms: string | null;
        }>;
      };
    };
    expect(before.status).toBe(200);
    expect(before.body.recent_orders).toHaveLength(1);
    // Availability flag instead of the plaintext — the buyer's credential
    // surface is GET /api/orders (formatOrder decrypts there).
    expect(before.body.recent_orders[0].has_credentials).toBe(true);
    expect(before.body.recent_orders[0].delivered_email).toBeNull();
    expect(before.body.recent_orders[0].delivered_password).toBeNull();
    expect(before.body.recent_orders[0].delivered_extra_details).toBeNull();
    // usage_terms / delivered_at stay as-is (plain columns).
    expect(before.body.recent_orders[0].delivered_usage_terms).toContain("كلمة المرور");
  });

  it("refunded order: has_credentials flips false (RefundService nulls the columns)", async () => {
    const { user, order } = await seedCompletedOrderEncrypted();
    const token = signUserToken({ userId: user.id });

    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    const after = (await getJson("/api/wallet", token)) as {
      status: number;
      body: {
        recent_orders: Array<{
          status: string;
          has_credentials: boolean;
          delivered_usage_terms: string | null;
        }>;
      };
    };
    expect(after.body.recent_orders[0].status).toBe("refunded");
    expect(after.body.recent_orders[0].has_credentials).toBe(false);
    expect(after.body.recent_orders[0].delivered_usage_terms).toBeNull();
  });
});
