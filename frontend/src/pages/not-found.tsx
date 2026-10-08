import { Link } from "wouter";
import { Home, ArrowRight, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSeo } from "@/hooks/useSeo";

export default function NotFound() {
  // Soft-404 mitigation. The SPA fallback returns HTTP 200 for all
  // unmatched routes (we cannot easily emit a real 404 without SSR), so
  // we rely on robots="noindex,follow" to keep these out of the index.
  // `follow` lets crawlers walk the in-page links back to legitimate
  // surfaces. We also set a canonical here so Search Console doesn't
  // file phantom paths against the homepage's canonical.
  const seoBlock = useSeo({
    title: "الصفحة غير موجودة — SubNation",
    description: "الرابط الذي تحاول الوصول إليه غير موجود.",
    path: "/404",
    locale: "ar",
    robots: "noindex,follow",
  });

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex flex-col items-center justify-center px-4 text-center">
      {seoBlock}
      <div className="space-y-8 max-w-sm w-full">
        {/* Illustration */}
        <div className="relative mx-auto w-40 h-40 flex items-center justify-center select-none">
          <div className="absolute inset-0 rounded-full bg-primary/4 border border-primary/8 animate-pulse" />
          <div className="absolute inset-4 rounded-full bg-primary/6 border border-primary/12" />
          <div className="relative flex flex-col items-center">
            <Compass className="w-10 h-10 text-primary/40 mb-1" />
            {/* R111-F2 C1: Latin digits — the site-wide numeral convention
                (utils.ts -u-nu-latn pins, Arabic-Indic input conversion).
                Was the only shipped Arabic-Indic string in frontend/src. */}
            {/* tracking-tighter removed (R116-S1): the global Arabic
                letter-spacing guard pins every tracking utility to 0 —
                the class was dead weight. */}
            <span className="text-4xl font-bold text-primary/25">404</span>
          </div>
        </div>

        {/* Text */}
        <div>
          <h1 className="text-2xl font-bold mb-3">الصفحة غير موجودة</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            يبدو أن هذه الصفحة لا وجود لها أو ربما تم نقلها.
            <br />
            تأكد من الرابط أو عد إلى الرئيسية.
          </p>
        </div>

        {/* Actions — R116-S1 CTA recipe: primary rides the canonical
            Button (size lg, w-full sm:w-auto); secondary rides the
            system secondary variant. */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/">
              <Home className="w-4 h-4" />
              العودة للرئيسية
            </Link>
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => window.history.back()}
            className="w-full sm:w-auto"
          >
            {/* RTL: "back" points right (unified icon-direction decision) */}
            <ArrowRight className="w-4 h-4" />
            {/* 93-C8 (A11 §2): unified back-navigation verb «رجوع». */}
            رجوع
          </Button>
        </div>

        {/* Quick links */}
        <div className="pt-2 border-t border-border/40">
          {/* 93-C8 (A11 §8): no letter-spacing/uppercase on Arabic. */}
          <p className="text-2xs font-bold text-muted-foreground mb-3">روابط سريعة</p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { href: "/", label: "المتجر" },
              { href: "/wallet", label: "المحفظة" },
              { href: "/orders", label: "طلباتي" },
              { href: "/support", label: "الدعم" },
            ].map((l) => (
              <Link key={l.href} href={l.href}>
                {/* R123-E4b (P3-f): inline-flex + min-h-11 — the old
                    px-3 py-1.5 chip measured ≈30px, well under the 44px
                    touch floor (WCAG 2.5.8 / the app's min-h-11 idiom). */}
                <span className="inline-flex items-center min-h-11 text-xs text-muted-foreground hover:text-foreground px-3 rounded-lg border border-border/50 hover:border-border bg-secondary/30 hover:bg-secondary/60 transition-all cursor-pointer">
                  {l.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
