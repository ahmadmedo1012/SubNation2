import { SUPPORT_FAQ } from "./support-faq";
import { FaqAccordion } from "@/components/faq-accordion";

// R137 (FE decomposition): extracted verbatim from pages/support.tsx —
// the visible FAQ section (the <details> accordion over SUPPORT_FAQ).
// Google's FAQPage parity rule requires every JSON-LD Q&A to also be
// visible on the page; this extract and the page's useSeo
// buildFaqLd(SUPPORT_FAQ) block read the SAME support-faq.ts module —
// one source, two surfaces (pinned by support-faq-copy.test.tsx).
// R192 (T2-3): the accordion markup itself converged onto the shared
// FaqAccordion (the category twin + this one had drifted onto sideways
// chevrons together — the contract now lives in one place).

export function FaqSection() {
  return (
    <section className="mt-10 mb-6">
      <h2 className="text-base font-bold mb-3 flex items-center gap-2 border-r-2 border-primary ps-3">
        الأسئلة الشائعة
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        الأسئلة التي يطرحها المستخدمون قبل أول عملية شراء — اضغط على أي سؤال لرؤية الإجابة.
      </p>
      <FaqAccordion items={SUPPORT_FAQ} />
    </section>
  );
}
