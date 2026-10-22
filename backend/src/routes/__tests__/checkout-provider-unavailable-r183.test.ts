import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { ordersRouter } from "../orders";
import { CheckoutService } from "../../services/checkout.service";
import type { FulfillmentProvider } from "../../services/providers/types";

/**
 * R183 — PROVIDER_UNAVAILABLE, the FulfillmentFailureReason member that
 * previously had NO mapping anywhere.
 *
 * The vocabulary declares it "reserved for a future async provider that
 * cannot accept the order" (providers/types.ts) and the fulfill call
 * site converts a structured {ok:false, reason} refusal into a thrown
 * marker Error — but the checkout catch never matched that marker, so
 * the marker escaped as a RAW 500 on the money endpoint (the exact gap
 * PRODUCT_STALE and VARIANT_STALE closed for their own markers). The
 * registry only registers the Manual provider today, so nothing LIVE
 * returns it — which is precisely why no test ever caught the hole.
 *
 * This suite pins the R183 fix end-to-end:
 *
 *   1. SERVICE level: a stub provider returning
 *      {ok:false, reason:"PROVIDER_UNAVAILABLE"} → purchase() answers
 *      the retryable envelope {reason:"CONCURRENCY_ERROR",
 *      code:"PROVIDER_UNAVAILABLE"} and NOTHING moved (balance, order,
 *      ledger, inventory claim all untouched — the tx rolled back).
 *   2. ROUTE level: the same refusal through POST /api/orders → 409
 *      CONFLICT with the honest provider-outage copy (never a 500).
 */

// The stub provider — refuses exactly once-forever (mock lifecycle is
// per-test via spyOn), with the shape the future async provider will use.
function unavailableProvider(): FulfillmentProvider {
  return {
    fulfill: async () => ({
      ok: false as const,
      reason: "PROVIDER_UNAVAILABLE" as const,
      detail: "gateway down (r183 stub)",
    }),
  } as unknown as FulfillmentProvider;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/orders", ordersRouter);
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

let phoneSeq = 94_900_000;
async function seedUser(balance = "50.00"): Promise<{ id: number; token: string }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: balance })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

async function seedProductWithStock(price = "10.00"): Promise<{ id: number }> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "R183 Provider Product", price })
    .returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "r183@test.local",
    accountPassword: "pw-r183",
  });
  return p;
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R183 — PROVIDER_UNAVAILABLE can never escape as a raw 500", () => {
  it("service level: the structured refusal becomes the retryable envelope and NOTHING moves", async () => {
    const registry = await import("../../services/providers/registry");
    vi.spyOn(registry, "getFulfillmentProvider").mockReturnValue(unavailableProvider());

    const user = await seedUser("50.00");
    const product = await seedProductWithStock("10.00");

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });

    // The stable retryable envelope (the F4 channel + the R183 code).
    expect(result).toMatchObject({
      ok: false,
      reason: "CONCURRENCY_ERROR",
      code: "PROVIDER_UNAVAILABLE",
    });
    if (!result.ok) {
      expect(result.message).toContain("مزوّد التسليم");
    }

    // Money + catalog truth: the transaction rolled back completely.
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(String(u.walletBalance)).toBe("50.00");
    expect(await db.select().from(ordersTable)).toHaveLength(0);
    expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
    const inv = await db
      .select()
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, product.id));
    expect(inv.every((i) => !i.isSold)).toBe(true);
  });

  it("route level: POST /api/orders answers 409 CONFLICT with the honest provider-outage copy", async () => {
    const registry = await import("../../services/providers/registry");
    vi.spyOn(registry, "getFulfillmentProvider").mockReturnValue(unavailableProvider());

    const { token } = await seedUser("50.00");
    const product = await seedProductWithStock("10.00");
    const { url, close } = await listen();
    try {
      const res = await fetch(`${url}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}` },
        body: JSON.stringify({ product_id: product.id }),
      });
      const body = (await res.json()) as { error?: string; code?: string };

      expect(res.status, "never a raw 500 — the mapped 409-retryable channel").toBe(409);
      expect(body.code).toBe("CONFLICT");
      expect(body.error).toContain("مزوّد التسليم غير متاح مؤقتاً");
    } finally {
      await close();
    }
  });

  it("the LIVE manual provider keeps its own paths intact (the stub never leaked into the registry)", async () => {
    // No spy — the real registry answers. A plain purchase must still
    // succeed through ManualProvider (the guard that the R183 branch
    // didn't perturb the only registered provider's flow).
    const user = await seedUser("50.00");
    const product = await seedProductWithStock("10.00");

    const result = await CheckoutService.purchase({ userId: user.id, productId: product.id });
    expect(result.ok).toBe(true);
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(String(u.walletBalance)).toBe("40.00");
  });
});
