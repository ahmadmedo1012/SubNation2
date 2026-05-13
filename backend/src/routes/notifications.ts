import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { intParam } from "../lib/http";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";

const router = Router();

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
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  return res.json({ success: true });
});

export { router as notificationsRouter };
