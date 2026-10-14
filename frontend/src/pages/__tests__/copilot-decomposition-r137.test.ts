/**
 * R137 (FE) — the CopilotPanel decomposition contract.
 *
 * The admin copilot was a 1,794-line single component (the biggest file
 * in the repo — the whole multi-conversation chat truth, the SSE
 * streaming ask-loop, the draft/preview/confirm state machine, the
 * cooldown countdown and every message bubble inline in one function) —
 * the R136 checkout precedent (1,665 → page + nine extracts) applied
 * here: orchestration (components/admin/copilot/CopilotPanel.tsx) +
 * thirteen verbatim extracts + four React-free modules beside it in
 * components/admin/copilot/.
 *
 * PUBLIC API (the wave-critical constraint): the module is mounted by
 * pages/admin/layout.tsx's lazyWithRetry chunk (R124-I5) and THREE suites
 * import its named surface directly — copilot-copy.test.tsx (AskAnswer),
 * copilot-trace-line-r129.test.tsx (ProgressTraceLine) and
 * copilot-persistence.test.ts (sanitizeRestoredConversations +
 * stripTransientLoading, whose Conversation shape is DERIVED off
 * `Parameters<typeof stripTransientLoading>`). The module's public
 * surface — those four names + CopilotPanel, NOTHING else, NO default
 * export — must survive the decomposition unchanged; the three moved
 * symbols ride verbatim re-exports from their new addresses.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the tool-trace glyph→lucide arms,
 * the copy feedback lifecycle, the SSE progress feed) is already pinned
 * by the copilot-* render suites; this file guards the STRUCTURE so the
 * decomposition cannot silently regress:
 *
 *   1. size ceiling — the panel stays an orchestration core (it was
 *      1,794 lines; the ceiling leaves room to grow without
 *      re-ballooning into the monolith);
 *   2. deletion guards — every extract is still imported by the panel
 *      (a dropped import = a section silently vanished);
 *   3. public API pins — the same five exported symbols still exist and
 *      no sixth export sneaks in;
 *   4. ownership pins — the send/stream machinery (submit → runAsk SSE
 *      reader → appendProgress/replaceLastProgress), the
 *      approve/double-confirm/cancel mutations and ALL cross-section
 *      state atoms stay IN the panel: a stale closure in a
 *      presentational extract could confirm the wrong preview;
 *   5. purity pins — the presentational extracts take values +
 *      callbacks only; the two card-local feature extracts (AskAnswer's
 *      copy feedback, PreviewCard's cooldown countdown — the GlobalSearch
 *      R137 1-f precedent) own ONLY their transient atoms; the .ts
 *      modules are React-free.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const panel = read("src/components/admin/copilot/CopilotPanel.tsx");

describe("R137 (FE) — CopilotPanel.tsx decomposition: the panel stays an orchestration core", () => {
  it("CopilotPanel.tsx stays under the 1,000-line ceiling (was 1,794 at decomposition)", () => {
    const lines = panel.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the panel imports every extract it renders (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/copilot/ConversationSidebar",
      "@/components/admin/copilot/CopilotComposer",
      "@/components/admin/copilot/CopilotHeader",
      "@/components/admin/copilot/CopilotTrigger",
      "@/components/admin/copilot/EmptyState",
      "@/components/admin/copilot/TurnView",
      "@/components/admin/copilot/copilot-types",
      "@/components/admin/copilot/copilot-persistence",
      "@/components/admin/copilot/copilot-intent",
    ];
    for (const specifier of extracts) {
      expect(panel, specifier).toContain(`from "${specifier}"`);
    }
    // The action-history overlay keeps its pre-decomposition relative
    // import (OUT OF SCOPE for this task — untouched, still imported).
    expect(panel).toContain('from "./CopilotHistoryView"');
  });

  it("the intra-folder leaves stay imported by their consumers (no panel call site — the R137 NavItem precedent)", () => {
    // TurnView renders the ask answer card, the draft preview card and
    // the progress trace lines; AskAnswer renders the direct-execution
    // badges + the markdown-lite body; PreviewCard renders the change
    // diffs; EmptyState renders the suggestion chips. The deletion
    // guards ride the sibling extract that imports each leaf.
    const turnView = read("src/components/admin/copilot/TurnView.tsx");
    expect(turnView).toContain('from "./AskAnswer"');
    expect(turnView).toContain('from "./PreviewCard"');
    expect(turnView).toContain('from "./ProgressTraceLine"');
    const askAnswer = read("src/components/admin/copilot/AskAnswer.tsx");
    expect(askAnswer).toContain('from "./DirectExecutionBadge"');
    expect(askAnswer).toContain('from "./MarkdownLite"');
    const previewCard = read("src/components/admin/copilot/PreviewCard.tsx");
    expect(previewCard).toContain('from "./ChangeDiff"');
    const emptyState = read("src/components/admin/copilot/EmptyState.tsx");
    expect(emptyState).toContain('from "./SuggestionRow"');
    expect(emptyState).toContain('from "./copilot-intent"');
    const composer = read("src/components/admin/copilot/CopilotComposer.tsx");
    expect(composer).toContain('from "./copilot-persistence"');
    const header = read("src/components/admin/copilot/CopilotHeader.tsx");
    expect(header).toContain('from "./copilot-types"');
    const markdownLite = read("src/components/admin/copilot/MarkdownLite.tsx");
    expect(markdownLite).toContain('from "./copilot-markdown"');
  });

  it("the PUBLIC API survives verbatim — CopilotPanel + the three test-pinned re-exports, nothing added, nothing lost", () => {
    // The five symbols the layout lazy mount + the three copilot render
    // suites depend on. CopilotPanel keeps its exact declaration; the
    // moved symbols ride re-exports so `import { AskAnswer } from
    // "@/components/admin/copilot/CopilotPanel"` (copilot-copy),
    // `import { ProgressTraceLine } from "../../components/admin/copilot/CopilotPanel"`
    // (copilot-trace-line-r129) and `import { sanitizeRestoredConversations,
    // stripTransientLoading } from "@/components/admin/copilot/CopilotPanel"`
    // (copilot-persistence — which DERIVES its Conversation fixture type off
    // the stripTransientLoading signature) all resolve unchanged.
    expect(panel).toContain("export function CopilotPanel() {");
    expect(panel).toContain('export { AskAnswer } from "@/components/admin/copilot/AskAnswer";');
    expect(panel).toContain(
      'export { ProgressTraceLine } from "@/components/admin/copilot/ProgressTraceLine";',
    );
    expect(panel).toContain(
      "export {\n  sanitizeRestoredConversations,\n  stripTransientLoading,\n} from",
    );
    // R143 (L13-3): the SSE read-idle watchdog seams joined the public
    // surface — module-level pure exports (constant, message, race
    // helper) pinned by copilot-sse-watchdog-r143. Deliberate, test-
    // seam additions: the count moved 4 → 7.
    expect(panel).toContain("export const SSE_READ_IDLE_MS = 120_000;");
    expect(panel).toContain("export const SSE_STALL_MESSAGE =");
    expect(panel).toContain("export function readWithIdleWatchdog(");
    // The exact export surface: seven statements, no default export, no
    // eighth symbol sneaking onto the module boundary mid-wave.
    const exportStatements = [
      ...panel.matchAll(/^export (?:function|const|let|var|class|type|interface|default|\{)/gm),
    ];
    expect(exportStatements.length).toBe(7);
    expect(panel).not.toContain("export default");
    // And the re-exported implementations are the real ones (verbatim
    // moves — never duplicated inline in the panel).
    const persistence = read("src/components/admin/copilot/copilot-persistence.ts");
    expect(persistence).toContain("export function sanitizeRestoredConversations(");
    expect(persistence).toContain("export function stripTransientLoading(");
    expect(read("src/components/admin/copilot/AskAnswer.tsx")).toContain(
      "export function AskAnswer({",
    );
    expect(read("src/components/admin/copilot/ProgressTraceLine.tsx")).toContain(
      "export function ProgressTraceLine(",
    );
  });

  it("the send/stream machinery + the confirm mutations stay IN the panel (the extracts render; the panel owns the wire)", () => {
    // submit() routes ask-vs-draft (looksLikeChangeIntent + the 503 /
    // COPILOT_PHASE_DISABLED fallback), runAsk() owns the SSE reader
    // loop (progress/tool_call events → appendProgress /
    // replaceLastProgress, the final payload, the R123 P3e dead-stream
    // error) and approve/doubleConfirm/cancelPreview own the preview
    // lifecycle. A stale closure in a presentational extract could
    // confirm the WRONG preview — the money path stays here.
    expect(panel).toContain("async function submit() {");
    expect(panel).toContain("async function runAsk(");
    expect(panel).toContain("const reader = resp.body.getReader();");
    expect(panel).toContain("function handleEvent(event: string, data: unknown) {");
    expect(panel).toContain(
      "function progressFor(name: string, ok?: boolean, summary?: string): string {",
    );
    expect(panel).toContain("function appendProgress(turnId: string, line: string) {");
    expect(panel).toContain("function replaceLastProgress(turnId: string, line: string) {");
    expect(panel).toContain("async function approve(turn: ConversationTurn) {");
    expect(panel).toContain("async function doubleConfirm(turn: ConversationTurn) {");
    expect(panel).toContain("async function cancelPreview(turn: ConversationTurn) {");
    expect(panel).toContain("async function retry(turn: ConversationTurn) {");
    // The turn-store reducers + the history payload builder ride with
    // them (the panel alone writes conversation truth).
    expect(panel).toContain("function patchTurn(id: string, patch: Partial<ConversationTurn>) {");
    expect(panel).toContain("function appendTurn(turn: ConversationTurn) {");
    expect(panel).toContain("function deleteConversation(id: string) {");
    expect(panel).toContain("function startNewConversation() {");
    expect(panel).toContain(
      'function buildHistory(): Array<{ role: "user" | "assistant"; content: string }> {',
    );
    // And the six wire endpoints the mutations target.
    for (const endpoint of [
      '"/api/admin/copilot/settings"',
      '"/api/admin/copilot/draft"',
      '"/api/admin/copilot/ask"',
      "`/api/admin/copilot/previews/${turn.preview.id}/confirm`",
      "`/api/admin/copilot/previews/${turn.preview.id}/double-confirm`",
      "`/api/admin/copilot/previews/${turn.preview.id}/cancel`",
    ]) {
      expect(panel, endpoint).toContain(endpoint);
    }
    // R123 (E3 item 1): the quiet-close on session expiry (no fake
    // failure bubble on a page being left) is part of the wire contract.
    expect(panel).toContain("if (err instanceof AdminSessionExpiredError) {");
  });

  it("the cross-section state atoms stay centralized in the panel (values + callbacks flow down)", () => {
    // One owner: the sidebar (conversations/currentId), the header
    // (fullscreen/history/action-history toggles + flags probe), the
    // composer (input + inputRef + the auto-grow handler) and the turn
    // list (turns/turnsEndRef) all read the SAME atoms — a duplicated
    // atom in an extract would desync the panel's surfaces.
    for (const atom of [
      "const [open, setOpen] = useState(false);",
      "const [fullscreen, setFullscreen] = useState(false);",
      "const [showHistory, setShowHistory] = useState(false);",
      "const [showActionHistory, setShowActionHistory] = useState(false);",
      "const [flags, setFlags] = useState<PhaseFlags | null>(null);",
      'const [input, setInput] = useState("");',
      "const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());",
      "const [currentId, setCurrentId] = useState<string | null>(() => loadCurrentId());",
    ]) {
      expect(panel, atom).toContain(atom);
    }
    // The refs (composer focus, turn-list autoscroll, the R134 A3-F2
    // dialog invoker-restore) and the current-conversation resolver
    // stay with them.
    expect(panel).toContain("const inputRef = useRef<HTMLTextAreaElement>(null);");
    expect(panel).toContain("const turnsEndRef = useRef<HTMLDivElement>(null);");
    expect(panel).toContain("const panelRef = useRef<HTMLElement>(null);");
    expect(panel).toContain("const current = useMemo<Conversation>(() => {");
    // The 15s preview-expiry sweep (94-C2 A2 P3-17) and the ESC
    // layer-peel order (action history → sidebar → fullscreen → panel).
    expect(panel).toContain("const timer = setInterval(sweep, 15_000);");
    expect(panel).toContain("if (showActionHistory) setShowActionHistory(false);");
    // The auto-grow reset on submit stays beside the input atom it
    // reclaims (94-C2 A2 P3-17).
    expect(panel).toContain("function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {");
    // And the panel is typed — no `any` state sneaks back in.
    expect(panel).not.toMatch(/useState<any/);
  });
});

describe("R137 (FE) — the extracts are self-contained units (verbatim moves)", () => {
  it("no presentational extract re-declares panel state (they take values + callbacks only)", () => {
    // Stateless by contract: every atom a section needs is passed DOWN,
    // so no extract may grow its own useState/useRef/useEffect island —
    // duplicated truth on the chat surface is how the R98-01-class
    // desync bugs happen.
    const files = [
      "ConversationSidebar",
      "CopilotComposer",
      "CopilotHeader",
      "CopilotTrigger",
      "EmptyState",
      "SuggestionRow",
      "TurnView",
      "DirectExecutionBadge",
      "ChangeDiff",
      "MarkdownLite",
      "ProgressTraceLine",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/copilot/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
    }
  });

  it("AskAnswer owns ONLY its card-local copy feedback (the GlobalSearch feature-extract precedent)", () => {
    // The answer card is a self-contained feature component (the R137
    // 1-f GlobalSearch / R124-I5 idiom): copied/copyFailed are transient
    // card feedback NOBODY outside the card reads. Everything else —
    // the answer text, tool traces, direct executions — arrives as
    // values from the panel-owned conversation truth.
    const askAnswer = read("src/components/admin/copilot/AskAnswer.tsx");
    expect(askAnswer).toContain("const [copied, setCopied] = useState(false);");
    expect(askAnswer).toContain("const [copyFailed, setCopyFailed] = useState(false);");
    // B6-P2-2: the copy path routes through the shared helper and
    // surfaces failures (the pin copilot-copy.test.tsx renders).
    expect(askAnswer).toContain("const ok = await copyToClipboard(answer);");
    expect(askAnswer).not.toMatch(/useRef\(|useEffect\(|useMemo\(/);
  });

  it("PreviewCard owns ONLY its card-local cooldown countdown (the GlobalSearch feature-extract precedent)", () => {
    // The 100ms countdown ticks against the server-side cooldownEndsAt
    // the PANEL owns (it arrives as a value); the card derives the
    // enable/disable + the plural countdown label from it. The
    // approve/double-confirm/cancel mutations stay panel-side — the
    // card receives them as callbacks.
    const previewCard = read("src/components/admin/copilot/PreviewCard.tsx");
    expect(previewCard).toContain("const [remainingMs, setRemainingMs] = useState(() =>");
    expect(previewCard).toContain(
      'if (state !== "awaiting_double_confirm" || !cooldownEndsAt) return;',
    );
    expect(previewCard).toContain("const id = window.setInterval(tick, 100);");
    expect(previewCard).toContain("const cooldownDone = remainingMs <= 0;");
    expect(previewCard).not.toMatch(/useRef\(|useMemo\(/);
    // Callbacks only — the card never fetches on its own.
    expect(previewCard).not.toMatch(/adminFetch|fetch\(/);
  });

  it("the moved markup rides along verbatim (the r125/r128/r129/r134 pins follow the surface)", () => {
    // ProgressTraceLine: the R128-A6/R129-B1 glyph→lucide arms.
    const traceLine = read("src/components/admin/copilot/ProgressTraceLine.tsx");
    expect(traceLine).toContain('line.startsWith("✓ ")');
    expect(traceLine).toContain('line.startsWith("✗ ")');
    expect(traceLine).toContain("text-status-success");
    // TurnView: the eternal-spinner arms + the canonical retry label.
    const turnView = read("src/components/admin/copilot/TurnView.tsx");
    expect(turnView).toContain('? "جارٍ التفكير…" : "جارٍ المعالجة…"');
    expect(turnView).toContain('title="إعادة المحاولة"');
    // PreviewCard: the high-risk first/second confirm copy + the AA-safe
    // 94-C2 second-confirm surface (the admin-palette negative guard
    // scans components/admin/** recursively — the extracts are covered).
    const previewCard = read("src/components/admin/copilot/PreviewCard.tsx");
    expect(previewCard).toContain('{isHighRisk ? "موافقة (تأكيد أول)" : "موافقة وتنفيذ"}');
    expect(previewCard).toContain(
      "bg-primary/10 border border-primary/40 text-primary-text text-xs font-bold",
    );
    expect(previewCard).toContain('"تأكيد ثانٍ — تنفيذ الآن"');
    // CopilotHeader: the phase pill + the 93-C7 tone mapping + close.
    const header = read("src/components/admin/copilot/CopilotHeader.tsx");
    expect(header).toContain('<StatusBadge variant={phaseBadge.tone} size="xs">');
    expect(header).toContain('{ label: "نشط", tone: "success" }');
    expect(header).toContain('aria-label="إغلاق"');
    // ConversationSidebar: the B14-5 formatCount plural routing.
    const sidebar = read("src/components/admin/copilot/ConversationSidebar.tsx");
    expect(sidebar).toContain("formatCount(c.turns.length, {");
    expect(sidebar).toContain("لا توجد محادثات بعد");
    // CopilotComposer: the R133 A4-F8 chat-field naming + the memory hint.
    const composer = read("src/components/admin/copilot/CopilotComposer.tsx");
    expect(composer).toContain('aria-label="سؤال أو أمر لمساعد الذكاء الاصطناعي"');
    expect(composer).toContain("يتذكر آخر {MEMORY_TURNS_SENT} رسائل في هذه المحادثة");
    expect(composer).toContain('aria-label="إرسال"');
    // CopilotTrigger: the R134 A3-F5b single accessible name.
    const trigger = read("src/components/admin/copilot/CopilotTrigger.tsx");
    expect(trigger).toContain('title="المساعد الذكي (فتح — Ctrl/Cmd+J)"');
    // EmptyState + AskAnswer + ChangeDiff + DirectExecutionBadge copy.
    expect(read("src/components/admin/copilot/EmptyState.tsx")).toContain("أمثلة سريعة");
    expect(read("src/components/admin/copilot/AskAnswer.tsx")).toContain(
      "مصدر البيانات ({toolUses.length})",
    );
    expect(read("src/components/admin/copilot/ChangeDiff.tsx")).toContain("(فارغ)");
    expect(read("src/components/admin/copilot/DirectExecutionBadge.tsx")).toContain(
      '{ok ? "تم التنفيذ" : "فشل التنفيذ"}',
    );
  });

  it("the pure modules are React-free (types/persistence/intent/markdown — importable by any lane)", () => {
    const files = ["copilot-types", "copilot-persistence", "copilot-intent", "copilot-markdown"];
    for (const name of files) {
      const src = read(`src/components/admin/copilot/${name}.ts`);
      expect(src, name).not.toMatch(/from "react"|from "lucide-react"/);
    }
    // The 94-C2 round-trip guards + their localStorage keys live in
    // copilot-persistence (imported by name, never duplicated inline).
    const persistence = read("src/components/admin/copilot/copilot-persistence.ts");
    expect(persistence).toContain('const STORAGE_KEY = "subnation:copilot:conversations:v1";');
    expect(persistence).toContain("export const MAX_CONVERSATIONS = 8;");
    expect(persistence).toContain("export const MEMORY_TURNS_SENT = 6;");
    // The ask-vs-draft router + the suggestion copy constants.
    const intent = read("src/components/admin/copilot/copilot-intent.ts");
    expect(intent).toContain("export function looksLikeChangeIntent(");
    expect(intent).toContain("export const ASK_SUGGESTIONS = [");
    // The markdown tokenizer (the parsing half MarkdownLite renders).
    expect(read("src/components/admin/copilot/copilot-markdown.ts")).toContain(
      "export function parseInlineMd(",
    );
    // And the DTO/conversation model the persistence test derives its
    // fixture shape from.
    expect(read("src/components/admin/copilot/copilot-types.ts")).toContain(
      "export interface ConversationTurn {",
    );
  });
});
