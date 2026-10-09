import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminUsersTable,
  auditLogsTable,
  db,
  initTestDb,
  resetTestDb,
  supportTicketsTable,
  usersTable,
} from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminTicketsRouter } from "../tickets";

/**
 * R126-L4 (A7-F4, P3) — support-ticket admin writes are audited.
 *
 * POST /api/admin/tickets/:id/reply and PATCH /api/admin/tickets/:id/status
 * are customer-facing mutations (an admin speaks AS the store in the thread
 * and flips its status) and were the only such family writing NO audit row
 * — every other admin mutation family (orders, topups, users, products,
 * variants, referrals, admins) logs via writeAuditLog. The rows follow the
 * orders.ts fire-and-forget idiom (`void writeAuditLog(...)` — the audit
 * never blocks the user-facing response), so the assertions wait via
 * vi.waitFor exactly like admin-stats-emit.test.ts waits for the socket
 * emit.
 *
 * Locked behaviours:
 *   - a reply writes ONE `ticket.reply` row (target ticket id + reply_id +
 *     status_after in metadata; the message BODY is not copied — it already
 *     lives on the ticket_replies row the metadata identifies);
 *   - a status flip writes ONE `ticket.status_update` row with the new
 *     status in metadata (mirroring order.bulk_status_update's shape);
 *   - failed mutations (404 on a missing ticket) write NOTHING — the audit
 *     rides successful writes only, same as the emit contract.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminTicketsRouter);
  return app;
}

async function listen(): Promise<{ url: string; close: () => void }> {
  const app = buildApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let adminSeq = 0;
async function seedAdminToken(): Promise<string> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `tickets_audit_admin_${adminSeq}`,
      passwordHash: "x",
      isActive: true,
      permissions: ["support"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

let userSeq = 0;
async function seedUserId(): Promise<number> {
  userSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9462${String(userSeq).padStart(5, "0")}`, walletBalance: "0.00" })
    .returning();
  return u.id;
}

async function seedTicket(userId: number): Promise<number> {
  const [t] = await db
    .insert(supportTicketsTable)
    .values({ userId, title: "Audit pin", status: "open" })
    .returning();
  return t.id;
}

async function call(
  url: string,
  path: string,
  method: "POST" | "PATCH",
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function auditRows() {
  return db.select().from(auditLogsTable);
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R126-L4 (A7-F4) — ticket admin writes write audit rows", () => {
  it("POST /tickets/:id/reply writes one ticket.reply row", async () => {
    const token = await seedAdminToken();
    const userId = await seedUserId();
    const ticketId = await seedTicket(userId);
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/tickets/${ticketId}/reply`, "POST", token, {
        message: "رد اختبار سجل التدقيق",
      });
      expect(res.status).toBe(201);

      // The audit write is fire-and-forget — poll like the emit tests.
      await vi.waitFor(async () => {
        expect(await auditRows()).toHaveLength(1);
      });
      const [row] = await auditRows();
      expect(row.action).toBe("ticket.reply");
      expect(row.targetType).toBe("ticket");
      expect(row.targetId).toBe(ticketId);
      expect(row.actorType).toBe("admin");
      // metadata: reply_id + status_after; the message body is NOT copied.
      const meta = JSON.parse(row.metadata ?? "{}") as Record<string, unknown>;
      expect(meta.status_after).toBe("in_progress");
      expect(typeof meta.reply_id).toBe("number");
      expect(JSON.stringify(meta)).not.toContain("رد اختبار");
    } finally {
      close();
    }
  });

  it("PATCH /tickets/:id/status writes one ticket.status_update row carrying the new status", async () => {
    const token = await seedAdminToken();
    const userId = await seedUserId();
    const ticketId = await seedTicket(userId);
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/tickets/${ticketId}/status`, "PATCH", token, {
        status: "closed",
      });
      expect(res.status).toBe(200);

      await vi.waitFor(async () => {
        expect(await auditRows()).toHaveLength(1);
      });
      const [row] = await auditRows();
      expect(row.action).toBe("ticket.status_update");
      expect(row.targetType).toBe("ticket");
      expect(row.targetId).toBe(ticketId);
      expect(JSON.parse(row.metadata ?? "{}")).toMatchObject({ status: "closed" });
    } finally {
      close();
    }
  });

  it("failed mutations (404 on a missing ticket) write NO audit row", async () => {
    const token = await seedAdminToken();
    const { url, close } = await listen();
    try {
      const reply = await call(url, "/api/admin/tickets/999999/reply", "POST", token, {
        message: "لن يصل",
      });
      expect(reply.status).toBe(404);

      const flip = await call(url, "/api/admin/tickets/999999/status", "PATCH", token, {
        status: "closed",
      });
      expect(flip.status).toBe(404);

      // Give the fire-and-forget chains a beat to (not) fire.
      await new Promise((r) => setImmediate(r));
      expect(await auditRows()).toHaveLength(0);
    } finally {
      close();
    }
  });
});
