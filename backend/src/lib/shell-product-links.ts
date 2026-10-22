import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import { withCatalogCache } from "./catalog-cache";

/**
 * R183 (RH-266): product links for the crawler shell.
 *
 * The shell used to carry only category/support links, so every product
 * page was an orphan in raw HTML. Query the same public-active catalog
 * predicate the storefront uses, cache it with the catalog generation,
 * and keep the list small (12) so the shell stays light.
 */
export interface ShellProductLink {
  slug: string;
  name: string;
}

export async function listShellProductLinks(
  category: string | null,
  excludeSlug?: string | null,
): Promise<ShellProductLink[]> {
  const key = `${category ?? "all"}:${excludeSlug ?? "-"}`;
  return withCatalogCache("spa-shell-links", key, 60, async () => {
    const where = [
      eq(productsTable.isActive, true),
      eq(productsTable.isArchived, false),
      isNotNull(productsTable.slug),
    ];
    if (category) where.push(eq(productsTable.category, category));
    if (excludeSlug) where.push(ne(productsTable.slug, excludeSlug));

    const rows = await db
      .select({ slug: productsTable.slug, name: productsTable.name })
      .from(productsTable)
      .where(and(...where))
      .orderBy(asc(productsTable.id))
      .limit(12);

    return rows.flatMap((row) => (row.slug ? [{ slug: row.slug, name: row.name }] : []));
  });
}
