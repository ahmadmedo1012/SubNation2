import type { ProductFaqItem } from "@workspace/api-client-react";

// R135 (FE-3 decomposition): extracted verbatim from pages/product.tsx —
// the curated FAQ accordion (the order-10 block of the buy panel; the
// page passes the already-guarded non-empty `productFaqs` array — the
// empty-list suppression that keeps thin JSON-LD off Google lives with
// the page's SEO block). DOM and classes are byte-identical; the
// native <details> open/close state is browser-owned (no React state —
// deliberately NOT converted to controlled state).
export function FaqAccordion({ faqs }: { faqs: ProductFaqItem[] }) {
  return (
    // R117 (F-3): FAQ moved here from the START column so the
    //   mobile DOM/reading/Tab order matches the visual order
    //   (WCAG 1.3.2 / 2.4.3) — pre-R117 it sat in DOM right after the
    //   features list while visually rendering after this trust
    //   grid, so keyboard users Tabbed from features straight to a
    //   visually distant block and back up. order-10 keeps it in
    //   the same visual slot at <lg; at lg it now closes the buy
    //   panel column under the trust grid. The section's lg:p-5 +
    //   space-y-4 provide desktop spacing; max-lg:mx-5 is the
    //   mobile gutter (R117 F-1 — mx, outside the bordered box).
    <details className="order-10 max-lg:mx-5 rounded-xl border border-border/45 bg-muted/10 overflow-hidden group">
      <summary className="flex items-center justify-between px-4 py-3 text-sm font-bold cursor-pointer select-none hover:bg-muted/20 transition-colors">
        <span>الأسئلة الشائعة</span>
        <span className="text-xs text-muted-foreground">{faqs.length}</span>
      </summary>
      <div className="border-t border-border/30 divide-y divide-border/30">
        {faqs.map((faq, idx) => (
          <details key={idx} className="group/q">
            <summary className="flex items-start gap-2 px-4 py-3 text-sm font-bold text-foreground cursor-pointer select-none hover:bg-muted/15 transition-colors">
              <span className="text-muted-foreground shrink-0">س{idx + 1}.</span>
              <span className="flex-1">{faq.question}</span>
            </summary>
            <div className="px-4 pb-3 pt-1 text-sm text-muted-foreground leading-relaxed">
              {faq.answer}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
