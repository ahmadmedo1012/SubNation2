/**
 * R139 (agent 139-f, precision) — the catalog-operations visual pins.
 *
 * The r138 designer-lens family (storefront) extended onto the ADMIN
 * catalog surfaces this round: products.tsx + its components/admin/
 * products/* extracts, ProductVariantsDialog + product-variants/*,
 * InventoryUploadDialog and enrichment.tsx. These are SOURCE-scan pins
 * (the r128-sweep / r137-contract idiom — invariants a render test
 * only covers incidentally) over the five family idioms that landed:
 *
 *   1. calm active pill — bg-primary/15 + text-primary-text +
 *      border-primary/30 + font-bold, BOTH states carrying the border
 *      box (the category chip bar left its segmented tray);
 *   2. selected-state tint — border-primary/30 + bg-primary/5, no
 *      ring / colored shadow (the calm dialect; elevation belongs to
 *      the neutral hover step alone);
 *   3. the shelf — image thumbs bg-muted/60 + border-border/40 (the
 *      cart-thumbnail / EmptyState well family);
 *   4. receipt rhythm — the variants dialog's expected-price preview
 *      rides a /20 hairline + weight/size emphasis, not a primary box;
 *   5. quiet tables — border-border/60 containers + font-semibold
 *      header rows (bg-muted/30), the resting family everywhere.
 *
 * Aria/handler/DOM-structure surfaces are byte-identical this round
 * (the r137 decomposition contracts stay the ceiling) — the pins below
 * are class-level only, so a future drift fails HERE with the exact
 * vocabulary that regressed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

const toolbar = read("src/components/admin/products/ProductsToolbar.tsx");
const header = read("src/components/admin/products/ProductsHeader.tsx");
const card = read("src/components/admin/products/ProductCard.tsx");
const editor = read("src/components/admin/products/ProductEditorCard.tsx");
const formPanel = read("src/components/admin/product-variants/VariantFormPanel.tsx");
const rows = read("src/components/admin/product-variants/VariantRows.tsx");
const upload = read("src/components/admin/InventoryUploadDialog.tsx");
const enrichment = read("src/pages/admin/enrichment.tsx");

describe("R139 (139-f) — the calm pill dialect on the catalog filters", () => {
  it("the category chips ride the family active pill (tint + /30 border + bold, both states boxed)", () => {
    // R139: the segmented shell (bg-secondary/40 tray + borderless
    // resting chip + bg-card active tile) is gone; aria-pressed is
    // byte-identical (R124-C2).
    expect(toolbar).toContain('"bg-primary/15 text-primary-text border-primary/30 font-bold"');
    expect(toolbar).toContain(
      '"bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"',
    );
    expect(toolbar).toContain("aria-pressed={categoryFilter === c.value}");
    expect(toolbar).not.toContain("bg-secondary/40");
    expect(toolbar).not.toContain("bg-card shadow-sm");
  });

  it("the header CTA carries no colored shadow (the primary fill is the emphasis)", () => {
    // R139: shadow-md shadow-primary/20 dropped — brand-tinted shadows
    // read as glow on .light (the r138 retirement).
    expect(header).not.toContain("shadow-primary");
    expect(header).toContain("bg-primary hover:bg-primary/90 h-9");
  });
});

describe("R139 (139-f) — the catalog card: calm selected tint + the shelf rhyme", () => {
  it("the selected state is border-primary/30 + bg-primary/5 — no ring, no colored shadow", () => {
    expect(card).toContain('"border-primary/30 bg-primary/5"');
    expect(card).not.toContain("ring-primary");
    expect(card).not.toContain("shadow-primary");
  });

  it("the product thumb is a bg-muted/60 shelf well on border-border/40", () => {
    // R139: bg-muted (the card's own tone — sub-perceptual as a well)
    // → bg-muted/60, matching the storefront ProductCard/cart thumbs;
    // the onError fallback literal rides the same tone.
    expect(card).toContain("border border-border/40 ${");
    expect(card).toContain('?? "bg-muted/60")');
    expect(card).toContain(': "bg-muted/60"');
    expect(card).not.toContain('?? "bg-muted"');
  });

  it("the variant-count badge consolidates on the /30 static-badge border", () => {
    // R140 central re-anchor: text-primary → text-primary-text (140-i
    // F2/F2′ — the badge is 11px small text; raw --primary measured
    // 3.44:1 dark / 4.13:1 light on the /10 tint, the ink token clears
    // AA on both). Same box, same border, same register — ink only.
    expect(card).toContain("bg-primary/10 text-primary-text border-primary/30");
    expect(card).not.toContain("border-primary/25");
  });

  it("the editor shell rides the resting border family + the two-layer calm elevation", () => {
    // R139: border-primary/20 + shadow-lg shadow-primary/5 (brand
    // border AND brand glow) → border-border/60 + neutral two-layer.
    expect(editor).toContain(
      "border border-border/60 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]",
    );
    expect(editor).not.toContain("shadow-primary");
    // The image-preview well rhymes with the catalog thumb shelf.
    expect(editor).toContain("border border-border/40 bg-muted/60 overflow-hidden");
  });
});

describe("R139 (139-f) — the variants dialog: receipt preview + quiet table", () => {
  it("the expected-price preview rides the receipt register (/20 rule, weight+size — no primary box)", () => {
    expect(formPanel).toContain("border-t border-border/20 pt-2.5");
    expect(formPanel).toContain('className="text-xs font-bold tabular-nums"');
    expect(formPanel).not.toContain("bg-primary/8");
    // The panel edge joins the resting family.
    expect(formPanel).toContain("bg-muted/15 border border-border/60 rounded-xl p-4");
  });

  it("the variant table: border-border/60 container + font-semibold quiet header row", () => {
    expect(rows).toContain("bg-card border border-border/60 rounded-xl");
    expect(rows).not.toContain("border-border/55");
    expect(rows.match(/font-semibold px-2 py-1\.5/g) ?? []).toHaveLength(8);
    expect(rows).not.toContain("font-bold px-2 py-1.5");
    // Money columns keep tabular-nums (verified, unchanged).
    expect(rows).toContain("tabular-nums font-mono");
    expect(rows).toContain("font-bold tabular-nums");
  });
});

describe("R139 (139-f) — inventory upload + enrichment queues", () => {
  it("the upload preview table matches the quiet register; the dashed dropzone affordance stays", () => {
    expect(upload).toContain("bg-card border border-border/60 rounded-xl");
    expect(upload).not.toContain("border-border/55");
    expect(upload.match(/font-semibold px-2 py-1\.5/g) ?? []).toHaveLength(4);
    expect(upload).toContain("border-2 border-dashed");
    expect(upload).toContain('"border-primary bg-primary/5" : "border-border/60 bg-background/40"');
  });

  it("the enrichment queue card is solid on the resting border, chip boxed, well muted", () => {
    expect(enrichment).toContain('"border border-border/60 rounded-2xl bg-card overflow-hidden"');
    expect(enrichment).not.toContain("bg-card/60");
    expect(enrichment).not.toContain("bg-background/60");
    // R140 central re-anchor: text-primary → text-primary-text (140-i
    // F2′ — the chip missed light-theme AA by 0.01–0.37 on the /10 fill;
    // the ink token clears it on both themes). Byte-rest identical.
    expect(enrichment).toContain(
      "text-primary-text bg-primary/10 border border-primary/30 px-2 py-0.5 rounded-full",
    );
    expect(enrichment).toContain("bg-muted/60 border border-border/40 rounded-xl p-3");
  });
});
