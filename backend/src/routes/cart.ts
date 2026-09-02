import { Router } from "express";
import { db, cartItemsTable, productsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { applyFlashSale } from "../lib/pricing";

const router = Router();

interface CartItemResponse {
  id: number;
  product_id: number;
  product_name: string;
  product_slug: string | null;
  product_image_url: string | null;
  price: number;
  sale_price: number | null;
  discount_percent: number | null;
  quantity: number;
  subtotal: number;
  created_at: string;
}

async function buildCartItemResponse(row: {
  id: number;
  productId: number;
  quantity: number;
  createdAt: Date;
}): Promise<CartItemResponse> {
  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, row.productId))
    .limit(1);

  const flashSale = await applyFlashSale(product ? parseFloat(String(product.price)) : 0);
  const basePrice = product ? parseFloat(String(product.price)) : 0;
  const discountPercent = flashSale.flashSale
    ? parseFloat(String(flashSale.flashSale.discountPercent))
    : 0;
  const salePrice =
    discountPercent > 0 ? +(basePrice * (1 - discountPercent / 100)).toFixed(2) : null;
  const effectivePrice = salePrice ?? basePrice;

  return {
    id: row.id,
    product_id: row.productId,
    product_name: product?.name ?? "منتج محذوف",
    product_slug: product?.slug ?? null,
    product_image_url: product?.imageUrl ?? null,
    price: basePrice,
    sale_price: salePrice,
    discount_percent: discountPercent > 0 ? discountPercent : null,
    quantity: row.quantity,
    subtotal: +(effectivePrice * row.quantity).toFixed(2),
    created_at: row.createdAt.toISOString(),
  };
}

// GET /api/cart — get user's cart
router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const items = await db
    .select()
    .from(cartItemsTable)
    .where(eq(cartItemsTable.userId, userId))
    .orderBy(cartItemsTable.createdAt);

  const itemsWithDetails = await Promise.all(items.map(buildCartItemResponse));

  return res.json({
    items: itemsWithDetails,
    total: +itemsWithDetails.reduce((sum, i) => sum + i.subtotal, 0).toFixed(2),
  });
});

// POST /api/cart/items — add item
router.post("/items", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { product_id, quantity = 1 } = req.body ?? {};

  if (!product_id || typeof product_id !== "number")
    return res.status(400).json(createErrorResponse("معرف المنتج مطلوب", ErrorCode.INVALID_DATA));
  if (typeof quantity !== "number" || quantity < 1 || !Number.isInteger(quantity))
    return res
      .status(400)
      .json(
        createErrorResponse("الكمية يجب أن تكون رقماً صحيحاً أكبر من صفر", ErrorCode.INVALID_DATA),
      );

  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, product_id), eq(productsTable.isActive, true)))
    .limit(1);

  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const [existing] = await db
    .select()
    .from(cartItemsTable)
    .where(and(eq(cartItemsTable.userId, userId), eq(cartItemsTable.productId, product_id)))
    .limit(1);

  let item: typeof cartItemsTable.$inferSelect;

  if (existing) {
    const newQty = existing.quantity + quantity;
    [item] = await db
      .update(cartItemsTable)
      .set({ quantity: newQty, updatedAt: new Date() })
      .where(eq(cartItemsTable.id, existing.id))
      .returning();
  } else {
    [item] = await db
      .insert(cartItemsTable)
      .values({ userId, productId: product_id, quantity })
      .returning();
  }

  const response = await buildCartItemResponse(item);
  return res.status(201).json(response);
});

// PATCH /api/cart/items/:id — update quantity
router.patch("/items/:id", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const idParam = req.params.id;
  const id = parseInt(Array.isArray(idParam) ? (idParam[0] ?? "") : (idParam ?? ""), 10);
  const { quantity } = req.body ?? {};

  if (isNaN(id))
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));
  if (typeof quantity !== "number" || quantity < 1 || !Number.isInteger(quantity))
    return res
      .status(400)
      .json(
        createErrorResponse("الكمية يجب أن تكون رقماً صحيحاً أكبر من صفر", ErrorCode.INVALID_DATA),
      );

  const [existing] = await db
    .select()
    .from(cartItemsTable)
    .where(and(eq(cartItemsTable.id, id), eq(cartItemsTable.userId, userId)))
    .limit(1);

  if (!existing)
    return res.status(404).json(createErrorResponse("العنصر غير موجود", ErrorCode.NOT_FOUND));

  const [item] = await db
    .update(cartItemsTable)
    .set({ quantity, updatedAt: new Date() })
    .where(eq(cartItemsTable.id, id))
    .returning();

  const response = await buildCartItemResponse(item);
  return res.json(response);
});

// DELETE /api/cart/items/:id — remove item
router.delete("/items/:id", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const idParam = req.params.id;
  const id = parseInt(Array.isArray(idParam) ? (idParam[0] ?? "") : (idParam ?? ""), 10);

  if (isNaN(id))
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [existing] = await db
    .select()
    .from(cartItemsTable)
    .where(and(eq(cartItemsTable.id, id), eq(cartItemsTable.userId, userId)))
    .limit(1);

  if (!existing)
    return res.status(404).json(createErrorResponse("العنصر غير موجود", ErrorCode.NOT_FOUND));

  await db.delete(cartItemsTable).where(eq(cartItemsTable.id, id));
  return res.json({ success: true });
});

// DELETE /api/cart — clear cart
router.delete("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  await db.delete(cartItemsTable).where(eq(cartItemsTable.userId, userId));
  return res.json({ success: true });
});

export { router as cartRouter };
