import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { intParam } from "../lib/http";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { ErrorCode, createErrorResponse } from "../lib/errors";

const router = Router();

// A7 (round-94): explicit no-store on the user-scoped notifications
// surface — read state must never be served stale by an intermediary.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(40);

  return res.json(
    rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link,
      is_read: n.isRead,
      created_at: n.createdAt.toISOString(),
    })),
  );
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
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));
  // Silent no-op → 404 (audit §5): marking a non-existent or non-owned
  // notification read used to return `{success:true}` — the client could
  // never distinguish success from a stale list / wrong id.
  const marked = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
    .returning({ id: notificationsTable.id });
  if (marked.length === 0)
    return res
      .status(404)
      .json(createErrorResponse("الإشعار غير موجود", ErrorCode.NOT_FOUND));
  return res.json({ success: true });
});

export { router as notificationsRouter };
