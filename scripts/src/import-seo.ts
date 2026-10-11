/**
 * Import SEO content (description_long + faq + seo_title +
 * meta_description) from docs/SEO_PRODUCTS.json into productsTable.
 *
 * Safety:
 *   - Matches each entry by `slug` first (the canonical, stable identity —
 *     display names drift with marketing renames), falling back to an
 *     exact `product_name` match. Skips any entry that matches neither,
 *     instead of inventing one. Skipped entries WARN with counts
 *     (110-F, R110) — a stale file must never shrink the import silently.
 *   - Only writes the SEO surface: descriptionLong, faq, seoTitle,
 *     seoDescription. Never touches name, price, slug, isActive,
 *     isArchived, costPrice, etc.
 *   - Wraps every UPDATE in a single transaction. Any failure rolls back
 *     the whole batch — partial state is impossible.
 *   - Dry-run by default. Pass `--apply` (or `IMPORT_SEO_APPLY=true`) to
 *     actually write.
 *   - Does NOT overwrite a non-empty existing field unless `--force` is
 *     passed. By default skips the field with a "kept" log.
 *
 * R132 (L4-F1) — the seo_title/meta_description direction, measured:
 *   As of 2026-10-12 the LIVE DB carries operator-curated overrides for
 *   every mapped product that are NEWER than this JSON (they follow the
 *   site-wide «— اشتراك أصلي بالدينار الليبي | SubNation» title pattern;
 *   the JSON holds the older research copy). The keep-unless-force rule
 *   is therefore the load-bearing safety: a plain `--apply` can never
 *   regress the newer DB values — only an explicit `--force` push of a
 *   freshly curated JSON can. Refresh the JSON against the live catalog
 *   (the 4 flagship slugs — netflix-premium, disney-standard,
 *   amazon-prime-video, apple-tv — also want re-keying to their live
 *   slugs) before any --force run.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx ./src/import-seo.ts            # dry run
 *   pnpm --filter @workspace/scripts exec tsx ./src/import-seo.ts --apply    # write
 *   pnpm --filter @workspace/scripts exec tsx ./src/import-seo.ts --apply --force  # overwrite
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, or } from "drizzle-orm";
import { loadLocalEnv, repoRoot } from "./runtime";

loadLocalEnv();
const { db, pool, productsTable } = await import("@workspace/db");

interface SeoFaq {
  question: string;
  answer: string;
}

interface SeoEntry {
  product_name: string;
  slug: string;
  category: string;
  seo_title: string;
  meta_description: string;
  description_long: string;
  faq: SeoFaq[];
  // Other fields (keywords, intent, notes) are ignored by this importer —
  // they live in docs/SEO_PRODUCTS.json as the source of truth for editors.
}

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply") || process.env.IMPORT_SEO_APPLY === "true";
const FORCE = args.has("--force");

function isNonEmpty(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

function isNonEmptyFaq(f: unknown): boolean {
  return Array.isArray(f) && f.length > 0;
}

async function main(): Promise<void> {
  const jsonPath = path.join(repoRoot, "docs", "SEO_PRODUCTS.json");
  const raw = readFileSync(jsonPath, "utf8");
  const entries = JSON.parse(raw) as SeoEntry[];

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`No entries found in ${jsonPath}`);
  }

  // Validate the JSON shape up-front so we never enter a transaction with
  // half-broken data.
  for (const [i, e] of entries.entries()) {
    if (!isNonEmpty(e.product_name)) throw new Error(`entry[${i}] missing product_name`);
    if (!isNonEmpty(e.description_long))
      throw new Error(`entry[${i}] (${e.product_name}) missing description_long`);
    if (!isNonEmptyFaq(e.faq))
      throw new Error(`entry[${i}] (${e.product_name}) missing/empty faq array`);
    for (const [j, f] of e.faq.entries()) {
      if (!isNonEmpty(f.question) || !isNonEmpty(f.answer)) {
        throw new Error(`entry[${i}].faq[${j}] (${e.product_name}) is malformed`);
      }
    }
  }

  console.log(
    `\n🔎 Loaded ${entries.length} SEO packages from docs/SEO_PRODUCTS.json` +
      `\n   mode: ${APPLY ? "APPLY" : "DRY-RUN"}${FORCE ? " (force overwrite)" : ""}\n`,
  );

  // Pre-flight: look up each product by name, classify into update / skip.
  type Plan =
    | { kind: "missing"; entry: SeoEntry }
    | { kind: "archived"; entry: SeoEntry; productId: number }
    | {
        kind: "update";
        entry: SeoEntry;
        productId: number;
        willWriteDesc: boolean;
        willWriteFaq: boolean;
        willWriteTitle: boolean;
        willWriteMetaDesc: boolean;
        keepDesc: boolean;
        keepFaq: boolean;
        keepTitle: boolean;
        keepMetaDesc: boolean;
      };

  const plans: Plan[] = [];

  for (const entry of entries) {
    // 110-F (R110 — 109-n P3): slug-first join. The JSON's `slug` is the
    // canonical URL identity (stable across marketing renames of
    // product_name — the exact drift that made the old name-only match
    // silently skip half the file); the exact-name fallback keeps
    // hand-edited entries without a slug importable.
    const slug = (entry.slug ?? "").trim().toLowerCase();
    const [row] = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        descriptionLong: productsTable.descriptionLong,
        faq: productsTable.faq,
        seoTitle: productsTable.seoTitle,
        seoDescription: productsTable.seoDescription,
        isArchived: productsTable.isArchived,
      })
      .from(productsTable)
      .where(
        or(
          slug ? eq(productsTable.slug, slug) : undefined,
          eq(productsTable.name, entry.product_name),
        ),
      )
      .limit(1);

    if (!row) {
      plans.push({ kind: "missing", entry });
      continue;
    }
    if (row.isArchived) {
      plans.push({ kind: "archived", entry, productId: row.id });
      continue;
    }

    const hasDesc = isNonEmpty(row.descriptionLong);
    const hasFaq = isNonEmptyFaq(row.faq);
    const hasTitle = isNonEmpty(row.seoTitle);
    const hasMetaDesc = isNonEmpty(row.seoDescription);
    plans.push({
      kind: "update",
      entry,
      productId: row.id,
      willWriteDesc: !hasDesc || FORCE,
      willWriteFaq: !hasFaq || FORCE,
      willWriteTitle: !hasTitle || FORCE,
      willWriteMetaDesc: !hasMetaDesc || FORCE,
      keepDesc: hasDesc && !FORCE,
      keepFaq: hasFaq && !FORCE,
      keepTitle: hasTitle && !FORCE,
      keepMetaDesc: hasMetaDesc && !FORCE,
    });
  }

  // Print plan. Skips go to stderr as WARNINGS (110-F, R110) — they used
  // to be plain console.log lines that scrolled by like ordinary output.
  for (const p of plans) {
    if (p.kind === "missing") {
      console.warn(
        `⚠️  SKIP   "${p.entry.product_name}" — no product row matches slug "${p.entry.slug}" or the name`,
      );
    } else if (p.kind === "archived") {
      console.warn(
        `⚠️  SKIP   "${p.entry.product_name}" (id=${p.productId}) — product is archived`,
      );
    } else {
      const parts: string[] = [];
      parts.push(p.willWriteDesc ? "desc✓" : "desc·kept");
      parts.push(p.willWriteFaq ? "faq✓" : "faq·kept");
      parts.push(p.willWriteTitle ? "title✓" : "title·kept");
      parts.push(p.willWriteMetaDesc ? "metadesc✓" : "metadesc·kept");
      console.log(`✅ APPLY  "${p.entry.product_name}" (id=${p.productId}) — ${parts.join(" ")}`);
    }
  }

  const writes = plans.filter((p): p is Extract<Plan, { kind: "update" }> => p.kind === "update");
  const willWrite = writes.filter(
    (p) => p.willWriteDesc || p.willWriteFaq || p.willWriteTitle || p.willWriteMetaDesc,
  );
  const missingCount = plans.filter((p) => p.kind === "missing").length;
  const archivedCount = plans.filter((p) => p.kind === "archived").length;
  const skippedCount = missingCount + archivedCount;

  console.log(
    `\n📊 ${plans.length} entries → ${writes.length} matched, ` +
      `${skippedCount} skipped, ` +
      `${willWrite.length} will be written.`,
  );

  // 110-F (R110 — 109-n P3): the headline warning. A stale JSON (archived
  // or renamed products) used to shrink the import with no signal beyond
  // per-line logs — surface the counts on stderr so operators refresh
  // docs/SEO_PRODUCTS.json against the live catalog.
  if (skippedCount > 0) {
    console.warn(
      `⚠️  ${skippedCount}/${plans.length} SEO entries were skipped — ` +
        `${missingCount} matched no live product (stale product_name/slug?), ` +
        `${archivedCount} matched an archived product. ` +
        `Refresh docs/SEO_PRODUCTS.json against the active catalog.`,
    );
  }

  if (!APPLY) {
    console.log(`\nℹ️  Dry-run only. Re-run with --apply to write changes.\n`);
    return;
  }

  if (willWrite.length === 0) {
    console.log(`\n✅ Nothing to write. (Use --force to overwrite existing values.)\n`);
    return;
  }

  // Transactional write — all-or-nothing.
  await db.transaction(async (tx) => {
    for (const p of willWrite) {
      const patch: {
        descriptionLong?: string;
        faq?: SeoFaq[];
        seoTitle?: string;
        seoDescription?: string;
      } = {};
      if (p.willWriteDesc) patch.descriptionLong = p.entry.description_long;
      if (p.willWriteFaq) patch.faq = p.entry.faq;
      // R132 (L4-F1): the operator overrides join the same transactional
      // keep-unless-force channel (column caps 200/320 enforced upstream
      // by the admin zod; a curated JSON is expected to respect them).
      if (p.willWriteTitle) patch.seoTitle = p.entry.seo_title;
      if (p.willWriteMetaDesc) patch.seoDescription = p.entry.meta_description;

      await tx.update(productsTable).set(patch).where(eq(productsTable.id, p.productId));
    }
  });

  console.log(`\n✅ Wrote SEO content for ${willWrite.length} products in a single transaction.\n`);
}

try {
  await main();
} catch (err) {
  console.error("❌ Import failed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
