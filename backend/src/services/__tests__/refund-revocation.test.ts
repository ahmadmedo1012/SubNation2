/**
 * B2-03 (round-92 audit) — refund never revoked the delivered credentials:
 * buy → view → refund → keep-the-account giveaway. The buyer's wallet was
 * restored while delivered_password / delivered_email stayed readable
 * forever, and no operational signal told ops to rotate the upstream
 * account.
 *
 * Fix under test:
 *   - RefundService nulls delivered_password / delivered_email INSIDE the
 *     refund tx (atomic with the credit + status flip + ledger).
 *   - A dedupe-keyed admin alert ("refunded_live_credentials") fires after
 *     commit telling ops to rotate the account.
 *   - routes/orders.ts formatOrder only decrypts/exposes credentials while
 *     order.status === "completed" (belt for every non-completed state).
 *
 * The HTTP-level assertions exercise the REAL GET /api/orders and
 * GET /api/orders/:orderCode handlers (same app-mount pattern as
 * routes/__tests__/wallet-topups.test.ts).
 */

import express from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminAlertsTable,
  db,
  initTestDb,
  resetTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { ordersRouter } from "../../routes/orders";
import { CheckoutService } from "../checkout.service";
import { RefundService } from "../refund.service";

const ADMIN_ID = 42;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/orders", ordersRouter);
  return app;
}

const app = buildApp();

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_500_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(balance = "100.00") {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: balance })
    .returning();
  return u;
}

async function seedPurchasedOrder() {
  const user = await seedUser("100.00");
  const [product] = await db
    .insert(productsTable)
    .values({ name: "Credential Product", price: "30.00" })
    .returning();
  await db.insert(inventoryTable).values({
    productId: product.id,
    accountEmail: "acct0@test.local",
    accountPassword: "pw-0", // plaintext in tests — safeDecrypt passes it through
  });
  const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
  if (!result.ok) throw new Error("test seed failed: " + result.reason);
  return { user, order: result.order, product };
}

/** Poll until cond() is truthy (logAdminAlert is fire-and-forget async). */
async function waitFor(cond: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor: condition not met within timeout");
}

async function call(path: string, token: string) {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      headers: { Cookie: `auth_token=${token}` },
    });
    const body = res.status === 200 ? ((await res.json()) as unknown) : null;
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

describe("B2-03: refund revokes delivered credentials (service level)", () => {
  it("refund nulls delivered_password + delivered_email in the same tx and emits the ops alert", async () => {
    const { user, order } = await seedPurchasedOrder();

    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID, note: "broken account" });

    // Fields revoked in DB.
    const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
    expect(row.status).toBe("refunded");
    expect(row.deliveredPassword).toBeNull();
    expect(row.deliveredEmail).toBeNull();

    // Wallet restored, ledger written — the refund itself still works.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(parseFloat(String(u.walletBalance))).toBe(100);
    expect(
      (await db.select().from(walletLedgerTable)).filter((l) => l.type === "refund"),
    ).toHaveLength(1);

    // Ops alert fired (async insert — poll briefly).
    await waitFor(async () => {
      const alerts = await db
        .select()
        .from(adminAlertsTable)
        .where(eq(adminAlertsTable.dedupeKey, `refund:creds:${order.id}`));
      return alerts.length === 1;
    });
    const [alert] = await db
      .select()
      .from(adminAlertsTable)
      .where(eq(adminAlertsTable.dedupeKey, `refund:creds:${order.id}`));
    expect(alert.type).toBe("refunded_live_credentials");
    expect(alert.message).toContain("تدوير");
  });

  it("refund of an order with NO delivered credentials emits no alert", async () => {
    const user = await seedUser("100.00");
    const [product] = await db
      .insert(productsTable)
      .values({ name: "Empty Product", price: "10.00" })
      .returning();
    const [order] = await db
      .insert(ordersTable)
      .values({
        orderCode: "NO-CREDS-1",
        userId: user.id,
        productId: product.id,
        amount: "10.00",
        status: "completed",
        // deliveredPassword / deliveredEmail left null
      })
      .returning();

    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    expect(await db.select().from(adminAlertsTable)).toHaveLength(0);
  });
});

describe("B2-03: formatOrder credential gate (HTTP level — GET /api/orders)", () => {
  it("completed order exposes credentials; refunded order returns null password/email on both list and detail", async () => {
    const { user, order } = await seedPurchasedOrder();
    const token = signUserToken({ userId: user.id });

    // Before refund: credentials readable (completed).
    const before = (await call("/api/orders", token)) as {
      status: number;
      body: Array<{ delivered_password: string | null; delivered_email: string | null }>;
    };
    expect(before.status).toBe(200);
    expect(before.body).toHaveLength(1);
    expect(before.body[0].delivered_password).toBe("pw-0");
    expect(before.body[0].delivered_email).toBe("acct0@test.local");

    const beforeDetail = (await call(`/api/orders/${order.orderCode}`, token)) as {
      status: number;
      body: { delivered_password: string | null; delivered_email: string | null };
    };
    expect(beforeDetail.body.delivered_password).toBe("pw-0");

    await RefundService.refundOrder(order.id, { adminId: ADMIN_ID });

    // After refund: null on the list AND the detail endpoint.
    const after = (await call("/api/orders", token)) as {
      status: number;
      body: Array<{ delivered_password: string | null; delivered_email: string | null; status: string }>;
    };
    expect(after.body[0].status).toBe("refunded");
    expect(after.body[0].delivered_password).toBeNull();
    expect(after.body[0].delivered_email).toBeNull();

    const afterDetail = (await call(`/api/orders/${order.orderCode}`, token)) as {
      status: number;
      body: { delivered_password: string | null; delivered_email: string | null; status: string };
    };
    expect(afterDetail.body.status).toBe("refunded");
    expect(afterDetail.body.delivered_password).toBeNull();
    expect(afterDetail.body.delivered_email).toBeNull();
  });

  it("a failed order with stored credentials also returns null (gate is status-based, not refund-based)", async () => {
    const user = await seedUser("100.00");
    const [product] = await db
      .insert(productsTable)
      .values({ name: "Gate Product", price: "10.00" })
      .returning();
    const [order] = await db
      .insert(ordersTable)
      .values({
        orderCode: "FAILED-1",
        userId: user.id,
        productId: product.id,
        amount: "10.00",
        status: "failed",
        deliveredEmail: "legacy@test.local",
        deliveredPassword: "legacy-pw",
      })
      .returning();
    const token = signUserToken({ userId: user.id });

    const detail = (await call(`/api/orders/${order.orderCode}`, token)) as {
      status: number;
      body: { delivered_password: string | null; delivered_email: string | null };
    };
    expect(detail.status).toBe(200);
    expect(detail.body.delivered_password).toBeNull();
    expect(detail.body.delivered_email).toBeNull();
  });
});
