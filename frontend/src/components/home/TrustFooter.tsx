import { Headphones, ShieldCheck, Truck } from "lucide-react";

// R136 (FE-3 decomposition): extracted verbatim from pages/home.tsx —
// the closing trust strip (three honest claims, one inline row, zero
// card chrome — the R125-I7 A7 B-12 craft-floor conversion). Zero
// props, zero state: the claims are page copy, not data. The page keeps
// the !isLoading && products.length > 0 gate that mounts it. The three
// Arabic trust strings are byte-identical (a parent-pre-pitched r125
// surface-union pin follows them across the move).

// R120-B1 (A3-F12): tighter post-grid spacing below sm — the ~405px of
// dead space between the last card and the footer was mostly this
// block's mt-10/pt-8 + the stacked trust cards' own padding. ≥sm keeps
// the original rhythm.
// R125-I7 (A7 B-12 / R124-A3 #14): the closing 3-up grid of
// icon+title+description tiles was the craft-floor REFUSE template
// ("same-size cards of icon plus heading plus text") — now one inline
// strip (icon + short claim per item), same three promises, same status
// tones, zero card chrome. The TrustCard component is left with zero
// consumers — deleting it is a follow-up outside this page's file list.
export function TrustFooter() {
  return (
    // ── Trust footer ──
    <div className="mt-6 pt-5 sm:mt-10 sm:pt-8 border-t border-border/25">
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5 text-status-warning shrink-0" aria-hidden="true" />
          تسليم فوري بعد الدفع — وبحد أقصى 24 ساعة
        </li>
        <li className="inline-flex items-center gap-1.5">
          <ShieldCheck
            className="w-3.5 h-3.5 text-status-success shrink-0"
            aria-hidden="true"
          />
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
