/**
 * R139 (agent 139-h, precision) — the comms+promo visual pins.
 *
 * The r138 designer-lens family (storefront) extended onto the three
 * COMMS/PROMO admin surfaces this round: tickets.tsx + components/
 * admin/tickets/*, alerts.tsx + components/admin/alerts/*, coupons.tsx
 * + components/admin/coupons/*. These are SOURCE-scan pins (the
 * r128-sweep / r137-contract idiom — invariants a render test only
 * covers incidentally) over the family idioms that landed:
 *
 *   1. calm active pill — bg-primary/15 + text-primary-text +
 *      border-primary/30 + font-bold, BOTH states carrying the border
 *      box (the status trays keep their secondary/40 segment shell;
 *      the tray-less chip bars ride the muted/30 box);
 *   2. calm queue/row register — /60 resting edges, hover = border
 *      step or muted/30 wash (never elevation), selected = the
 *      primary/40 edge + primary/8 tint;
 *   3. calm-error banners — a bg-card + border-border/60 frame with
 *      the error tone concentrated in the icon stage (error/8 fill +
 *      /22 edge + full-ink glyph), severity in CONTENT, never a red
 *      wall;
 *   4. receipt rhythm on the money pane — /20 hairline at the
 *      terminal boundary, tabular-nums, weight+size emphasis, the
 *      discount keeping its documented success ink;
 *   5. icon-stage empties — the bg-muted/60 tile + /35 edge + /35
 *      ghost glyph register, /85 title ink.
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

const ticketsPage = read("src/pages/admin/tickets.tsx");
const statusTabs = read("src/components/admin/tickets/StatusFilterTabs.tsx");
const categoryChips = read("src/components/admin/tickets/CategoryFilterChips.tsx");
const ticketCard = read("src/components/admin/tickets/TicketCard.tsx");
const detailPane = read("src/components/admin/tickets/TicketDetailPane.tsx");
const staleBanner = read("src/components/admin/tickets/StaleQueueBanner.tsx");
const ticketsEmpty = read("src/components/admin/tickets/TicketsEmptyStates.tsx");

const alertsPage = read("src/pages/admin/alerts.tsx");
const alertsTabs = read("src/components/admin/alerts/AlertsFilterTabs.tsx");
const alertsChips = read("src/components/admin/alerts/AlertsTypeChips.tsx");
const alertsList = read("src/components/admin/alerts/AlertsGroupedList.tsx");
const alertsEmpty = read("src/components/admin/alerts/AlertsEmptyState.tsx");
const alertsMeta = read("src/components/admin/alerts/alerts-meta.tsx");

const couponsPage = read("src/pages/admin/coupons.tsx");
const couponsHeader = read("src/components/admin/coupons/CouponsHeader.tsx");
const couponsDialog = read("src/components/admin/coupons/CreateCouponDialog.tsx");
const couponsTable = read("src/components/admin/coupons/CouponsTable.tsx");

describe("R139 (139-h) — tickets: the calm pill dialect on both filter bars", () => {
  it("the status tabs ride the family active pill inside the family segment tray", () => {
    // R139: the tray wash aligns to the secondary/40 family value; the
    // active chip was a card-colored tile with a soft shadow, the
    // inactive chip was borderless — both states now carry the border
    // box (no 1px toggle jitter). aria-pressed byte-identical.
    expect(statusTabs).toContain(
      '"flex gap-1 bg-secondary/40 border border-border/60 rounded-2xl p-1"',
    );
    expect(statusTabs).toContain(
      '"bg-primary/15 text-primary-text border border-primary/30 font-bold"',
    );
    expect(statusTabs).toContain(
      '"border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"',
    );
    expect(statusTabs).toContain("aria-pressed={statusFilter === s.value}");
    expect(statusTabs).not.toContain("bg-card shadow-sm");
    expect(statusTabs).not.toContain("bg-secondary/50");
  });

  it("the category chips ride the tray-less pill values (muted/30 box, /70 hover step)", () => {
    // R139: active rises /10→/15 tint; the resting chip had a
    // full-strength edge + secondary hover wash.
    expect(categoryChips).toContain(
      '"bg-primary/15 border-primary/30 text-primary-text font-bold"',
    );
    expect(categoryChips).toContain(
      '"bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"',
    );
    expect(categoryChips).toContain("aria-pressed={categoryFilter === c.value}");
    expect(categoryChips).not.toContain('"border-border text-muted-foreground');
    expect(categoryChips).not.toContain("hover:bg-secondary/60");
  });
});

describe("R139 (139-h) — tickets: the queue register + the detail pane", () => {
  it("the queue row: /60 resting edge, calm border-step hover, primary/40 + /8 selected tint, no elevation", () => {
    // R139: the selected state was a /4 wash + a brand-tinted micro
    // shadow; the hover carried a shadow-md. The staggered float-in +
    // the open-status pulse dot stay (sanctioned motion).
    expect(ticketCard).toContain('"border-primary/40 bg-primary/8"');
    expect(ticketCard).toContain('"border-border/60 hover:border-border"');
    expect(ticketCard).toContain("float-in stagger-${Math.min(idx + 1, 8)}");
    expect(ticketCard).toContain("animate-pulse");
    expect(ticketCard).not.toContain("hover:shadow-md");
    expect(ticketCard).not.toContain("shadow-primary");
  });

  it("the detail pane: /60 shell + quiet band, coherent thread pair, /20 terminal reply seam", () => {
    // R139: the shell + band seams rode full-strength borders and a
    // one-off /15 band wash; the customer bubble edge was a /50
    // between-value; the reply seam was full-strength. The thread
    // pair itself is the verified brand-voice/paper treatment.
    expect(detailPane).toContain('className="lg:col-span-3 bg-card border border-border/60');
    expect(detailPane).toContain(
      '"flex items-start justify-between px-5 py-4 border-b border-border/60 bg-muted/30"',
    );
    expect(detailPane).toContain(
      // R157: text-white → text-primary-foreground (the ink token —
      // equal today, drift-proof if the token ever retunes).
      '"bg-primary text-primary-foreground rounded-tl-sm" : "bg-muted/60 border border-border/40 rounded-tr-sm"',
    );
    expect(detailPane).toContain('className="border-t border-border/20 p-4"');
    expect(detailPane).toContain("bg-muted/30 border border-border/40 rounded-lg px-3 py-2 mb-3");
    // The reply form rides the shared Input/Button (mission verify) —
    // the canonical imports stay.
    expect(detailPane).toContain('from "@/components/ui/button"');
    expect(detailPane).toContain('from "@/components/ui/input"');
    // The close/re-open actions keep their quiet --status-* token
    // tints (verified, not migrated to anything louder).
    expect(detailPane).toContain(
      "bg-status-success/10 text-status-success border border-status-success/20",
    );
    expect(detailPane).toContain("bg-status-info/10 text-status-info border border-status-info/20");
    expect(detailPane).not.toContain("bg-muted/15");
    expect(detailPane).not.toContain("border-border/50");
  });

  it("the stale-queue banner rides the calm-error register (no red wall)", () => {
    // R139: the frame was a status-error-tinted wall; the error tone
    // now concentrates in the icon stage, severity stays in content.
    expect(staleBanner).toContain(
      '"p-3 rounded-2xl bg-card border border-border/60 flex items-center gap-3"',
    );
    expect(staleBanner).toContain(
      '"w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0"',
    );
    expect(staleBanner).toContain('"min-w-0 text-sm font-bold text-foreground/80"');
    expect(staleBanner).toContain(
      '"ms-auto shrink-0 text-xs font-bold text-status-error underline underline-offset-2 hover:opacity-80"',
    );
    expect(staleBanner).toContain('role="alert"');
    expect(staleBanner).not.toContain("bg-status-error/10");
    expect(staleBanner).not.toContain("border-status-error/25");
  });

  it("both empty branches rhyme with the shared admin EmptyState icon stage", () => {
    // R139: bare low-ghost glyphs → the bg-muted/60 tile + /35 edge +
    // /35 glyph; titles take the /85 register ink; the hard-empty
    // action gets the register breathing room.
    expect(ticketsEmpty.match(/bg-muted\/60 border border-border\/35/g)).toHaveLength(2);
    expect(ticketsEmpty.match(/opacity-35/g)).toHaveLength(2);
    expect(ticketsEmpty.match(/text-foreground\/85/g)).toHaveLength(2);
    expect(ticketsEmpty).toContain('"text-xs text-primary-text hover:underline mt-5"');
    expect(ticketsEmpty).not.toContain("opacity-20");
    expect(ticketsEmpty).not.toContain("opacity-25");
  });

  it("the page's resting placeholder + header counters speak the family", () => {
    // R139: the no-selection column was the page's full-strength-edge
    // outlier; its glyph joins the icon-stage register. The header
    // counters were ALREADY the token-tint pill family (verified).
    expect(ticketsPage).toContain(
      '"hidden lg:flex lg:col-span-3 bg-card border border-border/60 rounded-2xl items-center justify-center"',
    );
    expect(ticketsPage).toContain(
      '"w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 mx-auto mb-3 flex items-center justify-center"',
    );
    expect(ticketsPage).toContain(
      '"bg-status-info/15 text-status-info border border-status-info/30 text-xs font-bold px-2.5 py-1 rounded-full"',
    );
    expect(ticketsPage).toContain(
      '"bg-status-warning/15 text-status-warning border border-status-warning/30 text-xs font-bold px-2.5 py-1 rounded-full"',
    );
    expect(ticketsPage).not.toContain("opacity-15");
  });
});

describe("R139 (139-h) — alerts: chips, the inbox register, the calm-error poll banner", () => {
  it("the filter tabs ride the family active pill inside the family segment tray", () => {
    // R139: the tray was a muted/30 + /40 trough; the active tab was
    // a card-colored tile with a soft shadow.
    expect(alertsTabs).toContain(
      '"flex items-center gap-1 bg-secondary/40 border border-border/60 p-1 rounded-2xl overflow-x-auto scrollbar-none w-fit max-w-full"',
    );
    expect(alertsTabs).toContain(
      '"bg-primary/15 text-primary-text border border-primary/30 font-bold"',
    );
    expect(alertsTabs).toContain(
      '"border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"',
    );
    expect(alertsTabs).toContain("aria-pressed={filter === tab.value}");
    expect(alertsTabs).not.toContain("bg-card text-foreground shadow-sm");
  });

  it("the type chips keep the TYPE_META token-tint severity tuple; the resting chip joins the pill family", () => {
    // R139: the ACTIVE tuple (severity token tint + full ink) is
    // verified unchanged; the resting chip was a muted/20 wash + /40
    // edge with a text-only hover.
    expect(alertsChips).toContain("font-bold ${m.bg} ${m.border} ${m.color}");
    expect(alertsChips).toContain(
      '"bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"',
    );
    expect(alertsChips).toContain("aria-pressed={filter === s.key}");
    // The severity tuples themselves stay on the --status-* tokens.
    expect(alertsMeta).toContain('color: "text-status-error"');
    expect(alertsMeta).toContain('color: "text-status-warning"');
    expect(alertsMeta).toContain('color: "text-status-info"');
    expect(alertsMeta).toContain('bg: "bg-status-warning/10"');
  });

  it("the grouped rows: read rows keep the pinned B-15 surface, unread rows calm (no elevation)", () => {
    // R139: the unread row's resting shadow + hover elevation retire
    // (the hover is the border step alone); the read row's quieter
    // surface is the pinned read/unread distinction (alerts-delete-
    // confirm asserts bg-card/40 on read, not on unread).
    expect(alertsList).toContain('"bg-card/40 border-border/40 cursor-default"');
    expect(alertsList).toContain('"bg-card border-border/60 cursor-pointer hover:border-border"');
    expect(alertsList).not.toContain("hover:shadow-md");
    expect(alertsList).not.toContain("shadow-sm");
    // The group header rule joins the /20 hairline family.
    expect(alertsList).toContain('className="flex-1 h-px bg-border/20"');
  });

  it("the empty state: muted-well tile + /85 title ink (the larger glyph stays — documented exception)", () => {
    expect(alertsEmpty).toContain(
      '"w-16 h-16 rounded-2xl bg-muted/60 border border-border/35 flex items-center justify-center"',
    );
    expect(alertsEmpty).toContain('"font-semibold text-foreground/85"');
    expect(alertsEmpty).not.toContain("bg-muted/40");
    expect(alertsEmpty).not.toContain("text-foreground/60");
  });

  it("the poll-failure banner rides the calm-error register (no red wall)", () => {
    expect(alertsPage).toContain(
      '"p-4 rounded-2xl bg-card border border-border/60 flex items-center gap-3"',
    );
    expect(alertsPage).toContain(
      '"w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0"',
    );
    expect(alertsPage).toContain('"min-w-0 text-sm font-bold text-foreground/80"');
    expect(alertsPage).not.toContain("bg-status-error/10");
    expect(alertsPage).not.toContain("border-status-error/25");
  });
});

describe("R139 (139-h) — coupons: pills, quiet stat tints, the receipt money pane", () => {
  it("the create dialog's type toggle drops its solid fill for the calm pill", () => {
    // R139: the active chip was a SOLID primary fill with white ink
    // (the pre-r138 idiom); the money-path VariantSelector decision
    // pins the tinted dialect for value-affecting selectors.
    expect(couponsDialog).toContain(
      '"bg-primary/15 text-primary-text border-primary/30 font-bold"',
    );
    expect(couponsDialog).toContain(
      '"bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70 hover:bg-muted/60"',
    );
    expect(couponsDialog).toContain("aria-pressed={form.type === t}");
    expect(couponsDialog).not.toContain("bg-primary text-white");
    // The UTC honesty hint is pinned by the decomposition contract —
    // untouched here (r137 closure).
    expect(couponsDialog).toContain("يُحوَّل تلقائياً إلى التوقيت العالمي (UTC) عند الحفظ");
  });

  it("the header CTA carries no colored shadow; the stat strip reads quiet (semantic ink only)", () => {
    // R139: the CTA's primary-tinted md shadow is gone (brand-tinted
    // shadows read as glow on .light); the usage count drops its
    // brand ink for plain foreground (usage is not a status) while
    // the active count KEEPS success ink (a literal status reading).
    expect(couponsHeader).not.toContain("shadow-primary");
    expect(couponsHeader).toContain(
      '"gap-1.5 text-sm bg-primary hover:bg-primary/90 press-spring"',
    );
    expect(couponsHeader).toContain(
      '"text-2xl font-bold text-foreground tabular-nums">{totalUsed}',
    );
    expect(couponsHeader).toContain(
      '"text-2xl font-bold text-status-success tabular-nums">{activeCount}',
    );
    expect(couponsHeader).not.toContain("text-2xl font-bold text-primary");
  });

  it("the money table: quiet header band, /60 seams, calm hover, receipt terminal footer", () => {
    // R139: font-bold → font-semibold header row (700 stays on row
    // data), the seams + hover join the grid-wide values, the footer
    // takes the /20 receipt hairline + tabular-nums.
    expect(couponsTable).toContain(
      "border-b border-border/60 bg-muted/30 text-xs font-semibold text-muted-foreground",
    );
    expect(couponsTable).toContain("divide-y divide-border/60");
    expect(couponsTable).toContain("hover:bg-muted/30");
    expect(couponsTable).toContain(
      "px-4 py-2 border-t border-border/20 bg-muted/10 text-xs text-muted-foreground tabular-nums",
    );
    expect(couponsTable).not.toContain("divide-border/30");
    expect(couponsTable).not.toContain("hover:bg-muted/20");
    expect(couponsTable).not.toContain("border-t border-border/40");
  });

  it("the discount value reads positive (documented success ink) with tabular-nums; expired dates speak the state's warning tone", () => {
    // R139: the discount cell rode raw brand ink (under the AA text
    // floor on dark); the discount-reads-positive exception is the
    // documented register (CartSummaryAside line, orders discount
    // chip). The expired date's destructive red split one state
    // across two severities — the «منتهي» badge is warning, so the
    // date joins that tone on the --status-warning token.
    expect(couponsTable).toContain(
      '"flex items-center gap-1 font-bold text-status-success text-sm tabular-nums"',
    );
    expect(couponsTable).toContain('className={isExpired ? "text-status-warning" : ""}');
    expect(couponsTable).not.toContain("font-bold text-primary text-sm");
    // Scoped to the expiry ternary — the archive action's quiet
    // destructive HOVER ink is the sanctioned at-rest danger idiom.
    expect(couponsTable).not.toContain('? "text-destructive"');
  });

  it("the load-failure banner rides the calm-error register; the empty-state exit link is AA-safe ink", () => {
    expect(couponsPage).toContain(
      '"mb-4 p-4 rounded-2xl bg-card border border-border/60 flex items-center gap-3"',
    );
    expect(couponsPage).toContain(
      '"w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0"',
    );
    expect(couponsPage).not.toContain("bg-status-error/10");
    expect(couponsPage).not.toContain("border-status-error/25");
    // R139: the exit link rode raw brand ink + a hand-rolled press
    // spring; the tickets empty branches' quiet link register is the
    // family value.
    expect(couponsPage).toContain('"text-xs text-primary-text hover:underline"');
    expect(couponsPage).not.toContain('"text-xs text-primary hover:underline');
  });
});
