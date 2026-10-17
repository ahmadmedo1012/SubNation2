import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R143 (L16-1) — the backend half of the r137 "no monolith" invariant,
 * finally gated.
 *
 * The frontend decomposition contracts have been source-scan-pinned since
 * r137 (pages/__tests__/*-decomposition-*.test.ts), but the backend never
 * got the twin gate — and during R142 itself two files crossed the line
 * unnoticed (spa-shell.ts +43, admin/auth.ts +17). The frontend lane also
 * found checkout.tsx at 918/1000 (92%) with no tripwire. This suite closes
 * the seam: crossing the ceiling in backend/src now FAILS CI.
 *
 * Exemption register (frozen, each with its reason):
 *   • migrate.ts — the boot reconciler. Splitting it is danger-flagged
 *     (L16-2: only after the F-1 chain-apply test landed — it did land
 *     this round as migrate-drizzle-chain-apply.test.ts + the
 *     migrate-boot-body.test.ts body-execution twin — and never batched
 *     with other work). Its size grows BY DESIGN: every expand-first
 *     migration round appends stages. Hard ceiling: 5,000 (a runaway
 *     gets caught; normal growth does not).
 *   • alerting.service.ts / spa-shell.ts / admin/auth.ts — over the line
 *     today, growth-BANNED at their pinned maxima (+5 buffer for comment
 *     hygiene). Leaving the register requires dropping below 1,000.
 *   • routes/admin/products.ts (R158) — TRIPWIRE class: pinned BELOW the
 *     ceiling at its R158 post-dedup size + buffer (962 + 5). The file
 *     has a history of riding the line (R143 already had to carve
 *     products-field-limits.ts out of it mid-round when it crossed
 *     1,000), so any feature addition now FAILS the register branch
 *     with a named offender instead of quietly spending the remaining
 *     headroom to the cliff. Promote to the over-line class (or retire
 *     it entirely) only together with a real split that moves it well
 *     under the ceiling.
 */

const SRC_ROOT = path.resolve(import.meta.dirname, "..");

/** [file, ceiling] — the growth-banned register (reasons in the header).
 * Entries pinned ABOVE the 1,000 ceiling are legacy over-the-line
 * members; entries pinned at/below it are R158 tripwires (see header). */
const GROWTH_BANNED: Array<[string, number]> = [
  ["services/alerting.service.ts", 1_083],
  ["lib/spa-shell.ts", 1_039],
  ["routes/admin/auth.ts", 1_026],
  // R158 (B#1): tripwire — 962/1,000 after the notifyAdminStats dedup;
  // any growth past the pin names this file in the CI failure.
  ["routes/admin/products.ts", 967],
];
const MIGRATE_CEILING = 5_000;
const CEILING = 1_000;

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "test") continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collectSourceFiles(p));
    else if (entry.endsWith(".ts")) out.push(p);
  }
  return out;
}

function lineCount(file: string): number {
  return readFileSync(file, "utf8").split("\n").length;
}

describe("R143 (L16-1) — the backend no-monolith gate", () => {
  const files = collectSourceFiles(SRC_ROOT);
  const rel = (f: string) => path.relative(SRC_ROOT, f);

  it("the census covers the real source tree (not a stale list)", () => {
    // If this number collapses, the walker broke and the gate went
    // vacuous — the exact silent-failure mode this suite exists to kill.
    expect(files.length).toBeGreaterThan(150);
  });

  it("every backend/src file stays under the 1,000-line ceiling (except the frozen register)", () => {
    const offenders: string[] = [];
    const register = new Map(GROWTH_BANNED.map(([f, c]) => [f, c]));
    for (const f of files) {
      const r = rel(f);
      if (r === "migrate.ts") continue; // design-exempt (see header)
      const limit = register.get(r);
      const count = lineCount(f);
      if (limit !== undefined) {
        // Growth-banned register member: may shrink, may not grow past
        // its pinned maximum.
        if (count > limit) offenders.push(`${r}: ${count} > register max ${limit}`);
      } else if (count > CEILING) {
        offenders.push(`${r}: ${count} > ${CEILING}`);
      }
    }
    expect(
      offenders,
      `new backend monolith(s) — split before shipping:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the register itself stays honest (members still exist; still over the line)", () => {
    for (const [r, pin] of GROWTH_BANNED) {
      const count = lineCount(path.join(SRC_ROOT, r));
      if (pin > CEILING) {
        // Legacy over-the-line member: still over the line, else remove
        // (the ceiling test ignores it either way, but the doc value of
        // the register depends on it being current).
        expect(count, `${r} shrank below 1,000 — remove it from the register`).toBeGreaterThan(
          CEILING,
        );
      } else {
        // R158 tripwire member: pinned at/below the ceiling so growth
        // fails with a register-specific message. It stays honest while
        // the file still rides near the line; a real split that drops it
        // comfortably under 900 means the tripwire is stale — remove it.
        expect(
          count,
          `${r} was split well below the ceiling — remove it from the register`,
        ).toBeGreaterThan(CEILING - 100);
      }
    }
  });

  it("migrate.ts has room to grow but not to run away", () => {
    expect(lineCount(path.join(SRC_ROOT, "migrate.ts"))).toBeLessThanOrEqual(MIGRATE_CEILING);
  });
});
