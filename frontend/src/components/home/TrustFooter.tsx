import { Reveal } from "@/lib/motion-primitives";
import { CreditCard, Headphones, PackageCheck, ShieldCheck, Wallet } from "lucide-react";

// R145 (visual transformation): the close. The r125 trust strip (three
// honest claims, one line) was kept through r138-r144 but as the page's
// LAST surface it trailed off — the Scroll-Craft feel.md verdict: "an
// ending that fades into a footer overwrites everything the peak did.
// Resolution means the page arrives somewhere and stops."
//
// The close now RESOLVES in two beats:
//   1. HOW IT WORKS — the purchase journey as a numbered flow (choose
//      → top up wallet in LYD → instant delivery after payment). Every
//      step is an existing, verifiable behavior: the catalog (real),
//      the wallet top-up flow with مدار/ليبيانا (the category.tsx copy
//      documents it), the post-payment instant delivery with the ≤24h
//      ceiling (the trust strip's own claim). NO invented numbers, no
//      fabricated counts — the flow states mechanics, not statistics.
//   2. THE TRUST LINE — the r125 strip, byte-identical claims, now the
//      page's final grounded beat instead of an afterthought.
//
// Layout: the flow is ONE ordered horizontal sequence on wide screens
// (ol → li with numbered markers, NOT equal icon+heading+text cards —
// the taste-floor ban), stacked vertically on mobile. More space above
// the section than between its own parts (the boundary rule).
//
// Motion: the section rides one Reveal (once) — the close arrives, it
// does not perform.

// The three steps' icons — lucide, stroke 2, the RTL direction
// contract (all direction-neutral glyphs; the numbers carry sequence).
const STEPS = [
  {
    n: "1",
    Icon: PackageCheck,
    title: "اختر اشتراكك",
    body: "تصفّح الفئات واختر المنتج والباقة المناسبة لك",
  },
  {
    n: "2",
    Icon: Wallet,
    title: "اشحن محفظتك بالدينار",
    body: "الدفع محلياً بالدينار الليبي عبر مدار أو ليبيانا",
  },
  {
    n: "3",
    Icon: CreditCard,
    title: "استلم فوراً بعد الدفع",
    body: "تفاصيل اشتراكك تصلك في حسابك — وبحد أقصى 24 ساعة",
  },
] as const;

export function TrustFooter() {
  return (
    // R140 central: the section rule joins the ONE hairline family
    // (/20, receipt-grade) — kept. The boundary gap ABOVE the section
    // (mt-8/mt-14) is deliberately larger than any internal gap: the
    // close is its own beat, not the grid's tail.
    <div className="mt-8 pt-6 sm:mt-14 sm:pt-8 border-t border-border/20">
      <Reveal>
        <h2 className="text-lg sm:text-xl font-bold text-foreground mb-1.5">
          كيف تشتري من SubNation؟
        </h2>
        <p className="text-xs text-muted-foreground mb-5 sm:mb-6">
          ثلاث خطوات فقط بينك وبين اشتراكك
        </p>

        {/* The flow — one ordered list (semantics: it IS a sequence),
            horizontal ≥sm with hairline connectors, stacked below sm.
            Step markers use Western digits — the app-wide number
            convention (FINAL_UX_SYSTEM §5), tabular-nums for the
            sequence glyphs. */}
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-7 sm:mb-9">
          {STEPS.map((s) => (
            <li key={s.n} className="flex items-start gap-3.5">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <s.Icon className="w-5 h-5 text-primary-text" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm text-foreground flex items-center gap-1.5">
                  <span className="text-primary-text tabular-nums">{s.n}</span>
                  {s.title}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Reveal>

      {/* The trust line — the r125 strip, byte-identical claims, the
          page's final beat. */}
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground border-t border-border/20 pt-5">
        <li className="inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-status-success shrink-0" aria-hidden="true" />
          دفع آمن — محفظتك محمية وعملياتك موثّقة
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Headphones className="w-3.5 h-3.5 text-status-info shrink-0" aria-hidden="true" />
          دعم محلي — يرد عادةً خلال 15 دقيقة إلى ساعة
        </li>
      </ul>
    </div>
  );
}
