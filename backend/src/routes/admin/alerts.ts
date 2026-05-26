import { adminAlertsTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router } from "express";
import {
  countAllAlerts,
  countUnreadAlerts,
  deleteAllAlerts,
  deleteReadAlerts,
  getAdminAlerts,
  markAlertRead,
  markAllAlertsRead,
} from "../../jobs/alertLogger";
import { intParam, queryString } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { dispatchTestAlert } from "../../services/alerting.service";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePagination(req: Parameters<typeof queryString>[0]) {
  const rawLimit = Number.parseInt(queryString(req, "limit", String(DEFAULT_LIMIT)), 10);
  const rawPage = Number.parseInt(queryString(req, "page", "1"), 10);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const page = Math.max(Number.isFinite(rawPage) ? rawPage : 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

router.post("/test", requireAdmin, async (req, res) => {
  try {
    const { rule } = req.body ?? {};
    const alertEvent = await dispatchTestAlert(typeof rule === "string" ? rule : undefined);
    return res.json({
      alert: alertEvent,
      delivery: {
        telegram: { ok: true },
        discord: { ok: true },
        webhook: { ok: true },
      },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to dispatch test alert");
    return res.status(500).json(createErrorResponse("خطأ في إرسال التنبيه", ErrorCode.INTERNAL_ERROR));
  }
});

router.get("/new", requireAdmin, async (req, res) => {
  try {
    const sinceId = Number.parseInt(queryString(req, "since", "0"), 10) || 0;
    const allAlerts = await getAdminAlerts(50);
    const newAlerts = allAlerts.filter((a) => a.id > sinceId);
    return res.json({ alerts: newAlerts });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch new alerts");
    return res.status(500).json(createErrorResponse("خطأ", ErrorCode.INTERNAL_ERROR));
  }
});

router.get("/unread-count", requireAdmin, async (_req, res) => {
  try {
    const c = await countUnreadAlerts();
    return res.json({ count: c });
  } catch {
    return res.status(500).json(createErrorResponse("خطأ", ErrorCode.INTERNAL_ERROR));
  }
});

router.get("/", requireAdmin, async (req, res) => {
  try {
    const { limit, page, offset } = parsePagination(req);
    const [alerts, unreadCount, total] = await Promise.all([
      getAdminAlerts(limit, offset),
      countUnreadAlerts(),
      countAllAlerts(),
    ]);
    return res.json({
      alerts,
      unreadCount,
      total,
      page,
      limit,
      hasMore: offset + alerts.length < total,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch admin alerts");
    return res.status(500).json(createErrorResponse("خطأ في جلب التنبيهات", ErrorCode.INTERNAL_ERROR));
  }
});

router.patch("/read-all", requireAdmin, async (req, res) => {
  try {
    await markAllAlertsRead();
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to mark all alerts read");
    return res.status(500).json(createErrorResponse("خطأ", ErrorCode.INTERNAL_ERROR));
  }
});

router.patch("/:id/read", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرّف غير صالح", ErrorCode.INVALID_DATA));
  try {
    await markAlertRead(id);
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to mark alert read");
    return res.status(500).json(createErrorResponse("خطأ", ErrorCode.INTERNAL_ERROR));
  }
});

router.delete("/read", requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteReadAlerts();
    return res.json({ success: true, deleted });
  } catch (err) {
    req.log.error({ err }, "Failed to delete read alerts");
    return res.status(500).json(createErrorResponse("خطأ", ErrorCode.INTERNAL_ERROR));
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرّف غير صالح", ErrorCode.INVALID_DATA));
  try {
    await db.delete(adminAlertsTable).where(eq(adminAlertsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete alert");
    return res.status(500).json(createErrorResponse("خطأ", ErrorCode.INTERNAL_ERROR));
  }
});

router.delete("/", requireAdmin, async (req, res) => {
  try {
    await deleteAllAlerts();
    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete all alerts");
    return res.status(500).json(createErrorResponse("خطأ", ErrorCode.INTERNAL_ERROR));
  }
});

export { router as adminAlertsRouter };
