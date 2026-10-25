import { ClipboardPaste, Loader2, MessageCircle, RotateCcw } from "lucide-react";
import { extractOtpDigits, normalizePhoneInput, useWhatsAppOtp } from "@/hooks/useWhatsAppOtp";

// R158 (hooks lane — decomposition): the phone/code/cooldown/settling/
// expiry OTP state machine (the 10 useState atoms, the settling/
// expiry/auto-submit effects and the sendCode/verifyCode/resetFlow/
// paste handlers) moved verbatim to @/hooks/useWhatsAppOtp — this file
// is the presentational shell consuming it. The two pure normalizers
// keep their historical export address (the whatsapp-phone-sign-in
// test suite imports them from here).
export { toLatinDigits, normalizePhoneInput } from "@/hooks/useWhatsAppOtp";

/**
 * WhatsApp phone sign-in / registration.
 *
 * Two-step OTP flow (after the user clicks the pristine button):
 *   1. User enters Libyan phone (9- or 10-digit local form; pasted
 *      international +218 / 00218 forms are normalized client-side).
 *   2. We POST to /api/auth/whatsapp/start — backend sends a 6-digit
 *      OTP via OpenWA. The cleartext code is NEVER returned to us.
 *      A 503 details.reason="whatsapp_settling" means the channel was
 *      JUST linked and is still settling — handled as an honest,
 *      informational wait with auto-retry (96-F2).
 *   3. User enters the code received on WhatsApp. «لم يصلك الرمز؟
 *      إعادة الإرسال» re-sends to the SAME stored phone (never resets
 *      the flow) and honors the 60 s cooldown (96-F2).
 *   4. We POST to /api/auth/whatsapp/verify — backend validates,
 *      issues JWT + httpOnly cookie, returns { token, is_new_user }.
 *   5. We store the token via the auth context and navigate to /.
 *
 * Mounted only while the gateway is enabled — login/register decide
 * by conditional mounting off the /api/auth/providers probe
 * (whatsapp_status:"settling" renders an honest hint under the
 * button).
 *
 * R158 (hooks lane): every stateful/networked step above lives in
 * @/hooks/useWhatsAppOtp now; this component renders it.
 */

interface WhatsAppPhoneSignInProps {
  /**
   * Live gateway pairing status (r95): "ready" | "settling" | OpenWA
   * lifecycle value | null (unknown). When set and not "ready", a
   * subtle hint appears under the pristine button — honest UX so the
   * user knows the channel is mid-repair BEFORE typing their number.
   * "settling" (96-F2) gets its own hint: the channel was just linked
   * and becomes ready within a minute.
   */
  channelStatus?: string | null;
  /**
   * 93-C5 / F-15 (A4 #3): called on successful sign-in INSTEAD of the
   * default navigate("/") — lets the login page honor ?redirect=
   * (e.g. back to /checkout). Register keeps the default (no redirect
   * handling there yet).
   */
  onSuccess?: () => void;
}

/** M:SS with Latin digits (5:00) — app-wide Latin-numeral convention (A6 #17). */
function formatMSS(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function WhatsAppPhoneSignIn({ channelStatus, onSuccess }: WhatsAppPhoneSignInProps) {
  const {
    phone,
    setPhone,
    code,
    setCode,
    step,
    setStep,
    loading,
    error,
    cooldown,
    settling,
    expiresAt,
    expiryLeft,
    settlingAuto,
    codeInputRef,
    sendCode,
    verifyCode,
    resetFlow,
    tryPasteFromClipboard,
  } = useWhatsAppOtp({ onSuccess });

  return (
    <div className="space-y-2.5">
      {step === "pristine" ? (
        // Pristine entry — matches the Google/Telegram visual: a single
        // tappable button. The 2-step OTP form is revealed only after
        // the user opts in by clicking. This keeps WhatsApp visually
        // consistent with the other one-click providers and avoids
        // surfacing a phone input by default.
        //
        // The backend handles new + returning users identically — the
        // user never has to choose "register" vs "login".
        <button
          type="button"
          onClick={() => setStep("phone")}
          className="w-full h-11 flex items-center justify-center gap-3 border border-border/60 rounded-xl bg-card hover:bg-muted/50 hover:border-border transition-all duration-150 active:scale-[0.97] font-semibold text-sm press-spring"
          aria-label="المتابعة عبر WhatsApp"
        >
          <MessageCircle className="w-4 h-4 text-brand-whatsapp" />
          {/* 96-F2 (A6 #16): Latin brand name marked lang="en" so screen
              readers pronounce it correctly instead of spelling it
              letter-by-letter in the Arabic voice. */}
          المتابعة عبر <span lang="en">WhatsApp</span>
        </button>
      ) : null}
      {/* 96-F2 (R96-A4 §1.3E): settling hint — mirrors the r95 honest
          hint pattern: the live probe says the channel was JUST linked
          and is inside the settle window. Never blocks the attempt.
          R138 (visual): the three pristine-state hints (settling /
          failed / pairing below) ride text-xs now — the live-site VLM
          audit read this "WhatsApp disclaimer" row as too dim, and 11px
          was also the outlier size in this component's own info family
          (the divider label, the settling banner and the error block
          further down are all text-xs). text-muted-foreground STAYS:
          it is the design-system floor register for helper text and the
          failed-state's pinned muted-info style. The COPY is
          deliberately unchanged — whatsapp-phone-sign-in.test.tsx pins
          these strings («تُهيَّأ الآن…» / «قيد الربط مؤقتاً» /
          «غير مرتبطة حاليًا») as the qr_ready/failed differentiators;
          the audit's "cryptic — should explain that the OTP arrives on
          WhatsApp" clarification is reported as the copy-owner
          follow-up rather than silently reworded under a substring pin.
          R139 (b): that follow-up has now LANDED — as a brand-new line
          on the phone step (under the input/submit row below), NOT a
          reword of these three pinned strings; they stay byte-identical. */}
      {step === "pristine" && channelStatus === "settling" && (
        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          قناة <span lang="en">WhatsApp</span> ربطت للتو — تُهيَّأ الآن وتصبح جاهزة خلال أقل من
          دقيقة
        </p>
      )}
      {/* 97-F5 (J-1 / R97-A5 §P3): "failed" is the gateway's HONEST dead
          state (backend 97-F3 passes it verbatim) — the channel is NOT
          mid-pairing and will not become ready "soon". The old generic
          hint («قيد الربط مؤقتاً — يمكنك المحاولة») was a lie for this
          state and burned users' attempts. Muted info copy (NOT the
          destructive error style): name the real situation, hand the
          user working alternatives, keep the entry mounted (the
          operator can complete re-pairing at any moment). */}
      {step === "pristine" && channelStatus === "failed" && (
        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          قناة <span lang="en">WhatsApp</span> غير مرتبطة حاليًا — جارٍ إصلاحها من فريق التشغيل؛
          {/* R111-F2 N4: Latin brand names wrapped like WhatsApp 2 words
              earlier in the same sentence (was bare «Google أو Telegram»). */}
          استخدم <span lang="en">Google</span> أو <span lang="en">Telegram</span> مؤقتًا
        </p>
      )}
      {/* r95 honest hint — only when the live probe says the channel is
          configured but not currently paired (settling and failed excluded —
          each has its own honest copy above). Never blocks the attempt:
          pairing can complete at any moment. */}
      {step === "pristine" &&
        channelStatus &&
        channelStatus !== "ready" &&
        channelStatus !== "settling" &&
        channelStatus !== "failed" && (
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            {/* R111-F2 N4: Google / Telegram wrapped in lang="en" like
                WhatsApp two words earlier — same-sentence consistency. */}
            قناة <span lang="en">WhatsApp</span> قيد الربط مؤقتاً — يمكنك المحاولة، أو استخدم{" "}
            <span lang="en">Google</span> / <span lang="en">Telegram</span> الآن
          </p>
        )}
      {step !== "pristine" && (
        <>
          {step === "phone" ? (
            <>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
                  placeholder="09XXXXXXXX"
                  aria-label="رقم الهاتف"
                  /* R187 (C-F7): the majority-provider sign-in field joins
                     the autoComplete contract every other auth input
                     carries (username/current-password/one-time-code) —
                     WCAG 1.3.5, lets autofill offer the saved phone. */
                  autoComplete="tel"
                  disabled={loading || settlingAuto}
                  dir="ltr"
                  enterKeyHint="done"
                  /* R124-I4 (A5 #9): the role=alert error block was never
                     tied to the field — mirror the wallet sender-phone
                     pattern (aria-invalid + aria-describedby → the
                     id'd error below). Only one step's input is mounted
                     at a time and errors are step-scoped, so the shared
                     id is unambiguous. */
                  aria-invalid={!!error}
                  aria-describedby={error ? "whatsapp-auth-error" : undefined}
                  /* F3-12 (R111 WCAG 1.4.11): `focus:border-primary/50`
                  alone measured 1.70:1 vs the resting border on the dark
                  card — the ring token at full opacity (3.76:1 dark card /
                  5.30:1 light) carries the focus indicator contrast.
                  A4-F12 (R120-B2): the resting border is
                  `border-muted-foreground/75` (5.0:1 dark / 3.7:1 light vs
                  the card) — `border-border/60` measured 1.15:1 and left
                  the field extent sub-perceptual on the same-fill card.
                  R145 (D7): the FILL gains its own step — bg-card →
                  bg-input (the --input surface token, 215 20% 16% dark /
                  220 13% 87% light). The live VLM audit's "input fields
                  have zero visual weight" traced to the fill: bg-card on
                  the bg-card auth card left ONLY the border carrying the
                  field, and at a glance the inputs read as holes in the
                  card. The muted-foreground/75 resting border stays
                  (A4-F12's pinned ≥3:1 decision is untouched — the task's
                  "border-border/60+" floor was already exceeded); the
                  input token adds the surface dimension under it. The
                  provider BUTTONS stay in their quiet border/60 register
                  (their pinned idiom): actions rest quiet, FORM reads as
                  form — the D7 rebalance is fill-only, both sides not
                  restyled to compete. */
                  className="flex-1 h-11 rounded-xl border border-muted-foreground/75 bg-input px-3 text-left text-base outline-none focus:border-primary/50 focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                {/* 94-C3 (A3 P2-5): white on #25D366 was ~2:1 (AA fail).
                bg keeps the WhatsApp brand green; the label rides the
                --brand-whatsapp-ink token (#054339, ~5.7:1 on the same
                green) so the OTP send action stays readable. */}
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={loading || settlingAuto || phone.length < 9 || cooldown > 0}
                  className="h-11 px-4 rounded-xl bg-brand-whatsapp text-brand-whatsapp-ink font-bold text-sm disabled:opacity-60 flex items-center gap-2 transition-all active:scale-95"
                >
                  {loading || settlingAuto ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {/* 96-F2 (R96-A4 §1.3E): the settling wait — spinner +
                      honest label so the button never looks stuck. */}
                      {settlingAuto && (
                        <span className="text-xs whitespace-nowrap">جارٍ التهيئة…</span>
                      )}
                    </>
                  ) : cooldown > 0 ? (
                    // Keep the "إعادة الإرسال" label visible while counting
                    // down — the previous bare "Xs" hid context and made the
                    // button look stuck rather than rate-limited.
                    // 96-F2 (A6 #17): Arabic ث + Latin digits (was «(60s)»).
                    <span className="text-xs whitespace-nowrap">إعادة الإرسال ({cooldown} ث)</span>
                  ) : (
                    <>
                      <MessageCircle className="w-4 h-4" />
                      {/* R124-I4 (A10 #9): the storefront's lone generic
                          submit — every other button names its action; the
                          resend link below already says «إعادة الإرسال». */}
                      إرسال الرمز
                    </>
                  )}
                </button>
              </div>
              {/* R139 (b — the r138-g follow-up, via copy authorization):
                  the OTP-mechanism disclosure the live-site audit asked
                  for ("users deserve to know a verification code arrives
                  on WhatsApp BEFORE they commit"). Lives HERE — the
                  phone step, directly under the input/submit row: after
                  the user has chosen the WhatsApp path, BEFORE the send
                  commits the number. Deliberately NOT (a) on the pristine
                  button row — that row is the provider family and the
                  Google/Telegram peers carry no helper line (a permanent
                  caption would unbalance the trio); (b) on the code step
                  — §8 bare-code isolation: nothing competes with the 6
                  digits. Honest by construction: /api/auth/whatsapp/start
                  has the backend send the 6-digit code through the paired
                  WhatsApp channel (whatsapp-otp.service.ts — «سيصلك» is
                  the same future verb the code step echoes with «لم يصلك
                  الرمز؟»); the anti-phishing «لا تشارك هذا الرمز مع أحد»
                  lives in the WhatsApp MESSAGE itself (the §8 channel
                  idiom), so the web entry carries the mechanism only.
                  Register = the 138-g hint family (text-xs muted,
                  centered) — one step above the 11px carriers fine print
                  below it, so the statement leads and the detail trails.
                  Plain visible text: no aria/role/ live semantics (zero
                  a11y deltas on this lane); Latin brand wrapped lang="en"
                  per the A6 #16 family. Grep-clean when added: «سيصلك» had
                  zero hits across src/tests (no pin collision). */}
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                سيصلك رمز التحقق عبر <span lang="en">WhatsApp</span>
              </p>
              <p className="text-2xs text-muted-foreground text-center">
                تُقبل أرقام ليبيانا ومدار التي تبدأ بـ 091 / 092 / 093 / 094.
              </p>
              {/* Allow the user to collapse the OTP UI back to the single
            "Continue with WhatsApp" button — useful if they opened it
            by accident or want to switch providers.
            96-F2 (A2 P2-9): 44px touch target (was an ~18px micro-link). */}
              <button
                type="button"
                onClick={resetFlow}
                disabled={loading}
                className="min-h-11 py-2 px-3 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                تراجع
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(extractOtpDigits(e.target.value))}
                  onPaste={(e) => {
                    // Smart paste: extract first 6 digits from anything the
                    // user pastes — even the entire WhatsApp message. Without
                    // this, pasting "```123456```" leaves backticks in the
                    // input which then fail validation.
                    const pasted = e.clipboardData.getData("text");
                    const digits = extractOtpDigits(pasted);
                    if (digits) {
                      e.preventDefault();
                      setCode(digits);
                    }
                  }}
                  placeholder="رمز التحقق"
                  aria-label="رمز التحقق المكوّن من 6 أرقام"
                  disabled={loading}
                  dir="ltr"
                  enterKeyHint="done"
                  /* R124-I4 (A5 #9): same field-association as the phone
                     input above (wallet sender-phone pattern). */
                  aria-invalid={!!error}
                  aria-describedby={error ? "whatsapp-auth-error" : undefined}
                  /* F3-12 (R111 WCAG 1.4.11): same fix as the phone field
                  above — a real 3.76:1+ ring instead of the 1.70:1 border
                  tint. (R122 A1 P2-4: tracking now rides the arbitrary
                  tracking-[0.2em] form — the old tracking-widest was a
                  no-op: the global Arabic letter-spacing guard
                  (index.css:917) zeroes the five named utilities on ALL
                  runs, not just Arabic ones, so this Latin-digit OTP
                  rendered untracked despite the intent documented here.)
                  A4-F12 (R120-B2): resting border at muted-foreground/75
                  (≥3:1 both themes) — was border-border/60 at 1.15:1.
                  R145 (D7): bg-card → bg-input — the same fill step the
                  phone field above gained this round (one form, one
                  surface family; the border decisions stay byte-identical). */
                  className="flex-1 h-11 rounded-xl border border-muted-foreground/75 bg-input px-3 text-center tracking-[0.2em] text-base outline-none focus:border-primary/50 focus:ring-2 focus:ring-ring disabled:opacity-50"
                  autoFocus
                />
                {typeof navigator !== "undefined" &&
                  "clipboard" in navigator &&
                  typeof navigator.clipboard?.readText === "function" && (
                    <button
                      type="button"
                      onClick={tryPasteFromClipboard}
                      disabled={loading}
                      title="لصق الرمز من الحافظة"
                      aria-label="لصق الرمز من الحافظة"
                      /* R145 (D7): bg-card → bg-input — the paste peer rides
                         the OTP field's new surface (one row, one fill). */
                      className="h-11 w-11 rounded-xl border border-muted-foreground/75 bg-input text-muted-foreground hover:text-foreground hover:border-muted-foreground flex items-center justify-center transition-all active:scale-95 disabled:opacity-50"
                    >
                      <ClipboardPaste className="w-4 h-4" />
                    </button>
                  )}
                <button
                  type="button"
                  onClick={verifyCode}
                  disabled={loading || code.length < 6}
                  className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 flex items-center gap-2 transition-all active:scale-95"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  تحقق
                </button>
              </div>
              {/* 96-F2 (R96-A4 §4.1): OTP TTL from expires_at — subtle
              Latin-digit M:SS countdown (never the code itself).
              R124-I4 (A5 #9): live region so the countdown + the expiry
              note reach screen readers — the same money flow's waiting
              modal already does this (TopupWaitingModal countdown). */}
              {expiresAt !== null &&
                (expiryLeft > 0 ? (
                  <p
                    aria-live="polite"
                    aria-atomic="true"
                    className="text-2xs text-muted-foreground text-center"
                  >
                    ينتهي خلال{" "}
                    <span dir="ltr" className="tabular-nums">
                      {formatMSS(expiryLeft)}
                    </span>
                  </p>
                ) : (
                  <p aria-live="polite" className="text-2xs text-muted-foreground text-center">
                    انتهت صلاحية الرمز — استخدم «إعادة الإرسال» للحصول على رمز جديد
                  </p>
                ))}
              {/* 96-F2 (R96-A4 §4.1): the missing recovery path — the
              production "Waiting for this message" bug left users on
              this step with no escape but the destructive «تغيير
              الرقم». This secondary affordance calls the SAME sendCode()
              with the STORED phone (never resets it) and naturally
              honors the 60 s cooldown. 44px touch target (A2 P2-9). */}
              <button
                type="button"
                onClick={sendCode}
                disabled={loading || cooldown > 0 || settlingAuto}
                className="min-h-11 py-2 px-3 mx-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
              >
                {(loading || settlingAuto) && <Loader2 className="w-4 h-4 animate-spin" />}
                {/* 96-F2 (A6 #17): Arabic ث + Latin digits in the countdown. */}
                {cooldown > 0
                  ? `لم يصلك الرمز؟ إعادة الإرسال (${cooldown} ث)`
                  : "لم يصلك الرمز؟ إعادة الإرسال"}
              </button>
              {/* 94-C3 (A3 P3-9): type="button" — this reset control can live
              inside a <form>; without it, tapping "تغيير الرقم" would
              submit the host form instead of resetting the flow.
              96-F2 (A2 P2-9): 44px touch target (was an ~18px micro-link). */}
              <button
                type="button"
                onClick={resetFlow}
                disabled={loading}
                className="min-h-11 py-2 px-3 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                تغيير الرقم
              </button>
            </div>
          )}
        </>
      )}
      {/* 96-F2 (R96-A4 §1.3E): settling banner — informational
          (role=status, muted palette), never the destructive error
          style. Auto-pending: honest wait copy. Manual: retry CTA. */}
      {settling && !error && (
        <div
          role="status"
          className="bg-muted/60 border border-border/60 rounded-lg p-2.5 animate-in fade-in slide-in-from-top-1"
        >
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            {settling.autoPending ? (
              settling.wake ? (
                <>
                  خدمة <span lang="en">WhatsApp</span> تستيقظ من السكون الآن — ستُرسل الرمز تلقائيًا
                  خلال لحظات
                </>
              ) : (
                <>
                  قناة <span lang="en">WhatsApp</span> ربطت للتو — تُهيَّأ الآن وستُرسل الرمز
                  تلقائيًا خلال أقل من دقيقة
                </>
              )
            ) : settling.wake ? (
              <>
                ما زالت خدمة <span lang="en">WhatsApp</span> تستيقظ من السكون — أعد المحاولة أو
                استخدم <span lang="en">Google</span> / <span lang="en">Telegram</span>
              </>
            ) : (
              <>
                ما زالت قناة <span lang="en">WhatsApp</span> قيد التهيئة — أعد المحاولة أو استخدم{" "}
                <span lang="en">Google</span> / <span lang="en">Telegram</span>
              </>
            )}
          </p>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 animate-in fade-in slide-in-from-top-1"
        >
          {/* R124-I4 (A5 #9): the id the phone/OTP inputs point at via
              aria-describedby above (wallet sender-phone pattern). */}
          <p
            id="whatsapp-auth-error"
            className="text-xs text-destructive text-center leading-relaxed"
          >
            {error}
          </p>
        </div>
      )}
    </div>
  );
}
