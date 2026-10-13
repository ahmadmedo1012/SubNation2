/**
 * R137 (FE, closing) — the ProductVariantsDialog decomposition contract.
 *
 * The per-product variant manager was a 795-line single component (the
 * form atoms, three mutations, the confirm-gated delete, the toolbar,
 * the add/edit form panel and the variant rows all inline in one
 * function) — deliberately skipped in Wave 1 (out of 1-c's page scope)
 * and split here as the round's closing move, alongside the product.tsx
 * re-tightening, so NO frontend source file exceeds the 1,000-line
 * ceiling.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally):
 *
 *   1. size ceiling — the dialog stays an orchestration + shell core
 *      (it was 795 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the dialog
 *      (a dropped import = a section silently vanished);
 *   3. mutation ownership — the three mutations (create/update/delete),
 *      the useConfirm-gated delete and the dialog-local form atoms stay
 *      IN the dialog (the GlobalSearch self-contained-feature precedent:
 *      the feature's truth lives in one place, extracts render);
 *   4. purity — the extracts are stateless presentational units and the
 *      helpers module is React-free (importable by any lane);
 *   5. public API — pages/admin/products.tsx keeps importing the exact
 *      named export (the wave-1 products decomposition's contract
 *      depends on it).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const dialog = read("src/components/admin/ProductVariantsDialog.tsx");

describe("R137 (FE, closing) — ProductVariantsDialog decomposition: the feature keeps one truth owner", () => {
  it("ProductVariantsDialog.tsx stays under the 500-line ceiling (was 795 at decomposition)", () => {
    const lines = dialog.split("\n").length;
    expect(lines).toBeLessThan(500);
  });

  it("the dialog imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/product-variants/variants-meta",
      "@/components/admin/product-variants/VariantsToolbar",
      "@/components/admin/product-variants/VariantFormPanel",
      "@/components/admin/product-variants/VariantRows",
    ];
    for (const specifier of extracts) {
      expect(dialog, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the three mutations + the confirm-gated delete + the form atoms stay IN the dialog (the extracts render; the dialog owns the writes)", () => {
    // The feature's write paths: create/update/delete mutations, the
    // useConfirm gate on the destructive arm, and the dialog-local form
    // atoms (showForm/editingId/form/formError) — one truth owner.
    expect(dialog).toContain("const createMutation = useCreateProductVariant({");
    expect(dialog).toContain("const updateMutation = useUpdateProductVariant({");
    expect(dialog).toContain("const deleteMutation = useDeleteProductVariant({");
    expect(dialog).toContain("const { confirm, ConfirmDialog } = useConfirm();");
    expect(dialog).toContain("const [showForm, setShowForm] = useState(false);");
    expect(dialog).toContain("const [editingId, setEditingId] = useState<number | null>(null);");
    expect(dialog).toContain("const [form, setForm] = useState({ ...EMPTY_FORM });");
    expect(dialog).toContain("const [formError, setFormError] = useState<string | null>(null);");
  });

  it("the public API is unchanged — pages/admin/products.tsx imports the exact named export", () => {
    expect(dialog).toContain("export function ProductVariantsDialog({");
    const productsPage = read("src/pages/admin/products.tsx");
    expect(productsPage).toContain('from "@/components/admin/ProductVariantsDialog"');
  });
});

describe("R137 (FE, closing) — the variants extracts are self-contained presentational units", () => {
  it("no extract re-declares feature state (values + callbacks only — no duplicated truth)", () => {
    const files = ["VariantsToolbar", "VariantFormPanel", "VariantRows"];
    for (const name of files) {
      const src = read(`src/components/admin/product-variants/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the variants helpers module is React-free (pure formatters/validators/body builders — importable by any lane)", () => {
    const meta = read("src/components/admin/product-variants/variants-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The submit validator + the PATCH/POST body builders — the shapes
    // the mutations ride (spot-pinned so a silent rename can't orphan
    // the dialog's write paths).
    expect(meta).toContain("export function validateVariantForm(");
    expect(meta).toContain("export function variantSubmitBodies(");
    expect(meta).toContain("export const EMPTY_FORM = {");
  });
});
