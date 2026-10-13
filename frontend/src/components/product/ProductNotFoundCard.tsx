import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Home, Package } from "lucide-react";
import { Link } from "wouter";

// R137 (closing decomposition): extracted verbatim from pages/product.tsx —
// the 404 card (the !product early return). The page still computes the
// useSeo block (rules-of-hooks) and passes it down as a value; the R128-A2
// not-found recipe (real h1, muted copy, size="lg" Button pair, quick-links
// band) is byte-identical.
export function ProductNotFoundCard({ seoBlock }: { seoBlock: ReactElement }) {
  return (
    <div className="max-w-xl mx-auto px-4 py-20 text-center text-muted-foreground">
      {/* A7-F1 (category.tsx pattern): the not-found SEO block renders
          HERE too — this early return is the only place the 404 branch's
          noindex,follow + self canonical can own the head. Without this
          render the useSeo element never mounts, the App-level fallback
          (index,follow) wins, and the R124 A10-F1 fix is inert. */}
      {seoBlock}
      {/* R128-A2 (F-2): converged on the generic 404's recipe
          (not-found.tsx) — real h1, muted copy, size="lg" Button pair,
          quick links. The retired branch (p.font-bold + a 14px
          underline recovery link) shipped the HIGHER-traffic 404
          (delisted products, dead share links) below the app's own
          404 craft bar: no heading element, a sub-44px recovery CTA. */}
      <div className="max-w-sm mx-auto space-y-8">
        <div>
          <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
            <Package className="w-7 h-7 opacity-40" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-3">المنتج غير موجود</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            يبدو أن هذا المنتج لم يعد متوفراً أو أن الرابط غير صحيح.
          </p>
        </div>
        {/* Actions — the R116-S1 CTA recipe (not-found.tsx): primary
            rides the canonical Button (size lg, w-full sm:w-auto);
            secondary rides the system secondary variant. */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild size="lg" className="w-full sm:w-auto">
            {/* Home IS the catalog (App.tsx routing) — same destination
                the old recovery link carried. */}
            <Link href="/">
              <Home className="w-4 h-4" />
              العودة للكتالوج
            </Link>
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => window.history.back()}
            className="w-full sm:w-auto"
          >
            {/* RTL: "back" points right (not-found.tsx idiom) */}
            <ArrowRight className="w-4 h-4" />
            رجوع
          </Button>
        </div>
        {/* Quick links — the not-found.tsx band (min-h-11 chips). */}
        <div className="pt-2 border-t border-border/40">
          <p className="text-2xs font-bold text-muted-foreground mb-3">روابط سريعة</p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { href: "/", label: "المتجر" },
              { href: "/wallet", label: "المحفظة" },
              { href: "/orders", label: "طلباتي" },
              { href: "/support", label: "الدعم" },
            ].map((l) => (
              <Link key={l.href} href={l.href}>
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
