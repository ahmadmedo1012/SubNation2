// @vitest-environment node
//
// NODE env on purpose (the shell-head-anchors.test.ts / preload-gate
// idiom): a pure filesystem scan over the frontend sources — no DOM,
// and node:fs walks are the whole suite.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R144-C1/C2 (L16-3, findings §"Proposed fix" item 3) — the raw-fetch
 * adoption gate.
 *
 * The R143 findings counted 43 raw `fetch()` sites vs 2 wrappers; every
 * new feature that needed "just one POST" reached for raw fetch because
 * nothing failed when it did. R144 consolidated the storefront
 * user-side family onto customFetch (20 sites: 17 threaded in C1 + 3
 * deferred ApiError-.data restructures in C2), and this suite pins the
 * floor: the ONLY raw `fetch(` occurrences left in non-test frontend
 * sources are the deliberate class-(b) allowlist below — one entry per
 * documented reason. A new site (fragmentation regrowing) or a removed
 * one (this list going stale) both fail the equality assertion, so the
 * allowlist can only change DELIBERATELY, in this file, with a reason.
 *
 * Robust to line drift: the assertion matches on file path + stripped
 * occurrence COUNT (comment-safe), never on line numbers.
 */

/** The storefront-r128-sweep idiom: strip block + line comments so a
 * documented `fetch(` inside prose cannot fake an occurrence (and vice
 * versa — a REAL call commented out must not count as live). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Recursively every non-test source file under a root. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry === "__tests__" || entry === "test") continue;
    if (entry.endsWith(".test.") || entry.endsWith(".spec.")) continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The deliberate allowlist (class (b) — findings L16-3's "5 deliberate
 * sites", generalized to the real census). value = the expected count
 * of live raw-fetch occurrences in that file.
 */
const RAW_FETCH_ALLOWLIST: Record<string, number> = {
  // App-shell teardown + hydration probes: logout fire-and-forget (the
  // toast must never block teardown), the 200-always /api/auth/probe +
  // /api/admin/probe pair App.tsx's guard owns, and the logout-all POST
  // whose success path hard-redirects (window.location) before a
  // wrapper's error surface could matter. R122/R118 audit markers in
  // the file document each.
  "src/lib/auth.tsx": 5,
  // Pre-React auth bootstrap against an explicit ${base} origin — the
  // token getter / 401 observers customFetch relies on are not wired
  // yet at this stage of boot (96-F3 / Round-3 notes).
  "src/lib/firebase-auth.ts": 2,
  // The healthz poll — the findings' named allowlist entry.
  "src/lib/healthz.ts": 1,
  // The web-vitals beacon (sendBeacon fallback) — allowlist entry.
  "src/lib/web-vitals.ts": 1,
  // /api/admin/session guard — AUTH_EXEMPT from the global 401 handler;
  // App.tsx owns this 401's UX (93-C6 / F-07).
  "src/app/routes.tsx": 1,
  // Pre-hydration head-start — deliberately parallel to React boot;
  // runs before any wrapper consumer exists (R143 deep-link round).
  "src/app/boot-head-start.ts": 1,
  // The admin wrapper itself (adminFetch builds ON raw fetch) — this
  // file IS the consolidation for the admin half (R122 A2-P2 + D-3).
  "src/lib/admin-session.ts": 1,
};

describe("no-uncovered-raw-fetch (R144-C1/C2 — L16-3 adoption gate)", () => {
  it("every non-test source's raw fetch( count matches the deliberate allowlist exactly", () => {
    const srcRoot = resolve(process.cwd(), "src");
    const files = sourceFiles(srcRoot);
    expect(files.length).toBeGreaterThan(100); // sanity: the walk sees the tree

    const actual: Record<string, number> = {};
    for (const file of files) {
      const rel = `src/${relative(srcRoot, file)}`;
      const stripped = stripComments(readFileSync(file, "utf8"));
      // Word-boundary `fetch(` — `refetch(`, `.refetch()` and identifier
      // mentions must not count; `await fetch(`/`return fetch(` must.
      const count = (stripped.match(/(?<![.\w])fetch\(/g) ?? []).length;
      if (count > 0) actual[rel] = count;
    }

    // Equality BOTH ways: a regrown site fails, a stale allowlist entry
    // fails (the list must be edited deliberately alongside the change).
    expect(actual).toEqual(RAW_FETCH_ALLOWLIST);
  });

  it("the allowlist documents every entry with a reason (self-pin)", () => {
    // The gate's own contract: no entry may ride along undocumented —
    // every allowlisted file carries the repo's R-round audit markers
    // in or above its fetch sites explaining WHY it stays raw.
    for (const [relPath] of Object.entries(RAW_FETCH_ALLOWLIST)) {
      const src = readFileSync(resolve(process.cwd(), relPath), "utf8");
      expect(src).toMatch(/R\d{2,3}/);
    }
  });
});
