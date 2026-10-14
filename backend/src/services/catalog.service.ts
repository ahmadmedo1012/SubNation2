// R136 (BE-3 extraction): moved verbatim from routes/products.ts — the
// catalog SERVICE: the public variant DTO machinery
// (fetchVariantPoolData / projectVariantDtos / loadPublicVariants), the
// detail DTO builders (buildProductDetailDto / displayBaseFromVariants /
// getActiveFlashSale), the public list loader (loadProductList —
// Arabic-search expansion + relevance tiers included), and the
// detail/recommendation cached loaders (loadProductDetailBySlug /
// loadProductDetailById / loadProductRecommendations).
// routes/products.ts keeps the route handlers, the catalog caches and the
// getProductStatsHandler/getFlashSaleHandler/catalogCache/flashSaleCache
// exports (routes/index.ts re-mounts them at /catalog/stats +
// /flash-sale). Only the address changed — the logic is byte-identical.
import {
  db,
  inventoryTable,
  ordersTable,
  productVariantsTable,
  productsTable,
} from "@workspace/db";
import { applyFlashSale, computeFlashSalePrice } from "../lib/pricing";
// R122 (A11-F2): Arabic-brand alias expansion for the public search below.
import { expandArabicSearch } from "../lib/arabic-search";
import { and, asc, count, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { escapeLikeTerm } from "../lib/http";

// ── Variant projection (public DTO contract) ─────────────────────────────
/**
 * Public shape of a catalog variant — deliberately EXCLUDES every
 * internal field (cost_price, sku, supplier identity). The customer
 * sees: which option it is (labels), what it costs (LYD), whether the
 * flash sale discounts it.
 *
 * R102 (inventory truthfulness): `is_available` is now VARIANT-scoped,
 * mirroring the checkout claim's two-pool semantics exactly — a variant
 * is sellable when its own scoped pool has a deliverable unit OR the
 * product's generic pool (variant_id IS NULL) has one. (It used to
 * mirror the PRODUCT-level stock flag, which misled once variant-scoped
 * pools exist: an option with zero scoped stock showed available and
 * failed at checkout.)
 */
interface PublicVariantDto {
  id: number;
  plan_label: string | null;
  duration_label: string | null;
  /** Joined display label: "Individual — 3 Months" (single axis: "3 Months"). */
  label: string;
  price: number;
  sale_price: number | null;
  discount_percent: number | null;
  is_available: boolean;
}

/**
 * R102 (inventory truthfulness): a unit counts as STOCK only when it is
 * DELIVERABLE — at least one credential field present (email, password,
 * or extra details). Checkout's R93-DATA gate refuses to sell a unit with
 * zero credential fields (INVENTORY_CORRUPT at pay time), so counting
 * such rows as stock advertised availability the platform could never
 * honor (the copilot +N ghost-stock incident class). Decryption health
 * stays a checkout-time concern — SQL can't see GCM auth failures.
 */
export const deliverableUnitCondition = () =>
  or(
    isNotNull(inventoryTable.accountPassword),
    isNotNull(inventoryTable.accountEmail),
    isNotNull(inventoryTable.extraDetails),
  );

/**
 * F-1 (R118-A6): the DB half of loadPublicVariants — variant rows +
 * the two-pool stock counts keyed by product/variant. Split out (from
 * what used to be one function) so the detail routes can start these
 * queries in the SAME Promise.all as the product row: the flash-sale
 * discount only feeds the JS projection (projectVariantDtos below),
 * never the SQL, so it never justified a sequential stage.
 */
export interface VariantPoolData {
  rows: Array<{
    id: number;
    productId: number;
    planLabel: string | null;
    durationLabel: string | null;
    priceLyd: string;
  }>;
  /** Deliverable stock in each product's GENERIC pool (variant_id IS NULL). */
  genericByProduct: Map<number, number>;
  /** Deliverable stock per (variant-scoped) pool. */
  scopedByVariant: Map<number, number>;
}

export async function fetchVariantPoolData(productIds: number[]): Promise<VariantPoolData> {
  const empty: VariantPoolData = {
    rows: [],
    genericByProduct: new Map(),
    scopedByVariant: new Map(),
  };
  if (productIds.length === 0) return empty;

  const [rows, stockRows] = await Promise.all([
    db
      .select({
        id: productVariantsTable.id,
        productId: productVariantsTable.productId,
        planLabel: productVariantsTable.planLabel,
        durationLabel: productVariantsTable.durationLabel,
        priceLyd: productVariantsTable.priceLyd,
      })
      .from(productVariantsTable)
      .where(
        and(
          inArray(productVariantsTable.productId, productIds),
          eq(productVariantsTable.isActive, true),
        ),
      )
      .orderBy(asc(productVariantsTable.sortOrder), asc(productVariantsTable.priceLyd)),
    // R102: per-pool deliverable stock counts — (product, variant) scoped
    // pools plus the generic (variant_id IS NULL) pool per product.
    db
      .select({
        productId: inventoryTable.productId,
        variantId: inventoryTable.variantId,
        stockCount: sql<number>`COUNT(*)::int`.as("stock_count"),
      })
      .from(inventoryTable)
      .where(
        and(
          inArray(inventoryTable.productId, productIds),
          eq(inventoryTable.isSold, false),
          deliverableUnitCondition(),
        ),
      )
      .groupBy(inventoryTable.productId, inventoryTable.variantId),
  ]);

  const genericByProduct = new Map<number, number>();
  const scopedByVariant = new Map<number, number>();
  for (const s of stockRows) {
    if (s.variantId === null) {
      genericByProduct.set(s.productId, (genericByProduct.get(s.productId) ?? 0) + s.stockCount);
    } else {
      scopedByVariant.set(s.variantId, (scopedByVariant.get(s.variantId) ?? 0) + s.stockCount);
    }
  }

  return { rows, genericByProduct, scopedByVariant };
}

/**
 * F-1 (R118-A6): the JS half of loadPublicVariants — projects raw pool
 * data into the public DTO. Identical output to the pre-split loop
 * (labels, two-pool availability, flash-sale arithmetic), so the public
 * variant contract is unchanged.
 */
function projectVariantDtos(
  pool: VariantPoolData,
  discountPercent: number,
): Map<number, PublicVariantDto[]> {
  const map = new Map<number, PublicVariantDto[]>();
  for (const v of pool.rows) {
    const price = parseFloat(String(v.priceLyd));
    // Two-pool availability, mirroring the checkout claim exactly.
    const available =
      (pool.scopedByVariant.get(v.id) ?? 0) > 0 ||
      (pool.genericByProduct.get(v.productId) ?? 0) > 0;
    const plan = v.planLabel?.trim() || null;
    const duration = v.durationLabel?.trim() || null;
    const label = [plan, duration].filter(Boolean).join(" — ") || "الخيار الافتراضي";
    const list = map.get(v.productId) ?? [];
    list.push({
      id: v.id,
      plan_label: plan,
      duration_label: duration,
      label,
      price,
      sale_price: discountPercent > 0 ? computeFlashSalePrice(price, discountPercent) : null,
      discount_percent: discountPercent > 0 ? discountPercent : null,
      is_available: available,
    });
    map.set(v.productId, list);
  }
  return map;
}

/**
 * Load the active variants for a set of products in ONE query, grouped
 * in JS by product_id. Ordered by (sort_order, price) so the selector
 * renders cheapest-first deterministically. R102: availability is
 * computed here per-variant from the SAME two-pool semantics the
 * checkout claim uses (variant-scoped first, then generic) — the
 * product-level callback parameter is gone. F-1 (R118-A6): internally
 * fetch (fetchVariantPoolData) + project (projectVariantDtos).
 */
async function loadPublicVariants(
  productIds: number[],
  discountPercent: number,
): Promise<Map<number, PublicVariantDto[]>> {
  return projectVariantDtos(await fetchVariantPoolData(productIds), discountPercent);
}

/**
 * Public-facing flash-sale shape used by /api/products,
 * /api/products/flash-sale and the frontend banner. Underlying lookup
 * is delegated to lib/pricing.ts so the math + lookup criteria stay
 * in lockstep with the order pipeline and the admin calculator.
 */
export async function getActiveFlashSale(): Promise<{
  id: number;
  title: string;
  discount_percent: number;
  ends_at: string;
} | null> {
  const { flashSale } = await applyFlashSale(0);
  if (!flashSale) return null;
  return {
    id: flashSale.id,
    title: flashSale.title,
    discount_percent: flashSale.discountPercent,
    ends_at: flashSale.endsAt,
  };
}

// ── Product detail DTO (F-1, R118-A6) ────────────────────────────────────

type ProductRow = typeof productsTable.$inferSelect;
type ActiveFlashSale = Awaited<ReturnType<typeof getActiveFlashSale>>;

/**
 * R130 (A7-F1): «تبدأ من» = the cheapest BUYABLE variant's price.
 * The availability-blind min surfaced prices whose variant had already
 * drained (its scoped pool empty + no generic units) while pricier
 * variants held stock — a price the grid advertised but the charge could
 * only 409 (the variant's claim pool is provably empty then). Falls back
 * to the availability-blind min when EVERY variant is drained (the
 * product renders sold-out anyway) and to the product row price when no
 * variants exist.
 */
function displayBaseFromVariants(
  variants: Array<{ price: number; is_available: boolean }>,
  basePrice: number,
): number {
  if (variants.length === 0) return basePrice;
  const available = variants.filter((v) => v.is_available);
  const pool = available.length > 0 ? available : variants;
  return Math.min(...pool.map((v) => v.price));
}

/**
 * F-1 (R118-A6): single projection for BOTH detail routes — previously
 * two copy-pasted 30-line DTO literals, now one builder so /:id and
 * /by-slug are byte-identical by construction (the F-1 stage collapse
 * restructured which queries run where; this keeps WHAT they return
 * pinned). Field list + order are the PUBLIC CONTRACT (asserted by
 * routes/__tests__/product-detail-shape.test.ts) — do not reorder.
 */
export function buildProductDetailDto(
  product: ProductRow,
  flashSale: ActiveFlashSale,
  stockCount: number,
  orderCount: number,
  variantPool: VariantPoolData,
) {
  const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;
  const variants = projectVariantDtos(variantPool, discountPercent).get(product.id) ?? [];
  const basePrice = parseFloat(String(product.price));
  const displayBase = displayBaseFromVariants(variants, basePrice);
  const salePrice =
    discountPercent > 0 ? computeFlashSalePrice(displayBase, discountPercent) : null;
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    description_long: product.descriptionLong ?? null,
    faq: product.faq ?? null,
    seo_title: product.seoTitle ?? null,
    features: product.features ?? null,
    seo_description: product.seoDescription ?? null,
    image_url: product.imageUrl,
    price: displayBase,
    price_from: variants.length > 1,
    category: product.category,
    is_active: product.isActive,
    usage_terms: product.usageTerms,
    stock_count: stockCount,
    is_available: stockCount > 0,
    sale_price: salePrice,
    discount_percent: discountPercent > 0 ? discountPercent : null,
    order_count: orderCount,
    variants: variants.map((v) => ({
      id: v.id,
      plan_label: v.plan_label,
      duration_label: v.duration_label,
      label: v.label,
      price: v.price,
      sale_price: v.sale_price,
      discount_percent: v.discount_percent,
      is_available: v.is_available,
    })),
  };
}

// ── Public list loader (GET /api/products) ───────────────────────────────

/**
 * R136 (BE-3 extraction): the route-computed query inputs the loader
 * acts on. The route narrows the raw Express query values to
 * string | undefined and folds `available_only === "true"` /
 * `fields === "list"` / `hasSearch` BEFORE calling — same values the
 * inline closure used to capture, so the loader's behavior is
 * unchanged. (`available_only` keeps its wire name as the destructured
 * local inside the loader.)
 */
export interface ProductListParams {
  category: string | undefined;
  search: string | undefined;
  hasSearch: boolean;
  availableOnly: boolean;
  sort: string | undefined;
  listView: boolean;
}

/**
 * The public catalog list loader — moved verbatim from the GET / route
 * handler in routes/products.ts (the `loader` closure body). Search
 * requests stay UNCACHEABLE by contract (B6-02): the route decides
 * cacheability, this function only computes the rows.
 */
export async function loadProductList(params: ProductListParams) {
  const { category, search, hasSearch, availableOnly: available_only, sort, listView } = params;
  // R132: computed once, shared by the WHERE branches and the relevance
  // ORDER BY below (kept out of the hasSearch block for the tier logic).
  const rawTerm = typeof search === "string" ? search.trim() : "";
  const expansion = hasSearch ? expandArabicSearch(rawTerm) : null;
  /**
   * R132: one compound branch as SQL — `brand ∧ modifier [∧ digits]`.
   * The digit refinement uses BOUNDARY patterns (`D-%`, `% D-%`, `% D`)
   * rather than a bare `%D%`: "1" must not match inside "12-Month"
   * («نتفلكس ١ شهر» is the 1-month plan, and %1% would rank 12-Month
   * equally). The three shapes cover the catalog's real conventions
   * (leading position, space-delimited + hyphenated, space-delimited at
   * the name end — "Windows 10").
   */
  const compoundCondition = ({
    brand,
    modifier,
    digits,
  }: {
    brand: string;
    modifier: string;
    digits?: string;
  }) =>
    sql`(${productsTable.name} ILIKE ${"%" + escapeLikeTerm(brand) + "%"} AND ${productsTable.name} ILIKE ${"%" + escapeLikeTerm(modifier) + "%"}${digits ? sql` AND (${productsTable.name} ILIKE ${escapeLikeTerm(digits) + "-%"} OR ${productsTable.name} ILIKE ${"% " + escapeLikeTerm(digits) + "-%"} OR ${productsTable.name} ILIKE ${"% " + escapeLikeTerm(digits)})` : sql``})`;

  // R142 (I-2): one duration-token EXISTS branch — the LIVE catalog
  // carries durations in ARABIC variant labels («شهر واحد»، «سنة كاملة»)
  // while product names are brand-level ("Netflix") with no Latin
  // month/year fragments, so `search=شهر` matched zero rows through the
  // name-only ILIKEs. The Arabic token matches the Arabic label as-is
  // (ta-marbuta twin included — see arabic-search variantTerms).
  const variantLabelExists = (token: string) => {
    const pattern = `%${escapeLikeTerm(token)}%`;
    // R143 (L4-2): pv.is_active — the label axis alone let DEACTIVATED
    // variants surface in search (`search=شهر` promised a duration the
    // PDP selector never offers — variant deactivation is a live admin
    // write path). Parity with the display path's active-only pool
    // (fetchVariantPoolData's eq(isActive, true)).
    return sql`EXISTS (SELECT 1 FROM ${productVariantsTable} pv WHERE pv.product_id = ${productsTable.id} AND pv.is_active = true AND (pv.duration_label ILIKE ${pattern} OR pv.plan_label ILIKE ${pattern}))`;
  };

  // Build SQL filter conditions — pushdown to the database.
  const conditions = [eq(productsTable.isActive, true), eq(productsTable.isArchived, false)];
  if (typeof category === "string" && category.trim()) {
    conditions.push(sql`LOWER(${productsTable.category}) = LOWER(${category.trim()})`);
  }
  // (hasSearch ⇒ expansion was computed — the pair check narrows TS.)
  if (hasSearch && expansion) {
    // A6-9 (R116): escape %/_ so a literal percent in the query can't
    // reshape the LIKE pattern (parity with the admin search sweep,
    // r103 AUD103-3-F4).
    // R122 (A11-F2): Arabic-market search enablement. Product names are
    // English but the Libyan audience searches in Arabic — the raw-only
    // ILIKE returned 0 results for «نتفليكس» and even the site's own
    // hero spelling «نتفلكس» (live audit r122-a11 §P1-1). The raw
    // whole-string condition stays FIRST and unchanged; recognized
    // Arabic brand aliases + ≥3-char transliteration skeletons
    // (lib/arabic-search, bounded ≤12 terms) are OR'd in as extra
    // literal ILIKEs, every one escapeLikeTerm'd. Pure-English queries
    // expand to nothing, so their SQL — and results — are identical.
    // Search stays UNCACHEABLE exactly as before (B6-02 above): no new
    // cache keys are minted for the expanded forms.
    //
    // R132 (arabic-search round 2): the expansion is now structured
    // (lib/arabic-search expandArabicSearch) and this condition ORs
    // FOUR new branch families, all bounded + escapeLikeTerm'd:
    //   - nameTerms (the R122 behavior — brand aliases + skeletons);
    //   - latinTerms: per-token Latin ILIKEs for MIXED-script queries
    //     only («netflix اشتراك» used to return nothing — the raw
    //     whole-string ILIKE can never match an English name once an
    //     Arabic word rides along);
    //   - compounds: brand ∧ modifier AND-branches («نتفلكس شهر» →
    //     name ILIKE %netflix% AND %month%, optionally AND %<digits>%
    //     for «نتفلكس ١٢ شهر») — the plan-level intent;
    //   - categories: `category = <slug>` equality for Arabic category
    //     words («افلام» → streaming) — no English name token means
    //     "movies", so the category IS the honest match;
    //   - variantTerms (R142 I-2): EXISTS-on-variant-label branches for
    //     Arabic duration tokens («شهر» → every product with a «شهر…»
    //     variant) — the live catalog's duration axis.
    // All branches stay inside the ≤500-row bounded list query.
    const likePatterns = [
      sql`${productsTable.name} ILIKE ${"%" + escapeLikeTerm(rawTerm) + "%"}`,
      ...[...expansion.nameTerms, ...expansion.latinTerms].map(
        (term) => sql`${productsTable.name} ILIKE ${"%" + escapeLikeTerm(term) + "%"}`,
      ),
      ...expansion.compounds.map((c) => compoundCondition(c)),
      ...expansion.variantTerms.map((token) => variantLabelExists(token)),
      ...expansion.categories.map((slug) => sql`LOWER(${productsTable.category}) = LOWER(${slug})`),
    ];
    const searchCondition = or(...likePatterns);
    // or() types as SQL | undefined; likePatterns always holds the raw
    // pattern, so the fallback is unreachable in practice.
    conditions.push(searchCondition ?? likePatterns[0]);
  }

  // Aggregate stock + order counts as a single subquery join, no JS-side reduce.
  // R102 (inventory truthfulness): stock counts DELIVERABLE units only
  // (≥1 credential field) — matches what checkout can actually sell.
  const stockSub = db
    .select({
      productId: inventoryTable.productId,
      stockCount: sql<number>`COUNT(*)::int`.as("stock_count"),
    })
    .from(inventoryTable)
    .where(and(eq(inventoryTable.isSold, false), deliverableUnitCondition()))
    .groupBy(inventoryTable.productId)
    .as("stock_sub");

  const orderSub = db
    .select({
      productId: ordersTable.productId,
      orderCount: sql<number>`COUNT(*)::int`.as("order_count"),
    })
    .from(ordersTable)
    .where(eq(ordersTable.status, "completed"))
    .groupBy(ordersTable.productId)
    .as("order_sub");

  const stockExpr = sql<number>`COALESCE(${stockSub.stockCount}, 0)`;
  const orderExpr = sql<number>`COALESCE(${orderSub.orderCount}, 0)`;

  if (available_only) {
    conditions.push(sql`COALESCE(${stockSub.stockCount}, 0) > 0`);
  }

  let query = db
    .select({
      id: productsTable.id,
      slug: productsTable.slug,
      name: productsTable.name,
      description: productsTable.description,
      imageUrl: productsTable.imageUrl,
      price: productsTable.price,
      category: productsTable.category,
      isActive: productsTable.isActive,
      usageTerms: productsTable.usageTerms,
      stockCount: stockExpr,
      orderCount: orderExpr,
    })
    .from(productsTable)
    .leftJoin(stockSub, eq(stockSub.productId, productsTable.id))
    .leftJoin(orderSub, eq(orderSub.productId, productsTable.id))
    .where(and(...conditions))
    // Hard ceiling — the storefront renders categories from this list;
    // 500 products is far beyond current catalog size but prevents an
    // unbounded scan if the catalog ever balloons.
    .limit(500)
    .$dynamic();

  // R143 (L4-4): explicit sorts carry a deterministic id tiebreaker —
  // price_asc/price_desc/popular were single-key ORDER BYs, so every tie
  // group (essentially the whole catalog for `popular`, where most
  // products have 0 completed orders) came back in planner order. The
  // default and relevance paths already carried id DESC (R132); the
  // tiebreaker is ordering-only, result sets unchanged.
  if (sort === "price_asc")
    query = query.orderBy(productsTable.price, sql`${productsTable.id} DESC`);
  else if (sort === "price_desc")
    query = query.orderBy(sql`${productsTable.price} DESC`, sql`${productsTable.id} DESC`);
  else if (sort === "popular")
    query = query.orderBy(sql`${orderExpr} DESC`, sql`${productsTable.id} DESC`);
  else if (hasSearch && expansion) {
    // R132 (exact-match-first ranking): with a search active and no
    // explicit sort, relevance — not insertion order — leads. Two
    // deterministic tiers over the SAME bounded branch set the WHERE
    // clause already computed:
    //   tier 0: the query's compound intent matched (brand ∧ modifier,
    //     e.g. «نتفلكس شهر» → a Netflix month plan);
    //   tier 1: the name STARTS with the query or an expanded term
    //     («netflix» → "Netflix Premium 1-Month" — prefix beats mere
    //     containment);
    //   tier 2: everything else (OR-recall breadth).
    // Within a tier, id DESC keeps the previous default order stable,
    // so pure-English queries see at most a promotion of prefix
    // matches — never a shuffle. Result SETS are unchanged (ordering
    // only); search stays uncacheable (B6-02), so no cached-order
    // staleness exists.
    const prefixTerms = [rawTerm, ...expansion.nameTerms, ...expansion.latinTerms];
    const compoundTier = or(...expansion.compounds.map((c) => compoundCondition(c)));
    const prefixTier = or(
      ...prefixTerms.map((term) => sql`${productsTable.name} ILIKE ${escapeLikeTerm(term) + "%"}`),
    );
    query = query.orderBy(
      sql`CASE WHEN ${compoundTier ?? sql`false`} THEN 0 WHEN ${prefixTier ?? sql`false`} THEN 1 ELSE 2 END`,
      sql`${productsTable.id} DESC`,
    );
  } else query = query.orderBy(sql`${productsTable.id} DESC`);

  const [rows, flashSale] = await Promise.all([query, getActiveFlashSale()]);
  const discountPercent = flashSale ? parseFloat(String(flashSale.discount_percent)) : 0;

  // Variants ride a single follow-up query for the whole page of
  // products (see loadPublicVariants) — kept OUT of the main join so
  // the limit(500) product ceiling stays exact and the hot list query
  // shape is unchanged for variant-less catalogs.
  const variantsByProduct = await loadPublicVariants(
    rows.map((p) => p.id),
    discountPercent,
  );

  const products = rows.map((p) => {
    const basePrice = parseFloat(String(p.price));
    const stockCount = Number(p.stockCount ?? 0);
    const variants = variantsByProduct.get(p.id) ?? [];
    // "تبدأ من" semantics: when variants exist, the card price is the
    // cheapest variant's LYD price — the import maintains
    // products.price = MIN(variants.price_lyd) so both agree. The flash
    // sale is applied exactly ONCE on that base (per-variant sale prices
    // are already computed by loadPublicVariants and stay authoritative
    // for the detail page selector).
    // R130 (A7-F1): "cheapest" is now availability-aware — the cheapest
    // BUYABLE variant, falling back to the drained-min when the product
    // is sold out (see displayBaseFromVariants).
    const displayBase = displayBaseFromVariants(variants, basePrice);
    const displayPrice =
      discountPercent > 0 ? computeFlashSalePrice(displayBase, discountPercent) : displayBase;
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      image_url: p.imageUrl,
      price: displayBase,
      price_from: variants.length > 1,
      category: p.category,
      is_active: p.isActive,
      // usage_terms moved into the full-projection spread (A2-F3) —
      // no grid consumer reads it.
      stock_count: stockCount,
      is_available: stockCount > 0,
      sale_price: discountPercent > 0 ? displayPrice : null,
      discount_percent: discountPercent > 0 ? discountPercent : null,
      order_count: Number(p.orderCount ?? 0),
      // A2-F3 (R124): variant_count ships in BOTH projections so the
      // grid's count badge has a single data source. description also
      // rides both (R1 review P1-1 — ProductCard renders it at ≥sm).
      // The full-projection-only fields are usage_terms + the variant
      // tree (62.6% of the wire bytes, measured live) — the detail
      // pages use those. price already equals MIN(variants.price) by
      // the import invariant, so the "تبدأ من" card renders
      // identically.
      variant_count: variants.length,
      ...(listView
        ? {}
        : {
            usage_terms: p.usageTerms,
            variants: variants.map((v) => ({
              id: v.id,
              plan_label: v.plan_label,
              duration_label: v.duration_label,
              label: v.label,
              price: v.price,
              sale_price: v.sale_price,
              discount_percent: v.discount_percent,
              is_available: v.is_available,
            })),
          }),
    };
  });

  return products;
}

// ── Detail / recommendation cached loaders ───────────────────────────────
// R136 (BE-3 extraction): the three withCatalogCache loader bodies moved
// verbatim from the /by-slug/:slug, /:id and /:id/recommendations handlers
// in routes/products.ts. The routes keep the param guards, the cache
// wrapper calls and the response mapping; only the address changed.

/**
 * Product detail by slug — the /api/products/by-slug/:slug cached loader.
 */
export async function loadProductDetailBySlug(slug: string) {
  // F-1 (R118-A6): 3 sequential DB stages → 2. Stage 1: product row by
  // slug + flash sale (independent). Stage 2: everything keyed off the
  // RESOLVED product id — stock count, completed count, and the
  // variant pool — in one Promise.all (the variant queries only need
  // the id; the flash-sale discount is applied in JS afterwards, never
  // in SQL, so it doesn't sequence the variant fetch). Sale-price
  // arithmetic stays routed through computeFlashSalePrice (lib/pricing
  // single source — routes/products.ts previously carried a 4th copy of
  // the formula), now inside the shared buildProductDetailDto.
  const [[product], flashSale] = await Promise.all([
    db
      .select()
      .from(productsTable)
      .where(
        and(
          eq(productsTable.slug, slug),
          // 110-F (R110 — 109-n P3): the detail routes filtered only
          // is_archived, so a deactivated product (is_active=false)
          // stayed fetchable by slug while the list route/sitemap
          // already hid it. Mirror the list WHERE — deactivated now
          // 404s exactly like archived (same for the /:id route below).
          eq(productsTable.isActive, true),
          eq(productsTable.isArchived, false),
        ),
      )
      .limit(1),
    getActiveFlashSale(),
  ]);

  if (!product) return { found: false as const };

  const [variantPool, [stockResult], [orderResult]] = await Promise.all([
    fetchVariantPoolData([product.id]),
    db
      .select({ count: count() })
      .from(inventoryTable)
      .where(
        and(
          eq(inventoryTable.productId, product.id),
          eq(inventoryTable.isSold, false),
          deliverableUnitCondition(),
        ),
      ),
    db
      .select({ count: count() })
      .from(ordersTable)
      .where(and(eq(ordersTable.productId, product.id), eq(ordersTable.status, "completed"))),
  ]);

  return {
    found: true as const,
    dto: buildProductDetailDto(
      product,
      flashSale,
      Number(stockResult?.count ?? 0),
      Number(orderResult?.count ?? 0),
      variantPool,
    ),
  };
}

/**
 * Product detail by id — the /api/products/:id cached loader.
 */
export async function loadProductDetailById(id: number) {
  // F-1 (R118-A6): 3 sequential DB stages → 1. The id is known upfront
  // here, so the product row, the flash sale, the stock count, the
  // completed count, and the variant pool (rows + two-pool stock
  // group-by) all ride ONE Promise.all — the ~100 ms app→Neon RTT is
  // paid once instead of three times (the R118 census measured +310 ms
  // per detail cache-miss, ≈ 3 stages × RTT). The flash-sale discount
  // is applied to the variants in JS (buildProductDetailDto), never in
  // SQL, so nothing had to sequence. /by-slug above keeps 2 stages —
  // its variant/stock queries need the id resolved from the slug.
  //
  // Trade-off (deliberate): on the 404 path these queries now return
  // empty instead of being skipped — 4 extra empty scans per miss,
  // sub-millisecond each, in exchange for one RTT on every hit.
  const [[product], flashSale, variantPool, [stockResult], [orderResult]] = await Promise.all([
    db
      .select()
      .from(productsTable)
      .where(
        and(
          eq(productsTable.id, id),
          // 110-F (R110): deactivated 404s like archived — see /by-slug.
          eq(productsTable.isActive, true),
          eq(productsTable.isArchived, false),
        ),
      )
      .limit(1),
    getActiveFlashSale(),
    fetchVariantPoolData([id]),
    db
      .select({ count: count() })
      .from(inventoryTable)
      .where(
        and(
          eq(inventoryTable.productId, id),
          eq(inventoryTable.isSold, false),
          deliverableUnitCondition(),
        ),
      ),
    db
      .select({ count: count() })
      .from(ordersTable)
      .where(and(eq(ordersTable.productId, id), eq(ordersTable.status, "completed"))),
  ]);

  if (!product) return { found: false as const };

  return {
    found: true as const,
    dto: buildProductDetailDto(
      product,
      flashSale,
      Number(stockResult?.count ?? 0),
      Number(orderResult?.count ?? 0),
      variantPool,
    ),
  };
}

/**
 * Same-category recommendations — the /api/products/:id/recommendations
 * cached loader.
 */
export async function loadProductRecommendations(id: number) {
  const [product] = await db
    .select({ category: productsTable.category })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.id, id),
        // R143 (L4-5): the 110-F visibility mirror — the lookup stage is
        // the one public product surface without it: archived/deactivated
        // ids answered 200 + live peers while every sibling detail route
        // 404s (catalog-security pins those). The peers query below
        // already filters; the anchor product must obey the same rule.
        eq(productsTable.isActive, true),
        eq(productsTable.isArchived, false),
      ),
    )
    .limit(1);

  if (!product) return { found: false as const };

  // R120-B6/A6-F15: products.category is NULLABLE — a product with no
  // category has no same-category peers. Early-return the empty
  // recommendations array (the exact shape the recommendation select
  // would produce) instead of leaning on SQL's `= NULL` never-true
  // comparison, which the old `as string` cast silently papered over
  // at the type level.
  if (product.category === null) {
    return { found: true as const, items: [] };
  }

  const recommendations = await db
    .select({
      id: productsTable.id,
      // R122 (A1-P2): slug in the recommendations DTO — the frontend
      // rail links /product/<slug ?? id>; the id-only link forced a
      // numeric-URL navigation (then replaceState'd to the slug) for
      // every recommended product. Same nullable contract as every
      // other product surface (slug is present post-backfill).
      slug: productsTable.slug,
      name: productsTable.name,
      imageUrl: productsTable.imageUrl,
      price: productsTable.price,
    })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.category, product.category),
        eq(productsTable.isActive, true),
        eq(productsTable.isArchived, false),
        sql`${productsTable.id} != ${id}`,
      ),
    )
    .limit(4);

  return {
    found: true as const,
    items: recommendations.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      image_url: r.imageUrl,
      price: parseFloat(String(r.price)),
    })),
  };
}
