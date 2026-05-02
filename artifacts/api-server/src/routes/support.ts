import { Router } from "express";
import { db, usersTable, supportTicketsTable, ticketRepliesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { verifyToken } from "./auth";

const router = Router();

function requireAuth(req: any, res: any): number | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) { res.status(401).json({ error: "غير مصرح" }); return null; }
  const payload = verifyToken(authHeader.slice(7));
  if (!payload) { res.status(401).json({ error: "جلسة منتهية" }); return null; }
  return payload.userId;
}

const CATEGORIES = ["billing", "technical", "order", "account", "other"];

router.get("/", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const tickets = await db.select().from(supportTicketsTable)
    .where(eq(supportTicketsTable.userId, userId))
    .orderBy(desc(supportTicketsTable.createdAt));

  const withReplyCounts = await Promise.all(tickets.map(async t => {
    const replies = await db.select().from(ticketRepliesTable)
      .where(eq(ticketRepliesTable.ticketId, t.id))
      .orderBy(desc(ticketRepliesTable.createdAt))
      .limit(1);
    return {
      id: t.id,
      title: t.title,
      category: t.category,
      status: t.status,
      created_at: t.createdAt.toISOString(),
      last_reply: replies[0] ? {
        author_type: replies[0].authorType,
        message: replies[0].message.slice(0, 80),
        created_at: replies[0].createdAt.toISOString(),
      } : null,
    };
  }));

  return res.json(withReplyCounts);
});

router.post("/", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const { title, message, category } = req.body ?? {};
  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "العنوان والرسالة مطلوبان" });
  }
  if (title.length > 255) return res.status(400).json({ error: "العنوان طويل جداً" });

  const [ticket] = await db.insert(supportTicketsTable).values({
    userId,
    title: title.trim(),
    category: CATEGORIES.includes(category) ? category : "other",
    status: "open",
  }).returning();

  await db.insert(ticketRepliesTable).values({
    ticketId: ticket.id,
    authorType: "user",
    message: message.trim(),
  });

  return res.status(201).json({ id: ticket.id, title: ticket.title, status: ticket.status, created_at: ticket.createdAt.toISOString() });
});

router.get("/:id", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  const [ticket] = await db.select().from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.userId, userId)))
    .limit(1);

  if (!ticket) return res.status(404).json({ error: "التذكرة غير موجودة" });

  const replies = await db.select().from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);

  return res.json({
    id: ticket.id,
    title: ticket.title,
    category: ticket.category,
    status: ticket.status,
    created_at: ticket.createdAt.toISOString(),
    replies: replies.map(r => ({
      id: r.id,
      author_type: r.authorType,
      message: r.message,
      created_at: r.createdAt.toISOString(),
    })),
  });
});

router.post("/:id/reply", async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  const [ticket] = await db.select().from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.userId, userId)))
    .limit(1);

  if (!ticket) return res.status(404).json({ error: "التذكرة غير موجودة" });
  if (ticket.status === "closed") return res.status(400).json({ error: "التذكرة مغلقة" });

  const { message } = req.body ?? {};
  if (!message?.trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });

  const [reply] = await db.insert(ticketRepliesTable).values({
    ticketId: id,
    authorType: "user",
    message: message.trim(),
  }).returning();

  await db.update(supportTicketsTable)
    .set({ status: "in_progress" })
    .where(eq(supportTicketsTable.id, id));

  return res.status(201).json({ id: reply.id, author_type: reply.authorType, message: reply.message, created_at: reply.createdAt.toISOString() });
});

export { router as supportRouter };
