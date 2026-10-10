import { Link, useLocation } from "wouter";
import { CATEGORY_META } from "@/lib/categories";
import { Logo } from "./Logo";

export function Footer() {
  const [location] = useLocation();
  const isAuth = location === "/login" || location === "/register";
  if (isAuth) return null;

  // R120-B7 (reviewer finding): the former guest /product/* exception
  // is gone — the guest MobileNav renders on product pages now (the
  // sticky buy bar pins above it), so the footer reserves the nav
  // clearance on EVERY storefront route for guests AND authed users
  // alike. One clearance contract, no per-route carve-outs.
  return (
    <footer
      className={`relative border-t border-border/30 bg-gradient-to-b from-background via-background to-card/40 mt-12 ${
        /* Reserve the fixed MobileNav's height BELOW the legal row
           (mobile-nav-footer-pad = padding, defined at max-width 767.98px
           so desktop is untouched — no md: reset needed). Applied for
           guests too (R120-B1 / A3-F1 — the MobileNav renders for
           guests; main's mobile-nav-safe-pad in App.tsx is still
           auth-gated, so this padding is the guest clearance). Replaces
           the old mb-[calc(60px+env)] double reservation: main's
           mobile-nav-safe-pad already reserves the nav + breathing unit
           for page content, so this is the only clearance the footer
           itself needs — and as padding it can never collapse through
           #root (B6-P1-7). */
        "mobile-nav-footer-pad"
      }`}
    >
      {/* Hairline brand tint at the top — barely visible but unifies
          the footer with the FlashSaleBanner / Navbar treatment. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />

      <div className="max-w-6xl mx-auto px-4">
        {/* ── Compact link band (R120-B1 / A1-F13 + A7-F10) ─────────────
            ONE band above the legal row: the 7 live category links +
            العروض (internal linking — every category page gets a
            storefront-level inbound link) and the support cluster.
            Slugs/labels come READ-ONLY from lib/categories.ts (single
            source of truth); ≤2 compact rows on mobile, side-by-side
            from sm. Same hairline divider language as the legal row.
            R124-A4 #2 + A5 #10 (WCAG 2.5.8 + 1.4.1): every list link is
            an inline-flex min-h-6 (24px) target and carries the repo's
            underline-offset idiom (checkout error links) — the links
            were ~14px targets distinguishable from body copy by color
            alone. */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-x-10 gap-y-3.5 pt-5 pb-4 sm:pt-6 sm:pb-5 border-b border-border/20">
          <nav aria-label="الفئات" className="min-w-0">
            {/* R128-IMP-4 (A13-F9 / B1 item 9): h3 → h2 — on short pages
                (/flash-sales, /cart) the footer is the only content after
                the h1, so its column titles produced a 1→3 heading skip
                (h1 → h3). The site has no h2 between the page h1 and the
                footer on those pages; tailwind's preflight + the explicit
                text-3xs/font-bold classes below own the look either way. */}
            <h2 className="text-3xs font-bold text-muted-foreground mb-1.5">الفئات</h2>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {Object.values(CATEGORY_META).map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/category/${c.slug}`}
                    className="inline-flex min-h-6 items-center text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    {c.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/flash-sales"
                  className="inline-flex min-h-6 items-center text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  العروض
                </Link>
              </li>
            </ul>
          </nav>
          <nav aria-label="المساعدة والدعم" className="min-w-0">
            {/* R128-IMP-4 (A13-F9): h3 → h2 — same heading-skip fix as the
                categories column above (site-wide footer contract). */}
            <h2 className="text-3xs font-bold text-muted-foreground mb-1.5">المساعدة والدعم</h2>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              <li>
                <Link
                  href="/support"
                  className="inline-flex min-h-6 items-center text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  الدعم الفني
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="inline-flex min-h-6 items-center text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  الشروط والأحكام
                </Link>
              </li>
              <li>
                <Link
                  href="/status"
                  className="inline-flex min-h-6 items-center text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  حالة الخدمة
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="py-5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          {/* Left: logo + copyright */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Logo size="sm" />
            <span className="font-semibold text-center sm:text-right opacity-85">
              © {new Date().getFullYear()} — سوق الاشتراكات الرقمية في ليبيا
            </span>
          </div>

          {/* Right: legal + support */}
          {/* 96-F5 (R96-M15): flex-wrap + tighter gap below sm — the three
              links + two separators measured ≈271px against 288px available
              at 320px, so any wider glyph run (font fallback, longer labels)
              clipped the last link under the global overflow-x: clip. Wrapping
              guarantees the row degrades gracefully instead of clipping.
              R124-A4 #2 + A5 #10: links ride min-h-6 (24px AA floor) + the
              underline idiom — they matched the copyright text's color with
              no second cue. */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
            <Link href="/terms#terms" className="inline-flex min-h-6 items-center">
              <span className="underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer">
                الشروط والأحكام
              </span>
            </Link>
            <span className="w-px h-3 bg-border/50" />
            {/* Hash-based deep-link to the privacy tab. TermsPage reads
                `window.location.hash` on mount + on hashchange and switches
                the active tab. Replaces a previous setTimeout + DOM-query
                hack that silently broke when terms hadn't finished mounting. */}
            <Link href="/terms#privacy" className="inline-flex min-h-6 items-center">
              <span className="underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer">
                سياسة الخصوصية
              </span>
            </Link>
            <span className="w-px h-3 bg-border/50" />
            <Link href="/support" className="inline-flex min-h-6 items-center">
              <span className="underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer">
                الدعم
              </span>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
