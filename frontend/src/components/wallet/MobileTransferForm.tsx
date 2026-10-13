import { AlertCircle, CheckCircle } from "lucide-react";
import type { ChangeEvent, FocusEvent, FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InstructionsPanel, TransferCodePanel } from "@/components/wallet/TransferCodePanel";
import { NETWORKS, StepDot } from "@/components/wallet/topup-meta";
import { PaymentReferenceField } from "@/components/wallet/PaymentReferenceField";
import { RECEIVER_PHONE, type TransferNetwork } from "@/lib/transfer-code";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the mobile-transfer topup flow (network → amount → USSD transfer +
// receipt → sender phone → submit). EVERY input's onChange/onBlur calls
// a PAGE-OWNED handler passed down as a prop (onAmountChange /
// onAmountPreset / onAmountBlur / onReferenceChange / onNetworkChange /
// onSavedPhonePick / onSenderPhoneChange / …) — never a raw setter: the
// 96-F6/98-F2 Idempotency-Key rotation rides those handlers, and an
// extract-local setter would desync the key from the mutation's
// captured headers (the 409 hole the page's docblock warns about).
// handleSubmit + topupMutation stay in the page. The move only changes
// its address; DOM, classes, aria and event semantics are byte-identical.

export function MobileTransferForm({
  network,
  amount,
  presets,
  paymentReference,
  senderPhone,
  senderPhoneTouched,
  senderPhoneErr,
  savedPhones,
  rememberPhone,
  error,
  submitting,
  mutationPending,
  onSubmit,
  onNetworkChange,
  onAmountChange,
  onAmountPreset,
  onAmountBlur,
  onReferenceChange,
  onSavedPhonePick,
  onSenderPhoneChange,
  onSenderPhoneTouched,
  onRememberPhoneChange,
}: {
  network: string;
  amount: string;
  presets: number[];
  paymentReference: string;
  senderPhone: string;
  senderPhoneTouched: boolean;
  senderPhoneErr: string | null;
  savedPhones: string[];
  rememberPhone: boolean;
  error: string;
  submitting: boolean;
  mutationPending: boolean;
  onSubmit: (e: FormEvent) => void;
  onNetworkChange: (value: string) => void;
  onAmountChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onAmountPreset: (p: number) => void;
  onAmountBlur: (e: FocusEvent<HTMLInputElement>) => void;
  onReferenceChange: (v: string) => void;
  onSavedPhonePick: (phone: string) => void;
  onSenderPhoneChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSenderPhoneTouched: () => void;
  onRememberPhoneChange: (checked: boolean) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Step 1: Network */}
      <div>
        <StepDot n={1} label="اختر شبكتك" />
        <div className="grid grid-cols-2 gap-2 mt-3">
          {NETWORKS.map((n) => (
            <button
              key={n.value}
              type="button"
              onClick={() => onNetworkChange(n.value)}
              /* R124-I1 (A5 P2, WCAG 4.1.2): aria-pressed exposes
                  which network is selected — the money path's
                  selector groups follow the tested home.tsx /
                  product.tsx toggle-button idiom.
                  R139 (precision): network tiles keep their per-network
                  token tints (the R94-A1/R124-I1 AA pair — semantic
                  brand hues) but join the 1px family geometry — the old
                  border-2 + active shadow-sm was the pre-r138
                  raised-toggle register (see the method tabs above). */
              aria-pressed={network === n.value}
              className={`py-3 rounded-xl border font-bold text-sm transition-all press-spring ${
                network === n.value
                  ? `${n.border} ${n.bg} ${n.color}`
                  : "border-border/30 text-muted-foreground hover:text-foreground hover:border-border/70"
              }`}
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border/20" />

      {/* Step 2: Amount */}
      <div>
        {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
        <StepDot n={2} label="المبلغ بالدينار الليبي" htmlFor="topup-amount-mobile" />
        {/* 96-F6 (R96 A2 P2-7): preset chips raised to the 44px
            touch floor (wrap already flex-wrap). */}
        <div className="flex gap-2 mt-3 mb-2.5 flex-wrap">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onAmountPreset(p)}
              /* R124-I1 (A5 P2, WCAG 4.1.2): aria-pressed names
                  the active preset (toggle-button idiom — see
                  the method tabs above). */
              aria-pressed={amount === String(p)}
              className={`flex-1 min-w-[52px] min-h-11 py-2 rounded-xl text-sm font-bold transition-all border press-spring ${
                /* R139 (precision): the money preset chips drop the SOLID
                   primary fill + shadow-md shadow-primary/25 for the
                   r138 money-path trio — the PDP VariantSelector decision
                   (tinted /15 + /30 edge + primary-text ink; NO shadow
                   anywhere in the selector, pinned by
                   money-path-chrome-r139). aria-pressed byte-identical. */
                amount === String(p)
                  ? "border-primary/30 bg-primary/15 text-primary-text"
                  : "border-border/30 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground hover:border-border/70"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <Input
          id="topup-amount-mobile"
          /* 96-F6 (R96 A2 P1-6): type="text" + inputMode="decimal"
             — type="number" on the Arabic-locale iOS keypad has
             NO decimal separator, so fractional amounts (the
             0.5-step domain) were literally untypable. The
             sanitizer in handleAmountChange keeps digits + ONE
             decimal point alive; min/step semantics stay enforced
             by the onBlur rounding + handleSubmit's own bounds.
             R116-S2 (P2): the domain is now WHOLE dinars (USSD
             codes cannot carry fractions) — step=1 + the
             Math.round blur/submit snaps keep the amount
             integer; inputMode stays decimal so a stray
             separator is still typable (and then rounded). */
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          min="1"
          max="10000"
          step={1}
          placeholder="أو أدخل مبلغاً آخر…"
          value={amount}
          onChange={onAmountChange}
          onBlur={onAmountBlur}
          required
          dir="ltr"
          className="text-left h-11 bg-card"
          /* R139 (precision): border-border/50 + focus:border-primary/45
             overrides stripped — the shared Input family owns the
             A4-F12 AA resting border (muted-foreground/75) and the ONE
             focus system (ring-2 ring-ring); the lypay twin below
             already rode exactly this canonical form. h-11 = the 44px
             storefront floor, bg-card = the solid-surface idiom. */
        />
      </div>

      <div className="border-t border-border/20" />

      {/* Step 3: One-tap transfer + the receipt it produces */}
      <div>
        <StepDot n={3} label="نفّذ التحويل" />
        <TransferCodePanel
          network={network as TransferNetwork}
          amount={amount}
          receiver={RECEIVER_PHONE}
        />
        {/* 93-C5 / F-03: the transfer receipt — REQUIRED on this
            flow since R123-E4a (see PaymentReferenceField).
            R124-I1 (A1 P2): rendered AFTER the transfer panel —
            the receipt number only exists once the user has
            run the USSD transfer above, so the field used to
            sit ~1,000px above the button that generates its
            value (a required field the user cannot fill yet,
            then a scroll-back hunt after step 3). The flow now
            reads top-to-bottom: transfer → receipt from the
            transfer SMS → sender phone → submit. Validation,
            state and the idempotency-key rotation contract are
            unchanged. */}
        <PaymentReferenceField
          id="topup-payment-reference-mobile"
          value={paymentReference}
          onChange={onReferenceChange}
          required
        />
      </div>

      <div className="border-t border-border/20" />

      {/* Step 4: Phone */}
      <div>
        {/* 96-F6 (R96 A6 #2 P1): step label bound to the field. */}
        <StepDot n={4} label="رقم هاتف المُرسل" htmlFor="topup-sender-phone" />
        <p className="text-xs text-muted-foreground mt-2 mb-3">
          أدخل رقمك الذي حوّلت منه الرصيد لتأكيد العملية.
        </p>

        {/* Saved phones dropdown */}
        {savedPhones.length > 0 && (
          /* 96-F6 (R96 A2 P2-7): saved-phone chips raised to the
             44px touch floor — a money-verification field. */
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {savedPhones.map((phone) => (
              <button
                key={phone}
                type="button"
                onClick={() => onSavedPhonePick(phone)}
                /* R124-I1 (A5 P2, WCAG 4.1.2): aria-pressed on
                    the saved-phone chips — same toggle-button
                    idiom as the selector groups above. */
                aria-pressed={senderPhone === phone}
                className={`min-h-11 px-2.5 py-1 rounded-lg text-xs font-mono border transition-all flex items-center justify-center ${
                  senderPhone === phone
                    ? "bg-primary/15 border-primary/30 text-primary-text"
                    : "bg-muted/30 border-border/30 hover:bg-muted/60 text-muted-foreground"
                }`}
              >
                {phone}
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <Input
            id="topup-sender-phone"
            type="tel"
            /* 96-F6 (R96 A6 #2 P1): autoComplete=tel lets the OS
               offer the user's phone numbers for this field. */
            autoComplete="tel"
            placeholder="091XXXXXXX"
            value={senderPhone}
            onChange={onSenderPhoneChange}
            onBlur={onSenderPhoneTouched}
            required
            dir="ltr"
            /* 96-F6 (R96 A6 #13): the live validation error is
               announced + bound via aria-describedby/aria-invalid
               on the field itself. */
            aria-invalid={senderPhoneTouched && !!senderPhoneErr}
            aria-describedby={
              senderPhoneTouched && senderPhoneErr ? "topup-sender-phone-error" : undefined
            }
            className={`text-left pl-10 h-11 bg-card transition-all ${
              senderPhoneTouched && senderPhoneErr
                ? "border-destructive/60"
                : senderPhoneTouched && senderPhone.length === 10 && !senderPhoneErr
                  ? "border-status-success/55"
                  : ""
            }`}
            maxLength={10}
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            {senderPhoneTouched && !senderPhoneErr && senderPhone.length === 10 && (
              <CheckCircle className="w-4 h-4 text-status-success" />
            )}
            {senderPhoneTouched && senderPhoneErr && (
              <AlertCircle className="w-4 h-4 text-destructive" />
            )}
          </div>
        </div>
        {senderPhoneTouched && senderPhoneErr && (
          /* 96-F6 (R96 A6 #13): id the input points at via
             aria-describedby above. */
          <p id="topup-sender-phone-error" className="text-xs text-destructive mt-1.5">
            {senderPhoneErr}
          </p>
        )}

        {/* Remember phone checkbox */}
        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={rememberPhone}
            onChange={(e) => onRememberPhoneChange(e.target.checked)}
            className="w-4 h-4 rounded border-border/60 bg-card text-primary"
          />
          <span className="text-xs text-muted-foreground">تذكر رقم الهاتف للمرات القادمة</span>
        </label>
      </div>

      <div className="border-t border-border/20" />

      {/* Step 5: Submit */}
      <div>
        <StepDot n={5} label="أرسل الطلب" />
        <InstructionsPanel />
        {error && (
          <div
            id="wallet-error"
            role="alert"
            aria-live="polite"
            className="flex items-center gap-2.5 text-destructive text-sm bg-destructive/8 border border-destructive/18 px-4 py-3 rounded-xl mb-3 shake"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <Button
          type="submit"
          /* R135 (FE-4): aria-busy mirrors the disabled predicate
             (submitting || topupMutation.isPending) — the POST
             /wallet/topups flight was invisible to screen readers
             until the outcome landed (repo audit: aria-busy lived
             on only 7 async regions). The product page's
             balance-check CTA idiom (disabled + aria-busy on the
             CTA itself): the visible «جارٍ الإرسال…» label is
             already the accessible name. No page-level aria-live
             twin for the outcome: the #wallet-error banner below
             is role="alert" + aria-live="polite", and success
             hands off to TopupWaitingModal whose body carries
             its own role=status live region — adding one here
             would double-announce. The lypay twin CTA below
             rides the same predicate. */
          aria-busy={submitting || mutationPending}
          /* R116-S2 CTA recipe: size=lg (h-12-class primary)
            + w-full form layout — the drifted h-11/bg-primary/
            shadow overrides are gone (button.tsx's lg + default
            variant own them now). R124-I1 (A3 P6): cta-glow
            removed — the zero-offset pulsing halo is retired;
            the gradient + press-spring carry the affordance. */
          size="lg"
          className="w-full rounded-xl"
          disabled={submitting || mutationPending}
        >
          {submitting || mutationPending ? "جارٍ الإرسال…" : "إرسال طلب الشحن"}
        </Button>
      </div>
    </form>
  );
}
