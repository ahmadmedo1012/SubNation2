import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R166 (F8) — the two noindex REGISTRIES are hand-synced with no pin.
 *
 * backend SHELL_NOINDEX_RES (spa-shell.ts — what the RAW shell stamps)
 * and frontend NOINDEX_ROUTES (route-shapes.ts — the SPA runtime
 * fallback) must cover the same path families. A future family added to
 * one but not the other passed every existing test (seo.test.ts pins
 * robots-vs-NOINDEX_ROUTES; spa-shell-rewrite.test.ts pins the shell
 * for today's fixed list) while the raw/SPA pair disagreed — the exact
 * split the R163 raw/SPA agreement design exists to prevent.
 *
 * backend/src cannot import frontend modules (tsconfig rootDir), so both
 * registries are parsed from SOURCE TEXT — the seo.test.ts:120-128
 * extraction idiom, hardened to line-based regex-literal extraction so
 * the `$`-anchored entries (login/register/forgot-password) are picked
 * up too (the matchAll idiom silently skips them).
 *
 * The parity compared here is at the PATH-FAMILY level (the root segment
 * each registry noindexes): the two registries anchor differently by
 * construction — the shell uses root-or-child `(\/|$)` / exact `$`
 * forms; the SPA uses bare prefixes (so e.g. `/^\/cart/` also matches
 * `/cartography`, a string no real route produces). Modulo note:
 * /admin + /status additionally carry the robots.txt Disallow walls
 * (seo.ts's documented requirements) — both registries still noindex
 * them, so they stay INSIDE the parity set.
 */

const SHELL_TS = readFileSync(path.resolve(import.meta.dirname, "../lib/spa-shell.ts"), "utf8");
const ROUTE_SHAPES_TS = readFileSync(
  path.resolve(import.meta.dirname, "../../../frontend/src/app/route-shapes.ts"),
  "utf8",
);

/** The registry's array body — from its declaration to the closing `];`. */
function registryBlock(src: string, decl: string): string {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(`${decl} not found in source`);
  const end = src.indexOf("];", start);
  if (end === -1) throw new Error(`${decl} array not terminated`);
  return src.slice(start, end);
}

/**
 * Extract every regex literal from a registry block. Line-based on
 * purpose: the first whitespace-delimited token of each entry line is
 * the literal (`/^\/login$/,` — trailing comma stripped, comment tails
 * and prose lines skipped because they never start with `/^`).
 */
function extractRegexLiterals(block: string): RegExp[] {
  const out: RegExp[] = [];
  for (const rawLine of block.split("\n")) {
    const token = (rawLine.trim().split(/\s+/)[0] ?? "").replace(/,$/, "");
    if (!token.startsWith("/^")) continue;
    const lastSlash = token.lastIndexOf("/");
    if (lastSlash <= 1) continue;
    out.push(new RegExp(token.slice(1, lastSlash)));
  }
  if (out.length < 10)
    throw new Error(`registry extraction found only ${out.length} entries — parser broke`);
  return out;
}

/** The root path family a registry regex guards: `/^\/orders(\/|$)/` → "/orders". */
function familyRoot(re: RegExp): string {
  // re.source shape: `^\/<root>` + an anchor tail (`$`, `(\/|$)`, `\/` or
  // nothing). Skip the literal `^` + escaped-slash prefix, then take the
  // root up to the first non-path character.
  const m = /^\^\\\/([a-z0-9-]+)/.exec(re.source);
  if (!m) throw new Error(`unparsable family root in regex source: ${re.source}`);
  return `/${m[1]}`;
}

const SHELL_BLOCK = registryBlock(SHELL_TS, "const SHELL_NOINDEX_RES");
const SPA_BLOCK = registryBlock(ROUTE_SHAPES_TS, "const NOINDEX_ROUTES");
const shellRegexes = extractRegexLiterals(SHELL_BLOCK);
const spaRegexes = extractRegexLiterals(SPA_BLOCK);
const shellNoindex = (p: string) => shellRegexes.some((re) => re.test(p));
const spaNoindex = (p: string) => spaRegexes.some((re) => re.test(p));
const shellRoots = shellRegexes.map(familyRoot);
const spaRoots = spaRegexes.map(familyRoot);

/**
 * The SPA entries whose regexes require a CHILD segment (`/^\/onboarding/`,
 * `/^\/auth\//`) — their bare-root classification legitimately differs
 * from the shell's root-or-child form: no bare /auth route exists, and
 * /onboarding's own page stamps noindex at runtime (onboarding.tsx useSeo),
 * so the raw/SPA pair still agrees on every REAL route. Tightening either
 * regex later keeps this suite green (the skip is divergence-TOLERANT,
 * not divergence-PINNING).
 */
const SPA_CHILD_ANCHORED_ROOTS = new Set(["/auth", "/onboarding"]);

describe("R166 (F8) — shell SHELL_NOINDEX_RES ≡ SPA NOINDEX_ROUTES (family parity)", () => {
  it("both registries parse from source and are non-trivial", () => {
    expect(shellRegexes.length).toBeGreaterThanOrEqual(13);
    expect(spaRegexes.length).toBeGreaterThanOrEqual(13);
  });

  it("the path FAMILIES are the SAME set in both registries (the drift-catcher)", () => {
    // A family added to NOINDEX_ROUTES but not the shell (or vice versa)
    // fails HERE with a named diff — the exact hand-sync gap this suite
    // exists to kill.
    expect([...new Set(shellRoots)].sort()).toEqual([...new Set(spaRoots)].sort());
  });

  it("every family's CHILD path classification agrees in both registries, and no family is noindex nowhere", () => {
    for (const root of [...new Set(shellRoots)]) {
      // The child form is the canonical probe both anchoring styles agree
      // on: true for the root-or-child/descendant families (/orders/ABC,
      // /auth/callback, …), false for the three exact-$ families
      // (/login/child is — correctly — not noindexed by either side).
      expect(
        shellNoindex(`${root}/child`) === spaNoindex(`${root}/child`),
        `raw/SPA disagree on ${root}/child`,
      ).toBe(true);
      // The family's canonical member IS noindex somewhere in both
      // registries (exact-$ families via the root; the rest via either).
      expect(shellNoindex(root) || shellNoindex(`${root}/child`)).toBe(true);
      expect(spaNoindex(root) || spaNoindex(`${root}/child`)).toBe(true);
    }
  });

  it("the bare-root classification agrees on every family except the two documented child-anchored SPA forms", () => {
    for (const root of [...new Set(shellRoots)]) {
      if (SPA_CHILD_ANCHORED_ROOTS.has(root)) continue;
      expect(
        shellNoindex(root) === spaNoindex(root),
        `raw/SPA disagree on the bare root ${root}`,
      ).toBe(true);
    }
  });

  it("public routes stay INDEXABLE in both registries (the noindex families never over-reach)", () => {
    for (const pub of [
      "/",
      "/product/x",
      "/category/vpn",
      "/flash-sales",
      "/support",
      "/terms",
      "/xyz-not-a-route",
    ]) {
      expect(shellNoindex(pub), `shell must not noindex ${pub}`).toBe(false);
      expect(spaNoindex(pub), `SPA must not noindex ${pub}`).toBe(false);
    }
  });

  it("the docblock points at the REAL NOINDEX_ROUTES module (R186 H-F7 comment-truth)", () => {
    // NOINDEX_ROUTES has lived at frontend/src/app/route-shapes.ts since
    // the R137 decomposition — this suite itself already reads that
    // file (ROUTE_SHAPES_TS above); only the spa-shell comment lagged
    // with the pre-R137 App.tsx pointer.
    expect(SHELL_TS).not.toContain("frontend/src/App.tsx");
    expect(SHELL_TS).toContain("frontend/src/app/route-shapes.ts");
  });
});
