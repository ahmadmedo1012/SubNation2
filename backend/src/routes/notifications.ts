import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { intParam, limitParam, pageParam, queryString } from "../lib/http";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { ErrorCode, createErrorResponse } from "../lib/errors";

const router = Router();

// A7 (round-94): explicit no-store on the user-scoped notifications
// surface — read state must never be served stale by an intermediary.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// A9-F2 (R128-IMP-5 / B1 item 8): the pagination clamps — the audit-logs
// route's exact idiom (R127-L5): pageParam/limitParam shared helpers
// (NaN/garbage → defaults, deep-offset MAX_PAGE ceiling, limit capped).
const BELL_PAGE_LIMIT = 40;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

/** The row DTO shared by both branches (snake_case contract — the bell
 * parses these keys verbatim; the paged page rides the same rows). */
function toNotificationDto(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    link: n.link,
    is_read: n.isRead,
    created_at: n.createdAt.toISOString(),
  };
}

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  // A9-F2 (R128-IMP-5): additive ?page= pagination for the /notifications
  // page — the audit-logs envelope idiom (rows, total, page, limit,
  // hasMore; offset + page length < total) with the same createdAt-DESC +
  // id-DESC tiebreaker so offset pages never shuffle same-timestamp rows.
  //
  // COMPATIBILITY (B1 item 8: "keep the paramless shape byte-compatible
  // for the bell"): NotificationBell fetches this route PARAMLESS and
  // guards `Array.isArray(data)` — an unconditional envelope would blank
  // every bell. The paged envelope is therefore OPT-IN by naming the
  // param; a bare `?page=` (empty value) degenerates to the bell shape
  // (clamping it to page 1 would be identical data in the other shape).
  if (queryString(req, "page") === "") {
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      // id DESC: the stable tiebreaker (same-ms rows order by insertion,
      // reverse) — observable only as determinism, never as a shape change.
      .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
      .limit(BELL_PAGE_LIMIT);

    return res.json(rows.map(toNotificationDto));
  }

  const page = pageParam(req);
  const limit = limitParam(req, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
  const offset = (page - 1) * limit;

  // One page + the honest total (the audit-logs Promise.all pair).
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)`.as("count") })
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId)),
  ]);

  const total = Number(totals[0]?.count ?? 0);

  return res.json({
    notifications: rows.map(toNotificationDto),
    total,
    page,
    limit,
    hasMore: offset + rows.length < total,
  });
});

router.post("/read-all", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, userId));
  return res.json({ success: true });
});

router.post("/:id/read", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));
  // Silent no-op → 404 (audit §5): marking a non-existent or non-owned
  // notification read used to return `{success:true}` — the client could
  // never distinguish success from a stale list / wrong id.
  const marked = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
    .returning({ id: notificationsTable.id });
  if (marked.length === 0)
    return res.status(404).json(createErrorResponse("الإشعار غير موجود", ErrorCode.NOT_FOUND));
  return res.json({ success: true });
});

export { router as notificationsRouter };
