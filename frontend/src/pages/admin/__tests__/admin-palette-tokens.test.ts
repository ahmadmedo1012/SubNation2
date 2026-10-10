/**
 * R128 (A1-F1 / IMP2) — the admin console rides design tokens, not the
 * raw Tailwind palette.
 *
 * The A1 audit censused 232 raw-palette line-hits across 23 admin files:
 * every `-400`-ink badge/chip/tile measured **1.47–2.51:1 on its own
 * tint in the LIGHT admin theme** (the toggle ships — layout.tsx) while
 * passing in dark, which is why the debt survived as "tracked". The
 * R128-IMP2 migration moved all of them to the theme-aware `--status-*`
 * / `--cat-*` / `--tier-*` / `--status-success-surface` families (dark
 * values sit within a hair of the old raw hues, so the default theme is
 * visually near-identical).
 *
 * This suite is the negative guard that keeps it that way (the
 * design-system-css.test.ts text-[8..11px] pattern, scoped to the admin
 * tree):
 *
 *   1. NEGATIVE — zero raw-palette utility classes in any non-test
 *      source under pages/admin/** + components/admin/**. Historical
 *      class names in COMMENTS are paraphrased, so the guard can stay
 *      absolute with no allowlist.
 *   2. POSITIVE pins — the flagship migrations are asserted present so
 *      a wholesale deletion of a token map can't pass silently.
 *
 * Justified exceptions that live OUTSIDE these dirs (not scanned, by
 * design): the D8 auth-provider brand hues in lib/admin/user-display.ts
 * and the D7 storefront wallet network chips (wallet.tsx — the
 * storefront lane's file).
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Every non-test source file under the admin tree (.tsx + .ts — the
 * admin dirs carry no .ts today, but the guard shouldn't depend on
 * that). __tests__ excluded: negative guards legitimately reference the
 * RAW literals they ban. */
function collectSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...collectSource(p));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const adminSourceFiles = [
  ...collectSource(resolve(process.cwd(), "src/pages/admin")),
  ...collectSource(resolve(process.cwd(), "src/components/admin")),
];

// The A1 §2.1 census pattern: any utility consuming a raw Tailwind
// color family. `^`-anchored-ish via the leading boundary so it also
// catches hover:/group-hover: variants; matches className strings AND
// template map values.
const RAW_PALETTE_RE =
  /(?:^|[\s"'`])(?:[a-z0-9-]+:)?(?:text|bg|border|ring|shadow|from|via|to|fill|stroke|divide|outline|decoration|accent|caret)-(?:emerald|orange|amber|red|green|blue|sky|rose|violet|purple|cyan|yellow|teal|slate|gray|zinc|neutral|stone|fuchsia|indigo|lime|pink)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/;

describe("admin palette discipline (R128 A1-F1) — zero raw-palette classes", () => {
  it("no non-test admin source file consumes the raw Tailwind palette", () => {
    // Sanity: the scan actually sees the tree (21 surfaces + shared
    // components) — a silently-empty glob would pass vacuously.
    expect(adminSourceFiles.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const f of adminSourceFiles) {
      const text = readFileSync(f, "utf8");
      for (const line of text.split("\n")) {
        const m = RAW_PALETTE_RE.exec(line);
        if (m) offenders.push(`${m[0]} → ${f.split("src/")[1]}:${line.length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan pattern itself is live (self-test on a synthetic offender)", () => {
    // If the regex ever rots into a no-op, the guard above would pass
    // vacuously — prove the pattern still fires on the shapes it bans.
    expect(RAW_PALETTE_RE.test('className="bg-emerald-500/10 text-emerald-400"')).toBe(true);
    expect(RAW_PALETTE_RE.test("warn: 'border-amber-500/30 bg-amber-500/5'")).toBe(true);
    expect(RAW_PALETTE_RE.test("cls: 'hover:bg-red-500/10'")).toBe(true);
    // …and does NOT fire on the token families (both directions).
    expect(RAW_PALETTE_RE.test('className="bg-status-success/10 text-status-success"')).toBe(false);
    expect(RAW_PALETTE_RE.test('"text-tier-silver bg-cat-vpn/10"')).toBe(false);
    expect(
      RAW_PALETTE_RE.test('"bg-status-success-surface hover:bg-status-success-surface/90"'),
    ).toBe(false);
  });
});

describe("admin palette discipline — flagship migration pins (R128 A1-F1)", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("topups approve buttons ride --status-success-surface (A1-F2, retired emerald-700)", () => {
    const topups = read("src/pages/admin/topups.tsx");
    expect(topups).toContain("bg-status-success-surface hover:bg-status-success-surface/90");
    // Class-shaped ban (the historical comment may name the retired
    // hand-roll; the CLASS must be gone — the negative guard above
    // already bans every bg-emerald-* shape).
    expect(topups).not.toContain("bg-emerald");
  });

  it("topups badges are StatusBadge variants (A1-D2)", () => {
    expect(read("src/pages/admin/topups.tsx")).toContain('<StatusBadge variant="purple" size="xs"');
  });

  it("products CATEGORY_INITIAL_COLOR rides the canonical --cat-* family (A1-D4)", () => {
    const products = read("src/pages/admin/products.tsx");
    expect(products).toContain('"bg-cat-streaming/10 text-cat-streaming"');
    expect(products).toContain('"bg-cat-gaming/10 text-cat-gaming"');
  });

  it("referrals medals ride the NEW --tier-* family (A1-D10/F3)", () => {
    const referrals = read("src/pages/admin/referrals.tsx");
    expect(referrals).toContain("text-tier-silver");
    expect(referrals).toContain("text-tier-bronze");
    expect(referrals).toContain("text-tier-gold");
  });

  it("the layout alert dots ride the AA warning ink-pair, not solid yellow (A1-D3)", () => {
    const layout = read("src/pages/admin/layout.tsx");
    expect(layout).toContain(
      "bg-status-warning/15 text-status-warning border border-status-warning/30",
    );
    expect(layout).toContain('className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse');
  });
});
