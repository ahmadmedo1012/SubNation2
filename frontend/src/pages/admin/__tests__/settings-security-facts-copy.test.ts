/**
 * R120-B7 (reviewer finding — copy fix): the admin settings security
 * facts panel title. The independent R120 review flagged «حقائق الأمان
 * المعمولة» — «معمولة» is not standard MSA for "in effect"; the fix is
 * «حقائق الأمان المطبَّقة» (what the deployment actually applies).
 *
 * No settings render suite exists (the page is 2FA/password/fetch
 * heavy); this is a source-scan pin (the no-native-confirm.test.ts
 * idiom) so the non-standard form can't quietly return while a real
 * suite is still missing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const settingsText = readFileSync(resolve(process.cwd(), "src/pages/admin/settings.tsx"), "utf8");

describe("admin settings — security facts panel copy (R120-B7)", () => {
  it("the panel title reads «حقائق الأمان المطبَّقة»", () => {
    expect(settingsText).toContain("حقائق الأمان المطبَّقة");
  });

  it("the non-standard «المعمولة» is gone from the panel", () => {
    // The R120-B7 fix note in the source comment legitimately QUOTES the
    // old form («المعمولة» → «المطبَّقة») — the guard targets the
    // rendered title only, not the changelog comment.
    expect(settingsText).not.toContain('<h2 className="font-bold text-sm">حقائق الأمان المعمولة');
  });
});
