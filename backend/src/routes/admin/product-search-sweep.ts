/**
 * R161-D (Lane D + coordinator): the admin product-list search sweep,
 * extracted from routes/admin/products.ts when the R161 Arabic-expansion
 * parity pushed the parent past its growth-banned tripwire (990 > 967 —
 * the products-field-limits.ts precedent, same lift pattern).
 *
 * WHY THIS EXISTS (the R161-D defect): the admin sweep was a raw
 * lowercase ILIKE over English names + English category slugs — an
 * operator who thinks in Arabic typed «نتفلكس» and found NOTHING to
 * edit or restock. This module ORs the same bounded Arabic expansion
 * the PUBLIC catalog route rides (catalog.service.ts) beside the raw
 * condition: name ILIKEs for nameTerms (brand aliases + skeletons) and
 * latinTerms (mixed script), category equality for categories.
 * compounds and variantTerms are DELIBERATELY skipped — they feed the
 * public route's relevance-ranking tiers, and the admin list has its
 * own client-side sort; an operator needs recall, not tiers. The
 * expansion is capped (≤8 tokens, ≤4 latin terms, ≤3 categories) and
 * empty for pure-English queries, so the bounded-query contract holds
 * and pure-English SQL stays byte-identical (the R122 invariant).
 */
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { productsTable } from "@workspace/db";
import { escapeLikeTerm } from "../../lib/http";
import { expandArabicSearch } from "../../lib/arabic-search";

/**
 * The full WHERE fragment for the admin product list's ?search= sweep.
 * Returns the `eq(isArchived, false)` resting condition when the search
 * is absent/blank — the route composes the result directly into
 * .where(), so both branches stay in one place.
 *
 * V4 lineage: the admin command palette sends ?search=; match name or
 * category, case-insensitive, capped at 100 chars. R134 (A1-F2):
 * escapeLikeTerm — the AUD103-3-F4 idiom every sibling admin search
 * carries; a "%"/"_" in the palette acts as a literal, not a wildcard.
 * Round-3 (8-c §4.7): the raw name branch stays ILIKE (not LOWER LIKE)
 * so the trigram GIN index on products.name actually serves it. R161-D:
 * the raw branch stays FIRST in the OR — byte-identical for English.
 */
export function adminProductSearchWhere(search: unknown): SQL {
  const searchRaw = typeof search === "string" ? search.trim() : "";
  if (searchRaw.length === 0) return eq(productsTable.isArchived, false) as SQL;
  const searchLike = `%${escapeLikeTerm(searchRaw.toLowerCase().slice(0, 100))}%`;
  const expansion = expandArabicSearch(searchRaw);
  // The "!" is honest: likePatterns-style, the raw branch is always
  // present, so or() never returns undefined here.
  return and(
    eq(productsTable.isArchived, false),
    or(
      sql`(${productsTable.name} ILIKE ${searchLike} OR LOWER(${productsTable.category}) LIKE ${searchLike})`,
      ...[...expansion.nameTerms, ...expansion.latinTerms].map(
        (term) => sql`${productsTable.name} ILIKE ${"%" + escapeLikeTerm(term) + "%"}`,
      ),
      ...expansion.categories.map((slug) => sql`LOWER(${productsTable.category}) = LOWER(${slug})`),
    )!,
  ) as SQL;
}
