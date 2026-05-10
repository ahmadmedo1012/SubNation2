import { db, supportTicketsTable, ticketRepliesTable, usersTable } from "@workspace/db";
import { and, count, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { intParam } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { createNotification } from "../../notify";

const router = Router();

router.get("/tickets", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const conditions =
    status && typeof status === "string" ? [eq(supportTicketsTable.status, status as any)] : [];

  const tickets = await db
    .select({
      ticket: supportTicketsTable,
      userPhone: usersTable.phone,
    })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(100);

  const withCounts = await Promise.all(
    tickets.map(async ({ ticket, userPhone }) => {
      const [cntRow] = await db
        .select({ count: count() })
        .from(ticketRepliesTable)
        .where(eq(ticketRepliesTable.ticketId, ticket.id));
      const [lastReply] = await db
        .select()
        .from(ticketRepliesTable)
        .where(eq(ticketRepliesTable.ticketId, ticket.id))
        .orderBy(desc(ticketRepliesTable.createdAt))
        .limit(1);
      return {
        id: ticket.id,
        user_phone: userPhone ?? "",
        title: ticket.title,
        category: ticket.category,
        status: ticket.status,
        created_at: ticket.createdAt.toISOString(),
        reply_count: Number(cntRow?.count ?? 0),
        last_reply_at: lastReply?.createdAt?.toISOString() ?? null,
        has_unread_admin: lastReply?.authorType === "user",
      };
    }),
  );

  return res.json(withCounts);
});

router.get("/tickets/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [row] = await db
    .select({ ticket: supportTicketsTable, userPhone: usersTable.phone })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(eq(supportTicketsTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json({ error: "التذكرة غير موجودة" });

  const replies = await db
    .select()
    .from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);

  return res.json({
    id: row.ticket.id,
    user_phone: row.userPhone ?? "",
    title: row.ticket.title,
    category: row.ticket.category,
    status: row.ticket.status,
    created_at: row.ticket.createdAt.toISOString(),
    replies: replies.map((r) => ({
      id: r.id,
      author_type: r.authorType,
      message: r.message,
      created_at: r.createdAt.toISOString(),
    })),
  });
});

router.post("/tickets/:id/reply", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const { message } = req.body ?? {};
  if (!message?.trim()) return res.status(400).json({ error: "الرسالة مطلوبة" });

  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.id, id))
    .limit(1);
  if (!ticket) return res.status(404).json({ error: "التذكرة غير موجودة" });

  const [reply] = await db
    .insert(ticketRepliesTable)
    .values({
      ticketId: id,
      authorType: "admin",
      message: message.trim(),
    })
    .returning();

  await db
    .update(supportTicketsTable)
    .set({ status: "in_progress" })
    .where(eq(supportTicketsTable.id, id));

  await createNotification(
    ticket.userId,
    "support",
    "رد جديد على تذكرتك",
    message.trim().slice(0, 100),
    `/support`,
  );

  return res.status(201).json({
    id: reply.id,
    author_type: reply.authorType,
    message: reply.message,
    created_at: reply.createdAt.toISOString(),
  });
});

router.patch("/tickets/:id/status", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const { status } = req.body ?? {};
  if (!["open", "in_progress", "closed"].includes(status))
    return res.status(400).json({ error: "حالة غير صالحة" });

  await db.update(supportTicketsTable).set({ status }).where(eq(supportTicketsTable.id, id));
  return res.json({ success: true });
});

export { router as adminTicketsRouter };
