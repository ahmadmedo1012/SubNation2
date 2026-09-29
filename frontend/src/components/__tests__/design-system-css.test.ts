/**
 * 94-C3 — index.css design-system regressions (A3 P1-1 / P2-5 / P2-6 / P3-5).
 *
 * The trigger for this file: the round-94 inspection reported the global
 * cursor:pointer rule as broken (`aref],` where `a[href],` was intended).
 * Byte-level verification showed the selector was in fact intact — the
 * report was a tooling artifact (a display layer that eats the "[h"
 * substring renders "a[href]," as "aref],"). Regardless of the cause,
 * this suite pins the rule in full so any future real corruption of
 * ANY selector in the block fails loudly instead of silently dropping
 * the cursor affordance for every interactive element in the app.
 *
 * Also pins:
 *   • .pb-safe — exactly ONE definition, WITH env() fallback (P2-6)
 *   • --badge-outline — stays deleted (P3-5 dead token)
 *   • --color-brand-whatsapp(-ink) — WhatsApp tokens exist (P2-5)
 *   • .touch-target — the 44px floor the P1-3 fixes rely on
 *
 * R115-I3 additions (A6 P1 / A6 #3 / A6 #4):
 *   • toast status variants must consume var(--status-*) — the P1
 *     double-source-of-truth that leaked dark values into light mode
 *   • weight vocabulary = loaded weights (400/600/700): font-black and
 *     font-medium are banned across src (they CSS-fallback to 700/400,
 *     so the "intended" hierarchy never renders)
 *   • micro-type tokens --text-2xs/--text-3xs exist and their arbitrary
 *     predecessors (text-[8..11px]) are banned from source
 *   • the global :focus-visible rule must not set border-radius (it
 *     used to reshape every focused element to 5px)
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve from the runner cwd (always frontend/) — same pattern as
// status-tokens.test.tsx.
const cssText = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** Every non-test .tsx under src/ (tests are excluded because negative
 * guards there legitimately reference the RAW pre-token literals, e.g.
 * `not.toContain("text-[9px]")`). */
function collectSourceTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...collectSourceTsx(p));
    } else if (entry.name.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}
const sourceTsxFiles = collectSourceTsx(resolve(process.cwd(), "src"));

/** The complete global cursor:pointer rule, selector list included.
 * CSS Selectors L3 §5.2: ONE invalid selector in a list drops the whole
 * rule — that's why the entire block (not just the a[href] line) is
 * pinned character-for-character. */
const CURSOR_RULE_RE =
  /button:not\(:disabled\),\s*a\[href\],\s*label\[for\],\s*summary,\s*\[role="button"\]:not\(\[aria-disabled="true"\]\),\s*\[role="tab"\],\s*\[role="menuitem"\]\s*\{\s*cursor: pointer;\s*\}/;

describe("index.css — global cursor:pointer rule (A3 P1-1)", () => {
  it("contains the full selector list with the a[href] member", () => {
    expect(cssText).toMatch(CURSOR_RULE_RE);
  });

  it("contains no corrupted selector fragment (the reported `aref]`)", () => {
    // A stray unbalanced bracket in ANY selector list silently voids
    // that rule — scan the whole sheet, not just the cursor block.
    expect(cssText).not.toMatch(/aref\]/);
  });

  it("every rule body in the sheet closes its braces (crude structural sanity)", () => {
    const opens = (cssText.match(/\{/g) ?? []).length;
    const closes = (cssText.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });
});

describe("index.css — pb-safe single definition with fallback (A3 P2-6)", () => {
  it("declares .pb-safe exactly once", () => {
    expect((cssText.match(/\.pb-safe\s*\{/g) ?? []).length).toBe(1);
  });

  it("declares .pt-safe exactly once", () => {
    expect((cssText.match(/\.pt-safe\s*\{/g) ?? []).length).toBe(1);
  });

  it("the surviving definition carries an env() fallback", () => {
    expect(cssText).toMatch(
      /\.pb-safe\s*\{\s*padding-bottom:\s*env\(safe-area-inset-bottom,\s*20px\);/,
    );
  });
});

describe("index.css — token hygiene (A3 P2-5 / P3-5)", () => {
  it("the dead --badge-outline token stays deleted in both themes", () => {
    expect(cssText).not.toContain("--badge-outline");
  });

  it("WhatsApp brand tokens exist (surface + AA ink)", () => {
    expect(cssText).toContain("--color-brand-whatsapp: #25d366");
    expect(cssText).toContain("--color-brand-whatsapp-ink: #054339");
  });

  it("the .touch-target 44px floor exists for the P1-3 hit-box fixes", () => {
    expect(cssText).toMatch(/\.touch-target\s*\{\s*min-height: 44px;\s*min-width: 44px;/);
  });
});

describe("index.css — toast status accents ride the --status-* tokens (R115-A6 P1)", () => {
  it("every status toast variant consumes its theme-aware token", () => {
    expect(cssText).toMatch(/--toast-accent:\s*var\(--status-success\)/);
    expect(cssText).toMatch(/--toast-accent:\s*var\(--status-error\)/);
    expect(cssText).toMatch(/--toast-accent:\s*var\(--status-warning\)/);
    expect(cssText).toMatch(/--toast-accent:\s*var\(--status-info\)/);
  });

  it("no --toast-accent carries a raw HSL literal (the dark-value light-mode leak)", () => {
    // Byte-for-byte copies of :root values (e.g. `152 65% 50%`) were the
    // P1: they ignored the .light AA-darkened status tokens, so light-mode
    // toast strips/icons measured ~2.8-3.1:1 on white.
    expect(cssText).not.toMatch(/--toast-accent:\s*\d/);
  });
});

describe("weight vocabulary = loaded weights (R115-A6 #3)", () => {
  it("no font-black / font-medium in any source .tsx (400/600/700 only)", () => {
    // 900 and 500 are not loaded (@fontsource 400/600/700) — the CSS
    // matching algorithm falls back 900→700 and 500→400, so those
    // utilities never produced the hierarchy they implied.
    const offenders: string[] = [];
    for (const f of sourceTsxFiles) {
      const text = readFileSync(f, "utf8");
      if (/\bfont-black\b/.test(text)) offenders.push(`font-black: ${f}`);
      if (/\bfont-medium\b/.test(text)) offenders.push(`font-medium: ${f}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("micro-type tokens (R115-A6 #4)", () => {
  it("--text-2xs (11px) and --text-3xs (10px) exist in the theme", () => {
    expect(cssText).toMatch(/--text-2xs:\s*11px/);
    expect(cssText).toMatch(/--text-3xs:\s*10px/);
  });

  it("no text-[8..11px] arbitraries in source .tsx (10px floor, tokenized)", () => {
    const offenders: string[] = [];
    for (const f of sourceTsxFiles) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/text-\[(?:8|9|10|11)px\]/g)) {
        offenders.push(`${m[0]}: ${f}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("global focus system (R115-A6 #5)", () => {
  it(":focus-visible draws the outline and sets nothing else", () => {
    // The rule used to force border-radius: 5px on every focused
    // element — reshaping pills and cards the moment they got focus.
    expect(cssText).toMatch(
      /:focus-visible\s*\{\s*outline: 2px solid hsl\(var\(--ring\)\);\s*outline-offset: 2px;\s*\}/,
    );
  });
});
