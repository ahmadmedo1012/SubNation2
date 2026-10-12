/**
 * R136 (FE-3) — the home.tsx decomposition contract.
 *
 * The storefront home page was a 1,369-line single component (hero
 * trio + stats widgets + filter bar + results grid + trust strip in
 * one function). R136 split it into orchestration
 * (pages/home.tsx) + ten verbatim extracts under components/home/,
 * mirroring the R135 product.tsx precedent.
 *
 * These are SOURCE-scan pins (the product-decomposition-r135 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the R134 disclosure/listbox
 * a11y markup, the R127 tap floors, the URL-mirror lifecycle) is
 * already pinned by the four home-* render suites
 * (home-filters-url, home-search-history-a11y,
 * home-recovery-targets-r127, home-secondary-widgets); this file
 * guards the STRUCTURE so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,369 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported (a dropped
 *      import = the section silently vanished);
 *   3. state ownership — the filter quartet + its setters, the
 *      commitSearch/debounce lifecycle, every query and every memo
 *      stay CENTRALIZED in the page (the R98-04 URL mirror and the
 *      R120-B1 available-first re-order both hinge on one owner);
 *   4. no extract re-declares the page-level filter state — the
 *      extracts take values + callbacks only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/home.tsx");

describe("R136 (FE-3) — home.tsx decomposition: page stays an orchestration core", () => {
  it("pages/home.tsx stays under the 700-line ceiling (was 1,369 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(700);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/home/AuthedHero",
      "@/components/home/CatalogFiltersBar",
      "@/components/home/GuestHero",
      "@/components/home/ProductsGrid",
      "@/components/home/RecentOrdersStrip",
      "@/components/home/StatsWidgets",
      "@/components/home/TrustFooter",
      "@/components/home/catalog-filters",
      "@/components/home/search-history",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the primitives leaf stays imported by its consumers (no page call site — the R135 CopyField precedent)", () => {
    // ProductSkeleton renders the grid's loading state and
    // OrderStatusIcon the orders strip's rows — the page itself has no
    // call site for either, so the deletion guard rides the sibling
    // extracts that import them.
    for (const consumer of ["ProductsGrid", "RecentOrdersStrip"]) {
      const src = read(`src/components/home/${consumer}.tsx`);
      expect(src, consumer).toContain('from "@/components/home/primitives"');
    }
  });

  it("the filter quartet + its setters stay IN the page (values + callbacks flow down)", () => {
    // One owner: the R98-04 URL mirror, the products query params and
    // clearFilters all key off the same quartet — a duplicated atom in
    // an extract would desync the querystring from the chips.
    for (const atom of [
      "const [searchInput, setSearchInput] = useState(initialFilters.searchInput);",
      "const [search, setSearch] = useState(initialFilters.search);",
      "const [category, setCategory] = useState(initialFilters.category);",
      "const [sort, setSort] = useState(initialFilters.sort);",
      "const [availableOnly, setAvailableOnly] = useState(initialFilters.availableOnly);",
    ]) {
      expect(page, atom).toContain(atom);
    }
  });

  it("the search commit + debounce lifecycle stay in the page (the R94-A1 #16 single-owner contract)", () => {
    // commitSearch is the ONLY path that writes search history; the
    // debounce ref it races (Enter clears it before committing) must
    // live beside it, never inside a presentational extract where a
    // stale closure could resurrect a superseded debounce.
    expect(page).toContain("const commitSearch = (val: string) => {");
    expect(page).toContain("saveSearchHistory(query);");
    expect(page).toContain("const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);");
  });

  it("every query + every memo stays in the page (no extract re-fetches or re-derives)", () => {
    for (const hook of ["useListProducts(", "useGetCatalogStats(", "useGetMe(", "useListOrders("]) {
      expect(page, hook).toContain(hook);
    }
    // The memos the extracts consume as props: the R120-B1
    // available-first re-order, the R122 stock map and the chip order.
    expect(page).toContain("const displayProducts = useMemo(");
    expect(page).toContain("const categoryHasStock = useMemo<Set<string> | null>(() => {");
    expect(page).toContain("const heroBrands = useMemo(");
    // And the R98-04 URL mirror + the A2-F3 clear-all — page-owned
    // orchestration the whole catalog hangs off.
    expect(page).toContain("window.history.replaceState(");
    expect(page).toContain("const clearFilters = () => {");
  });
});

describe("R136 (FE-3) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares the page-level filter state (they take values + callbacks only)", () => {
    const files = [
      "AuthedHero",
      "CatalogFiltersBar",
      "GuestHero",
      "ProductsGrid",
      "RecentOrdersStrip",
      "StatsWidgets",
      "TrustFooter",
    ];
    for (const name of files) {
      const src = read(`src/components/home/${name}.tsx`);
      expect(src, name).not.toMatch(/const \[(search|searchInput|category|sort|availableOnly), set/);
    }
  });

  it("the pure modules are React-free (data + functions — importable by any lane)", () => {
    // catalog-filters carries the lucide icon REFERENCES the chips
    // render (data, not JSX) — the pin is the absence of react itself.
    const tables = read("src/components/home/catalog-filters.ts");
    expect(tables).not.toMatch(/from "react"/);
    expect(tables).toContain("export const CATEGORIES = [");
    expect(tables).toContain("export const SORTS = [");
    expect(tables).toContain("export const BRANDS");
    expect(tables).toContain("export function readInitialFiltersFromUrl()");

    // search-history is pure localStorage — the a11y render pin's
    // fixture key rides this exact constant.
    const history = read("src/components/home/search-history.ts");
    expect(history).not.toMatch(/from "react"|from "lucide-react"/);
    expect(history).toContain('const SEARCH_HISTORY_KEY = "subnation_search_history";');
  });
});
