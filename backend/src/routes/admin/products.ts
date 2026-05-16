import { CreateProductBody, UpdateProductBody } from "@workspace/api-zod";
import { db, inventoryTable, ordersTable, productsTable } from "@workspace/db";
import { and, count, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { encrypt } from "../../lib/encryption";
import { intParam } from "../../lib/http";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { bumpSitemapCache } from "../seo";

const router = Router();

router.get("/products", requireAdmin, async (_req, res) => {
  const products = await db
    .select()
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
      name: p.name,
      description: p.description,
      image_url: p.imageUrl,
      price: parseFloat(String(p.price)),
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
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const data = parse.data;

  const [product] = await db
    .insert(productsTable)
    .values({
      name: data.name,
      description: data.description ?? null,
      imageUrl: data.image_url ?? null,
      price: String(data.price),
      category: data.category ?? null,
      usageTerms: data.usage_terms ?? null,
      isActive: data.is_active ?? true,
    })
    .returning();

  bumpSitemapCache();
  void writeAuditLog(req, "product.create", "product", product.id, {
    name: data.name,
    price: data.price,
    category: data.category,
  });

  return res.status(201).json({
    id: product.id,
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: parseFloat(String(product.price)),
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
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  const parse = UpdateProductBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "بيانات غير صالحة" });
  const data = parse.data;

  const updateData: Record<string, any> = {};
  if (data.name != null) updateData.name = data.name;
  if (data.description != null) updateData.description = data.description;
  if (data.image_url != null) updateData.imageUrl = data.image_url;
  if (data.price != null) updateData.price = String(data.price);
  if (data.category != null) updateData.category = data.category;
  if (data.usage_terms != null) updateData.usageTerms = data.usage_terms;
  if (data.is_active != null) updateData.isActive = data.is_active;

  const [product] = await db
    .update(productsTable)
    .set(updateData)
    .where(eq(productsTable.id, id))
    .returning();
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

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
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: parseFloat(String(product.price)),
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
  if (id === null) return res.status(400).json({ error: "معرف غير صالح" });

  await db
    .update(productsTable)
    .set({ isArchived: true, isActive: false })
    .where(eq(productsTable.id, id));
  bumpSitemapCache();
  void writeAuditLog(req, "product.archive", "product", id);
  return res.json({ success: true, message: "تم أرشفة المنتج" });
});

router.post("/products/:id/inventory", requireAdmin, async (req, res) => {
  const productId = intParam(req, "id");
  if (productId === null) return res.status(400).json({ error: "معرف غير صالح" });

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product) return res.status(404).json({ error: "المنتج غير موجود" });

  const { entries, bulk_text } = req.body ?? {};

  let items: Array<{ accountEmail: string; accountPassword: string; extraDetails?: string }> = [];

  if (bulk_text && typeof bulk_text === "string") {
    const lines = bulk_text
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/[|,\t]/);
      if (parts.length >= 2) {
        items.push({
          accountEmail: parts[0].trim(),
          accountPassword: parts[1].trim(),
          extraDetails: parts[2]?.trim() || undefined,
        });
      }
    }
  } else if (Array.isArray(entries)) {
    interface AccountEntry {
      account_email: string;
      account_password: string;
      extra_details?: string;
    }
    items = entries
      .filter((e: AccountEntry) => e.account_email && e.account_password)
      .map((e: AccountEntry) => ({
        accountEmail: e.account_email,
        accountPassword: e.account_password,
        extraDetails: e.extra_details || undefined,
      }));
  }

  if (items.length === 0) return res.status(400).json({ error: "لا توجد بيانات صالحة للإضافة" });
  if (items.length > 500) return res.status(400).json({ error: "الحد الأقصى 500 عنصر دفعة واحدة" });

  const inserted = await db
    .insert(inventoryTable)
    .values(
      items.map((item) => ({
        productId,
        accountEmail: item.accountEmail,
        accountPassword: encrypt(item.accountPassword),
        extraDetails: item.extraDetails ?? null,
      })),
    )
    .returning();

  return res.status(201).json({
    success: true,
    added: inserted.length,
    message: `تم إضافة ${inserted.length} عنصر إلى المخزون`,
  });
});

export { router as adminProductsRouter };
