import { db, usersTable, walletTopupsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { intParam } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ServiceError, TopupService } from "../../services/topup.service";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router = Router();

router.get("/topups", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const conditions =
    status && typeof status === "string" ? [eq(walletTopupsTable.status, status as any)] : [];

  const topups = await db
    .select({
      topup: walletTopupsTable,
      userPhone: usersTable.phone,
      userDisplayName: usersTable.displayName,
      userEmail: usersTable.email,
      userAuthProvider: usersTable.authProvider,
      userGoogleId: usersTable.googleId,
      userTelegramId: usersTable.telegramId,
      userFirebaseUid: usersTable.firebaseUid,
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
      user_display_name: r.userDisplayName ?? null,
      user_email: r.userEmail ?? null,
      user_auth_provider: r.userAuthProvider ?? null,
      user_has_google: !!r.userGoogleId,
      user_has_telegram: !!r.userTelegramId,
      user_has_firebase: !!r.userFirebaseUid,
      user_has_whatsapp: r.userAuthProvider === "whatsapp_phone",
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
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  try {
    const result = await TopupService.approve(id, req.body?.admin_note ?? null);
    void writeAuditLog(req, "topup.approve", "topup", id, {
      admin_note: req.body?.admin_note ?? null,
    });
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
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  try {
    const result = await TopupService.reject(id, req.body?.admin_note ?? null);
    void writeAuditLog(req, "topup.reject", "topup", id, {
      admin_note: req.body?.admin_note ?? null,
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof ServiceError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    throw err;
  }
});

export { router as adminTopupsRouter };
