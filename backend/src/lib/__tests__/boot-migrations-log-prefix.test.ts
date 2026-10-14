import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * R143 (L9-4) — investigated as a P4 finding, landed as a FALSE-POSITIVE
 * closure with a guard.
 *
 * The lane-L9 finding reported "22 boot-critical log lines corrupted to
 * `\"igrations]\"` in boot-migrations.ts". Verification against the
 * authoritative bytes says otherwise: the working tree, the HEAD blob
 * (528ef39), AND the file's birth commit (6f476ca) all carry the CORRECT
 * `"[migrations] …"` prefix on every line (python byte-count: 0
 * occurrences of `"igrations]`, 22 of `[migrations]` at HEAD; 0/9 at
 * birth — the count grew as the file grew, `git log -S` confirms only
 * count CHANGES of the substring that lives inside the correct prefix).
 *
 * The finding's evidence was an `rg 'igrations]'` readout — and
 * `[migrations]` CONTAINS the substring `igrations]`, so a correct line
 * matches the probe; the corruption was an artifact of rendering
 * (terminal pipelines that treat `[m` as an ANSI reset fragment display
 * `"[migrations] x"` as `"igrations] x"`).
 *
 * This pin exists so the CLASS stays closed: if a future edit ever does
 * corrupt the prefix (the L9-4 scenario), the scan below fails loudly
 * instead of riding green CI — these are the most boot-critical log
 * lines in the system (the B7-P0-1 incident class greps for them).
 */

function repoPath(rel: string): string {
  return new URL(`../../../../${rel}`, import.meta.url).pathname;
}

describe("R143 (L9-4): boot-migrations log prefixes are well-formed", () => {
  it('every boot log line carries the full [migrations] prefix — zero corrupted "igrations] forms', async () => {
    const source = await readFile(repoPath("backend/src/lib/boot-migrations.ts"), "utf8");

    // The corrupted form: a string literal starting one character short
    // (the exact typo the finding described).
    expect(source.includes('"igrations]')).toBe(false);

    // The correct form is present and plentiful — the boot-critical
    // paths (writable-wait, CRITICAL refusal, transient retry, completion)
    // all ride it.
    const prefixed = source.match(/"\[migrations\] /g) ?? [];
    expect(prefixed.length).toBeGreaterThanOrEqual(20);

    // And the CRITICAL refusal lines specifically — the ones operators
    // and log-based alerting grep for during a boot incident.
    expect(source).toContain('"[migrations] CRITICAL');
  });
});
