/**
 * Enrichment drafts CRUD (012-arabic-catalog-enrichment, T010).
 *
 * Reads + writes against `enrichment_drafts`. The state-machine guards
 * (research §R-7) live here so application code calls the named
 * helpers (markPublished / markRejected / markInvalid) instead of
 * issuing raw UPDATEs.
 */

import { db, enrichmentDraftsTable, enrichmentRunsTable, productsTable } from "@workspace/db";
import { and, desc, eq, lt, sql } from "drizzle-orm";

export type DraftState = "drafted" | "published" | "rejected" | "draft_invalid";
export type DraftField = "description" | "description_long" | "faq";

export interface InsertDraftInput {
  runId: number;
  productId: number;
  fieldName: DraftField;
  generatedText: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  state: DraftState;
  validationErrors?: Record<string, unknown> | null;
}

export async function insertDraft(input: InsertDraftInput): Promise<{ id: number }> {
  const [row] = await db
    .insert(enrichmentDraftsTable)
    .values({
      runId: input.runId,
      productId: input.productId,
      fieldName: input.fieldName,
      state: input.state,
      generatedText: input.generatedText,
      modelId: input.modelId,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      validationErrors: input.validationErrors ?? null,
    })
    .returning({ id: enrichmentDraftsTable.id });
  if (!row) throw new Error("insertDraft: insert returned no row");
  return { id: row.id };
}

export interface DraftRow {
  id: number;
  productId: number;
  productName: string;
  productImageUrl: string | null;
  fieldName: DraftField;
  state: DraftState;
  generatedText: string;
  finalText: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
  publishedAt: Date | null;
  rejectedAt: Date | null;
}

/**
 * Listing query for the panel. Paginated via opaque cursor on
 * (created_at, id). Filter by state (default 'drafted').
 */
export async function listByState(args: {
  state: DraftState;
  limit: number;
  cursor: string | null;
}): Promise<{ rows: DraftRow[]; nextCursor: string | null }> {
  const conditions = [eq(enrichmentDraftsTable.state, args.state)];
  if (args.cursor) {
    const sep = args.cursor.lastIndexOf(":");
    const iso = sep > 0 ? args.cursor.slice(0, sep) : "";
    const id = Number.parseInt(args.cursor.slice(sep + 1), 10);
    const cursorDate = new Date(iso);
    if (!Number.isNaN(cursorDate.getTime()) && Number.isFinite(id)) {
      // (created_at, id) DESC pagination — strict-less-than on created_at
      // OR equal-and-id-less.
      conditions.push(
        sql`(${enrichmentDraftsTable.createdAt}, ${enrichmentDraftsTable.id}) < (${cursorDate}, ${id})`,
      );
    }
  }
  const rows = await db
    .select({
      id: enrichmentDraftsTable.id,
      productId: enrichmentDraftsTable.productId,
      productName: productsTable.name,
      productImageUrl: productsTable.imageUrl,
      fieldName: enrichmentDraftsTable.fieldName,
      state: enrichmentDraftsTable.state,
      generatedText: enrichmentDraftsTable.generatedText,
      finalText: enrichmentDraftsTable.finalText,
      modelId: enrichmentDraftsTable.modelId,
      inputTokens: enrichmentDraftsTable.inputTokens,
      outputTokens: enrichmentDraftsTable.outputTokens,
      createdAt: enrichmentDraftsTable.createdAt,
      publishedAt: enrichmentDraftsTable.publishedAt,
      rejectedAt: enrichmentDraftsTable.rejectedAt,
    })
    .from(enrichmentDraftsTable)
    .innerJoin(productsTable, eq(productsTable.id, enrichmentDraftsTable.productId))
    .where(and(...conditions))
    .orderBy(desc(enrichmentDraftsTable.createdAt), desc(enrichmentDraftsTable.id))
    .limit(args.limit + 1);

  const hasMore = rows.length > args.limit;
  const page = hasMore ? rows.slice(0, args.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}:${last.id}` : null;
  return {
    rows: page.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      productImageUrl: r.productImageUrl,
      fieldName: r.fieldName as DraftField,
      state: r.state as DraftState,
      generatedText: r.generatedText,
      finalText: r.finalText,
      modelId: r.modelId,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      createdAt: r.createdAt,
      publishedAt: r.publishedAt,
      rejectedAt: r.rejectedAt,
    })),
    nextCursor,
  };
}

export async function pendingCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(enrichmentDraftsTable)
    .where(eq(enrichmentDraftsTable.state, "drafted"));
  return Number(row?.n ?? 0);
}

export async function getById(id: number): Promise<DraftRow | null> {
  const [row] = await db
    .select({
      id: enrichmentDraftsTable.id,
      productId: enrichmentDraftsTable.productId,
      productName: productsTable.name,
      productImageUrl: productsTable.imageUrl,
      fieldName: enrichmentDraftsTable.fieldName,
      state: enrichmentDraftsTable.state,
      generatedText: enrichmentDraftsTable.generatedText,
      finalText: enrichmentDraftsTable.finalText,
      modelId: enrichmentDraftsTable.modelId,
      inputTokens: enrichmentDraftsTable.inputTokens,
      outputTokens: enrichmentDraftsTable.outputTokens,
      createdAt: enrichmentDraftsTable.createdAt,
      publishedAt: enrichmentDraftsTable.publishedAt,
      rejectedAt: enrichmentDraftsTable.rejectedAt,
    })
    .from(enrichmentDraftsTable)
    .innerJoin(productsTable, eq(productsTable.id, enrichmentDraftsTable.productId))
    .where(eq(enrichmentDraftsTable.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    productImageUrl: row.productImageUrl,
    fieldName: row.fieldName as DraftField,
    state: row.state as DraftState,
    generatedText: row.generatedText,
    finalText: row.finalText,
    modelId: row.modelId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    rejectedAt: row.rejectedAt,
  };
}

/**
 * Mark `published` only when current state is `drafted`. Returns the
 * row count actually updated; 0 means a state guard failed (race or
 * stale request) and the caller should return 409.
 */
export async function markPublished(args: {
  id: number;
  adminId: number;
  finalText: string;
}): Promise<number> {
  const result = await db
    .update(enrichmentDraftsTable)
    .set({
      state: "published",
      finalText: args.finalText,
      publishedAt: new Date(),
      publishedBy: args.adminId,
    })
    .where(and(eq(enrichmentDraftsTable.id, args.id), eq(enrichmentDraftsTable.state, "drafted")));
  return (
    (result as unknown as { rowCount?: number }).rowCount ??
    (result as unknown as Array<unknown>).length ??
    0
  );
}

export async function markRejected(args: {
  id: number;
  adminId: number;
  reason: string | null;
}): Promise<number> {
  const result = await db
    .update(enrichmentDraftsTable)
    .set({
      state: "rejected",
      rejectedAt: new Date(),
      rejectedBy: args.adminId,
      rejectionReason: args.reason,
    })
    .where(and(eq(enrichmentDraftsTable.id, args.id), eq(enrichmentDraftsTable.state, "drafted")));
  return (
    (result as unknown as { rowCount?: number }).rowCount ??
    (result as unknown as Array<unknown>).length ??
    0
  );
}

/** Used by the orchestrator only; never from the panel. */
export async function markInvalid(args: {
  runId: number;
  productId: number;
  fieldName: DraftField;
  generatedText: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  validationErrors: Record<string, unknown>;
}): Promise<number> {
  const [row] = await db
    .insert(enrichmentDraftsTable)
    .values({
      runId: args.runId,
      productId: args.productId,
      fieldName: args.fieldName,
      state: "draft_invalid",
      generatedText: args.generatedText,
      modelId: args.modelId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      validationErrors: args.validationErrors,
    })
    .returning({ id: enrichmentDraftsTable.id });
  return row?.id ?? 0;
}

void enrichmentRunsTable;
void lt;
