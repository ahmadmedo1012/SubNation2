import { db, referralEventsTable, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { intParam, queryString, rowsFromResult } from "../../lib/http";
import { idempotency } from "../../middlewares/idempotency";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { createNotification } from "../../notify";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router = Router();

// 98-F3 (R98-A4 P3): no-store parity with the A7/round-94 pattern —
// the admin referrals list carries referrer/referee phone PII; an
// intermediary must never serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/referrals", requireAdmin, async (req, res) => {
  const status = queryString(req, "status");
  const search = queryString(req, "search");

  // Round-3 (8-c §2.6): the three list/aggregate queries were sequential;
  // they share nothing but the (optional) status filter — run concurrently.
  // The `50` literals below duplicate lib/loyalty-tiers POINTS_PER_REFERRAL;
  // inlined into SQL because the constant lives in TypeScript (parameterize
  // here if the rate ever becomes per-referral configurable).
  const [rowsRaw, topReferrersRaw, statsRaw] = await Promise.all([
    db.execute(sql`
      SELECT
        re.id,
        re.status,
        re.created_at,
        re.credited_at,
        r.phone  AS referrer_phone,
        r.id     AS referrer_id,
        e.phone  AS referee_phone,
        50       AS points_earned
      FROM referral_events re
      JOIN users r ON r.id = re.referrer_id
      JOIN users e ON e.id = re.referee_id
      ${status !== "" ? sql`WHERE re.status = ${status}` : sql``}
      ORDER BY re.created_at DESC
      LIMIT 200
    `),
    db.execute(sql`
      SELECT
        u.phone,
        u.id,
        COUNT(*) FILTER (WHERE re.status = 'credited') AS credited_count,
        COUNT(*) AS total_count
      FROM referral_events re
      JOIN users u ON u.id = re.referrer_id
      GROUP BY u.id, u.phone
      ORDER BY credited_count DESC
      LIMIT 10
    `),
    db.execute(sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'credited') AS credited,
        COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
        COUNT(*) FILTER (WHERE status = 'credited') * 50 AS total_points
      FROM referral_events
    `),
  ]);
  const rows = rowsFromResult<any>(rowsRaw);
  const topReferrers = rowsFromResult<any>(topReferrersRaw);
  const [statsRow = {}] = rowsFromResult<any>(statsRaw);

  const searchStr = search.toLowerCase();
  let list = rows.map((r) => ({
    id: Number(r.id),
    status: r.status as string,
    created_at: new Date(r.created_at as string).toISOString(),
    credited_at: r.credited_at ? new Date(r.credited_at as string).toISOString() : null,
    referrer_phone: r.referrer_phone as string,
    referrer_id: Number(r.referrer_id),
    referee_phone: r.referee_phone as string,
    points_earned: r.status === "credited" ? 50 : 0,
  }));

  if (searchStr) {
    list = list.filter(
      (r) => r.referrer_phone.includes(searchStr) || r.referee_phone.includes(searchStr),
    );
  }

  return res.json({
    stats: {
      total: Number(statsRow.total ?? 0),
      credited: Number(statsRow.credited ?? 0),
      pending: Number(statsRow.pending ?? 0),
      total_points: Number(statsRow.total_points ?? 0),
    },
    top_referrers: topReferrers.map((r) => ({
      id: Number(r.id),
      phone: r.phone as string,
      credited_count: Number(r.credited_count),
      total_count: Number(r.total_count),
    })),
    list,
  });
});

router.post(
  "/referrals/:id/credit",
  requireAdmin,
  // Round-3 (8-b bonus): the only money-adjacent admin write without
  // idempotency — a double-click created 409 noise (the in-tx status
  // guard prevents a true double-grant, but the second attempt surfaced
  // as a raw 500 from the catch-all before this). Dedup at the door.
  idempotency({ routeKey: "admin.referrals.credit" }),
  async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [event] = await db
    .select()
    .from(referralEventsTable)
    .where(eq(referralEventsTable.id, id))
    .limit(1);
  if (!event)
    return res.status(404).json(createErrorResponse("الإحالة غير موجودة", ErrorCode.NOT_FOUND));
  if (event.status === "credited")
    return res
      .status(400)
      .json(createErrorResponse("تم منح النقاط مسبقاً", ErrorCode.INVALID_DATA));

  const POINTS = 50;
  // Status flip is guarded at the UPDATE level (WHERE status='pending') and
  // runs in a transaction with the points grant: two concurrent credits
  // serialize on the row lock and the second matches 0 rows → 409, instead
  // of double-granting the referrer's points.
  let credited = false;
  try {
    await db.transaction(async (tx) => {
      const flipped = await tx
        .update(referralEventsTable)
        .set({ status: "credited", creditedAt: new Date() })
        .where(and(eq(referralEventsTable.id, id), eq(referralEventsTable.status, "pending")))
        .returning({ id: referralEventsTable.id });
      if (flipped.length !== 1) return; // lost the race — already credited

      await tx
        .update(usersTable)
        .set({ loyaltyPoints: sql`${usersTable.loyaltyPoints} + ${POINTS}` })
        .where(eq(usersTable.id, event.referrerId));
      credited = true;
    });
  } catch {
    return res
      .status(500)
      .json(createErrorResponse("حدث خطأ أثناء قيد النقاط", ErrorCode.INTERNAL_ERROR));
  }
  if (!credited) {
    return res
      .status(409)
      .json(createErrorResponse("تم منح النقاط مسبقاً", ErrorCode.ALREADY_EXISTS));
  }

  await createNotification(
    event.referrerId,
    "loyalty",
    "تم منح نقاط الإحالة",
    `تم قيد ${POINTS} نقطة في حسابك كمكافأة إحالة`,
    "/loyalty",
  );

  return res.json({ success: true, points_credited: POINTS });
  },
);

export { router as adminReferralsRouter };
