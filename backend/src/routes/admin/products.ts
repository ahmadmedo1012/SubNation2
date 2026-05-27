import { CreateProductBody, UpdateProductBody } from "@workspace/api-zod";
import { db, inventoryTable, ordersTable, productsTable } from "@workspace/db";
import { and, count, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { encrypt } from "../../lib/encryption";
import { intParam } from "../../lib/http";
import { slugifyWithId } from "../../lib/slugify";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { bumpSitemapCache } from "../seo";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router = Router();

router.get("/products", requireAdmin, async (_req, res) => {
  // Use an explicit projection (mirrors routes/products.ts) so a future
  // schema column added before its migration runs cannot break this
  // endpoint. We only select what we render.
  const products = await db
    .select({
      id: productsTable.id,
      slug: productsTable.slug,
      name: productsTable.name,
      description: productsTable.description,
      imageUrl: productsTable.imageUrl,
      price: productsTable.price,
      costPrice: productsTable.costPrice,
      category: productsTable.category,
      isActive: productsTable.isActive,
      isArchived: productsTable.isArchived,
      usageTerms: productsTable.usageTerms,
      createdAt: productsTable.createdAt,
    })
    .from(productsTable)
    .where(eq(productsTable.isArchived, false))
    .orderBy(desc(productsTable.createdAt));

  const [stockCounts, orderCounts] = await Promise.all([
    db
      .select({ productId: inventoryTable.productId, count: count() })
      .from(inventoryTable)
      .where(eq(inventoryTable.isSold, false))
      .groupBy(inventoryTable.productId),
    db
      .select({ productId: ordersTable.productId, count: count() })
      .from(ordersTable)
      .where(eq(ordersTable.status, "completed"))
      .groupBy(ordersTable.productId),
  ]);

  const stockMap = new Map(stockCounts.map((r) => [r.productId, Number(r.count)]));
  const orderMap = new Map(orderCounts.map((r) => [r.productId, Number(r.count)]));

  return res.json(
    products.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      image_url: p.imageUrl,
      price: parseFloat(String(p.price)),
      cost_price: p.costPrice != null ? parseFloat(String(p.costPrice)) : null,
      category: p.category,
      is_active: p.isActive,
      is_archived: p.isArchived,
      stock_count: stockMap.get(p.id) ?? 0,
      order_count: orderMap.get(p.id) ?? 0,
      usage_terms: p.usageTerms,
      created_at: p.createdAt?.toISOString(),
    })),
  );
});

router.post("/products", requireAdmin, async (req, res) => {
  const parse = CreateProductBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  const data = parse.data;

  // Two-step insert + slug derivation. We need the id to be assigned by the
  // serial PK before we can fall back to `product-<id>` for any name that
  // produces an empty slug. Worst case (rare): two products with the same
  // name insert simultaneously and clash on the unique slug index — the
  // catch retries with the id-suffixed form which is guaranteed unique.
  const [inserted] = await db
    .insert(productsTable)
    .values({
      name: data.name,
      description: data.description ?? null,
      imageUrl: data.image_url ?? null,
      price: String(data.price),
      costPrice: data.cost_price != null ? String(data.cost_price) : null,
      category: data.category ?? null,
      usageTerms: data.usage_terms ?? null,
      isActive: data.is_active ?? true,
    })
    .returning();

  let slug = slugifyWithId(data.name, inserted.id, /* withIdSuffix */ false);
  let product = inserted;
  try {
    [product] = await db
      .update(productsTable)
      .set({ slug })
      .where(eq(productsTable.id, inserted.id))
      .returning();
  } catch (err) {
    // Unique constraint violation on slug — fall back to id-suffixed form.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      slug = slugifyWithId(data.name, inserted.id, /* withIdSuffix */ true);
      [product] = await db
        .update(productsTable)
        .set({ slug })
        .where(eq(productsTable.id, inserted.id))
        .returning();
    } else {
      throw err;
    }
  }

  bumpSitemapCache();
  void writeAuditLog(req, "product.create", "product", product.id, {
    name: data.name,
    slug,
    price: data.price,
    cost_price: data.cost_price ?? null,
    category: data.category,
  });

  return res.status(201).json({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: parseFloat(String(product.price)),
    cost_price: product.costPrice != null ? parseFloat(String(product.costPrice)) : null,
    category: product.category,
    is_active: product.isActive,
    is_archived: product.isArchived,
    stock_count: 0,
    order_count: 0,
    usage_terms: product.usageTerms,
    created_at: product.createdAt?.toISOString(),
  });
});

router.patch("/products/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const parse = UpdateProductBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
  const data = parse.data;

  const updateData: Record<string, any> = {};
  if (data.name != null) updateData.name = data.name;
  if (data.description != null) updateData.description = data.description;
  if (data.image_url != null) updateData.imageUrl = data.image_url;
  if (data.price != null) updateData.price = String(data.price);
  if (data.cost_price !== undefined) {
    // Allow explicit null to clear, allow number to set
    updateData.costPrice = data.cost_price != null ? String(data.cost_price) : null;
  }
  if (data.category != null) updateData.category = data.category;
  if (data.usage_terms != null) updateData.usageTerms = data.usage_terms;
  if (data.is_active != null) updateData.isActive = data.is_active;

  const [product] = await db
    .update(productsTable)
    .set(updateData)
    .where(eq(productsTable.id, id))
    .returning();
  if (!product) return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  bumpSitemapCache();

  const [[stockResult], [orderResult]] = await Promise.all([
    db
      .select({ count: count() })
      .from(inventoryTable)
      .where(and(eq(inventoryTable.productId, id), eq(inventoryTable.isSold, false))),
    db
      .select({ count: count() })
      .from(ordersTable)
      .where(and(eq(ordersTable.productId, id), eq(ordersTable.status, "completed"))),
  ]);

  void writeAuditLog(req, "product.update", "product", id, {
    fields_changed: Object.keys(updateData),
  });

  return res.json({
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: parseFloat(String(product.price)),
    cost_price: product.costPrice != null ? parseFloat(String(product.costPrice)) : null,
    category: product.category,
    is_active: product.isActive,
    is_archived: product.isArchived,
    stock_count: Number(stockResult?.count ?? 0),
    order_count: Number(orderResult?.count ?? 0),
    usage_terms: product.usageTerms,
    created_at: product.createdAt?.toISOString(),
  });
});

router.delete("/products/:id", requireAdmin, async (req, res) => {
  const id = intParam(req, "id");
  if (id === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  await db
    .update(productsTable)
    .set({ isArchived: true, isActive: false })
    .where(eq(productsTable.id, id));
  bumpSitemapCache();
  void writeAuditLog(req, "product.archive", "product", id);
  return res.json({ success: true, message: "تم أرشفة المنتج" });
});

router.get("/products/:id/inventory", requireAdmin, async (req, res) => {
  const productId = intParam(req, "id");
  if (productId === null)
    return res
      .status(400)
      .json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // Confirm the product exists so the frontend can distinguish a 404
  // from "exists but has 0 inventory rows".
  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product)
    return res
      .status(404)
      .json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  // Only fields needed for the dedup-preview in the inventory dialog.
  // accountPassword is intentionally NOT returned — it's not needed
  // for dedup and would needlessly expose encrypted material.
  const rows = await db
    .select({
      accountEmail: inventoryTable.accountEmail,
      extraDetails: inventoryTable.extraDetails,
      isSold: inventoryTable.isSold,
    })
    .from(inventoryTable)
    .where(eq(inventoryTable.productId, productId));

  const sold = rows.filter((r) => r.isSold).length;
  return res.json({
    total: rows.length,
    sold,
    available: rows.length - sold,
    items: rows.map((r) => ({
      account_email: r.accountEmail,
      extra_details: r.extraDetails,
      is_sold: r.isSold,
    })),
  });
});

router.post("/products/:id/inventory", requireAdmin, async (req, res) => {
  const productId = intParam(req, "id");
  if (productId === null) return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product) return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const { entries, bulk_text } = req.body ?? {};

  // Structured entries shape (per inventory-parser.ts ParsedInventoryEntry):
  //   { kind: "credentials"|"code", email?, password?, extra? }
  // Legacy bulk_text path is kept for any in-flight clients but new
  // operators upload via the structured path so the server-side dedup
  // and per-row validation can run uniformly.
  type ParsedEntry =
    | { kind: "credentials"; email: string; password: string; extra?: string | null }
    | { kind: "code"; extra: string };

  const items: Array<{
    accountEmail: string | null;
    accountPassword: string | null;
    extraDetails: string | null;
  }> = [];

  if (Array.isArray(entries)) {
    // Validate each entry. Reject the whole batch on the first malformed
    // entry — the operator is supposed to have previewed the parse on
    // the frontend, so a server-side reject means the payload was
    // tampered with or out of date.
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] as Partial<ParsedEntry> & { kind?: string };
      if (e?.kind === "credentials") {
        const email = typeof e.email === "string" ? e.email.trim() : "";
        const password = typeof e.password === "string" ? e.password : "";
        if (!email || !password) {
          return res
            .status(400)
            .json(
              createErrorResponse(
                `السطر ${i + 1}: بيانات الحساب ناقصة`,
                ErrorCode.INVALID_DATA,
              ),
            );
        }
        const extra =
          typeof e.extra === "string" && e.extra.trim() ? e.extra.trim() : null;
        items.push({
          accountEmail: email,
          accountPassword: encrypt(password),
          extraDetails: extra,
        });
      } else if (e?.kind === "code") {
        const code = typeof e.extra === "string" ? e.extra.trim() : "";
        if (!code) {
          return res
            .status(400)
            .json(
              createErrorResponse(
                `السطر ${i + 1}: كود فارغ`,
                ErrorCode.INVALID_DATA,
              ),
            );
        }
        items.push({
          accountEmail: null,
          accountPassword: null,
          extraDetails: code,
        });
      } else {
        return res
          .status(400)
          .json(
            createErrorResponse(
              `السطر ${i + 1}: نوع غير معروف`,
              ErrorCode.INVALID_DATA,
            ),
          );
      }
    }
  } else if (bulk_text && typeof bulk_text === "string") {
    // Legacy flat-text path. Kept for backward compatibility with old
    // bookmarklets / scripts; the modern frontend always sends
    // structured entries.
    const lines = bulk_text
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/[|,\t]/);
      if (parts.length >= 2) {
        items.push({
          accountEmail: parts[0].trim(),
          accountPassword: encrypt(parts[1].trim()),
          extraDetails: parts[2]?.trim() || null,
        });
      } else if (parts.length === 1 && parts[0].trim()) {
        // Single-column line → code-only entry (matches the new parser).
        items.push({
          accountEmail: null,
          accountPassword: null,
          extraDetails: parts[0].trim(),
        });
      }
    }
  }

  if (items.length === 0) return res.status(400).json(createErrorResponse("لا توجد بيانات صالحة للإضافة", ErrorCode.INVALID_DATA));
  if (items.length > 500) return res.status(400).json(createErrorResponse("الحد الأقصى 500 عنصر دفعة واحدة", ErrorCode.INVALID_DATA));

  // Server-side dedup against existing inventory for THIS product. Even
  // though the frontend flags duplicates in the preview, an operator can
  // still submit them on purpose ("force") — but we never want to insert
  // the SAME email twice for the same product. Keys mirror the parser
  // ('c:<email>' for credentials, 'k:<code>' for code-only).
  const existing = await db
    .select({
      accountEmail: inventoryTable.accountEmail,
      extraDetails: inventoryTable.extraDetails,
    })
    .from(inventoryTable)
    .where(eq(inventoryTable.productId, productId));
  const existingKeys = new Set<string>();
  for (const r of existing) {
    if (r.accountEmail) existingKeys.add(`c:${r.accountEmail.toLowerCase()}`);
    else if (r.extraDetails) existingKeys.add(`k:${r.extraDetails.toLowerCase()}`);
  }

  const seenInBatch = new Set<string>();
  const filtered: typeof items = [];
  let skippedDuplicates = 0;
  for (const item of items) {
    const key = item.accountEmail
      ? `c:${item.accountEmail.toLowerCase()}`
      : item.extraDetails
        ? `k:${item.extraDetails.toLowerCase()}`
        : null;
    if (key === null) {
      filtered.push(item);
      continue;
    }
    if (existingKeys.has(key) || seenInBatch.has(key)) {
      skippedDuplicates++;
      continue;
    }
    seenInBatch.add(key);
    filtered.push(item);
  }

  if (filtered.length === 0) {
    return res.status(400).json(
      createErrorResponse(
        `كل العناصر (${skippedDuplicates}) موجودة مسبقاً في المخزون`,
        ErrorCode.INVALID_DATA,
        { skipped_duplicates: skippedDuplicates },
      ),
    );
  }

  const inserted = await db
    .insert(inventoryTable)
    .values(
      filtered.map((item) => ({
        productId,
        accountEmail: item.accountEmail,
        accountPassword: item.accountPassword,
        extraDetails: item.extraDetails,
      })),
    )
    .returning();

  return res.status(201).json({
    success: true,
    added: inserted.length,
    skipped_duplicates: skippedDuplicates,
    message:
      skippedDuplicates > 0
        ? `تم إضافة ${inserted.length} عنصر، وتم تخطي ${skippedDuplicates} عنصر مكرر`
        : `تم إضافة ${inserted.length} عنصر إلى المخزون`,
  });
});

export { router as adminProductsRouter };
