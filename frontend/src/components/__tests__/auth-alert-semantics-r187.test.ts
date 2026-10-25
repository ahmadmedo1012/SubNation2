/**
 * R187 (C-F9) — the two auth error blocks keep role="alert"'s assertive
 * semantics (no explicit polite downgrade).
 *
 * role="alert" already implies aria-live="assertive" + aria-atomic — an
 * explicit aria-live="polite" on the SAME element overrides the
 * assertiveness down to a polite live region: screen readers may
 * postpone or soften the announcement of exactly the failures the
 * alert role exists to assert (the auth error banner on /login and the
 * admin login's error block — the two files the audit flagged).
 *
 * Source pin (the storefront-raw-fetch-gate r144 idiom): comment-stripped
 * scan — each file must still CARRY role="alert" and must NOT carry the
 * polite override anywhere (a commented-out copy must not count as
 * live, and a prose mention cannot fake an occurrence).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** The storefront-r128-sweep idiom: strip block + line comments. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const FILES = ["src/components/auth/AuthErrorBanner.tsx", "src/pages/admin/login.tsx"] as const;

describe("R187 (C-F9) — role=alert blocks carry no aria-live=polite downgrade", () => {
  it.each(FILES)("%s: the alert role stays, the polite override is gone", (rel) => {
    const live = stripComments(read(rel));
    expect(live, `${rel} keeps the alert role`).toContain('role="alert"');
    expect(live, `${rel} must not downgrade the alert to a polite region`).not.toContain(
      'aria-live="polite"',
    );
  });
});
