import { adminAlertsTable, db } from "@workspace/db";
import { desc, eq, gt } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
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
import {
  dispatchTestAlert,
  type ChannelDeliveryResult,
} from "../../services/alerting.service";
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
    // A5-08 (round-94): the route used to throw away dispatchTestAlert's
    // real per-channel delivery results and hardcode
    // `{telegram:{ok:true}, discord:{ok:true}, webhook:{ok:true}}` — an
    // operator testing the alert channels during an actual outage (bad
    // Telegram token, dead webhook) saw three green checkmarks. The
    // response now mirrors the ACTUAL delivery outcomes: `ok` is true
    // only for outcome="delivered"; deduped/rate-limited/skipped/failed
    // are reported honestly with the reason + attempts.
    const { alert, delivery } = await dispatchTestAlert(
      typeof rule === "string" ? rule : undefined,
    );
    const channelDelivery: Record<string, { ok: boolean; outcome: string; attempts: number; error_message?: string }> =
      {};
    for (const r of delivery as ChannelDeliveryResult[]) {
      channelDelivery[r.channel] = {
        ok: r.outcome === "delivered",
        outcome: r.outcome,
        attempts: r.attempts,
        ...(r.errorMessage ? { error_message: r.errorMessage } : {}),
      };
    }
    // A5-08: sensitive surface (fires real notifications, can be used to
    // probe/spam channels) — same audit coverage as every other admin write.
    void writeAuditLog(req, "alert.test_dispatch", "alert", null, {
      rule: alert.rule,
      channels: Object.fromEntries(
        (delivery as ChannelDeliveryResult[]).map((r) => [r.channel, r.outcome]),
      ),
    });
    return res.json({ alert, delivery: channelDelivery });
  } catch (err) {
    // `req.log` only exists when pino-http is mounted (production app).
    // Standalone test mounts — and any future bare-router consumer —
    // would turn a handled 500 into an unhandled HTML crash here.
    // Fall back to the module logger instead.
    const log = (req.log ?? logger) as typeof req.log;
    log.error({ err }, "Failed to dispatch test alert");
    return res.status(500).json(createErrorResponse("خطأ في إرسال التنبيه", ErrorCode.INTERNAL_ERROR));
  }
});

router.get("/new", requireAdmin, async (req, res) => {
  try {
    const sinceId = Number.parseInt(queryString(req, "since", "0"), 10) || 0;
    // 96-F1 (R96-A5 M15): the since filter now runs in SQL
    // (WHERE id > sinceId ORDER BY id DESC LIMIT 50) instead of
    // fetching the last-50-by-created_at and filtering in JS. Polled
    // every 5 minutes from every open admin page — the old shape paid
    // the full 50-row fetch + deserialization even when ZERO rows were
    // new. id is the serial PK (monotonic with insert order), so
    // id-desc ordering is equivalent to the previous createdAt-desc
    // for this polling surface. (Kept in the route rather than threaded
    // through jobs/alertLogger.getAdminAlerts — that service helper is
    // shared with the observability cache and stays shape-compatible.)
    const newAlerts = await db
      .select()
      .from(adminAlertsTable)
      .where(gt(adminAlertsTable.id, sinceId))
      .orderBy(desc(adminAlertsTable.id))
      .limit(50);
    return res.json({ alerts: newAlerts });
  } catch (err) {
    // (req.log ?? logger): pino-http is only mounted on the production
    // app — bare-router test mounts must not turn a handled 500 into an
    // unhandled HTML crash (same fallback as the /test route above).
    const log = (req.log ?? logger) as typeof req.log;
    log.error({ err }, "Failed to fetch new alerts");
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
    // Silent no-op → 404 (audit §5): deleting a non-existent alert used
    // to return `{success:true}`.
    const deleted = await db
      .delete(adminAlertsTable)
      .where(eq(adminAlertsTable.id, id))
      .returning({ id: adminAlertsTable.id });
    if (deleted.length === 0)
      return res.status(404).json(createErrorResponse("التنبيه غير موجود", ErrorCode.NOT_FOUND));
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
