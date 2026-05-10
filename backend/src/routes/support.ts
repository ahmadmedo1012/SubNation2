import { db, supportTicketsTable, ticketRepliesTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { intParam } from "../lib/http";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";

const router = Router();

const CATEGORIES = ["billing", "technical", "order", "account", "other"];

router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const tickets = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.userId, userId))
    .orderBy(desc(supportTicketsTable.createdAt));

  if (tickets.length === 0) return res.json([]);

  // Fetch the most recent reply per ticket in a single query (no N+1).
  const ticketIds = tickets.map((t) => t.id);
  const latestReplies = await db.execute<{
    ticket_id: number;
    author_type: string;
    message: string;
    created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (ticket_id)
      ticket_id, author_type, message, created_at
    FROM ${ticketRepliesTable}
    WHERE ticket_id IN (${sql.join(ticketIds, sql`, `)})
    ORDER BY ticket_id, created_at DESC
  `);

  const replyMap = new Map<number, { author_type: string; message: string; created_at: Date }>();
  for (const r of latestReplies.rows ?? []) {
    replyMap.set(r.ticket_id, {
      author_type: r.author_type,
      message: r.message,
      created_at: r.created_at,
    });
  }

  const result = tickets.map((t) => {
    const reply = replyMap.get(t.id);
    return {
      id: t.id,
      title: t.title,
      category: t.category,
      status: t.status,
      created_at: t.createdAt.toISOString(),
      last_reply: reply
        ? {
            author_type: reply.author_type,
            message: reply.message.slice(0, 80),
            created_at: new Date(reply.created_at).toISOString(),
          }
        : null,
    };
  });

  return res.json(result);
});

router.post("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const { title, message, category } = req.body ?? {};
  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "العنوان والرسالة مطلوبان" });
  }
  if (title.length > 255) return res.status(400).json({ error: "العنوان طويل جداً" });

  const [ticket] = await db
    .insert(supportTicketsTable)
    .values({
      userId,
      title: title.trim(),
      category: CATEGORIES.includes(category) ? category : "other",
      status: "open",
    })
    .returning();

  await db.insert(ticketRepliesTable).values({
    ticketId: ticket.id,
    authorType: "user",
    message: message.trim(),
  });

  return res
    .status(201)
    .json({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      created_at: ticket.createdAt.toISOString(),
    });
});

router.get("/:id", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.userId, userId)))
    .limit(1);

  if (!ticket) return res.status(404).json({ error: "التذكرة غير موجودة" });

  const replies = await db
    .select()
    .from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);

  return res.json({
    id: ticket.id,
    title: ticket.title,
    category: ticket.category,
    status: ticket.status,
    created_at: ticket.createdAt.toISOString(),
    replies: replies.map((r) => ({
      id: r.id,
      author_type: r.authorType,
      message: r.message,
      created_at: r.createdAt.toISOString(),
    })),
  });
});

router.post("/:id/reply", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.userId, userId)))
    .limit(1);

  if (!ticket) return res.status(404).json({ error: "التذكرة غير موجودة" });
  if (ticket.status === "closed") return res.status(400).json({ error: "التذكرة مغلقة" });

  const { message } = req.body ?? {};
  if (!message?.trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });

  const [reply] = await db
    .insert(ticketRepliesTable)
    .values({
      ticketId: id,
      authorType: "user",
      message: message.trim(),
    })
    .returning();

  await db
    .update(supportTicketsTable)
    .set({ status: "in_progress" })
    .where(eq(supportTicketsTable.id, id));

  return res
    .status(201)
    .json({
      id: reply.id,
      author_type: reply.authorType,
      message: reply.message,
      created_at: reply.createdAt.toISOString(),
    });
});

export { router as supportRouter };
