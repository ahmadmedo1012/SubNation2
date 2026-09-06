import { db, ordersTable, usersTable } from "@workspace/db";
import { and, count, desc, eq, inArray, like } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { intParam } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { idempotency } from "../../middlewares/idempotency";
import { AdjustmentError, AdjustmentService } from "../../services/adjustment.service";

const router = Router();

router.get("/users", requireAdmin, async (req, res) => {
  const { search } = req.query;

  const users =
    search && typeof search === "string"
      ? await db
          .select()
          .from(usersTable)
          .where(like(usersTable.phone, `%${search}%`))
          .orderBy(desc(usersTable.createdAt))
          .limit(100)
      : await db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(100);

  // Completed-order counts scoped to the page's user ids. The previous
  // unfiltered GROUP BY scanned the entire orders table on every dashboard
  // load just to display counts for ≤100 users.
  const orderCounts = await db
    .select({ userId: ordersTable.userId, count: count() })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.status, "completed"),
        inArray(
          ordersTable.userId,
          users.map((u) => u.id),
        ),
      ),
    )
    .groupBy(ordersTable.userId);
  const orderMap = new Map(orderCounts.map((r) => [r.userId, Number(r.count)]));

  return res.json(
    users.map((u) => ({
      id: u.id,
      phone: u.phone,
      // Display name (from Firebase / Telegram / Google) for admin
      // search + visual identification when phone is a placeholder
      // (e.g. tg_<id> for Telegram-first accounts).
      display_name: u.displayName ?? null,
      email: u.email ?? null,
      photo_url: u.photoUrl ?? null,
      // Self-reported auth provider — values: "firebase_phone" |
      // "firebase_google" | "firebase" | "telegram" | "legacy_password"
      auth_provider: u.authProvider ?? "legacy_password",
      // Boolean flags — let the frontend render Provider badges
      // without parsing auth_provider strings.
      has_google: !!u.googleId,
      has_telegram: !!u.telegramId,
      has_firebase: !!u.firebaseUid,
      // Derived from the stored authProvider tag — there's no
      // dedicated column for WhatsApp identity (the phone field
      // itself is the identity, since WhatsApp users have a real
      // 9-digit Libyan local form rather than a placeholder).
      has_whatsapp: u.authProvider === "whatsapp_phone",
      last_auth_at: u.lastAuthAt?.toISOString() ?? null,
      wallet_balance: parseFloat(String(u.walletBalance)),
      loyalty_points: u.loyaltyPoints,
      loyalty_tier: u.loyaltyTier,
      lifetime_spend: parseFloat(String(u.lifetimeSpend)),
      order_count: orderMap.get(u.id) ?? 0,
      referral_code: u.referralCode ?? null,
      created_at: u.createdAt?.toISOString(),
    })),
  );
});

/**
 * Admin user-edit endpoint.
 *
 * S-01 (security audit 004) — Findings F-004 + F-008 closure.
 *
 *   - Wallet mutations (`wallet_adjustment`, `wallet_balance`) route
 *     through `AdjustmentService`, which wraps each change in a
 *     transaction with optimistic-lock concurrency safety AND writes a
 *     `wallet_ledger` row of type=`adjustment`. Constitution Principle I
 *     compliance — every monetary change is reconstructable from the
 *     ledger.
 *   - The whole route is mounted behind the idempotency middleware so a
 *     network retry / admin double-click does NOT double-credit
 *     (closes F-008). The `Idempotency-Key` header is currently
 *     advisory; absence logs a warning, the call proceeds. Will be
 *     tightened to required after the admin UI ships the header.
 *   - Loyalty fields (`loyalty_points`, `loyalty_tier`) keep their
 *     legacy direct-update path — they are not financial integrity
 *     concerns and have no ledger.
 */
router.patch(
  "/users/:id",
  requireAdmin,
  idempotency({ routeKey: "admin.users.patch" }),
  async (req, res) => {
    const id = intParam(req, "id");
    if (id === null)
      return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

    const adminId = (req as { adminId?: number }).adminId;
    if (typeof adminId !== "number") {
      // requireAdmin guarantees this is set; defensive only.
      return res
        .status(401)
        .json(createErrorResponse("جلسة المسؤول مطلوبة", ErrorCode.UNAUTHORIZED));
    }

    const { wallet_balance, wallet_adjustment, loyalty_points, loyalty_tier, note } =
      req.body ?? {};

    // ── Wallet path: AdjustmentService (atomic, ledger-backed) ────────
    let walletResult: { walletBalance: number } | null = null;
    if (typeof wallet_adjustment === "number" || typeof wallet_balance === "number") {
      try {
        if (typeof wallet_adjustment === "number") {
          walletResult = await AdjustmentService.adjust(id, wallet_adjustment, {
            adminId,
            note: typeof note === "string" ? note : "Admin adjustment",
          });
        } else if (typeof wallet_balance === "number") {
          walletResult = await AdjustmentService.setBalance(id, wallet_balance, {
            adminId,
            note: typeof note === "string" ? note : "Admin balance set",
          });
        }
      } catch (err) {
        if (err instanceof AdjustmentError) {
          return res
            .status(err.statusCode)
            .json(createErrorResponse(err.message, mapAdjustmentErrorToCode(err.code)));
        }
        throw err;
      }
    }

    // ── Non-financial fields: direct UPDATE, no ledger ────────────────
    const nonFinancialUpdates: Record<string, unknown> = {};
    if (typeof loyalty_points === "number" && loyalty_points >= 0) {
      nonFinancialUpdates.loyaltyPoints = loyalty_points;
    }
    if (
      typeof loyalty_tier === "string" &&
      ["bronze", "silver", "gold", "platinum"].includes(loyalty_tier)
    ) {
      nonFinancialUpdates.loyaltyTier = loyalty_tier;
    }

    if (!walletResult && Object.keys(nonFinancialUpdates).length === 0) {
      return res.status(400).json(createErrorResponse("لا توجد تعديلات", ErrorCode.INVALID_DATA));
    }

    if (Object.keys(nonFinancialUpdates).length > 0) {
      await db.update(usersTable).set(nonFinancialUpdates).where(eq(usersTable.id, id));
    }

    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!updated) {
      // The wallet path would have caught this earlier; reachable only
      // if the row was deleted between the AdjustmentService commit and
      // this read.
      return res.status(404).json(createErrorResponse("المستخدم غير موجود", ErrorCode.NOT_FOUND));
    }

    void writeAuditLog(req, "user.update", "user", id, {
      fields_changed: [
        ...(walletResult ? ["walletBalance"] : []),
        ...Object.keys(nonFinancialUpdates),
      ],
      // F-004 — record the actual amount on the audit row so the trail
      // is reconstructable without joining the ledger.
      ...(walletResult ? { wallet_balance_after: walletResult.walletBalance } : {}),
    });

    return res.json({
      id: updated.id,
      phone: updated.phone,
      wallet_balance: parseFloat(String(updated.walletBalance)),
      loyalty_points: updated.loyaltyPoints,
      loyalty_tier: updated.loyaltyTier,
    });
  },
);

function mapAdjustmentErrorToCode(code: string): ErrorCode {
  switch (code) {
    case "USER_NOT_FOUND":
      return ErrorCode.NOT_FOUND;
    case "NEGATIVE_BALANCE":
    case "ZERO_DELTA":
    case "CONCURRENCY_ERROR":
      // ErrorCode does not have a dedicated CONFLICT slot — the
      // upstream HTTP status (409) already conveys the semantics;
      // INVALID_DATA is the closest match for the body code.
      return ErrorCode.INVALID_DATA;
    case "INVALID_AMOUNT":
      // H6 — 1e999/NaN adjustment rejected at the service boundary.
      return ErrorCode.INVALID_AMOUNT;
    default:
      return ErrorCode.INVALID_DATA;
  }
}

export { router as adminUsersRouter };
