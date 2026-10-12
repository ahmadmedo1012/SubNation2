/**
 * R137 (FE) — the admin/tickets.tsx decomposition contract.
 *
 * The support queue was an 847-line single component (6 useState atoms
 * + the messagesEndRef, the accumulating infinite query with its
 * dedup-by-id memo, the two-way ?status=/?category= URL sync, the
 * openTicket decrypt-on-demand detail fetch, the reply + status money
 * handlers with their stats co-invalidation, and every presentational
 * card / chip bar / empty branch / detail pane inline in one function)
 * — the R136 checkout.tsx precedent (1,665 → 9 extracts) and the R137
 * batch-1 admin idiom (topups/users/orders) applied here: orchestration
 * (pages/admin/tickets.tsx) + seven verbatim extracts under
 * components/admin/tickets/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the partial
 * vs hard category-empty honesty, the R125-I4 awaiting-reply cue, the
 * stats co-invalidation fetches) is already pinned by the
 * tickets-category-partial-empty / tickets-error-state /
 * stats-co-invalidation render suites; this file guards the STRUCTURE
 * so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      847 lines; the ceiling leaves room to grow without re-ballooning
 *      into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. money-path ownership — handleReply (the reply POST + the
 *      refetch + the stats co-invalidation), handleStatus (the status
 *      PATCH with its double-click guard), openTicket (the detail
 *      fetch + scroll) and syncFilterParams (the URL write-back) stay
 *      IN the page: a stale closure in a presentational extract could
 *      reply to the wrong ticket;
 *   4. state ownership — all 6 cross-section atoms + messagesEndRef +
 *      the dirty guard stay centralized in the page (the reply draft
 *      spans the guard, the form and the submit); the extracts take
 *      values + callbacks only — TicketDetailPane receives the ref as
 *      a prop (the orders.tsx BulkActionBar triggerRef precedent);
 *   5. purity — the queue metadata module is React-free, and no
 *      extract touches the money APIs (react-query / the generated
 *      ticket fetchers) — the meta's row aliases are TYPE-ONLY.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/tickets.tsx");

describe("R137 (FE) — admin/tickets.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/tickets.tsx stays under the 1,000-line ceiling (was 847 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/tickets/tickets-meta",
      "@/components/admin/tickets/StatusFilterTabs",
      "@/components/admin/tickets/CategoryFilterChips",
      "@/components/admin/tickets/StaleQueueBanner",
      "@/components/admin/tickets/TicketsEmptyStates",
      "@/components/admin/tickets/TicketCard",
      "@/components/admin/tickets/TicketDetailPane",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the money-path handlers stay IN the page (the extracts render; the page owns the POSTs)", () => {
    // handleReply carries the reply POST + the draft reset + the
    // openTicket refetch + the list refetch + the stats co-invalidation
    // (R125-I4 A4-B-3 — the layout badge + dashboard read that key);
    // handleStatus carries the status PATCH with the double-click
    // in-flight guard. None may drift into a presentational extract
    // where a stale closure could reply to / close the wrong ticket.
    expect(page).toContain("const handleReply = async (e: React.FormEvent) => {");
    expect(page).toContain("const handleStatus = async (id: number, status: string) => {");
    expect(page).toContain(
      "await replyAdminTicket(selected.id, { message: replyText }, { headers });",
    );
    expect(page).toContain("await updateAdminTicketStatus(");
    expect(page).toContain('void qc.invalidateQueries({ queryKey: ["/api/admin/stats"] });');
    expect(page).toContain("if (statusBusy !== null) return;");
    // openTicket — the B5-14 ok-guarded detail fetch + the scroll
    // reset (the reply box resets only on success or a ticket switch).
    expect(page).toContain("const openTicket = async (id: number) => {");
    expect(page).toContain("await getAdminTicket(id, { headers });");
    // The quiet-catches: a 401 is the global handler's business (the
    // predicate itself lives in the pure module, imported by name).
    expect(page).toContain("if (isSessionExpiredError(err)) return;");
    // The accumulating infinite query with its HAND queryKey — the
    // SocketInitializer + the stats co-invalidation ride the
    // "/api/admin/tickets" prefix (R127-L1), so the key must stay
    // exactly here.
    expect(page).toContain("useInfiniteQuery<TicketSummary[], Error>({");
    expect(page).toContain('queryKey: ["/api/admin/tickets", "load-more", listParams],');
    expect(page).toContain("const tickets = useMemo(() => {");
    // And the deep-link honest-reason gate (R134 A3-F1).
    expect(page).toContain('return <AdminScopeGate scope="support" />;');
  });

  it("the cross-section state atoms + the URL sync stay centralized in the page (values + callbacks flow down)", () => {
    // One source: selected spans the queue pane's hidden/flex flip, the
    // row isActive cue, the detail pane mount and BOTH money handlers;
    // replyText spans the dirty guard, the form and the submit gate;
    // statusBusy spans both status buttons' spinners + the guard.
    for (const atom of [
      "const [statusBusy, setStatusBusy] = useState<number | null>(null);",
      'const [statusFilter, setStatusFilter] = useState("");',
      'const [categoryFilter, setCategoryFilter] = useState("");',
      "const [selected, setSelected] = useState<TicketDetail | null>(null);",
      'const [replyText, setReplyText] = useState("");',
      "const [sending, setSending] = useState(false);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // R123 (E3 P3c): the two-way ?status=/?category= URL sync — the
    // param→state effect and the state→URL replaceState writer stay in
    // the page; the chip extracts only call the page-owned wrappers.
    expect(page).toContain("if (s && STATUS_FILTERS.some((x) => x.value === s)) {");
    expect(page).toContain("const syncFilterParams = (status: string, category: string) => {");
    expect(page).toContain('window.history.replaceState(null, "", url.toString());');
    // The reply draft's beforeunload guard (R123 E3 P3c) + the
    // scroll-to-bottom ref its openTicket handler drives.
    expect(page).toContain("useDirtyGuard(!!replyText.trim());");
    expect(page).toContain("const messagesEndRef = useRef<HTMLDivElement>(null);");
    expect(page).toContain("}, [selected?.id, selected?.replies?.length]);");
    // The honest-count + partial-empty derivations the empty branches
    // ride (R126-L3 A2-4).
    expect(page).toContain(
      "const knownTotal = (ticketsPages?.pages.length ?? 0) <= 1 && tickets.length < TICKETS_PAGE_SIZE;",
    );
    expect(page).toContain(
      'const categoryPartialEmpty = visibleTickets.length === 0 && categoryFilter !== "" && hasNextPage;',
    );
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved markup rides along verbatim (spot-pins at the new address)", () => {
    // The reply form + the B5-17 RTL-mirrored Send + the messagesEndRef
    // mount moved to TicketDetailPane.tsx — these spot-pins keep the
    // verbatim shapes at their new address so the existing render pins
    // stay meaningful through the extract.
    const pane = read("src/components/admin/tickets/TicketDetailPane.tsx");
    expect(pane).toContain('<form onSubmit={onSubmit} className="border-t border-border p-4">');
    expect(pane).toContain('aria-label="إرسال الرد"');
    expect(pane).toContain('<Send className="w-4 h-4 -scale-x-100" />');
    expect(pane).toContain("<div ref={messagesEndRef} />");
    expect(pane).toContain('aria-label="إغلاق تفاصيل التذكرة"');
    // The queue row's staggered float-in + the R125-I4 awaiting-reply
    // cue moved to TicketCard.tsx.
    const card = read("src/components/admin/tickets/TicketCard.tsx");
    expect(card).toContain("stagger-${Math.min(idx + 1, 8)}");
    expect(card).toContain('{t.has_unread_admin && t.status !== "closed" && (');
    expect(card).toContain("بانتظار ردك");
    // The R126-L3 partial-empty honesty block moved to
    // TicketsEmptyStates.tsx (the tickets-category-partial-empty
    // surface — the load-more stays reachable from the empty branch).
    const empties = read("src/components/admin/tickets/TicketsEmptyStates.tsx");
    expect(empties).toContain("لا تذاكر بفئة {categoryLabel} ضمن الصفحات المحمّلة");
    expect(empties).toContain("إلغاء فلتر الفئة");
    // The R124-C2 aria-pressed chip bars moved to their own atoms.
    const tabs = read("src/components/admin/tickets/StatusFilterTabs.tsx");
    expect(tabs).toContain("aria-pressed={statusFilter === s.value}");
    const chips = read("src/components/admin/tickets/CategoryFilterChips.tsx");
    expect(chips).toContain("aria-pressed={categoryFilter === c.value}");
    // The page h1 + the honest count stay in the page (the
    // admin-h1-unification scan reads pages/admin/*.tsx).
    expect(page).toContain('<h1 className="text-xl font-bold">تذاكر الدعم</h1>');
    expect(page).toContain(
      "`عرض ${formatCount(tickets.length, TICKET_COUNT_FORMS)} (الأحدث أولاً)`",
    );
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a pane needs is passed DOWN, so
    // no extract may grow its own useState/useRef/useEffect/useMemo
    // island — duplicated truth on the money queue is how the R98-01
    // / R123-class desync bugs happen (the topups/users precedent).
    const files = [
      "StatusFilterTabs",
      "CategoryFilterChips",
      "StaleQueueBanner",
      "TicketsEmptyStates",
      "TicketCard",
      "TicketDetailPane",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/tickets/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
    // And none of them re-declares a page atom's identifier either.
    for (const name of files) {
      const src = read(`src/components/admin/tickets/${name}.tsx`);
      expect(src, name).not.toMatch(
        /const \[(statusBusy|statusFilter|categoryFilter|selected|replyText|sending), set/,
      );
    }
    // TicketDetailPane submits ONLY through the page-owned handlers —
    // it never fires a fetch itself (see the money-API ban below).
    const pane = read("src/components/admin/tickets/TicketDetailPane.tsx");
    expect(pane).toContain("onSubmit={onSubmit}");
    expect(pane).toContain('onClick={() => onStatus(selected.id, "closed")}');
    expect(pane).toContain('onClick={() => onStatus(selected.id, "open")}');
  });

  it("no extract touches the money APIs (the page owns every reply/status/detail POST)", () => {
    // react-query, the generated ticket fetchers and the idempotency
    // machinery are page-only surfaces — an extract importing any of
    // them is a money path that drifted out of orchestration.
    const files = [
      "StatusFilterTabs",
      "CategoryFilterChips",
      "StaleQueueBanner",
      "TicketsEmptyStates",
      "TicketCard",
      "TicketDetailPane",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/tickets/${name}.tsx`);
      expect(src, name).not.toMatch(/@tanstack\/react-query/);
      expect(src, name).not.toMatch(/@workspace\/api-client-react/);
      expect(src, name).not.toMatch(
        /replyAdminTicket|updateAdminTicketStatus|getAdminTicket|listAdminTickets/,
      );
      expect(src, name).not.toMatch(/generateIdempotencyKey|withIdempotencyKey/);
    }
  });

  it("the queue metadata module is React-free (pure tables + predicates — importable by any lane)", () => {
    const meta = read("src/components/admin/tickets/tickets-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The statusLabel-derived tab list (93-C7 / C-UX5: one Arabic word
    // per status — the status-badge invariant).
    expect(meta).toContain("export const STATUS_FILTERS = [");
    expect(meta).toContain("export const CATEGORY_FILTERS = [");
    expect(meta).toContain("export const CATEGORIES: Record<string, string> = {");
    // The frozen `?page=&limit=` contract's page size (94-C2 A2 P1-1).
    expect(meta).toContain("export const TICKETS_PAGE_SIZE = 100;");
    // The Arabic plural forms the count lines ride (A2 P3-4).
    expect(meta).toContain("export const TICKET_COUNT_FORMS = {");
    // The row/thread aliases the page + the extracts speak (R127-L1).
    expect(meta).toContain("export type TicketSummary = AdminTicketSummary;");
    expect(meta).toContain("export type TicketDetail = AdminTicketThread;");
    // The 401 predicate the money catches break on (R127-L1 B1 §3.4).
    expect(meta).toContain("export function isSessionExpiredError(");
    expect(meta).toContain("?.status === 401;");
    // The generated row types ride as TYPE-ONLY imports — erased at
    // runtime, so the module stays pure no matter who imports it.
    expect(meta).toContain(
      'import type { AdminTicketSummary, AdminTicketThread } from "@workspace/api-client-react";',
    );
    expect(meta).not.toMatch(/customFetch[<(]|useQuery[<(]|\.refetch\(|await /);
  });
});
