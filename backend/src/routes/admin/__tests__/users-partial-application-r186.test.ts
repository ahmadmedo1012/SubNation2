import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import express, { type Express } from "express";
import {
  adminUsersTable,
  db,
  initTestDb,
  pointsLedgerTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminUsersRouter } from "../users";
import { interleaveWriterAfterSelect } from "../../../services/__tests__/helpers/tx-interleave";

/**
 * E-F4 (R186): PATCH /api/admin/users/:id with BOTH loyalty_points and
 * wallet_adjustment runs two separate transactions — the loyalty tx
 * commits first, then the wallet CAS inside AdjustmentService can lose a
 * race (a concurrent purchase changed the balance between the service's
 * in-tx read and its guarded UPDATE). No double-apply, and a retry
 * self-heals — but the old plain-409 envelope HID the partial
 * application. The 409 now discloses it: details.partial +
 * an Arabic honesty line in the message.
 *
 * Race harness: the repo's tx-interleave helper (round-92 B2-01/B2-02) —
 * the wallet service's in-tx balance read is wrapped so a concurrent
 * writer lands between the read and the CAS, flipping 0 rows → the REAL
 * AdjustmentError 409 CONCURRENCY_ERROR path. Everything else in the
 * request replays for real (loyalty tx commits for real).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminUsersRouter);
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
async function seedUser(overrides: Partial<typeof usersTable.$inferInsert> = {}): Promise<number> {
  userSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({
      phone: `9318${String(userSeq).padStart(6, "0")}`,
      loyaltyPoints: 100,
      ...overrides,
    })
    .returning();
  return u.id;
}

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: "admin_partial_r186",
      passwordHash: "x",
      isActive: true,
      permissions: ["all"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function patchUser(
  url: string,
  token: string,
  userId: number,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("PATCH /api/admin/users/:id — wallet CAS loss after the loyalty commit (E-F4)", () => {
  it("409 discloses the loyalty partial application (details.partial + Arabic honesty line)", async () => {
    const userId = await seedUser({ loyaltyPoints: 100, walletBalance: "10.00" });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      // The concurrent writer lands between the wallet service's in-tx
      // balance read and its guarded UPDATE — the production race shape.
      const restoreInterleave = interleaveWriterAfterSelect(db, {
        matchSelectFields: (fields) =>
          !!fields &&
          typeof fields === "object" &&
          "walletBalance" in (fields as Record<string, unknown>),
        writer: async (realTx) => {
          await realTx
            .update(usersTable)
            .set({ walletBalance: "7.77" })
            .where(eq(usersTable.id, userId));
        },
      });

      let res: { status: number; body: Record<string, unknown> };
      try {
        res = await patchUser(url, token, userId, {
          loyalty_points: 200,
          wallet_adjustment: 10,
          note: "تعديل مركّب يخوض سباق المحفظة",
        });
      } finally {
        restoreInterleave();
      }

      // 409 semantics intact for the wallet failure — same code as before.
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT");

      // THE DISCLOSURE: the envelope says the loyalty side already landed.
      expect(res.body.details).toMatchObject({
        partial: { reason: "loyalty_applied_wallet_failed", loyalty_points_after: 200 },
      });
      expect(String(res.body.error)).toContain("تم تطبيق تعديل نقاط الولاء بالفعل");
      expect(String(res.body.error)).toContain("200");

      // DB truth matches the disclosure: loyalty REALLY applied (tx + its
      // points_ledger row committed)…
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      expect(row.loyaltyPoints).toBe(200);
      const ledger = await db
        .select()
        .from(pointsLedgerTable)
        .where(eq(pointsLedgerTable.userId, userId));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]!.type).toBe("admin_set");

      // …and the wallet write did NOT happen (no wallet_ledger row; the
      // concurrent writer rolled back with the failed service tx per the
      // harness caveat — the race loser's 409 is the assertion target).
      const walletLedger = await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.userId, userId));
      expect(walletLedger).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("the same wallet 409 WITHOUT the loyalty field stays a plain conflict (no partial key)", async () => {
    const userId = await seedUser({ walletBalance: "10.00" });
    const token = await seedAdmin();
    const { url, close } = await listen(buildApp());
    try {
      const restoreInterleave = interleaveWriterAfterSelect(db, {
        matchSelectFields: (fields) =>
          !!fields &&
          typeof fields === "object" &&
          "walletBalance" in (fields as Record<string, unknown>),
        writer: async (realTx) => {
          await realTx
            .update(usersTable)
            .set({ walletBalance: "7.77" })
            .where(eq(usersTable.id, userId));
        },
      });

      let res: { status: number; body: Record<string, unknown> };
      try {
        res = await patchUser(url, token, userId, {
          wallet_adjustment: 10,
          note: "تعديل محفظة فقط يخوض نفس السباق",
        });
      } finally {
        restoreInterleave();
      }

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT");
      expect(res.body.details).toBeUndefined();
      expect(String(res.body.error)).not.toContain("نقاط الولاء");
    } finally {
      close();
    }
  });
});
