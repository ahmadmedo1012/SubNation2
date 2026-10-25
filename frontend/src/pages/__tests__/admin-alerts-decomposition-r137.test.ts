/**
 * R137 (FE) — the admin/alerts.tsx decomposition contract.
 *
 * The alerts inbox was an 824-line single component (one filter atom, the
 * accumulating infinite query, FIVE optimistic mutations — markRead /
 * markAllRead / deleteAlert / deleteRead / deleteAll with their cache
 * patches + 401 quiet-catches — three confirm-gated destructive flows,
 * and every presentational section inline in one function) — the R136
 * checkout.tsx precedent (1,665 → 9 extracts) applied here:
 * orchestration (pages/admin/alerts.tsx) + seven verbatim extracts under
 * components/admin/alerts/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the optimistic
 * rollback + guarded bulk-delete confirms, the aria-pressed chip bars)
 * is already pinned by the two alerts render suites
 * (alerts-load-more / alerts-delete-confirm); this file guards the
 * STRUCTURE so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      824 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. mutation ownership — all five mutations + the three
 *      confirm-gated destructive flows + patchCachedAlerts stay IN the
 *      page: a stale closure in a presentational extract could
 *      resurrect a deleted row or mark the wrong alert read;
 *   4. state ownership — the filter atom (the one source behind BOTH
 *      filter bars) stays centralized in the page; the extracts take
 *      values + callbacks only;
 *   5. purity — the inbox metadata module is React-free, the TYPE_META
 *      icon map module is hook-free, and no extract touches the inbox
 *      mutation APIs (react-query / the generated alert fetchers).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/alerts.tsx");

describe("R137 (FE) — admin/alerts.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/alerts.tsx stays under the 1,000-line ceiling (was 824 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/alerts/alerts-inbox-meta",
      "@/components/admin/alerts/alerts-meta",
      "@/components/admin/alerts/AlertsHeader",
      "@/components/admin/alerts/AlertsTypeChips",
      "@/components/admin/alerts/AlertsFilterTabs",
      "@/components/admin/alerts/AlertsEmptyState",
      "@/components/admin/alerts/AlertsGroupedList",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
    // The R136 UX-1 adoption floor pins THIS file as a SkeletonText
    // importer (skeleton-primitives SWEPT_FILES) — the page-shaped
    // loading branch stays inline on purpose.
    expect(page).toContain('from "@/components/ui/Skeleton"');
  });

  it("the five mutations + their optimistic cache patches + the confirm gates stay IN the page (the extracts render; the page owns the inbox writes)", () => {
    // Every state-changing call on this page is one of five useMutation
    // blocks — the optimistic onMutate patches (patchCachedAlerts +
    // the unread-count co-patch), the 401 quiet-catch and the
    // invalidateAll co-invalidation ride inside them. None may drift
    // into a presentational extract where a stale closure could
    // resurrect a deleted row or double-decrement unreadCount.
    for (const mutation of [
      "const markRead = useMutation({",
      "const markAllRead = useMutation({",
      "const deleteAlert = useMutation({",
      "const deleteRead = useMutation({",
      "const deleteAll = useMutation({",
    ]) {
      expect(page, mutation).toContain(mutation);
    }
    // The shared cache-patch helper the three optimistic mutations call.
    expect(page).toContain("function patchCachedAlerts(");
    // The accumulating inbox query + its frozen page size / list key.
    expect(page).toContain("useInfiniteQuery<AlertsPageData, Error>({");
    expect(page).toContain("queryKey: ALERTS_LIST_KEY,");
    expect(page).toContain("const invalidateAll = () => {");
    // R126-L8b: the 401 quiet-catch the mutations ride — imported by
    // name from the pure module, never duplicated inline in an extract.
    expect(page).toContain("if (isSessionExpiredError(err)) return;");
    const meta = read("src/components/admin/alerts/alerts-inbox-meta.ts");
    expect(meta).toContain("export function isSessionExpiredError(");
    // The three destructive flows are confirm-gated in the page
    // (R120-B4 A2-F6 single delete, R123 E3 item 3 deleteRead, R125
    // A3 #6 deleteAll) — the buttons in AlertsHeader only fire these.
    expect(page).toContain("const confirmDeleteAlert = async (alert: AdminAlertItem) => {");
    expect(page).toContain("const confirmDeleteRead = async () => {");
    expect(page).toContain("const confirmDeleteAll = async () => {");
    expect(page).toContain("const { confirm, ConfirmDialog } = useConfirm();");
    expect(page).toContain("deleteAlert.mutate(alert.id);");
    expect(page).toContain("deleteRead.mutate();");
    expect(page).toContain("deleteAll.mutate();");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: BOTH filter bars (the chips + the tabs) read the SAME
    // filter atom — the render suite asserts the two-bar aria-pressed
    // coupling; the atom must never fork into an extract.
    expect(page).toContain('const [filter, setFilter] = useState<FilterType>("all");');
    // The derived chain the extracts consume as props.
    expect(page).toContain("const displayed = alerts.filter((a) => {");
    expect(page).toContain("const groups = groupByDate(displayed);");
    expect(page).toContain("const readCount = alerts.filter((a) => a.isRead).length;");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved markup rides along verbatim (spot-pins at the new addresses)", () => {
    // The row's action cluster + sr-only unread cue + the delete
    // button's title moved to AlertsGroupedList.tsx — the
    // alerts-delete-confirm suite asserts this DOM through the page;
    // these spot-pins keep the verbatim shapes at their new address.
    const list = read("src/components/admin/alerts/AlertsGroupedList.tsx");
    expect(list).toContain("aria-label={`حذف تنبيه «${alert.title}»`}");
    expect(list).toContain('title="حذف"');
    expect(list).toContain("sm:group-hover:opacity-100");
    expect(list).toContain("sm:group-focus-within:opacity-100");
    expect(list).toContain('<span className="sr-only"> — غير مقروء</span>');
    // The header's bulk buttons (the render suite's حذف المقروءة /
    // حذف الكل entry points).
    const header = read("src/components/admin/alerts/AlertsHeader.tsx");
    expect(header).toContain("حذف المقروءة ({readCount})");
    expect(header).toContain("حذف الكل");
    expect(header).toContain("قراءة الكل");
    // The two filter bars keep aria-pressed (R125 A3 #6 / A6 B-10).
    // R159 (IMPL-A): AlertsFilterTabs delegates to ui/filter-tabs —
    // aria-pressed arrives from the primitive (pinned by its own suite
    // + alerts-delete-confirm's two-bar render assertions);
    // AlertsTypeChips keeps its hand-rolled severity chips (the
    // primitive's tone set cannot express --status-low-stock — the
    // deferred conversion, documented in admin-comms-promo-visual).
    const chips = read("src/components/admin/alerts/AlertsTypeChips.tsx");
    expect(chips).toContain("aria-pressed={filter === s.key}");
    const tabs = read("src/components/admin/alerts/AlertsFilterTabs.tsx");
    expect(tabs).toContain('from "@/components/ui/filter-tabs"');
    expect(tabs).toContain("value={filter}");
    // The empty branch's announcing role (R125 A6 B-8).
    const empty = read("src/components/admin/alerts/AlertsEmptyState.tsx");
    expect(empty).toContain('role="status"');
    expect(empty).toContain("لا توجد تنبيهات غير مقروءة");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: the filter atom + every pending flag flow
    // DOWN, so no extract may grow its own useState/useRef/useEffect/
    // useMemo island — a forked filter atom is how the two-bar
    // aria-pressed coupling silently breaks.
    const files = [
      "AlertsHeader",
      "AlertsTypeChips",
      "AlertsFilterTabs",
      "AlertsEmptyState",
      "AlertsGroupedList",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/alerts/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
      expect(src, name).not.toMatch(/const \[filter, setFilter\]/);
    }
  });

  it("no extract touches the inbox mutation APIs (the page owns every read/delete POST)", () => {
    // react-query + the generated alert fetchers are page-only surfaces
    // — an extract importing any of them is a mutation path that
    // drifted out of orchestration. (The extracts speak the row type
    // through the pure meta module, never the api-client package.)
    const files = [
      "AlertsHeader",
      "AlertsTypeChips",
      "AlertsFilterTabs",
      "AlertsEmptyState",
      "AlertsGroupedList",
      "alerts-meta",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/alerts/${name}.tsx`);
      expect(src, name).not.toMatch(/@tanstack\/react-query|@workspace\/api-client-react/);
      expect(src, name).not.toMatch(/\bmarkAdminAlertRead\b|\bmarkAllAdminAlertsRead\b/);
      expect(src, name).not.toMatch(
        /\bdeleteAdminAlert\b|\bdeleteReadAdminAlerts\b|\bdeleteAllAdminAlerts\b/,
      );
      expect(src, name).not.toMatch(/\blistAdminAlerts\b/);
    }
  });

  it("the inbox metadata module is React-free + the TYPE_META icon map is hook-free (importable by any lane)", () => {
    // alerts-inbox-meta.ts: the pure tables/predicates — no react, no
    // lucide (the r136 checkout / r137 topups pure-module bar).
    const meta = read("src/components/admin/alerts/alerts-inbox-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The tab list every TYPE_META type covers (R125 A3 #6).
    expect(meta).toContain("export const FILTERS: { value: FilterType; label: string }[] = [");
    // The frozen `?page=&limit=` contract's page size + list key (94-C2).
    expect(meta).toContain("export const ALERTS_PAGE_SIZE = 50;");
    expect(meta).toContain('export const ALERTS_LIST_KEY = ["admin-alerts", "inbox"] as const;');
    // The Arabic plural forms the footer + confirm copy ride (A2 P3-4).
    expect(meta).toContain("export const ALERT_COUNT_FORMS = {");
    // The 401 predicate + the failure-toast factory the mutations ride.
    expect(meta).toContain("export function isSessionExpiredError(");
    expect(meta).toContain("export function alertActionToast(");
    // The date grouping the page's `groups` derivation calls.
    expect(meta).toContain("export function groupByDate(");
    // alerts-meta.tsx: the icon/tone/label map — lucide icons are
    // values, so it rides the system-meta.tsx .tsx precedent: still
    // hook-free and JSX-free.
    const typeMeta = read("src/components/admin/alerts/alerts-meta.tsx");
    expect(typeMeta).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(|useCallback\(/);
    expect(typeMeta).toContain("export const TYPE_META: Record<");
    expect(typeMeta).toContain('label: "مخزون منخفض"');
    expect(typeMeta).toContain('label: "نفاد متوقع"');
  });
});

describe("R187E-F2 — TYPE_META covers the backend's FULL alert writer set (source parity)", () => {
  // The backend has TWO writers: the alertLogger union (11 types) and
  // risk-alerts.service.ts, which inserts `type: "risk"` rows directly
  // into admin_alerts. The frontend map used to cover only 6 — five
  // real types (incl. SEVERE inventory_corrupt / refunded_live_
  // credentials) fell through to the generic «نظام» info chip with no
  // filter chip. This pin reads the BACKEND sources live (the R161-C
  // taxonomy-consistency cross-package idiom) so a future backend type
  // lands in the same failing test that forgets to extend TYPE_META.
  const backendAlertLogger = read("../backend/src/jobs/alertLogger.ts");
  const riskService = read("../backend/src/services/risk-alerts.service.ts");

  function backendAlertTypes(): Set<string> {
    const unionStart = backendAlertLogger.indexOf("export type AlertType");
    expect(unionStart, "alertLogger.ts still declares the AlertType union").toBeGreaterThan(-1);
    const unionBlock = backendAlertLogger.slice(
      unionStart,
      backendAlertLogger.indexOf(";", unionStart),
    );
    const members = Array.from(unionBlock.matchAll(/"([a-z_]+)"/g)).map((m) => m[1]);
    expect(members.length, "the union still carries its members").toBeGreaterThanOrEqual(11);
    const types = new Set(members);
    // The direct-insert writer outside the logger.
    expect(riskService, 'risk-alerts.service still inserts type: "risk"').toContain('type: "risk"');
    types.add("risk");
    return types;
  }

  it('every backend AlertType member (logger union + the direct-insert "risk") is a TYPE_META key', async () => {
    const { TYPE_META } = await import("@/components/admin/alerts/alerts-meta");
    const keys = Object.keys(TYPE_META);
    for (const type of backendAlertTypes()) {
      expect(keys, `TYPE_META is missing the backend type "${type}"`).toContain(type);
    }
  });

  it("TYPE_META carries no invented type the backend never writes (the map stays an honest mirror)", async () => {
    const { TYPE_META } = await import("@/components/admin/alerts/alerts-meta");
    const backend = backendAlertTypes();
    for (const key of Object.keys(TYPE_META)) {
      expect(backend, `TYPE_META key "${key}" has no backend writer`).toContain(key);
    }
  });

  it("the FILTERS tab list + the chips' derived key list both cover every TYPE_META key (no unfilterable row)", async () => {
    const { FILTERS } = await import("@/components/admin/alerts/alerts-inbox-meta");
    const { TYPE_META } = await import("@/components/admin/alerts/alerts-meta");
    const filterValues = new Set(FILTERS.map((f) => f.value));
    for (const key of Object.keys(TYPE_META)) {
      expect(filterValues, `FILTERS is missing the tab for "${key}"`).toContain(key);
    }
    // The chips bar derives its key list from TYPE_META's own keys —
    // the hardcoded six-entry array stays dead (a future AlertType can
    // never again render rows its chip bar silently omits).
    const chips = read("src/components/admin/alerts/AlertsTypeChips.tsx");
    expect(chips).toContain("(Object.keys(TYPE_META) as AlertType[])");
    expect(chips).not.toContain('key: "no_stock"');
    expect(chips).not.toContain('key: "system"');
  });

  it("the new severe types carry the error tone, not the generic info one", async () => {
    const { TYPE_META } = await import("@/components/admin/alerts/alerts-meta");
    for (const key of ["inventory_corrupt", "refunded_live_credentials", "risk"]) {
      expect(TYPE_META[key as keyof typeof TYPE_META].color, key).toBe("text-status-error");
    }
    // And the labels mirror layout.tsx's ALERT_LABELS (cross-surface
    // consistency: the inbox chip and the live toast name one concept
    // one way) — "risk" is NOT in the layout map, so its label is the
    // honest standalone (pinned by the render suite).
    const layout = read("src/pages/admin/layout.tsx");
    for (const [key, label] of [
      ["inventory_corrupt", "بيانات مخزون غير متسقة"],
      ["refunded_live_credentials", "بيانات وصول حيّة مُستردة"],
      ["flash_sale_expired", "عرض محدود منتهي"],
      ["coupon_expired", "كوبون منتهي"],
      ["whatsapp_channel", "قناة واتساب"],
    ] as const) {
      expect(layout, `layout.tsx ALERT_LABELS entry for ${key}`).toContain(`${key}: "${label}"`);
      expect(TYPE_META[key].label).toBe(label);
    }
  });
});
