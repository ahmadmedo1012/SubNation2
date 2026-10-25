import { AlertCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChangeEvent, FocusEvent, FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";
import { Input } from "@/components/ui/input";
import { PaymentReferenceField } from "@/components/wallet/PaymentReferenceField";
import { InfoRow, LYPAY_INFO, StepDot } from "@/components/wallet/topup-meta";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the LyPay bank-transfer topup flow (account coordinates → amount +
// optional receipt → sender account → submit). As with the mobile
// transfer twin, EVERY input's onChange/onBlur calls a PAGE-OWNED
// handler passed down as a prop — never a raw setter: the 96-F6/98-F2
// Idempotency-Key rotation rides those handlers. handleSubmit +
// topupMutation stay in the page. The move only changes its address;
// DOM, classes, aria and event semantics are byte-identical.

export function LyPayFlow({
  amount,
  presets,
  paymentReference,
  senderAccount,
  error,
  submitting,
  mutationPending,
  onSubmit,
  onAmountChange,
  onAmountPreset,
  onAmountBlur,
  onReferenceChange,
  onSenderAccountChange,
}: {
  amount: string;
  presets: number[];
  paymentReference: string;
  senderAccount: string;
  error: string;
  submitting: boolean;
  mutationPending: boolean;
  onSubmit: (e: FormEvent) => void;
  onAmountChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onAmountPreset: (p: number) => void;
  onAmountBlur: (e: FocusEvent<HTMLInputElement>) => void;
  onReferenceChange: (v: string) => void;
  onSenderAccountChange: (v: string) => void;
}) {
  // R-140-j (keyboard/focus — the LyPay twin): focus retention across
  // the submit flight, byte-consistent with MobileTransferForm's effect
  // (140-j's flag): the bank flow's CTA disabled on flight drops focus to
  // <body>; a failed POST left the keyboard user at the page top while
  // the persistent #wallet-error-2 banner mounted announced. The effect
  // re-lands focus on the re-enabled trigger when the flight clears with
  // an error mounted — immediate Enter retries (the 96-F6 idempotency
  // key makes the replay safe). Validation errors never arm the flag;
  // the SUCCESS path hands focus to the waiting modal (page-owned
  // restore covers this tab too).
  const submitRef = useRef<HTMLButtonElement>(null);
  const flightRef = useRef(false);
  useEffect(() => {
    if (submitting || mutationPending) {
      flightRef.current = true;
      return;
    }
    if (!flightRef.current) return;
    flightRef.current = false;
    if (error) submitRef.current?.focus();
  }, [submitting, mutationPending, error]);

  return (
    <div className="space-y-5">
      {/* Step 1: Bank info */}
      <div>
        <StepDot n={1} label="معلومات الحساب المصرفي" />
        {/* R139 (precision): the bank-coordinates panel joins the calm
            well family — bg-muted/60 + border/40 (the QR-stage/
            cart-thumb register; the old /25 fill + /45 edge was the
            pre-r138 inset), and the nested row separators drop to the
            /20 receipt hairline (the whatsapp session-row value —
            hairlines INSIDE a card, firmer seams BETWEEN cards). */}
        <div className="mt-3 bg-muted/60 border border-border/40 rounded-xl p-4 space-y-3.5 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InfoRow label="اسم الحساب" value={LYPAY_INFO.account_name} />
            <InfoRow label="البنك" value={LYPAY_INFO.bank} />
          </div>
          <InfoRow label="الفرع" value={LYPAY_INFO.branch} />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border/20">
            <InfoRow label="رقم الحساب" value={LYPAY_INFO.account_number} />
            <CopyButton text={LYPAY_INFO.account_number} label="نسخ" size="md" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border/20">
            <div className="min-w-0">
              <div className="text-2xs text-muted-foreground mb-0.5 font-semibold">IBAN</div>
              <div dir="ltr" className="font-mono font-bold text-sm break-all text-left">
                {LYPAY_INFO.iban}
              </div>
            </div>
            <CopyButton text={LYPAY_INFO.iban.replace(/\s/g, "")} label="نسخ" size="md" />
          </div>
        </div>
      </div>

      <div className="border-t border-border/20" />

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
          <StepDot
            n={2}
            /* R123-E4a (P3-b): unified with the mobile flow's
                «المبلغ بالدينار الليبي» — was «المبلغ المحوّل
                (د.ل)», a second phrasing for the same money
                datum one tab away (the input's own placeholder
                already said this). */
            label="المبلغ بالدينار الليبي"
            htmlFor="topup-amount-lypay"
          />
          {/* 96-F6 (R96 A2 P2-7): preset chips raised to the 44px
              touch floor (wrap already flex-wrap). */}
          <div className="flex flex-wrap gap-2 mt-3 mb-2.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onAmountPreset(p)}
                /* R124-I1 (A5 P2, WCAG 4.1.2): aria-pressed names
                    the active preset — the lypay twin of the
                    mobile-flow chips above. */
                aria-pressed={amount === String(p)}
                className={`flex-1 min-w-[64px] min-h-11 py-2 rounded-xl text-sm font-bold transition-all border press-spring ${
                  /* R139 (precision): the lypay twin of the mobile flow's
                     preset chips — the solid primary fill + brand shadow
                     retire for the money-path trio (see
                     MobileTransferForm). aria-pressed byte-identical. */
                  amount === String(p)
                    ? "border-primary/30 bg-primary/15 text-primary-text"
                    : "border-border/30 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground hover:border-border/70"
                }`}
              >
                {/* R157-IMPL-B #8: the lypay twin of the mobile flow's
                    unit-suffixed preset chips. */}
                {p} د.ل
              </button>
            ))}
          </div>
          <Input
            id="topup-amount-lypay"
            /* 96-F6 (R96 A2 P1-6): decimal keyboard — twin of the
               mobile-transfer amount field (type="number" had no
               decimal separator on Arabic-locale iOS keypads).
               R116-S2 (P2): whole-dinar domain (step=1 + the
               Math.round blur snap), matching the mobile flow. */
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            min="1"
            max="10000"
            step={1}
            placeholder="المبلغ بالدينار الليبي"
            value={amount}
            onChange={onAmountChange}
            onBlur={onAmountBlur}
            required
            dir="ltr"
            /* R157-IMPL-B #7: the lypay twin of the mobile flow's
               persistent amount-bound hint. */
            aria-describedby="topup-amount-lypay-hint"
            className="text-left h-11 rounded-xl bg-card"
          />
          <p
            id="topup-amount-lypay-hint"
            className="text-3xs text-muted-foreground mt-1.5 leading-relaxed"
          >
            بين 1 و 10,000 د.ل — مبالغ صحيحة فقط
          </p>
          {/* 93-C5 / F-03: optional receipt reference (bank-transfer
              flow) — lypay keeps it optional (B4-R1 backend note). */}
          <PaymentReferenceField
            id="topup-payment-reference-lypay"
            value={paymentReference}
            onChange={onReferenceChange}
          />
        </div>

        <div className="border-t border-border/20" />

        <div>
          {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
          <StepDot n={3} label="رقم حسابك (المُرسل)" htmlFor="topup-sender-account" />
          <Input
            id="topup-sender-account"
            type="text"
            placeholder="أدخل رقم حساب المُرسل"
            value={senderAccount}
            onChange={(e) => onSenderAccountChange(e.target.value)}
            required
            dir="ltr"
            className="text-left font-mono mt-3 h-11 rounded-xl bg-card"
          />
        </div>

        <div className="border-t border-border/20" />

        <div>
          {/* R125-I7 (A7 B-9): the lypay tab's step-4 label joins
              the mobile flow's «أرسل الطلب» — one verb pair for
              the same submit action (was «تأكيد الإرسال»). */}
          <StepDot n={4} label="أرسل الطلب" />
          <div className="mt-3 mb-3 p-3.5 bg-status-warning/8 border border-status-warning/22 rounded-xl text-xs text-status-warning flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            تأكد من إتمام التحويل المصرفي أولاً قبل إرسال الطلب
          </div>
          {error && (
            <div
              id="wallet-error-2"
              role="alert"
              /* R187 (L-F2): no explicit aria-live — role="alert" alone
                  carries the implicit assertive semantics a money-path
                  error banner needs; the old aria-live="polite" override
                  queued it behind other announcements (the mobile form's
                  #wallet-error twin). */
              className="flex items-center gap-2.5 text-destructive text-sm bg-destructive/8 border border-destructive/18 px-4 py-3 rounded-xl mb-3 shake"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          <Button
            ref={submitRef}
            type="submit"
            /* R135 (FE-4): the lypay twin of the mobile CTA's
               aria-busy above — same mutation, same predicate
               (screen-reader parity on BOTH topup method tabs,
               not just the default one). */
            aria-busy={submitting || mutationPending}
            /* R116-S2 CTA recipe (lypay twin of the mobile CTA).
                R124-I1 (A3 P6): cta-glow removed with the
                mobile CTA above (the pulsing halo is retired). */
            size="lg"
            className="w-full rounded-xl"
            disabled={submitting || mutationPending}
          >
            {/* R125-I7 (A7 B-9): unified submit verb — the lypay
                CTA joins the mobile flow's «إرسال طلب الشحن»
                (was «تأكيد طلب الشحن»); same action, one verb
                pair — the R111-F2 N1 drift class. */}
            {submitting || mutationPending ? "جارٍ الإرسال…" : "إرسال طلب الشحن"}
          </Button>
        </div>
      </form>
    </div>
  );
}
