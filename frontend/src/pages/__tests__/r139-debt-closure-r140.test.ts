/**
 * R140 — r139 debt closure (140-e), the five flagged follow-ups pinned.
 *
 * The r139 closure round left five documentation-grade flags. This suite
 * freezes their resolutions as source-scan pins (the r128-sweep / 139-c
 * craft: LINE-COMMENTS-FIRST stripping + whitespace normalization, so
 * only live markup is the contract — the R140 rationale blocks NAME the
 * retired classes/strings they document):
 *
 *   (a) CATEGORY EYEBROW — the «فئة …» kicker above the h1 is DELETED
 *       (the r139-k "copy authorization" flag resolved by the designer):
 *       the r125 craft floor bans kickers over headings ("let the h1
 *       speak" — GuestHero/AuthedHero both deleted theirs; this was the
 *       family's last remnant), and the category was named three times
 *       in ~200px (breadcrumb crumb + eyebrow + keyword-rich h1). The
 *       identity contracts survive: breadcrumb crumb + h1 + metaTitle.
 *   (b) FLASH-SALE COUNTDOWN — the banner's digit groups are isolated
 *       LTR runs (span-level dir="ltr", 139-k's layout-owned flag), the
 *       structural twin of the /flash-sales page chip's one-container
 *       isolation. NOT a wrapping container over the segment row: that
 *       would flip the segments' RTL flex order — a visual regression.
 *       Zero visual delta otherwise (pure-ASCII tabular digits).
 *   (c) STOREFRONT HAIRLINE FAMILY — non-money storefront section rules
 *       unify on ONE value: /20, the money-path receipt-grade precedent
 *       (FINAL_UX_SYSTEM's receipt rhythm) that terms.tsx already rides.
 *       /40 and /25 were the pre-r140 scatter. flash-sales carries no
 *       top-level section rules at all (a card-grid page).
 *   (d) NAMED-TRACKING NO-OPS — the dead `tracking-wider`/`tracking-
 *       widest` classes (silently zeroed by the global Arabic
 *       letter-spacing guard) die: the 2FA secret + Latin eyebrow +
 *       coupon code drop them (zero-visual-delta kills; wrap risk makes
 *       real tracking wrong there), while the fixed-length 6-digit admin
 *       login OTP converts to the working `tracking-[0.2em]` register
 *       its 2FA-setup twin rides. lib/analytics.ts stays the ONE real
 *       analytics entry (initAnalytics, consumed by main.tsx) — the
 *       lib/hooks/layout lane carries no competing no-op tracker.
 *   (e) REFERRALS ERROR BANNERS — the storefront page is verified clean
 *       (the shared FetchErrorCard IS its error surface — no hand-rolled
 *       twin exists), and the admin referrals page's hand-rolled red
 *       wall adopts the shared StaleListErrorBanner (the calm-error
 *       register admin/orders rides, byte-pinned below).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** LINE-COMMENTS-FIRST stripper (the 139-c/f craft): full-line `//`
 *  notes die BEFORE block comments, so a `//` note quoting a `/*` path
 *  glob can never open a phantom block. The R140 rationale blocks NAME
 *  the retired classes — only live markup is the contract. */
function stripComments(src: string): string {
  return src.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Comment-stripped + whitespace-normalized source — multi-line class
 *  template literals pin like single-line strings. */
function live(src: string): string {
  return stripComments(src).replace(/\s+/g, " ");
}

const category = live(read("src/pages/category.tsx"));
const flash = live(read("src/pages/flash-sales.tsx"));
const banner = live(read("src/components/layout/FlashSaleBanner.tsx"));
const referrals = live(read("src/pages/referrals.tsx"));
const adminReferrals = live(read("src/pages/admin/referrals.tsx"));
const staleBanner = live(read("src/components/admin/orders/StaleListErrorBanner.tsx"));
const twofa = live(read("src/pages/admin/settings/two-factor-setup.tsx"));
const whatsappHeader = live(read("src/components/admin/whatsapp/WhatsappHeader.tsx"));
const adminLogin = live(read("src/pages/admin/login.tsx"));
const couponsTable = live(read("src/components/admin/coupons/CouponsTable.tsx"));
const analytics = read("src/lib/analytics.ts");
const mainTs = read("src/main.tsx");

describe("R140 (a) — category eyebrow: «let the h1 speak» (the r139-k authorization flag resolved)", () => {
  it("the «فئة …» kicker above the h1 is deleted — no eyebrow markup survives in live source", () => {
    expect(category).not.toContain("فئة {meta.label}");
    expect(category).not.toMatch(/text-xs text-muted-foreground font-semibold mb-1/);
  });

  it("the identity contracts survive on the surfaces that own them: breadcrumb crumb + the fluid-3xl h1", () => {
    // The visible breadcrumb's current crumb still names the category…
    expect(category).toContain('<span className="text-foreground font-bold">{meta.label}</span>');
    // …and the h1 still rides the storefront page-title scale (the 139-k pin, re-frozen).
    expect(category).toContain('<h1 className="text-fluid-3xl font-bold text-foreground">');
    expect(category).not.toContain("text-fluid-2xl");
  });

  it("the hero-card family edge is untouched by the eyebrow deletion (border/40 + shadow-lg stay — the 139-k anti-sweep pin)", () => {
    expect(category).toContain(
      '"relative overflow-hidden rounded-2xl border border-border/40 bg-card mb-6 shadow-lg float-in"',
    );
  });
});

describe("R140 (b) — FlashSaleBanner countdown: STRUCTURAL LTR isolation (139-k's layout-owned flag)", () => {
  it("each digit group is an isolated LTR run — span-level dir, exactly one per segment", () => {
    expect(banner).toContain(
      '<span dir="ltr" className="font-bold tabular-nums text-2xs sm:text-xs leading-tight">',
    );
    // Exactly ONE dir="ltr" in the file = per-digit isolation, NOT a
    // wrapping container (which would flip the segments' RTL flex order —
    // h rightmost, the Arabic reading order — a visual regression).
    expect(banner.match(/dir="ltr"/g) ?? []).toHaveLength(1);
  });

  it("no visual regression: segment boxes, RTL row geometry and the ':' separators are byte-identical", () => {
    expect(banner).toContain(
      "flex flex-col items-center min-w-[22px] sm:min-w-[26px] px-0.5 sm:px-1 py-0.5 rounded border transition-colors",
    );
    expect(banner).toContain('className="flex items-center gap-0.5 sm:gap-1"');
    expect(banner).toContain('<span className="font-bold opacity-40 text-3xs">:</span>');
    expect(banner).toContain('<span className="text-3xs leading-none max-[359px]:hidden">');
  });

  it("the /flash-sales page chip keeps its one-container isolation — the countdown family is bidi-safe end-to-end", () => {
    expect(flash).toContain('<span dir="ltr">{timeLabel}</span>');
    expect(flash).toContain(
      "bg-card border border-border/60 text-foreground text-2xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 tabular-nums",
    );
  });
});

describe("R140 (b, img) — the flash card image: lazy/async/descriptive-alt verified on the fixed-ratio shelf", () => {
  it("loading=lazy + decoding=async + a real bound alt, inside the aspect-square reserved box", () => {
    expect(flash).toContain('loading="lazy"');
    expect(flash).toContain('decoding="async"');
    // A bound alt expression (the product's own name today; the r140-a
    // image-discipline lane may upgrade the builder — the contract is
    // "descriptive alt present", not one fixed expression).
    expect(flash).toMatch(/alt=\{[^}]+\}/);
    // The fixed-ratio well reserves the layout box — CLS is structurally
    // zero, which is WHY no width/height attrs ride the img.
    expect(flash).toContain('"relative aspect-square bg-muted/60 overflow-hidden"');
    expect(flash).toContain(
      "absolute inset-0 z-[2] m-auto max-w-[74%] max-h-[74%] w-auto h-auto object-contain",
    );
  });
});

describe("R140 (c) — storefront non-money section rules: ONE hairline family (/20, the receipt-grade precedent)", () => {
  it("category's two section rules ride border-border/20 — the FAQ answer divider + the sibling-nav boundary", () => {
    expect(category).toContain(
      "px-4 pt-1 pb-4 border-t border-border/20 text-sm text-muted-foreground leading-relaxed",
    );
    expect(category).toContain('<section className="pt-6 border-t border-border/20">');
  });

  it("zero /40 section rules remain in category — the /40 that survives is the hero-card FAMILY edge, not a section rule", () => {
    expect(category).not.toContain("border-t border-border/40");
    expect(category).not.toMatch(/border-border\/25\b/);
    // The hero-card resting edge (a matched pair with GuestHero/AuthedHero)
    // is the documented /40 exception — pinned above in suite (a).
  });

  it("flash-sales carries no top-level section rules at all (a card-grid page) and no scatter values", () => {
    expect(flash).not.toMatch(/border-t\b/);
    expect(flash).not.toMatch(/divide-y\b/);
    expect(flash).not.toMatch(/border-border\/25\b/);
    expect(flash).not.toMatch(/border-border\/40\b/);
  });
});

describe("R140 (d) — named-tracking no-ops: dead code dies, the working register is arbitrary-form only", () => {
  it("the 2FA secret display drops the dead tracking-wider (wrap risk forbids real tracking on the 32-char base32 run)", () => {
    expect(twofa).not.toContain("tracking-wider");
    expect(twofa).not.toContain("tracking-widest");
    // The OTP field's working arbitrary form stays (the r139 pin, re-frozen).
    expect(twofa).toContain("tracking-[0.2em]");
  });

  it("the WhatsappHeader Latin eyebrow drops the dead tracking-widest (a chrome label, not a code run)", () => {
    expect(whatsappHeader).not.toContain("tracking-widest");
    expect(whatsappHeader).not.toContain("tracking-[");
    // The eyebrow text itself survives byte-identical.
    expect(whatsappHeader).toContain('"text-xs font-bold uppercase">WhatsApp OTP');
  });

  it("the admin login OTP converts to the working tracking-[0.2em] register its 2FA-setup twin rides", () => {
    expect(adminLogin).toContain('className="text-center h-11 tracking-[0.2em] text-lg font-mono"');
    expect(adminLogin).not.toContain("tracking-widest");
  });

  it("the coupon code cell drops the dead tracking-wider (variable-length mono run in a 1fr grid cell)", () => {
    expect(couponsTable).not.toContain("tracking-wider");
    expect(couponsTable).not.toContain("tracking-widest");
    expect(couponsTable).toContain('<div className="font-mono font-bold text-sm text-foreground">');
  });

  it("LANE-WIDE ZERO: no live named tracking utility survives anywhere in src — the guard's own index.css is the only home", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        const s = statSync(p);
        if (s.isDirectory()) {
          if (f !== "__tests__" && f !== "node_modules") walk(p, out);
        } else if (/\.(tsx?|jsx?)$/.test(f)) {
          out.push(p);
        }
      }
      return out;
    };
    for (const file of walk("src")) {
      const src = stripComments(readFileSync(file, "utf8"));
      const hits = src.match(/tracking-(tight|tighter|wide|wider|widest)\b/g);
      expect(`${file}: ${hits?.join(",") ?? "clean"}`).toBe(`${file}: clean`);
    }
  });

  it("lib/analytics.ts stays the ONE real analytics entry (initAnalytics, consumed by main.tsx) — no competing no-op tracker in the lane", () => {
    expect(analytics).toContain("export function initAnalytics(): void");
    expect(mainTs).toContain('import { initAnalytics } from "./lib/analytics";');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        const s = statSync(p);
        if (s.isDirectory()) walk(p, out);
        else if (/\.(tsx?|jsx?)$/.test(f)) out.push(p);
      }
      return out;
    };
    const noOpTracker =
      /\b(function\s+track\b|const\s+track\s*=|namedTrack\b|trackEvent\b|useTrack\b)/;
    for (const dir of ["src/lib", "src/hooks", "src/components/layout"]) {
      for (const file of walk(dir)) {
        const src = stripComments(readFileSync(file, "utf8"));
        expect(`${file}: ${noOpTracker.test(src) ? "tracker!" : "clean"}`).toBe(`${file}: clean`);
      }
    }
  });
});

describe("R140 (e) — referrals error banners: the shared calm-error register, no hand-rolled twins", () => {
  it("STOREFRONT referrals: the shared FetchErrorCard IS the error surface — zero hand-rolled alert/error-wall markup", () => {
    expect(referrals).toContain(
      'import { FetchErrorCard } from "@/components/ui/fetch-error-card";',
    );
    expect(referrals).toContain("<FetchErrorCard");
    expect(referrals).not.toMatch(/role="alert"/);
    expect(referrals).not.toMatch(/status-error/);
  });

  it("ADMIN referrals: the hand-rolled red-wall twin is replaced by the shared StaleListErrorBanner extract", () => {
    expect(adminReferrals).toContain(
      'import { StaleListErrorBanner } from "@/components/admin/orders/StaleListErrorBanner";',
    );
    expect(adminReferrals).toContain(
      "<StaleListErrorBanner message={loadError} onRetry={() => void listQuery.refetch()} />",
    );
    // The retired hand-roll: no red wall, no inline AlertCircle glyph.
    expect(adminReferrals).not.toContain("bg-status-error/10");
    expect(adminReferrals).not.toContain("AlertCircle");
    // The stale-keep semantics survive byte-identical.
    expect(adminReferrals).toContain(
      "listQuery.isError && !isSessionExpiredError(listQuery.error)",
    );
  });

  it("the shared banner's calm-error register is byte-pinned (the register the twin adopted)", () => {
    expect(staleBanner).toContain('role="alert"');
    expect(staleBanner).toContain(
      "p-3 rounded-2xl bg-card border border-border/60 flex items-center gap-3",
    );
    expect(staleBanner).toContain(
      "w-9 h-9 rounded-xl bg-status-error/8 border border-status-error/22 flex items-center justify-center shrink-0",
    );
    expect(staleBanner).toContain("min-w-0 text-sm font-bold text-foreground/80");
    expect(staleBanner).toContain(
      "ms-auto shrink-0 text-xs font-bold text-status-error underline underline-offset-2 hover:opacity-80",
    );
  });
});
