import { Router } from "express";
import { db, cartItemsTable, productVariantsTable, productsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireUser, type AuthenticatedRequest } from "../middlewares/requireUser";
import { ErrorCode, createErrorResponse } from "../lib/errors";
import { applyFlashSale, type FlashSaleStage } from "../lib/pricing";

const router = Router();

// A7 (round-94): explicit no-store on the user-scoped cart surface —
// contents + live pricing must never be served stale by an intermediary.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// H7 (deep-audit 2026-09-06): server-side cap mirrored by the frontend
// cart store — an uncapped quantity turns the per-unit checkout loop
// into a self-DoS.
const MAX_QUANTITY = 99;

/**
 * H19/H21 (deep-audit 2026-09-06): the active flash sale is a SINGLE
 * row, but every cart response re-queried it per item (N+1) and every
 * pricing calc re-queried it per keystroke. A 30 s in-process cache is
 * safe here: flash-sale end times are minute-granular, and 30 s of
 * staleness on a discount banner is an acceptable trade for removing
 * the hot-path DB round trip.
 */
const FLASH_SALE_CACHE_TTL_MS = 30_000;
let flashSaleCache: { stage: FlashSaleStage; at: number } | null = null;

async function getFlashSaleStageCached(): Promise<FlashSaleStage> {
  if (flashSaleCache && Date.now() - flashSaleCache.at < FLASH_SALE_CACHE_TTL_MS) {
    return flashSaleCache.stage;
  }
  const stage = await applyFlashSale(0);
  flashSaleCache = { stage, at: Date.now() };
  return stage;
}

interface CartItemResponse {
  id: number;
  product_id: number;
  variant_id: number | null;
  variant_label: string | null;
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

async function buildCartItemResponse(
  row: {
    id: number;
    productId: number;
    variantId: number | null;
    variantLabel: string | null;
    quantity: number;
    createdAt: Date;
  },
  product: typeof productsTable.$inferSelect | undefined,
  flashSaleStage: FlashSaleStage,
  variant?: typeof productVariantsTable.$inferSelect | undefined,
): Promise<CartItemResponse> {
  // Catalog-2026-09-20: the line prices off its VARIANT when one is set
  // (variant-aware cart); the product-level price is the legacy fallback
  // for variant-less lines.
  const basePrice = variant
    ? parseFloat(String(variant.priceLyd))
    : product
      ? parseFloat(String(product.price))
      : 0;
  const discountPercent = flashSaleStage.flashSale
    ? parseFloat(String(flashSaleStage.flashSale.discountPercent))
    : 0;
  const salePrice =
    discountPercent > 0 ? +(basePrice * (1 - discountPercent / 100)).toFixed(2) : null;
  const effectivePrice = salePrice ?? basePrice;

  return {
    id: row.id,
    product_id: row.productId,
    variant_id: row.variantId ?? null,
    variant_label: row.variantLabel ?? null,
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
// H19: batch-load products with ONE inArray query + read the flash sale
// ONCE (30 s cache) — previously 2N+1 queries for an N-item cart.
router.get("/", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;

  const items = await db
    .select()
    .from(cartItemsTable)
    .where(eq(cartItemsTable.userId, userId))
    .orderBy(cartItemsTable.createdAt);

  if (items.length === 0) {
    return res.json({ items: [], total: 0 });
  }

  const productIds = items.map((i) => i.productId);
  const [products, variants] = await Promise.all([
    db.select().from(productsTable).where(inArray(productsTable.id, productIds)),
    db
      .select()
      .from(productVariantsTable)
      .where(inArray(productVariantsTable.productId, productIds)),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const flashSaleStage = await getFlashSaleStageCached();

  const itemsWithDetails = await Promise.all(
    items.map((row) =>
      buildCartItemResponse(
        row,
        productById.get(row.productId),
        flashSaleStage,
        row.variantId ? variantById.get(row.variantId) : undefined,
      ),
    ),
  );

  return res.json({
    items: itemsWithDetails,
    total: +itemsWithDetails.reduce((sum, i) => sum + i.subtotal, 0).toFixed(2),
  });
});

// POST /api/cart/items — add item
router.post("/items", requireUser, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { product_id, variant_id, quantity = 1 } = req.body ?? {};

  if (!product_id || typeof product_id !== "number")
    return res.status(400).json(createErrorResponse("معرف المنتج مطلوب", ErrorCode.INVALID_DATA));
  if (variant_id !== undefined && variant_id !== null && typeof variant_id !== "number")
    return res.status(400).json(createErrorResponse("معرف الباقة غير صالح", ErrorCode.INVALID_DATA));
  if (typeof quantity !== "number" || quantity < 1 || !Number.isInteger(quantity))
    return res
      .status(400)
      .json(
        createErrorResponse("الكمية يجب أن تكون رقماً صحيحاً أكبر من صفر", ErrorCode.INVALID_DATA),
      );
  if (quantity > MAX_QUANTITY)
    return res
      .status(400)
      .json(createErrorResponse(`الكمية القصوى هي ${MAX_QUANTITY}`, ErrorCode.INVALID_DATA));

  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, product_id), eq(productsTable.isActive, true)))
    .limit(1);

  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  // Catalog-2026-09-20: optional variant — must belong to THIS product and
  // be active. The label is copied onto the line so the cart renders the
  // chosen option without a join.
  let variant: typeof productVariantsTable.$inferSelect | null = null;
  if (variant_id != null) {
    [variant] = await db
      .select()
      .from(productVariantsTable)
      .where(
        and(
          eq(productVariantsTable.id, variant_id),
          eq(productVariantsTable.productId, product_id),
          eq(productVariantsTable.isActive, true),
        ),
      )
      .limit(1);
    if (!variant)
      return res
        .status(400)
        .json(
          createErrorResponse("الباقة المختارة غير متاحة. اختر باقة أخرى.", ErrorCode.INVALID_DATA),
        );
  }
  const variantLabel = variant
    ? [variant.planLabel?.trim(), variant.durationLabel?.trim()].filter(Boolean).join(" — ") || null
    : null;

  // One row per (user, product) — the 2-column UNIQUE. Selecting a
  // DIFFERENT variant of a product already in the cart REPLACES the
  // line's variant (documented in schema/cart.ts); the local cart is
  // the multi-variant surface the storefront actually checks out with.
  const [existing] = await db
    .select()
    .from(cartItemsTable)
    .where(and(eq(cartItemsTable.userId, userId), eq(cartItemsTable.productId, product_id)))
    .limit(1);

  let item: typeof cartItemsTable.$inferSelect;

  if (existing) {
    const newQty = Math.min(existing.quantity + quantity, MAX_QUANTITY);
    [item] = await db
      .update(cartItemsTable)
      .set({
        quantity: newQty,
        variantId: variant ? variant.id : null,
        variantLabel,
        updatedAt: new Date(),
      })
      .where(eq(cartItemsTable.id, existing.id))
      .returning();
  } else {
    [item] = await db
      .insert(cartItemsTable)
      .values({
        userId,
        productId: product_id,
        variantId: variant ? variant.id : null,
        variantLabel,
        quantity,
      })
      .returning();
  }

  const response = await buildCartItemResponse(
    item,
    product,
    await getFlashSaleStageCached(),
    variant ?? undefined,
  );
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
  if (quantity > MAX_QUANTITY)
    return res
      .status(400)
      .json(createErrorResponse(`الكمية القصوى هي ${MAX_QUANTITY}`, ErrorCode.INVALID_DATA));

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

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, item.productId))
    .limit(1);

  const response = await buildCartItemResponse(
    item,
    product,
    await getFlashSaleStageCached(),
  );
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
