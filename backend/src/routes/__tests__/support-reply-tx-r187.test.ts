import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  initTestDb,
  resetTestDb,
  supportTicketsTable,
  ticketRepliesTable,
  usersTable,
} from "../../test/db";
import { signAdminToken, signUserToken } from "../../lib/jwt";
import { supportRouter } from "../support";
import { adminTicketsRouter } from "../admin/tickets";

/**
 * R187 (F7) — the support reply two-autocommit, on BOTH routes.
 *
 * POST /api/support/tickets/:id/reply (user) and POST /api/admin/tickets/:id/reply
 * (admin) each ran the reply INSERT and the in_progress status UPDATE as
 * two autocommit statements — a status-update failure 500'd with the reply
 * already committed, and the client's retry DUPLICATED the reply. Both now
 * ride ONE db.transaction (the R186 E-F6 ticket-create idiom).
 *
 * Failure injection: db.transaction is wrapped and the tx handed to the
 * route's callback is a shim whose UPDATE on support_tickets throws — the
 * reply insert runs for real inside the real transaction, so the
 * zero-persistence assertion exercises the actual atomicity.
 *
 * Harness: support-reply.test.ts / tickets-audit.test.ts (real routers
 * over pglite; cookie token for the user route, bearer for the admin one).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api/support/tickets", supportRouter);
  app.use("/api/admin", adminTicketsRouter);
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

function userHeaders(userId: number): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Cookie: `auth_token=${signUserToken({ userId })}`,
  };
}

function adminHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
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
 * The tx handed to the route's callback: the REAL tx's update, except for
 * support_tickets_table — that one throws (the route's callback only
 * composes tx.update for the status flip, so the shim stays one method
 * deep; the reply INSERT runs for real inside the same transaction).
 */
function shimWithFailingTicketUpdate(tx: unknown): { update: (table: unknown) => unknown } {
  return {
    update: (table: unknown) => {
      if (table === supportTicketsTable) {
        throw new Error("simulated ticket status update failure (R187 F7)");
      }
      return (tx as { update: (t: unknown) => unknown }).update(table);
    },
  };
}

/** Fail ONLY the support_tickets status update, inside the real transaction. */
function failTicketStatusUpdateInsideTx(): () => void {
  const original = db.transaction.bind(db);
  const spy = vi
    .spyOn(db, "transaction")
    .mockImplementation(((cb: (tx: unknown) => Promise<unknown>) =>
      original((realTx: unknown) => cb(shimWithFailingTicketUpdate(realTx)))) as never);
  return () => spy.mockRestore();
}

let userSeq = 0;
async function seedUser(): Promise<number> {
  userSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ id: 3100 + userSeq, phone: `0931${String(userSeq).padStart(6, "0")}` })
    .returning();
  return u.id;
}

async function seedTicket(userId: number): Promise<number> {
  const [t] = await db
    .insert(supportTicketsTable)
    .values({ userId, title: "F7 tx pin", status: "open" })
    .returning();
  return t.id;
}

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `f7_admin_${userSeq}`,
      passwordHash: "x",
      isActive: true,
      permissions: ["support"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function repliesFor(ticketId: number) {
  return db.select().from(ticketRepliesTable).where(eq(ticketRepliesTable.ticketId, ticketId));
}

describe("POST /api/support/tickets/:id/reply — reply + status atomicity (R187 F7, user side)", () => {
  it("a status-update failure leaves ZERO reply rows (500 with zero persistence)", async () => {
    const userId = await seedUser();
    const ticketId = await seedTicket(userId);

    const restore = failTicketStatusUpdateInsideTx();
    let res: { status: number; body: Record<string, unknown> };
    try {
      res = await post(
        `/api/support/tickets/${ticketId}/reply`,
        { message: "رد المستخدم" },
        userHeaders(userId),
      );
    } finally {
      restore();
    }

    // The request fails loudly (the global 500 path); the assertion target
    // is the DB invariant below — a client retry must not duplicate a
    // reply the server already persisted.
    expect(res.status).toBe(500);
    expect(await repliesFor(ticketId)).toHaveLength(0);
  });

  it("control — without the injected failure the reply commits AND the status flips (201)", async () => {
    const userId = await seedUser();
    const ticketId = await seedTicket(userId);

    const res = await post(
      `/api/support/tickets/${ticketId}/reply`,
      { message: "رد تحقق" },
      userHeaders(userId),
    );
    expect(res.status).toBe(201);

    const replies = await repliesFor(ticketId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ authorType: "user", message: "رد تحقق" });
    const [ticket] = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, ticketId));
    expect(ticket.status).toBe("in_progress");
  });
});

describe("POST /api/admin/tickets/:id/reply — reply + status atomicity (R187 F7, admin side)", () => {
  it("a status-update failure leaves ZERO reply rows (500 with zero persistence)", async () => {
    const userId = await seedUser();
    const ticketId = await seedTicket(userId);
    const token = await seedAdmin();

    const restore = failTicketStatusUpdateInsideTx();
    let res: { status: number; body: Record<string, unknown> };
    try {
      res = await post(
        `/api/admin/tickets/${ticketId}/reply`,
        { message: "رد المسؤول" },
        adminHeaders(token),
      );
    } finally {
      restore();
    }

    expect(res.status).toBe(500);
    expect(await repliesFor(ticketId)).toHaveLength(0);
  });

  it("control — without the injected failure the admin reply commits AND the status flips (201)", async () => {
    const userId = await seedUser();
    const ticketId = await seedTicket(userId);
    const token = await seedAdmin();

    const res = await post(
      `/api/admin/tickets/${ticketId}/reply`,
      { message: "رد مسؤول تحقق" },
      adminHeaders(token),
    );
    expect(res.status).toBe(201);

    const replies = await repliesFor(ticketId);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ authorType: "admin", message: "رد مسؤول تحقق" });
    const [ticket] = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, ticketId));
    expect(ticket.status).toBe("in_progress");
  });
});
