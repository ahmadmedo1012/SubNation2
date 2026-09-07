import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * SEC-92-07 (round-92 B1 security audit) — support ticket storage-DoS
 * caps.
 *
 * Ticket replies previously had NO message length cap (only the global
 * 1 MB JSON limit) and NO per-user rate limit — a scripted authenticated
 * user could park ~1 MB text rows into ticket_replies at ~20/min
 * (multi-GB/day growth on a starter-tier Neon). Pinned here:
 *   - reply message ≤ 4000 chars (mirrors the copilot intent-text bound)
 *   - ticket creation message ≤ 4000 chars (same bound, was also open)
 *   - 30 replies/hour/user limiter (mirrors ticketCreateLimiter style)
 *
 * pglite-isolated harness; requireUser accepts the legacy no-sessionId
 * test token (documented in requireUser.ts).
 *
 * NOTE on user ids: the in-memory ticketReplyLimiter is module-level and
 * is NOT reset by resetTestDb, so every test uses an explicit unique
 * user id to keep limiter keys isolated.
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

afterAll(() => {
  // Express closes via the test process teardown; nothing to await here.
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

async function seedUser(id: number): Promise<number> {
  await db
    .insert(usersTable)
    .values({ id, phone: `9${String(id).padStart(8, "0")}` })
    .onConflictDoNothing();
  return id;
}

async function seedTicket(userId: number): Promise<number> {
  const [t] = await db
    .insert(supportTicketsTable)
    .values({ userId, title: "Test ticket", status: "open" })
    .returning();
  return t.id;
}

beforeEach(async () => {
  await resetTestDb();
});

const LONG_MESSAGE = "م".repeat(4001);
const OK_MESSAGE = "رسالة عادية قصيرة";

describe("POST /api/support/tickets/:id/reply — message cap (SEC-92-07)", () => {
  it("401 without auth (route still guarded)", async () => {
    const res = await post(
      "/api/support/tickets/1/reply",
      { message: "hi" },
      {
        "Content-Type": "application/json",
      },
    );
    expect(res.status).toBe(401);
  });

  it("404 for a nonexistent ticket (guard order unchanged)", async () => {
    const userId = await seedUser(101);
    const res = await post(
      "/api/support/tickets/999999/reply",
      { message: OK_MESSAGE },
      authHeaders(userId),
    );
    expect(res.status).toBe(404);
  });

  it("400 when the reply exceeds 4000 chars — and nothing is stored", async () => {
    const userId = await seedUser(102);
    const ticketId = await seedTicket(userId);
    const res = await post(
      `/api/support/tickets/${ticketId}/reply`,
      { message: LONG_MESSAGE },
      authHeaders(userId),
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_DATA");

    const replies = await db
      .select()
      .from(ticketRepliesTable)
      .where(eq(ticketRepliesTable.ticketId, ticketId));
    expect(replies).toHaveLength(0);
  });

  it("201 for a compliant reply — stored and status flips to in_progress", async () => {
    const userId = await seedUser(103);
    const ticketId = await seedTicket(userId);
    const res = await post(
      `/api/support/tickets/${ticketId}/reply`,
      { message: OK_MESSAGE },
      authHeaders(userId),
    );
    expect(res.status).toBe(201);

    const replies = await db
      .select()
      .from(ticketRepliesTable)
      .where(eq(ticketRepliesTable.ticketId, ticketId));
    expect(replies).toHaveLength(1);
    expect(replies[0].message).toBe(OK_MESSAGE);

    const [ticket] = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.id, ticketId));
    expect(ticket.status).toBe("in_progress");
  });

  it("exactly 4000 chars is the boundary (accepted)", async () => {
    const userId = await seedUser(104);
    const ticketId = await seedTicket(userId);
    const res = await post(
      `/api/support/tickets/${ticketId}/reply`,
      { message: "a".repeat(4000) },
      authHeaders(userId),
    );
    expect(res.status).toBe(201);
  });
});

describe("POST /api/support/tickets — creation message cap (SEC-92-07)", () => {
  it("400 when the creation message exceeds 4000 chars — no ticket row", async () => {
    const userId = await seedUser(105);
    const res = await post(
      "/api/support/tickets",
      { title: "عنوان", message: LONG_MESSAGE, category: "other" },
      authHeaders(userId),
    );
    expect(res.status).toBe(400);

    const tickets = await db
      .select()
      .from(supportTicketsTable)
      .where(eq(supportTicketsTable.userId, userId));
    expect(tickets).toHaveLength(0);
  });

  it("201 for a compliant creation (message stored as first reply)", async () => {
    const userId = await seedUser(106);
    const res = await post(
      "/api/support/tickets",
      { title: "عنوان", message: OK_MESSAGE, category: "billing" },
      authHeaders(userId),
    );
    expect(res.status).toBe(201);
    const ticketId = res.body.id as number;
    const replies = await db
      .select()
      .from(ticketRepliesTable)
      .where(eq(ticketRepliesTable.ticketId, ticketId));
    expect(replies).toHaveLength(1);
    expect(replies[0].message).toBe(OK_MESSAGE);
  });
});

describe("ticketReplyLimiter — per-user reply rate limit (SEC-92-07)", () => {
  it("the 31st reply within the window is 429 RATE_LIMITED", async () => {
    const userId = await seedUser(9_001);
    const ticketId = await seedTicket(userId);

    const headers = authHeaders(userId);
    let lastStatus = 0;
    let lastBody: Record<string, unknown> = {};
    for (let i = 0; i < 31; i++) {
      const res = await post(
        `/api/support/tickets/${ticketId}/reply`,
        { message: `رد رقم ${i + 1}` },
        headers,
      );
      lastStatus = res.status;
      lastBody = res.body;
      if (res.status === 429) break;
    }
    expect(lastStatus).toBe(429);
    expect(lastBody.code).toBe("RATE_LIMITED");

    // Exactly 30 replies stored — the limiter cut off the 31st.
    const replies = await db
      .select()
      .from(ticketRepliesTable)
      .where(eq(ticketRepliesTable.ticketId, ticketId));
    expect(replies).toHaveLength(30);
  });
});
