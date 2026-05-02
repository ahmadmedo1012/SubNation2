import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { verifyToken } from "./auth";

const router = Router();

function requireAuth(req: any, res: any): number | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "غير مصرح" }); return null; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "جلسة منتهية" }); return null; }
  return payload.userId;
}

router.get("/", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const rows = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(40);

  return res.json(rows.map(n => ({
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    link: n.link,
    is_read: n.isRead,
    created_at: n.createdAt.toISOString(),
  })));
});

router.post("/read-all", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  await db.update(notificationsTable).set({ isRead: true })
    .where(eq(notificationsTable.userId, userId));
  return res.json({ success: true });
});

router.post("/:id/read", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });
  await db.update(notificationsTable).set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  return res.json({ success: true });
});

export { router as notificationsRouter };
