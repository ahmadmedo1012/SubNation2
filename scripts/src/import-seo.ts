/**
 * Import SEO content (description_long + faq) from docs/SEO_PRODUCTS.json
 * into productsTable.
 *
 * Safety:
 *   - Matches by exact `product_name` against productsTable.name. Skips any
 *     product whose name is not found, instead of inventing one.
 *   - Only writes `descriptionLong` and `faq`. Never touches name, price,
 *     slug, isActive, isArchived, costPrice, etc.
 *   - Wraps every UPDATE in a single transaction. Any failure rolls back
 *     the whole batch — partial state is impossible.
 *   - Dry-run by default. Pass `--apply` (or `IMPORT_SEO_APPLY=true`) to
 *     actually write.
 *   - Does NOT overwrite a non-empty existing descriptionLong / faq unless
 *     `--force` is passed. By default skips the field with a "kept" log.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx ./src/import-seo.ts            # dry run
 *   pnpm --filter @workspace/scripts exec tsx ./src/import-seo.ts --apply    # write
 *   pnpm --filter @workspace/scripts exec tsx ./src/import-seo.ts --apply --force  # overwrite
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
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
        keepDesc: boolean;
        keepFaq: boolean;
      };

  const plans: Plan[] = [];

  for (const entry of entries) {
    const [row] = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        descriptionLong: productsTable.descriptionLong,
        faq: productsTable.faq,
        isArchived: productsTable.isArchived,
      })
      .from(productsTable)
      .where(eq(productsTable.name, entry.product_name))
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
    plans.push({
      kind: "update",
      entry,
      productId: row.id,
      willWriteDesc: !hasDesc || FORCE,
      willWriteFaq: !hasFaq || FORCE,
      keepDesc: hasDesc && !FORCE,
      keepFaq: hasFaq && !FORCE,
    });
  }

  // Print plan
  for (const p of plans) {
    if (p.kind === "missing") {
      console.log(`⚠️  SKIP   "${p.entry.product_name}" — no row in productsTable`);
    } else if (p.kind === "archived") {
      console.log(
        `⚠️  SKIP   "${p.entry.product_name}" (id=${p.productId}) — product is archived`,
      );
    } else {
      const parts: string[] = [];
      parts.push(p.willWriteDesc ? "desc✓" : "desc·kept");
      parts.push(p.willWriteFaq ? "faq✓" : "faq·kept");
      console.log(
        `✅ APPLY  "${p.entry.product_name}" (id=${p.productId}) — ${parts.join(" ")}`,
      );
    }
  }

  const writes = plans.filter((p): p is Extract<Plan, { kind: "update" }> => p.kind === "update");
  const willWrite = writes.filter((p) => p.willWriteDesc || p.willWriteFaq);

  console.log(
    `\n📊 ${plans.length} entries → ${writes.length} matched, ` +
      `${plans.length - writes.length} skipped, ` +
      `${willWrite.length} will be written.`,
  );

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
      const patch: { descriptionLong?: string; faq?: SeoFaq[] } = {};
      if (p.willWriteDesc) patch.descriptionLong = p.entry.description_long;
      if (p.willWriteFaq) patch.faq = p.entry.faq;

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
