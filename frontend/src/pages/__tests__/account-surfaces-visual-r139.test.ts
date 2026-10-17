/**
 * R139 (precision) — the ACCOUNT-SURFACES visual chrome pin suite
 * (wave 3, agent 139-l: wallet / loyalty / referrals / orders /
 * order-detail / status + TopupWaitingModal).
 *
 * Source-scan pins in the r128-sweep / 139-c/f/g idiom: the r138 family
 * idioms this lane shipped are now enforced contracts, so a future round
 * cannot silently regress the money-adjacent pages. The RENDER contracts
 * (idempotency keys, money gates, statement rows, convert journey,
 * refund receipts, aria) stay with their own suites; this file guards
 * the CHROME:
 *
 *   1. the wallet balance hero — the page's ONE atmosphere moment
 *      (ambient-wash + hairline-glow inside a solid /60 card on the
 *      two-layer calm elevation) + the R115-A10 blob-pause machinery
 *      still wired (logic untouched);
 *   2. THE STATEMENT rhythm — a statement IS a receipt (§4): /20
 *      hairline rows, weight+size emphasis, colorless amounts;
 *   3. the money-path selectors — the tinted trio, NO solid fills,
 *      NO shadows (the money-path-chrome scope extended to the topup
 *      form);
 *   4. canonical CTAs — Button recipes, zero hand-rolled stacks;
 *   5. the calm filter-pill dialect on the orders status chips;
 *   6. the order-detail receipt terminal + de-hand-rolled CTAs;
 *   7. refunds stay info-blue (§4) — verified present, untouched.
 *
 * stripComments(): rationale comments NAME the retired strings, so raw
 * absence checks would false-fail on the retirement's own documentation
 * (the 139-c craft). LINE-COMMENTS-FIRST ordering; the scanned files
 * carry no `/*`-bearing string literals (verified; the one `https://`
 * string on /status sits below every pinned region).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Line-comments-first stripper (the 139-i lesson: block-first opens
 *  phantom comments on `/*`-bearing paths; none of these files carry
 *  such strings, but the ordering is pinned anyway). */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

const BALANCE = stripComments(read("src/components/wallet/BalanceCard.tsx"));
const STATEMENT_CARD = stripComments(read("src/components/wallet/WalletStatementCard.tsx"));
const LEDGER_ROW = stripComments(read("src/components/wallet/LedgerEntryRow.tsx"));
const METHOD_TABS = stripComments(read("src/components/wallet/MethodTabs.tsx"));
const MOBILE_FORM = stripComments(read("src/components/wallet/MobileTransferForm.tsx"));
const LYPAY = stripComments(read("src/components/wallet/LyPayFlow.tsx"));
const CODE_PANEL = stripComments(read("src/components/wallet/TransferCodePanel.tsx"));
const WAITING = stripComments(read("src/components/TopupWaitingModal.tsx"));
const LOYALTY_REFBOX = stripComments(read("src/components/loyalty/ReferralBox.tsx"));
const LOYALTY_CONVERT = stripComments(read("src/components/loyalty/ConvertPointsCard.tsx"));
const LOYALTY_HISTORY = stripComments(read("src/components/loyalty/LedgerHistoryCard.tsx"));
const REFERRALS = stripComments(read("src/pages/referrals.tsx"));
const ORDERS = stripComments(read("src/pages/orders.tsx"));
const ORDER_DETAIL = stripComments(read("src/pages/order-detail.tsx"));

describe("R139-l — wallet: the balance hero is the page's ONE atmosphere moment", () => {
  it("rides the solid /60 card + the two-layer calm elevation + the ambient-wash/hairline-glow pair", () => {
    // R143 (L2-1): the calm elevation tokenized — shadow-calm
    // (index.css, theme-aware: dark byte-identical to the r138 literal,
    // .light re-tuned inside DESIGN.md's 6–14% ceiling); the arbitrary
    // literal must not come back.
    expect(BALANCE).toContain(
      'className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 sm:p-5 shadow-calm"',
    );
    expect(BALANCE).not.toContain("0_10px_28px");
    expect(BALANCE).toContain(
      '<div className="absolute inset-0 ambient-wash pointer-events-none" />',
    );
    expect(BALANCE).toContain('<div className="hairline-glow" />');
  });

  it("the pre-r138 surface is retired (brand gradient fill, brand border, brand glow shadow)", () => {
    expect(BALANCE).not.toContain("bg-gradient-to-br");
    expect(BALANCE).not.toContain("border-primary/22");
    expect(BALANCE).not.toContain("shadow-xl");
    expect(BALANCE).not.toContain("shadow-primary/8");
  });

  it("the R115-A10 blob-pause machinery survives the chrome pass (ref + style + blob-drift intact)", () => {
    // glowRef on the root + glowStyle on the drifting layer — the
    // viewport-pause observer wiring is logic, never restyleable away.
    expect(BALANCE).toContain("ref={glowRef}");
    expect(BALANCE).toContain("style={glowStyle}");
    expect(BALANCE).toContain("blob-drift");
    expect(BALANCE).toContain("bg-primary/14");
  });

  it("the loading frame mirrors the loaded /60 edge (loading→loaded parity)", () => {
    expect(BALANCE).toContain("border border-border/60");
    expect(BALANCE).not.toContain("border-border/45");
  });
});

describe("R139-l — THE STATEMENT rides the receipt rhythm (§4: a statement IS a receipt)", () => {
  it("/20 hairline rows replace the boxed chip register — and read-only rows carry no hover", () => {
    expect(STATEMENT_CARD).toContain("divide-y divide-border/20");
    expect(STATEMENT_CARD).not.toContain("bg-muted/18");
    expect(LEDGER_ROW).not.toContain("rounded-xl");
    expect(LEDGER_ROW).not.toContain("hover:bg-muted");
    expect(LEDGER_ROW).not.toContain("border border-border/30");
  });

  it("emphasis by weight+size, never hue — the amount is colorless and steps UP", () => {
    expect(LEDGER_ROW).toContain("text-sm font-bold tabular-nums");
    expect(LEDGER_ROW).not.toContain("text-status-success");
    // The identifier sits one weight step down (the CartSummary ladder).
    expect(LEDGER_ROW).toContain("text-xs font-semibold mb-0.5");
  });

  it("the statement card stays FLAT — the balance hero owns the page's one elevation", () => {
    expect(STATEMENT_CARD).not.toContain("shadow-");
  });

  it("the points-history twin speaks the same receipt dialect", () => {
    expect(LOYALTY_HISTORY).toContain("divide-y divide-border/20");
    expect(LOYALTY_HISTORY).not.toContain("hover:bg-muted/35");
    expect(LOYALTY_HISTORY).not.toMatch(/text-status-warning"\s*\n\s*\}/);
    // The lyd_credited gains span KEEPS its success ink (the documented
    // gains/discount-reads-positive exception) + tabular-nums.
    expect(LOYALTY_HISTORY).toContain("text-3xs text-status-success font-bold tabular-nums");
  });
});

describe("R139-l — the topup money-path selectors (no solid fills, no shadows)", () => {
  it("the preset chips ride the tinted trio on both flows", () => {
    for (const src of [MOBILE_FORM, LYPAY]) {
      expect(src).toContain('"border-primary/30 bg-primary/15 text-primary-text"');
      expect(src).not.toContain("bg-primary text-white");
      expect(src).not.toContain("shadow-md");
      expect(src).toContain("aria-pressed={amount === String(p)}");
    }
  });

  it("the method tabs drop the raised-toggle register (border-2 + shadow-sm)", () => {
    expect(METHOD_TABS).not.toContain("border-2");
    expect(METHOD_TABS).not.toContain("shadow-sm");
    expect(METHOD_TABS).toContain('"border-primary/30 bg-primary/15 text-foreground"');
    expect(METHOD_TABS).toContain("aria-pressed={method === m.id}");
  });

  it("the amount/reference inputs ride the shared Input family (no competing focus/border overrides)", () => {
    for (const src of [
      MOBILE_FORM,
      LYPAY,
      stripComments(read("src/components/wallet/PaymentReferenceField.tsx")),
    ]) {
      expect(src).not.toContain("border-border/50");
      expect(src).not.toContain("focus:border-primary/45");
    }
  });

  it("the transfer-code panel rests on the /60 edge + muted wash; the USSD code box is the well; the dial CTA stack is retired", () => {
    expect(CODE_PANEL).toContain("border border-border/60 bg-muted/15");
    expect(CODE_PANEL).toContain("bg-muted/60 border border-border/40");
    expect(CODE_PANEL).not.toContain("border-primary/25");
    expect(CODE_PANEL).not.toContain("hover:bg-primary/90");
    expect(CODE_PANEL).not.toContain("text-white");
  });
});

describe("R139-l — TopupWaitingModal: calm waiting register, canonical CTAs", () => {
  it("every state CTA rides the shared Button — the hand-rolled stacks are gone", () => {
    // R140 central re-anchor: prettier collapses the attribute list onto one
    // line when it fits the print width — the pin was written against the
    // pre-format multi-line draft. Same canonical Button, same onContinue
    // handler; the single-line form is the committed source's shape.
    expect(WAITING).toContain(
      '<Button type="button" onClick={onContinue} className="w-full min-h-11 font-bold">',
    );
    expect(WAITING).not.toContain("hover:bg-primary/90");
    expect(WAITING).not.toContain("shadow-md");
    expect(WAITING).not.toContain("text-white");
    // The pinned 44px floor rides every full-width action.
    expect((WAITING.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("the progress vocabulary is byte-identical (the sanctioned stroke-6 arcs + countdown live region)", () => {
    expect(WAITING).toContain('strokeWidth="6"');
    expect(WAITING).toContain("strokeDasharray={2 * Math.PI * 44}");
    expect(WAITING).toContain("text-primary-text transition-[stroke-dashoffset]");
    expect(WAITING).toContain('aria-live="polite"');
  });

  it("§8: the topup pending vocabulary stays «قيد المراجعة» with token-tinted states", () => {
    expect(WAITING).toContain("قيد المراجعة من الإدارة");
    expect(WAITING).toContain("bg-status-success/15 border border-status-success/35");
    expect(WAITING).toContain("bg-status-error/15 border border-status-error/35");
    // The support path keeps the asChild composition (one anchor).
    expect(WAITING).toContain("asChild");
  });
});

describe("R139-l — loyalty: solid referral card, canonical convert CTA, receipt history", () => {
  it("the referral card drops its gradient shell for the family card + well boxes", () => {
    expect(LOYALTY_REFBOX).not.toContain("bg-gradient-to-br");
    // (the card-shell gradient is gone; the calm-tint CTA's own
    // border-primary/20 is the sanctioned tint idiom, not the shell)
    expect(LOYALTY_REFBOX).not.toContain("via-card");
    expect(LOYALTY_REFBOX).toContain("bg-card border border-border/60");
    expect(LOYALTY_REFBOX).toContain("bg-muted/60 border border-border/40");
  });

  it("the convert CTA is de-hand-rolled onto Button (the R116-S1 ban)", () => {
    expect(LOYALTY_CONVERT).not.toContain("hover:bg-primary/90");
    expect(LOYALTY_CONVERT).not.toContain("active:scale-95");
    expect(LOYALTY_CONVERT).toContain('className="shrink-0 h-11 px-5 font-bold"');
  });
});

describe("R139-l — referrals: colorless stats, canonical share CTA, list register", () => {
  it("the stat values are plain ink (identity lives in the icon stages — the 139-j twin)", () => {
    expect(REFERRALS).toContain(
      '<div className="text-2xl font-bold tabular-nums text-foreground">{s.value}</div>',
    );
    expect(REFERRALS).not.toContain("tabular-nums ${s.color}");
  });

  it("the page-primary share CTA rides the canonical Button size=lg (no retired stack, no text-white)", () => {
    expect(REFERRALS).toContain('size="lg" className="w-full font-bold"');
    expect(REFERRALS).not.toContain("text-white");
    expect(REFERRALS).not.toContain("shadow-md");
    expect(REFERRALS).not.toContain("hover:bg-primary/90");
  });

  it("the code card is solid; the history rows are /20 hairlines under a /60 section seam", () => {
    expect(REFERRALS).not.toContain("from-primary/12");
    expect(REFERRALS).toContain("divide-y divide-border/20");
    expect(REFERRALS).toContain("border-b border-border/60");
  });

  it("reward numbers ride tabular-nums + weight (API values, never hardcoded)", () => {
    expect((REFERRALS.match(/tabular-nums/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(REFERRALS).toContain("{overview.points_rate.points_per_referral} نقطة");
  });
});

describe("R139-l — orders: the calm filter-pill dialect + the family card hover", () => {
  it("the status chips: active = tinted trio (no shadows, no inverted fill), idle = the family muted box", () => {
    expect(ORDERS).toContain('"bg-primary/15 text-primary-text border-primary/30"');
    expect(ORDERS).not.toContain("bg-foreground text-background");
    expect(ORDERS).not.toContain("shadow-sm shadow-status-");
    expect(ORDERS).not.toContain("border-status-info/45");
    expect(
      ORDERS.match(/bg-muted\/30 border-border\/30 text-muted-foreground/g) ?? [],
    ).toHaveLength(5);
    // aria-pressed survives the dialect migration.
    expect(ORDERS).toContain("aria-pressed={active}");
  });

  it("the order card rides the unified card-spring hover (no hand-rolled lift/transition-all)", () => {
    // R157-C: the hover shadow rides the bare themed ladder — the
    // raw-black/25 color override retired (.light rendered ~2× the
    // 6–14% ceiling; the ladder's own xl step sits inside it).
    expect(ORDERS).toContain("card-spring hover:border-border hover:shadow-xl");
    expect(ORDERS).not.toContain("shadow-black");
    expect(ORDERS).not.toContain("hover:-translate-y-0.5");
    expect(ORDERS).not.toContain("active:scale-[0.995]");
    // The refunded accent edge stays token-info (§4 — pinned with
    // order-refund-receipt; guarded here so a hover rework can't eat it).
    expect(ORDERS).toContain('"border-r-status-info/55"');
  });

  it("the page header tile + count chip rest flat (no shadow-inner/shadow-sm)", () => {
    expect(ORDERS).not.toContain("shadow-inner");
    expect(ORDERS).not.toContain("rounded-full shadow-sm");
  });
});

describe("R139-l — order-detail: the receipt terminal + de-hand-rolled CTAs", () => {
  it("the header card rides the two-layer calm elevation on the /60 edge", () => {
    expect(ORDER_DETAIL).toContain("border-border/60 rounded-2xl overflow-hidden shadow-calm");
    expect(ORDER_DETAIL).not.toContain("shadow-lg shadow-black/10");
  });

  it("the amount is the colorless receipt terminal (weight+size, not color)", () => {
    const amountIdx = ORDER_DETAIL.indexOf("formatCurrency(order.amount ?? 0)");
    const window = ORDER_DETAIL.slice(Math.max(0, amountIdx - 300), amountIdx);
    expect(window).toContain("font-bold text-xl tabular-nums text-foreground");
    expect(window).not.toContain("text-primary-text");
  });

  it("every support/actions CTA is de-hand-rolled + the 44px floor (no retired stacks)", () => {
    expect(ORDER_DETAIL).not.toContain("hover:bg-primary/90");
    expect(ORDER_DETAIL).not.toContain("shadow-md");
    expect((ORDER_DETAIL.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(ORDER_DETAIL).toContain('size="lg"');
    expect(ORDER_DETAIL).not.toContain("shadow-primary/22");
  });

  it("the credential rows + coupon seam ride the /20 receipt hairlines", () => {
    expect(ORDER_DETAIL).toContain("divide-y divide-border/20");
    expect(ORDER_DETAIL).toContain("border-t border-border/20");
    expect(ORDER_DETAIL).not.toContain("divide-border/15");
    expect(ORDER_DETAIL).not.toContain("border-t border-border/15");
  });

  it("§4: refunds stay info-blue — the refund branch is untouched by the polish", () => {
    expect(ORDER_DETAIL).toContain('"border-status-info/22"');
    expect(ORDER_DETAIL).toContain('"bg-status-info/8 border-status-info/22"');
    expect(ORDER_DETAIL).toContain("استُرد ${formatCurrency(order.amount ?? 0)}");
    expect(ORDER_DETAIL).toContain("كما خُصمت نقاط الشراء المستردة");
  });
});
