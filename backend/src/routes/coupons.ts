import { Router } from "express";
import { db, couponsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { intParam } from "../lib/http";
import { requireUser } from "../middlewares/requireUser";
import { requireAdmin } from "../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../lib/errors";

const router = Router();

function formatCoupon(c: typeof couponsTable.$inferSelect) {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: parseFloat(String(c.value)),
    min_order_amount: parseFloat(String(c.minOrderAmount)),
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
  const { code, order_amount } = req.body ?? {};
  if (!code?.trim()) return res.status(400).json(createErrorResponse("رمز الكوبون مطلوب", ErrorCode.INVALID_DATA));
  if (typeof order_amount !== "number" || order_amount <= 0) {
    return res.status(400).json(createErrorResponse("مبلغ الطلب غير صالح", ErrorCode.INVALID_DATA));
  }

  const [coupon] = await db
    .select()
    .from(couponsTable)
    .where(eq(couponsTable.code, code.trim().toUpperCase()))
    .limit(1);

  if (!coupon) return res.status(404).json(createErrorResponse("كوبون غير موجود", ErrorCode.NOT_FOUND));
  if (!coupon.isActive) return res.status(400).json(createErrorResponse("هذا الكوبون غير نشط", ErrorCode.INVALID_DATA));
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return res.status(400).json(createErrorResponse("انتهت صلاحية هذا الكوبون", ErrorCode.INVALID_DATA));
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return res.status(400).json(createErrorResponse("تم استخدام هذا الكوبون بالحد الأقصى", ErrorCode.INVALID_DATA));
  }

  const minOrder = parseFloat(String(coupon.minOrderAmount));
  if (order_amount < minOrder) {
    return res.status(400).json(createErrorResponse(`هذا الكوبون يتطلب حد أدنى للطلب ${minOrder.toFixed(2)} د.ل`, ErrorCode.INVALID_DATA));
  }

  let discountAmount: number;
  if (coupon.type === "percentage") {
    discountAmount = +((order_amount * parseFloat(String(coupon.value))) / 100).toFixed(2);
  } else {
    discountAmount = +Math.min(parseFloat(String(coupon.value)), order_amount).toFixed(2);
  }

  const finalAmount = +(order_amount - discountAmount).toFixed(2);

  return res.json({
    valid: true,
    code: coupon.code,
    type: coupon.type,
    value: parseFloat(String(coupon.value)),
    discount_amount: discountAmount,
    final_amount: finalAmount,
    description: coupon.description ?? null,
  });
});

// ── Admin: list ───────────────────────────────────────────────────────────────

router.get("/admin", requireAdmin, async (_req, res) => {
  const coupons = await db.select().from(couponsTable).orderBy(desc(couponsTable.createdAt));
  return res.json(coupons.map(formatCoupon));
});

// ── Admin: create ─────────────────────────────────────────────────────────────

router.post("/admin", requireAdmin, async (req, res) => {
  const { code, type, value, min_order_amount, max_uses, expires_at, description } = req.body ?? {};
  if (!code?.trim()) return res.status(400).json(createErrorResponse("رمز الكوبون مطلوب", ErrorCode.INVALID_DATA));
  if (!["percentage", "fixed"].includes(type))
    return res.status(400).json(createErrorResponse("نوع الخصم غير صالح", ErrorCode.INVALID_DATA));
  if (typeof value !== "number" || value <= 0)
    return res.status(400).json(createErrorResponse("قيمة الخصم غير صالحة", ErrorCode.INVALID_DATA));
  if (type === "percentage" && value > 100)
    return res.status(400).json(createErrorResponse("نسبة الخصم لا يمكن أن تتجاوز 100%", ErrorCode.INVALID_DATA));

  const upperCode = code.trim().toUpperCase();
  const existing = await db
    .select()
    .from(couponsTable)
    .where(eq(couponsTable.code, upperCode))
    .limit(1);
  if (existing.length > 0) return res.status(409).json(createErrorResponse("رمز الكوبون موجود مسبقاً", ErrorCode.ALREADY_EXISTS));

  const [coupon] = await db
    .insert(couponsTable)
    .values({
      code: upperCode,
      type,
      value: String(value),
      minOrderAmount: String(min_order_amount ?? 0),
      maxUses: max_uses ?? null,
      expiresAt: expires_at ? new Date(expires_at) : null,
      description: description?.trim() || null,
      isActive: true,
    })
    .returning();

  return res.status(201).json(formatCoupon(coupon));
});

// ── Admin: update ─────────────────────────────────────────────────────────────

router.patch("/admin/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [existing] = await db.select().from(couponsTable).where(eq(couponsTable.id, id)).limit(1);
  if (!existing) return res.status(404).json(createErrorResponse("الكوبون غير موجود", ErrorCode.NOT_FOUND));

  const { is_active, max_uses, expires_at, description } = req.body ?? {};
  const updates: Partial<typeof couponsTable.$inferInsert> = {};

  if (typeof is_active === "boolean") updates.isActive = is_active;
  if (max_uses !== undefined) updates.maxUses = max_uses;
  if (expires_at !== undefined) updates.expiresAt = expires_at ? new Date(expires_at) : null;
  if (description !== undefined) updates.description = description?.trim() || null;

  const [updated] = await db
    .update(couponsTable)
    .set(updates)
    .where(eq(couponsTable.id, id))
    .returning();
  return res.json(formatCoupon(updated));
});

// ── Admin: delete (soft) ──────────────────────────────────────────────────────

router.delete("/admin/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  await db.update(couponsTable).set({ isActive: false }).where(eq(couponsTable.id, id));
  return res.json({ success: true });
});

export { router as couponsRouter };
