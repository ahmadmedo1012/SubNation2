/**
 * R139 (precision) — the ACCESS OPERATIONS visual register (139-g):
 * admin users / admins / security join the r138 family idioms.
 *
 * Source-scan pins (the r128-sweep / 139-c/f idiom — a render suite only
 * covers the nodes it happens to query). The lanes' r137 decomposition
 * ceilings (admin-users/admins/security-decomposition-r137) guard the
 * STRUCTURE; this file guards the VISUAL dialect wave 2 shipped across
 * the console so it cannot silently regress:
 *
 *   1. calm active pill — every selected-state chip row (the users
 *      tier/sort bars + filter toggle, the wallet-mode segmented
 *      control, the security tab bar, the scope checkbox tiles) rides
 *      the one trio: bg-primary/15 + text-primary-text +
 *      border-primary/30 + font-bold, with BOTH states carrying a
 *      border box (no raised card-colored segment, no jitter);
 *   2. table register — solid bg-muted/30 header bands + /60 seams +
 *      /60 row hairlines + bg-muted/30 hover, receipt /20 terminal rule
 *      + tabular-nums on the honest-count footers;
 *   3. receipt rhythm on money — the loaded-sample strip's values are
 *      weight+size only (no status ink), the wallet cell keeps the AA
 *      text-primary-text pair the orders lane rides;
 *   4. well family + quiet danger — the inactive shield tile rides
 *      bg-muted/60, the disable trigger rests neutral with the error
 *      ink surfacing on hover only (severity lives in the page's
 *      destructive confirm);
 *   5. canonical recipes — the admins header CTA + both dialog footers
 *      ride the shared Button, the dialog fields ride the shared Input;
 *   6. token discipline — the security lane's failure ink is
 *      --status-error (§6 status source), zero /55 resting edges, zero
 *      glass (translucent card fills + backdrop-blur), and the pane
 *      skeleton mirrors the real panes' /60 frame.
 *
 * Historical class names in comments are PARAPHRASED where feasible; the
 * comment-stripper below (string-literal-aware) keeps the negative pins
 * absolute regardless (the 139-c craft — rationale blocks NAME the
 * retired strings).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

const USERS = "src/components/admin/users";
const ADMINS = "src/components/admin/admins";
const SECURITY = "src/components/admin/security";

/** Strip line + block comments while SKIPPING string literals (the lanes
 * carry URL/template strings — a naive double-slash sweep would eat a path
 * mid-string). Handles single/double/back quotes with escapes; JSX comment
 * braces fall out as plain block comments. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let mode: "code" | "line" | "block" | "quote" = "code";
  let quote = "";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "quote") {
      if (c === "\\") {
        out += c + (n ?? "");
        i += 2;
        continue;
      }
      if (c === quote) mode = "code";
      out += c;
      i++;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += c;
      }
      i++;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    // code
    if (c === "/" && n === "/") {
      mode = "line";
      i += 2;
      continue;
    }
    if (c === "/" && n === "*") {
      mode = "block";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      mode = "quote";
      quote = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const stripped = (rel: string): string => stripComments(read(rel));

/** Every non-test source file in the three lanes (the negative sweeps). */
const LANE_FILES = [
  "src/pages/admin/users.tsx",
  "src/pages/admin/admins.tsx",
  "src/pages/admin/security.tsx",
  `${USERS}/UsersToolbar.tsx`,
  `${USERS}/UsersFilterPanel.tsx`,
  `${USERS}/UsersStatsStrip.tsx`,
  `${USERS}/UsersDesktopTable.tsx`,
  `${USERS}/DesktopUserRow.tsx`,
  `${USERS}/MobileUserCard.tsx`,
  `${USERS}/UserEditDialog.tsx`,
  `${USERS}/ProviderBadges.tsx`,
  `${USERS}/UsersTableSkeleton.tsx`,
  `${USERS}/user-directory-meta.ts`,
  `${ADMINS}/AdminsHeader.tsx`,
  `${ADMINS}/AdminAccountCard.tsx`,
  `${ADMINS}/CreateAdminDialog.tsx`,
  `${ADMINS}/EditAdminDialog.tsx`,
  `${ADMINS}/AdminDialogShell.tsx`,
  `${ADMINS}/ScopeCheckboxGrid.tsx`,
  `${ADMINS}/admins-meta.ts`,
  `${SECURITY}/AuthStatsGrid.tsx`,
  `${SECURITY}/AuthFiltersCard.tsx`,
  `${SECURITY}/ActivityTimelineCard.tsx`,
  `${SECURITY}/AuditFiltersCard.tsx`,
  `${SECURITY}/AuditTrailErrorCard.tsx`,
  `${SECURITY}/AuditTrailTable.tsx`,
  `${SECURITY}/AuthPaneSkeleton.tsx`,
  `${SECURITY}/security-meta.ts`,
];

describe("R139 (139-g) — calm active pill dialect on every selected-state chip row", () => {
  it("the users filter toggle carries the calm trio + a boxed resting state", () => {
    const src = read(`${USERS}/UsersToolbar.tsx`);
    expect(src).toContain("bg-primary/15 text-primary-text border-primary/30 font-bold");
    expect(src).toContain(
      "bg-muted/30 border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70",
    );
    expect(src).toContain("aria-expanded={showFilters}");
  });

  it("the tier + sort chip bars are border-boxed in BOTH branches (aria-pressed byte-identical)", () => {
    const src = stripped(`${USERS}/UsersFilterPanel.tsx`);
    expect(src).toContain("aria-pressed={tierFilter === t.value}");
    expect(src).toContain("aria-pressed={sortBy === s.value}");
    // Both branches carry the border box — the active trio twice (tier +
    // sort), the boxed resting pair twice.
    expect(
      src.match(/bg-primary\/15 text-primary-text border-primary\/30 font-bold/g),
    ).toHaveLength(2);
    expect(src.match(/bg-muted\/30 border-border\/30 text-muted-foreground/g)).toHaveLength(2);
    // The segmented-control shell is gone (tray wash + raised segment).
    expect(src).not.toContain("bg-secondary/40");
    expect(src).not.toContain("shadow-sm");
  });

  it("the wallet-mode money control rides the pill pair with the A10 §C-17 aria-pressed pin intact", () => {
    const src = stripped(`${USERS}/UserEditDialog.tsx`);
    expect(src).toContain("aria-pressed={form.wallet_mode === opt.value}");
    expect(src).toContain("bg-primary/15 text-primary-text border-primary/30 font-bold");
    expect(src).toContain("border-transparent text-muted-foreground hover:text-foreground");
    expect(src).not.toContain("shadow-sm");
  });

  it("the security tab bar rides the pill pair (real-tab semantics untouched)", () => {
    const src = stripped("src/pages/admin/security.tsx");
    expect(src).toContain('role="tablist"');
    expect(src).toContain("aria-selected={activeTab === tab.id}");
    expect(src).toContain("bg-primary/15 text-primary-text border-primary/30 font-bold");
    expect(src).toContain("border-transparent text-muted-foreground hover:text-foreground");
    expect(src).not.toContain("shadow-sm");
  });

  it("the scope checkbox tiles ride the calm selected tint (role/aria-checked intact)", () => {
    const src = stripped(`${ADMINS}/ScopeCheckboxGrid.tsx`);
    expect(src).toContain('role="checkbox"');
    expect(src).toContain("aria-checked={checked}");
    expect(src).toContain('"bg-primary/15 border-primary/30 text-foreground"');
  });
});

describe("R139 (139-g) — table register + receipt rhythm", () => {
  it("the users table header band is solid (glass retired) + /60 seam", () => {
    const src = stripped(`${USERS}/UsersDesktopTable.tsx`);
    expect(src).toContain('className="sticky top-0 z-10 border-b border-border/60 bg-muted/30"');
    expect(src).not.toContain("backdrop-blur");
    expect(src).not.toContain("bg-card/85");
    expect(src).not.toContain("supports-[backdrop-filter]");
  });

  it("the users rows speak the /60 seam + bg-muted/30 hover (no elevation, zebra kept)", () => {
    const src = stripped(`${USERS}/DesktopUserRow.tsx`);
    expect(src).toContain("border-b border-border/60 transition-colors hover:bg-muted/30");
    expect(src).toContain("bg-muted/[0.035]");
    expect(src).not.toMatch(/hover:shadow/);
    // The AA money ink stays (the orders lane's amount-cell pair).
    expect(src).toContain("font-bold text-primary-text tabular-nums");
  });

  it("the users footer is the receipt terminal rule + tabular-nums", () => {
    const src = stripped(`${USERS}/UsersDesktopTable.tsx`);
    expect(src).toContain("border-t border-border/20 bg-muted/10");
    expect(src).toMatch(/text-xs text-muted-foreground tabular-nums/);
  });

  it("the loaded-sample strip's money values are weight+size only (token tint stays on the icon stage)", () => {
    const src = read(`${USERS}/UsersStatsStrip.tsx`);
    expect(src).toContain('<div className="font-bold text-sm tabular-nums">{stat.value}</div>');
    expect(src).toContain("<stat.icon className={`w-4 h-4 ${stat.color}`} />");
    expect(src).not.toContain("tabular-nums ${stat.color}");
  });

  it("the audit table rides the header band + /60 seams (read-only rows carry no hover affordance)", () => {
    const src = stripped(`${SECURITY}/AuditTrailTable.tsx`);
    expect(src).toContain("border-b border-border/60 bg-muted/30");
    expect(src).toContain('className="border-b border-border/60 align-top"');
    expect(src).not.toContain("hover:bg-muted");
  });

  it("the mobile user card hovers by border step only", () => {
    const src = stripped(`${USERS}/MobileUserCard.tsx`);
    expect(src).toContain("hover:border-border transition-colors");
    expect(src).not.toMatch(/hover:shadow/);
  });
});

describe("R139 (139-g) — well family, quiet danger, canonical recipes (admins)", () => {
  it("the inactive shield tile rides the bg-muted/60 well register", () => {
    const src = read(`${ADMINS}/AdminAccountCard.tsx`);
    expect(src).toContain('admin.is_active ? "bg-primary/10" : "bg-muted/60"');
  });

  it("the identity chip carries the border box its wildcard sibling rides", () => {
    const src = read(`${ADMINS}/AdminAccountCard.tsx`);
    expect(src).toContain(
      "text-3xs font-bold bg-primary/10 text-primary-text border border-primary/20 px-1.5 py-0.5 rounded",
    );
  });

  it("the disable trigger rests neutral; the error ink surfaces on hover only (severity in the confirm)", () => {
    const src = read(`${ADMINS}/AdminAccountCard.tsx`);
    expect(src).toContain(
      "border-border/60 text-muted-foreground hover:text-status-error hover:border-status-error/30 hover:bg-status-error/10",
    );
    // The enable sibling keeps its success ink (the positive action).
    expect(src).toContain(
      "border-status-success/40 text-status-success hover:bg-status-success/10",
    );
    // And the severity really lives in the page's destructive confirm.
    const page = read("src/pages/admin/admins.tsx");
    expect(page).toContain("destructive: admin.is_active,");
  });

  it("the header CTA rides the shared Button (the console header-CTA recipe)", () => {
    const src = stripped(`${ADMINS}/AdminsHeader.tsx`);
    expect(src).toContain("<Button");
    expect(src).toContain('className="bg-primary hover:bg-primary/90 h-9');
    expect(src).not.toMatch(/<button/);
    expect(src).not.toContain("shadow-sm");
  });

  it("both admin dialogs rhyme with the shared Input family (no hand-rolled fields)", () => {
    for (const name of ["CreateAdminDialog", "EditAdminDialog"]) {
      const src = stripped(`${ADMINS}/${name}.tsx`);
      expect(src, name).toContain("<Input");
      expect(src, name).not.toMatch(/<input\s/);
      expect(src, name).not.toContain("px-3 py-2 bg-background");
    }
  });

  it("both admin dialog footers ride the shared Button family (ghost cancel + h-9 primary submit)", () => {
    for (const name of ["CreateAdminDialog", "EditAdminDialog"]) {
      const src = stripped(`${ADMINS}/${name}.tsx`);
      expect(src, name).toContain('<Button type="button" variant="ghost" onClick={onClose}>');
      expect(src, name).toContain('type="submit"');
      expect(src, name).toContain('className="h-9 bg-primary hover:bg-primary/90');
      expect(src, name).not.toMatch(/<button\s/);
    }
  });

  it("the super-admin lock note keeps its primary identity tint (the lane's brand semantic)", () => {
    const src = read(`${ADMINS}/EditAdminDialog.tsx`);
    expect(src).toContain("bg-primary/5 border border-primary/20 rounded-lg text-xs");
  });
});

describe("R139 (139-g) — token discipline across the three lanes", () => {
  it("zero /55 resting edges (the family value is /60; comments stripped)", () => {
    for (const f of LANE_FILES) {
      expect(stripped(f), f).not.toContain("border-border/55");
    }
  });

  it("zero glass anywhere in the lanes (translucent card fills + backdrop-blur retired)", () => {
    for (const f of LANE_FILES) {
      const src = stripped(f);
      expect(src, f).not.toContain("backdrop-blur");
      expect(src, f).not.toMatch(/bg-card\/[6789]\d/);
    }
  });

  it("the security lane's failure ink is --status-error (§6 status source — no shadcn destructive channel)", () => {
    for (const f of [`${SECURITY}/AuthStatsGrid.tsx`, `${SECURITY}/ActivityTimelineCard.tsx`]) {
      const src = stripped(f);
      expect(src, f).not.toContain("text-destructive");
      expect(src, f).toContain("text-status-error");
    }
  });

  it("the pane skeleton mirrors the real panes' /60 frames (loading→loaded parity)", () => {
    const src = stripped(`${SECURITY}/AuthPaneSkeleton.tsx`);
    expect(src.match(/border border-border\/60/g)).toHaveLength(3);
    expect(src).not.toContain("border-border/55");
  });

  it("the money-edit dialog keeps the AA wallet ink + drops the spend success ink", () => {
    const src = read(`${USERS}/UserEditDialog.tsx`);
    expect(src).toContain('cls: "text-primary-text"');
    expect(src).not.toContain("text-status-success");
  });
});
