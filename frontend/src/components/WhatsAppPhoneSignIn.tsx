import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { ClipboardPaste, Loader2, MessageCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

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
 * Renders nothing if the gateway isn't enabled (caller decides whether
 * to mount it via the `enabled` prop, typically backed by a
 * /api/auth/providers probe — whatsapp_status:"settling" renders an
 * honest hint under the button).
 */

interface WhatsAppPhoneSignInProps {
  /** When false, the component renders nothing. */
  enabled?: boolean;
  /**
   * Live gateway pairing status (r95): "ready" | "settling" | OpenWA
   * lifecycle value | null (unknown). When set and not "ready", a
   * subtle hint appears under the pristine button — honest UX so the
   * user knows the channel is mid-repair BEFORE typing their number.
   * "settling" (96-F2) gets its own hint: the channel was just linked
   * and becomes ready within a minute.
   */
  channelStatus?: string | null;
  /** Optional divider label rendered above the form. */
  dividerLabel?: string;
  /**
   * 93-C5 / F-15 (A4 #3): called on successful sign-in INSTEAD of the
   * default navigate("/") — lets the login page honor ?redirect=
   * (e.g. back to /checkout). Register keeps the default (no redirect
   * handling there yet).
   */
  onSuccess?: () => void;
}

const COOLDOWN_DEFAULT = 60;
/** 96-F2 (R96-A4 §1.3E): settling auto-retry budget before the manual button takes over. */
const SETTLING_MAX_AUTO_RETRIES = 2;
/** 96-F2 (R96-A4 §1.3E): wait when the backend omits/garbles retry_after_sec — keeps the «أقل من دقيقة» copy honest. */
const SETTLING_FALLBACK_WAIT_SEC = 30;

/**
 * 96-F2 (R96-A4 §3.2): client-side phone normalization mirroring the
 * backend normalizeLibyanPhone contract. After stripping non-digits (a
 * pasted "+" disappears here), international prefixes are removed so
 * the stored value is always the LOCAL form:
 *   "+218 91 345 6789" → "913456789"
 *   "00218913456789"   → "913456789"
 *   "+2180913456789"   → "0913456789"
 *   "0913456789"       → "0913456789" (local form untouched)
 * "00218" is checked BEFORE "218" ("00218" starts with "00", not
 * "218"). The digit cap stays 10 — the 9-digit local part plus the
 * optional leading 0.
 */
export function normalizePhoneInput(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00218")) digits = digits.slice(5);
  else if (digits.startsWith("218")) digits = digits.slice(3);
  return digits.slice(0, 10);
}

/** M:SS with Latin digits (5:00) — app-wide Latin-numeral convention (A6 #17). */
function formatMSS(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 96-F2 (R96-A4 §4.1): single error funnel — every failure path in
 * this component goes through the shared getErrorMessage() instead of
 * raw data.error reads. The whatsapp route bodies carry BOTH a precise
 * Arabic `error` string and a generic `code` (INVALID_DATA /
 * UNAUTHORIZED / SERVICE_UNAVAILABLE); feeding the whole body to
 * getErrorMessage would let the generic code table SHADOW the route's
 * specific copy (e.g. «غير مصرح — سجّل دخولك…» for a plain OTP
 * mismatch). So: the precise string is funneled as `error`
 * (getErrorMessage passes it through verbatim), a code-only body maps
 * through the shared Arabic table, and anything else falls back to the
 * caller's context copy.
 */
function otpErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const body = data as { error?: unknown; code?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return getErrorMessage({ error: body.error });
    }
    if (typeof body.code === "string" && body.code) {
      return getErrorMessage({ code: body.code });
    }
  }
  return getErrorMessage({ error: fallback });
}

/** Cancels a pending settling auto-retry (module-level: stable identity for effect cleanups). */
function cancelSettlingTimer(timer: { current: number | null }): void {
  if (timer.current !== null) {
    clearTimeout(timer.current);
    timer.current = null;
  }
}

export function WhatsAppPhoneSignIn({
  enabled = true,
  channelStatus,
  dividerLabel,
  onSuccess,
}: WhatsAppPhoneSignInProps) {
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"pristine" | "phone" | "code">("pristine");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  // 96-F2 (R96-A4 §1.3E): honest settling state — informational, never
  // error-styled. { autoPending: true } while an automatic retry is
  // scheduled or in flight; { autoPending: false } once the auto-retry
  // budget (2) is spent and the user drives the next attempt manually.
  const [settling, setSettling] = useState<{ autoPending: boolean } | null>(null);
  // 96-F2 (R96-A4 §4.1): OTP TTL (expires_at from /start) → subtle M:SS countdown.
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [expiryLeft, setExpiryLeft] = useState(0);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  // Guards against re-submitting the same 6-digit value twice (e.g.
  // when the auto-submit effect fires after the user has manually
  // tapped "تحقق" but the network request hasn't returned yet).
  const autoSubmittedFor = useRef<string | null>(null);
  // Settling auto-retry bookkeeping (refs: timer identity + budget).
  const settlingRetriesRef = useRef(0);
  const settlingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // 96-F2 (R96-A4 §4.1): tick the OTP expiry countdown while the code
  // step is open. Resends replace expires_at and re-arm the ticker.
  useEffect(() => {
    if (step !== "code" || expiresAt === null) return;
    const tick = () => setExpiryLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt, step]);

  // 96-F2 (R96-A4 §1.3E): a pending settling auto-retry must never
  // fire after unmount (e.g. login flow abandoned mid-wait).
  useEffect(() => () => cancelSettlingTimer(settlingTimerRef), []);

  // Read referral from URL — both phone OTP paths read it independently
  // so this matches the existing referral-attribution conventions
  // used by the other auth paths.
  function getReferralCode(): string | undefined {
    if (typeof window === "undefined") return undefined;
    const ref = new URLSearchParams(window.location.search)
      .get("ref")
      ?.trim()
      .toUpperCase()
      .slice(0, 16);
    return ref || undefined;
  }

  /** 96-F2 (R96-A4 §1.3E): drop the settling wait entirely (timer + banner + budget). */
  function clearSettling() {
    cancelSettlingTimer(settlingTimerRef);
    setSettling(null);
    settlingRetriesRef.current = 0;
  }

  async function sendCode() {
    setError("");
    if (!phone || phone.length < 9) {
      setError("رقم الهاتف غير صالح");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/whatsapp/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        expires_at?: string;
        details?: { reason?: string; retry_after_sec?: number };
      };
      if (!res.ok) {
        // 96-F2 (R96-A4 §1.3E): the channel was JUST linked and is
        // still settling (sender-key / app-state propagation — the
        // production "Waiting for this message" window). Informational,
        // NEVER error-styled: honest copy, auto-retry after
        // retry_after_sec, max 2 auto-retries, then a manual button.
        // This 503 is NOT a rate limit — no cooldown is burned.
        if (data.details?.reason === "whatsapp_settling") {
          setError("");
          const raw = Number(data.details.retry_after_sec);
          const waitSec =
            Number.isFinite(raw) && raw > 0
              ? Math.min(60, Math.max(3, Math.ceil(raw)))
              : SETTLING_FALLBACK_WAIT_SEC;
          if (settlingRetriesRef.current < SETTLING_MAX_AUTO_RETRIES) {
            settlingRetriesRef.current += 1;
            setSettling({ autoPending: true });
            cancelSettlingTimer(settlingTimerRef);
            settlingTimerRef.current = window.setTimeout(() => {
              settlingTimerRef.current = null;
              void sendCode();
            }, waitSec * 1000);
          } else {
            // Auto-retry budget spent — keep the honest banner, hand
            // control back to the user (send button re-enabled).
            setSettling({ autoPending: false });
          }
          return;
        }
        clearSettling();
        // 96-F2 (R96-A4 §4.1): single error funnel — no raw data.error.
        setError(otpErrorMessage(data, "تعذّر إرسال الرمز"));
        if (data.details?.retry_after_sec) {
          setCooldown(data.details.retry_after_sec);
        }
        return;
      }
      clearSettling();
      setStep("code");
      setCooldown(COOLDOWN_DEFAULT);
      // 96-F2 (R96-A4 §4.1): surface the OTP TTL the backend already
      // returns (expires_at) as a subtle M:SS countdown.
      const ts = data.expires_at ? Date.parse(data.expires_at) : NaN;
      setExpiresAt(Number.isFinite(ts) ? ts : null);
      // A fresh code is on its way — drop any stale typed code so the
      // auto-submit guard resets with it (resend path).
      setCode("");
      autoSubmittedFor.current = null;
      if (step === "code") codeInputRef.current?.focus();
    } catch (err) {
      clearSettling();
      // 96-F2 (R96-A4 §4.1): network failures get the shared Arabic network copy.
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setError("");
    if (!code || code.length !== 6) {
      setError("الرمز يجب أن يكون 6 أرقام");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/whatsapp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, referralCode: getReferralCode() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.token) {
        // 96-F2 (R96-A4 §4.1): single error funnel — no raw data.error.
        setError(otpErrorMessage(data, "فشل التحقق من الرمز"));
        return;
      }
      setToken(data.token);
      // 93-C5 / F-15: redirect target (guarded checkout, cart, …) instead
      // of the hardcoded home — same contract as AuthProviders' onSuccess.
      if (onSuccess) onSuccess();
      else navigate("/");
    } catch (err) {
      // 96-F2 (R96-A4 §4.1): shared Arabic network copy.
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function resetFlow() {
    // 96-F2 (R96-A4 §4.1): escaping the flow also cancels any pending
    // settling auto-retry so a ghost request can never fire afterwards.
    clearSettling();
    setStep("pristine");
    setPhone("");
    setCode("");
    setError("");
    setExpiresAt(null);
    setExpiryLeft(0);
    autoSubmittedFor.current = null;
  }

  /**
   * Extract the OTP from any pasted text. Strips non-digits, takes the
   * first 6 digits — so pasting the whole WhatsApp message works:
   *   "SubNation — رمز التحقق\n\n123456\n\nصالح لمدة 5 دقائق…"  →  "123456"
   */
  function extractOtpDigits(input: string): string {
    return input.replace(/\D/g, "").slice(0, 6);
  }

  /**
   * "Paste from clipboard" affordance. Uses navigator.clipboard.readText
   * which requires:
   *   - HTTPS or localhost
   *   - User gesture (the button click counts)
   *   - Permission grant on first use (the browser prompts)
   * On any failure (denied, unsupported, empty clipboard, no digits in
   * the clipboard), the input simply isn't filled — the user can still
   * type manually.
   */
  async function tryPasteFromClipboard() {
    if (typeof navigator === "undefined") return;
    const clip = navigator.clipboard;
    if (!clip || typeof clip.readText !== "function") return;
    try {
      const raw = await clip.readText();
      const digits = extractOtpDigits(raw);
      if (digits) {
        setCode(digits);
        codeInputRef.current?.focus();
      }
    } catch {
      // Permission denied or unsupported — silent no-op. Manual typing still works.
    }
  }

  // Auto-submit when 6 digits are entered, exactly once per code value.
  // This is the canonical OTP UX — the moment the user finishes typing
  // (or paste-fills) the code, we verify without requiring an extra tap.
  // (verifyCode is intentionally omitted from deps; including it would
  // re-fire the effect on every render. Keying on (step, code) is the
  // correct one-shot semantics here.)
  useEffect(() => {
    if (step !== "code") return;
    if (loading) return;
    if (code.length !== 6) return;
    if (autoSubmittedFor.current === code) return;
    autoSubmittedFor.current = code;
    void verifyCode();
  }, [code, step]);

  // Guard AFTER all hooks so hook count is identical on every render
  // (rules-of-hooks). A return before the second useEffect above would
  // call a different number of hooks when `enabled` flips.
  if (!enabled) return null;

  const settlingAuto = settling?.autoPending ?? false;

  return (
    <div className="space-y-2.5">
      {dividerLabel && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-xs text-muted-foreground">{dividerLabel}</span>
          <div className="flex-1 h-px bg-border/50" />
        </div>
      )}
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
          className="w-full h-11 flex items-center justify-center gap-3 border border-border/60 rounded-xl bg-card hover:bg-muted/50 hover:border-border transition-all duration-150 active:scale-[0.97] font-medium text-sm press-spring"
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
          and is inside the settle window. Never blocks the attempt. */}
      {step === "pristine" && channelStatus === "settling" && (
        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          قناة <span lang="en">WhatsApp</span> ربطت للتو — تُهيَّأ الآن وتصبح جاهزة خلال أقل من
          دقيقة
        </p>
      )}
      {/* r95 honest hint — only when the live probe says the channel is
          configured but not currently paired (settling excluded — it
          has its own copy above). Never blocks the attempt: pairing can
          complete at any moment. */}
      {step === "pristine" &&
        channelStatus &&
        channelStatus !== "ready" &&
        channelStatus !== "settling" && (
          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            قناة <span lang="en">WhatsApp</span> قيد الربط مؤقتاً — يمكنك المحاولة، أو استخدم Google
            / Telegram الآن
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
                  disabled={loading || settlingAuto}
                  dir="ltr"
                  enterKeyHint="done"
                  className="flex-1 h-11 rounded-xl border border-border/60 bg-card px-3 text-left text-base outline-none focus:border-primary/50 disabled:opacity-50"
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
                      إرسال
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground text-center">
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
                  className="flex-1 h-11 rounded-xl border border-border/60 bg-card px-3 text-center tracking-widest text-base outline-none focus:border-primary/50 disabled:opacity-50"
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
                      className="h-11 w-11 rounded-xl border border-border/60 bg-card text-muted-foreground hover:text-foreground hover:border-border flex items-center justify-center transition-all active:scale-95 disabled:opacity-50"
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
              Latin-digit M:SS countdown (never the code itself). */}
              {expiresAt !== null &&
                (expiryLeft > 0 ? (
                  <p className="text-[11px] text-muted-foreground text-center">
                    ينتهي خلال{" "}
                    <span dir="ltr" className="tabular-nums">
                      {formatMSS(expiryLeft)}
                    </span>
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground text-center">
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
              <>
                قناة <span lang="en">WhatsApp</span> ربطت للتو — تُهيَّأ الآن وستُرسل الرمز تلقائيًا
                خلال أقل من دقيقة
              </>
            ) : (
              <>
                ما زالت قناة <span lang="en">WhatsApp</span> قيد التهيئة — أعد المحاولة أو استخدم
                Google / Telegram
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
          <p className="text-xs text-destructive text-center leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  );
}
