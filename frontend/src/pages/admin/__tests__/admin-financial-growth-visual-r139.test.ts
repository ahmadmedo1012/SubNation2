/**
 * R139 (agent 139-j, precision) — the financial/growth-ops visual pins.
 *
 * The r138 designer-lens family (storefront) extended onto the six
 * FINANCIAL/GROWTH admin surfaces this round: pricing.tsx + pricing/*,
 * promotions.tsx + promotions/*, referrals.tsx + referrals/*, risk.tsx
 * + risk-event.tsx + risk/*, forecast/StockoutRiskPanel (consumed by
 * products.tsx — page untouched). These are SOURCE-scan pins (the
 * r128-sweep / r137-contract idiom — invariants a render test only
 * covers incidentally) over the family idioms that landed:
 *
 *   1. §6 RISK STATES — the calculator's RISK_STATE_TONE family left
 *      with the simulator in R181 (this file's pricing pins now cover
 *      the settings card + the dry-run preview only);
 *   2. receipt rhythm on EVERY money surface — /20 hairlines at
 *      section boundaries, terminal weight+size emphasis (never
 *      color), tabular-nums on every dinar/point/percent figure;
 *   3. the §6 destructive contract — the dry-run preview table rides
 *      the table register, its APPLY trigger rests quiet-danger, and
 *      the severity lives in the page's destructive confirm;
 *   4. the calm pill on the one selected-state row (referrals status
 *      chips — RiskFilterChips is the dialect's ORIGIN family,
 *      verified not churned);
 *   5. solid /60 chrome everywhere (the last glass + translucent
 *      surfaces retired: risk thead, DashCard/Section tiles,
 *      forecast panel);
 *
 * Aria/handler/DOM-structure surfaces are byte-identical this round
 * (the r137 decomposition contracts stay the ceiling) — the pins below
 * are class-level only, so a future drift fails HERE with the exact
 * vocabulary that regressed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * Strip BOTH comment kinds before a negative pin — the R139 rationale
 * blocks NAME the retired classes verbatim (a raw absence check would
 * false-fail on the retirement's own documentation). Line comments are
 * removed FIRST: the r137 import-surface notes carry
 * `@/components/admin/<domain>/*` path globs whose `/*` would open
 * phantom block comments under a block-first stripper (the 139-i
 * lesson). No string literal in the scanned files contains `//` or
 * `/*` (verified by read — URLs are single-slash, copy is Arabic), so
 * the regex pass is string-safe.
 */
function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// ── pricing (R181: settings-only — the calculator simulator extracts
//    pricing-risk / CalculatorInputsCard / CalculatorOutputsCard /
//    MarginRow left with the feature) ─────────────────────────────────
const configCard = read("src/components/admin/pricing/PricingConfigCard.tsx");
const previewCard = read("src/components/admin/pricing/RecomputePreviewCard.tsx");
const pricingPage = read("src/pages/admin/pricing.tsx");

// ── promotions / referrals ───────────────────────────────────────────────
const promoForm = read("src/components/admin/promotions/CreatePromotionForm.tsx");
const promoList = read("src/components/admin/promotions/PromotionsList.tsx");
const promoPage = read("src/pages/admin/promotions.tsx");
const refFilters = read("src/components/admin/referrals/ReferralsFilters.tsx");
const refStats = read("src/components/admin/referrals/ReferralsStats.tsx");
const refTable = read("src/components/admin/referrals/ReferralsTable.tsx");
const refRow = read("src/components/admin/referrals/ReferralRowItem.tsx");

// ── risk / forecast ──────────────────────────────────────────────────────
const riskTable = read("src/components/admin/risk/RiskEventsTable.tsx");
const riskChips = read("src/components/admin/risk/RiskFilterChips.tsx");
const riskMeta = read("src/components/admin/risk/risk-meta.ts");
const dashCard = read("src/components/admin/risk/DashCard.tsx");
const dashPanel = read("src/components/admin/risk/RiskDashboardPanel.tsx");
const riskEventPage = read("src/pages/admin/risk-event.tsx");
const forecastPanel = read("src/components/admin/forecast/StockoutRiskPanel.tsx");

describe("R139 (139-j) — pricing: the §6 destructive contract (dry-run preview + quiet-danger APPLY)", () => {
  it("the writable rule card is the page's one elevated register, on the resting /60 edge", () => {
    // R139: border-primary/25 shell → border-border/60 + the r138
    // two-layer calm elevation (neutral black).
    // R143 (L2-1): the calm elevation tokenized — shadow-calm (index.css,
    // theme-aware: dark byte-identical, .light inside the 6–14% ceiling).
    expect(configCard).toContain(
      '"bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-calm"',
    );
    expect(stripComments(configCard)).not.toContain("border-primary/25");
    expect(stripComments(configCard)).not.toContain("0_10px_28px");
  });

  it("the three toolbar CTAs are canonical — save rides buttonVariants, APPLY rests quiet-danger", () => {
    // R139: the hand-rolled bg-primary/hover:bg-primary/90/active:scale
    // stack is gone; the destructive POST /recompute trigger rests
    // muted with the error ink surfacing on hover only — the severity
    // lives in the page's destructive confirm (pinned below).
    expect(stripComments(configCard)).not.toContain("hover:bg-primary/90");
    expect(stripComments(configCard)).not.toContain("active:scale");
    expect(stripComments(configCard)).not.toContain("border-status-warning/25");
    expect(configCard).toContain(
      '"border-border/60 text-muted-foreground hover:text-status-error hover:border-status-error/30 hover:bg-status-error/10"',
    );
  });

  it("the dry-run preview rides the table register with colorless impact numbers", () => {
    // R139: thead bg-muted/15 → the /30 quiet band, seams /30 → /60,
    // container /50 → /60; the drifted counts drop the warning ink
    // (impact data, not a status — weight+size carry them).
    expect(previewCard).toContain('"bg-card border border-border/60 rounded-2xl p-5 space-y-4"');
    expect(previewCard).toContain('"border-b border-border/60 bg-muted/30 text-muted-foreground"');
    expect(previewCard).toContain('"border-b border-border/60 last:border-0"');
    // R141: whitespace-free matching for the two header pins — r140 added
    // scope="col" to RecomputePreviewCard's th row and prettier wrapped
    // each th's text onto its own line, breaking the byte-adjacent pins
    // on pure layout (classes + cell text unchanged; the component's own
    // note: «Classes byte-identical»).
    const squash = (s: string): string => s.replace(/\s+/g, "");
    // R158 (A3) re-pin: physical text-right/text-left became the logical
    // text-start/text-end (the admin RTL sweep); alignment unchanged.
    expect(squash(previewCard)).toContain(squash('text-start font-semibold">الباقة'));
    expect(squash(previewCard)).toContain(squash('text-end font-semibold">السعر الحالي'));
    expect(previewCard.split('className="font-bold text-lg tabular-nums"').length - 1).toBe(2);
    expect(previewCard).not.toContain("text-lg tabular-nums text-status-warning");
    expect(stripComments(previewCard)).not.toContain("text-destructive");
    expect(previewCard).toContain('s.delta >= 0 ? "text-status-success" : "text-status-error"');
  });

  it("the page keeps the two-step wire + the destructive confirm byte-identical", () => {
    // The §6 contract itself: preview (dry_run=true, zero writes) →
    // the destructive confirm carries the preview counts. The r137
    // ceiling pins the handlers; this pin keeps the SEMANTIC pair
    // (dry-run flag + destructive flag) adjacent to the visual layer.
    expect(pricingPage).toContain('"/api/admin/pricing/recompute?dry_run=true"');
    expect(pricingPage).toContain("destructive: true");
    expect(pricingPage).toContain('confirmLabel: "إعادة الاحتساب"');
  });
});

describe("R139 (139-j) — promotions: calm cards + receipt preview + quiet danger", () => {
  it("the live price preview rides the hairline slip — weight + tabular-nums, never the brand tint", () => {
    // R139: bg-primary/8 + border-primary/25 box → border-t /20 row;
    // the projected price drops text-primary + font-mono.
    expect(promoForm).toContain('"border-t border-border/20 pt-2.5"');
    expect(promoForm).toContain('<span className="font-bold tabular-nums">');
    expect(stripComments(promoForm)).not.toContain("font-mono font-bold");
    expect(stripComments(promoForm)).not.toContain("bg-primary/8");
  });

  it("the active sale reads the calm tinted-selected register (no ring, no elevation)", () => {
    expect(promoList).toContain('"border-status-success/30 bg-status-success/5"');
    expect(stripComments(promoList)).not.toContain("ring-1");
    expect(promoList).toContain(': "border-border/60"');
    expect(promoList).toContain(
      '"text-3xs font-bold bg-muted/40 text-muted-foreground border border-border/50 px-1.5 py-0.5 rounded-full"',
    );
    expect(promoList).toContain(
      '<span className="font-bold tabular-nums">{s.discount_percent}% خصم</span>',
    );
  });

  it("the archive trigger rests quiet-danger; the severity lives in the page confirm", () => {
    // R139: text-destructive resting ink → muted ink + error hover;
    // R187 (D-F2): the page's confirm keeps destructive:true + the
    // honest «إيقاف وأرشفة» verb (the backend DELETE soft-deactivates).
    expect(promoList).toContain(
      '"gap-1.5 text-muted-foreground hover:text-status-error hover:bg-status-error/10"',
    );
    expect(stripComments(promoList)).not.toContain("text-destructive hover:text-destructive");
    expect(promoPage).toContain("destructive: true");
    expect(promoPage).toContain('confirmLabel: "إيقاف وأرشفة"');
  });
});

describe("R139 (139-j) — referrals: calm pill + elevated stat strip + the register table", () => {
  it("the status chips ride the calm-pill dialect (both states boxed — no 1px toggle jitter)", () => {
    // R139: the solid bg-primary + white-ink + brand-shadow segment
    // was the pre-r138 raised idiom; onClick + DOM byte-identical.
    expect(refFilters).toContain(
      '"bg-primary/15 text-primary-text border border-primary/30 font-bold"',
    );
    expect(refFilters).toContain(
      '"bg-muted/30 border border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"',
    );
    expect(stripComments(refFilters)).not.toContain("bg-primary text-white");
    expect(stripComments(refFilters)).not.toContain("shadow-primary/25");
  });

  it("the four-stat strip is the page's KPI moment — elevated, values colorless + tabular", () => {
    // R139: MetricCard's two-layer calm elevation at rest; the state
    // identity stays in the icon stage, the number is data.
    // R143 (L2-1): the calm elevation tokenized — shadow-calm (index.css,
    // theme-aware: dark byte-identical, .light inside the 6–14% ceiling).
    expect(refStats).toContain('"bg-card border border-border/60 rounded-2xl p-4 shadow-calm"');
    expect(refStats).toContain(
      '<div className="text-2xl font-bold tabular-nums mb-0.5">{value}</div>',
    );
    expect(refStats).not.toContain("text-2xl font-bold tabular-nums mb-0.5 ${color}");
    expect(stripComments(refStats)).not.toContain("0_10px_28px");
  });

  it("the table rides the register: /30 band header, /60 seams, /20 receipt footer", () => {
    expect(refTable).toContain(
      "border-b border-border/60 bg-muted/30 text-xs font-semibold text-muted-foreground",
    );
    expect(refTable).toContain('"divide-y divide-border/60"');
    expect(refTable).toContain(
      '"px-4 py-2.5 border-t border-border/20 bg-muted/10 flex items-center justify-between text-xs text-muted-foreground tabular-nums"',
    );
    expect(refTable).not.toContain('font-bold text-muted-foreground">');
  });

  it("the granted-points value is receipt data (weight + tabular-nums), the pending arm is the sibling BUTTON", () => {
    // R139: the credited arm renders on CREDITED rows — the §4 API
    // value, display-only; warning ink stays on the pending pill.
    expect(refRow).toContain('"flex items-center gap-1 text-xs font-bold tabular-nums"');
    expect(refRow).toContain("hover:bg-muted/30");
    expect(refRow).not.toContain("hover:bg-muted/15");
  });
});

describe("R139 (139-j) — risk: the last glass thead retires; severity tiles stay token-tinted", () => {
  it("RiskEventsTable rides the solid band + /60 seam register (sticky + z-10 survive)", () => {
    expect(riskTable).toContain(
      '"sticky top-0 z-10 text-xs text-muted-foreground bg-muted/30 border-b border-border/60"',
    );
    const code = stripComments(riskTable);
    expect(code).not.toContain("bg-card/85");
    expect(code).not.toContain("backdrop-blur-md");
    expect(riskTable).toContain(
      "relative border-b border-border/60 hover:bg-muted/30 transition-colors cursor-pointer",
    );
    expect(riskTable).toContain('font-mono text-xs tabular-nums">{e.score}');
  });

  it("RiskFilterChips is the calm dialect's ORIGIN family — verified present, not churned", () => {
    // Both states boxed, aria-pressed live, tones derived from the
    // same --status-* tokens as the row pills (TONE_CHIP).
    expect(riskChips).toContain("aria-pressed={active}");
    expect(riskChips).toContain('"bg-primary/15 text-primary-text border-primary/40 font-bold"');
    expect(riskChips).toContain('"bg-muted/30 border-border/30 hover:bg-muted/60"');
    expect(riskMeta).toContain(
      'success: "bg-status-success/15 text-status-success border-status-success/40"',
    );
    expect(riskMeta).toContain(
      'error: "bg-status-error/15 text-status-error border-status-error/40"',
    );
  });

  it("DashCard solidifies + counts ride tabular-nums; the skeleton mirrors the loaded chrome", () => {
    expect(dashCard).toContain('ok: "border-border/60 bg-card"');
    expect(dashCard).toContain('warn: "border-status-warning/30 bg-status-warning/5"');
    expect(dashCard).toContain('danger: "border-status-error/30 bg-status-error/5"');
    expect(dashCard).toContain("text-xl font-bold mt-0.5 tabular-nums ${valueColor[tone]}");
    expect(dashPanel).toContain('"border border-border/60 rounded-xl p-3 bg-card"');
    expect(dashPanel).toContain('"border border-border/60 rounded-2xl bg-card p-3"');
    expect(stripComments(dashCard)).not.toContain("bg-card/60");
  });

  it("the risk-event page: solid sections on the table-idiom bands + the signal-dump well", () => {
    expect(riskEventPage).toContain(
      '"border border-border/60 rounded-2xl bg-card overflow-hidden"',
    );
    expect(riskEventPage).toContain(
      '"px-3 py-2 border-b border-border/60 bg-muted/30 text-xs font-semibold"',
    );
    expect(riskEventPage).toContain('"border border-border/60 rounded-xl bg-card px-3 py-2"');
    expect(riskEventPage).toContain(
      'text-sm font-bold mt-0.5 tabular-nums ${mono ? "font-mono" : ""}',
    );
    expect(riskEventPage).toContain(
      '"text-2xs font-mono bg-muted/60 border border-border/40 rounded-lg p-2 overflow-x-auto"',
    );
    expect(stripComments(riskEventPage)).not.toContain("text-destructive");
  });

  it("the fraud label KEEPS its canonical-destructive surface — the no-confirm severity carrier", () => {
    // R139 decision, pinned so a future quiet-danger sweep can't blind
    // it: this label POST has NO confirm step — the solid red surface
    // is the action's ONLY severity signal (unlike the topups
    // triggers, whose severity lives in a confirm).
    expect(riskEventPage).toContain('variant="destructive"');
    expect(riskEventPage).toContain('labelMut.mutate("confirmed_fraud")');
  });
});

describe("R139 (139-j) — forecast: the chart-panel family (solid, flat, quiet band)", () => {
  it("the panel joins the NewUsersChart register — no translucency, no decorative gradient", () => {
    expect(forecastPanel).toContain(
      '"border border-border/60 rounded-2xl bg-card overflow-hidden"',
    );
    expect(forecastPanel).toContain(
      '"flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-muted/30"',
    );
    const code = stripComments(forecastPanel);
    expect(code).not.toContain("bg-card/60");
    expect(code).not.toContain("bg-gradient-to-l");
    expect(code).not.toContain("from-status-warning");
  });

  it("the refresh affordance crosses the ≥24px admin edge-target floor; the thumb joins the shelf", () => {
    expect(forecastPanel).toContain(
      '"p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"',
    );
    expect(forecastPanel).toContain(
      '"w-9 h-9 rounded-lg bg-muted/60 border border-border/40 shrink-0 overflow-hidden flex items-center justify-center"',
    );
    expect(forecastPanel).toContain('"divide-y divide-border/60"');
  });
});
