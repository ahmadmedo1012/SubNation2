import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { eq } from "drizzle-orm";
import {
  adminUsersTable,
  auditLogsTable,
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminTopupsRouter } from "../topups";

/**
 * R123 (E1, test battery) — admin topup approve/reject through the REAL
 * service (no vi.mock — the sibling topups-action-body.test.ts pins the
 * route's body contract with TopupService mocked ON PURPOSE; the money
 * behavior behind those routes was only ever covered at the service
 * layer, never through the HTTP surface that ships it).
 *
 * Pinned here, against the real TopupService over pglite:
 *
 *   1. POST /api/admin/topups/:id/approve credits the wallet EXACTLY
 *      ONCE (one atomic ledger row), flips the row, and persists the
 *      acting admin's username as reviewed_by (A4-04);
 *   2. a topup.approve audit row lands in audit_logs (fire-and-forget —
 *      vi.waitFor) with the admin actor + target topup;
 *   3. the reject sibling: no credit of any kind, honest transition,
 *      reviewed_by attribution, and its topup.reject audit row.
 *
 * No TELEGRAM_* env is set → the post-approval Telegram notifications
 * self-skip; the socket emitters are no-ops without a live io server.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminTopupsRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
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

const ADMIN_USERNAME = "real-action-admin";

async function seedAdminToken(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: ADMIN_USERNAME, passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

let phoneSeq = 92_200_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

let topupSeq = 1;

async function seedPendingTopup(amount = "25.00") {
  const [user] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "10.00" })
    .returning();
  const [topup] = await db
    .insert(walletTopupsTable)
    .values({
      userId: user.id,
      amount,
      paymentMethod: "mobile_transfer",
      paymentNetwork: "madar",
      paymentReference: `TRX-A-${topupSeq++}`,
      status: "pending",
    })
    .returning();
  return { user, topup };
}

async function postAction(
  url: string,
  path: string,
  token: string,
  body: unknown = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function auditRows(action: string) {
  return db.select().from(auditLogsTable).where(eq(auditLogsTable.action, action));
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("R123 (E1): POST /api/admin/topups/:id/approve — the real money path", () => {
  it("credits the wallet EXACTLY ONCE, sets reviewed_by=<username>, and persists a topup.approve audit row", async () => {
    const { user, topup } = await seedPendingTopup("25.00");
    const token = await seedAdminToken();
    const { url, close } = await listen(buildApp());
    try {
      const res = await postAction(url, `/api/admin/topups/${topup.id}/approve`, token, {
        admin_note: "تم التحقق من التحويل",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });

      // Money: credited exactly once — balance 10 + 25, ONE atomic
      // ledger row with the topup as its reference.
      const [userAfter] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
      expect(String(userAfter.walletBalance)).toBe("35.00");
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, user.id));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        type: "topup",
        amount: "25.00",
        balanceBefore: "10.00",
        balanceAfter: "35.00",
        referenceId: topup.id,
        referenceType: "wallet_topup",
      });

      // State + attribution (A4-04): the ACTING ADMIN's username, not a
      // static tag.
      const [row] = await db
        .select()
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.id, topup.id));
      expect(row.status).toBe("approved");
      expect(row.reviewedBy).toBe(ADMIN_USERNAME);
      expect(row.reviewedAt).not.toBeNull();
      expect(row.adminNote).toBe("تم التحقق من التحويل");

      // Audit trail (fire-and-forget write): exactly one topup.approve
      // row, admin actor, this topup as the target.
      await vi.waitFor(async () => {
        expect(await auditRows("topup.approve")).toHaveLength(1);
      });
      const [audit] = await auditRows("topup.approve");
      expect(audit).toMatchObject({
        actorType: "admin",
        targetType: "topup",
        targetId: topup.id,
      });
      expect(JSON.parse(String(audit.metadata))).toMatchObject({
        admin_note: "تم التحقق من التحويل",
        reviewed_by: ADMIN_USERNAME,
      });
    } finally {
      close();
    }
  });

  it("approving an already-processed topup → 400 (documented), no second credit", async () => {
    const { user, topup } = await seedPendingTopup("25.00");
    const token = await seedAdminToken();
    const { url, close } = await listen(buildApp());
    try {
      const first = await postAction(url, `/api/admin/topups/${topup.id}/approve`, token, {});
      expect(first.status).toBe(200);

      // The double-tap / stale-tab retry: the pre-tx status guard is the
      // authority — the openapi contract documents the sequential replay
      // as 400 INVALID_DATA ("already processed", ServiceError 400; the
      // 409s are the concurrent in-tx flip + idempotency-key classes),
      // and the wallet is untouched after.
      const second = await postAction(url, `/api/admin/topups/${topup.id}/approve`, token, {});
      expect(second.status).toBe(400);
      expect(second.body).toMatchObject({ code: "INVALID_DATA" });

      const [userAfter] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
      expect(String(userAfter.walletBalance)).toBe("35.00");
      const ledger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, user.id));
      expect(ledger).toHaveLength(1);
    } finally {
      close();
    }
  });
});

describe("R123 (E1): POST /api/admin/topups/:id/reject — the real sibling", () => {
  it("rejects without crediting, attributes the reviewer, and persists a topup.reject audit row", async () => {
    const { user, topup } = await seedPendingTopup("40.00");
    const token = await seedAdminToken();
    const { url, close } = await listen(buildApp());
    try {
      const res = await postAction(url, `/api/admin/topups/${topup.id}/reject`, token, {
        admin_note: "إيصال غير واضح",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });

      // No credit of any kind: balance untouched, ZERO ledger rows.
      const [userAfter] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
      expect(String(userAfter.walletBalance)).toBe("10.00");
      expect(await db.select().from(walletLedgerTable)).toHaveLength(0);

      const [row] = await db
        .select()
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.id, topup.id));
      expect(row.status).toBe("rejected");
      expect(row.reviewedBy).toBe(ADMIN_USERNAME);
      expect(row.adminNote).toBe("إيصال غير واضح");

      await vi.waitFor(async () => {
        expect(await auditRows("topup.reject")).toHaveLength(1);
      });
      const [audit] = await auditRows("topup.reject");
      expect(audit).toMatchObject({
        actorType: "admin",
        targetType: "topup",
        targetId: topup.id,
      });
    } finally {
      close();
    }
  });
});
