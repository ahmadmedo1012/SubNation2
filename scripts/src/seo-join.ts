/**
 * Deterministic target resolution for the SEO importer (R162-B).
 *
 * The importer's documented join is "slug first, exact product_name
 * fallback" — but the previous single `or(eq(slug), eq(name)).limit(1)`
 * query implemented NO priority: when the slug matched row X while the
 * name matched a different row Y (`name` has no unique constraint, so
 * the fallback can even match several rows), Postgres returned an
 * arbitrary row and the import target depended on scan order. Sequencing
 * the two lookups — slug first, name only when the slug matched nothing —
 * plus an id ordering on the name lookup makes the join deterministic.
 * `products.slug` carries idx_products_slug_unique, so the slug branch
 * can match at most one row; the ordering only pins the name branch.
 */

export type SeoTargetPredicate = { by: "slug"; slug: string } | { by: "name"; name: string };

export async function resolveSeoTarget<T>(
  find: (predicate: SeoTargetPredicate) => Promise<T | undefined>,
  slug: string | null | undefined,
  productName: string,
): Promise<T | undefined> {
  const normalizedSlug = (slug ?? "").trim().toLowerCase();
  if (normalizedSlug) {
    const bySlug = await find({ by: "slug", slug: normalizedSlug });
    if (bySlug) return bySlug;
  }
  return find({ by: "name", name: productName });
}
