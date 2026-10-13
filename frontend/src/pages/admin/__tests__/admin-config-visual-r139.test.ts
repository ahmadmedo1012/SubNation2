/**
 * R139 (precision) — the CONFIG OPERATIONS visual-chrome pins.
 *
 * Source-scan contract (the r128-sweep / admin-catalog-visual-r139
 * idiom): settings + whatsapp + system rode r137's decomposition and
 * R128's status-token migration, but kept four pre-r138 registers this
 * round retired —
 *
 *   1. the settings tab bar's raised-segment active state → the r138
 *      calm-pill dialect with both states carrying the border box;
 *   2. the settings hand-rolled primary CTAs + the admin console's nine
 *      last bare input fields → the canonical Button and shared Input
 *      recipes (one focus system);
 *   3. the error/status walls (settings' two error-card frames, the
 *      telegram diagnostic result, the whatsapp stale-refresh banner)
 *      → the calm registers (frame /60, quiet token tints, ink on the
 *      verdict);
 *   4. the full-strength frames/seams in whatsapp + the http table
 *      header → the /60 resting family, the QR stage → the bg-muted/60
 *      well, the delete action → quiet danger at rest.
 *
 * Craft note (139-c's money-path-chrome discipline): every pin runs on
 * stripComments() output — the in-file R139 rationale blocks NAME the
 * retired strings, so raw absence checks would false-fail on the
 * retirement's own documentation. Positive pins quote the exact shipped
 * class substrings.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Strips // and /*…*\/ comments so negative pins stay absolute.
 *
 * ORDER MATTERS here (unlike the money-path twin): all three of this
 * lane's pages carry the r137 import-surface note with a PATH GLOB
 * (`@/components/admin/whatsapp/*`) inside a `//` line comment — the
 * glob's `/*` would open a phantom block comment under a block-first
 * stripper and swallow live code (found the hard way: the
 * deleteSession function vanished from the scanned source). Line
 * comments go first; the `[^:]` guard keeps `https://` URLs intact. */
function stripComments(src: string): string {
  return src.replace(/(^|[^:])\/\/[^\n]*/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const pin = (rel: string): string => stripComments(read(rel));

const SETTINGS_PAGE = "src/pages/admin/settings.tsx";
const TAB_BAR = "src/components/admin/settings-page/SettingsTabBar.tsx";
const PROVIDERS_SUMMARY = "src/components/admin/settings-page/AuthProvidersSummary.tsx";
const TELEGRAM_PING = "src/components/admin/settings-page/TelegramDiagnosticPing.tsx";
const ACCOUNT_TAB = "src/pages/admin/settings/account-tab.tsx";
const PROVIDER_CARD = "src/pages/admin/settings/provider-card.tsx";
const TWO_FACTOR = "src/pages/admin/settings/two-factor-setup.tsx";
const WHATSAPP_PAGE = "src/pages/admin/whatsapp.tsx";
const SESSIONS_LIST = "src/components/admin/whatsapp/WhatsappSessionsList.tsx";
const CREATE_FORM = "src/components/admin/whatsapp/CreateSessionForm.tsx";
const SECTION_HEADER = "src/components/admin/whatsapp/SessionsSectionHeader.tsx";
const HTTP_ANALYTICS = "src/components/admin/system/HttpAnalyticsSection.tsx";
const SCHEDULER_DETAILS = "src/components/admin/system/SchedulerDetailsSection.tsx";
const DETAILS_SHELL = "src/components/admin/system/DetailsSection.tsx";

describe("R139 — settings: calm pill + canonical forms + calm error frames", () => {
  it("the tab bar rides the calm-pill dialect with BOTH states carrying the border box", () => {
    const bar = pin(TAB_BAR);
    expect(bar).toContain("bg-secondary/40 border border-border/60 rounded-2xl p-1");
    expect(bar).toContain('"bg-primary/15 text-primary-text border border-primary/30 font-bold"');
    expect(bar).toContain(
      '"border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"',
    );
    // The raised-segment active state is retired — no shadow vocabulary
    // anywhere in the tab bar.
    expect(bar).not.toContain("shadow");
    // Real-tab semantics byte-identical.
    expect(bar).toContain('role="tablist"');
    expect(bar).toContain("aria-selected={activeTab === tab.id}");
  });

  it("the scope-gate banner matches the shared AdminScopeGate's canonical /30 edge", () => {
    expect(pin(SETTINGS_PAGE)).toContain(
      "bg-status-warning/10 border border-status-warning/30 rounded-xl px-3 py-2",
    );
  });

  it("both inline error cards ride the calm frame (border-border/60, no status-error edge)", () => {
    const page = pin(SETTINGS_PAGE);
    expect(page).not.toMatch(/border-status-error\/\d/);
    expect(page.match(/border border-border\/60 rounded-2xl/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("the provider count pill: static-badge /30 edge + tabular-nums on the numeric read-only", () => {
    const summary = pin(PROVIDERS_SUMMARY);
    expect(summary).toContain("rounded-full border tabular-nums");
    expect(summary).toContain('"bg-primary/10 text-primary-text border-primary/30"');
  });

  it("the telegram diagnostic result: quiet tints, ink on the verdict, muted details", () => {
    const ping = pin(TELEGRAM_PING);
    expect(ping).toContain('"bg-status-success/5 border-status-success/20"');
    expect(ping).toContain('"bg-status-error/5 border-status-error/20"');
    expect(ping).toContain('className="w-4 h-4 shrink-0 mt-0.5 text-status-success"');
    expect(ping).toContain('className="w-4 h-4 shrink-0 mt-0.5 text-status-error"');
    expect(ping).toContain(
      'className={`font-bold ${tgTestResult.delivered ? "text-status-success" : "text-status-error"}`}',
    );
    // The technical detail lines drop the full status ink.
    expect(ping).toContain('"font-mono text-3xs text-muted-foreground break-all"');
    expect(ping).toContain('"text-3xs text-muted-foreground tabular-nums"');
    // Never a full-status wall: the retired /10 tint + /25 edge pair
    // (the old parent carried them WITH the status ink).
    expect(ping).not.toContain("bg-status-success/10 border-status-success/25");
    expect(ping).not.toContain("bg-status-error/10 border-status-error/25");
  });

  it("account-tab: zero bare input elements — the shared Input family + canonical save CTAs", () => {
    const tab = pin(ACCOUNT_TAB);
    expect(tab).not.toContain("<input");
    expect(tab.match(/<Input/g)?.length).toBe(6);
    expect(tab).toContain('import { Input } from "@/components/ui/input";');
    expect(tab).toContain('import { Button } from "@/components/ui/button";');
    // Both form saves retire the hand-rolled flat-primary stack.
    expect(tab).not.toContain("bg-primary text-primary-foreground rounded-lg");
    // The reveal span reservation survives the Input merge.
    expect(tab).toContain('className="pl-12"');
    // The 44px reveal hit-box idiom stays.
    expect(tab).toContain("flex h-11 w-11 items-center justify-center touch-target");
  });

  it("provider-card: shared Input credential field (ONE focus ring) + canonical save", () => {
    const card = pin(PROVIDER_CARD);
    expect(card).not.toContain("<input");
    expect(card).toContain('className="font-mono text-left pr-12"');
    // The competing hand-rolled focus ring is gone.
    expect(card).not.toContain("focus:ring-1");
    expect(card).not.toContain("focus:ring-primary");
    // The save rides buttonVariants — the retired hand-rolled stacks
    // (hover-darken + active scale) are gone.
    expect(card).not.toContain("hover:bg-primary/90");
    expect(card).not.toContain("active:scale-95");
    expect(card).toContain("<Button onClick={handleSave} disabled={saving}>");
    // The [SET] secret masking placeholder is byte-identical.
    expect(card).toContain('"••••••••••• (مُعيَّن)"');
  });

  it("two-factor-setup: the OTP field joins the input token family + the ONE focus ring", () => {
    const twofa = pin(TWO_FACTOR);
    // The named tracking utility was a no-op (the global Arabic
    // letter-spacing guard zeroes the five named forms on ALL runs) —
    // the arbitrary form is the tracked register, matching the
    // storefront OTP field.
    expect(twofa).toContain("tracking-[0.2em]");
    expect(twofa).not.toContain("tracking-widest");
    expect(twofa).toContain("border border-muted-foreground/75 rounded-xl px-4 text-center");
    expect(twofa).toContain("focus:border-primary/50 focus:ring-2 focus:ring-ring");
    expect(twofa).not.toContain("ring-primary/20");
    // The rotate password field rides the shared Input.
    expect(twofa.match(/<Input/g)?.length).toBe(1);
    // The verify CTA keeps its h-11 pairing with the OTP field while
    // riding buttonVariants.
    expect(twofa).toContain('className="h-11 px-6"');
  });
});

describe("R139 — whatsapp: calm banner + wells + quiet danger + hairline rows", () => {
  it("the stale-refresh banner rides the calm-error register", () => {
    const page = pin(WHATSAPP_PAGE);
    expect(page).toContain('"rounded-xl border border-border/60 bg-card p-3 flex gap-2 text-sm"');
    expect(page).toContain('className="w-4 h-4 mt-0.5 shrink-0 text-status-error"');
    expect(page).toContain('className="text-foreground/80"');
    // The error-ink retry (ChartErrorBanner's recovery register).
    expect(page).toContain(
      '"ms-auto text-xs font-bold text-status-error underline underline-offset-2 hover:opacity-80 shrink-0"',
    );
    // The destructive-tinted wall is retired.
    expect(page).not.toContain("bg-destructive/5");
    expect(page).not.toContain("border-destructive/25");
    // Stale-keep semantics byte-identical.
    expect(page).toContain('role="alert"');
    expect(page).toContain("error && sessions.length > 0");
  });

  it("both card frames + the header seam ride the /60 resting family", () => {
    expect(pin(WHATSAPP_PAGE)).toContain(
      '"rounded-2xl border border-border/60 bg-card overflow-hidden"',
    );
    expect(pin(CREATE_FORM)).toContain(
      '"rounded-2xl border border-border/60 bg-card p-4 space-y-3"',
    );
    expect(pin(SECTION_HEADER)).toContain(
      '"px-4 py-3 border-b border-border/60 flex items-center justify-between"',
    );
  });

  it("the sessions list: /20 hairline rows, StatusBadge statuses, QR well, calm pair panel", () => {
    const list = pin(SESSIONS_LIST);
    expect(list).toContain('"divide-y divide-border/20"');
    // Connection status = the canonical quiet-token pill.
    expect(list).toContain('<StatusBadge variant={meta.tone} size="sm">');
    // The QR stage is the calm well.
    expect(list).toContain(
      '"rounded-xl border border-border/40 bg-muted/60 p-4 flex flex-col items-center gap-2"',
    );
    // The pair form joins the resting register (no brand-tinted shell).
    expect(list).toContain('"rounded-xl border border-border/60 bg-muted/15 p-3 space-y-2"');
    expect(list).not.toContain("bg-primary/5");
    expect(list).not.toContain("border-primary/20");
    // The issued code keeps its LTR isolation + staleness cue.
    expect(list).toContain("tracking-[0.25em] bg-background border border-border/60");
    expect(list).toContain("pairCodeStale");
  });

  it("delete: quiet danger at rest — severity lives in the destructive confirm", () => {
    const list = pin(SESSIONS_LIST);
    expect(list).not.toContain('variant="destructive"');
    expect(list).toContain(
      'className="text-muted-foreground hover:text-status-error hover:border-status-error/30 hover:bg-status-error/10"',
    );
    // The page's confirm keeps its destructive severity.
    const page = pin(WHATSAPP_PAGE);
    expect(page).toContain('confirmLabel: "حذف"');
    expect(page).toContain("destructive: true");
  });
});

describe("R139 — system: the nine panels' shared register + token chips", () => {
  it("the DetailsSection shell rides solid bg-card + /60 for every panel it renders", () => {
    expect(pin(DETAILS_SHELL)).toContain(
      '"group bg-card border border-border/60 rounded-2xl overflow-hidden',
    );
  });

  it("the top-routes table header seam + the leader chip join the family values", () => {
    expect(pin(HTTP_ANALYTICS)).toContain(
      '"px-4 py-3 border-b border-border/60 flex items-center gap-2"',
    );
    const sched = pin(SCHEDULER_DETAILS);
    expect(sched).toContain("bg-primary/10 border border-primary/30 text-primary-text");
    // Route rows keep LTR isolation + tabular counts (verified, pinned).
    expect(pin(HTTP_ANALYTICS)).toContain('dir="ltr"');
    expect(pin(HTTP_ANALYTICS)).toContain("text-xs font-bold tabular-nums shrink-0");
  });

  it("no glass, no brand-colored shadows, no hand-rolled focus rings survive in the lane", () => {
    const files = [
      SETTINGS_PAGE,
      TAB_BAR,
      PROVIDERS_SUMMARY,
      TELEGRAM_PING,
      ACCOUNT_TAB,
      PROVIDER_CARD,
      TWO_FACTOR,
      WHATSAPP_PAGE,
      SESSIONS_LIST,
      CREATE_FORM,
      SECTION_HEADER,
      HTTP_ANALYTICS,
      SCHEDULER_DETAILS,
      DETAILS_SHELL,
    ];
    for (const f of files) {
      const src = pin(f);
      expect(src, f).not.toContain("backdrop-blur");
      expect(src, f).not.toMatch(/bg-card\/9\d/);
      expect(src, f).not.toContain("shadow-primary");
      expect(src, f).not.toContain("focus:ring-1");
    }
  });
});
