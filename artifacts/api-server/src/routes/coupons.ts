import { Router } from "express";
import { db, couponsTable, usersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { verifyToken } from "./auth";
import jwt from "jsonwebtoken";

const router = Router();
if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required");
const JWT_SECRET: string = process.env.SESSION_SECRET;
const ADMIN_JWT_SECRET = JWT_SECRET + "_admin";

function requireUser(req: any, res: any): number | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) { res.status(401).json({ error: "غير مصرح" }); return null; }
  const p = verifyToken(h.slice(7));
  if (!p) { res.status(401).json({ error: "جلسة منتهية" }); return null; }
  return p.userId;
}

function requireAdmin(req: any, res: any): boolean {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) { res.status(401).json({ error: "غير مصرح" }); return false; }
  try { jwt.verify(h.slice(7), ADMIN_JWT_SECRET); return true; }
  catch { res.status(401).json({ error: "جلسة الإدارة منتهية" }); return false; }
}

function formatCoupon(c: any) {
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

router.post("/validate", async (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const { code, order_amount } = req.body ?? {};
  if (!code?.trim()) return res.status(400).json({ error: "رمز الكوبون مطلوب" });
  if (typeof order_amount !== "number" || order_amount <= 0) {
    return res.status(400).json({ error: "مبلغ الطلب غير صالح" });
  }

  const [coupon] = await db.select().from(couponsTable)
    .where(eq(couponsTable.code, code.trim().toUpperCase())).limit(1);

  if (!coupon) return res.status(404).json({ error: "كوبون غير موجود" });
  if (!coupon.isActive) return res.status(400).json({ error: "هذا الكوبون غير نشط" });
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return res.status(400).json({ error: "انتهت صلاحية هذا الكوبون" });
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return res.status(400).json({ error: "تم استخدام هذا الكوبون بالحد الأقصى" });
  }

  const minOrder = parseFloat(String(coupon.minOrderAmount));
  if (order_amount < minOrder) {
    return res.status(400).json({
      error: `هذا الكوبون يتطلب حد أدنى للطلب ${minOrder.toFixed(2)} د.ل`,
    });
  }

  let discountAmount: number;
  if (coupon.type === "percentage") {
    discountAmount = +(order_amount * parseFloat(String(coupon.value)) / 100).toFixed(2);
  } else {
    discountAmount = Math.min(parseFloat(String(coupon.value)), order_amount);
    discountAmount = +discountAmount.toFixed(2);
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

router.get("/admin", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const coupons = await db.select().from(couponsTable).orderBy(desc(couponsTable.createdAt));
  return res.json(coupons.map(formatCoupon));
});

// ── Admin: create ─────────────────────────────────────────────────────────────

router.post("/admin", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const { code, type, value, min_order_amount, max_uses, expires_at, description } = req.body ?? {};
  if (!code?.trim()) return res.status(400).json({ error: "رمز الكوبون مطلوب" });
  if (!["percentage", "fixed"].includes(type)) return res.status(400).json({ error: "نوع الخصم غير صالح" });
  if (typeof value !== "number" || value <= 0) return res.status(400).json({ error: "قيمة الخصم غير صالحة" });
  if (type === "percentage" && value > 100) return res.status(400).json({ error: "نسبة الخصم لا يمكن أن تتجاوز 100%" });

  const upperCode = code.trim().toUpperCase();
  const existing = await db.select().from(couponsTable).where(eq(couponsTable.code, upperCode)).limit(1);
  if (existing.length > 0) return res.status(409).json({ error: "رمز الكوبون موجود مسبقاً" });

  const [coupon] = await db.insert(couponsTable).values({
    code: upperCode,
    type,
    value: String(value),
    minOrderAmount: String(min_order_amount ?? 0),
    maxUses: max_uses ?? null,
    expiresAt: expires_at ? new Date(expires_at) : null,
    description: description?.trim() || null,
    isActive: true,
  }).returning();

  return res.status(201).json(formatCoupon(coupon));
});

// ── Admin: update ─────────────────────────────────────────────────────────────

router.patch("/admin/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  const [existing] = await db.select().from(couponsTable).where(eq(couponsTable.id, id)).limit(1);
  if (!existing) return res.status(404).json({ error: "الكوبون غير موجود" });

  const { is_active, max_uses, expires_at, description } = req.body ?? {};
  const updates: Partial<typeof couponsTable.$inferInsert> = {};

  if (typeof is_active === "boolean") updates.isActive = is_active;
  if (max_uses !== undefined) updates.maxUses = max_uses;
  if (expires_at !== undefined) updates.expiresAt = expires_at ? new Date(expires_at) : null;
  if (description !== undefined) updates.description = description?.trim() || null;

  const [updated] = await db.update(couponsTable).set(updates).where(eq(couponsTable.id, id)).returning();
  return res.json(formatCoupon(updated));
});

// ── Admin: delete ─────────────────────────────────────────────────────────────

router.delete("/admin/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "معرف غير صالح" });

  await db.update(couponsTable).set({ isActive: false }).where(eq(couponsTable.id, id));
  return res.json({ success: true });
});

export { router as couponsRouter };
