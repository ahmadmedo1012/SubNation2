import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  usersTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { ordersRouter } from "../orders";

/**
 * R165 (the R162 ADR) — the order_group_id route wiring:
 *
 *  - POST /api/orders parses order_group_id from the PARSED body (the
 *    R120-B6/A6-F7 split-brain discipline) and passes it to
 *    CheckoutService.purchase as orderGroupKey;
 *  - the maxLength 36 cap (CreateOrderBody's generated zod) rejects a
 *    37-char value at the 400 INVALID_DATA perimeter — it never reaches
 *    the money path;
 *  - formatOrder serializes order_group_id on POST 201, POST replay 200,
 *    GET / (list) and GET /:orderCode;
 *  - absent → null (legacy clients byte-compatible).
 */
vi.mock("../../telegram", () => ({
  notifyNewOrder: vi.fn(),
}));

const IDEMPOTENCY_DDL = `
CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  order_id integer REFERENCES orders(id) ON DELETE CASCADE,
  reference_type varchar(32) NOT NULL DEFAULT 'order',
  body_hash varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const GROUP = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const GROUP_B = "11111111-2222-3333-4444-555555555555";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/orders", ordersRouter);
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

let phoneSeq = 94_700_000;
async function seedUser(balance = "50.00"): Promise<{ id: number; token: string }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: balance })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

async function seedProductWithStock(price = "10.00"): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "R165 Route Product", price })
    .returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "grp-route@test.local",
    accountPassword: "pw-grp",
  });
  return p.id;
}

async function post(
  url: string,
  token: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${url}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}`, ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await initTestDb();
  await db.execute(sql.raw(IDEMPOTENCY_DDL));
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE idempotency_keys"));
  vi.clearAllMocks();
  const { __resetIdempotencyTableProbeForTests } = await import("../../lib/idempotency");
  __resetIdempotencyTableProbeForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/orders — order_group_id wiring (R165)", () => {
  it("a valid group rides the 201 response and the stored row", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedUser();
      const productId = await seedProductWithStock();

      const res = await post(url, token, { product_id: productId, order_group_id: GROUP });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ order_group_id: GROUP });

      const [row] = await db.select().from(ordersTable).limit(1);
      expect(row.orderGroupId).toBe(GROUP);
    } finally {
      close();
    }
  });

  it("absent → null (legacy clients byte-compatible)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedUser();
      const productId = await seedProductWithStock();

      const res = await post(url, token, { product_id: productId });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ order_group_id: null });

      const [row] = await db.select().from(ordersTable).limit(1);
      expect(row.orderGroupId).toBeNull();
    } finally {
      close();
    }
  });

  it("a 37-char value dies at the 400 INVALID_DATA perimeter (maxLength 36)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedUser();
      const productId = await seedProductWithStock();

      const res = await post(url, token, {
        product_id: productId,
        order_group_id: "g".repeat(37),
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      // Nothing was charged — the rejection never reached the money path.
      expect(await db.select().from(ordersTable)).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("an idempotent replay serializes the stored group (200 + Idempotent-Replayed)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedUser();
      const productId = await seedProductWithStock();
      const key = { "Idempotency-Key": "route group key 0001" };

      const first = await post(url, token, { product_id: productId, order_group_id: GROUP }, key);
      expect(first.status).toBe(201);

      const retry = await post(url, token, { product_id: productId, order_group_id: GROUP }, key);
      expect(retry.status).toBe(200);
      expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
      expect(retry.body).toMatchObject({ order_group_id: GROUP });
      expect((retry.body as { id: number }).id).toBe((first.body as { id: number }).id);
    } finally {
      close();
    }
  });

  it("ADR §5: same unit key + re-minted group → 409 IDEMPOTENCY_KEY_REUSE (the route computes the body hash)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      const key = { "Idempotency-Key": "route group remint 0001" };

      const first = await post(url, token, { product_id: productId, order_group_id: GROUP }, key);
      expect(first.status).toBe(201);

      // The client bug the ADR designs against: the SAME unit key re-sent
      // with a RE-MINTED group token. order_group_id rides CreateOrderBody,
      // so the route's canonicalBodyHash(req.body) legitimately differs —
      // the durable reuse predicate classifies it (fail-closed), never
      // replays a different intent's result, never double-charges. This is
      // why the frontend's group lifecycle MUST keep the token stable
      // across retries (checkout-group-key.ts).
      const remint = await post(
        url,
        token,
        { product_id: productId, order_group_id: GROUP_B },
        key,
      );
      expect(remint.status).toBe(409);
      expect(remint.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE" });

      // Money-safety: the first purchase stands; nothing else moved.
      const rows = await db
        .select({ id: ordersTable.id, g: ordersTable.orderGroupId })
        .from(ordersTable)
        .where(eq(ordersTable.userId, userId));
      expect(rows).toHaveLength(1);
      expect(rows[0].g).toBe(GROUP);
    } finally {
      close();
    }
  });

  it("GET / (list) and GET /:orderCode expose the field", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedUser();
      const productId = await seedProductWithStock();

      const created = await post(url, token, { product_id: productId, order_group_id: GROUP });
      expect(created.status).toBe(201);
      const orderCode = (created.body as { order_code: string }).order_code;

      const list = await fetch(`${url}/api/orders`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      expect(list.status).toBe(200);
      const listBody = (await list.json()) as Array<{ order_group_id: string | null }>;
      expect(listBody).toHaveLength(1);
      expect(listBody[0].order_group_id).toBe(GROUP);

      const detail = await fetch(`${url}/api/orders/${orderCode}`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      expect(detail.status).toBe(200);
      const detailBody = (await detail.json()) as { order_group_id: string | null };
      expect(detailBody.order_group_id).toBe(GROUP);
    } finally {
      close();
    }
  });

  it("a legacy NULL-group row serializes as null on GET (historical parity)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();

      // A pre-feature order (no group) seeded directly.
      await db.insert(ordersTable).values({
        orderCode: "R165-LEGACY-1",
        userId,
        productId,
        amount: "10.00",
        walletBalanceBefore: "50.00",
        walletBalanceAfter: "40.00",
        status: "completed",
      });

      const list = await fetch(`${url}/api/orders`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      const listBody = (await list.json()) as Array<{ order_group_id: string | null }>;
      expect(listBody).toHaveLength(1);
      expect(listBody[0].order_group_id).toBeNull();

      const detail = await fetch(`${url}/api/orders/R165-LEGACY-1`, {
        headers: { Cookie: `auth_token=${token}` },
      });
      const detailBody = (await detail.json()) as { order_group_id: string | null };
      expect(detailBody.order_group_id).toBeNull();
    } finally {
      close();
    }
  });
});
