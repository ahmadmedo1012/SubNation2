/**
 * R137 (FE) — the admin/orders.tsx decomposition contract.
 *
 * The admin orders console was a 1,698-line single component (11
 * useState atoms, 5 effects, the bulk refund money path, the B6-03
 * decrypt-on-demand cache and every presentational section inline in
 * one function) — the R136 checkout.tsx / wallet.tsx precedent (and
 * the R135 product.tsx one before it) applied here: orchestration
 * (pages/admin/orders.tsx) + twelve verbatim extracts under
 * components/admin/orders/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the R120-B4 menu keyboard
 * semantics, the B5-05 refund confirm, the B6-03 expansion fetch) is
 * already pinned by the admin orders render suites
 * (orders-bulk-status / orders-row-expansion-a11y /
 * orders-false-empty-pagination); this file guards the STRUCTURE so
 * the decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,698 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished), and the row
 *      chain (OrdersTable → DesktopOrderRow, MobileOrdersList →
 *      MobileOrderCard, both rows → MaskedCredential) is pinned on
 *      its consumers;
 *   3. money-path ownership — applyBulkStatus (the bulk refund /
 *      status transitions: the B5-02 confirm-with-total, the F-008
 *      per-click Idempotency-Key, the 207 partial-failure parse, the
 *      base-key invalidation) and ensureOrderCredentials (the B6-03
 *      decrypt-on-demand fetch + cache) stay IN the page: a stale
 *      closure in a presentational extract could refund the wrong
 *      intent;
 *   4. state ownership — all 11 cross-section atoms stay centralized
 *      in the page (the bulk bar, the filters, the stats panel, both
 *      row layouts and the credentials cache all key off them); the
 *      extracts take values + callbacks only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/orders.tsx");

describe("R137 (FE) — admin/orders.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/orders.tsx stays under the 1,000-line ceiling (was 1,698 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/orders/orders-csv",
      "@/components/admin/orders/orders-meta",
      "@/components/admin/orders/orders-types",
      "@/components/admin/orders/TableSkeleton",
      "@/components/admin/orders/OrdersHeader",
      "@/components/admin/orders/OrdersStatsPanel",
      "@/components/admin/orders/BulkActionBar",
      "@/components/admin/orders/OrdersFilters",
      "@/components/admin/orders/StaleListErrorBanner",
      "@/components/admin/orders/OrdersEmptyResults",
      "@/components/admin/orders/OrdersTable",
      "@/components/admin/orders/MobileOrdersList",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
    // The row chain rides inside its consumers (never page-rendered):
    // the table renders DesktopOrderRow, the mobile list renders
    // MobileOrderCard, and BOTH rows render MaskedCredential. A dropped
    // link anywhere in that chain silently vanishes a layout, so each
    // hop is pinned on its consumer's source.
    const table = read("src/components/admin/orders/OrdersTable.tsx");
    expect(table).toContain('from "@/components/admin/orders/DesktopOrderRow"');
    const mobileList = read("src/components/admin/orders/MobileOrdersList.tsx");
    expect(mobileList).toContain('from "@/components/admin/orders/MobileOrderCard"');
    for (const rowFile of ["DesktopOrderRow", "MobileOrderCard"]) {
      const src = read(`src/components/admin/orders/${rowFile}.tsx`);
      expect(src, rowFile).toContain('from "@/components/admin/orders/MaskedCredential"');
    }
  });

  it("the money-path handlers stay IN the page (the extracts render; the page owns the refund/decrypt)", () => {
    // applyBulkStatus carries the bulk refund + status transitions —
    // the B5-02 confirm showing the TOTAL LYD to be returned, the
    // F-008/99-C8 per-click Idempotency-Key, the 207 partial-failure
    // parse and the base-key invalidation. It must never drift into a
    // presentational extract where a stale closure could refund the
    // wrong intent.
    expect(page).toContain("const applyBulkStatus = async (status: string) => {");
    expect(page).toContain(
      "const totalRefund = selectedRows.reduce((sum: number, o) => sum + (Number(o.amount) || 0), 0);",
    );
    expect(page).toContain("headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),");
    expect(page).toContain("const failed = body?.failed ?? [];");
    expect(page).toContain("qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey() });");
    // The refund visibility gate (R120-B4 A2-F4) — the finance-scope
    // decision the bulk menu renders from — is page-owned too.
    expect(page).toContain('const canBulkRefund = hasAdminPermission("finance");');
    // B6-03 (R116): the credentials-on-demand DECRYPT path — the
    // audited GET /:id/credentials fetch, the per-order cache fill and
    // the failure memory all stay beside the state they populate.
    // R143 (L13-1): re-anchored fetch→adminFetch — the D-3 timeout
    // threading; the handler's page-ownership intent is unchanged.
    expect(page).toContain("const ensureOrderCredentials = useCallback(");
    expect(page).toContain("adminFetch(`/api/admin/orders/${orderId}/credentials`, { headers })");
    expect(page).toContain("setCredentialsCache((prev) => new Map(prev).set(orderId, body))");
    // The bulk-refund SELECTION inputs are money-action inputs: the
    // R126-L3 membership-honest select-all flag + the row toggles.
    expect(page).toContain(
      "const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));",
    );
    expect(page).toContain("const toggleSelect = useCallback((id: number) => {");
    // And the Arabic refund-failure vocabulary (the 207 partial body's
    // reasons) lives in the pure module the page imports by name —
    // never duplicated inline.
    const meta = read("src/components/admin/orders/orders-meta.ts");
    expect(meta).toContain("const REFUND_FAILURE_LABELS: Record<string, string> = {");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the header count line, the stats panel, the bulk
    // bar, the filter chips, both row layouts and the credentials
    // cache all key off the same atoms — the URL-sync effect spans
    // search/statusFilter/dateRange, applyBulkStatus spans
    // selectedIds/bulkUpdating/bulkStatusOpen.
    for (const atom of [
      "const [statusFilter, setStatusFilter] = useState(",
      "const [search, setSearch] = useState(",
      "const [debouncedSearch, setDebouncedSearch] = useState(search);",
      "const [expandedRow, setExpandedRow] = useState<number | null>(null);",
      "const [dateRange, setDateRange] = useState(() => {",
      // R159: the ?sort= state joined the census — the server-side sort
      // param rides the query key, so the atom must stay page-owned (an
      // extract re-declaring it would desync the URL write-back).
      "const [sortBy, setSortBy] = useState(() => {",
      "const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());",
      "const [showStats, setShowStats] = useState(true);",
      "const [bulkStatusOpen, setBulkStatusOpen] = useState(false);",
      "const [bulkUpdating, setBulkUpdating] = useState(false);",
      "const [credentialsCache, setCredentialsCache] = useState<Map<number, OrderCredentials>>(",
      "const [failedCredentialIds, setFailedCredentialIds] = useState<Set<number>>(() => new Set());",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The refs and the memo chain stay with them.
    expect(page).toContain("const bulkMenuTriggerRef = useRef<HTMLButtonElement>(null);");
    expect(page).toContain("const credentialsInFlight = useRef<Set<number>>(new Set());");
    expect(page).toContain("const allOrders = useMemo(");
    expect(page).toContain("const filtered = useMemo(() => {");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved money-path markup rides along verbatim (the render suites' DOM pins follow the surface)", () => {
    // orders-bulk-status.test.tsx finds the menu via the trigger's
    // parentElement — the relative wrapper + the role="menu" contract
    // must stay inside BulkActionBar exactly as they were inline.
    const bulk = read("src/components/admin/orders/BulkActionBar.tsx");
    expect(bulk).toContain('aria-label="تغيير الحالة الجماعي"');
    expect(bulk).toContain('(s) => s.value !== "refunded" || canBulkRefund');
    // R160: ellipsis dialect — ASCII ... → «…» with the source copy.
    expect(bulk).toContain("جارٍ التحديث…");
    // The refund confirm copy the A5 O-3 test reads is built by the
    // page's applyBulkStatus from the LIVE selection — pinned above at
    // its owner; the desktop/mobile rows carry the R117 decrypt signal.
    const desktopRow = read("src/components/admin/orders/DesktopOrderRow.tsx");
    const mobileCard = read("src/components/admin/orders/MobileOrderCard.tsx");
    for (const src of [desktopRow, mobileCard]) {
      expect(src).toContain("تعذّر فك التشفير");
    }
    // The honest-counts footer line moved with the table.
    const table = read("src/components/admin/orders/OrdersTable.tsx");
    expect(table).toContain("انقر على الصف لعرض بيانات التسليم");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a section needs is passed DOWN,
    // so no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the orders console is how a stale selection
    // could refund the wrong rows.
    const files = [
      "TableSkeleton",
      "OrdersHeader",
      "OrdersStatsPanel",
      "BulkActionBar",
      "OrdersFilters",
      "StaleListErrorBanner",
      "OrdersEmptyResults",
      "OrdersTable",
      "MobileOrdersList",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/orders/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the row leaf owns ONLY its 96-F7 reveal toggle (the R135 CopyField precedent — no page state)", () => {
    // MaskedCredential was already a self-contained component inside
    // the page file: the reveal state must reset (re-mask) when the
    // row collapses — the whole 96-F7 contract — so it moves WITH the
    // leaf (exactly like components/product/CopyField.tsx in R135).
    // It owns exactly that one useState and nothing else: no refs, no
    // effects, no page atoms.
    const masked = read("src/components/admin/orders/MaskedCredential.tsx");
    expect(masked).toContain("const [revealed, setRevealed] = useState(false);");
    expect(masked).not.toMatch(/useRef\(|useEffect\(|useMemo\(|useCallback\(/);
    expect(masked).not.toMatch(/selectedIds|credentialsCache|expandedRow|bulkStatusOpen/);
  });

  it("the orders helper modules are React-free (pure meta/csv/types — importable by any lane)", () => {
    const files = ["orders-csv", "orders-meta", "orders-types"];
    for (const name of files) {
      const src = read(`src/components/admin/orders/${name}.ts`);
      expect(src, name).not.toMatch(/from "react"|from "lucide-react"/);
    }
    // The 94-C2 frozen server-side page size — the load-more contract
    // the query config and getNextPageParam both key off.
    expect(read("src/components/admin/orders/orders-meta.ts")).toContain(
      "const ORDERS_PAGE_SIZE = 100;",
    );
    // The CSV ritual stays a pure, argument-taking module (the page's
    // export handlers own WHICH rows and WHICH filename).
    const csv = read("src/components/admin/orders/orders-csv.ts");
    expect(csv).toContain("export function downloadCsv(");
    expect(csv).toContain("export function orderCsvRows(");
  });
});

describe("R187 (D-F8) — the stats panel toggle exposes its expanded state", () => {
  it("OrdersStatsPanel's toggle button carries aria-expanded (the sibling collapsible idiom)", () => {
    // Every sibling collapsible (StockoutRiskPanel, the products editor,
    // UsersToolbar) carries aria-expanded — the stats panel's toggle was
    // the lone miss, leaving AT users without the collapsed/expanded
    // verdict on the orders console.
    const panel = read("src/components/admin/orders/OrdersStatsPanel.tsx");
    expect(panel).toContain("aria-expanded={showStats}");
  });
});
