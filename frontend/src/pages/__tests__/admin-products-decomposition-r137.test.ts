/**
 * R137 (FE) — the admin/products.tsx decomposition contract.
 *
 * The catalog admin page was a 1,649-line single component (13 useState
 * atoms, the create/update/delete mutations, both bulk loops, the
 * summarizeBulk accounting, the nine-field editor, the memoized
 * R124-I5 card, the row-local stock editor and every toolbar inline in
 * one function) — the r136 wallet/checkout precedent applied here:
 * orchestration (pages/admin/products.tsx) + eight verbatim extracts
 * under components/admin/products/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the SEO-touched
 * submit contract, the mid-loop 401 guards) is already pinned by the
 * admin/__tests__ products suites (products-error-bulk /
 * products-seo-submit) + the R124-I5 memoization docblock; this file
 * guards the STRUCTURE so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,649 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (directly, or by its consumer extract for the nested atoms —
 *      a dropped import = a section silently vanished);
 *   3. CRUD ownership — handleSubmit, the three mutations, both bulk
 *      loops, archiveProduct and summarizeBulk stay IN the page: the
 *      destructive paths (one-way-door archive + the visibility
 *      toggles) must never drift into a presentational extract where
 *      a stale closure could archive the wrong rows;
 *   4. state ownership — all 13 cross-section atoms stay CENTRALIZED
 *      in the page; the extracts take values + callbacks only;
 *   5. purity — the vocabulary module is React-free.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/products.tsx");

/** The extracts the page imports directly. */
const DIRECT_EXTRACTS = [
  "@/components/admin/products/products-meta",
  "@/components/admin/products/BulkActionBar",
  "@/components/admin/products/ProductEditorCard",
  "@/components/admin/products/ProductsGrid",
  "@/components/admin/products/ProductsHeader",
  "@/components/admin/products/ProductsToolbar",
];

/** Every presentational .tsx extract (the state-pin sweep — InlineStockEdit
 * is swept separately: it is the row-local editor, the r135 CopyField
 * class of self-contained subcomponent, not a re-declared page atom). */
const TSX_EXTRACTS = [
  "BulkActionBar",
  "ProductCard",
  "ProductEditorCard",
  "ProductsGrid",
  "ProductsHeader",
  "ProductsToolbar",
];

describe("R137 (FE) — admin/products.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/products.tsx stays under the 1,000-line ceiling (was 1,649 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    for (const specifier of DIRECT_EXTRACTS) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the nested atoms are still imported by their consumers (ProductCard + InlineStockEdit + the meta maps)", () => {
    // ProductCard (and its InlineStockEdit) render inside ProductsGrid,
    // not the page — the deletion guard for them lives at the
    // CONSUMER's import (the wallet LedgerEntryRow idiom).
    const grid = read("src/components/admin/products/ProductsGrid.tsx");
    expect(grid).toContain('from "@/components/admin/products/ProductCard"');
    const card = read("src/components/admin/products/ProductCard.tsx");
    expect(card).toContain('from "@/components/admin/products/InlineStockEdit"');
    // The card's category fallback tile rides the meta module's map.
    expect(card).toContain('from "@/components/admin/products/products-meta"');
    // The editor shell + the toolbar + the header ride the meta vocabulary.
    const editor = read("src/components/admin/products/ProductEditorCard.tsx");
    expect(editor).toContain('from "@/components/admin/products/products-meta"');
    const toolbar = read("src/components/admin/products/ProductsToolbar.tsx");
    expect(toolbar).toContain('from "@/components/admin/products/products-meta"');
    const header = read("src/components/admin/products/ProductsHeader.tsx");
    expect(header).toContain('from "@/components/admin/products/products-meta"');
  });

  it("the CRUD/bulk handlers stay IN the page (the extracts render; the page owns the writes)", () => {
    // handleSubmit carries the R123/R125-I3 SEO-touched submit contract
    // (send / explicit-null-clear / omit); the three mutations + both
    // bulk loops + summarizeBulk own every products write path — none
    // of it may drift into a presentational extract where a stale
    // closure could archive the wrong rows or skip the touched flags.
    expect(page).toContain("const handleSubmit = (e: React.FormEvent) => {");
    expect(page).toContain("const createMutation = useCreateProduct({");
    expect(page).toContain("const updateMutation = useUpdateProduct({");
    expect(page).toContain("const deleteMutation = useDeleteProduct({");
    expect(page).toContain("const bulkDelete = async () => {");
    expect(page).toContain("const bulkToggleActive = async (active: boolean) => {");
    expect(page).toContain("const archiveProduct = useCallback(");
    // R124-I5: the memoized cards' stable callbacks are minted here.
    expect(page).toContain("const startEdit = useCallback((product: AdminProduct) => {");
    expect(page).toContain("const stockEditDone = useCallback(() => {");
    // R126-L3 (A4-B-2): the stats co-invalidation every write path
    // funnels through — one owner, in the page.
    expect(page).toContain("const invalidate = useCallback(() => {");
    expect(page).toContain('queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });');
    // 94-C2 (A2 P2-8): the honest bulk accounting stays beside its loops.
    expect(page).toContain("const summarizeBulk = (");
    // 98-F7 (R98-05): the dirty guard arms on the PAGE's form vs baseline.
    expect(page).toContain("useDirtyGuard(editorDirty);");
    // The one-way-door confirm copy (R115 honesty) is page-owned.
    expect(page).toContain('title: "أرشفة المنتجات المحددة؟"');
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the editor, the bulk bar, the toolbar and the grid all
    // key off the same atoms — the 98-F7 baseline pair and the R123
    // touched flags span three of them (form/baseline/seoTouched).
    for (const atom of [
      "const [showForm, setShowForm] = useState(false);",
      "const [editingId, setEditingId] = useState<number | null>(null);",
      "const [form, setForm] = useState({ ...EMPTY_FORM });",
      "const [formBaseline, setFormBaseline] = useState({ ...EMPTY_FORM });",
      "const [seoTouched, setSeoTouched] = useState({ title: false, description: false });",
      "const [inventoryDialogProduct, setInventoryDialogProduct] = useState<{",
      "const [variantsDialogProduct, setVariantsDialogProduct] = useState<{",
      "const [search, setSearch] = useState(",
      "const [debouncedSearch, setDebouncedSearch] = useState(search);",
      'const [categoryFilter, setCategoryFilter] = useState("");',
      "const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());",
      "const [editingStockId, setEditingStockId] = useState<number | null>(null);",
      "const [bulkProcessing, setBulkProcessing] = useState(false);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
    // The form stays page-owned: the editor extract receives the setter
    // as a bare onFormChange callback, never a local copy of the truth.
    expect(page).toContain("onFormChange={setForm}");
    expect(page).toContain("onSeoTouchedChange={setSeoTouched}");
  });

  it("the moved catalog markup rides along verbatim (Arabic/RTL copy at its new address)", () => {
    // The render suites read the page ∪ extracts union; these spot-pins
    // keep the verbatim shapes at their new addresses so the union pins
    // stay meaningful.
    const header = read("src/components/admin/products/ProductsHeader.tsx");
    expect(header).toContain("نتائج البحث:");
    expect(header).toContain("في الكتالوج");
    expect(header).toContain("منتج جديد");
    const editor = read("src/components/admin/products/ProductEditorCard.tsx");
    expect(editor).toContain('id="product-form"');
    expect(editor).toContain("حفظ التعديلات");
    expect(editor).toContain("عنوان SEO (اختياري)");
    const card = read("src/components/admin/products/ProductCard.tsx");
    expect(card).toContain("بلا باقات");
    expect(card).toContain("نفد المخزون");
    const toolbar = read("src/components/admin/products/ProductsToolbar.tsx");
    expect(toolbar).toContain("بحث في المنتجات…");
    expect(toolbar).toContain("تحديد الكل");
    const bulk = read("src/components/admin/products/BulkActionBar.tsx");
    expect(bulk).toContain("منتج محدد");
    expect(bulk).toContain("جارٍ…");
    const grid = read("src/components/admin/products/ProductsGrid.tsx");
    expect(grid).toContain("تعذّر تحديث قائمة المنتجات");
    expect(grid).toContain("لا توجد منتجات");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a section needs is passed DOWN,
    // so no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the catalog admin page is how the R127-B2
    // select-all class of desync bugs happens.
    for (const name of TSX_EXTRACTS) {
      const src = read(`src/components/admin/products/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("InlineStockEdit keeps exactly its two row-local editor atoms (the r135 CopyField class — never page truth)", () => {
    // The row-local stock editor moved verbatim as a self-contained
    // subcomponent: its val/saving pair is EPHEMERAL (seeded from the
    // current prop, torn down with the editor), never cross-section
    // page truth — the page owns which row is editing (editingStockId)
    // and the co-invalidation (stockEditDone). The bar: exactly two
    // atoms, both local; never a selection/form/dialog atom.
    const src = read("src/components/admin/products/InlineStockEdit.tsx");
    expect(src.match(/useState\(/g) ?? []).toHaveLength(2);
    expect(src).toContain("const [val, setVal] = useState(String(current));");
    expect(src).toContain("const [saving, setSaving] = useState(false);");
    for (const pageAtom of ["showForm", "selectedIds", "categoryFilter", "bulkProcessing"]) {
      expect(src, pageAtom).not.toContain(pageAtom);
    }
    // The R115 absolute-SET POST rides along byte-identically.
    expect(src).toContain(
      "await adminFetchJson(`/api/admin/products/${productId}/inventory/set-count`, {",
    );
  });

  it("the vocabulary module is React-free (pure catalog metadata — importable by any lane)", () => {
    const meta = read("src/components/admin/products/products-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The 98-F7/R123 SEO-caps form seed + the R120-B4 honest-count cap.
    expect(meta).toContain("export const EMPTY_FORM = {");
    expect(meta).toContain("export const PRODUCTS_SERVER_CAP = 200;");
    // R146 (components audit F2): the category tables derive from
    // lib/category-registry's rows — INITIAL_COLOR composes the registry's
    // accent atoms (bg/10 + text); the two option lists map its rows.
    expect(meta).toContain(
      "export const CATEGORY_INITIAL_COLOR: Record<string, string> = categoryLookup(",
    );
    expect(meta).toContain("export const CATEGORY_OPTIONS = [");
    expect(meta).toContain("export const CATEGORY_FILTERS = [");
    expect(meta).toContain("export const PRODUCT_COUNT_FORMS = {");
  });
});
