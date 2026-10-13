/**
 * R139 (agent 139-j, precision) — the financial/growth-ops visual pins.
 *
 * The r138 designer-lens family (storefront) extended onto the seven
 * FINANCIAL/GROWTH admin surfaces this round: pricing.tsx + pricing/*,
 * promotions.tsx + promotions/*, referrals.tsx + referrals/*, risk.tsx
 * + risk-event.tsx + risk/*, forecast/StockoutRiskPanel (consumed by
 * products.tsx — page untouched) and the copilot/* console (mounted by
 * layout.tsx — page untouched). These are SOURCE-scan pins (the
 * r128-sweep / r137-contract idiom — invariants a render test only
 * covers incidentally) over the family idioms that landed:
 *
 *   1. §6 RISK STATES — RISK_STATE_TONE is the lane's source of truth:
 *      SAFE/WATCH/THIN/LOSS all ride the --status-* token family
 *      (LOSS migrated off the raw --destructive channel), and the
 *      WHY-text contract (RISK_STATE_LABEL + riskExplanation) rides
 *      byte-identical — never a bare color;
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
 *      surfaces retired: risk thead, copilot rail/scrim/panel,
 *      DashCard/Section tiles, forecast panel);
 *   6. the copilot console's coherent pair treatment (solid brand
 *      operator bubble / muted-60 paper assistant bubble), canonical
 *      Button/Composer registers and ONE --status-* red vocabulary.
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

// ── pricing ──────────────────────────────────────────────────────────────
const pricingRisk = read("src/components/admin/pricing/pricing-risk.ts");
const outputsCard = read("src/components/admin/pricing/CalculatorOutputsCard.tsx");
const marginRow = read("src/components/admin/pricing/MarginRow.tsx");
const configCard = read("src/components/admin/pricing/PricingConfigCard.tsx");
const previewCard = read("src/components/admin/pricing/RecomputePreviewCard.tsx");
const inputsCard = read("src/components/admin/pricing/CalculatorInputsCard.tsx");
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

// ── copilot ──────────────────────────────────────────────────────────────
const trigger = read("src/components/admin/copilot/CopilotTrigger.tsx");
const composer = read("src/components/admin/copilot/CopilotComposer.tsx");
const turnView = read("src/components/admin/copilot/TurnView.tsx");
const askAnswer = read("src/components/admin/copilot/AskAnswer.tsx");
const previewC = read("src/components/admin/copilot/PreviewCard.tsx");
const panel = read("src/components/admin/copilot/CopilotPanel.tsx");
const sidebar = read("src/components/admin/copilot/ConversationSidebar.tsx");
const historyView = read("src/components/admin/copilot/CopilotHistoryView.tsx");
const execBadge = read("src/components/admin/copilot/DirectExecutionBadge.tsx");
const traceLine = read("src/components/admin/copilot/ProgressTraceLine.tsx");
const changeDiff = read("src/components/admin/copilot/ChangeDiff.tsx");

describe("R139 (139-j) — pricing: the §6 risk states ride --status-* tokens WITH the WHY text", () => {
  it("RISK_STATE_TONE maps all four states onto the status-token family — the raw destructive channel is gone", () => {
    // R139: LOSS shipped on border/bg/text-destructive (the one
    // bare-red remnant in a lane whose §6 rule says "never bare
    // red/green"); it now rides the exact shape of SAFE/WATCH/THIN.
    expect(pricingRisk).toContain(
      'SAFE: "border-status-success/40 bg-status-success/10 text-status-success"',
    );
    expect(pricingRisk).toContain(
      'WATCH: "border-status-warning/40 bg-status-warning/10 text-status-warning"',
    );
    expect(pricingRisk).toContain(
      'THIN: "border-status-low-stock/40 bg-status-low-stock/10 text-status-low-stock"',
    );
    expect(pricingRisk).toContain(
      'LOSS: "border-status-error/40 bg-status-error/10 text-status-error"',
    );
    expect(stripComments(pricingRisk)).not.toContain("destructive");
  });

  it("the WHY-text contract rides byte-identical (label map + resolver + the badge mount)", () => {
    // §6: SAFE/WATCH/THIN/LOSS are never a bare color — the badge
    // renders the label AND riskExplanation()'s reason line under it.
    expect(pricingRisk).toContain('SAFE: "آمن"');
    expect(pricingRisk).toContain('WATCH: "تحت المراقبة"');
    expect(pricingRisk).toContain('THIN: "هامش ضعيف"');
    expect(pricingRisk).toContain('LOSS: "خسارة"');
    expect(pricingRisk).toContain(
      "export function riskExplanation(result: CalculatorResponse): string",
    );
    expect(outputsCard).toContain("RISK_STATE_TONE[result.risk_state]");
    expect(outputsCard).toContain("data-risk-state={result.risk_state}");
    expect(outputsCard).toContain("{riskExplanation(result)}");
  });

  it("the stale-keep banner + every console error ink speak the status-error triple", () => {
    // R139: the R126-L3 banner + the invalid-coupon line + the three
    // worst-case negative inks + the loss warning chip all migrate
    // text-destructive → text-status-error (one red vocabulary).
    expect(outputsCard).toContain(
      "border border-status-error/25 bg-status-error/5 rounded-xl text-status-error",
    );
    expect(stripComments(outputsCard)).not.toContain("text-destructive");
    expect(stripComments(marginRow)).not.toContain("text-destructive");
  });
});

describe("R139 (139-j) — pricing: receipt rhythm on the economics console", () => {
  it("the terminal amount is colorless — weight + size + tabular-nums carry the emphasis", () => {
    // R139: the headline «السعر النهائي» drops text-primary-text for
    // plain foreground (the CartSummaryAside colorless-terminal pin).
    expect(outputsCard).toContain('<span className="tabular-nums font-bold text-base">');
    expect(outputsCard).not.toContain("tabular-nums font-bold text-primary-text text-base");
  });

  it("every section boundary rides the /20 hairline (six rules on the slip)", () => {
    // waterfall terminal + margins + worst-case + guardrails +
    // applied-config line + warnings — the CartSummaryAside
    // section-rule value, never a hard edge.
    const rules = outputsCard.split("border-t border-border/20").length - 1;
    expect(rules).toBeGreaterThanOrEqual(6);
    expect(outputsCard).not.toContain("border-t border-border/40");
  });

  it("MarginRow leaves the boxed chip for the hairline-ruled slip register", () => {
    // R139: border-b border-border/20 between tiers, none after the
    // last — the VariantFormPanel expected-price conversion.
    expect(marginRow).toContain(
      '"flex items-center justify-between py-2.5 border-b border-border/20 last:border-0"',
    );
    expect(stripComments(marginRow)).not.toContain("bg-muted/20");
  });

  it("the two calculator cards join the /60 resting family and stay FLAT", () => {
    // R139: one elevated register per page — the WRITABLE
    // PricingConfigCard owns it; the read-only pair rests flat.
    expect(inputsCard).toContain('"bg-card border border-border/60 rounded-2xl p-5 space-y-4"');
    expect(outputsCard).toContain('"bg-card border border-border/60 rounded-2xl p-5 space-y-3"');
    expect(inputsCard).not.toContain("border-border/55");
    expect(outputsCard).not.toContain("border-border/55");
    expect(inputsCard).not.toContain("shadow-[0_1px_2px");
    expect(outputsCard).not.toContain("shadow-[0_1px_2px");
  });
});

describe("R139 (139-j) — pricing: the §6 destructive contract (dry-run preview + quiet-danger APPLY)", () => {
  it("the writable rule card is the page's one elevated register, on the resting /60 edge", () => {
    // R139: border-primary/25 shell → border-border/60 + the r138
    // two-layer calm elevation (neutral black).
    expect(configCard).toContain(
      '"bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]"',
    );
    expect(stripComments(configCard)).not.toContain("border-primary/25");
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
    expect(previewCard).toContain('text-right font-semibold">الباقة');
    expect(previewCard).toContain('text-left font-semibold">السعر الحالي');
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

  it("the permanent-delete trigger rests quiet-danger; the severity lives in the page confirm", () => {
    // R139: text-destructive resting ink → muted ink + error hover;
    // the page's confirm keeps destructive:true + «حذف نهائي».
    expect(promoList).toContain(
      '"gap-1.5 text-muted-foreground hover:text-status-error hover:bg-status-error/10"',
    );
    expect(stripComments(promoList)).not.toContain("text-destructive hover:text-destructive");
    expect(promoPage).toContain("destructive: true");
    expect(promoPage).toContain('confirmLabel: "حذف نهائي"');
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
    expect(refStats).toContain(
      '"bg-card border border-border/60 rounded-2xl p-4 shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]"',
    );
    expect(refStats).toContain(
      '<div className="text-2xl font-bold tabular-nums mb-0.5">{value}</div>',
    );
    expect(refStats).not.toContain("text-2xl font-bold tabular-nums mb-0.5 ${color}");
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

describe("R139 (139-j) — copilot: canonical chrome + the coherent pair treatment", () => {
  it("the floating launcher is a canonical Button — the glow-halo vocabulary is gone", () => {
    // R139: the bg-primary/40 blur-xl halo + gradient disc +
    // shadow-2xl + ring-2 were §1-banned vocabulary; the w-14 FAB
    // geometry + the R134 A3-F5b single accessible name survive.
    expect(trigger).toContain("<Button");
    expect(trigger).toContain('className="fixed bottom-6 left-6 z-30 w-14 h-14 rounded-full"');
    expect(trigger).toContain('title="المساعد الذكي (فتح — Ctrl/Cmd+J)"');
    const code = stripComments(trigger);
    expect(code).not.toContain("blur-xl");
    expect(code).not.toContain("shadow-2xl");
    expect(code).not.toContain("ring-2");
    expect(code).not.toContain("bg-gradient-to-br");
  });

  it("the composer rides the shared field register + a canonical send Button (ONE focus ring)", () => {
    // R139: the composite row adopts the Input family's edge/fill and
    // the ONE focus system's ring token; the hand-rolled gradient
    // disc + brand ring retire. aria-label + the Enter-to-send gate
    // byte-identical.
    expect(composer).toContain(
      "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background",
    );
    expect(composer).toContain("border border-muted-foreground/75 rounded-2xl");
    expect(composer).toContain('size="icon"');
    expect(composer).toContain('aria-label="إرسال"');
    const code = stripComments(composer);
    expect(code).not.toContain("ring-primary/30");
    expect(code).not.toContain("bg-gradient-to-br");
    expect(code).not.toContain("hover:brightness");
  });

  it("the thread pair rhymes with the tickets thread — solid brand operator / muted paper assistant", () => {
    // R139: the user bubble rides the SOLID brand fill (no gradient,
    // no border, no elevation); the assistant bubble rides the
    // muted/60 + /50 edge. Mirrored corners, one coherent pair.
    expect(turnView).toContain(
      '"max-w-[88%] bg-primary text-primary-foreground rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm whitespace-pre-wrap"',
    );
    expect(askAnswer).toContain(
      '"group relative bg-muted/60 border border-border/50 rounded-2xl rounded-tr-md px-3.5 py-2.5 text-sm"',
    );
    const tv = stripComments(turnView);
    expect(tv).not.toContain("from-primary/15");
    expect(tv).not.toContain("shadow-sm");
    expect(stripComments(askAnswer)).not.toContain("shadow-sm");
  });

  it("the preview card rhymes with the pair: /50 edge, /20 band seams, canonical approve CTA", () => {
    // R139: border-border (full) → /50 (the muted-bubble edge value);
    // shadow-sm retires; the approve rides buttonVariants while the
    // pinned double-confirm sibling keeps its AA tint trio.
    expect(previewC).toContain(
      '"border border-border/50 rounded-2xl rounded-tr-md bg-muted/20 overflow-hidden"',
    );
    expect(previewC).toContain(
      '"px-3 py-2 border-b border-border/20 flex items-center gap-2 text-2xs bg-muted/30"',
    );
    expect(previewC).toContain(
      '"px-3 py-2 border-t border-border/20 flex items-center gap-2 bg-muted/10"',
    );
    expect(previewC).toContain('size="sm"');
    expect(previewC).toContain('className="flex-1 rounded-xl py-2 font-bold"');
    expect(previewC).toContain(
      "bg-primary/10 border border-primary/40 text-primary-text text-xs font-bold",
    );
    const code = stripComments(previewC);
    expect(code).not.toContain("hover:brightness");
    expect(code).not.toContain("from-primary");
  });

  it("the panel joins the modal family — /70 scrim, shadow-sm + /60 edge (elevation declared once)", () => {
    expect(panel).toContain(
      '"fixed inset-0 bg-black/70 z-40 backdrop-blur-sm animate-in fade-in duration-150"',
    );
    expect(panel).toContain(
      "bg-card border-l border-border/60 z-50 shadow-sm animate-in slide-in-from-left-8 duration-200 flex outline-none",
    );
    const code = stripComments(panel);
    expect(code).not.toContain("shadow-2xl");
    expect(code).not.toContain("bg-black/50");
  });

  it("the console speaks ONE red vocabulary — the destructive channel is gone folder-wide", () => {
    // TurnView error banner, HistoryView failure banner,
    // DirectExecutionBadge failure arm, PreviewCard validation chips,
    // ConversationSidebar delete hover + ChangeDiff قبل tile all
    // migrate to the --status-error family this round.
    for (const [name, src] of [
      ["TurnView", turnView],
      ["CopilotHistoryView", historyView],
      ["DirectExecutionBadge", execBadge],
      ["PreviewCard", previewC],
      ["ConversationSidebar", sidebar],
      ["ChangeDiff", changeDiff],
    ] as const) {
      const code = stripComments(src);
      expect(code, name).not.toContain("bg-destructive");
      expect(code, name).not.toContain("text-destructive");
      expect(code, name).not.toContain("border-destructive");
    }
    expect(traceLine).toContain('<X className="w-3 h-3 shrink-0 text-status-error" aria-hidden />');
    expect(changeDiff).toContain('"bg-status-error/5');
    expect(changeDiff).toContain('"bg-status-success/5');
  });

  it("the small brand inks ride the text-safe token (R126-L5) — the rail + AA links", () => {
    // 11–12px brand text on card rides text-primary-text, never raw
    // text-primary (3.76:1 on dark — under the 4.5:1 floor).
    expect(sidebar).toContain("bg-primary/10 hover:bg-primary/20 text-primary-text");
    expect(previewC).toContain("text-primary-text hover:underline");
    expect(askAnswer).toContain('<span className="text-primary-text">{tu.name}</span>');
    const sugg = read("src/components/admin/copilot/SuggestionRow.tsx");
    expect(sugg).toContain("group-hover:text-primary-text");
  });
});
