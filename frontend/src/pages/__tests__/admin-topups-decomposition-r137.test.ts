/**
 * R137 (FE) — the admin/topups.tsx decomposition contract.
 *
 * The admin money queue was a 1,609-line single component (10 useState
 * atoms, the accumulating infinite query, both single-item mutations
 * with their per-click Idempotency-Key, the bulk + approve-all money
 * loops, and every presentational card / dialog / tab inline in one
 * function) — the R136 checkout.tsx precedent (1,665 → 9 extracts)
 * applied here: orchestration (pages/admin/topups.tsx) + eleven
 * verbatim extracts under components/admin/topups/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the F-008
 * per-click / per-iteration Idempotency-Key lifecycle, the guarded
 * dismiss + ⌘/Ctrl+Enter submit) is already pinned by the admin
 * topup/wallet money suites; this file guards the STRUCTURE so the
 * decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,609 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (directly, or by its consumer extract for the nested atoms —
 *      a dropped import = a section silently vanished);
 *   3. money-path ownership — handleApprove (the confirm-gated single
 *      credit), handleReject, handleBulkAction and approveAll (the
 *      sequential loops with the per-topup F-008 keys) + both
 *      mutations stay IN the page: a stale closure in a presentational
 *      extract could approve the wrong topup;
 *   4. state ownership — all 10 cross-section atoms stay centralized
 *      in the page (the bulk bar spans seven of them); the extracts
 *      take values + callbacks only. The two dialog shells are the
 *      documented exception: their field-local note draft (ONE
 *      useState + the open-reset effect, verbatim from the monolith)
 *      never coordinates anything — the money POST fires only through
 *      the page-owned onConfirm handlers they call;
 *   5. purity — the queue metadata module is React-free, and no
 *      extract touches the money APIs (react-query / api-client /
 *      idempotency keys).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/topups.tsx");

describe("R137 (FE) — admin/topups.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/topups.tsx stays under the 1,000-line ceiling (was 1,609 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/topups/topups-queue-meta",
      "@/components/admin/topups/TopupCard",
      "@/components/admin/topups/TopupCardSkeleton",
      "@/components/admin/topups/RejectModal",
      "@/components/admin/topups/BulkConfirmModal",
      "@/components/admin/topups/TopupsHeader",
      "@/components/admin/topups/TopupsToolbar",
      "@/components/admin/topups/TopupsEmptyStates",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the nested atoms are still imported by their consumers (MethodBadge / NetworkBadge / StatusFilterTabs)", () => {
    // The badges render inside TopupCard's rows and the tab bar inside
    // TopupsToolbar's flex row — the page has no direct call site for
    // them, so the deletion guard rides the CONSUMER's import (the
    // r136 LedgerEntryRow / TransferCodePanel precedent).
    const card = read("src/components/admin/topups/TopupCard.tsx");
    expect(card).toContain('from "@/components/admin/topups/MethodBadge"');
    expect(card).toContain('from "@/components/admin/topups/NetworkBadge"');
    const toolbar = read("src/components/admin/topups/TopupsToolbar.tsx");
    expect(toolbar).toContain('from "@/components/admin/topups/StatusFilterTabs"');
  });

  it("the money-path handlers + their Idempotency-Key lifecycle stay IN the page (the extracts render; the page owns the credit)", () => {
    // handleApprove carries the confirm-gated single credit (amount +
    // user + payment reference surfaced before the POST fires);
    // handleReject feeds rejectMutation; handleBulkAction + approveAll
    // carry the sequential loops with one fresh F-008 key PER TOPUP.
    // None may drift into a presentational extract where a stale
    // closure could approve the wrong topup.
    expect(page).toContain("const handleApprove = useCallback(");
    expect(page).toContain("const handleReject = useCallback(");
    expect(page).toContain("const handleBulkAction = async (");
    expect(page).toContain("const approveAll = async (");
    expect(page).toContain("const approveMutation = useMutation({");
    expect(page).toContain("const rejectMutation = useMutation({");
    expect(page).toContain("approveMutation.mutate({");
    expect(page).toContain("rejectMutation.mutate({");
    // F-008: the per-click key (single actions) and the per-iteration
    // key (bulk loops) — generated in the page, threaded via
    // withIdempotencyKey into the generated fetchers.
    expect(page).toContain("idempotencyKey: generateIdempotencyKey()");
    expect(page).toContain("headers: withIdempotencyKey(headers, idempotencyKey),");
    expect(page).toContain("headers: withIdempotencyKey(jsonHeaders, generateIdempotencyKey()),");
    // R127-L1: the 401 break the money loops ride — imported by name
    // from the pure module, never duplicated inline in an extract.
    expect(page).toContain("if (isSessionExpiredError(e)) {");
    const meta = read("src/components/admin/topups/topups-queue-meta.ts");
    expect(meta).toContain("export function isSessionExpiredError(");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the tab query key, the search filter, the row/busy/
    // selection flips, the two dialog mounts and the bulk bar all key
    // off the same atoms — selectedPendingCount alone spans
    // selectedIds × pendingTopups, and the ESC shortcut reads
    // rejectTarget × processingId × bulkAction × isBulkProcessing ×
    // isApproveAllBusy.
    for (const atom of [
      "const [statusFilter, setStatusFilter] = useState(() => {",
      'const [search, setSearch] = useState("");',
      'const [debouncedSearch, setDebouncedSearch] = useState("");',
      "const [processingId, setProcessingId] = useState<number | null>(null);",
      "const [rejectTarget, setRejectTarget] = useState<AdminTopupRow | null>(null);",
      "const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());",
      'const [bulkAction, setBulkAction] = useState<"approve" | "reject" | "approveAll" | null>(null);',
      "const [isBulkProcessing, setIsBulkProcessing] = useState(false);",
      "const [isApproveAllBusy, setIsApproveAllBusy] = useState(false);",
      "const [approveAllProgress, setApproveAllProgress] = useState<{",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The query + the memo chain the extracts consume as props (the
    // memoized allTopups → topups/pendingTopups identities are what
    // keep the React.memo rows bailing on keystrokes).
    expect(page).toContain("useInfiniteQuery<AdminTopupRow[], Error>({");
    expect(page).toContain('queryKey: ["/api/admin/topups", "load-more", topupsListParams],');
    expect(page).toContain("const allTopups = useMemo(");
    expect(page).toContain("const topups = useMemo(() => {");
    expect(page).toContain("const pendingTopups = useMemo(");
    // The selection handlers feed the bulk money bar — page-owned.
    expect(page).toContain("const handleSelect = useCallback(");
    expect(page).toContain("const handleSelectAll = useCallback(");
    // And the single-approve confirm gate (93-C6 / F-07 T-1) mounts in
    // the page — the money-CREATING action's friction stays here.
    expect(page).toContain("const { confirm, ConfirmDialog } = useConfirm();");
  });

  it("the moved money-adjacent markup rides along verbatim (spot-pins at the new address)", () => {
    // The row's money actions + the R125-I2 aria contract moved to
    // TopupCard.tsx — these spot-pins keep the verbatim shapes at
    // their new address so the existing render pins stay meaningful.
    const card = read("src/components/admin/topups/TopupCard.tsx");
    expect(card).toContain("aria-label={`تحديد طلب الشحن ${t.id} للإجراء الجماعي`}");
    expect(card).toContain('{isProcessing && !isRejecting ? "جارٍ..." : "موافقة"}');
    expect(card).toContain("aria-pressed={isSelected}");
    // The deep-link write-back rode along with the tab's verbatim
    // onClick (the statusFilter atom + initializer stay in the page).
    // R159 (IMPL-A): the pill markup retired for ui/filter-tabs — the
    // write-back stays in the twin's onSelect wrapper (verbatim), and
    // aria-pressed arrives from the primitive (pinned by its own suite
    // + topups-status-tab-query's render assertions).
    const tabs = read("src/components/admin/topups/StatusFilterTabs.tsx");
    expect(tabs).toContain('from "@/components/ui/filter-tabs"');
    expect(tabs).toContain("value={statusFilter}");
    expect(tabs).toContain("window.history.replaceState(");
    // The dialog shells kept their guarded ⌘/Ctrl+Enter submit and the
    // live money-loop counter (byte-identical).
    const reject = read("src/components/admin/topups/RejectModal.tsx");
    expect(reject).toContain(
      'if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !loading) onConfirm(note);',
    );
    const bulk = read("src/components/admin/topups/BulkConfirmModal.tsx");
    expect(bulk).toContain("`جاري ${progress.done}/${progress.total}...`");
    // The stat strip kept the pending chip + the honest search count.
    const header = read("src/components/admin/topups/TopupsHeader.tsx");
    expect(header).toContain("{pendingCount} قيد الانتظار");
    expect(header).toContain("نتائج البحث: {formatCount(topups.length, TOPUP_COUNT_FORMS)}");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a section needs is passed DOWN,
    // so no extract may grow its own useState/useRef/useEffect/useMemo
    // island — duplicated truth on the money queue is how the R98-01
    // / R123-class desync bugs happen. The two dialog shells are pinned
    // separately below (their field-local note draft is the documented,
    // verbatim exception — it coordinates nothing).
    const files = [
      "MethodBadge",
      "NetworkBadge",
      "TopupCard",
      "TopupCardSkeleton",
      "TopupsHeader",
      "TopupsToolbar",
      "StatusFilterTabs",
      "TopupsEmptyStates",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/topups/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
    // And none of them re-declares a page atom's identifier either.
    for (const name of files) {
      const src = read(`src/components/admin/topups/${name}.tsx`);
      expect(src, name).not.toMatch(
        /const \[(statusFilter|search|debouncedSearch|processingId|rejectTarget|selectedIds|bulkAction|isBulkProcessing|isApproveAllBusy|approveAllProgress), set/,
      );
    }
  });

  it("the dialog shells keep ONLY their field-local note draft (never a money atom or API)", () => {
    // RejectModal / BulkConfirmModal moved verbatim: each carries exactly
    // ONE useState (the optional note textarea) + the open-reset effect.
    // The money POST, its Idempotency-Key, rejectTarget/processingId/
    // bulkAction/loading/progress all stay in the page and flow down as
    // props; the shells submit via onConfirm(note) and nothing else.
    for (const name of ["RejectModal", "BulkConfirmModal"]) {
      const src = read(`src/components/admin/topups/${name}.tsx`);
      expect(src.match(/useState\(/g) ?? [], name).toHaveLength(1);
      expect(src.match(/useEffect\(/g) ?? [], name).toHaveLength(1);
      expect(src, name).not.toMatch(/useCallback\(|useMemo\(|useRef\(/);
      expect(src, name).not.toMatch(
        /const \[(rejectTarget|processingId|selectedIds|bulkAction|isBulkProcessing|isApproveAllBusy|approveAllProgress), set/,
      );
    }
  });

  it("no extract touches the money APIs (the page owns every credit/reject POST)", () => {
    // react-query, the generated topup fetchers and the idempotency-key
    // machinery are page-only surfaces — an extract importing any of
    // them is a money path that drifted out of orchestration.
    const files = [
      "MethodBadge",
      "NetworkBadge",
      "TopupCard",
      "TopupCardSkeleton",
      "RejectModal",
      "BulkConfirmModal",
      "TopupsHeader",
      "TopupsToolbar",
      "StatusFilterTabs",
      "TopupsEmptyStates",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/topups/${name}.tsx`);
      expect(src, name).not.toMatch(/@tanstack\/react-query|@workspace\/api-client-react/);
      expect(src, name).not.toMatch(/generateIdempotencyKey|withIdempotencyKey/);
      expect(src, name).not.toMatch(/\bapproveTopup\b|\brejectTopup\b/);
    }
  });

  it("the queue metadata module is React-free (pure tables + predicates — importable by any lane)", () => {
    const meta = read("src/components/admin/topups/topups-queue-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The statusLabel-derived tab list (R124-I5 A6 F2: one Arabic word
    // per status — the status-badge invariant).
    expect(meta).toContain("export const STATUS_FILTERS = [");
    // The frozen `?page=&limit=` contract's page size (94-C2 A2 P1-1).
    expect(meta).toContain("export const TOPUPS_PAGE_SIZE = 100;");
    // The Arabic plural forms the count lines + toasts ride (A2 P3-4).
    expect(meta).toContain("export const TOPUP_COUNT_FORMS = {");
    // The row type both the page and the extracts speak.
    expect(meta).toContain("export type AdminTopupRow = AdminTopup &");
    // The 401 predicate the money loops break on (R127-L1 B1 §3.2).
    expect(meta).toContain("export function isSessionExpiredError(");
    expect(meta).toContain("?.status === 401;");
  });
});
