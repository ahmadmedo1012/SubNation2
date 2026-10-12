/**
 * R137 (FE) — the admin/referrals.tsx decomposition contract.
 *
 * The referral page was a 602-line single component (4 useState atoms +
 * the 300ms search debounce effect, the params-in-queryKey list query
 * with keepPreviousData, the useCallback-stable confirm-gated +
 * idempotency-keyed points-mint POST, the memoized row component, and
 * every presentational section inline in one function) — the R136
 * checkout.tsx precedent (1,665 → 9 extracts) applied here:
 * orchestration (pages/admin/referrals.tsx) + eight verbatim extracts
 * under components/admin/referrals/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the R98-02 last-REQUEST-wins
 * search race, the finance scope gate, the credit confirm + invalidation)
 * is already pinned by the referrals-search-race / referrals-finance-gate
 * / referrals-error-state / referrals-401-redirect render suites; this
 * file guards the STRUCTURE so the decomposition cannot silently
 * regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      602 lines; the ceiling leaves room to grow without re-ballooning
 *      into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. money-path ownership — handleCredit (the confirm-gated
 *      points-mint POST with its Idempotency-Key header + the base-key
 *      invalidation) and the search-race guards (the debounce →
 *      debouncedSearch → params-in-queryKey swap) stay IN the page:
 *      a stale closure in a presentational extract could double-mint
 *      LYD-convertible points or overwrite a newer search window;
 *   4. state ownership — all 4 atoms (search/statusFilter/debounce/
 *      crediting) stay centralized in the page; the extracts take
 *      values + callbacks only (the memoized row's bailout contract);
 *   5. purity — the referrals metadata module is React-free, and no
 *      extract touches the generated client, the fetcher or re-declares
 *      a handler.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/referrals.tsx");

describe("R137 (FE) — admin/referrals.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/referrals.tsx stays under the 1,000-line ceiling (was 602 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/referrals/referrals-meta",
      "@/components/admin/referrals/ReferralsHeader",
      "@/components/admin/referrals/ReferralsStats",
      "@/components/admin/referrals/TopReferrersList",
      "@/components/admin/referrals/ReferralsFilters",
      "@/components/admin/referrals/ReferralsTable",
      "@/components/admin/referrals/ReferralsTableSkeleton",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
    // Nested consumer: the table renders the memoized rows — a dropped
    // ReferralRowItem import is a vanished list body.
    const table = read("src/components/admin/referrals/ReferralsTable.tsx");
    expect(table).toContain('from "@/components/admin/referrals/ReferralRowItem"');
  });

  it("the money-path handler + the search-race guards stay IN the page (the extracts render; the page owns the mint + the race)", () => {
    // handleCredit carries the confirm-gated points-mint POST — the
    // 93-C6/F-07 money confirmation (LYD-equivalent preview), the
    // idempotency key riding options.headers and the base-key
    // invalidation. It must never drift into a presentational extract
    // where a stale closure could double-mint points.
    expect(page).toContain("const handleCredit = useCallback(");
    expect(page).toContain('title: "تأكيد منح النقاط",');
    expect(page).toContain("withIdempotencyKey(headers, generateIdempotencyKey())");
    expect(page).toContain("await creditReferral(row.id, {");
    expect(page).toContain(
      "void queryClient.invalidateQueries({ queryKey: getListAdminReferralsQueryKey() });",
    );
    expect(page).toContain("if (isSessionExpiredError(err)) return;");
    // The R98-02 last-REQUEST-wins contract is now structural (R127-L1):
    // the 300ms debounce feeds debouncedSearch, and the params sit IN
    // the queryKey so a stale response can only land in the OLD key's
    // cache — all three pieces live beside the atoms they supersede.
    expect(page).toContain('const [debouncedSearch, setDebouncedSearch] = useState("");');
    expect(page).toContain("const t = setTimeout(() => setDebouncedSearch(search), 300);");
    expect(page).toContain("queryKey: getListAdminReferralsQueryKey(referralsParams),");
    expect(page).toContain("placeholderData: keepPreviousData,");
    expect(page).toContain("enabled: !!adminToken && canView,");
    // The distinct error surface (B5-03) + the finance scope gate.
    expect(page).toContain("listQuery.isError && !isSessionExpiredError(listQuery.error)");
    expect(page).toContain('const canCredit = hasAdminPermission("finance");');
    // The confirm gate is page-owned too.
    expect(page).toContain("const { confirm, ConfirmDialog } = useConfirm();");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the chip bar, the search box, the debounced query
    // params and the per-row busy guard all key off these atoms — the
    // memoized rows' bailout-on-keystroke contract needs them stable.
    for (const atom of [
      'const [statusFilter, setStatusFilter] = useState("");',
      'const [search, setSearch] = useState("");',
      'const [debouncedSearch, setDebouncedSearch] = useState("");',
      "const [crediting, setCrediting] = useState<number | null>(null);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // R124-I5 (A6 F4): the memoized list identity (the rows bail out
    // on keystrokes because `?? []` no longer mints per render).
    expect(page).toContain("const list = useMemo(() => data?.list ?? [], [data]);");
    // The page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved money-adjacent markup rides along verbatim (spot-pins at the new addresses)", () => {
    // The memoized row's credit affordance + the credited bookkeeping
    // moved to ReferralRowItem.tsx — referrals-finance-gate asserts the
    // disabled DOM through the page; these spot-pins keep the verbatim
    // shapes at their new address.
    const row = read("src/components/admin/referrals/ReferralRowItem.tsx");
    expect(row).toContain("disabled={crediting || !canCredit}");
    expect(row).toContain('title={canCredit ? undefined : "يتطلب صلاحية المالية"}');
    expect(row).toContain("+{row.points_earned}");
    expect(row).toContain("قُيِِّد: {formatRelativeTime(row.credited_at)}");
    // The table's honest server-cap footer + the md header geometry.
    const table = read("src/components/admin/referrals/ReferralsTable.tsx");
    expect(table).toContain("hidden md:grid grid-cols-[1fr_1fr_100px_130px_90px]");
    expect(table).toContain("`عرض ${list.length} (الأحدث أولاً)`");
    expect(table).toContain("الإحالات المعلقة بانتظار أول شحن من المُحال");
    // The medal leaderboard + the search box the race suite types into.
    const leaderboard = read("src/components/admin/referrals/TopReferrersList.tsx");
    expect(leaderboard).toContain("أكثر المستخدمين إحالةً");
    expect(leaderboard).toContain("MEDAL_COLORS[i]");
    const filters = read("src/components/admin/referrals/ReferralsFilters.tsx");
    expect(filters).toContain('placeholder="بحث برقم المُحيل أو المُحال..."');
    expect(filters).toContain("onSearchChange(e.target.value)");
    // The stats strip (hidden until the first successful load — B5-03).
    const stats = read("src/components/admin/referrals/ReferralsStats.tsx");
    expect(stats).toContain('label="نقاط ممنوحة إجمالاً"');
    expect(stats).toContain('value={stats?.total ?? "—"}');
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: the search/statusFilter atoms, the stats
    // window and the busy ids are passed DOWN, so no extract may grow
    // its own useState/useRef/useEffect/useMemo island — a forked
    // search atom is how the R98-02 race guard silently breaks. The
    // R118-B2 React.memo on the row rides along (it is not a hook).
    const files = [
      "ReferralsHeader",
      "ReferralsStats",
      "TopReferrersList",
      "ReferralsFilters",
      "ReferralRowItem",
      "ReferralsTable",
      "ReferralsTableSkeleton",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/referrals/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
      expect(src, name).not.toMatch(/const \[(statusFilter|search|debouncedSearch|crediting), set/);
    }
  });

  it("no extract touches the generated client or the credit path (the page owns every referral POST)", () => {
    // The list query, creditReferral and the idempotency machinery are
    // page-only surfaces — an extract importing them is a money path
    // that drifted out of orchestration (and a vi.mock boundary the
    // render suites own). The rows report taps through the page-owned
    // onCredit callback and nothing else.
    const files = [
      "ReferralsHeader",
      "ReferralsStats",
      "TopReferrersList",
      "ReferralsFilters",
      "ReferralRowItem",
      "ReferralsTable",
      "ReferralsTableSkeleton",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/referrals/${name}.tsx`);
      expect(src, name).not.toMatch(/@workspace\/api-client-react/);
      expect(src, name).not.toMatch(/creditReferral|useListAdminReferrals|handleCredit/);
      expect(src, name).not.toMatch(/generateIdempotencyKey|withIdempotencyKey/);
    }
  });

  it("the referrals metadata module is React-free (pure contracts + the server-cap mirror)", () => {
    const meta = read("src/components/admin/referrals/referrals-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The row contract (the generated AdminReferralEventRow alias) the
    // page + both consumer extracts speak — type-only, re-exported so
    // the extracts never import the generated package directly.
    expect(meta).toContain("export type ReferralRow = AdminReferralEventRow;");
    // The 401 predicate the page's error surfaces duck-type with.
    expect(meta).toContain("export function isSessionExpiredError(err: unknown): boolean {");
    // The status chip list + the --tier-* medal trio (A1-D10/F3).
    expect(meta).toContain("export const STATUS_FILTERS = [");
    expect(meta).toContain("export const MEDAL_COLORS = [");
    expect(meta).toContain("text-tier-silver");
    // R125-I3 (A2-5): the backend list route's LIMIT 200 mirror the
    // honest-cap footer wording consumes by name.
    expect(meta).toContain("export const REFERRALS_SERVER_CAP = 200;");
  });
});
