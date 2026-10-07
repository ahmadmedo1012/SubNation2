import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHELL_CATEGORY_META } from "../app";
/**
 * R120-B3 (A7-F3) — backend/frontend category-meta PARITY.
 *
 * app.ts cannot import frontend/src/lib/categories.ts at build time
 * (backend tsconfig rootDir: "src" — TS6059), so the shell-rewrite layer
 * keeps its own copy of the 7 metaTitle/metaDescription pairs. A drifted
 * copy would silently rewrite the STATIC shell with different copy than
 * the hydrated page advertises (title swap on paint — the exact
 * soft-SEO-truth class this round is closing). This suite pins both
 * copies together WITHOUT a cross-tree import (which would break
 * `pnpm typecheck`): the frontend module is import-free data, so it is
 * read as TEXT and its string literals are extracted with the same
 * join semantics TS applies to adjacent `"…" + "…"` concatenation.
 */

const FRONTEND_CATEGORIES = path.resolve(
  import.meta.dirname,
  "../../../frontend/src/lib/categories.ts",
);

/** `"a" +\n "b"` (any line layout after the colon) → "ab". */
function extractProp(block: string, prop: string): string | null {
  const re = new RegExp(`${prop}:\\s*((?:"[^"\\\\]*"\\s*\\+?\\s*)+),`);
  const m = re.exec(block);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"\\]*)"/g)].map((x) => x[1]).join("");
}

/** slug → source block (top-level entries of CATEGORY_META, 2-space indent). */
function frontendCategoryBlocks(): Map<string, string> {
  const src = readFileSync(FRONTEND_CATEGORIES, "utf8");
  const map = new Map<string, string>();
  const entryRe = /^ {2}("?)([a-z-]+)\1: \{$/gm;
  const starts: Array<{ slug: string; index: number }> = [];
  for (const m of src.matchAll(entryRe)) {
    starts.push({ slug: m[2], index: m.index! + m[0].length });
  }
  const end = src.indexOf("\n};", starts.at(-1)?.index ?? 0);
  for (let i = 0; i < starts.length; i++) {
    const blockEnd = i + 1 < starts.length ? starts[i + 1].index - 1 : end;
    map.set(starts[i].slug, src.slice(starts[i].index, blockEnd));
  }
  return map;
}

describe("SHELL_CATEGORY_META parity with frontend CATEGORY_META (A7-F3)", () => {
  it("both sides list the SAME seven live categories (no drift in either direction)", () => {
    const frontend = frontendCategoryBlocks();
    expect([...frontend.keys()].sort()).toEqual([...Object.keys(SHELL_CATEGORY_META)].sort());
    // The seven live categories (matches the sitemap's category set).
    expect(Object.keys(SHELL_CATEGORY_META).sort()).toEqual([
      "ai-tools",
      "education",
      "music",
      "seo-tools",
      "software",
      "streaming",
      "vpn",
    ]);
  });

  it.each(Object.keys(SHELL_CATEGORY_META))(
    "%s: backend shell metaTitle + metaDescription are VERBATIM the frontend copy",
    (slug) => {
      const block = frontendCategoryBlocks().get(slug);
      expect(block, `frontend block for ${slug} not found`).toBeDefined();
      expect(SHELL_CATEGORY_META[slug].metaTitle).toBe(extractProp(block!, "metaTitle"));
      expect(SHELL_CATEGORY_META[slug].metaDescription).toBe(
        extractProp(block!, "metaDescription"),
      );
    },
  );
});
