import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  resetTestDb,
  supportTicketsTable,
  ticketRepliesTable,
  usersTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { supportRouter } from "../support";

/**
 * E-F6 (R186): ticket creation ran as TWO autocommit statements — the
 * ticket INSERT, then the first-reply INSERT. A reply-insert failure
 * (transient DB blip, storage error) stranded a HOLLOW ticket row: the
 * user saw an open ticket no one could answer. Both inserts now share one
 * db.transaction, so the reply rides the ticket's commit.
 *
 * Failure injection: db.transaction is wrapped and the tx handed to the
 * route's callback is a shim whose insert throws ONLY for
 * ticket_replies_table — the ticket insert runs for real inside the real
 * transaction, so the rollback assertion exercises the actual atomicity.
 *
 * Harness: support-reply.test.ts (real router over pglite, cookie token).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api/support/tickets", supportRouter);
  return app;
}

const app = buildApp();
let url = "";

beforeAll(async () => {
  await initTestDb();
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      url = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

beforeEach(async () => {
  await resetTestDb();
});

function authHeaders(userId: number): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Cookie: `auth_token=${signUserToken({ userId })}`,
  };
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { raw: text };
    }
  }
  return { status: res.status, body: parsed };
}

/**
 * The tx handed to the route's callback: the REAL tx's insert, except for
 * ticket_replies_table — that one throws (the route's callback only
 * composes tx.insert for this flow, so the shim stays one method deep).
 */
function shimWithFailingRepliesInsert(tx: unknown): { insert: (table: unknown) => unknown } {
  return {
    insert: (table: unknown) => {
      if (table === ticketRepliesTable) {
        throw new Error("simulated ticket_replies insert failure (E-F6)");
      }
      return (tx as { insert: (t: unknown) => unknown }).insert(table);
    },
  };
}

/** Fail ONLY the ticket_replies insert, inside the real transaction. */
function failRepliesInsertInsideTx(): () => void {
  const original = db.transaction.bind(db);
  const spy = vi
    .spyOn(db, "transaction")
    .mockImplementation(((cb: (tx: unknown) => Promise<unknown>) =>
      original((realTx: unknown) => cb(shimWithFailingRepliesInsert(realTx)))) as never);
  return () => spy.mockRestore();
}

describe("POST /api/support/tickets — ticket + first-reply atomicity (E-F6)", () => {
  it("a first-reply insert failure leaves ZERO ticket rows (no hollow ticket)", async () => {
    const userId = 2001;
    await db.insert(usersTable).values({ id: userId, phone: "092002001" }).onConflictDoNothing();

    const restore = failRepliesInsertInsideTx();
    let res: { status: number; body: Record<string, unknown> };
    try {
      res = await post(
        "/api/support/tickets",
        { title: "عنوان صحيح", message: "رسالة صحيحة", category: "billing" },
        authHeaders(userId),
      );
    } finally {
      restore();
    }

    // The request fails loudly (the global 500 path — nothing partial to
    // answer 201 with); the assertion target is the DB invariant below.
    expect(res.status).toBe(500);

    // THE FIX: the ticket insert rolled back WITH the failed reply insert.
    const tickets = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.userId, userId));
    expect(tickets).toHaveLength(0);
    const replies = await db.select().from(ticketRepliesTable);
    expect(replies).toHaveLength(0);
  });

  it("control — without the injected failure both rows commit together (201)", async () => {
    const userId = 2002;
    await db.insert(usersTable).values({ id: userId, phone: "092002002" }).onConflictDoNothing();

    const res = await post(
      "/api/support/tickets",
      { title: "عنوان تحقق", message: "رسالة تحقق", category: "other" },
      authHeaders(userId),
    );
    expect(res.status).toBe(201);
    const ticketId = res.body.id as number;
    expect(typeof ticketId).toBe("number");

    const tickets = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.userId, userId));
    expect(tickets).toHaveLength(1);
    const replies = await db
      .select()
      .from(ticketRepliesTable)
      .where(eq(ticketRepliesTable.ticketId, ticketId));
    expect(replies).toHaveLength(1);
    expect(replies[0]!.message).toBe("رسالة تحقق");
  });
});
