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
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve from the runner cwd (always frontend/) — same pattern as
// status-tokens.test.tsx.
const cssText = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

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
    expect(cssText).toMatch(/\.pb-safe\s*\{\s*padding-bottom:\s*env\(safe-area-inset-bottom,\s*20px\);/);
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
