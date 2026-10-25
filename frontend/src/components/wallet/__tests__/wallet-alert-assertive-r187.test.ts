/**
 * R187 (L-F2) — role="alert" must not carry an explicit aria-live
 * override in the wallet family.
 *
 * Both topup money-path error banners (MobileTransferForm's
 * #wallet-error, LyPayFlow's #wallet-error-2) rendered
 * `role="alert" aria-live="polite"` — the explicit polite attribute
 * OVERIDES role=alert's implicit assertive semantics, queueing the
 * topup/withdrawal error behind other announcements. The fix deleted
 * the attribute on both; this source-scan pin keeps the whole
 * components/wallet family free of the combo.
 *
 * Source-scan shape (the account-surfaces-visual-r139 idiom):
 * comment-stripped — rationale comments NAME the retired attribute, so
 * raw absence checks would false-fail on the documentation itself.
 * Element-level granularity: the two attributes must sit in the SAME
 * opening tag ([^<>]* between them), so a legit aria-live="polite"
 * region beside a DIFFERENT element's role="alert" stays legal
 * (BalanceCard's announcer, TopupWaitingModal's status bodies).
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WALLET_DIR = resolve(process.cwd(), "src/components/wallet");

/** Line-comments-first stripper (the 139-i lesson: block-first opens
 *  phantom comments on `/*`-bearing paths). */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

/** One opening tag cannot contain both attributes (either order). */
const ALERT_PLUS_LIVE = /role="alert"[^<>]*aria-live=|aria-live=[^<>]*role="alert"/;

describe("R187 L-F2 — role=alert carries NO explicit aria-live override in the wallet family", () => {
  it('no element in components/wallet/*.tsx carries both role="alert" and aria-live=', () => {
    const files = readdirSync(WALLET_DIR).filter((f) => f.endsWith(".tsx"));
    // The family is non-empty and includes both fixed banners — the
    // scan is real, not a vacuous pass over an empty dir.
    expect(files).toContain("MobileTransferForm.tsx");
    expect(files).toContain("LyPayFlow.tsx");

    for (const f of files) {
      const src = stripComments(readFileSync(resolve(WALLET_DIR, f), "utf8"));
      // role="alert" alone = implicit aria-live="assertive" — the
      // correct money-error semantics; any explicit override (polite)
      // downgrades the banner's announcement priority.
      expect(src, f).not.toMatch(ALERT_PLUS_LIVE);
    }
  });
});
