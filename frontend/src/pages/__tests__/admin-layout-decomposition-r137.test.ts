/**
 * R137 (FE) — the admin/layout.tsx decomposition contract.
 *
 * The admin SHELL was a 1,485-line single module (the whole sidebar nav,
 * the 477-line GlobalSearch palette, the nav route table and every pure
 * helper inline in one file) — the R136 checkout/home precedent applied
 * here: orchestration (pages/admin/layout.tsx) + seven verbatim extracts
 * under components/admin/layout/.
 *
 * PUBLIC API (the wave-critical constraint): layout.tsx is the shell
 * imported by EVERY admin page (`import { AdminLayout } from "./layout"`)
 * and by components/admin/AdminScopeGate.tsx, while 40+ suites
 * vi.mock("@/pages/admin/layout", () => ({ AdminLayout: ... })) at the
 * module boundary and two suites import NAV_SECTIONS directly
 * (admin-layout-nav-scope, admin-document-title). The module's public
 * surface — the named exports AdminLayout and NAV_SECTIONS, NOTHING
 * else, NO default export — must survive the decomposition unchanged;
 * NAV_SECTIONS now rides a verbatim re-export from its new address.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r135-r136
 * idiom — structural invariants a render test only covers incidentally).
 * The RENDER contract (byte-identical DOM, the drawer focus trap, the
 * palette a11y/race semantics, the badge pill states) is already pinned
 * by the admin-layout-* render suites + global-search.test.tsx; this
 * file guards the STRUCTURE so the decomposition cannot silently
 * regress:
 *
 *   1. size ceiling — the shell stays an orchestration core (it was
 *      1,485 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. public API pins — the same two export declarations still exist
 *      and no third export sneaks in;
 *   4. ownership pins — the coordinating state atoms (auth/session,
 *      sidebar/drawer/search), the badge queries with their scope
 *      guards, the alert poll and the focus refs stay IN the page;
 *   5. purity pins — the presentational extracts take values +
 *      callbacks only; the nav/focus modules are React-free;
 *   6. palette-pin preservation — admin-palette-tokens.test.ts reads
 *      THIS file's source for its AA ink-pair pins; the pinned markup
 *      (the collapsed-logo dot, the hamburger dot, the last-updated
 *      pulse dot) must stay in the page.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/layout.tsx");

describe("R137 (FE) — admin/layout.tsx decomposition: the shell stays an orchestration core", () => {
  it("pages/admin/layout.tsx stays under the 1,000-line ceiling (was 1,485 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract it renders (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/layout/GlobalSearch",
      "@/components/admin/layout/SearchTriggers",
      "@/components/admin/layout/SidebarNav",
      "@/components/admin/layout/focus-trap",
      "@/components/admin/layout/layout-nav",
      "@/components/admin/layout/nav-sections",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the NavItem leaf stays imported by its consumer (no page call site — the R136 home/primitives precedent)", () => {
    // SidebarNav renders the NavItem rows (and owns the nav table +
    // context-map lookups) — the page itself has no call site for
    // NavItem, so the deletion guard rides the sibling extract that
    // imports it (intra-folder relative imports — the checkout
    // CheckoutCta→./CouponCard idiom).
    const sidebarNav = read("src/components/admin/layout/SidebarNav.tsx");
    expect(sidebarNav).toContain('from "./NavItem"');
    expect(sidebarNav).toContain('from "./nav-sections"');
    expect(sidebarNav).toContain('from "./layout-nav"');
  });

  it("the PUBLIC API survives verbatim — AdminLayout + NAV_SECTIONS, nothing added, nothing lost", () => {
    // The two symbols every admin page, AdminScopeGate and 40+ mocked
    // suites depend on. AdminLayout keeps its exact declaration; the
    // nav table moved verbatim to nav-sections.ts and rides a re-export
    // so `import { NAV_SECTIONS } from "@/pages/admin/layout"` (the
    // nav-scope + document-title suites) still resolves.
    expect(page).toContain(
      "export function AdminLayout({ children, onRefresh, badges }: AdminLayoutProps)",
    );
    expect(page).toContain(
      'export { NAV_SECTIONS } from "@/components/admin/layout/nav-sections";',
    );
    // The exact export surface: two statements, no default export, no
    // third symbol sneaking onto the module boundary mid-wave.
    const exportStatements = [
      ...page.matchAll(/^export (?:function|const|let|var|class|type|interface|default|\{)/gm),
    ];
    expect(exportStatements.length).toBe(2);
    expect(page).not.toContain("export default");
    // And the re-exported table itself is the real one (scope parity +
    // verbatim copy — the F1/F16 comments rode along).
    const navSections = read("src/components/admin/layout/nav-sections.ts");
    expect(navSections).toContain("export const NAV_SECTIONS = [");
    expect(navSections).toContain('label: "الكتالوج والعملاء"');
    expect(navSections).toContain(
      '{ href: "/admin/coupons", label: "الكوبونات", icon: Tag, scope: "finance" }',
    );
    expect(navSections).toContain("export type NavItemShape");
  });

  it("the coordinating state atoms + session guards stay IN the page (values + callbacks flow down)", () => {
    // One owner: the sidebar collapse, the mobile drawer, the palette
    // open flag and the badge-pill clock are read by the sidebar, the
    // top bar AND the effects — a duplicated atom in an extract would
    // desync the shell's surfaces.
    for (const atom of [
      "const [collapsed, setCollapsed] = useState(false);",
      "const [mobileOpen, setMobileOpen] = useState(false);",
      "const [showSearch, setShowSearch] = useState(false);",
      "const [lastUpdated, setLastUpdated] = useState<Date | null>(null);",
      "const [secondsAgo, setSecondsAgo] = useState(0);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The focus refs the drawer contract (B-15) wires.
    expect(page).toContain("const drawerRef = useRef<HTMLElement>(null);");
    expect(page).toContain("const hamburgerRef = useRef<HTMLButtonElement>(null);");
    // The session guard + RBAC truth: the page alone talks to useAuth;
    // SidebarNav/GlobalSearch receive hasAdminPermission as a callback.
    expect(page).toContain("const { adminToken, adminLogout, hasAdminPermission } = useAuth();");
    expect(page).toContain("enabled: !!adminToken && canSeeSupportBadge");
    expect(page).toContain("if (!adminToken || !canSeeSupportBadge) return;");
    // The badge merge (server truth wins, page-passed fallback) and the
    // palette scope gate stay page-owned.
    expect(page).toContain("const mergedBadges = {");
    expect(page).toContain("const canGlobalSearch =");
    // The per-route document title effect (A6 B-1) stays with its
    // page-owned pageTitle + the restore constant.
    expect(page).toContain("const pageTitle = pageTitleFor(location);");
    expect(page).toContain("document.title = STOREFRONT_DEFAULT_TITLE;");
  });

  it("the admin-palette-tokens source pins keep their home in the page (their test reads THIS file)", () => {
    // admin-palette-tokens.test.ts asserts these two exact strings live
    // in src/pages/admin/layout.tsx — the collapsed-logo/hamburger dots
    // and the last-updated pulse dot must never move to an extract.
    expect(page).toContain(
      "bg-status-warning/15 text-status-warning border border-status-warning/30",
    );
    expect(page).toContain('className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse');
  });
});

describe("R137 (FE) — the extracts are self-contained units (verbatim moves)", () => {
  it("no presentational extract re-declares shell state (they take values + callbacks only)", () => {
    // Stateless by contract: every atom a section needs is passed DOWN,
    // so no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth in the shell is how the R98-01-class desync bugs
    // happen.
    const files = ["NavItem", "SearchTriggers", "SidebarNav"];
    for (const name of files) {
      const src = read(`src/components/admin/layout/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("GlobalSearch owns ONLY its overlay-local atoms (the self-contained feature-extract shape)", () => {
    // The palette is a self-contained feature component, not a
    // presentational card: its query/results/debounce/highlight state
    // is read by NOTHING outside the overlay, so it moved as a unit
    // with its own hooks. The page owns the open flag + passes onClose.
    const gs = read("src/components/admin/layout/GlobalSearch.tsx");
    expect(gs).toContain("export function GlobalSearch({ onClose }: { onClose: () => void })");
    expect(gs).toContain('const [query, setQuery] = useState("");');
    expect(gs).toContain("const [resultsFor, setResultsFor] = useState<string | null>(null);");
    // The wave-critical render pins stay meaningful at the new address:
    // the palette a11y contract (R125/R133) moved verbatim.
    expect(gs).toContain('aria-label="بحث سريع"');
    expect(gs).toContain('role="combobox"');
    expect(gs).toContain('id="global-search-results"');
    expect(gs).toContain('لا نتائج لـ "{query}"');
    expect(gs).toContain("formatCount(total, SEARCH_RESULT_FORMS)");
    expect(gs).toContain("trapTabKey(overlayRef.current, e)");
  });

  it("the moved markup rides along verbatim (the r125/r128 a11y + copy pins follow the surface)", () => {
    // NavItem: the aria-current/aria-label contract + the AA badge ink
    // pairs (the collapsed «9+» dot) moved byte-identically.
    const navItem = read("src/components/admin/layout/NavItem.tsx");
    expect(navItem).toContain('aria-current={active ? "page" : undefined}');
    expect(navItem).toContain(
      "bg-status-warning/15 text-status-warning border border-status-warning/30",
    );
    expect(navItem).toContain('{badge > 9 ? "9+" : badge}');
    expect(navItem).toContain("hover:text-primary-text");
    // SidebarNav: the RBAC filter + badge/context wiring, byte-identical.
    const sidebarNav = read("src/components/admin/layout/SidebarNav.tsx");
    expect(sidebarNav).toContain(
      '!("scope" in item) || !item.scope || hasAdminPermission(item.scope)',
    );
    expect(sidebarNav).toContain("CONTEXT_ACTIONS[location] ?? []");
    expect(sidebarNav).toContain("(mergedBadges as Record<string, number>)?.[item.badgeKey]");
    // SearchTriggers: the ⌘K pill + the icon-only mobile twin.
    const triggers = read("src/components/admin/layout/SearchTriggers.tsx");
    // R160: ellipsis dialect — ASCII ... → «…» with the source copy.
    expect(triggers).toContain("<span>بحث…</span>");
    expect(triggers).toContain('aria-label="بحث سريع"');
    expect(triggers).toContain("{canGlobalSearch && (");
  });

  it("the pure modules are React-free (route tables + logic — importable by any lane)", () => {
    // nav-sections + layout-nav carry the lucide icon REFERENCES the
    // nav renders (data, not JSX — the home/catalog-filters precedent);
    // the pin is the absence of react itself. focus-trap is pure DOM.
    for (const name of ["layout-nav", "nav-sections"]) {
      const src = read(`src/components/admin/layout/${name}.ts`);
      expect(src, name).not.toMatch(/from "react"/);
    }
    const focusTrap = read("src/components/admin/layout/focus-trap.ts");
    expect(focusTrap).not.toMatch(/from "react"|from "lucide-react"/);
    // The title derivation + focus trap moved by name (never duplicated
    // inline in the page — the page imports them).
    const layoutNav = read("src/components/admin/layout/layout-nav.ts");
    expect(layoutNav).toContain("export function pageTitleFor(location: string): string");
    expect(layoutNav).toContain("export function computeActiveHref(location: string): string");
    expect(layoutNav).toContain("export const STOREFRONT_DEFAULT_TITLE");
    expect(layoutNav).toContain("export const CONTEXT_ACTIONS");
    // R146 (components audit F1): focus-trap is now a verbatim re-export
    // of the shared lib/a11y helper (the local body was byte-identical) —
    // the pin follows the re-export form; the React-free guarantee above
    // still holds for the module itself.
    expect(focusTrap).toContain('export { trapTabKey } from "@/lib/a11y/trap-tab-key";');
  });
});
