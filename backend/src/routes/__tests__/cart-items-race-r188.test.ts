import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartItemsTable,
  db,
  execTestSql,
  initTestDb,
  productsTable,
  resetTestDb,
  usersTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { cartRouter } from "../cart";

/**
 * R188-2 (C-F6) — POST /api/cart/items uniq_cart_items_user_product race.
 *
 * The add-to-cart is check-then-insert on the 2-column unique index: two
 * concurrent POSTs can both miss the existing-row SELECT and both INSERT —
 * the loser's 23505 used to escape as a raw 500 instead of converging to
 * the designed bump-quantity outcome. The insert now catches
 * isUniqueViolation (lib/pg-errors.ts), re-reads the winner's row, and
 * takes the update branch. Non-money route (API clients only per the
 * route's own comment) — minimal backstop.
 *
 * Harness: the users-loyalty-guard recorder idiom — db.select is wrapped,
 * the route's field-less cartItemsTable read (the existing-row SELECT) is
 * identified by shape, and the FIRST one resolves its real (empty) rows
 * THEN lands the concurrent winner's INSERT before delivering them — the
 * exact check-then-insert window. The backstop's re-read replays for real
 * (the recorder only hijacks once), so it sees the winner.
 *
 * Parity note: the shared pglite harness (test/db.ts) does not create
 * uniq_cart_items_user_product — this file arms it once per file run
 * (CREATE IF NOT EXISTS; TRUNCATE-based resets never drop indexes), so
 * the 23505 is a REAL unique violation.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/cart", cartRouter);
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

let userSeq = 0;
async function seedUser(): Promise<number> {
  userSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9473${String(userSeq).padStart(6, "0")}`, walletBalance: "0.00" })
    .returning();
  return u.id;
}

async function seedProduct(): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Race Product", price: "25.00", isActive: true })
    .returning();
  return p.id;
}

async function postItem(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/cart/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

// ── The deterministic race harness ───────────────────────────────────────────

const CHAIN_METHODS = ["from", "where", "limit", "orderBy", "offset", "groupBy", "having"] as const;

const realDbSelect = db.select.bind(db);
const selectSpies: Array<{ mockRestore: () => void }> = [];

/**
 * Wrap db.select so the route's existing-row read (field-less select on
 * cartItemsTable) resolves its real rows FIRST, then lands the concurrent
 * winner's INSERT (quantity 5) before delivering them — the loser's
 * subsequent INSERT hits uniq_cart_items_user_product. Every other select
 * (and the backstop's re-read) replays the original chain.
 */
function interleaveConcurrentCartInsert(userId: number, productId: number): void {
  const spy = vi.spyOn(db, "select");
  selectSpies.push(spy);
  let hijacked = false;
  spy.mockImplementation(((selection?: Record<string, unknown>) => {
    const calls: Array<{ m: string; args: unknown[] }> = [];
    const replay = (): PromiseLike<unknown> => {
      let builder: unknown = realDbSelect(selection as never);
      for (const { m, args } of calls) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        builder = (builder as any)[m](...args);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return builder as any;
    };
    const isExistingRowRead = (): boolean => {
      if (hijacked || selection !== undefined) return false;
      return calls.some(({ m, args }) => m === "from" && (args[0] as unknown) === cartItemsTable);
    };
    const recorder: Record<string, unknown> = {
      then: (onFulfilled: unknown, onRejected: unknown) =>
        wrap(replay()).then(onFulfilled as never, onRejected as never),
    };
    for (const m of CHAIN_METHODS) {
      recorder[m] = (...args: unknown[]) => {
        calls.push({ m, args });
        return recorder;
      };
    }
    const wrap = (real: PromiseLike<unknown>): PromiseLike<unknown> => {
      if (!isExistingRowRead()) return real;
      hijacked = true;
      return real.then(async (rows) => {
        await db
          .insert(cartItemsTable)
          .values({ userId, productId, variantId: null, variantLabel: null, quantity: 5 });
        return rows;
      });
    };
    return recorder;
  }) as never);
}

afterAll(() => {
  for (const s of selectSpies) s.mockRestore();
});

beforeAll(async () => {
  await initTestDb();
  // Prod parity for THIS file only (the shared harness lacks the index).
  await execTestSql(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_cart_items_user_product
     ON cart_items (user_id, product_id);`,
  );
});

beforeEach(async () => {
  await resetTestDb();
  for (const s of selectSpies) s.mockRestore();
  selectSpies.length = 0;
});

describe("POST /api/cart/items — R188-2 (C-F6) concurrent double-tap on uniq_cart_items_user_product", () => {
  it("the loser's 23505 converges to the bump-quantity outcome (201, quantity summed) — not a raw 500", async () => {
    const userId = await seedUser();
    const productId = await seedProduct();
    const token = signUserToken({ userId });
    const { url, close } = await listen(buildApp());
    try {
      interleaveConcurrentCartInsert(userId, productId);

      const res = await postItem(url, token, { product_id: productId, quantity: 3 });

      // THE FIX: the loser answers the designed 201 with the bumped row
      // (the old path let the 23505 escape as a raw 500).
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ product_id: productId, quantity: 8 });
      expect(res.body.subtotal).toBe(200); // 25.00 × 8

      // Exactly ONE line for (user, product) — the winner's row, bumped.
      const rows = await db
        .select()
        .from(cartItemsTable)
        .where(and(eq(cartItemsTable.userId, userId), eq(cartItemsTable.productId, productId)));
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(8);
    } finally {
      close();
    }
  });

  it("the non-race paths are unchanged: first add inserts, second add bumps via the SELECT", async () => {
    const userId = await seedUser();
    const productId = await seedProduct();
    const token = signUserToken({ userId });
    const { url, close } = await listen(buildApp());
    try {
      const first = await postItem(url, token, { product_id: productId, quantity: 2 });
      expect(first.status).toBe(201);
      expect(first.body.quantity).toBe(2);

      const second = await postItem(url, token, { product_id: productId, quantity: 3 });
      expect(second.status).toBe(201);
      expect(second.body.quantity).toBe(5);

      const rows = await db.select().from(cartItemsTable);
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(5);
    } finally {
      close();
    }
  });
});
