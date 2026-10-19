/**
 * R137 (FE) — the support.tsx decomposition contract.
 *
 * The storefront's support page was a 1,052-line single component (10
 * useState atoms, the 25 s open-ticket poll, the ?ref=/?ticket= deep
 * links, the create/reply POSTs and every presentational surface —
 * FAQ accordion, ticket list, thread view, reply composer — inline in
 * one function). The R136 checkout/wallet/home storefront precedents
 * applied here: orchestration (pages/support.tsx) + six verbatim
 * extracts under components/support/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, event semantics, the R94-A1 #3
 * Enter double-submit guard, the B-10 25 s poll, the A9-1 ?ticket=
 * deep link) is already pinned by the five support-* render suites +
 * seo-money-pages-r120 (the anonymous public-FAQ surface); this file
 * guards the STRUCTURE so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      1,052 lines at decomposition; the ceiling leaves room to grow
 *      without re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. mutation ownership — the list/thread fetches, the create/reply
 *      POSTs with their double-submit guards, the 25 s poll machinery
 *      and the deep-link effects stay IN the page: a stale closure in
 *      a presentational extract could double-send a reply or re-open
 *      a thread the user backed out of;
 *   4. state ownership — all 10 cross-section atoms stay centralized
 *      in the page (the reply draft and the poll's functional set span
 *      four of them); the extracts take values + callbacks only;
 *   5. purity — the FAQ data module is React-free, the taxonomy meta
 *      carries no state, and no extract imports the auth/toast/API
 *      modules the render suites mock at the module boundary.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/support.tsx");

describe("R137 (FE) — support.tsx decomposition: page stays an orchestration core", () => {
  it("pages/support.tsx stays under the 1,000-line ceiling (was 1,052 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/support/support-faq",
      "@/components/support/support-meta",
      "@/components/support/TicketThread",
      "@/components/support/CreateTicketForm",
      "@/components/support/TicketsList",
      "@/components/support/FaqSection",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the nested atoms are still imported by their consumers (taxonomy/FAQ data at the extracts' imports)", () => {
    // The thread + the list rows ride the SAME status/category map, and
    // the create form rides the SAME category pills — the deletion
    // guard for the shared meta lives at each consumer's import.
    const thread = read("src/components/support/TicketThread.tsx");
    expect(thread).toContain('from "./support-meta"');
    const list = read("src/components/support/TicketsList.tsx");
    expect(list).toContain('from "./support-meta"');
    const createForm = read("src/components/support/CreateTicketForm.tsx");
    expect(createForm).toContain('from "./support-meta"');
    // The visible accordion and the page's JSON-LD read the SAME FAQ
    // module (Google's FAQPage parity rule — one source, two surfaces).
    const faq = read("src/components/support/FaqSection.tsx");
    expect(faq).toContain('from "./support-faq"');
    expect(page).toContain("buildFaqLd(SUPPORT_FAQ)");
  });

  it("the mutation/polling handlers stay IN the page (the extracts render; the page owns the sends)", () => {
    // fetchTickets / openTicket carry the 93-C5 res.ok + shape guards —
    // an outage must stay an error card, never a crash or a fake empty.
    // [R169 lint-zero] both became useCallbacks (same page-owned bodies;
    // headers is now memoized on token so the identities stay stable).
    expect(page).toContain("const fetchTickets = useCallback(() => {");
    expect(page).toContain("const openTicket = useCallback(");
    // handleCreate / handleReply carry the R94-A1 #3 double-submit
    // guards — the Enter keydown path bypasses the disabled button, so
    // the `sending`/`submitting` gates must never drift into an
    // extract where a stale closure could double-send.
    expect(page).toContain("const handleCreate = async (e: React.FormEvent) => {");
    expect(page).toContain("const handleReply = async (e: React.FormEvent) => {");
    expect(page).toContain("if (submitting) return;");
    expect(page).toContain("if (sending) return;");
    // B-10: the 25 s open-ticket poll — the silent refresh must NOT
    // ride openTicket (draft/skeleton/scroll contract), and the
    // functional set drops a late poll after the user backed out.
    expect(page).toContain("const TICKET_THREAD_POLL_MS = 25_000;");
    expect(page).toContain("const refreshOpenTicketSilently = useCallback(");
    expect(page).toContain("if (document.hidden) return;");
    expect(page).toContain("void refreshOpenTicketSilently(id);");
    expect(page).toContain(
      "setSelectedTicket((prev) => (prev && prev.id === id ? (d as TicketDetail) : prev));",
    );
    // A9-1 / B13 minor-2: the ?ticket= deep link stays armed across a
    // failed first load and is consumed exactly once.
    expect(page).toContain("const ticketParamConsumedRef = useRef(false);");
    expect(page).toContain("void openTicket(ticketParam);");
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the poll's liveness, the reply draft, the create
    // draft and the list cascade (loading/listError/tickets.length) all
    // key off the same atoms — the thread, the composer and the rows
    // take them as values + callbacks only.
    for (const atom of [
      "const [tickets, setTickets] = useState<Ticket[]>([]);",
      "const [loading, setLoading] = useState(true);",
      "const [listError, setListError] = useState(false);",
      "const [showCreate, setShowCreate] = useState(false);",
      "const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);",
      "const [ticketLoading, setTicketLoading] = useState(false);",
      'const [replyText, setReplyText] = useState("");',
      "const [sending, setSending] = useState(false);",
      'const [form, setForm] = useState({ title: "", message: "", category: "other" });',
      "const [submitting, setSubmitting] = useState(false);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The auto-scroll anchor the openTicket + poll effects observe.
    expect(page).toContain("const messagesEndRef = useRef<HTMLDivElement>(null);");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the moved markup rides along verbatim (the r128-sweep anchors follow the surface)", () => {
    // The reply composer's a11y contract (aria-label + the mobile send
    // key hint + the 4000-char cap) moved to TicketThread — the
    // support-reply-guard suite exercises it through the extract.
    const thread = read("src/components/support/TicketThread.tsx");
    expect(thread).toContain('aria-label="نص الرد على التذكرة"');
    expect(thread).toContain('enterKeyHint="send"');
    expect(thread).toContain("maxLength={4000}");
    // The create card's disclosure anchor (the header button's
    // aria-controls target) + the category pill GROUP semantics moved
    // to CreateTicketForm.
    const createForm = read("src/components/support/CreateTicketForm.tsx");
    expect(createForm).toContain('id="support-create-ticket"');
    expect(createForm).toContain('role="group"');
    expect(createForm).toContain('aria-labelledby="support-ticket-category-label"');
    // The honest FAQ copy moved as data — the R123-E4b passwordless
    // answer and the R115 policy-B referral answer stay byte-identical
    // (support-faq-copy pins the rendered text).
    const faqData = read("src/components/support/support-faq.ts");
    expect(faqData).toContain('question: "كيف أسجّل الدخول بدون كلمة مرور؟"');
    expect(faqData).toContain('question: "هل أحصل على مكافأة عند دعوة أصدقائي؟"');
    // The anonymous login CTA (R120-B3: the FAQ surface is public) and
    // the R136 UX-1 skeleton adoption stay in the page —
    // skeleton-primitives reads THIS file for the primitives import.
    expect(page).toContain('href="/login?redirect=/support"');
    expect(page).toContain("سجّل الدخول لفتح تذكرة");
    expect(page).toMatch(/from "@\/components\/ui\/Skeleton"/);
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a surface needs is passed DOWN,
    // so no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the reply/create paths is how the R94-A1 #3
    // double-submit class of bugs happens.
    const files = ["TicketThread", "CreateTicketForm", "TicketsList", "FaqSection", "support-meta"];
    for (const name of files) {
      const src = read(`src/components/support/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("no extract touches the mocked module boundary (auth/toast/api-client stay page-owned)", () => {
    // The support-* render suites mock @/lib/auth + @/hooks/use-toast at
    // the module boundary; seo-money-pages mocks the orval client. An
    // extract importing any of them would re-couple presentation to the
    // coordinating modules the page owns.
    const files = ["TicketThread", "CreateTicketForm", "TicketsList", "FaqSection", "support-meta"];
    for (const name of files) {
      const src = read(`src/components/support/${name}.tsx`);
      expect(src, name).not.toMatch(
        /@\/lib\/auth|@\/hooks\/use-toast|@workspace\/api-client-react/,
      );
    }
  });

  it("the FAQ data module is React-free (pure content — importable by any lane)", () => {
    const faqData = read("src/components/support/support-faq.ts");
    expect(faqData).not.toMatch(/from "react"|from "lucide-react"/);
    // The taxonomy helpers the thread/list/form extracts share.
    const meta = read("src/components/support/support-meta.tsx");
    expect(meta).toContain("export function categoryLabel(");
    expect(meta).toContain("export function categoryIcon(");
    expect(meta).toContain("export const STATUS_CONFIG");
  });
});
