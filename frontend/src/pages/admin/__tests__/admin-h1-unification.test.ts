/**
 * R128 (A3 §1 matrix / IMP2) — one h1 size for the admin console's
 * sibling pages.
 *
 * The A3 census found THREE h1 sizes across the 21 surfaces (text-lg ×4,
 * text-xl ×11, text-2xl ×4) inside one shell whose top bar renders the
 * same title again — plus whatsapp.tsx shipping NO h1 at all (an h2 at
 * text-2xl + tracking-tight, visually LARGER than every sibling's h1 and
 * with the letter-spacing that severs Arabic letter connections).
 *
 * The R128-IMP2 pass normalized every page h1 to `text-xl font-bold`
 * (the dominant size 11 pages already used) and promoted whatsapp's h2
 * to a real h1. This pin keeps it that way — a fourth size can't creep
 * back in one page at a time.
 *
 * layout.tsx's top-bar h1 (`font-bold text-sm`) is the DOCUMENTED
 * exception (the known-open doubled-title — A3 §9), not a page h1.
 */

import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(process.cwd(), "src/pages/admin");
const pageFiles = readdirSync(dir).filter(
  (f) => f.endsWith(".tsx") && f !== "layout.tsx", // the shell, not a page
);

describe("admin page h1s — one size family (R128 A3 §1)", () => {
  it("every page h1 renders at text-xl font-bold (the 11-page dominant size)", () => {
    expect(pageFiles.length).toBeGreaterThan(15); // the scan sees the tree
    const offenders: string[] = [];
    for (const f of pageFiles) {
      const text = readFileSync(resolve(dir, f), "utf8");
      for (const m of text.matchAll(/<h1([^>]*)>/g)) {
        const attrs = m[1]!;
        if (!attrs.includes('className="')) continue; // multi-line h1 — checked below
        if (!/className="[^"]*\btext-xl\b[^"]*"/.test(attrs) || !/font-bold/.test(attrs)) {
          offenders.push(`${f}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("whatsapp carries a real h1 (the A3-F6 hierarchy inversion stays fixed)", () => {
    const text = readFileSync(resolve(dir, "whatsapp.tsx"), "utf8");
    expect(text).toMatch(/<h1[^>]*text-xl font-bold[^>]*>إدارة جلسة واتساب<\/h1>/);
    // tracking-tight severs Arabic letter connections (the layout's own
    // group-label rationale, layout.tsx:1179-1186).
    expect(text).not.toContain("tracking-tight");
  });
});
