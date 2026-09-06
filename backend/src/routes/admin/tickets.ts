import { db, supportTicketsTable, ticketRepliesTable, usersTable } from "@workspace/db";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { intParam } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { createNotification } from "../../notify";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router = Router();

router.get("/tickets", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const conditions =
    status && typeof status === "string" ? [eq(supportTicketsTable.status, status as any)] : [];

  const tickets = await db
    .select({
      ticket: supportTicketsTable,
      userPhone: usersTable.phone,
      userDisplayName: usersTable.displayName,
      userEmail: usersTable.email,
      userAuthProvider: usersTable.authProvider,
      userGoogleId: usersTable.googleId,
      userTelegramId: usersTable.telegramId,
      userFirebaseUid: usersTable.firebaseUid,
    })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(supportTicketsTable.updatedAt))
    .limit(100);

  // H18 (deep-audit 2026-09-06): this was 2N+1 queries — 100 tickets
  // meant 201 round trips to a 15-connection shared pool (reply-count +
  // latest-reply per ticket). Two batch queries below (GROUP BY count +
  // DISTINCT ON latest) do the same work in 2 round trips total.
  const ticketIds = tickets.map((row) => row.ticket.id);

  // V1-M5 (red-team 2026-09-06): an empty result set must not reach the
  // sql.join below — `IN ()` is a Postgres syntax error and turned every
  // zero-match status filter (and every fresh deploy) into a 500.
  if (ticketIds.length === 0) {
    return res.json([]);
  }

  const replyCounts = await db
    .select({ ticketId: ticketRepliesTable.ticketId, replyCount: count() })
    .from(ticketRepliesTable)
    .where(sql`${ticketRepliesTable.ticketId} IN (${sql.join(ticketIds, sql`, `)})`)
    .groupBy(ticketRepliesTable.ticketId);
  const replyCountMap = new Map<number, number>(
    replyCounts.map((r) => [r.ticketId, Number(r.replyCount)]),
  );

  const latestReplies = await db.execute<{
    ticket_id: number;
    author_type: string;
    created_at: Date;
  }>(sql`
    SELECT DISTINCT ON (ticket_id)
      ticket_id, author_type, created_at
    FROM ${ticketRepliesTable}
    WHERE ticket_id IN (${sql.join(ticketIds, sql`, `)})
    ORDER BY ticket_id, created_at DESC
  `);
  const lastReplyMap = new Map<
    number,
    { authorType: string; createdAt: Date }
  >();
  for (const r of latestReplies.rows ?? []) {
    lastReplyMap.set(r.ticket_id, {
      authorType: r.author_type,
      createdAt: new Date(r.created_at),
    });
  }

  const withCounts = tickets.map((row) => {
    const ticket = row.ticket;
    const cnt = replyCountMap.get(ticket.id) ?? 0;
    const lastReply = lastReplyMap.get(ticket.id);
    return {
      id: ticket.id,
      user_phone: row.userPhone ?? "",
      user_display_name: row.userDisplayName ?? null,
      user_email: row.userEmail ?? null,
      user_auth_provider: row.userAuthProvider ?? null,
      user_has_google: !!row.userGoogleId,
      user_has_telegram: !!row.userTelegramId,
      user_has_firebase: !!row.userFirebaseUid,
      user_has_whatsapp: row.userAuthProvider === "whatsapp_phone",
      title: ticket.title,
      category: ticket.category,
      status: ticket.status,
      created_at: ticket.createdAt.toISOString(),
      reply_count: cnt,
      last_reply_at: lastReply?.createdAt?.toISOString() ?? null,
      has_unread_admin: lastReply?.authorType === "user",
    };
  });

  return res.json(withCounts);
});

router.get("/tickets/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [row] = await db
    .select({
      ticket: supportTicketsTable,
      userPhone: usersTable.phone,
      userDisplayName: usersTable.displayName,
      userEmail: usersTable.email,
      userAuthProvider: usersTable.authProvider,
      userGoogleId: usersTable.googleId,
      userTelegramId: usersTable.telegramId,
      userFirebaseUid: usersTable.firebaseUid,
    })
    .from(supportTicketsTable)
    .leftJoin(usersTable, eq(supportTicketsTable.userId, usersTable.id))
    .where(eq(supportTicketsTable.id, id))
    .limit(1);

  if (!row) return res.status(404).json(createErrorResponse("التذكرة غير موجودة", ErrorCode.NOT_FOUND));

  const replies = await db
    .select()
    .from(ticketRepliesTable)
    .where(eq(ticketRepliesTable.ticketId, id))
    .orderBy(ticketRepliesTable.createdAt);

  return res.json({
    id: row.ticket.id,
    user_phone: row.userPhone ?? "",
    user_display_name: row.userDisplayName ?? null,
    user_email: row.userEmail ?? null,
    user_auth_provider: row.userAuthProvider ?? null,
    user_has_google: !!row.userGoogleId,
    user_has_telegram: !!row.userTelegramId,
    user_has_firebase: !!row.userFirebaseUid,
    user_has_whatsapp: row.userAuthProvider === "whatsapp_phone",
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
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const { message } = req.body ?? {};
  if (!message?.trim()) return res.status(400).json(createErrorResponse("الرسالة مطلوبة", ErrorCode.INVALID_DATA));

  const [ticket] = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.id, id))
    .limit(1);
  if (!ticket) return res.status(404).json(createErrorResponse("التذكرة غير موجودة", ErrorCode.NOT_FOUND));

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
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const { status } = req.body ?? {};
  if (!["open", "in_progress", "closed"].includes(status))
    return res.status(400).json(createErrorResponse("حالة غير صالحة", ErrorCode.INVALID_DATA));

  await db.update(supportTicketsTable).set({ status }).where(eq(supportTicketsTable.id, id));
  return res.json({ success: true });
});

export { router as adminTicketsRouter };
