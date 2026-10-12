import { HeroStatsColumn } from "@/components/home/StatsWidgets";
import { buttonVariants } from "@/components/ui/button";
import { useOnScreen } from "@/hooks/use-on-screen";
import { cn } from "@/lib/utils";
import type { HeroBrand } from "@/components/home/catalog-filters";
import type { CatalogStats } from "@workspace/api-client-react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the guest editorial SEO hero (h1 + prose + brand chips + CTAs + the
// desktop stats column). Self-contained by design: the 96-F5 blob-pause
// observer and the R120-B1 heroProseOpen fold toggle moved INSIDE with
// their markup (the page only mounts this component in the guest branch,
// so mounting IS the observer's enable flag — the bespoke effect was
// swapped for the shared useOnScreen hook, the R115-A10 extraction of
// this exact technique; same observer, same 64px margin, same cleanup).
// heroBrands/categoryHasStock/stats/statsPending arrive as props — the
// page owns the queries and the memos. DOM, classes and aria are
// byte-identical.

export function GuestHero({
  heroBrands,
  categoryHasStock,
  stats,
  statsPending,
}: {
  heroBrands: HeroBrand[];
  categoryHasStock: Set<string> | null;
  stats: CatalogStats | undefined;
  statsPending: boolean;
}) {
  // 96-F5 (R96 F-4b): pause the guest hero's animated blur-3xl blobs when
  // the hero scrolls off-screen — two 9s/13s infinite animations with
  // will-change:transform kept rasterizing big blurred layers on the
  // most-visited page long after anyone could see them. IntersectionObserver
  // toggles animation-play-state via inline style (className/JS-level only;
  // the keyframes live in index.css which is owned by another agent).
  const { ref: guestHeroRef, onScreen: heroOnScreen } = useOnScreen<HTMLDivElement>();
  // R120-B1 (A1-F3/A3-F2): mobile fold — the guest hero's 460-char SEO
  // paragraph collapses to 2 lines below sm with this expand toggle
  // (the FULL text stays in the DOM for crawlers; ≥sm is untouched).
  const [heroProseOpen, setHeroProseOpen] = useState(false);

  return (
    // Guest: editorial hero — R120-B1 (A1-F3/A3-F2): the <sm fold
    // budget was ~915px at 390px (first card fully below fold);
    // the mobile-only tightening below (padding, 2-line prose,
    // compact stats strip, tighter section gaps) buys back
    // ~230px. ≥sm (and the desktop hero) are untouched.
    <div
      ref={guestHeroRef}
      /* R125-I7 (A7 B-12 / R124-A3 #11): rounded-3xl (24px) is over
         the craft-floor's 12–16px card-radius band — the guest hero
         now matches the authed hero + every catalog card (16px). */
      className="relative overflow-hidden rounded-2xl border border-border/40 mb-4 sm:mb-6 bg-card page-in shadow-xl"
    >
      {/* Background layers */}
      <div className="absolute inset-0 dot-grid pointer-events-none opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-l from-primary/10 via-transparent to-transparent pointer-events-none" />
      {/* R125-I7 (A7 B-12 / R124-A3 #12): w-[2.5px] → 1px (same
          craft-floor stripe cap as the authed hero above). */}
      <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-primary/80 via-primary/30 to-transparent" />

      {/* Ambient glow blobs — 96-F5 (R96 F-4b): animation-play-state
          flips to paused when the hero leaves the viewport (IO above);
          prefers-reduced-motion keeps winning via the global kill-switch. */}
      <div
        className="absolute top-[-50px] right-[8%] w-72 h-72 bg-primary/8 rounded-full blur-3xl pointer-events-none blob-drift"
        style={{ animationPlayState: heroOnScreen ? "running" : "paused" }}
      />
      <div
        className="absolute bottom-[-40px] left-[15%] w-56 h-56 bg-primary/5 rounded-full blur-3xl pointer-events-none blob-drift-slow"
        style={{ animationPlayState: heroOnScreen ? "running" : "paused" }}
      />

      <div className="relative px-4 py-5 sm:px-9 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex-1 min-w-0">
            {/* R125-I7 (A7 B-12 / R124-A3 #13): the eyebrow row above
                the h1 — the «ليبيا #1» pill + a tagline that
                duplicated the h1's first line word-for-word — is
                deleted (the craft-floor ban on kickers/eyebrows
                over headings: "let the h1 speak"). The h1 and the
                SEO prose below carry the same claims honestly. */}
            <h1 className="text-fluid-3xl font-bold mb-2.5 sm:mb-3">
              {/*
                Single contiguous phrase for Google's NLU. Visual
                two-line split is achieved with `block` + a styled
                span — NOT a literal <br>, which used to fragment
                the heading text node and weaken keyword strength.
                The locale word "في ليبيا" stays attached to the
                keyword phrase and shifts to its own line on
                narrow viewports.
                R120-B1 (A7-F12): a real {" "} text node sits
                between the two block spans — two adjacent block
                spans fused textContent into «الرقميةفي ليبيا» —
                the whitespace node is not rendered between block
                boxes but IS in the DOM text, so crawlers and SRs
                read the phrase with its space. */}
              <span className="block">سوق الاشتراكات الرقمية</span>{" "}
              {/* R124 (A3-F7): the accent line rode the banned
                  gradient-type utility — solid --primary-text
                  (weight/size already carry the hierarchy) keeps
                  the two-line brand rhythm AA-safe in both themes. */}
              <span className="block text-primary-text">في ليبيا</span>
            </h1>
            <p
              className={`text-muted-foreground text-sm leading-relaxed max-w-md mb-1.5 sm:mb-4 ${
                heroProseOpen ? "" : "line-clamp-2"
              } sm:line-clamp-none`}
            >
              {/*
                Editorial intro — the only on-page Arabic prose
                that gives Google a topic-vector beyond the title.
                Every target keyword appears EXACTLY ONCE: سوق،
                اشتراكات، البث المباشر، نتفلكس، ديزني+، شاهد،
                سبوتيفاي، ويندوز، VPN، الذكاء الاصطناعي،
                شات جي بي تي، الدينار الليبي، تسليم فوري.
                R120-B1 (A7-F5): the examples now mirror the LIVE
                catalog only (PlayStation Plus / Adobe / Microsoft
                365 categories were archived 2026-09-19 — Windows,
                VPNs and AI tools are what actually sells). The
                paragraph visually collapses to 2 lines below sm
                (R120-B1 / A1-F3) but the FULL text stays in the
                DOM — the toggle below re-reveals it.
              */}
              <strong lang="en" className="font-bold text-foreground">
                SubNation
              </strong>{" "}
              سوق إلكتروني متخصّص في بيع الاشتراكات الرقمية للسوق الليبي. تجد على المنصّة
              اشتراكات البثّ المباشر مثل نتفلكس وديزني+ وشاهد، وخدمات الموسيقى مثل سبوتيفاي،
              ومفاتيح البرامج مثل ويندوز، وشبكات VPN مثل إكسبرس، وأدوات الذكاء الاصطناعي مثل
              شات جي بي تي — كلّها بالدينار الليبي مع تسليم فوري بعد الدفع.
            </p>
            {/* R120-B1 (A1-F3): expand toggle for the collapsed prose
                (mobile only — ≥sm shows the full paragraph).
                R123-E4b (P3, live-measured 77×19): the text-2xs
                inline toggle was the site's only sub-24px button —
                full-width + the min-h-11 floor now. */}
            <button
              type="button"
              onClick={() => setHeroProseOpen((v) => !v)}
              aria-expanded={heroProseOpen}
              className="sm:hidden w-full min-h-11 inline-flex items-center justify-center gap-1 text-2xs font-bold text-primary-text hover:text-primary-text/80 transition-colors press-spring mb-3 sm:mb-0"
            >
              {heroProseOpen ? "عرض أقل" : "عرض المزيد"}
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-200 ${
                  heroProseOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            {/* Brand chips — already a single scrollable row
                (overflow-x-auto + scrollbar-none); mb-4 below sm
                (R120-B1 / A1-F3 fold budget).
                R122 (A11-F1): each chip is now a Link to its
                category's landing page (category.tsx sibling-chip
                idiom) — they were sr-only spans, so the hero
                advertised brands shoppers could not tap. The chips
                ride the app's min-h-11 tap-target floor now that
                they are interactive, and in-stock categories lead
                the row with a success dot (A11 P0-adjacent: with
                the live catalog 98% sold out, the hero must
                surface what is actually buyable — the data is the
                already-loaded products array, presentation only). */}
            <div className="relative overflow-hidden mb-4 sm:mb-5">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 scroll-fade-rtl-start">
                {heroBrands.map((brand, i) => {
                  const inStock = categoryHasStock?.has(brand.cat) ?? false;
                  return (
                    <Link
                      key={brand.latin}
                      href={`/category/${brand.cat}`}
                      aria-label={inStock ? `${brand.ar} — متوفر الآن` : brand.ar}
                      className={`shrink-0 inline-flex items-center gap-1.5 min-h-11 px-3 text-2xs font-bold rounded-full whitespace-nowrap transition-all duration-150 press-spring float-in stagger-${Math.min(i + 1, 8)} ${
                        inStock
                          ? "bg-status-success/8 border border-status-success/30 text-foreground hover:border-status-success/55"
                          : "bg-muted/40 border border-border/40 text-muted-foreground hover:border-border/70 hover:text-foreground"
                      }`}
                    >
                      {/* 96-F5 (R96 A6 #16): lang="en" on the Latin label
                          so screen readers stop spelling brand names with
                          Arabic phonemes («نِتفليكس»); the Arabic sr-only
                          transliteration below already carries the SEO
                          weight. */}
                      <span aria-hidden="true" lang="en">
                        {brand.latin}
                      </span>
                      {/* Visually hidden Arabic transliteration so the
                          crawler indexes "نتفلكس", "ويندوز 10", etc.
                          alongside the Latin form. .sr-only is the
                          standard a11y utility. */}
                      <span className="sr-only">{brand.ar}</span>
                      {inStock && (
                        /* Decorative availability dot — the chip's
                           accessible name (aria-label above) carries
                           the «متوفر الآن» signal for ATs. */
                        <span
                          aria-hidden="true"
                          className="w-1.5 h-1.5 rounded-full bg-status-success shrink-0"
                        />
                      )}
                    </Link>
                  );
                })}
                <span className="shrink-0 text-2xs text-muted-foreground px-1 whitespace-nowrap">
                  وأكثر…
                </span>
              </div>
            </div>

            {/* CTAs — mobile: stacked with primary dominant; desktop: inline.
                R116-S1 CTA recipe: size="lg" + w-full sm:w-auto — the
                per-page bg/shadow/height/press overrides and the pulsing
                cta-glow halo are gone; the gradient variant + global
                press-spring carry the affordance.
                R120-B1 (A4-F1): the Links wear buttonVariants directly
                (cn-merged so arbitrary overrides win) instead of nesting
                a <Button> inside a <Link> — invalid interactive nesting
                + a doubled tab stop per CTA. One CTA = one tab stop;
                identical visuals (the svg size pin keeps the arrow at
                14px like the old w-3.5 h-3.5). */}
            <div className="flex flex-col sm:flex-row gap-2.5 sm:flex-wrap">
              <Link
                href="/register"
                className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
              >
                إنشاء حساب مجاني
              </Link>
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "lg" }),
                  "w-full sm:w-auto gap-1.5 text-muted-foreground [&_svg]:size-3.5",
                )}
              >
                لدي حساب — سجّل دخولك
                <ArrowLeft className="opacity-40" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* Stats column — desktop only — R111-F1 G2 (P3):
              chip-shaped skeletons while the first fetch is pending
              (no pop-in CLS); an error hides the column (decorative
              data — documented deliberate degrade, see the query). */}
          <HeroStatsColumn stats={stats} statsPending={statsPending} />
        </div>
      </div>
    </div>
  );
}
