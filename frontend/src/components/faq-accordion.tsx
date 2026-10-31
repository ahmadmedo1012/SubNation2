import { ChevronDown } from "lucide-react";

/** A FAQ {question, answer} pair — the FAQPage JSON-LD twin source. */
export interface FaqAccordionItem {
  question: string;
  answer: string;
}

/**
 * The shared storefront FAQ accordion (R192, T2-3).
 *
 * The category + support twins were extracted verbatim in R137 and then
 * drifted together AGAIN — both carried `ChevronLeft -rotate-90`,
 * violating FINAL_UX_SYSTEM §5.1's own accordion contract ("ChevronDown
 * rotators, never sideways arrows"), while the PDP terms disclosure rode
 * the correct idiom. One component ends the drift class: the chevron
 * contract, the card-frame resting edge (/60), the hairline divider
 * family (/20), WebKit marker suppression, and the summary hover all
 * live HERE now.
 *
 * Presentational only, zero state — the accordion's open state is the
 * browser's native `<details>` semantics (the R137 extraction contract).
 */
export function FaqAccordion({
  items,
  itemClassName,
}: {
  items: readonly FaqAccordionItem[];
  /** Extra per-item classes (e.g. the category lane's float-in stagger). */
  itemClassName?: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <details
          key={i}
          className={`group bg-card border border-border/60 rounded-2xl overflow-hidden [&_summary::-webkit-details-marker]:hidden [&_summary]:list-none ${itemClassName ?? ""}`}
        >
          <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-muted/15 transition-colors select-none">
            <span className="text-sm font-bold flex-1">{item.question}</span>
            {/* R192 (T1-1): the accordion contract restored — ChevronDown
                rotator, group-open:rotate-180; never a sideways arrow. */}
            <ChevronDown
              className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180 shrink-0"
              aria-hidden="true"
            />
          </summary>
          {/* The one storefront hairline family value /20 (r140's
              section-rule scatter closure — both twins now provably on
              it because there is only ONE copy of this line left). */}
          <div className="px-4 pt-1 pb-4 border-t border-border/20 text-sm text-muted-foreground leading-relaxed">
            {item.answer}
          </div>
        </details>
      ))}
    </div>
  );
}
