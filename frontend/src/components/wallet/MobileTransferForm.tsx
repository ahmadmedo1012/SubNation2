import { AlertCircle, CheckCircle } from "lucide-react";
import { useEffect, useRef, type ChangeEvent, type FocusEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InstructionsPanel, TransferCodePanel } from "@/components/wallet/TransferCodePanel";
import { NETWORKS, StepDot } from "@/components/wallet/topup-meta";
import { RECEIVER_PHONE, type TransferNetwork } from "@/lib/transfer-code";

// R136 (FE-1 decomposition): extracted verbatim from pages/wallet.tsx —
// the mobile-transfer topup flow (network → amount → USSD transfer →
// sender phone → submit). EVERY input's onChange/onBlur calls a
// PAGE-OWNED handler passed down as a prop (onAmountChange /
// onAmountPreset / onAmountBlur / onNetworkChange /
// onSavedPhonePick / onSenderPhoneChange / …) — never a raw setter: the
// 96-F6/98-F2 Idempotency-Key rotation rides those handlers, and an
// extract-local setter would desync the key from the mutation's
// captured headers (the 409 hole the page's docblock warns about).
// handleSubmit + topupMutation stay in the page. The move only changes
// its address; DOM, classes, aria and event semantics are byte-identical.
//
// R154 (P1-A): the transfer-receipt reference field is RETIRED from
// this flow — the customer was asked for a receipt code the telecom
// USSD channel does not reliably surface, and the required field was
// the top abandonment point of the money path. The plan panel above
// now carries the multi-transfer instructions; duplicate-transfer
// risk is surfaced to the OPERATOR at review time (backend route +
// Telegram card) instead of being pushed onto the customer.

export function MobileTransferForm({
  network,
  amount,
  presets,
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
  onSavedPhonePick,
  onSenderPhoneChange,
  onSenderPhoneTouched,
  onRememberPhoneChange,
}: {
  network: string;
  amount: string;
  presets: number[];
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
  onSavedPhonePick: (phone: string) => void;
  onSenderPhoneChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSenderPhoneTouched: () => void;
  onRememberPhoneChange: (checked: boolean) => void;
}) {
  // R-140-j (keyboard/focus): focus retention across the submit flight.
  // The CTA's native `disabled` (the honest PENDING register — aria-busy
  // + the «جارٍ الإرسال…» label) drops focus to <body> the moment the
  // POST /wallet/topups flight starts; when the flight ends in FAILURE
  // the persistent #wallet-error banner mounts announced but focus sat
  // dead at the page top — a keyboard user had to Tab the whole page to
  // retry. The effect re-lands focus on the (re-enabled) trigger once
  // the flight flag clears with an error mounted: an immediate Enter
  // retries, and the 96-F6 idempotency-key contract makes that retry a
  // safe replay. Validation errors never arm the flight flag (their CTA
  // never disabled — focus never left the button). The SUCCESS path
  // never lands here either: the waiting modal owns focus from its open
  // (Radix) until its close (the page's restoreTopupTriggerFocus).
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
              {/* R157-IMPL-B #8: the preset numerals ride the codebase's
                  inline unit idiom ("{fmt(x)} د.ل") so a chip can't read
                  as points/units. */}
              {p} د.ل
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
          /* R157-IMPL-B #7: the 1–10,000 whole-dinar bound used to
             surface ONLY as a post-submit error banner — the persistent
             hint below (bound via aria-describedby like the phone-error
             hint) states it up front. */
          aria-describedby="topup-amount-mobile-hint"
          className="text-left h-11 bg-card"
          /* R139 (precision): border-border/50 + focus:border-primary/45
             overrides stripped — the shared Input family owns the
             A4-F12 AA resting border (muted-foreground/75) and the ONE
             focus system (ring-2 ring-ring); the lypay twin below
             already rode exactly this canonical form. h-11 = the 44px
             storefront floor, bg-card = the solid-surface idiom. */
        />
        <p
          id="topup-amount-mobile-hint"
          className="text-3xs text-muted-foreground mt-1.5 leading-relaxed"
        >
          بين 1 و 10,000 د.ل — مبالغ صحيحة فقط
        </p>
      </div>

      <div className="border-t border-border/20" />

      {/* Step 3: The transfer plan (single or installments) */}
      <div>
        <StepDot n={3} label="نفّذ التحويل" />
        <TransferCodePanel
          network={network as TransferNetwork}
          amount={amount}
          receiver={RECEIVER_PHONE}
        />
        {/* R154 (P1-A): the PaymentReferenceField that used to render
            here is retired — see the file header. The flow stays clean
            and sequential: network → amount → transfers → sender
            phone → one top-up request for the aggregate total. */}
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
            className={`text-left ps-10 h-11 bg-card transition-all ${
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
          ref={submitRef}
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
