import { Router } from "express";
import { z } from "zod";
import { db, couponsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { intParam } from "../lib/http";
import { fireThrottledMaintenance } from "../lib/opportunistic";
import { checkExpiringCoupons } from "../jobs/couponWatcher";
import { computeCouponDiscount, type CouponType } from "../lib/pricing";
import { requireUser } from "../middlewares/requireUser";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requirePermission } from "../lib/permissions";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { toNumber } from "../lib/numeric";

const router = Router();

// ── Admin coupon write schemas (audit M2) ────────────────────────────────────
// Previously create/patch read raw `req.body` fields: an object-valued
// min_order_amount reached Postgres as "[object Object]" (500), an
// invalid expires_at produced Invalid Date (500), a non-string
// description crashed `.trim()` (500), and a fixed-type value had no
// upper bound (a 999,999 LYD "fixed" coupon is a direct wallet-debit
// magnitude at checkout). Everything is schema-validated up front now.
const MAX_FIXED_COUPON_VALUE = 10_000; // LYD — far above any sane coupon
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const CreateCouponBody = z.object({
  code: z.string().trim().min(1).max(40),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().finite().positive().max(MAX_FIXED_COUPON_VALUE),
  min_order_amount: z.number().finite().min(0).max(1_000_000).optional().default(0),
  max_uses: z.number().int().min(1).max(1_000_000).nullish(),
  expires_at: z
    .string()
    .regex(ISO_DATE, "ISO date")
    .nullish()
    .refine((v) => v === null || v === undefined || !Number.isNaN(new Date(v).getTime()), {
      message: "invalid date",
    }),
  description: z.string().trim().max(200).nullish(),
});

const PatchCouponBody = z
  .object({
    is_active: z.boolean().optional(),
    max_uses: z.number().int().min(1).max(1_000_000).nullish(),
    expires_at: z
      .string()
      .regex(ISO_DATE, "ISO date")
      .nullish()
      .refine((v) => v === null || v === undefined || !Number.isNaN(new Date(v).getTime()), {
        message: "invalid date",
      }),
    description: z.string().trim().max(200).nullish(),
  })
  .strict();

// A5-04 (round-94): the USER-facing /validate body was read raw
// (`code?.trim()`) — the same M2 class the admin coupon routes fixed
// long ago: `{"code": 5}` crashed `.trim()` → TypeError → 500 while the
// contract documents 400 «Invalid body». Schema-validated up front now.
const ValidateCouponBody = z
  .object({
    // 40 matches the admin create bound; lookup is uppercased after trim.
    code: z.string().trim().min(1).max(40),
    order_amount: z.number().finite().positive(),
  })
  .strict();

function formatCoupon(c: typeof couponsTable.$inferSelect) {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: toNumber(c.value),
    min_order_amount: toNumber(c.minOrderAmount),
    max_uses: c.maxUses ?? null,
    used_count: c.usedCount,
    expires_at: c.expiresAt?.toISOString() ?? null,
    is_active: c.isActive,
    description: c.description ?? null,
    created_at: c.createdAt?.toISOString(),
  };
}

// ── User: validate a coupon ───────────────────────────────────────────────────

router.post("/validate", requireUser, async (req, res) => {
  // 2026-09-20 (free-infrastructure round): real user intent (applying a
  // coupon at checkout) is one of the triggers for the expiry sweep
  // (was an hourly interval timer). Throttled 15 min, fire-and-forget —
  // never blocks or fails this validation. The validation itself has
  // always reflected expiry (line below: expiresAt < now() → 400).
  fireThrottledMaintenance("coupon-sweep", 15 * 60 * 1000, checkExpiringCoupons);
  // A5-04: schema gate — non-string code / non-number order_amount are
  // 400s now (previously the raw reads crashed .trim() → 500).
  const parse = ValidateCouponBody.safeParse(req.body ?? {});
  if (!parse.success) {
    const issue = parse.error.issues[0];
    const message =
      issue?.path?.[0] === "code"
        ? "رمز الكوبون مطلوب (نص)"
        : issue?.path?.[0] === "order_amount"
          ? "مبلغ الطلب غير صالح"
          : "بيانات غير صالحة";
    return res.status(400).json(createErrorResponse(message, ErrorCode.INVALID_DATA));
  }
  const { code, order_amount } = parse.data;

  const [coupon] = await db
    .select()
    .from(couponsTable)
    .where(eq(couponsTable.code, code.toUpperCase()))
    .limit(1);

  if (!coupon)
    return res.status(404).json(createErrorResponse("كوبون غير موجود", ErrorCode.NOT_FOUND));
  if (!coupon.isActive)
    return res.status(400).json(createErrorResponse("هذا الكوبون غير نشط", ErrorCode.INVALID_DATA));
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return res
      .status(400)
      .json(createErrorResponse("انتهت صلاحية هذا الكوبون", ErrorCode.INVALID_DATA));
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return res
      .status(400)
      .json(createErrorResponse("تم استخدام هذا الكوبون بالحد الأقصى", ErrorCode.INVALID_DATA));
  }

  const minOrder = parseFloat(String(coupon.minOrderAmount));
  if (order_amount < minOrder) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          `هذا الكوبون يتطلب حد أدنى للطلب ${minOrder.toFixed(2)} د.ل`,
          ErrorCode.INVALID_DATA,
        ),
      );
  }

  let discountAmount: number;
  if (coupon.type === "percentage") {
    discountAmount = computeCouponDiscount("percentage", toNumber(coupon.value), order_amount);
  } else {
    discountAmount = computeCouponDiscount("fixed", toNumber(coupon.value), order_amount);
  }

  const finalAmount = +(order_amount - discountAmount).toFixed(2);

  // r4 red-team F-3: legacy 100% coupons (created before the create-side
  // bound) and over-discount fixed coupons (min(value, basePrice) ==
  // basePrice) would validate here as valid:true with final 0.00 — then
  // 500 at checkout. Validate and checkout must agree: if the post-
  // discount price is not strictly positive, the coupon is unusable.
  if (!(finalAmount > 0)) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "هذا الكوبون يغطي كامل قيمة الطلب ولا يمكن استخدامه (السعر النهائي يجب أن يكون أكبر من صفر)",
          ErrorCode.INVALID_DATA,
        ),
      );
  }

  return res.json({
    valid: true,
    code: coupon.code,
    type: coupon.type,
    value: toNumber(coupon.value),
    discount_amount: discountAmount,
    final_amount: finalAmount,
    description: coupon.description ?? null,
  });
});

// ── Admin: list ───────────────────────────────────────────────────────────────

router.get("/admin", requireAdmin, requirePermission("finance"), async (_req, res) => {
  // 2026-09-20: operator intent — the panel view triggers the expiry
  // sweep (throttled 1 min; was an hourly interval timer) so the list
  // it renders is already clean of expired-but-active rows.
  fireThrottledMaintenance("coupon-sweep", 60_000, checkExpiringCoupons);
  const coupons = await db.select().from(couponsTable).orderBy(desc(couponsTable.createdAt));
  return res.json(coupons.map(formatCoupon));
});

// ── Admin: create ─────────────────────────────────────────────────────────────

router.post("/admin", requireAdmin, requirePermission("finance"), async (req, res) => {
  // M2 — schema-validated create. Bounds: percentage ≤ 100 (checked
  // after parse so the error message can be specific), fixed ≤ 10k LYD,
  // min_order_amount a finite number, max_uses an int in [1, 1M],
  // expires_at a parseable ISO date, description a trimmed string.
  const parse = CreateCouponBody.safeParse(req.body ?? {});
  if (!parse.success)
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  const { code, type, value, min_order_amount, max_uses, expires_at, description } = parse.data;

  // r4 red-team F-3: reject value >= 100, not just > 100. A 100%
  // percentage coupon passes `value > 100` but produces finalPrice = 0,
  // which the checkout INVALID_PRICE gate fail-closes on — every
  // purchase with that coupon 500s while /coupons/validate happily
  // reports valid:true, final_amount: 0.00. 100%-off is not a state
  // this marketplace supports.
  if (type === "percentage" && value >= 100)
    return res
      .status(400)
      .json(
        createErrorResponse(
          "نسبة الخصم يجب أن تكون أقل من 100% (السعر لا يمكن أن يصل إلى صفر)",
          ErrorCode.INVALID_DATA,
        ),
      );

  const upperCode = code.toUpperCase();

  // Insert directly and map the unique-violation to 409 — the previous
  // select-then-insert had a TOCTOU window where two concurrent creates
  // both passed the check and the loser surfaced as a raw 500.
  let coupon: typeof couponsTable.$inferSelect;
  try {
    [coupon] = await db
      .insert(couponsTable)
      .values({
        code: upperCode,
        type,
        value: String(value),
        minOrderAmount: String(min_order_amount),
        maxUses: max_uses ?? null,
        expiresAt: expires_at ? new Date(expires_at) : null,
        description: description || null,
        isActive: true,
      })
      .returning();
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return res
        .status(409)
        .json(createErrorResponse("رمز الكوبون موجود مسبقاً", ErrorCode.ALREADY_EXISTS));
    }
    throw err;
  }

  return res.status(201).json(formatCoupon(coupon));
});

// ── Admin: update ─────────────────────────────────────────────────────────────

router.patch("/admin/:id", requireAdmin, requirePermission("finance"), async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [existing] = await db.select().from(couponsTable).where(eq(couponsTable.id, id)).limit(1);
  if (!existing)
    return res.status(404).json(createErrorResponse("الكوبون غير موجود", ErrorCode.NOT_FOUND));

  const parse = PatchCouponBody.safeParse(req.body ?? {});
  if (!parse.success)
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  const { is_active, max_uses, expires_at, description } = parse.data;
  const updates: Partial<typeof couponsTable.$inferInsert> = {};

  if (is_active !== undefined) updates.isActive = is_active;
  if (max_uses !== undefined) {
    updates.maxUses = max_uses ?? null;
  }
  if (expires_at !== undefined) updates.expiresAt = expires_at ? new Date(expires_at) : null;
  if (description !== undefined) updates.description = description || null;

  const [updated] = await db
    .update(couponsTable)
    .set(updates)
    .where(eq(couponsTable.id, id))
    .returning();
  return res.json(formatCoupon(updated));
});

// ── Admin: delete (soft) ──────────────────────────────────────────────────────

router.delete("/admin/:id", requireAdmin, requirePermission("finance"), async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // Silent no-op → 404: archiving a non-existent coupon used to return
  // `{success: true}` — the client could never distinguish a real delete
  // from a typo'd id (audit §5, 200-for-failure class).
  const archived = await db
    .update(couponsTable)
    .set({ isActive: false })
    .where(eq(couponsTable.id, id))
    .returning({ id: couponsTable.id });
  if (archived.length === 0)
    return res.status(404).json(createErrorResponse("الكوبون غير موجود", ErrorCode.NOT_FOUND));
  return res.json({ success: true });
});

export { router as couponsRouter };
