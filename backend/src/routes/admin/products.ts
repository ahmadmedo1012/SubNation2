import { CreateProductBody, UpdateProductBody } from "@workspace/api-zod";
import {
  db,
  inventoryTable,
  ordersTable,
  productVariantsTable,
  productsTable,
} from "@workspace/db";
import { and, count, desc, eq, inArray, asc, sql } from "drizzle-orm";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { computeRetailLYD, getPricingConfig } from "../../lib/pricing-config";
import { encrypt, safeDecrypt } from "../../lib/encryption";
import { intParam } from "../../lib/http";
import { slugifyWithId } from "../../lib/slugify";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { bumpSitemapCache } from "../seo";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

import { fireThrottledMaintenance } from "../../lib/opportunistic";
import { runStockSweep } from "../../jobs/stockWatcher";

const router = Router();

// AUD103-4-F13 (r103): no-store parity with the 98-F3 pattern —
// this surface carries inventory listing returns decrypted emails/codes; an intermediary must never
// serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/products", requireAdmin, async (req, res) => {
  // V4: the admin command palette sends ?search= — previously ignored
  // (the handler didn't even read req). Match name or category,
  // case-insensitive, capped at 100 chars.
  const searchRaw = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const searchLike = searchRaw.length > 0 ? `%${searchRaw.toLowerCase().slice(0, 100)}%` : null;

  // Use an explicit projection (mirrors routes/products.ts) so a future
  // schema column added before its migration runs cannot break this
  // endpoint. We only select what we render.
  // Round-3 (8-c §3.4): the stock/order aggregates were UNCORRELATED full-
  // table GROUP BYs (every inventory row + every completed order) on a
  // 60s-polled admin endpoint, and the product list itself had no LIMIT.
  // Pattern from admin/users.ts: fetch the page's product ids first, then
  // scope both aggregates to exactly those ids (empty-set guarded), and
  // cap the list at 200 like every other admin table.
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
    .where(
      searchLike
        ? and(
            eq(productsTable.isArchived, false),
            // Round-3 (8-c §4.7): ILIKE (not LOWER LIKE) so the trigram
            // GIN index on products.name actually serves admin search.
            sql`(${productsTable.name} ILIKE ${searchLike} OR LOWER(${productsTable.category}) LIKE ${searchLike})`,
          )
        : eq(productsTable.isArchived, false),
    )
    .orderBy(desc(productsTable.createdAt))
    .limit(200);

  const productIds = products.map((p) => p.id);

  const [stockCounts, orderCounts, variantRows] =
    productIds.length > 0
      ? await Promise.all([
          db
            .select({ productId: inventoryTable.productId, count: count() })
            .from(inventoryTable)
            .where(
              and(eq(inventoryTable.isSold, false), inArray(inventoryTable.productId, productIds)),
            )
            .groupBy(inventoryTable.productId),
          db
            .select({ productId: ordersTable.productId, count: count() })
            .from(ordersTable)
            .where(
              and(eq(ordersTable.status, "completed"), inArray(ordersTable.productId, productIds)),
            )
            .groupBy(ordersTable.productId),
          // Catalog-2026-09-20: variants ride ONE inArray query for the
          // whole page — ADMIN context, so internal fields (cost, sku) are
          // included by design. The pricing-config read is cached (60s).
          db
            .select()
            .from(productVariantsTable)
            .where(inArray(productVariantsTable.productId, productIds))
            .orderBy(productVariantsTable.sortOrder, productVariantsTable.priceLyd),
        ])
      : [[], [], []];

  const stockMap = new Map(stockCounts.map((r) => [r.productId, Number(r.count)]));
  const orderMap = new Map(orderCounts.map((r) => [r.productId, Number(r.count)]));

  const pricingConfig = await getPricingConfig();
  const variantsByProduct = new Map<number, unknown[]>();
  for (const v of variantRows) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push({
      id: v.id,
      product_id: v.productId,
      plan_label: v.planLabel?.trim() || null,
      duration_label: v.durationLabel?.trim() || null,
      duration_days: v.durationDays ?? null,
      cost_price: parseFloat(String(v.costPrice)),
      price_lyd: parseFloat(String(v.priceLyd)),
      computed_price_lyd: computeRetailLYD(parseFloat(String(v.costPrice)), pricingConfig),
      sku: v.sku ?? null,
      is_active: v.isActive,
      sort_order: v.sortOrder,
      created_at: v.createdAt?.toISOString(),
    });
    variantsByProduct.set(v.productId, list);
  }

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
      variants: variantsByProduct.get(p.id) ?? [],
    })),
  );
});

router.post("/products", requireAdmin, async (req, res) => {
  const parse = CreateProductBody.safeParse(req.body);
  if (!parse.success)
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
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
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const parse = UpdateProductBody.safeParse(req.body);
  if (!parse.success)
    return res.status(400).json(createErrorResponse("بيانات غير صالحة", ErrorCode.INVALID_DATA));
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
  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

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
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // Silent no-op → 404 (audit §5): archiving a non-existent product used
  // to return success — now the admin gets a truthful signal that the
  // id was stale (e.g. another admin already archived it).
  const archived = await db
    .update(productsTable)
    .set({ isArchived: true, isActive: false })
    .where(eq(productsTable.id, id))
    .returning({ id: productsTable.id });
  if (archived.length === 0)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
  bumpSitemapCache();
  void writeAuditLog(req, "product.archive", "product", id);
  return res.json({ success: true, message: "تم أرشفة المنتج" });
});

router.get("/products/:id/inventory", requireAdmin, async (req, res) => {
  const productId = intParam(req, "id");
  if (productId === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  // Confirm the product exists so the frontend can distinguish a 404
  // from "exists but has 0 inventory rows".
  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  // Only fields needed for the dedup-preview in the inventory dialog.
  // accountPassword is intentionally NOT returned — it's not needed
  // for dedup and would needlessly expose encrypted material.
  //
  // F7 (round-94 A4): extraDetails is now encrypted at rest (same GCM as
  // the password) — decrypt for the preview so the operator still sees
  // the real code/text and the frontend dedup compares apples to apples.
  // safeDecrypt passes legacy plaintext through unchanged and returns
  // null for undecryptable rows (the inventory-health diagnostic reports
  // those separately).
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
      extra_details: safeDecrypt(r.extraDetails),
      is_sold: r.isSold,
    })),
  });
});

/**
 * POST /products/:id/inventory/set-count — {count: n}
 *
 * V4-P0 (contract audit 2026-09-06): the admin UI's InlineStockEdit has
 * called this endpoint since it was written — but no route existed, so
 * EVERY manual stock edit 404'd and surfaced a destructive toast.
 *
 * Semantics (honest stock):
 *   - count < unsold  → DELETE the surplus OLDEST unsold units (an
 *     unsold row is a real, unclaimed account — removing it is safe and
 *     reviewable in the audit log).
 *   - count > unsold  → REJECT. Stock cannot be fabricated: every unit
 *     delivers real credentials at purchase time. The operator must add
 *     actual inventory via the upload path (POST /products/:id/inventory).
 */
router.post("/products/:id/inventory/set-count", requireAdmin, async (req, res) => {
  const productId = intParam(req, "id");
  if (productId === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const { count: target } = (req.body ?? {}) as { count?: unknown };
  if (typeof target !== "number" || !Number.isInteger(target) || target < 0 || target > 100_000) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "عدد الوحدات يجب أن يكون رقماً صحيحاً بين 0 و100000",
          ErrorCode.INVALID_DATA,
        ),
      );
  }

  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const [unsoldResult] = await db
    .select({ unsold: count() })
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)));
  const unsold = Number(unsoldResult?.unsold ?? 0);

  if (target > unsold) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "لا يمكن زيادة المخزون بإدخال رقم فقط — كل وحدة تحتاج بيانات حساب فعلية. استخدم «رفع مخزون» لإضافة الوحدات",
          ErrorCode.INVALID_DATA,
        ),
      );
  }

  const surplus = unsold - target;
  if (surplus > 0) {
    // Oldest-first (lowest id) — the units that have sat the longest are
    // the least valuable to keep.
    const oldest = await db
      .select({ id: inventoryTable.id })
      .from(inventoryTable)
      .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)))
      .orderBy(asc(inventoryTable.id))
      .limit(surplus);
    await db.delete(inventoryTable).where(
      inArray(
        inventoryTable.id,
        oldest.map((r) => r.id),
      ),
    );
  }

  void writeAuditLog(req, "product.inventory.set-count", "product", productId, {
    before: unsold,
    after: target,
    removed: surplus,
  });

  // 2026-09-20 (free-infrastructure round): admin inventory write —
  // trigger the low/zero-stock sweep (throttled 10 min; was a
  // 30-minute interval timer).
  fireThrottledMaintenance("stock-sweep", 10 * 60 * 1000, runStockSweep);

  return res.json({ success: true, product_id: productId, stock_count: target });
});

router.post("/products/:id/inventory", requireAdmin, async (req, res) => {
  const productId = intParam(req, "id");
  if (productId === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

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
    // Plaintext at PARSE time — the server-side dedup below compares
    // against existing rows via safeDecrypt (apples-to-apples). GCM has
    // a random IV, so encrypting before the dedup comparison made every
    // re-upload unique and the guard dead. Encryption happens at INSERT.
    plainExtra: string | null;
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
              createErrorResponse(`السطر ${i + 1}: بيانات الحساب ناقصة`, ErrorCode.INVALID_DATA),
            );
        }
        const extra = typeof e.extra === "string" && e.extra.trim() ? e.extra.trim() : null;
        items.push({
          accountEmail: email,
          accountPassword: encrypt(password),
          // F7 (round-94 A4): extraDetails is deliverable material
          // (recovery notes / codes) — encrypt at rest exactly like the
          // password. Reads go through safeDecrypt, which passes legacy
          // plaintext rows through unchanged. Kept plaintext here for
          // the dedup pass; encrypted at INSERT.
          plainExtra: extra,
        });
      } else if (e?.kind === "code") {
        const code = typeof e.extra === "string" ? e.extra.trim() : "";
        if (!code) {
          return res
            .status(400)
            .json(createErrorResponse(`السطر ${i + 1}: كود فارغ`, ErrorCode.INVALID_DATA));
        }
        items.push({
          accountEmail: null,
          accountPassword: null,
          // F7: for code products this IS the deliverable — plaintext
          // storage meant a DB dump/backup leak exposed every gift code
          // while the password column sat safely in GCM. Encrypted at
          // INSERT; plaintext here for the dedup comparison.
          plainExtra: code,
        });
      } else {
        return res
          .status(400)
          .json(createErrorResponse(`السطر ${i + 1}: نوع غير معروف`, ErrorCode.INVALID_DATA));
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
          // F7: plaintext for the dedup pass; encrypted at INSERT.
          plainExtra: parts[2]?.trim() || null,
        });
      } else if (parts.length === 1 && parts[0].trim()) {
        // Single-column line → code-only entry (matches the new parser).
        items.push({
          accountEmail: null,
          accountPassword: null,
          // F7: the code IS the deliverable — plaintext for dedup,
          // GCM-encrypted at INSERT.
          plainExtra: parts[0].trim(),
        });
      }
    }
  }

  if (items.length === 0)
    return res
      .status(400)
      .json(createErrorResponse("لا توجد بيانات صالحة للإضافة", ErrorCode.INVALID_DATA));
  if (items.length > 500)
    return res
      .status(400)
      .json(createErrorResponse("الحد الأقصى 500 عنصر دفعة واحدة", ErrorCode.INVALID_DATA));

  // AUD103-4-F1 (r103): the dedup read and the batch INSERT are now ONE
  // transaction under a per-product advisory lock (exact wallet.ts MAX_PENDING
  // idiom). Pre-fix, two concurrent submits of the same batch (double-click
  // with no Idempotency-Key, or two operators) both passed the dedup read
  // before either committed → the same credential inserted TWICE → both
  // units sellable → one account sold to two buyers. The lock + single tx
  // makes dedup-then-insert atomic per product; the second submitter now
  // sees the first batch's rows and skips them honestly.
  const insertion = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"inventory-upload:" + productId}, 0))`,
    );

    // Server-side dedup against existing inventory for THIS product. Even
    // though the frontend flags duplicates in the preview, an operator can
    // still submit them on purpose ("force") — but we never want to insert
    // the SAME email twice for the same product. Keys mirror the parser
    // ('c:<email>' for credentials, 'k:<code>' for code-only).
    //
    // F7: extraDetails rows are encrypted at rest now — key existing rows
    // by their DECRYPTED value (safeDecrypt passes legacy plaintext
    // through) so the comparison stays apples-to-apples with the incoming
    // plaintext.
    const existing = await tx
      .select({
        accountEmail: inventoryTable.accountEmail,
        extraDetails: inventoryTable.extraDetails,
      })
      .from(inventoryTable)
      .where(eq(inventoryTable.productId, productId));
    const existingKeys = new Set<string>();
    for (const r of existing) {
      if (r.accountEmail) existingKeys.add(`c:${r.accountEmail.toLowerCase()}`);
      else if (r.extraDetails)
        existingKeys.add(`k:${(safeDecrypt(r.extraDetails) ?? "").toLowerCase()}`);
    }

    const seenInBatch = new Set<string>();
    const filtered: typeof items = [];
    let skippedDuplicates = 0;
    for (const item of items) {
      const key = item.accountEmail
        ? `c:${item.accountEmail.toLowerCase()}`
        : item.plainExtra
          ? `k:${item.plainExtra.toLowerCase()}`
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
      return { kind: "all_duplicates" as const, skippedDuplicates };
    }

    const inserted = await tx
      .insert(inventoryTable)
      .values(
        filtered.map((item) => ({
          productId,
          accountEmail: item.accountEmail,
          accountPassword: item.accountPassword,
          // F7: GCM-encrypt the deliverable exactly once, at the insert
          // boundary (password is already ciphertext from the parser).
          extraDetails: item.plainExtra !== null ? encrypt(item.plainExtra) : null,
        })),
      )
      .returning();

    return { kind: "ok" as const, inserted, skippedDuplicates };
  });

  if (insertion.kind === "all_duplicates") {
    return res
      .status(400)
      .json(
        createErrorResponse(
          `كل العناصر (${insertion.skippedDuplicates}) موجودة مسبقاً في المخزون`,
          ErrorCode.INVALID_DATA,
          { skipped_duplicates: insertion.skippedDuplicates },
        ),
      );
  }

  const { inserted, skippedDuplicates } = insertion;

  // A5-10 (round-94): inventory upload is a credential-bearing admin
  // write (up to 500 units of accounts/codes) with NO audit row, while
  // the neighbouring set-count/create/update/archive all log. "who
  // uploaded what, when" is exactly what an incident review needs.
  void writeAuditLog(req, "product.inventory.upload", "product", productId, {
    added: inserted.length,
    skipped_duplicates: skippedDuplicates,
  });

  // 2026-09-20 (free-infrastructure round): admin inventory write —
  // trigger the low/zero-stock sweep (throttled 10 min; was a
  // 30-minute interval timer). Stock may have CROSSED a threshold in
  // either direction; the sweep is idempotent + DB-level deduped.
  fireThrottledMaintenance("stock-sweep", 10 * 60 * 1000, runStockSweep);

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
