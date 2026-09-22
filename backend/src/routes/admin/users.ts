import { db, ordersTable, usersTable } from "@workspace/db";
import { and, count, desc, eq, inArray, like } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { escapeLikeTerm, intParam, queryString } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { idempotency } from "../../middlewares/idempotency";
import { AdjustmentError, AdjustmentService } from "../../services/adjustment.service";
import { findIdempotencyClaimed, scopeIdempotencyKey } from "../../lib/idempotency";

const router = Router();

// 98-F3 (R98-A4 P3): no-store parity with the A7/round-94 pattern —
// the admin users list carries buyer PII (phone numbers, wallet
// balances, loyalty); an intermediary must never serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/users", requireAdmin, async (req, res) => {
  const { search } = req.query;

  // 93-C8 (A8 F-2): `page` was documented in the OpenAPI contract but
  // silently ignored — every request returned the identical first 100
  // rows, so a paginating consumer looped on page 1 forever. Mirrors
  // admin/orders.ts: clamp limit 1..200 (default 100), page >= 1,
  // offset-based. A request without params is byte-for-byte the old
  // behavior (page 1, limit 100), so the admin UI is unaffected.
  const limit = Math.min(
    Math.max(Number.parseInt(queryString(req, "limit", "100"), 10) || 100, 1),
    200,
  );
  const page = Math.max(Number.parseInt(queryString(req, "page", "1"), 10) || 1, 1);

  const users =
    search && typeof search === "string"
      ? await db
          .select()
          .from(usersTable)
          // AUD103-3-F4 (r103): escape LIKE wildcards so a "%"/"_" in the
          // search box can't act as a pattern wildcard (bare "%" matched
          // every row).
          .where(like(usersTable.phone, `%${escapeLikeTerm(search)}%`))
          .orderBy(desc(usersTable.createdAt))
          .limit(limit)
          .offset((page - 1) * limit)
      : await db
          .select()
          .from(usersTable)
          .orderBy(desc(usersTable.createdAt))
          .limit(limit)
          .offset((page - 1) * limit);

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
 *     concerns and have no ledger — BUT the points write is now a
 *     guarded (optimistic-lock) UPDATE (93-A1 S6 / 93-A2, round-93):
 *     see the M5/S6 block inside the handler.
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

    // ── Loyalty path: guarded (optimistic-lock) UPDATE — 93-A1 S6 ──────
    //
    // S6/93-A2: this used to be an absolute `SET loyalty_points = X` with
    // no predicate on prior state, racing the referral award's ATOMIC
    // `loyaltyPoints = loyaltyPoints + 50` (topup.service) — an admin edit
    // built from a stale read silently erased a concurrently-credited
    // award. Points are LYD-convertible money (100:1 via /loyalty/
    // convert-points), so this is the compare-and-set the wallet side
    // already has (AdjustmentService). 0 flipped rows → 409, the admin
    // re-reads and retries.
    //
    // Ordering note: the loyalty guard runs BEFORE the wallet adjustment
    // on purpose. A 409 here leaves ZERO mutations applied; had it run
    // after, a wallet adjustment could commit and then the loyalty 409
    // would leave a partially-applied PATCH (a retry would double-credit
    // the wallet — the idempotency middleware does not cache non-2xx).

    // M5 — loyalty_points was bounded only by `>= 0`: a compromised or
    // fat-fingered admin could set 1e15 points, which the user then
    // converts into 1e13 LYD of wallet credit via /loyalty/convert-points.
    // Cap at 10M points (= 100k LYD at the 100 pts/LYD rate) — still
    // orders of magnitude above any legitimate balance, but no longer
    // a nation-state money-printer. Ints only: fractional points would
    // corrupt the convert-points math.
    const MAX_ADMIN_SET_LOYALTY_POINTS = 10_000_000;
    const loyaltySet: Record<string, unknown> = {};
    if (
      typeof loyalty_points === "number" &&
      Number.isInteger(loyalty_points) &&
      loyalty_points >= 0 &&
      loyalty_points <= MAX_ADMIN_SET_LOYALTY_POINTS
    ) {
      loyaltySet.loyaltyPoints = loyalty_points;
    } else if (loyalty_points !== undefined) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "نقاط الولاء يجب أن تكون عدداً صحيحاً بين 0 و 10,000,000",
            ErrorCode.INVALID_DATA,
          ),
        );
    }
    if (
      typeof loyalty_tier === "string" &&
      ["bronze", "silver", "gold", "platinum"].includes(loyalty_tier)
    ) {
      loyaltySet.loyaltyTier = loyalty_tier;
    }

    if (Object.keys(loyaltySet).length > 0) {
      const [currentRow] = await db
        .select({ loyaltyPoints: usersTable.loyaltyPoints, loyaltyTier: usersTable.loyaltyTier })
        .from(usersTable)
        .where(eq(usersTable.id, id))
        .limit(1);
      if (!currentRow) {
        return res.status(404).json(createErrorResponse("المستخدم غير موجود", ErrorCode.NOT_FOUND));
      }

      // Guard on the pre-read values for every column this UPDATE touches
      // (points always; tier only when it is part of the write set).
      const guardConditions = [
        eq(usersTable.id, id),
        eq(usersTable.loyaltyPoints, currentRow.loyaltyPoints),
      ];
      if (loyaltySet.loyaltyTier !== undefined) {
        guardConditions.push(eq(usersTable.loyaltyTier, currentRow.loyaltyTier));
      }

      const flipped = await db
        .update(usersTable)
        .set(loyaltySet)
        .where(and(...guardConditions))
        .returning({ id: usersTable.id });

      if (flipped.length === 0) {
        // Concurrent mutation between our read and our write (referral
        // award, refund reversal, another admin) — the absolute edit was
        // built on stale state. Retry-safe: nothing was applied.
        return res
          .status(409)
          .json(
            createErrorResponse(
              "نقاط الولاء تغيّرت أثناء التعديل (عملية متزامنة) — حدّث الصفحة وأعد المحاولة",
              ErrorCode.CONFLICT,
              { reason: "loyalty_concurrent_modification" },
            ),
          );
      }
    }

    // ── Wallet path: AdjustmentService (atomic, ledger-backed) ────────
    let walletResult: { walletBalance: number } | null = null;
    if (typeof wallet_adjustment === "number" || typeof wallet_balance === "number") {
      // A8-09 (round-94): a wallet mutation with no operator note means
      // the audit trail (F-004) records "Admin adjustment" — useless in
      // an incident review, and the ONLY control on self-dealing via a
      // personal storefront account was that after-the-fact trail. A
      // mandatory human note gives the trail content and adds friction
      // against casual self-dealing. (AdjustmentService still enforces
      // the signed-ledger + caps + compare-and-set invariants.)
      if (typeof note !== "string" || note.trim().length < 3) {
        return res
          .status(400)
          .json(
            createErrorResponse(
              "سبب التعديل (note) مطلوب لكل تعديل على المحفظة — 3 أحرف على الأقل",
              ErrorCode.INVALID_DATA,
            ),
          );
      }
      try {
        // R108 (FH-A7 P1): durable pre-check — the key is admin-scoped
        // (u{adminId}:…) so it can never collide with a user-scoped key.
        // A same-key retry after a lost response short-circuits to 409
        // here; the in-tx claim (adjustment.service) closes the race
        // window between this check and the commit.
        const scopedAdjKey = scopeIdempotencyKey(adminId, req.header("Idempotency-Key"));
        if (scopedAdjKey && (await findIdempotencyClaimed(scopedAdjKey))) {
          return res
            .status(409)
            .json(
              createErrorResponse(
                "تم تطبيق هذا التعديل مسبقاً بنفس مفتاح الحفظ",
                ErrorCode.CONFLICT,
              ),
            );
        }
        if (typeof wallet_adjustment === "number") {
          walletResult = await AdjustmentService.adjust(id, wallet_adjustment, {
            adminId,
            note: note.trim().slice(0, 500),
            idempotencyKey: scopedAdjKey,
          });
        } else if (typeof wallet_balance === "number") {
          walletResult = await AdjustmentService.setBalance(id, wallet_balance, {
            adminId,
            note: note.trim().slice(0, 500),
            idempotencyKey: scopedAdjKey,
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

    if (!walletResult && Object.keys(loyaltySet).length === 0) {
      return res.status(400).json(createErrorResponse("لا توجد تعديلات", ErrorCode.INVALID_DATA));
    }

    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!updated) {
      // The wallet path would have caught this earlier; reachable only
      // if the row was deleted between the AdjustmentService commit and
      // this read.
      return res.status(404).json(createErrorResponse("المستخدم غير موجود", ErrorCode.NOT_FOUND));
    }

    void writeAuditLog(req, "user.update", "user", id, {
      fields_changed: [...(walletResult ? ["walletBalance"] : []), ...Object.keys(loyaltySet)],
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
      // 400-class service rejections (the AdjustmentService already
      // answers these with status 400) — the body code matches.
      return ErrorCode.INVALID_DATA;
    case "CONCURRENCY_ERROR":
      // 93-C8 (A8 F-7): ErrorCode.CONFLICT exists and is what every
      // sibling 409 mapper returns — the frontend keys the retry hint
      // off the body code (errors.ts: CONFLICT → "أعد المحاولة"), so
      // the optimistic-lock race must not arrive labeled INVALID_DATA
      // ("بيانات غير صالحة") telling the admin their input was wrong.
      return ErrorCode.CONFLICT;
    case "INVALID_AMOUNT":
      // H6 — 1e999/NaN adjustment rejected at the service boundary.
      return ErrorCode.INVALID_AMOUNT;
    default:
      return ErrorCode.INVALID_DATA;
  }
}

export { router as adminUsersRouter };
