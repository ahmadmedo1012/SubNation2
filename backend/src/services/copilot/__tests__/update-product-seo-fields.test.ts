import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, initTestDb, productsTable, resetTestDb } from "../../../test/db";
import { UPDATE_PRODUCT_ALLOWED_FIELDS, updateProduct } from "../admin-direct";
import { draftCatalogEdit, runDraftTool } from "../tools/draft";
import { CATALOG_LOW_RISK_FIELDS } from "../validator";

/**
 * R122 (A7-P2 + A4-P2-3) — the copilot can maintain the operator SEO
 * overrides. products.seo_title / seo_description were write-orphaned
 * (read on every product surface, writable by NOBODY — the A4 dead-
 * columns finding); the HTTP admin perimeter got them in the same round
 * (admin-product-seo-fields.test.ts), and this file pins the copilot's
 * three field lists so the AI assistant can set them too:
 *
 *   - update_product's ALLOWED_FIELDS (super-admin direct-execute);
 *   - the update_product tool spec the model sees (maxLength-capped);
 *   - draft_catalog_edit's CATALOG_LOW_RISK_FIELDS (preview/confirm
 *     flow) + its tool spec + the validator accepting a real seo edit
 *     and still refusing a hallucinated field.
 */

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

async function seedProduct(): Promise<number> {
  const [row] = await db
    .insert(productsTable)
    .values({
      name: "Netflix Premium",
      slug: "copilot-seo-target",
      price: "63.84",
      category: "streaming",
    })
    .returning({ id: productsTable.id });
  return row.id;
}

/** The fields.properties map of a tool spec's `fields` argument. */
function fieldsProperties(tool: {
  spec: { function: { parameters: Record<string, unknown> } };
}): Record<string, { type?: string; maxLength?: number }> {
  const parameters = tool.spec.function.parameters as unknown as {
    properties: { fields: { properties: Record<string, { type?: string; maxLength?: number }> } };
  };
  return parameters.properties.fields.properties;
}

describe("copilot seo-field wiring (R122 A7-P2 + A4-P2-3)", () => {
  it("update_product's ALLOWED_FIELDS includes seoTitle + seoDescription (direct-execute accepts them)", () => {
    expect(UPDATE_PRODUCT_ALLOWED_FIELDS.has("seoTitle")).toBe(true);
    expect(UPDATE_PRODUCT_ALLOWED_FIELDS.has("seoDescription")).toBe(true);
    // A hallucinated NEIGHBOR spelling is still refused (the set is
    // exact-match, not prefix).
    expect(UPDATE_PRODUCT_ALLOWED_FIELDS.has("seoTitleAr")).toBe(false);
  });

  it("the update_product tool spec exposes both fields with the column caps (200/320) the model must respect", () => {
    const props = fieldsProperties(updateProduct);
    expect(props.seoTitle).toMatchObject({ type: "string", maxLength: 200 });
    expect(props.seoDescription).toMatchObject({ type: "string", maxLength: 320 });
  });

  it("draft_catalog_edit's CATALOG_LOW_RISK_FIELDS includes both (the preview/confirm flow can propose them)", () => {
    expect(CATALOG_LOW_RISK_FIELDS.has("seoTitle")).toBe(true);
    expect(CATALOG_LOW_RISK_FIELDS.has("seoDescription")).toBe(true);
  });

  it("the draft_catalog_edit tool spec exposes both fields with the column caps", () => {
    const props = fieldsProperties(draftCatalogEdit);
    expect(props.seoTitle).toMatchObject({ type: "string", maxLength: 200 });
    expect(props.seoDescription).toMatchObject({ type: "string", maxLength: 320 });
  });

  it("runDraftTool accepts a seoTitle/seoDescription edit on a real product (no HALLUCINATED_FIELD refusal)", async () => {
    const id = await seedProduct();
    const result = await runDraftTool(
      "draft_catalog_edit",
      {
        id,
        fields: {
          seoTitle: "Netflix — اشتراك أصلي بالدينار الليبي | SubNation",
          seoDescription: "اشتراك Netflix Premium أصلي بالدينار الليبي مع تسليم فوري بعد الدفع.",
        },
      },
      ["all"],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changedFields = result.value.changes.map((c) => c.field).sort();
    expect(changedFields).toEqual(["seoDescription", "seoTitle"]);
    // before: NULL (write-orphaned until this round); after: the proposal.
    const title = result.value.changes.find((c) => c.field === "seoTitle");
    expect(title?.before).toBeNull();
    expect(title?.after).toBe("Netflix — اشتراك أصلي بالدينار الليبي | SubNation");
  });

  it("a hallucinated field is STILL refused alongside the new ones (the guard did not over-open)", async () => {
    const id = await seedProduct();
    const result = await runDraftTool(
      "draft_catalog_edit",
      { id, fields: { seoTitle: "X", notARealField: "Y" } },
      ["all"],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("COPILOT_HALLUCINATED_FIELD");
    expect(result.message).toContain("notARealField");
    expect(result.message).toContain("seoTitle"); // listed as allowed
  });
});
