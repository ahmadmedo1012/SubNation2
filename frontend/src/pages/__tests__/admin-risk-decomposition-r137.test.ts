/**
 * R137 (FE) — the admin/risk.tsx decomposition contract.
 *
 * The risk-queue page was a 582-line single component (the filter atom,
 * the 30s dashboard poller, the accumulating events infinite query with
 * its next_cursor has-more envelope, the background unfiltered counter
 * query, the level-agnostic counts memo, the DashCard shell, and every
 * presentational section inline in one function) — the R136 checkout.tsx
 * precedent (1,665 → 9 extracts) applied here: orchestration
 * (pages/admin/risk.tsx) + seven verbatim extracts under
 * components/admin/risk/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the RBAC gate, the load-more
 * envelope, the error-card-not-empty-state B5-04 recipe) is already
 * pinned by the risk-error-state / risk-load-more / risk-rbac-gate render
 * suites; this file guards the STRUCTURE so the decomposition cannot
 * silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      582 lines; the ceiling leaves room to grow without re-ballooning
 *      into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. query ownership — all three queries (the 30s dashboard poller,
 *      the events infinite query + its queue action, the unfiltered
 *      counter source) + the counts memo stay IN the page: the reads
 *      and the load-more/refresh actions are the queue's coordination,
 *      and the counts' level-agnostic source swap keys off the filter;
 *   4. state ownership — the filter atom stays centralized in the page;
 *      the extracts take values + callbacks only;
 *   5. purity — the risk metadata module is React-free, and no extract
 *      touches the session-aware fetcher or re-declares a query.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/risk.tsx");

describe("R137 (FE) — admin/risk.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/risk.tsx stays under the 1,000-line ceiling (was 582 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/risk/risk-meta",
      "@/components/admin/risk/RiskHeader",
      "@/components/admin/risk/RiskDashboardPanel",
      "@/components/admin/risk/RiskFilterChips",
      "@/components/admin/risk/RiskEventsTable",
      "@/components/admin/risk/RiskEventsMobileList",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
    // Nested consumer: the dashboard panel renders the stat tiles — a
    // dropped DashCard import is a vanished verdict panel.
    const panel = read("src/components/admin/risk/RiskDashboardPanel.tsx");
    expect(panel).toContain('from "@/components/admin/risk/DashCard"');
  });

  it("the query layer + the queue actions stay IN the page (the extracts render; the page owns the reads + load-more)", () => {
    // The 30s dashboard poller (with the 96-F7 hidden-tab pause + the
    // R123/R125-I4 token+scope enabled gates).
    expect(page).toContain('queryKey: ["admin-risk-dashboard"],');
    // R192 (Neon compute-quota incident): the dashboard poll moved
    // 30 s → 60 s (one-minute ops granularity; the comment block above
    // the value documents the scale-to-zero rationale).
    expect(page).toContain("refetchInterval: 60_000,");
    expect(page).toContain("refetchIntervalInBackground: false,");
    // The accumulating events infinite query — the load-more key
    // segment, the next_cursor envelope contract and the queue action.
    expect(page).toContain("useInfiniteQuery<ListResponse, Error>({");
    // R160 re-pin: the validated ?sort= joined the query key (the risk
    // sort affordance — a flip restarts the cursor list at page 1 so a
    // created_at cursor can never leak into a score-ordered request).
    // Whitespace-free matching — prettier wraps the key object across
    // lines (the R141 lesson); the pinned contract is the key's members.
    const squashed = page.replace(/\s+/g, " ");
    expect(squashed).toContain(
      'queryKey: [ "admin-risk-events", "load-more", { level: filter === "all" ? undefined : filter, sort: isRiskSort(sortBy) ? sortBy : undefined, }, ],',
    );
    // R160: the ?sort= rides the request too (the whitelisted param the
    // backend route validates).
    expect(page).toContain('if (isRiskSort(sortBy)) params.set("sort", sortBy);');
    expect(page).toContain("getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,");
    expect(page).toContain("initialPageParam: null as string | null,");
    expect(page).toContain("onClick={() => void fetchNextPage()}");
    // The background unfiltered counter query (the 94-C2 chip-counter
    // source swap) + the level-agnostic counts memo.
    expect(page).toContain('queryKey: ["admin-risk-events", "all"],');
    expect(page).toContain('enabled: !!adminToken && canViewRisk && filter !== "all",');
    expect(page).toContain(
      'const countSource = filter === "all" ? events : (allEventsQuery.data?.events ?? events);',
    );
    expect(page).toContain("const counts = useMemo(() => {");
    // The both-queries refresh handler the header CTA fires through.
    expect(page).toContain("refetch();");
    expect(page).toContain("dashboard.refetch();");
    // The RBAC gate + the enabled guards on the main queries.
    expect(page).toContain('const canViewRisk = hasAdminPermission("users");');
    expect(page).toContain("enabled: !!adminToken && canViewRisk,");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the infinite query's key, the counter query's enabled
    // gate and the chip bar's active state all key off the filter atom.
    expect(page).toContain('const [filter, setFilter] = useState<"all" | RiskLevel>("all");');
    // R160 (strengthening, the R159 orders precedent): the ?sort= atom
    // is page-owned too — the extracts (table headers + mobile chips)
    // receive the value + the handleSortBy callback, never a setter.
    expect(page).toContain(
      "const [sortBy, setSortBy] = useState(() => {\n" +
        '    const s = new URLSearchParams(window.location.search).get("sort") ?? "";\n' +
        '    return isRiskSort(s) ? s : "";\n' +
        "  });",
    );
    // The flattened events window the table/mobile extracts + the
    // counts memo + the cascade branches all consume.
    expect(page).toContain(
      "const events = useMemo(() => (eventsPages?.pages ?? []).flatMap((p) => p.events), [eventsPages]);",
    );
    // The deep-link honest-reason gate copy (R125-I4 A3-11).
    expect(page).toContain("مراقبة المخاطر تتطلب صلاحية المستخدمين — تواصل مع مسؤول النظام");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved queue markup rides along verbatim (spot-pins at the new addresses)", () => {
    // The desktop table's sticky-glass header + the whole-row drill-in
    // anchor moved to RiskEventsTable.tsx — risk-error-state /
    // risk-load-more assert this DOM through the page; these spot-pins
    // keep the verbatim shapes at their new address.
    const table = read("src/components/admin/risk/RiskEventsTable.tsx");
    expect(table).toContain("min-w-[720px]");
    // R139 (precision): pin updated with the source — the sticky-glass
    // thead (bg-card/85 + backdrop-blur-md) retired with the r138
    // family's glass ban; the register is the solid bg-muted/30 quiet
    // band + border-b/60 (the OrdersTable header 139-e shipped). The
    // sticky + z-10 long-scroll affordance survives verbatim.
    expect(table).toContain(
      "sticky top-0 z-10 text-xs text-muted-foreground bg-muted/30 border-b border-border/60",
    );
    expect(table).toContain("aria-label={`فتح تحقيق الحدث رقم ${e.id}`}");
    expect(table).toContain("after:absolute after:inset-0 after:content-['']");
    // The mobile card list's score + level shapes.
    const mobile = read("src/components/admin/risk/RiskEventsMobileList.tsx");
    expect(mobile).toContain("{e.score} نقطة");
    expect(mobile).toContain("md:hidden space-y-2.5");
    // The chip bar's aria-pressed toggle + live counters.
    const chips = read("src/components/admin/risk/RiskFilterChips.tsx");
    expect(chips).toContain("aria-pressed={active}");
    expect(chips).toContain('countsReady ? `(${counts[f.value]})` : ""'); // R186 (D-F9): counts render only when countsReady
    // The dashboard panel's R133 triad + the pipeline verdict tile.
    const panel = read("src/components/admin/risk/RiskDashboardPanel.tsx");
    expect(panel).toContain("خط الأنابيب معطَّل (RISK_PIPELINE_ENABLED=false)");
    expect(panel).toContain("تعذّر تحديث المؤشرات — الأرقام المعروضة قديمة");
    expect(panel).toContain('role="alert"');
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state or queries (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: the query states, the filter atom and the
    // counts are passed DOWN, so no extract may grow its own
    // useState/useRef/useEffect/useMemo island — a forked filter atom
    // is how the chip counters' source swap silently breaks.
    const files = [
      "RiskHeader",
      "DashCard",
      "RiskDashboardPanel",
      "RiskFilterChips",
      "RiskEventsTable",
      "RiskEventsMobileList",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/risk/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
      expect(src, name).not.toMatch(/const \[filter, set/);
    }
  });

  it("no extract touches the session-aware fetcher or declares a query (the page owns every risk read)", () => {
    // adminFetchJson + the three queries are page-only surfaces — an
    // extract importing them is a data path that drifted out of
    // orchestration. The panel/table take the flattened values DOWN and
    // report retries/taps through onRetry/onFilterChange callbacks.
    const files = [
      "RiskHeader",
      "DashCard",
      "RiskDashboardPanel",
      "RiskFilterChips",
      "RiskEventsTable",
      "RiskEventsMobileList",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/risk/${name}.tsx`);
      expect(src, name).not.toMatch(/@\/lib\/admin-session/);
      expect(src, name).not.toMatch(/adminFetchJson|adminFetch\b/);
      expect(src, name).not.toMatch(/useQuery|useInfiniteQuery|fetchNextPage|refetch\(\)/);
    }
  });

  it("the risk metadata module is React-free (pure contracts + the level/tone maps)", () => {
    const meta = read("src/components/admin/risk/risk-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The contracts the page's three queries + both list extracts speak.
    expect(meta).toContain('export type RiskLevel = "low" | "medium" | "high" | "critical";');
    expect(meta).toContain("export interface RiskEventRow {");
    expect(meta).toContain("export interface ListResponse {");
    expect(meta).toContain("export interface DashboardResponse {");
    // 93-C7 / C-UX2: the canonical level→tone map + the chip-bar twin
    // (chip + badge can no longer disagree).
    expect(meta).toContain(
      "export const LEVEL_META: Record<RiskLevel, { label: string; tone: StatusBadgeVariant }> = {",
    );
    expect(meta).toContain("export const TONE_CHIP: Record<StatusBadgeVariant, string> = {");
    expect(meta).toContain(
      'export const FILTERS: { value: "all" | RiskLevel; label: string }[] = [',
    );
  });
});
