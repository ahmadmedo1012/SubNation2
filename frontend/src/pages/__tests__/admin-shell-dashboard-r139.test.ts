/**
 * R139 (precision) — the admin shell + dashboard designer-lens pins.
 *
 * Agent 139-d's surfaces (the shell every operator sees all day, the
 * dashboard landing, the operator login, and the three shared admin
 * primitives six domain agents consume) adopted the r138 family idioms
 * this round. These are SOURCE-scan pins (the admin-palette-tokens /
 * not-found-r138 idiom — structural invariants a render test only
 * covers incidentally); the RENDER contracts (focus trap, aria, the
 * chart race) stay pinned by their own suites and are untouched.
 *
 * Pinned decisions, one block per surface:
 *   1. NavItem — the calm active pill (bg-primary/15 + text-primary-text
 *      + border-primary/30, BOTH states carrying the border box so the
 *      active↔inactive toggle cannot jitter; aria-current byte-identical).
 *   2. layout topbar — solid bg-card (glass retired) + border-border/60
 *      resting edge + .hairline-glow top edge; the drawer/scrim modal
 *      family (bg-black/70, border-border/60, shadow-sm).
 *   3. dashboard — the ONE ambient-wash moment (above-the-fold zone
 *      wrapper), the KPI two-layer calm elevation (+ the skeleton tiles
 *      mirroring it), and the charts column staying FLAT.
 *   4. ChartErrorBanner — the calm-error register (border-border/60
 *      frame, severity in the icon stage + content, not a red wall).
 *   5. EmptyState (shared) — the r138-h proportions (muted/60 well tile,
 *      /85 title ink, mt-5 action breathing room).
 *   6. login — the r138-g card lift (ambient-wash + hairline-glow) and
 *      the canonical CTA (Button size="lg", no hand-rolled recipe).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("R139 — NavItem: the calm active pill (one selected-state vocabulary)", () => {
  const navItem = read("src/components/admin/layout/NavItem.tsx");

  it("the active item rides the r138 trio at the pinned /30 edge alpha", () => {
    expect(navItem).toContain('"bg-primary/15 text-primary-text font-bold border-primary/30"');
  });

  it("BOTH states carry the border box — the inactive branch adds border-transparent (no toggle jitter)", () => {
    expect(navItem).toContain(
      '"border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/60"',
    );
  });

  it("the R125 aria-current contract is untouched (visual-layer-only round)", () => {
    expect(navItem).toContain('aria-current={active ? "page" : undefined}');
  });
});

describe("R139 — admin shell chrome (topbar / sidebar / drawer)", () => {
  const layout = read("src/pages/admin/layout.tsx");

  it("the topbar is solid bg-card on the border/60 resting edge with the hairline-glow top edge", () => {
    expect(layout).toContain(
      'className="sticky top-0 z-30 border-b border-border/60 bg-card pt-[env(safe-area-inset-top)]"',
    );
    expect(layout).toContain('<div className="hairline-glow" />');
    // NOTE: the retired glass values (bg-card/93 + backdrop-blur-md) are
    // documented verbatim in the R139 WHY-comment above the pinned line,
    // so a `not.toContain` would trip on the comment's own text — the
    // positive className pin above is the guard (the old string had
    // bg-card/93 backdrop-blur-md IN the className; this one cannot).
  });

  it("the sidebar rail + header/footer dividers rest at border/60 (one chrome weight)", () => {
    expect(layout).toContain("border-l border-border/60 transition-all duration-200");
    expect(layout).toContain("p-3 border-b border-border/60 flex items-center");
    expect(layout).toContain('className="p-2.5 border-t border-border/60 space-y-0.5"');
  });

  it("the mobile drawer rides the modal family (scrim /70, panel border/60 + shadow-sm)", () => {
    expect(layout).toContain(
      'className="md:hidden fixed inset-0 bg-black/70 z-40 backdrop-blur-sm"',
    );
    expect(layout).toContain(
      "bg-card border-l border-border/60 z-50 shadow-sm animate-in slide-in-from-right-4",
    );
    // The R125 focus-trap contract stays wired (byte-identical logic).
    expect(layout).toContain("trapTabKey(drawerRef.current, e)");
  });

  it("the palette pins the palette-tokens suite reads keep their home in the page", () => {
    expect(layout).toContain(
      "bg-status-warning/15 text-status-warning border border-status-warning/30",
    );
    expect(layout).toContain('className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse');
  });
});

describe("R139 — dashboard: one atmosphere moment + one elevated register", () => {
  const page = read("src/pages/admin/dashboard.tsx");
  const tile = read("src/components/admin/dashboard/MetricCard.tsx");
  const revenue = read("src/components/admin/dashboard/RevenueOrdersChart.tsx");

  it("the above-the-fold zone carries the session's ONE ambient-wash (absolute layer, out of flow)", () => {
    expect(page).toContain('<div className="absolute inset-0 ambient-wash pointer-events-none" />');
    expect(page).toContain('className="relative space-y-6"');
  });

  it("the KPI tiles ride the two-layer calm elevation with the neutral hover ladder", () => {
    // R143 (L2-1): the calm elevation tokenized — shadow-calm (index.css,
    // theme-aware: dark byte-identical to the r138 literal, .light inside
    // DESIGN.md's 6–14% ceiling); the literal must not come back.
    // R157-C: the hover shadow rides the bare themed ladder (the
    // raw-black color override retired — .light rendered 25% black,
    // ~2× the 6–14% ceiling; the ladder's own xl sits inside it).
    expect(tile).toContain("shadow-calm hover:shadow-xl");
    expect(tile).not.toContain("shadow-black");
    expect(tile).not.toContain("0_10px_28px");
    // The R128 colored hover-shadow tints are retired — the token BORDER
    // carries the state signal.
    expect(tile).not.toContain("hover:shadow-status-");
    expect(tile).not.toContain("hover:shadow-primary/10");
  });

  it("the loading skeleton mirrors the loaded tile's resting chrome (no frame swap)", () => {
    expect(page).toContain(
      'className="bg-card border border-border/60 rounded-2xl h-28 shadow-calm"',
    );
  });

  it("the charts column stays quieter — flat border/60 cards, no elevation", () => {
    expect(revenue).toContain('className="bg-card border border-border/60 rounded-2xl p-5"');
    expect(revenue).not.toContain("shadow-[");
  });

  it("the chart pickers' selected chips ride the calm-active family (no raised segment)", () => {
    const pickers = read("src/components/admin/dashboard/ChartPickers.tsx");
    expect(pickers).toContain('"bg-primary/15 text-primary-text border-primary/30 font-bold"');
    expect(pickers).not.toContain("bg-card shadow-sm text-foreground");
  });
});

describe("R139 — the honest states rhyme with the storefront register", () => {
  it("ChartErrorBanner: calm border/60 frame + the error tone in the icon stage, not a red wall", () => {
    const banner = read("src/components/admin/dashboard/ChartErrorBanner.tsx");
    expect(banner).toContain(
      'className="xl:col-span-3 p-4 rounded-2xl bg-card border border-border/60 flex items-center gap-3"',
    );
    expect(banner).toContain("bg-status-error/8 border border-status-error/22");
    expect(banner).toContain("text-sm font-bold text-foreground/80");
    expect(banner).not.toContain("bg-status-error/10 border border-status-error/25");
  });

  it("ChartsEmptyState: the icon-stage vocabulary (muted/60 well tile + contained glyph)", () => {
    const empty = read("src/components/admin/dashboard/ChartsEmptyState.tsx");
    expect(empty).toContain(
      'className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 mx-auto mb-3 flex items-center justify-center"',
    );
    expect(empty).toContain('<BarChart2 className="w-5 h-5 opacity-35" />');
  });

  it("RecentOrdersStream: the sticky mini-header is solid bg-card (glass retired)", () => {
    const stream = read("src/components/admin/dashboard/RecentOrdersStream.tsx");
    expect(stream).toContain(
      'className="sticky top-0 z-10 px-4 py-3.5 border-b border-border/60 flex items-center justify-between bg-card"',
    );
    // The retired glass pair is quoted in the R139 comment above the
    // pinned line — the positive className pin is the guard.
  });

  it("UrgentTopupsBanner keeps the quiet-danger-at-rest register (verified, unchanged classes)", () => {
    const banner = read("src/components/admin/dashboard/UrgentTopupsBanner.tsx");
    expect(banner).toContain("bg-status-warning/8 border border-status-warning/20");
  });
});

describe("R139 — the shared admin primitives (six domain agents consume these)", () => {
  it("EmptyState aligns with the storefront r138-h proportions", () => {
    const empty = read("src/components/admin/EmptyState.tsx");
    expect(empty).toContain(
      'className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/35 mx-auto mb-3 flex items-center justify-center"',
    );
    expect(empty).toContain('<Icon className="w-5 h-5 opacity-35" />');
    expect(empty).toContain('className="font-bold text-sm text-foreground/85 mb-1"');
    expect(empty).toContain("mt-1 leading-relaxed max-w-xs mx-auto");
    expect(empty).toContain('{action && <div className="mt-5">{action}</div>}');
  });

  it("TableSkeleton keeps the verified border/60 + bg-muted rhythm (frame matches the loaded tables)", () => {
    const skeleton = read("src/components/admin/TableSkeleton.tsx");
    expect(skeleton).toContain(
      'className="bg-card border border-border/60 rounded-2xl overflow-hidden"',
    );
    expect(skeleton).toContain('className="border-b border-border/60 bg-muted/30 h-11"');
    expect(skeleton).toContain("border-b border-border/30");
  });

  it("AdminScopeGate keeps the quiet-warning honest-reason register", () => {
    const gate = read("src/components/admin/AdminScopeGate.tsx");
    expect(gate).toContain(
      "text-sm text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-xl px-3 py-2",
    );
  });
});

describe("R139 — admin login: the r138-g mirror", () => {
  const login = read("src/pages/admin/login.tsx");

  it("the card carries the ambient-wash + hairline-glow lift inside an overflow-hidden frame", () => {
    expect(login).toContain(
      'className="relative overflow-hidden bg-card border border-border/60 rounded-2xl p-6 shadow-calm"',
    );
    expect(login).toContain(
      '<div className="absolute inset-0 ambient-wash pointer-events-none" />',
    );
    expect(login).toContain('<div className="hairline-glow" />');
  });

  it("the outer atmosphere is flat bg-background (the linear gradient wash retired)", () => {
    expect(login).toContain(
      'className="min-h-[100dvh] flex items-center justify-center px-4 bg-background"',
    );
    // The retired gradient is quoted in the R139 comment above the
    // pinned line — the positive className pin is the guard.
  });

  it("the submit CTA is the canonical Button recipe (size=lg + w-full, no hand-rolled fill/shadow/scale)", () => {
    expect(login).toContain('type="submit"');
    expect(login).toContain('size="lg"');
    expect(login).toContain('className="w-full font-bold"');
    // The retired hand-roll values are quoted in the R139 comment above
    // the CTA — the trio of positive pins above is the guard (the old
    // button carried them in its className; this one cannot).
  });
});
