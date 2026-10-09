import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHELL_HOME_META, SHELL_STATIC_ROUTE_META } from "../app";
/**
 * R127-L9 (B12-F1 + B12-F2) — home + static-route shell meta PARITY.
 *
 * The spa-shell-category-parity.test.ts pattern (R120-B3 A7-F3),
 * extended to the two routes whose shell copy had drifted from the
 * runtime page (B12's live no-JS-vs-rendered measurement):
 *
 *   B12-F1: the home shell passed through with the generic build-time
 *     baseline («SubNation — سوق الاشتراكات الرقمية») while the
 *     hydrated page rendered the keyword-forward Arabic copy — a split
 *     title+description signal for every non-rendering engine.
 *   B12-F2: SHELL_STATIC_ROUTE_META["/flash-sales"] kept the pre-R124
 *     53-char description after A10-F3 lengthened the rendered one —
 *     the fix had shipped frontend-only.
 *
 * app.ts cannot import the frontend pages at build time (backend
 * tsconfig rootDir: "src" — TS6059), so each page's useSeo block is
 * read as TEXT and its title/description string literals extracted.
 * The LAST literal of a prop expression is the canonical-URL copy:
 * terms.tsx's ternary renders the #privacy variant on its THEN branch,
 * and the shell correctly pins the /terms copy from the ELSE branch
 * (the fragment is a client-only state, not a separate indexable URL).
 *
 * /support and /terms had NOT drifted (B12 measured them equal) — they
 * are pinned here anyway so this whole static family is drift-proof,
 * the same way categories are.
 */

const PAGES_DIR = path.resolve(import.meta.dirname, "../../../frontend/src/pages");

/** The page's useSeo({...}) block, brace-matched (jsonLd arrays nest safely). */
function useSeoBlock(page: string): string {
  const src = readFileSync(path.join(PAGES_DIR, page), "utf8");
  const start = src.indexOf("useSeo({");
  if (start === -1) throw new Error(`no useSeo block found in ${page}`);
  const openBrace = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`unbalanced useSeo block in ${page}`);
  return src.slice(openBrace + 1, end);
}

/**
 * The LAST string literal of a top-level useSeo prop. A prop statement
 * runs from its `prop:` line to the first line with a trailing comma
 * (every value in these blocks is a string/ternary — arrays only appear
 * in jsonLd, which is never extracted); line comments inside the
 * statement are stripped before matching (the home/flash blocks carry
 * multi-line rationale comments between props).
 */
function useSeoCopy(page: string, prop: "title" | "description"): string {
  const lines = useSeoBlock(page).split("\n");
  const propRe = new RegExp(`^\\s*${prop}:`);
  const start = lines.findIndex((line) => propRe.test(line));
  if (start === -1) throw new Error(`no ${prop} prop in ${page}'s useSeo block`);
  const chunk: string[] = [];
  for (let i = start; i < lines.length; i++) {
    chunk.push(lines[i]);
    if (/,\s*$/.test(lines[i])) break;
  }
  const expr = chunk.join("\n").replace(/\/\/[^\n]*/g, "");
  const literals = [...expr.matchAll(/"([^"\\]*)"/g)].map((m) => m[1] as string);
  const value = literals.at(-1);
  if (!value) throw new Error(`no string literal for ${prop} in ${page}`);
  return value;
}

// ── B12-F1: the home shell vs home.tsx ───────────────────────────────────────

describe("SHELL_HOME_META parity with home.tsx useSeo (B12-F1)", () => {
  it("home shell title + description are VERBATIM the runtime copy (the shell no longer rides the generic baseline)", () => {
    expect(SHELL_HOME_META.title).toBe(useSeoCopy("home.tsx", "title"));
    expect(SHELL_HOME_META.description).toBe(useSeoCopy("home.tsx", "description"));
  });

  it("the pinned home copy is the keyword-forward Arabic one (extraction-sanity guard)", () => {
    // The money query leads — NOT the brand-first baseline the shell
    // used to ship (that exact regression is what B12-F1 closed).
    expect(SHELL_HOME_META.title).toBe("سوق الاشتراكات الرقمية في ليبيا | SubNation");
    expect(SHELL_HOME_META.description).toContain("متجر إلكتروني متخصّص");
    // home.tsx's own budget comment: ~145 chars / 160 cap.
    expect(SHELL_HOME_META.description.length).toBeGreaterThan(120);
    expect(SHELL_HOME_META.description.length).toBeLessThanOrEqual(160);
  });
});

// ── B12-F2 + drift guard: the static routes vs their pages ──────────────────

describe("SHELL_STATIC_ROUTE_META parity with the pages' useSeo blocks (B12-F2)", () => {
  it.each([
    ["/flash-sales", "flash-sales.tsx"],
    ["/support", "support.tsx"],
    ["/terms", "terms.tsx"],
  ])("%s shell title + description are VERBATIM the runtime copy", (route, page) => {
    const meta = SHELL_STATIC_ROUTE_META[route];
    expect(meta, `no SHELL_STATIC_ROUTE_META entry for ${route}`).toBeDefined();
    expect(meta.title).toBe(useSeoCopy(page, "title"));
    expect(meta.description).toBe(useSeoCopy(page, "description"));
  });

  it("the pinned /flash-sales description is the 140-char A10-F3 copy (extraction-sanity guard)", () => {
    // The shell shipped the pre-R124 53-char copy until B12-F2 — pin
    // the length + a differentiator so a truncated paste fails loudly.
    expect(SHELL_STATIC_ROUTE_META["/flash-sales"].description.length).toBe(140);
    expect(SHELL_STATIC_ROUTE_META["/flash-sales"].description).toContain(
      "تسليم فوري بعد الدفع في كامل ليبيا",
    );
  });
});
