/**
 * R137 (FE) — the admin/settings.tsx decomposition contract.
 *
 * The settings shell was a 711-line single component — its three tab
 * surfaces had already moved to pages/admin/settings/* in R126-L9, but
 * the page still carried the tab bar, the «المصادقة» providers panel,
 * the whole «التكاملات» telegram card (status rows + the diagnostic
 * ping + the setup guide), the «الإشعارات» pane and the «الأمان» pane
 * inline in one function — the R136 checkout.tsx precedent (1,665 → 9
 * extracts) applied here: orchestration (pages/admin/settings.tsx) +
 * ten verbatim extracts under components/admin/settings-page/ (the
 * -page suffix avoids colliding with the pages/admin/settings/* tab
 * modules).
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r125 idiom —
 * structural invariants a render test only covers incidentally). The
 * RENDER contract (byte-identical DOM, the ?tab= two-way sync, the 2FA
 * re-enroll flow, the account-tab password honesty) is already pinned
 * by the settings-2fa-re-enroll + settings-provider-card-error-span
 * render suites and the settings-security-facts-copy source pin; this
 * file guards the STRUCTURE so the decomposition cannot silently
 * regress:
 *
 *   1. size ceiling — the page stays an orchestration core (it was
 *      711 lines; the ceiling leaves room to grow without re-ballooning
 *      into the monolith);
 *   2. deletion guards — every extract is still imported by the page
 *      (a dropped import = a section silently vanished);
 *   3. mutation-path ownership — loadSettingsAndProviders +
 *      fetchJsonOrNull (the settings/providers fetch pair with the
 *      R120-B4 401 sentinel) and runTelegramTest (the diagnostic POST
 *      with its session-expiry quiet-catch) stay IN the page: a stale
 *      closure in a presentational extract could re-POST the ping off
 *      a dead session or swallow the load failure the retry depends on;
 *   4. state ownership — all 7 cross-section atoms stay centralized in
 *      the page (activeTab drives the ?tab= sync AND every pane gate);
 *      the extracts take values + callbacks only;
 *   5. purity — the metadata module is React-free, and no extract
 *      touches the session-aware fetcher or re-declares a handler.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const page = read("src/pages/admin/settings.tsx");

describe("R137 (FE) — admin/settings.tsx decomposition: page stays an orchestration core", () => {
  it("pages/admin/settings.tsx stays under the 1,000-line ceiling (was 711 at decomposition)", () => {
    const lines = page.split("\n").length;
    expect(lines).toBeLessThan(1000);
  });

  it("the page imports every extract (deletion guard — a dropped import is a vanished section)", () => {
    const extracts = [
      "@/components/admin/settings-page/settings-page-meta",
      "@/components/admin/settings-page/SettingsTabBar",
      "@/components/admin/settings-page/AuthProvidersSummary",
      "@/components/admin/settings-page/AuthProvidersList",
      "@/components/admin/settings-page/AuthHowItWorksInfo",
      "@/components/admin/settings-page/TelegramCardHeader",
      "@/components/admin/settings-page/TelegramStatusRows",
      "@/components/admin/settings-page/TelegramDiagnosticPing",
      "@/components/admin/settings-page/TelegramSetupGuide",
      "@/components/admin/settings-page/NotificationsTabPanel",
    ];
    for (const specifier of extracts) {
      expect(page, specifier).toContain(`from "${specifier}"`);
    }
  });

  it("the mutation-path handlers stay IN the page (the extracts render; the page owns the settings writes)", () => {
    // loadSettingsAndProviders carries the R120-B4 honest-failure fetch
    // pair — fetchJsonOrNull's ok-guard + the "__unauthorized__"
    // sentinel defer a mid-session 401 to the global handler instead of
    // a local error card, and the failure surfaces as the Arabic
    // loadError the two retry buttons consume.
    expect(page).toContain("const loadSettingsAndProviders = async (): Promise<void> => {");
    expect(page).toContain('fetchJsonOrNull("/api/admin/settings")');
    expect(page).toContain('fetchJsonOrNull("/api/admin/settings/auth")');
    expect(page).toContain(
      'if (isAdminUnauthorized(res, url)) throw new Error("__unauthorized__");',
    );
    expect(page).toContain(
      // R148 (3-errcopy): the raw extractor retired — the load failure
      // routes through getErrorMessage (network-level English collapses
      // to Arabic; the wrapper's Arabic body messages pass through).
      "setLoadError(getErrorMessage(err));",
    );
    // runTelegramTest carries the diagnostic POST — the
    // AdminSessionExpiredError quiet-catch + the offline fallback
    // result. It must never drift into a presentational extract.
    expect(page).toContain("async function runTelegramTest(): Promise<void> {");
    expect(page).toContain('"/api/admin/diagnostics/telegram-test"');
    expect(page).toContain("if (err instanceof AdminSessionExpiredError) return;");
    // The R120-B4 (A2-F20) ?tab= two-way sync — URL→tab, tab→URL
    // (replaceState) — and the scope gate the sync consults.
    expect(page).toContain("const selectTab = (id: string) => {");
    expect(page).toContain('const t = new URLSearchParams(window.location.search).get("tab");');
    expect(page).toContain('const t = new URLSearchParams(searchParam).get("tab");');
    expect(page).toContain('window.history.replaceState(null, "", url.toString());');
    expect(page).toContain('if (!adminToken) navigate("/admin/login");');
    // The optimistic providers updater rides down as a callback — the
    // atom it writes stays HERE.
    expect(page).toContain(
      "setProviders((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))",
    );
    // And the page is typed — no `any` state sneaks back in.
    expect(page).not.toMatch(/useState<any/);
  });

  it("the cross-section state atoms stay centralized in the page (values + callbacks flow down)", () => {
    // One source: activeTab drives the ?tab= sync AND every pane gate;
    // loading/loadError gate BOTH the «المصادقة» and «التكاملات»
    // skeleton→error→content cascades; the telegram atoms feed the
    // diagnostic ping card.
    for (const atom of [
      "const [settings, setSettings] = useState<TelegramSettings | null>(null);",
      "const [providers, setProviders] = useState<AuthProvider[]>([]);",
      "const [loading, setLoading] = useState(true);",
      "const [loadError, setLoadError] = useState<string | null>(null);",
      "const [activeTab, setActiveTab] = useState(() => {",
      "const [tgTesting, setTgTesting] = useState(false);",
      "const [tgTestResult, setTgTestResult] = useState<TelegramTestResult | null>(null);",
    ]) {
      expect(page, atom).toContain(atom);
    }
    // The tab inventory + the scope filter the tab bar consumes stay
    // page-side (the extract receives the PRE-FILTERED list).
    expect(page).toContain("const TABS = [");
    expect(page).toContain("tabs={TABS.filter((tab) => tabAllowed(tab.id, canManageSettings))}");
    expect(page).toContain('const canManageSettings = hasAdminPermission("settings");');
    // The summary banner's count derivation stays page-side too.
    expect(page).toContain("const enabledCount = providers.filter((p) => p.enabled).length;");
  });

  it("the adoption-floor + copy pins that read THIS file keep their surfaces inline (preservation, not relocation)", () => {
    // skeleton-primitives' SWEPT_FILES requires this page to keep
    // importing the shared primitives — both loading branches stay in
    // the page (the 1-a system.tsx / 2-c security.tsx precedent).
    expect(page).toContain('import { SkeletonText } from "@/components/ui/Skeleton";');
    expect(page).toContain("count={3}");
    // settings-security-facts-copy pins the «الأمان» pane's rendered
    // title IN this file — the whole security pane (the TwoFactorSetup
    // mount included) stays inline.
    expect(page).toContain("حقائق الأمان المطبَّقة");
    expect(page).toContain("<TwoFactorSetup adminToken={adminToken} />");
    // settings-2fa-re-enroll + the R126-L9 split still reach the tab
    // modules through the page.
    expect(page).toContain('import { AccountTab } from "./settings/account-tab";');
    expect(page).toContain('import { TwoFactorSetup } from "./settings/two-factor-setup";');
  });
});

describe("R137 (FE) — the moved markup rides along verbatim (spot-pins at the new addresses)", () => {
  it("the tab bar keeps the R124-I5 real-tab semantics", () => {
    const tabBar = read("src/components/admin/settings-page/SettingsTabBar.tsx");
    expect(tabBar).toContain('role="tablist"');
    expect(tabBar).toContain('aria-label="أقسام الإعدادات"');
    expect(tabBar).toContain('role="tab"');
    expect(tabBar).toContain("id={`settings-tab-${tab.id}`}");
    expect(tabBar).toContain("aria-selected={activeTab === tab.id}");
    expect(tabBar).toContain("onClick={() => onSelect(tab.id)}");
  });

  it("the auth panel extracts keep their copy + the B14-5 plural routing", () => {
    const summary = read("src/components/admin/settings-page/AuthProvidersSummary.tsx");
    expect(summary).toContain("طرق تسجيل الدخول");
    expect(summary).toContain("formatCount(enabledCount, {");
    expect(summary).toContain('two: "طريقتان مفعّلتان"');
    expect(summary).toContain("{enabledCount}/{providersCount}");
    const list = read("src/components/admin/settings-page/AuthProvidersList.tsx");
    expect(list).toContain("<ProviderCard");
    expect(list).toContain("onUpdate={onUpdateProvider}");
    const info = read("src/components/admin/settings-page/AuthHowItWorksInfo.tsx");
    expect(info).toContain("كيف يعمل النظام؟");
    expect(info).toContain("[SET]");
  });

  it("the telegram card extracts keep their copy + the staleness semantics", () => {
    const header = read("src/components/admin/settings-page/TelegramCardHeader.tsx");
    expect(header).toContain('variant={settings.telegram_configured ? "success" : "neutral"}');
    expect(header).toContain("تيليجرام");
    const rows = read("src/components/admin/settings-page/TelegramStatusRows.tsx");
    expect(rows).toContain('label: "TELEGRAM_BOT_TOKEN"');
    expect(rows).toContain('label: "TELEGRAM_CHAT_ID"');
    expect(rows).toContain('okText: "تم الضبط"');
    const ping = read("src/components/admin/settings-page/TelegramDiagnosticPing.tsx");
    expect(ping).toContain("اختبار اتصال البوت");
    expect(ping).toContain("جارٍ الإرسال…");
    expect(ping).toContain("onClick={onRunTest}");
    expect(ping).toContain("disabled={tgTesting}");
    expect(ping).toContain("تم التسليم بنجاح");
    const guide = read("src/components/admin/settings-page/TelegramSetupGuide.tsx");
    expect(guide).toContain("كيفية الإعداد");
    expect(guide).toContain("@BotFather");
  });

  it("the notifications pane keeps the R120-B4 descriptive-panel shape", () => {
    const panel = read("src/components/admin/settings-page/NotificationsTabPanel.tsx");
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain('aria-labelledby="settings-tab-notifications"');
    expect(panel).toContain("عبر تيليجرام");
    expect(panel).toContain("إتمام طلب شراء جديد");
  });
});

describe("R137 (FE) — the extracts are self-contained presentational units", () => {
  it("no extract re-declares page state (they take values + callbacks only — no duplicated truth)", () => {
    // Stateless by contract: every atom a card needs is passed DOWN, so
    // no extract may grow its own useState/useRef/useEffect island — a
    // forked activeTab or tgTestResult is how the ?tab= sync and the
    // diagnostic ping quietly desync.
    const files = [
      "SettingsTabBar",
      "AuthProvidersSummary",
      "AuthProvidersList",
      "AuthHowItWorksInfo",
      "TelegramCardHeader",
      "TelegramStatusRows",
      "TelegramDiagnosticPing",
      "TelegramSetupGuide",
      "NotificationsTabPanel",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/settings-page/${name}.tsx`);
      expect(src, name).not.toMatch(/useState\(|useRef\(|useEffect\(|useMemo\(/);
      expect(src, name).not.toMatch(
        /const \[(settings|providers|loading|loadError|activeTab|tgTesting|tgTestResult), set/,
      );
    }
  });

  it("no extract touches the session-aware fetcher (the page owns every settings read/write)", () => {
    // adminFetchJson + the AdminSessionExpiredError sentinel are
    // page-only surfaces — an extract importing them is a mutation path
    // that drifted out of orchestration. The provider cards keep their
    // own save machinery (the R126-L9 boundary); these extracts only
    // render and forward callbacks.
    const files = [
      "SettingsTabBar",
      "AuthProvidersSummary",
      "AuthProvidersList",
      "AuthHowItWorksInfo",
      "TelegramCardHeader",
      "TelegramStatusRows",
      "TelegramDiagnosticPing",
      "TelegramSetupGuide",
      "NotificationsTabPanel",
    ];
    for (const name of files) {
      const src = read(`src/components/admin/settings-page/${name}.tsx`);
      expect(src, name).not.toMatch(/@\/lib\/admin-session/);
      expect(src, name).not.toMatch(/adminFetchJson|adminFetch\b/);
      expect(src, name).not.toMatch(/runTelegramTest|loadSettingsAndProviders/);
    }
  });

  it("the settings-page metadata module is React-free (pure contracts + the scope gate)", () => {
    const meta = read("src/components/admin/settings-page/settings-page-meta.ts");
    expect(meta).not.toMatch(/from "react"|from "lucide-react"/);
    // The R123 (E3 P3f) scope gate — shared by the initializer, the
    // URL→tab effect and the tab-bar filter; one pure function.
    expect(meta).toContain(
      "export function tabAllowed(id: string, canManageSettings: boolean): boolean {",
    );
    // The contracts the page + the telegram extracts speak.
    expect(meta).toContain("export interface TelegramSettings {");
    expect(meta).toContain("export interface TelegramTestResult {");
  });
});
