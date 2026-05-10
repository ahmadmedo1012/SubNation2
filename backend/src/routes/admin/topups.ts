import { db, usersTable, walletTopupsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { intParam } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ServiceError, TopupService } from "../../services/topup.service";

const router = Router();

router.get("/topups", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const conditions =
    status && typeof status === "string" ? [eq(walletTopupsTable.status, status as any)] : [];

  const topups = await db
    .select({
      topup: walletTopupsTable,
      userPhone: usersTable.phone,
    })
    .from(walletTopupsTable)
    .leftJoin(usersTable, eq(walletTopupsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(walletTopupsTable.createdAt))
    .limit(100);

  return res.json(
    topups.map((r) => ({
      id: r.topup.id,
      user_id: r.topup.userId,
      user_phone: r.userPhone ?? "",
      amount: parseFloat(String(r.topup.amount)),
      payment_method: r.topup.paymentMethod ?? "mobile_transfer",
      payment_network: r.topup.paymentNetwork ?? null,
      sender_phone: r.topup.senderPhone ?? null,
      sender_account: r.topup.senderAccount ?? null,
      payment_reference: r.topup.paymentReference ?? null,
      status: r.topup.status,
      admin_note: r.topup.adminNote ?? null,
      created_at: r.topup.createdAt?.toISOString(),
    })),
  );
});

router.post("/topups/:id/approve", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  try {
    const result = await TopupService.approve(id, req.body?.admin_note ?? null);
    return res.json(result);
  } catch (err) {
    if (err instanceof ServiceError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    throw err;
  }
});

router.post("/topups/:id/reject", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  try {
    const result = await TopupService.reject(id, req.body?.admin_note ?? null);
    return res.json(result);
  } catch (err) {
    if (err instanceof ServiceError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    throw err;
  }
});

export { router as adminTopupsRouter };
