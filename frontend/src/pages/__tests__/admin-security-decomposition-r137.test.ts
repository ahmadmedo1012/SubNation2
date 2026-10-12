/**
 * R137 (FE) — the admin/security.tsx decomposition contract.
 *
 * The admin security dashboard was a 945-line single component (5
 * useState atoms, a 300 ms debounce effect, all three generated-client
 * queries with their keepPreviousData / last-request-wins keys, the
 * tab-aware CSV export, the finite audit pager, and every presentational
 * card / table / filter bar inline in one function) — the R136
 * checkout.tsx precedent (1,665 → 9 extracts) and the R137 batch-1
 * admin idiom (topups/users/orders/system) applied here: orchestration
 * (pages/admin/security.tsx) + eight verbatim extracts under
 * components/admin/security/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the B15-1 audit
 * tab semantics, the R128 B3-F4 bidi-isolated actor cell, the honest
 * window counts) is already pinned by the security-error-state /
 * security-audit-tab / security-timeline-honesty render suites; this
 * file guards the STRUCTURE so the decomposition cannot silently
 * regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      945 lines; the ceiling leaves room to grow without re-ballooning
 *      into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. data-path ownership — all three queries, refreshAll, the
 *      tab-aware exportToCSV (both CSV arms + their BOM/blob/link
 *      lifecycle), setAuditFilter (the pager-reset wrapper) and the
 *      auditPage atom stay IN the page: the queries' queryKeys are the
 *      R125-I5 last-request-wins belt and the CSV writes the operator's
 *      accountability artifact — none may drift into a presentational
 *      extract;
 *   4. state ownership — all 5 cross-section atoms stay centralized in
 *      the page (activeTab spans the query gate + the export + both
 *      panes); the extracts take values + callbacks only;
 *   5. purity — the security metadata module is React-free, and no
 *      extract touches the data APIs (react-query / the generated
 *      client's hooks) — the meta's generated-row re-export is
 *      TYPE-ONLY (erased at runtime).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/security.tsx");

describe("R137 (FE) — admin/security.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/security.tsx stays under the 1,000-line ceiling (was 945 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/security/security-meta",
      "@/components/admin/security/AuthPaneSkeleton",
      "@/components/admin/security/AuthStatsGrid",
      "@/components/admin/security/AuthFiltersCard",
      "@/components/admin/security/ActivityTimelineCard",
      "@/components/admin/security/AuditFiltersCard",
      "@/components/admin/security/AuditTrailErrorCard",
      "@/components/admin/security/AuditTrailTable",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the data-path queries + the export/refresh actions stay IN the page (the extracts render; the page owns the reads)", () => {
    // All three generated-client queries with their scope gates ride
    // the page — the R125-I5 queryKey belt (last-request-wins) and the
    // R127-L5 audit gate (activeTab in `enabled`) are the page's own
    // coordination, never a presentational concern.
    expect(page).toContain("const statsQuery = useGetAdminAuthStatsSummary({");
    expect(page).toContain("const activitiesQuery = useListAdminAuthActivity(");
    expect(page).toContain("const auditQuery = useListAdminAuditLogs(");
    expect(page).toContain("placeholderData: keepPreviousData,");
    expect(page).toContain('enabled: !!adminToken && canView && activeTab === "audit"');
    // refreshAll threads the layout's refresh into all three queries.
    expect(page).toContain("const refreshAll = () => {");
    // The tab-aware CSV export — BOTH arms (the audit page's loaded rows
    // + the auth window), the UTF-8 BOM, the csvCell quoting and the
    // blob/link lifecycle stay in the page (the operator-facing
    // accountability artifact; a stale closure in an extract could
    // export the wrong pane's rows).
    expect(page).toContain("const exportToCSV = () => {");
    expect(page).toContain("const auditHeaders = [");
    expect(page).toContain("link.download = `admin-audit-logs-");
    expect(page).toContain("link.download = `auth-activity-");
    expect(page).toContain('const csvContent =\n        "\\uFEFF" +');
    // setAuditFilter — the filter-patch wrapper that restarts the
    // audit pager at page 1 (the extract only calls it).
    expect(page).toContain("const setAuditFilter = (patch: Partial<typeof auditFilters>) => {");
    expect(page).toContain("setAuditPage(1);");
    // The audit tab's empty branch + the first-load SkeletonText branch
    // stay mounted in the page — the R136 UX-1 adoption floor pins THIS
    // file importing the shared skeleton primitive (the 1-a system.tsx
    // precedent: extracts render only loaded tiles).
    expect(page).toContain('from "@/components/ui/Skeleton"');
    expect(page).toContain("<SkeletonText");
    expect(page).toContain('title="لا توجد إجراءات مسجّلة"');
    // And the deep-link honest-reason gate (R134 A3-F1).
    expect(page).toContain('return <AdminScopeGate scope="admins" />;');
  });

  it("the cross-section state atoms + the tab bar stay centralized in the page (values + callbacks flow down)", () => {
    // One source: activeTab spans the audit query gate, the export arm
    // and BOTH pane trees; auditFilters spans the debounce, the query
    // params and the filter card; auditPage spans the query key and the
    // pager's functional updater (which rides down as a prop).
    for (const atom of [
      "const [filters, setFilters] = useState({",
      'const [activeTab, setActiveTab] = useState<SecurityTabId>("auth");',
      "const [auditFilters, setAuditFilters] = useState({",
      'const [debouncedAuditAction, setDebouncedAuditAction] = useState("");',
      "const [auditPage, setAuditPage] = useState(1);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The 300 ms action debounce (the orders.tsx idiom) + the actor-id
    // parse ride the page's own effect/derivation chain.
    expect(page).toContain(
      "const t = setTimeout(() => setDebouncedAuditAction(auditFilters.action), 300);",
    );
    expect(page).toContain("const n = Number.parseInt(auditFilters.actor, 10);");
    // The tab config (lucide icons + the SecurityTabId contract) and
    // the real-tab tablist stay HERE — they ARE the pane coordination.
    expect(page).toContain("const SECURITY_TABS = [");
    expect(page).toContain('type SecurityTabId = (typeof SECURITY_TABS)[number]["id"];');
    expect(page).toContain('role="tablist"');
    expect(page).toContain('aria-label="أقسام الأمان"');
    expect(page).toContain("id={`security-tab-${tab.id}`}");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved markup rides along verbatim (spot-pins at the new address)", () => {
    // The R128 B3-F4 bidi-isolated actor cell + the B11-F1 metadata
    // attribution moved to AuditTrailTable.tsx — these spot-pins keep
    // the verbatim shapes at their new address so the existing render
    // pins (security-audit-tab) stay meaningful through the extracts.
    const table = read("src/components/admin/security/AuditTrailTable.tsx");
    expect(table).toContain('dir={log.actorUsername ? "ltr" : undefined}');
    expect(table).toContain("auditMetadataLine(log.metadata)");
    expect(table).toContain("onClick={() => setAuditPage((p) => Math.max(1, p - 1))}");
    expect(table).toContain("الصفحة {auditPage}");
    // The honest window count + the 100-row cap disclosure moved to
    // ActivityTimelineCard.tsx (the security-timeline-honesty surface).
    const timeline = read("src/components/admin/security/ActivityTimelineCard.tsx");
    expect(timeline).toContain(
      "عرض {formatCount(activities.length, ACTIVITY_COUNT_FORMS)} (الأحدث أولاً)",
    );
    expect(timeline).toContain(
      "يعرض أحدث {formatCount(ACTIVITY_WINDOW_CAP, ACTIVITY_COUNT_FORMS)} فقط",
    );
    // The Arabic action map + the audit metadata formatter moved to the
    // pure module the page + extracts import by name (never duplicated
    // inline — the 94-C2 label lockstep).
    const meta = read("src/components/admin/security/security-meta.ts");
    expect(meta).toContain('"topup.approve": "اعتماد شحن رصيد",');
    expect(meta).toContain("export function auditMetadataLine(");
    // The page h1 stays in the page (the admin-h1-unification scan
    // reads pages/admin/*.tsx).
    expect(page).toContain('<h1 className="text-xl font-bold">لوحة أمان المصادقة</h1>');
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a pane needs is passed DOWN, so
    // no extract may grow its own useState/useRef/useEffect/useMemo
    // island — duplicated truth on the accountability dashboard is how
    // the R98-01-class desync bugs happen.
    const files = [
      "AuthPaneSkeleton",
      "AuthStatsGrid",
      "AuthFiltersCard",
      "ActivityTimelineCard",
      "AuditFiltersCard",
      "AuditTrailErrorCard",
      "AuditTrailTable",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/security/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
    // And none of them re-declares a page atom's identifier either.
    for (const name of files) {
      const src = read(`src/components/admin/security/${name}.tsx`);
      expect(src, name).not.toMatch(
        /const \[(filters|activeTab|auditFilters|debouncedAuditAction|auditPage), set/,
      );
    }
  });

  it("no extract touches the data APIs (the page owns every query + export)", () => {
    // react-query and the generated client's hooks are page-only
    // surfaces — an extract importing any of them is a data path that
    // drifted out of orchestration.
    const files = [
      "AuthPaneSkeleton",
      "AuthStatsGrid",
      "AuthFiltersCard",
      "ActivityTimelineCard",
      "AuditFiltersCard",
      "AuditTrailErrorCard",
      "AuditTrailTable",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/security/${name}.tsx`);
      expect(src, name).not.toMatch(/@tanstack\/react-query/);
      expect(src, name).not.toMatch(/@workspace\/api-client-react/);
      expect(src, name).not.toMatch(
        /useGetAdminAuthStatsSummary|useListAdminAuthActivity|useListAdminAuditLogs/,
      );
    }
  });

  it("the security metadata module is React-free (pure maps + predicates — importable by any lane)", () => {
    const meta = read("src/components/admin/security/security-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The Arabic action map (94-C2 label lockstep / R127-L5 B15-1).
    expect(meta).toContain("export const ACTION_LABELS: Record<string, string> = {");
    expect(meta).toContain("export const AUDIT_ACTION_LABELS: Record<string, string> = {");
    expect(meta).toContain("export const AUDIT_ACTOR_TYPE_LABELS: Record<string, string> = {");
    // The window honesty constants (R125-I5 A3-5 + the R127-L5 pager).
    expect(meta).toContain("export const ACTIVITY_WINDOW_CAP = 100;");
    expect(meta).toContain("export const AUDIT_PAGE_SIZE = 50;");
    expect(meta).toContain("export const ACTIVITY_COUNT_FORMS = {");
    expect(meta).toContain("export const AUDIT_COUNT_FORMS = {");
    // The 401 predicate the page's quiet-catches duck-type (R126-L8b).
    expect(meta).toContain("export function isSessionExpiredError(");
    expect(meta).toContain("?.status === 401;");
    // The generated row types ride as TYPE-ONLY re-exports — erased at
    // runtime, so the module stays pure no matter who imports it.
    // (Whitespace-flattened + trailing-comma tolerant: the repo's
    // prettier wraps the specifier list across lines and adds the
    // trailing comma — the pin guards the re-export, not the wrapping.)
    const metaFlat = meta.replace(/\s+/g, " ");
    expect(metaFlat).toMatch(
      /export type \{ AdminAuthActivity, AdminAuditLog, AdminAuthStatsSummary,? \} from "@workspace\/api-client-react";/,
    );
    expect(meta).not.toMatch(/customFetch[<(]|useQuery[<(]|\.refetch\(|await /);
  });
});
