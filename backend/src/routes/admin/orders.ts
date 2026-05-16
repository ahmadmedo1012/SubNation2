import { db, ordersTable, productsTable, usersTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { safeDecrypt } from "../../lib/encryption";
import { queryString } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";

const router = Router();

router.get("/orders", requireAdmin, async (req, res) => {
  const { status } = req.query;
  const limit = Math.min(
    Math.max(Number.parseInt(queryString(req, "limit", "100"), 10) || 100, 1),
    200,
  );
  const page = Math.max(Number.parseInt(queryString(req, "page", "1"), 10) || 1, 1);
  const conditions =
    status && typeof status === "string" ? [eq(ordersTable.status, status as any)] : [];

  const orders = await db
    .select({
      order: ordersTable,
      userPhone: usersTable.phone,
      productName: productsTable.name,
    })
    .from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.userId, usersTable.id))
    .leftJoin(productsTable, eq(ordersTable.productId, productsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ordersTable.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return res.json(
    orders.map((r) => ({
      id: r.order.id,
      order_code: r.order.orderCode,
      user_phone: r.userPhone ?? "",
      product_name: r.productName ?? "",
      amount: parseFloat(String(r.order.amount)),
      status: r.order.status,
      delivered_email: r.order.deliveredEmail ?? null,
      delivered_password: safeDecrypt(r.order.deliveredPassword),
      delivered_extra_details: r.order.deliveredExtraDetails ?? null,
      coupon_code: r.order.couponCode ?? null,
      discount_amount: r.order.discountAmount ? parseFloat(String(r.order.discountAmount)) : 0,
      created_at: r.order.createdAt?.toISOString(),
    })),
  );
});

// Must match the order_status pg enum (shared/db/src/schema/orders.ts).
const ORDER_STATUS_VALUES = ["pending", "completed", "failed", "refunded"] as const;

router.patch("/orders/bulk-status", requireAdmin, async (req, res) => {
  const { ids, status } = req.body ?? {};
  const ALLOWED: readonly string[] = ORDER_STATUS_VALUES;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids مطلوبة" });
  if (!status || !ALLOWED.includes(status))
    return res.status(400).json({ error: "حالة غير صالحة" });
  const numIds: number[] = ids.map(Number).filter((n) => !isNaN(n));
  if (numIds.length === 0) return res.status(400).json({ error: "لا معرّفات صالحة" });
  await db
    .update(ordersTable)
    .set({ status: status as any })
    .where(sql`id = ANY(${numIds})`);

  // Notify affected users
  const updatedOrders = await db
    .select({ id: ordersTable.id, userId: ordersTable.userId })
    .from(ordersTable)
    .where(sql`id = ANY(${numIds})`);

  for (const o of updatedOrders) {
    import("../../lib/socket").then(({ emitToUser }) => {
      emitToUser(o.userId, "order-updated", { id: o.id, status });
    });
  }
  import("../../lib/socket").then(({ emitToAdmins }) => {
    emitToAdmins("admin-stats-update", { type: "order-bulk-update", status });
  });

  void writeAuditLog(req, "order.bulk_status_update", "order", null, {
    ids: numIds,
    new_status: status,
    count: numIds.length,
  });

  return res.json({ success: true, updated: numIds.length });
});

export { router as adminOrdersRouter };
