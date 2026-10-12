/**
 * R137 (FE) — the admin/whatsapp.tsx decomposition contract.
 *
 * The WhatsApp OTP console was a 680-line single component (13 useState
 * atoms + a ref, the session-aware list GET with its first-load/
 * silent-refresh split, the create/start/pair-code/QR/confirm-gated-
 * delete session mutations, the pair-code staleness timer, the copy
 * feedback — and every presentational section inline in one function)
 * — the R136 checkout.tsx precedent (1,665 → 9 extracts) applied here:
 * orchestration (pages/admin/whatsapp.tsx) + five verbatim extracts
 * under components/admin/whatsapp/.
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the styled delete confirm with
 * its original message text, the copy helper's failure/success
 * feedback, the stale-keep error banner) is already pinned by the
 * whatsapp-session-actions + whatsapp-error-state render suites; this
 * file guards the STRUCTURE so the decomposition cannot silently
 * regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      680 lines; the ceiling leaves room to grow without re-ballooning
 *      into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. mutation-path ownership — loadSessions (the hasLoadedRef
 *      first-load/refresh split), createSession, startSession,
 *      requestPairCode, loadQr, deleteSession (the confirm-gated
 *      DELETE with its pair-surface cleanup) and copyPairCode stay IN
 *      the page: a stale closure in a presentational extract could
 *      delete the wrong session or copy a code the operator believes
 *      expired;
 *   4. state ownership — all 13 atoms (the pair-code quartet
 *      included) stay centralized in the page; the extracts take
 *      values + callbacks only;
 *   5. purity — the metadata module is React-free, and no extract
 *      touches the session-aware fetcher or re-declares a handler.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/whatsapp.tsx");

describe("R137 (FE) — admin/whatsapp.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/whatsapp.tsx stays under the 1,000-line ceiling (was 680 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/whatsapp/whatsapp-meta",
      "@/components/admin/whatsapp/WhatsappHeader",
      "@/components/admin/whatsapp/CreateSessionForm",
      "@/components/admin/whatsapp/SessionsSectionHeader",
      "@/components/admin/whatsapp/WhatsappSessionsList",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the session-mutation handlers stay IN the page (the extracts render; the page owns the writes)", () => {
    // loadSessions carries the R125-I5 A3-4c split — the FIRST load
    // blanks the list into the skeleton, every post-action reload keeps
    // the rows standing (hasLoadedRef + refreshing). It must never
    // drift into a presentational extract.
    expect(page).toContain("const loadSessions = useCallback(");
    expect(page).toContain('"/api/admin/diagnostics/whatsapp/sessions"');
    expect(page).toContain("if (hasLoadedRef.current) {");
    expect(page).toContain("if (err instanceof AdminSessionExpiredError) return;");
    // The five session mutations + their endpoints.
    expect(page).toContain("const createSession = async (event: FormEvent<HTMLFormElement>) => {");
    expect(page).toContain("const startSession = async (session: WhatsAppSession) => {");
    expect(page).toContain(
      "const requestPairCode = async (event: FormEvent<HTMLFormElement>) => {",
    );
    expect(page).toContain("const loadQr = async (session: WhatsAppSession) => {");
    expect(page).toContain("const deleteSession = async (session: WhatsAppSession) => {");
    expect(page).toContain("${encodeURIComponent(session.id)}/start");
    expect(page).toContain("${encodeURIComponent(pairTarget)}/pair-code");
    expect(page).toContain("${encodeURIComponent(session.id)}/qr");
    expect(page).toContain("if (!body.qrImage) {");
    // B5-05: the styled confirm gate + the original message text, and
    // the pair-surface cleanup the DELETE owns.
    expect(page).toContain("const { confirm, ConfirmDialog } = useConfirm();");
    expect(page).toContain('title: "حذف الجلسة؟",');
    expect(page).toContain("if (pairTarget === session.id) {");
    expect(page).toContain("<ConfirmDialog />");
    // B6 + B5-30: the pair-code copy routes through the shared helper
    // with the check-icon swap — the feedback atom stays page-side.
    expect(page).toContain("const copyPairCode = async (code: string) => {");
    expect(page).toContain("const ok = await copyToClipboard(code);");
    expect(page).toContain("setTimeout(() => setPairCopied(false), 1800);");
    // R125-I5 (A3-12): the staleness timer + the one-place reset.
    expect(page).toContain("PAIR_CODE_STALE_AFTER_MS - (Date.now() - pairCodeIssuedAt)");
    expect(page).toContain("const clearPairCode = useCallback(() => {");
    // R137: the pair-form opener — the hoisted inline onClick body the
    // sessions-list extract fires as one callback.
    expect(page).toContain("const openPairForm = (sessionId: string) => {");
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: the rows, the pair form, the QR block, the skeleton/
    // error/empty cascade and the busy gates all key off these atoms —
    // pairTarget spans three of them (the pair gate, the QR gate, the
    // delete cleanup).
    for (const atom of [
      "const [sessions, setSessions] = useState<WhatsAppSession[]>([]);",
      'const [name, setName] = useState("subnation-otp");',
      'const [phone, setPhone] = useState("");',
      "const [pairTarget, setPairTarget] = useState<string | null>(null);",
      "const [pairCode, setPairCode] = useState<string | null>(null);",
      "const [pairCopied, setPairCopied] = useState(false);",
      "const [pairCodeIssuedAt, setPairCodeIssuedAt] = useState<number | null>(null);",
      "const [pairCodeStale, setPairCodeStale] = useState(false);",
      "const [qrImage, setQrImage] = useState<string | null>(null);",
      "const [loading, setLoading] = useState(true);",
      "const [refreshing, setRefreshing] = useState(false);",
      "const [busy, setBusy] = useState<string | null>(null);",
      "const [error, setError] = useState<string | null>(null);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The R125-I5 (A3-4c) loaded-once ref rides with them.
    expect(page).toContain("const hasLoadedRef = useRef(false);");
    // The scope gate keeps a scope-less deep-link mount fetch-free.
    expect(page).toContain('const canView = hasAdminPermission("settings");');
  });

  it("the adoption-floor pin that reads THIS file keeps its surface inline (preservation, not relocation)", () => {
    // skeleton-primitives' SWEPT_FILES requires this page to keep
    // importing the shared primitives — the loading branch stays in
    // the page (the alerts.tsx / coupons.tsx precedent).
    expect(page).toContain('import { SkeletonText } from "@/components/ui/Skeleton";');
    expect(page).toContain("h-[76px]");
    // The R126-L3 first-load error + empty branches stay inline too
    // (whatsapp-error-state pins their DOM through the page).
    expect(page).toContain("<FetchErrorCard");
    expect(page).toContain('title="تعذّر تحميل جلسات واتساب"');
    expect(page).toContain('title="لا توجد جلسات بعد"');
  });
});

describe("R137 (FE) — the moved markup rides along verbatim (spot-pins at the new addresses)", () => {
  it("the header keeps the 110-M/109-b docs-link degradation + the R134 A3-F5e h1", () => {
    const header = read("src/components/admin/whatsapp/WhatsappHeader.tsx");
    expect(header).toContain("جلسة واتساب");
    expect(header).toContain("WhatsApp OTP");
    expect(header).toContain("{OPENWA_DOCS_URL ? (");
    expect(header).toContain("وثائق البوابة");
    expect(header).toContain("رمز الاقتران يربط رقم واتساب الذي سيرسل أكواد الدخول");
  });

  it("the create form keeps its a11y + busy semantics", () => {
    const form = read("src/components/admin/whatsapp/CreateSessionForm.tsx");
    expect(form).toContain('aria-label="اسم الجلسة"');
    expect(form).toContain('pattern="[A-Za-z0-9-]{3,50}"');
    expect(form).toContain("disabled={busy !== null}");
    expect(form).toContain('busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />');
    expect(form).toContain("onSubmit={onSubmit}");
  });

  it("the sessions section header keeps the labelled refresh affordance", () => {
    const sectionHeader = read("src/components/admin/whatsapp/SessionsSectionHeader.tsx");
    expect(sectionHeader).toContain("الجلسات الحالية");
    expect(sectionHeader).toContain('aria-label="تحديث"');
    expect(sectionHeader).toContain("disabled={loading || refreshing}");
    expect(sectionHeader).toContain('className={loading || refreshing ? "animate-spin" : ""}');
  });

  it("the sessions list keeps the row + pair-form + QR shapes (the render suites' DOM anchors)", () => {
    const list = read("src/components/admin/whatsapp/WhatsappSessionsList.tsx");
    expect(list).toContain('<StatusBadge variant={meta.tone} size="sm">');
    expect(list).toContain("const sessionBusy = busy?.startsWith(`${session.id}:`);");
    // start/qr reflowed to one line at the shallower indent (prettier
    // printWidth 100); delete/pair stay multi-line at their deeper indent.
    expect(list).toContain(
      '{busy === `${session.id}:start` ? <Loader2 className="animate-spin" /> : <Play />}',
    );
    expect(list).toContain(
      '{busy === `${session.id}:qr` ? <Loader2 className="animate-spin" /> : <QrCode />}',
    );
    expect(list).toContain("busy === `${session.id}:delete` ? (");
    expect(list).toContain("busy === `${session.id}:pair` ? (");
    expect(list).toContain("onClick={() => void onStartSession(session)}");
    expect(list).toContain("onClick={() => void onDeleteSession(session)}");
    expect(list).toContain("onSubmit={onRequestPairCode}");
    expect(list).toContain('aria-label="رقم واتساب بصيغة دولية"');
    expect(list).toContain("إصدار رمز الاقتران");
    expect(list).toContain("onClick={() => void onCopyPairCode(pairCode)}");
    expect(list).toContain('{pairCopied ? "تم النسخ" : "نسخ"}');
    expect(list).toContain('pairCodeStale ? "opacity-50" : ""');
    expect(list).toContain("انتهت صلاحية الرمز على الأرجح — أعد إصدار رمز جديد");
    expect(list).toContain("onClick={() => onOpenPairForm(session.id)}");
    expect(list).toContain("ربط برمز الهاتف");
    expect(list).toContain("alt={`رمز QR لجلسة ${session.name}`}");
    expect(list).toContain("من واتساب: الأجهزة المرتبطة ← ربط جهاز");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a card needs is passed DOWN, so
    // no extract may grow its own useState/useRef/useEffect island — a
    // forked pairCode/pairCodeStale pair is how the copy feedback and
    // the staleness cue quietly desync from the page's timer.
    const files = [
      "WhatsappHeader",
      "CreateSessionForm",
      "SessionsSectionHeader",
      "WhatsappSessionsList",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/whatsapp/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
      expect(src, name).not.toMatch(
        /const \[(sessions|name|phone|pairTarget|pairCode|pairCopied|pairCodeIssuedAt|pairCodeStale|qrImage|loading|refreshing|busy|error), set/,
      );
    }
  });

  it("no extract touches the session-aware fetcher (the page owns every session POST/DELETE)", () => {
    // adminFetchJson + the AdminSessionExpiredError sentinel are
    // page-only surfaces — an extract importing them is a mutation path
    // that drifted out of orchestration. The rows fire only through
    // the page-owned callbacks.
    const files = [
      "WhatsappHeader",
      "CreateSessionForm",
      "SessionsSectionHeader",
      "WhatsappSessionsList",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/whatsapp/${name}.tsx`);
      expect(src, name).not.toMatch(/@\/lib\/admin-session/);
      expect(src, name).not.toMatch(/adminFetchJson|adminFetch\b/);
      expect(src, name).not.toMatch(
        /loadSessions|createSession|startSession|requestPairCode|loadQr|deleteSession|copyPairCode/,
      );
    }
  });

  it("the whatsapp metadata module is React-free (pure contracts + status routing + the TTL)", () => {
    const meta = read("src/components/admin/whatsapp/whatsapp-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The row contract the page + the sessions-list extract speak.
    expect(meta).toContain("export interface WhatsAppSession {");
    expect(meta).toContain("export interface SessionsResponse {");
    expect(meta).toContain("export interface PairCodeResponse {");
    // The 110-M/109-b env-driven docs link — the ONLY place a gateway
    // URL ever lives in frontend code, unset degrades to the hint.
    expect(meta).toContain("export const OPENWA_DOCS_URL: string =");
    // The status pill routing (93-C7 / C-UX2 canonical tones).
    expect(meta).toContain(
      "export const STATUS_META: Record<string, { label: string; tone: StatusBadgeVariant }> = {",
    );
    expect(meta).toContain("export function statusMeta(status: string) {");
    // R125-I5 (A3-12): the display-only pair-code staleness TTL.
    expect(meta).toContain("export const PAIR_CODE_STALE_AFTER_MS = 120_000;");
  });
});
