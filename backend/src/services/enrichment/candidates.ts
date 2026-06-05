/**
 * Eligibility query for the enrichment runner
 * (012-arabic-catalog-enrichment, T011).
 *
 * Returns the (product_id, field_name) pairs the cron should draft for
 * the next run. Honors:
 *   - active + non-archived only (FR-DRAFT-004)
 *   - missing description_long → eligible
 *   - thin description (< 50 chars after trim) → eligible (FR-SAFETY-004)
 *   - missing or empty FAQ → eligible
 *   - already-drafted (state='drafted') for the same product+field → skip
 *   - rejected within the last 14 days for the same product+field → skip
 *
 * Single batched query per the perf budget (research §R-10).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { DraftField } from "./draft-store";

export interface CandidateRow {
  productId: number;
  fieldName: DraftField;
  productName: string;
  category: string | null;
  currentDescription: string | null;
  currentDescriptionLong: string | null;
  currentFaq: Array<{ question: string; answer: string }> | null;
  currentUsageTerms: string | null;
}

interface SkipCounts {
  alreadyDrafted: number;
  recentlyRejected: number;
  noEligibleField: number;
}

export interface CandidateResult {
  candidates: CandidateRow[];
  skipped: SkipCounts;
}

const REJECTION_SUPPRESSION_DAYS = 14;

export async function selectCandidates(perRunCap: number): Promise<CandidateResult> {
  // Pull eligible products + their draft history. We filter archived /
  // inactive at the SQL layer (FR-DRAFT-004) so the JS pass below only
  // sees products worth iterating — at 10k products this matters.
  const result = await db.execute(sql`
    SELECT
      p.id, p.name, p.category, p.description, p.description_long, p.faq, p.usage_terms,
      p.is_archived, p.is_active,
      COALESCE(
        json_agg(
          json_build_object(
            'field_name', d.field_name,
            'state', d.state,
            'rejected_at', d.rejected_at
          )
        ) FILTER (WHERE d.id IS NOT NULL),
        '[]'::json
      ) AS drafts
    FROM products p
    LEFT JOIN enrichment_drafts d ON d.product_id = p.id
    WHERE p.is_archived = false AND p.is_active = true
    GROUP BY p.id
    ORDER BY p.id
  `);
  type RawProduct = {
    id: number;
    name: string;
    category: string | null;
    description: string | null;
    description_long: string | null;
    faq: Array<{ question: string; answer: string }> | null;
    usage_terms: string | null;
    is_archived: boolean;
    is_active: boolean;
    drafts: Array<{
      field_name: string;
      state: string;
      rejected_at: string | null;
    }>;
  };
  const r = result as unknown as { rows?: RawProduct[] } | RawProduct[];
  const rows = Array.isArray(r) ? r : (r.rows ?? []);

  const skipped: SkipCounts = {
    alreadyDrafted: 0,
    recentlyRejected: 0,
    noEligibleField: 0,
  };
  const candidates: CandidateRow[] = [];
  const cutoff = Date.now() - REJECTION_SUPPRESSION_DAYS * 86_400_000;

  for (const p of rows) {
    // archived/inactive are filtered SQL-side; we no longer count them
    // in skipped because they never reach the JS pass. The query's
    // WHERE is the source of truth for FR-DRAFT-004.

    // Suppression set: any (field) that has a `drafted` row OR a
    // `rejected` row newer than cutoff.
    const blocked = new Set<string>();
    let hadAlreadyDrafted = false;
    let hadRecentlyRejected = false;
    for (const d of p.drafts ?? []) {
      if (d.state === "drafted") {
        blocked.add(d.field_name);
        hadAlreadyDrafted = true;
      } else if (d.state === "rejected" && d.rejected_at) {
        if (new Date(d.rejected_at).getTime() >= cutoff) {
          blocked.add(d.field_name);
          hadRecentlyRejected = true;
        }
      }
    }

    const description = (p.description ?? "").trim();
    const descriptionLong = (p.description_long ?? "").trim();
    const faqEmpty = !Array.isArray(p.faq) || p.faq.length === 0;

    const eligible: DraftField[] = [];
    if (!blocked.has("description") && description.length > 0 && description.length < 50) {
      // Thin description — FR-SAFETY-004 leaves substantive descriptions alone.
      eligible.push("description");
    }
    if (!blocked.has("description_long") && descriptionLong.length === 0) {
      eligible.push("description_long");
    }
    if (!blocked.has("faq") && faqEmpty) {
      eligible.push("faq");
    }

    if (eligible.length === 0) {
      if (hadAlreadyDrafted) skipped.alreadyDrafted++;
      else if (hadRecentlyRejected) skipped.recentlyRejected++;
      else skipped.noEligibleField++;
      continue;
    }

    for (const field of eligible) {
      candidates.push({
        productId: p.id,
        fieldName: field,
        productName: p.name,
        category: p.category,
        currentDescription: p.description,
        currentDescriptionLong: p.description_long,
        currentFaq: p.faq,
        currentUsageTerms: p.usage_terms,
      });
      if (candidates.length >= perRunCap) {
        return { candidates, skipped };
      }
    }
  }

  return { candidates, skipped };
}
