/**
 * R167 (layout decomposition — audit finding F13) — the Navbar /
 * NotificationBell decomposition contract.
 *
 * The two largest components in src had NO size pins and each mixed
 * several concerns: Navbar.tsx (876 lines — drawers + user actions +
 * categories + row chrome + the cart announcer) and NotificationBell.tsx
 * (635 lines — trigger wiring + the whole portal'd panel; the R158 hooks
 * lane had already moved the data machine to @/hooks/useNotifications).
 * R167 split both along their clean seams (the R135 product / R136 home
 * / R137 admin-layout decomposition precedent):
 *
 *   Navbar → components/layout/navbar/: GuestDrawer + AuthedDrawer (the
 *   two panels; the header keeps the shared drawer machinery and passes
 *   drawerRef/setOpen/logout down), DrawerCategoriesSection (the «الفئات»
 *   block both drawers render), DesktopCategoriesMenu (the desktop
 *   «الأقسام» disclosure — a self-contained feature unit in the
 *   GlobalSearch precedent, own open-flag + dismissal effects),
 *   DesktopUserActions (the authed/guest desktop cluster),
 *   MobileWalletChip (the sm…md wallet chip) and drawer-data.ts (the
 *   shared React-free tables).
 *
 *   NotificationBell → components/layout/bell/: NotificationPanel (the
 *   portal'd feature component — own vw/geometry + focus contract),
 *   NotificationRow (the per-item row), PanelFooter (the honest count
 *   link + the 40-row cap constant) and type-config.ts (the React-free
 *   TYPE_CONFIG table, re-exported at the bell's module boundary so the
 *   pinned status-tokens import address still resolves — the
 *   NAV_SECTIONS re-export idiom).
 *
 * These are SOURCE-scan pins (the r136-r137 decomposition idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the R126 drawer a11y, the R132
 * disclosure, the R153 bell tri-state, the R157 footer, the R166
 * aria-live patterns) is already pinned by the navbar-* /
 * notification-bell-* / status-tokens / live-regions render suites;
 * this family guards the STRUCTURE so the decomposition cannot
 * silently regress:
 *
 *   1. size ceilings — both parents stay orchestration cores (Navbar
 *      was 876 lines, the bell 635; the ceilings leave room to grow
 *      without re-ballooning into the monoliths — the bell's outer
 *      <700 ceiling from the r158 family stays valid beside these);
 *   2. deletion guards — every extract is still imported by its parent
 *      (a dropped import = a section silently vanished), and the
 *      sibling extracts import their own leaves (the NavItem
 *      precedent);
 *   3. import shape — the presentational extracts take values +
 *      callbacks only (no state islands); the two self-contained
 *      feature units (DesktopCategoriesMenu, NotificationPanel) own
 *      ONLY their overlay-local atoms; the data modules are
 *      React-free;
 *   4. ownership pins — the header keeps the drawer machinery, the
 *      cart announcer, the /me query and the viewport-meta guard (the
 *      one-owner law: state + effects the drawers share never
 *      duplicate into an extract);
 *   5. verbatim sentinels — the moved markup (ids, roles, Arabic copy,
 *      the RTL icon law: forward = ChevronLeft/ArrowLeft in RTL, never
 *      a right-pointer) rides along with the extracts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const navbar = read("src/components/layout/Navbar.tsx");
const bell = read("src/components/layout/NotificationBell.tsx");
const nav = (name: string): string => read(`src/components/layout/navbar/${name}`);
const bellFile = (name: string): string => read(`src/components/layout/bell/${name}`);

describe("R167 (layout decomposition) — Navbar.tsx stays an orchestration core", () => {
  it("components/layout/Navbar.tsx stays under the 600-line ceiling (was 876 at decomposition)", () => {
    const lines = navbar.split("\n").length;
    expect(lines).toBeLessThan(600);
  });

  it("the header imports every extract it renders (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "./navbar/AuthedDrawer",
      "./navbar/DesktopCategoriesMenu",
      "./navbar/DesktopUserActions",
      "./navbar/GuestDrawer",
      "./navbar/MobileWalletChip",
    ];
    for (const specifier of extracts) {
      expect(navbar, specifier).toContain(`from "${specifier}";`);
    }
  });

  it("the sibling extracts import their own leaves (drawer-data + the shared section — the NavItem precedent)", () => {
    // Both drawers render the shared «الفئات» section + ride the
    // shared scroll cap + row table; the desktop disclosure reuses the
    // same DRAWER_CATEGORIES table (one table, zero drift — R132's
    // design). Intra-folder relative imports.
    const guestDrawer = nav("GuestDrawer.tsx");
    const authedDrawer = nav("AuthedDrawer.tsx");
    const desktopMenu = nav("DesktopCategoriesMenu.tsx");
    for (const drawer of [guestDrawer, authedDrawer]) {
      expect(drawer).toContain('from "./DrawerCategoriesSection"');
      expect(drawer).toContain('from "./drawer-data"');
    }
    expect(desktopMenu).toContain('from "./drawer-data"');
  });

  it("the drawer machinery + cart announcer stay IN the header (one owner — the shared effects guard both drawers)", () => {
    // The R126 A13-F2 Esc/Tab trap + focus move-in/return, the R120-B1
    // body scroll-lock and the route-change close serve BOTH drawers
    // (only one panel is ever mounted) — they stay beside the open
    // state they guard, with the refs handed down as props.
    for (const atom of [
      "const [open, setOpen] = useState(false);",
      "const drawerRef = useRef<HTMLDivElement>(null);",
      "const menuButtonRef = useRef<HTMLButtonElement>(null);",
    ]) {
      expect(navbar, atom).toContain(atom);
    }
    expect(navbar).toContain(
      'else if (e.key === "Tab" && drawerRef.current) trapTabKey(drawerRef.current, e);',
    );
    expect(navbar).toContain("drawerRef.current?.focus();");
    expect(navbar).toContain("menuButtonRef.current?.focus();");
    expect(navbar).toContain('document.body.style.overflow = "hidden";');
    // The R-140-k cart announcer (round-closure-r140 + live-regions-r140
    // pin the same wiring) and the scroll atom stay header-owned.
    expect(navbar).toContain("cartChangeAnnouncement(prevCartCountRef.current, itemCount)");
    expect(navbar).toContain('div aria-live="polite" role="status" className="sr-only"');
    expect(navbar).toContain("const [scrolled, setScrolled] = useState(false);");
    // The 96-F5 viewport-meta guard + the measurable header stay too.
    expect(navbar).toContain("interactive-widget=resizes-content");
    expect(navbar).toContain('style={{ paddingTop: "env(safe-area-inset-top)" }}');
  });

  it("the presentational extracts take values + callbacks only (no state islands)", () => {
    // Stateless by contract: every atom a section needs is passed DOWN,
    // so no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth in the shell is how the R98-01-class desync bugs
    // happen. (DesktopCategoriesMenu + NotificationPanel are the two
    // deliberate feature-unit exceptions, pinned below.)
    const files = [
      "AuthedDrawer.tsx",
      "DesktopUserActions.tsx",
      "DrawerCategoriesSection.tsx",
      "GuestDrawer.tsx",
      "MobileWalletChip.tsx",
    ];
    for (const name of files) {
      const src = nav(name);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("DesktopCategoriesMenu owns ONLY its disclosure-local atoms (the GlobalSearch feature-unit precedent)", () => {
    // The open flag, the two refs and the three dismissal effects
    // (route change / pointer-outside / ESC-with-focus-return) are
    // read by NOTHING outside the disclosure, so they moved as a unit.
    const menu = nav("DesktopCategoriesMenu.tsx");
    expect(menu).toContain("const [catMenuOpen, setCatMenuOpen] = useState(false);");
    expect(menu).toContain("const catMenuRef = useRef<HTMLDivElement>(null);");
    expect(menu).toContain("const catMenuButtonRef = useRef<HTMLButtonElement>(null);");
    expect(menu).toContain("const [location] = useLocation();");
    expect(menu).toContain(
      'document.addEventListener("pointerdown", onPointerDown, { passive: true });',
    );
    expect(menu).toContain("catMenuButtonRef.current?.focus();");
  });

  it("drawer-data.ts is React-free (icon + class tables — importable by any lane)", () => {
    // The R146 eager-chunk law rides along: the tables carry lucide
    // icon REFERENCES (data, not JSX) derived from utils' LIVE_CATEGORY_
    // SLUGS — importing the category registry itself would hoist its
    // icon set into the eager entry chunk.
    const data = nav("drawer-data.ts");
    expect(data).not.toMatch(/from "react"/);
    expect(data).toContain("export const DRAWER_CATEGORIES = LIVE_CATEGORY_SLUGS.map((slug) => ({");
    expect(data).toContain("export const AUTHED_DRAWER_LINKS = [");
    expect(data).toContain("export const DRAWER_SCROLL_CAP =");
  });

  it("the moved markup rides along verbatim (ids, roles + Arabic copy follow the surface)", () => {
    // GuestDrawer: the R126 dialog contract + the funnel rows.
    const guestDrawer = nav("GuestDrawer.tsx");
    expect(guestDrawer).toContain('id="guest-menu"');
    expect(guestDrawer).toContain('role="dialog"');
    expect(guestDrawer).toContain('aria-modal="true"');
    expect(guestDrawer).toContain('aria-label="القائمة"');
    expect(guestDrawer).toContain("تسجيل الدخول");
    expect(guestDrawer).toContain("إنشاء حساب مجاني");
    // AuthedDrawer: the 8-row cluster + the destructive logout row with
    // the close-BEFORE-logout ordering.
    const authedDrawer = nav("AuthedDrawer.tsx");
    expect(authedDrawer).toContain('id="authed-menu"');
    expect(authedDrawer).toContain("تسجيل الخروج");
    expect(authedDrawer).toContain("text-status-error hover:bg-status-error/10");
    expect(authedDrawer).toContain("setOpen(false);");
    // DrawerCategoriesSection: the shared block both drawers render.
    const section = nav("DrawerCategoriesSection.tsx");
    expect(section).toContain('">الفئات</div>');
    expect(section).toContain('href="/flash-sales"');
    expect(section).toContain("العروض");
    // DesktopCategoriesMenu: the R132 disclosure contract.
    expect(nav("DesktopCategoriesMenu.tsx")).toContain('aria-controls="desktop-categories-menu"');
    // DesktopUserActions: the guest CTA pair + the authed cluster.
    const userActions = nav("DesktopUserActions.tsx");
    expect(userActions).toContain("دخول");
    expect(userActions).toContain("حساب مجاني");
    // MobileWalletChip: the R96-M01 cap + truncate contract.
    expect(nav("MobileWalletChip.tsx")).toContain("max-w-[96px] truncate");
    // And the header's own landmark label stays home.
    expect(navbar).toContain('aria-label="التنقل الرئيسي"');
  });

  it("the RTL icon law holds across every extract (forward = LEFT-pointing; no right-pointer crept in)", () => {
    // The moved forward CTAs keep their LEFT-pointers verbatim: the
    // guest register row rides the inline ChevronLeft idiom, the bell's
    // TYPE_CONFIG action chips ride ArrowLeft. No extract may gain a
    // right-pointing arrow (back affordances only, and none of these
    // surfaces render one).
    const everyExtract = [
      nav("AuthedDrawer.tsx"),
      nav("DesktopCategoriesMenu.tsx"),
      nav("DesktopUserActions.tsx"),
      nav("DrawerCategoriesSection.tsx"),
      nav("GuestDrawer.tsx"),
      nav("MobileWalletChip.tsx"),
      nav("drawer-data.ts"),
      bellFile("type-config.ts"),
    ].join("\n");
    expect(everyExtract).not.toMatch(/ArrowRight|ChevronRight/);
    expect(nav("GuestDrawer.tsx")).toContain('<ChevronLeft className="w-3 h-3 inline" />');
    expect(bellFile("type-config.ts")).toContain("actionIcon: ArrowLeft");
  });
});

describe("R167 (layout decomposition) — NotificationBell.tsx stays the trigger + wiring", () => {
  it("components/layout/NotificationBell.tsx stays under the 300-line ceiling (was 635 at decomposition)", () => {
    // The r158 family keeps the outer <700 ceiling (the data-machine
    // guard); this tighter ceiling pins the F13 structural cut —
    // re-inlining the panel (~265 lines) must fail here.
    const lines = bell.split("\n").length;
    expect(lines).toBeLessThan(300);
  });

  it("the bell imports its panel + re-exports TYPE_CONFIG at the pinned address (deletion guards)", () => {
    expect(bell).toContain('import { NotificationPanel } from "./bell/NotificationPanel";');
    expect(bell).toContain('export { TYPE_CONFIG } from "./bell/type-config";');
  });

  it("the panel/row/footer extracts own their seams (sibling import guards)", () => {
    const panel = bellFile("NotificationPanel.tsx");
    const row = bellFile("NotificationRow.tsx");
    const footer = bellFile("PanelFooter.tsx");
    expect(panel).toContain('import { NotificationRow } from "./NotificationRow";');
    expect(panel).toContain('import { PanelFooter } from "./PanelFooter";');
    expect(row).toContain('import { TYPE_CONFIG } from "./type-config";');
    expect(footer).toContain('href="/notifications"');
  });

  it("the row + footer take values + callbacks only; the panel owns ONLY its overlay-local atoms", () => {
    // NotificationRow + PanelFooter are pure presentation (the R158
    // seam: they fetch nothing); NotificationPanel is the one feature
    // unit (GlobalSearch precedent) — its vw/resize geometry + the
    // focus-return refs are read by nothing outside the dialog.
    expect(bellFile("NotificationRow.tsx")).not.toMatch(
      /useState\(|useRef\(|useEffect\(|useMemo\(|useCallback\(/,
    );
    expect(bellFile("PanelFooter.tsx")).not.toMatch(
      /useState\(|useRef\(|useEffect\(|useMemo\(|useCallback\(/,
    );
    const panel = bellFile("NotificationPanel.tsx");
    expect(panel).toContain("const [vw, setVw] = useState(() =>");
    expect(panel).toContain("const panelRef = useRef<HTMLDivElement>(null);");
    expect(panel).toContain("const returnFocusRef = useRef<HTMLElement | null>(null);");
    expect(panel).toContain("trapTabKey(panelRef.current, e)");
  });

  it("bell/type-config.ts is React-free data (icon references + class tokens)", () => {
    const typeConfig = bellFile("type-config.ts");
    expect(typeConfig).not.toMatch(/from "react"/);
    expect(typeConfig).toContain("export const TYPE_CONFIG");
    expect(typeConfig).toContain('actionLabel: "المحفظة"');
  });

  it("the moved markup rides verbatim (the R166 aria contracts follow the surface)", () => {
    // The panel keeps the R133 dialog contract + the R153 tri-state's
    // role=status / role=alert registers byte-identically.
    const panel = bellFile("NotificationPanel.tsx");
    expect(panel).toContain('data-notification-panel="1"');
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('aria-modal="true"');
    expect(panel).toContain('aria-label="الإشعارات"');
    expect(panel).toContain('role="status"');
    expect(panel).toContain('role="alert"');
    expect(panel).toContain('aria-label="إغلاق"');
    expect(panel).toContain("تحديد الكل كمقروء");
    // The row keeps the open affordance button + the per-row mark-read.
    const row = bellFile("NotificationRow.tsx");
    expect(row).toContain("تحديد كمقروء");
    expect(row).toContain('dir="auto"');
    // The footer keeps the honest cap prefix + the view-all link copy.
    const footer = bellFile("PanelFooter.tsx");
    expect(footer).toContain("NOTIFICATION_HISTORY_CAP = 40");
    expect(footer).toContain('? "آخر " : ""');
    expect(footer).toContain("عرض الكل");
  });
});
