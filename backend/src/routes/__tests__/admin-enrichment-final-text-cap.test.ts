import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  enrichmentDraftsTable,
  enrichmentRunsTable,
  initTestDb,
  execTestSql,
  productsTable,
  resetTestDb,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminEnrichmentRouter } from "../admin/enrichment";

/**
 * R120-B6/A6-F12 — enrichment `final_text` override cap.
 *
 * The publish route accepted ANY non-empty `final_text` (up to the 1 MB
 * body limit) and publish.ts lands it verbatim in
 * products.description/description_long — PUBLIC catalog surfaces. This
 * suite pins the 16,000-char-after-trim cap:
 *   - over the cap (before OR after trim) → 400 + draft stays `drafted`
 *     + the product row is untouched (guard fires BEFORE publishDraft);
 *   - the cap measures the TRIMMED text (publish.ts trims before
 *     persisting — surrounding whitespace must not hide extra chars).
 *
 * The at-cap boundary passthrough (guard passes, service receives the
 * raw text) is pinned in the sibling file
 * admin-enrichment-final-text-cap-passthrough.test.ts with a mocked
 * publish service — publishDraft's state-guard heuristic cannot see
 * pglite's affectedRows (pre-existing, service-level), so a real-service
 * boundary publish cannot be asserted under this harness.
 *
 * Enrichment tables are not part of the shared pglite harness DDL — they
 * are created per-file via execTestSql (risk-scoring/coupons-referrals
 * pattern).
 */

// Mirrors shared/db/src/schema/enrichment_runs.ts + enrichment_drafts.ts
// (column set the publish path touches; CHECKs included so an illegal
// fixture fails loudly instead of passing silently).
const ENRICHMENT_DDL = `
CREATE TABLE enrichment_runs (
  id serial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  outcome varchar(20) NOT NULL DEFAULT 'in_flight',
  drafts_generated integer NOT NULL DEFAULT 0,
  drafts_invalid integer NOT NULL DEFAULT 0,
  products_skipped jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens_spent integer NOT NULL DEFAULT 0,
  daily_token_cap integer NOT NULL DEFAULT 0,
  cap_reached boolean NOT NULL DEFAULT false,
  worker_tier varchar(50),
  failure_reason text
);
CREATE TABLE enrichment_drafts (
  id serial PRIMARY KEY,
  run_id integer NOT NULL REFERENCES enrichment_runs(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field_name varchar(50) NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'drafted',
  generated_text text NOT NULL,
  final_text text,
  model_id varchar(64) NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by integer REFERENCES admin_users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejected_by integer REFERENCES admin_users(id) ON DELETE SET NULL,
  rejection_reason text,
  validation_errors jsonb,
  CONSTRAINT chk_enrichment_state CHECK (state IN ('drafted','published','rejected','draft_invalid')),
  CONSTRAINT chk_enrichment_field CHECK (field_name IN ('description','description_long','faq')),
  CONSTRAINT chk_enrichment_published_consistency CHECK ((state = 'published') = (published_at IS NOT NULL)),
  CONSTRAINT chk_enrichment_rejected_consistency CHECK ((state = 'rejected') = (rejected_at IS NOT NULL))
);
`;

const CAP = 16_000;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminEnrichmentRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

async function seedDraftFixture(): Promise<{ draftId: number; token: string }> {
  const [admin] = await db
    .insert(adminUsersTable)
    .values({ username: "enrich_admin", passwordHash: "x", isActive: true })
    .returning();
  const [product] = await db
    .insert(productsTable)
    .values({
      name: "Cap Fixture Product",
      slug: "cap-fixture-product",
      description: "الوصف الأصلي",
      imageUrl: "https://cdn.example.com/cap.webp",
      price: "49.00",
      category: "streaming",
      isActive: true,
    })
    .returning();
  const [run] = await db.insert(enrichmentRunsTable).values({}).returning();
  const [draft] = await db
    .insert(enrichmentDraftsTable)
    .values({
      runId: run.id,
      productId: product.id,
      fieldName: "description",
      state: "drafted",
      generatedText: "نص مولّد قصير",
      modelId: "test-model",
      inputTokens: 10,
      outputTokens: 10,
    })
    .returning();
  return { draftId: draft.id, token: signAdminToken({ adminId: admin.id, role: "admin" }) };
}

async function postPublish(
  url: string,
  token: string,
  draftId: number,
  finalText: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/admin/enrichment/${draftId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `admin_token=${token}` },
    body: JSON.stringify({ final_text: finalText }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(ENRICHMENT_DDL);
});

beforeEach(async () => {
  // resetTestDb truncates products/admin_users — the CASCADE reaches the
  // enrichment tables through their FKs, but the explicit delete keeps the
  // isolation obvious and cascade-semantics-independent.
  await resetTestDb();
  await db.delete(enrichmentDraftsTable);
  await db.delete(enrichmentRunsTable);
});

describe("admin enrichment publish — final_text cap (R120-B6/A6-F12)", () => {
  it("final_text over the cap → 400, draft stays drafted, product untouched", async () => {
    const { draftId, token } = await seedDraftFixture();
    const { url, close } = await listen(buildApp());
    try {
      const res = await postPublish(url, token, draftId, "أ".repeat(CAP + 1));
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });

      // No publish side effects: draft still drafted, product description
      // unchanged (the guard fires BEFORE publishDraft runs).
      const [draft] = await db
        .select()
        .from(enrichmentDraftsTable)
        .where(eq(enrichmentDraftsTable.id, draftId));
      expect(draft.state).toBe("drafted");
      expect(draft.finalText).toBeNull();
      const [product] = await db.select().from(productsTable).limit(1);
      expect(product.description).toBe("الوصف الأصلي");
    } finally {
      close();
    }
  });

  it("whitespace-padded over-cap text still refused — the cap measures the TRIMMED text", async () => {
    const { draftId, token } = await seedDraftFixture();
    const { url, close } = await listen(buildApp());
    try {
      // 16,000 + leading/trailing whitespace trims to 16,001 → over.
      const res = await postPublish(url, token, draftId, `  ${"x".repeat(CAP)}  y `);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      const [draft] = await db
        .select()
        .from(enrichmentDraftsTable)
        .where(eq(enrichmentDraftsTable.id, draftId));
      expect(draft.state).toBe("drafted");
    } finally {
      close();
    }
  });
});
