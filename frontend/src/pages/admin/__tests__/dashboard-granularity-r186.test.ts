/**
 * R186 (C-F6) — the dashboard period→granularity auto-set is ONE branch.
 *
 * `onChangeDays` carried two byte-identical arms (`days <= 14` /
 * `days <= 30` both → "daily") — dead split code over the picker's
 * {7, 14, 30, 90} period options. The fix collapsed them into the single
 * `days <= 30` cover (the missing `monthly` auto-set for 90d stays
 * deliberate — manual granularity stays reachable).
 *
 * Source pin (the panels-scope-self-gate-r183 idiom): exactly ONE
 * `setGranularity("daily")` occurrence may exist in dashboard.tsx — the
 * old dead branch made it two.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("R186 (C-F6) — dashboard onChangeDays granularity cover", () => {
  it('exactly one `setGranularity("daily")` — the dead days<=14/days<=30 split stays collapsed', () => {
    const source = read("src/pages/admin/dashboard.tsx");
    const dailyArms = source.match(/setGranularity\("daily"\)/g) ?? [];
    expect(dailyArms.length, "the collapsed single daily cover").toBe(1);
    // And the collapsed cover + the weekly else arm, verbatim.
    expect(source).toContain('if (days <= 30) setGranularity("daily");');
    expect(source).toContain('else setGranularity("weekly");');
  });
});
