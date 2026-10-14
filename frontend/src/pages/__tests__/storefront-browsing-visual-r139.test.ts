/**
 * R139 (precision) — storefront BROWSING long tail, visual source pins.
 *
 * Wave-3 storefront agent 139-k: the r138 designer-lens family idioms
 * extended to the two browsing pages r138 never reached — the category
 * landings + /flash-sales. This is the source-scan pin suite (the
 * r128-sweep / 139-c craft): comments are stripped first because the
 * R139 rationale blocks NAME the retired classes — only live markup is
 * the contract. Whitespace is normalized after stripping so the
 * multi-line template-literal class strings (FlashCard's shell) pin as
 * reliably as single-line ones.
 *
 * Pins (each mirrors a shipped decision):
 *   • category h1 rides the storefront page-title scale text-fluid-3xl
 *     (the PDP r138-f precedent — the landing's anchor out-anchors its
 *     h2s/card titles), NOT the old fluid-2xl.
 *   • category hero = ONE atmosphere moment (ambient-wash ×1 +
 *     hairline-glow) on the home hero-card family's own resting edge
 *     (border/40 + shadow-lg — a matched pair with GuestHero/AuthedHero,
 *     pinned so a future /60 sweep can't split it off its twins).
 *   • sibling-chip arms: /30 + hover /55 on all seven cat accents (the
 *     static-badge value + the hero brand-chip hover step), zero /25.
 *   • the neutral escape chip rides the calm-pill inactive arm
 *     (CatalogFiltersBar byte-twin).
 *   • category card frames rest at /60 (empty state + FAQ), zero /55.
 *   • FlashCard shell/well/badge/countdown/price rhyme with ProductCard
 *     byte-for-byte: /60 + the two-layer calm elevation + the 60→100
 *     border hover step, bg-muted/60 shelf, the primary discount chip at
 *     the ONE primary-chip elevation value, solid bg-card countdown chip
 *     with dir="ltr" + tabular-nums, colorless price (weight+size).
 *   • flash urgency stays loud-but-compliant: the hero glow rides the
 *     EmptyHero family values (/6 + blur-xl, no colored shadow), the h1
 *     joins the page-title scale.
 *   • the empty state CONSUMES EmptyHero (the R136 canonized family —
 *     flash-sales was the lone fork of the four), keeping the canonical
 *     CTA; the loading skeleton is shaped like the card (aspect-square).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Strip block comments (JSX `{/* *\/}` included) + full-line `//`
 *  comments — the R139 fix notes quote the retired classes, and only
 *  live markup is the contract (the storefront-r125-sweep stripper). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Comment-stripped + whitespace-normalized source — multi-line class
 *  template literals pin like single-line strings. */
function live(src: string): string {
  return stripComments(src).replace(/\s+/g, " ");
}

const category = live(read("src/pages/category.tsx"));
const flash = live(read("src/pages/flash-sales.tsx"));

/** Verbatim (unstripped) sources, for pins that read comments as
 *  documentation (the atmosphere-count pin reads live markup only). */
const categoryRaw = read("src/pages/category.tsx");
const flashRaw = read("src/pages/flash-sales.tsx");

describe("R139 — category landing: the page-title anchor + hero-card family", () => {
  it("the h1 rides text-fluid-3xl (the PDP/home page-title scale), not fluid-2xl", () => {
    expect(category).toContain('<h1 className="text-fluid-3xl font-bold text-foreground">');
    expect(category).not.toContain("text-fluid-2xl");
  });

  it("the hero carries exactly ONE atmosphere moment (ambient-wash ×1 + hairline-glow)", () => {
    expect(stripComments(categoryRaw).match(/ambient-wash/g) ?? []).toHaveLength(1);
    expect(category).toContain(
      '<div className="absolute inset-0 ambient-wash pointer-events-none" />',
    );
    expect(category).toContain('<div className="hairline-glow" />');
  });

  it("the hero keeps the home hero-card family's own resting edge (border/40 + shadow-lg — the GuestHero/AuthedHero matched pair)", () => {
    expect(category).toContain(
      '"relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-6 shadow-lg float-in"',
    );
  });

  it("the seven sibling-chip arms ride /30 + hover /55 (static-badge value + hero-chip hover step) — zero /25", () => {
    expect(category.match(/\/30 hover:border-cat-/g) ?? []).toHaveLength(7);
    expect(category).not.toMatch(/\/25 hover:border-cat-/);
    // The AA-audited trio stays: /10 fill + /15 hover fill + text-cat-* ink.
    expect(category.match(/bg-cat-[a-z-]+\/10 hover:bg-cat-[a-z-]+\/15/g) ?? []).toHaveLength(7);
  });

  it("the neutral escape chip rides the calm-pill inactive arm (the CatalogFiltersBar byte-twin)", () => {
    expect(category).toContain(
      "min-h-11 border bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60",
    );
    expect(category).not.toContain("hover:bg-secondary/40");
  });

  it("card frames rest at /60 (empty state + FAQ accordion) — zero /55 left in live markup", () => {
    expect(category).toContain(
      '"bg-card border border-border/60 rounded-2xl py-12 px-4 text-center float-in"',
    );
    expect(category).toContain(
      '"group bg-card border border-border/60 rounded-2xl overflow-hidden [&_summary::-webkit-details-marker]:hidden [&_summary]:list-none float-in"',
    );
    expect(category).not.toMatch(/border-border\/55\b/);
  });

  it("the chip geometry keeps the storefront 44px tap floor (min-h-11 on every chip surface)", () => {
    // Three live surfaces: the sibling-chip Link, the neutral escape
    // button, and the error branch's FetchErrorCard retry override.
    expect(category.match(/min-h-11/g) ?? []).toHaveLength(3);
  });
});

describe("R139 — flash-sales: urgency loud-but-compliant + the ProductCard rhyme", () => {
  it("the FlashCard shell rhymes with ProductCard byte-for-byte (/60 + two-layer calm elevation + the 60→100 hover step)", () => {
    expect(flash).toContain("bg-card border border-border/60 rounded-2xl overflow-hidden");
    expect(flash).toContain("shadow-calm");
    expect(flash).toContain(
      "card-spring hover:border-border hover:shadow-xl hover:shadow-black/25",
    );
    expect(flash).not.toContain("hover:border-border/80");
  });

  it("the image well is the bg-muted/60 shelf (never a bare bg-card plane)", () => {
    expect(flash).toContain('"relative aspect-square bg-muted/60 overflow-hidden"');
    expect(flash).not.toContain("aspect-square bg-card");
  });

  it("the discount chip is the ProductCard badge twin — solid primary at the ONE primary-chip elevation value", () => {
    expect(flash).toContain(
      "bg-primary text-primary-foreground text-3xs font-bold px-1.5 py-0.5 rounded-full shadow-md shadow-primary/30",
    );
    expect(flash).not.toContain("shadow-lg shadow-status-error");
    expect(flash).not.toContain("text-destructive-foreground");
    // The 93-C8 U+2212 minus rendering survives the convergence.
    expect(flashRaw).toContain('<Tag className="w-2 h-2" />');
    expect(flashRaw).toContain("−{discount}%");
  });

  it('the countdown chip is solid (glass retired) with tabular-nums + dir="ltr" isolation on the label', () => {
    expect(flash).toContain(
      "bg-card border border-border/60 text-foreground text-2xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 tabular-nums",
    );
    expect(flash).toContain('<span dir="ltr">{timeLabel}</span>');
    expect(flash).not.toMatch(/backdrop-blur/);
    expect(flash).not.toContain("bg-background/90");
  });

  it("the price is colorless money (weight + size + tabular-nums — the r138 register)", () => {
    expect(flash).toContain('"font-bold text-foreground text-lg leading-none tabular-nums"');
    expect(flash).not.toContain("text-lg text-primary-text");
  });

  it("the hero glow rides the EmptyHero family values and carries no colored shadow — urgency stays on the token-tinted stage", () => {
    expect(flash).toContain("rounded-2xl bg-status-error/6 blur-xl");
    expect(flash).not.toContain("blur-2xl");
    expect(flash).not.toContain("shadow-lg shadow-status-error/20");
    expect(flash).toContain(
      '"relative w-16 h-16 rounded-2xl bg-status-error/15 border border-status-error/30 flex items-center justify-center"',
    );
  });

  it("the h1 joins the storefront page-title scale (text-fluid-3xl, no static text-3xl outlier)", () => {
    expect(flash).toContain('<h1 className="text-fluid-3xl font-bold mb-2">');
    expect(flash).not.toMatch(/text-3xl(?!s)/);
  });

  it("the empty state CONSUMES EmptyHero (the R136 canonized first-run family) with the canonical CTA in the action slot", () => {
    expect(flash).toContain('import { EmptyHero } from "@/components/EmptyState";');
    expect(flash).toContain("<EmptyHero");
    // R145 (D6 recompose): the two copy pins were updated with the
    // mission-pre-approved honest lines — the OLD strings encoded the
    // pre-R145 visuals the live VLM audit graded as "reads as a system
    // error, not an honest business state" (a feed-empty «لا عرض نشط
    // حالياً» with no temporal frame; a description whose «تابعنا»
    // pointed at an affordance the page doesn't own and «تعود قريباً»
    // promised a timeline nothing backs). Family pins (EmptyHero import,
    // className="px-4", the canonical CTA recipe) are untouched.
    expect(flash).toContain('title="لا توجد عروض فلاش نشطة حالياً"');
    expect(flash).toContain('description="العروض الجديدة تظهر هنا فور بدئها"');
    // R145 (D6): the empty icon is the page's OWN glyph (Flame — the
    // header stage's language, the "fire rests between sales" read), not
    // the generic no-results Sparkles the audit flagged.
    expect(flash).toContain("icon={Flame}");
    expect(flash).toContain('className="px-4"');
    expect(flash).toContain('<Button asChild size="lg" className="w-full sm:w-auto">');
    // The retired hand-rolled frame is gone.
    expect(flash).not.toContain("border border-border/50 rounded-2xl reveal-up");
  });

  it("the loading skeleton is shaped like the FlashCard (aspect-square well on the /60 frame)", () => {
    expect(flash).toContain('"aspect-square bg-muted/60 skeleton-shimmer"');
    expect(flash).not.toContain("aspect-[4/3]");
  });

  it("the sale-ended notice rests at /60 (warning ink stays — a literal expiry reading)", () => {
    expect(flash).toContain(
      "bg-muted/30 border border-border/60 rounded-xl text-sm font-bold text-muted-foreground reveal-up",
    );
    expect(flash).not.toMatch(/border-border\/50\b/);
  });

  it("no atmosphere wash on flash (the header is a bare centered band — not a full-bleed hero card)", () => {
    expect(stripComments(flashRaw)).not.toContain("ambient-wash");
  });
});
