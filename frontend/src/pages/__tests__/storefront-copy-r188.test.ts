/**
 * R188-4 (D-F1 + D-F8) — storefront copy contracts, byte-pinned.
 *
 * SOURCE-scan pins (the decomposition-suite idiom — exact-string
 * invariants a render test only covers incidentally). Two audit
 * findings, both revert-mutation-guarded:
 *
 *   • D-F1: the dangling-hamza «أصدقاءك» misspelling (×5 sites —
 *     ReferralBox :34, loyalty :83/:344, referrals :71/:289) is
 *     fixed to «أصدقائك», the house form the same pages already
 *     carried (referrals :198/:535, pinned by referrals-page
 *     :236/:344). The absence assert catches ANY reintroduction.
 *   • D-F8: onboarding step 2 points new users at «صفحة حسابك» —
 *     the profile page's own label («حسابي», MobileNav / drawer /
 *     profile :102/:291) — never the differently-labeled
 *     «صفحة الملف الشخصي» no surface answers to.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("R188-4 (D-F1) — «أصدقائك» on every referral surface", () => {
  const files = [
    "src/components/loyalty/ReferralBox.tsx",
    "src/pages/loyalty.tsx",
    "src/pages/referrals.tsx",
  ];

  it("the dangling-hamza form «أصدقاءك» is gone from all three files", () => {
    for (const f of files) {
      expect(read(f), f).not.toContain("أصدقاءك");
    }
  });

  it("each of the five fixed sites carries the house form byte-exact", () => {
    expect(read("src/components/loyalty/ReferralBox.tsx")).toContain("ادعُ أصدقائك");
    expect(read("src/pages/loyalty.tsx")).toContain("وادعُ أصدقائك للمكافآت.");
    expect(read("src/pages/loyalty.tsx")).toContain("اكسب نقاطاً وادعُ أصدقائك");
    expect(read("src/pages/referrals.tsx")).toContain("ادعُ أصدقائك إلى SubNation");
    expect(read("src/pages/referrals.tsx")).toContain("ادعُ أصدقائك واكسب نقاطاً");
  });
});

describe("R188-4 (D-F8) — onboarding names the profile page by its own label", () => {
  it("step 2 says «من صفحة حسابك» — never the unlabelled «صفحة الملف الشخصي»", () => {
    const onboarding = read("src/pages/onboarding.tsx");
    expect(onboarding).toContain("العودة لإعدادات حسابك من صفحة حسابك.");
    expect(onboarding).not.toContain("صفحة الملف الشخصي");
  });
});
