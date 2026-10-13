import { PhoneCall } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { transferCode, transferCodeTelHref, type TransferNetwork } from "@/lib/transfer-code";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the mobile-transfer flow's instructions legend + the live USSD
// transfer-code panel. Stateless (network/amount/receiver flow down as
// values; the code recomputes on every render exactly as it did inline).
// The move only changes its address — DOM, classes, aria and the tel:
// link semantics are byte-identical.

/**
 * Step-by-step explanation of the mobile transfer flow. Concise on
 * purpose — three lines that match the actions the user actually takes.
 */
export function InstructionsPanel() {
  const steps = [
    "قم بتحويل الرصيد باستخدام الزر.",
    "بعد نجاح التحويل قم بإرسال الطلب.",
    "سيتم مراجعته من الإدارة.",
  ];
  return (
    <ol className="mt-3 mb-4 bg-muted/60 border border-border/40 rounded-xl p-3.5 space-y-2 text-xs leading-relaxed">
      {/* R139 (precision): the instructions legend joins the calm well
          family (bg-muted/60 + /40 edge — the same register the LyPay
          bank-coordinates panel rides; the old /25 + /45 inset was the
          pre-r138 value). */}
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="shrink-0 w-5 h-5 rounded-full bg-primary/15 border border-primary/30 text-primary-text text-3xs font-bold flex items-center justify-center">
            {i + 1}
          </span>
          <span className="text-foreground/85 pt-0.5">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Live, dynamically-generated USSD transfer code + one-tap action.
 *
 * The code recomputes on every amount/network change — no debounce,
 * no submit needed. The "تحويل الرصيد" button uses a `tel:` URL with
 * the code embedded; mobile dialers honour this for both Libyana and
 * Madar. On non-mobile environments the link still navigates to the
 * tel: URL — most desktops fall back gracefully (system handler or
 * "no app available"), and we additionally expose a copy button so
 * the user can never get stuck.
 */
export function TransferCodePanel({
  network,
  amount,
  receiver,
}: {
  network: TransferNetwork;
  amount: string;
  receiver: string;
}) {
  const code = transferCode(network, amount, receiver);
  const href = code ? transferCodeTelHref(code) : null;
  const buttonClasses =
    "flex items-center justify-center gap-2 w-full h-11 rounded-xl font-bold text-sm transition-all press-spring";

  return (
    /* R139 (precision): the transfer-code panel drops its brand-tinted
       shell (border-primary/25 + bg-primary/5 — the pre-r138 idiom
       139-f/i retired on VariantFormPanel and the whatsapp pair
       panel) for the resting /60 edge + the muted/15 wash; the panel's
       identity rides the primary-text header + the canonical CTA. The
       USSD code box joins the WELL register (bg-muted/60 + /40 — the
       money-critical stage the user dials/copies, the QR-stage twin). */
    <div className="mt-3 rounded-xl border border-border/60 bg-muted/15 p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-primary-text">
          <PhoneCall className="w-3.5 h-3.5" />
          {/* R111-F2 N3: «رمز» family (رمز الكوبون، رمز التحقق) — was
              «كود التحويل». */}
          رمز التحويل
        </div>
        {/* R116-S2 (P2, money path): the shared 44px CopyButton replaces
            the local pill — the transfer CODE is what the user must dial,
            so the copy affordance is the money-critical control here. */}
        {code && <CopyButton text={code} />}
      </div>

      {/* 96-F6 (R96 A6 #19): the empty-state hint is Arabic — it used to
          sit INSIDE the dir="ltr" text-left font-mono box (left-aligned
          Arabic in an LTR-declared element, announced to screen readers
          with LTR context). The hint now renders as its own RTL element
          outside the LTR box; one persistent aria-live wrapper keeps the
          live region mounted across the swap so the generated code is
          still announced. */}
      <div aria-live="polite" className="mb-3">
        {code ? (
          <div
            dir="ltr"
            /* R122 (A1 P2-4): tracking-wide was a silent no-op — the global
               Arabic letter-spacing guard (index.css:917) zeroes the five
               tracking utilities app-wide, so this LTR mono code rendered
               with 0 spacing while the same class of datum on /referrals
               had 0.2em. The arbitrary tracking-[0.2em] form carries the
               intended spacing for Latin-only runs; the guard's
               letter-join protection stays intact for Arabic. */
            className="font-mono font-bold text-base sm:text-lg tracking-[0.2em] rounded-lg bg-muted/60 border border-border/40 px-3 py-2.5 break-all min-h-[44px] flex items-center text-foreground"
          >
            {code}
          </div>
        ) : (
          <div className="rounded-lg bg-muted/60 border border-border/40 px-3 py-2.5 min-h-[44px] flex items-center text-muted-foreground/80 text-sm">
            أدخل المبلغ لإنشاء الرمز تلقائياً
          </div>
        )}
      </div>

      {/* Disclaimer ABOVE the button — desktop users who tap the
          tel: link and don't get a dialer were hitting a dead state
          before noticing the "copy and dial manually" hint underneath.
          Surfacing it above the action sets the right expectation up
          front: tap is the fast path, copy is the universal fallback. */}
      <p className="text-2xs text-muted-foreground mb-2 leading-relaxed">
        على الجوال: اضغط الزر لفتح لوحة الاتصال. على الحاسوب: انسخ الرمز وأدخله يدوياً.
      </p>

      {href ? (
        <a
          href={href}
          /* R139 (precision): the one-tap dial CTA drops the retired
             hand-rolled stack (hover:bg-primary/90 + shadow-md
             shadow-primary/25 — the named r138 retirements) and the raw
             text-white for the AA ink token; the flat primary fill +
             press-spring + h-11 floor stay (an <a> can't ride Button,
             the tel: semantics are the payload). */
          className={`${buttonClasses} bg-primary text-primary-foreground`}
        >
          <PhoneCall className="w-4 h-4" />
          تحويل الرصيد
        </a>
      ) : (
        <button
          type="button"
          disabled
          className={`${buttonClasses} bg-muted/40 text-muted-foreground/60 cursor-not-allowed`}
        >
          <PhoneCall className="w-4 h-4" />
          تحويل الرصيد
        </button>
      )}
    </div>
  );
}
