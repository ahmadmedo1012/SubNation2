/**
 * R167 (FE) — the orders.tsx decomposition contract (F11).
 *
 * The storefront orders page was the last big page without a
 * components/<page>/ extract family (the R136 wallet / R137 admin
 * precedent): at 706 lines it carried the R165/R166 cluster divider,
 * the filtered-empty pair, StatusIcon/statusAccentBorder/STAGGER and
 * the full ~180-line order row inline. The family opened in wave 1
 * (OrderClusterDivider + OrdersEmptyResults) and wave 2 (R167-A2)
 * landed the headline cut: components/orders/OrderRow — the row card
 * verbatim, with its atoms (STAGGER, StatusIcon, statusAccentBorder)
 * as module-private members.
 *
 * WAVE 2 OF 2 — the prerequisite landed first, in the same round: the
 * four source-scan suites that owned the row's markup at the PAGE
 * address were re-pointed to the page ∪ family surface BEFORE the
 * move (the R146 CopyField / R158 filter-tabs "pin follows the
 * surface" precedent):
 *
 *   - image-discipline-r140: orders.tsx's SITES entry swapped for
 *     components/orders/OrderRow.tsx (the row's product thumb is the
 *     page's only <img> — lazy/async/450×450 now pinned at the
 *     extract);
 *   - pages-contracts-r143: the dir="auto" truncating
 *     {order.product_name} site re-pointed to the extract;
 *   - semantics-depth-r140: the dir="ltr" order-code/coupon chips
 *     read the orders surface (page ∪ its extracts);
 *   - account-surfaces-visual-r139: card-spring +
 *     statusAccentBorder's "border-r-status-info/55" read the page ∪
 *     family dir (the chip TONES stay page-owned — see below);
 *   - storefront-r125-sweep: the B-2 net sweeps components/orders/,
 *     and the B-6/B-12 orders entries read the family surface.
 *
 * Rendered DOM machine-verified byte-identical across the move (12
 * pinned render states, old vs new innerHTML) — plus the render
 * suites: orders-load-more / orders-filter-url / orders-error-state /
 * orders-group-clustering-r165 / order-refund-receipt.
 *
 * The F15 10th site: the page's fetch-error description now rides
 * NETWORK_ERROR_DESCRIPTION from @/lib/errors (the R167-E single
 * source) — the last of the ten byte-identical sites.
 *
 * These are SOURCE-scan pins (the r136/r137 idiom — structural
 * invariants a render test only covers incidentally):
 *
 *   1. size ceiling — the page keeps shrinking per wave (706 at
 *      decomposition, 633 after wave 1, 436 after wave 2); the
 *      ceiling leaves room to grow without re-ballooning;
 *   2. deletion guards — every extract is still imported by the
 *      page, and the moved Arabic copy lives at the extract's new
 *      address (a dropped import = a vanished section);
 *   3. data ownership — the page's data machine stays IN the page
 *      (the ?filter= mirror, the accumulating query, the bucket
 *      memos, the cluster runs, the filter-chip dial); the extracts
 *      take values + callbacks only;
 *   4. statelessness — no extract may grow its own state island.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/orders.tsx");
const divider = read("src/components/orders/OrderClusterDivider.tsx");
const emptyResults = read("src/components/orders/OrdersEmptyResults.tsx");
const row = read("src/components/orders/OrderRow.tsx");

describe("R167 (FE) — orders.tsx decomposition (F11): page stays the data machine", () => {
  it("pages/orders.tsx stays under the 470-line ceiling (was 706 at decomposition; 633 after wave 1; 436 after the wave-2 OrderRow cut)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(470);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    expect(page).toContain('from "@/components/orders/OrderClusterDivider"');
    expect(page).toContain('from "@/components/orders/OrdersEmptyResults"');
    expect(page).toContain('from "@/components/orders/OrderRow"');
    // The call sites: the row takes the order + its visible-list
    // position (the stagger index) — nothing else crosses the seam.
    expect(page).toContain("<OrderRow order={order} index={i} />");
    expect(page).toContain("<OrderClusterDivider runCount={clusterRun} />");
  });

  it("the moved markup rides along verbatim (the render suites' DOM pins follow the surface)", () => {
    // The R165/R166 divider chip — orders-group-clustering-r165's
    // run-count assertions read this copy at its new address.
    expect(divider).toContain("عملية شراء واحدة");
    expect(divider).toContain("formatCount(runCount, ORDER_COUNT_FORMS_SUBJECT)");
    // The R120-B7/R135 filtered-empty pair — orders-load-more's
    // honest-completeness branch + the drop-the-filter branch.
    expect(emptyResults).toContain("لا طلبات مطابقة ضمن الصفحات المحمّلة");
    expect(emptyResults).toContain("قد تكون النتائج غير مكتملة — حمّل المزيد لعرض الكل");
    expect(emptyResults).toContain("لا توجد طلبات في هذه الفئة");
    expect(emptyResults).toContain("<LoadMoreButton");
    expect(emptyResults).toContain("busy={loadingMore}");
    expect(emptyResults).toContain("disabled={parentLoading}");
    // The row card — the R115-I1 refund receipt chip + the R143
    // dir="auto" name line + the R-140-a image discipline attrs, all
    // byte-pinned at the extract's address now.
    expect(row).toContain("card-spring hover:border-border hover:shadow-xl");
    expect(row).toContain("border-r-[3px] ${statusAccentBorder(order.status)}");
    expect(row).toContain('"border-r-status-info/55"');
    expect(row).toContain("استُرد {formatCurrency(order.amount)} إلى محفظتك");
    expect(row).toContain("dir=");
    expect(row).toContain('loading="lazy"');
    expect(row).toContain("width={450}");
    expect(row).toContain("height={450}");
    // The row's forward affordance rides the RTL icon law (left-pointing
    // = forward, the OrderGroupChip ArrowLeft convention).
    expect(row).toContain("<ChevronLeft");
  });

  it("the data machine stays IN the page (the ?filter= mirror, the accumulating query, the buckets, the cluster runs)", () => {
    // A9-3 (R126-L6): the ?filter= deep-link whitelist read + the
    // replaceState write-back (orders-filter-url pins the behavior).
    expect(page).toContain("function readInitialFilterFromUrl(): OrderFilter {");
    expect(page).toContain('qs.set("filter", filter)');
    expect(page).toContain("window.history.replaceState(");
    // R120-B7 (A6-F1): the accumulating list query + the frozen
    // plain-array end-of-pages contract.
    expect(page).toContain("`/api/orders?page=${pageParam as number}`");
    expect(page).toContain("const ORDERS_PAGE_SIZE = 200;");
    // R146 (F5): the memoized buckets + the R165 cluster computation.
    expect(page).toContain("const [pending, completed, failed] = useMemo(");
    expect(page).toContain("computeOrderGroupClusters(visibleOrders)");
    // R158 (ledger b): the chip dial data — the tones stay page-owned
    // (account-surfaces-visual-r139 pins them at this address; the
    // buckets they read are page state, so the dial is data machine,
    // not presentational markup — the cut was deliberately NOT taken).
    expect(page).toContain('tone: "warning"');
    expect(page).toContain('tone: "success"');
    expect(page).toContain('tone: "info"');
  });

  it("the row atoms moved WITH the row (they have no other consumer — page-side re-declaration is a drift, not a fallback)", () => {
    // STAGGER / StatusIcon / statusAccentBorder live at the extract
    // address now; if they reappear in the page the two copies WILL
    // drift apart (the account-surfaces pins would keep passing on
    // the union while the page renders its stale twin).
    expect(page).not.toContain("const STAGGER = [");
    expect(page).not.toContain("function StatusIcon(");
    expect(page).not.toContain("function statusAccentBorder(");
    expect(row).toContain("const STAGGER = [");
    expect(row).toContain("function StatusIcon({ status }: { status: string }) {");
    expect(row).toContain("function statusAccentBorder(status: string): string {");
    // The stagger clamp computation rides the position prop.
    expect(row).toContain('STAGGER[Math.min(index, 12)] ?? ""');
    // And the first-run hero stays beside its EmptyHero import
    // (skeleton-primitives' adoption floor pins the page address).
    expect(page).toContain("<EmptyHero");
    expect(page).toContain("لا توجد طلبات بعد");
  });

  it("R167-E (F15, the 10th site): the fetch-error description rides the shared NETWORK_ERROR_DESCRIPTION constant", () => {
    // The last of the ten byte-identical sites — the page imports the
    // constant and never re-types the literal (the render suites pin
    // the identical output; orders-error-state reads the card).
    expect(page).toContain(
      'import { getErrorMessage, NETWORK_ERROR_DESCRIPTION } from "@/lib/errors";',
    );
    expect(page).toContain("description={NETWORK_ERROR_DESCRIPTION}");
    expect(page).not.toContain("تحقّق من شبكتك ثم أعد المحاولة");
  });
});

describe("R167 (FE) — the orders extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    const files: Array<[string, string]> = [
      ["OrderClusterDivider", divider],
      ["OrdersEmptyResults", emptyResults],
      ["OrderRow", row],
    ];
    for (const [name, src] of files) {
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("the divider takes exactly the run count (the page owns WHICH index starts a run)", () => {
    expect(divider).toContain(
      "export function OrderClusterDivider({ runCount }: { runCount: number }) {",
    );
    // It renders; it never computes the runs itself.
    expect(divider).not.toContain("computeOrderGroupClusters");
    expect(divider).not.toContain("groupClusters");
  });

  it("the filtered-empty pair takes the honesty inputs + the two callbacks", () => {
    for (const prop of [
      "hasNextPage: boolean;",
      "loadingMore: boolean;",
      "parentLoading: boolean;",
      "onLoadMore: () => void;",
      "onShowAll: () => void;",
    ]) {
      expect(emptyResults, prop).toContain(prop);
    }
    // And the first-run hero deliberately did NOT move with it.
    expect(emptyResults).not.toContain("EmptyHero");
    expect(emptyResults).not.toContain("لا توجد طلبات بعد");
  });

  it("the row takes the order + its position — and re-derives nothing the page owns", () => {
    expect(row).toContain(
      "export function OrderRow({ order, index }: { order: Order; index: number }) {",
    );
    // It renders; it never queries, filters or clusters.
    expect(row).not.toContain("useInfiniteQuery");
    expect(row).not.toContain("computeOrderGroupClusters");
    expect(row).not.toMatch(/customFetch|fetch\(/);
  });
});
