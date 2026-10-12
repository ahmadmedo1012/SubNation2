import { ChevronLeft } from "lucide-react";
import { SUPPORT_FAQ } from "./support-faq";

// R137 (FE decomposition): extracted verbatim from pages/support.tsx —
// the visible FAQ section (the <details> accordion over SUPPORT_FAQ).
// Google's FAQPage parity rule requires every JSON-LD Q&A to also be
// visible on the page; this extract and the page's useSeo
// buildFaqLd(SUPPORT_FAQ) block read the SAME support-faq.ts module —
// one source, two surfaces (pinned by support-faq-copy.test.tsx).
// Presentational only: zero props, zero state — the accordion's open
// state is the browser's native <details> semantics, untouched.

export function FaqSection() {
  return (
    <section className="mt-10 mb-6">
      <h2 className="text-base font-bold mb-3 flex items-center gap-2 border-r-2 border-primary pr-3">
        الأسئلة الشائعة
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        الأسئلة التي يطرحها المستخدمون قبل أول عملية شراء — اضغط على أي سؤال لرؤية الإجابة.
      </p>
      <div className="space-y-2">
        {SUPPORT_FAQ.map((item, i) => (
          <details
            key={i}
            className="group bg-card border border-border/55 rounded-2xl overflow-hidden [&_summary::-webkit-details-marker]:hidden [&_summary]:list-none"
          >
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-muted/15 transition-colors select-none">
              <span className="text-sm font-bold flex-1">{item.question}</span>
              <ChevronLeft className="w-4 h-4 text-muted-foreground transition-transform group-open:-rotate-90 shrink-0" />
            </summary>
            <div className="px-4 pt-1 pb-4 border-t border-border/40 text-sm text-muted-foreground leading-relaxed">
              {item.answer}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
