// R158 (hooks lane — decomposition): extracted verbatim from
// components/auth/WhatsAppPhoneSignIn.tsx (moved there by R167-C/F19) —
// the phone/code/cooldown/
// settling/expiry OTP state machine (the 10 useState atoms, the 3 refs,
// the 4 effects and the sendCode/verifyCode/resetFlow/paste handlers)
// moved here; the component is a presentational shell consuming this
// hook (byte-identical DOM + event semantics — the
// whatsapp-phone-sign-in render suite pins them). The pure digit/phone
// normalizers keep their exported names (the test suite imports them
// from the component's address, which re-exports them).
import { useAuth } from "@/lib/auth";
import { readApiError } from "@/components/checkout/checkout-errors";
import { getErrorMessage } from "@/lib/errors";
import { customFetch } from "@workspace/api-client-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

const COOLDOWN_DEFAULT = 60;
/** 96-F2 (R96-A4 §1.3E): settling auto-retry budget before the manual button takes over. */
const SETTLING_MAX_AUTO_RETRIES = 2;
/** 96-F2 (R96-A4 §1.3E): wait when the backend omits/garbles retry_after_sec — keeps the «أقل من دقيقة» copy honest. */
const SETTLING_FALLBACK_WAIT_SEC = 30;

/**
 * 97-F5 (R97-A4 §8 / F-05 — P2): Arabic-Indic (٠-٩) and Persian (۰-۹)
 * digit CONVERTER — the exact pattern the wallet's amount sanitizer
 * has used since 96-F6 (wallet.tsx sanitizeAmountInput). An
 * Arabic-locale keyboard, or a phone number copied from an Arabic
 * contact card / OTP written in Arabic-Indic digits, delivers these
 * glyphs; the old `raw.replace(/\D/g, "")` DELETED them (JS `\D` is
 * [^0-9] — the Arabic digits are non-digit to it), so pasting
 * «+٢١٨٩١٠٠٨٩٩٧٥» emptied the field and showed «رقم الهاتف غير صالح» —
 * the PRIMARY sign-in path silently locked for Libyan users. Both
 * the phone normalizer and the OTP extractor below now CONVERT first.
 */
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toLatinDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

/**
 * 96-F2 (R96-A4 §3.2): client-side phone normalization mirroring the
 * backend normalizeLibyanPhone contract. After converting Arabic-Indic
 * / Persian digits to Latin (97-F5 / F-05) and stripping non-digits (a
 * pasted "+" disappears here), international prefixes are removed so
 * the stored value is always the LOCAL form:
 *   "+218 91 345 6789"   → "913456789"
 *   "00218913456789"     → "913456789"
 *   "+2180913456789"    → "0913456789"
 *   "0913456789"         → "0913456789" (local form untouched)
 *   "+٢١٨٩١٠٠٨٩٩٧٥"     → "910089975"  (Arabic-Indic paste, 97-F5)
 * "00218" is checked BEFORE "218" ("00218" starts with "00", not
 * "218"). The digit cap stays 10 — the 9-digit local part plus the
 * optional leading 0.
 */
export function normalizePhoneInput(raw: string): string {
  let digits = toLatinDigits(raw).replace(/\D/g, "");
  if (digits.startsWith("00218")) digits = digits.slice(5);
  else if (digits.startsWith("218")) digits = digits.slice(3);
  return digits.slice(0, 10);
}

/**
 * Extract the OTP from any pasted text. Converts Arabic-Indic /
 * Persian digits first (97-F5 / F-05 — an OTP copied from a
 * notification written in Arabic numerals must CONVERT, not vanish),
 * strips non-digits, takes the first 6 — so pasting the whole
 * WhatsApp message works:
 *   "SubNation — رمز التحقق\n\n123456\n\nصالح لمدة 5 دقائق…"  →  "123456"
 *   "رمزك هو ١٢٣٤٥٦"  →  "123456"
 */
export function extractOtpDigits(input: string): string {
  return toLatinDigits(input).replace(/\D/g, "").slice(0, 6);
}

/**
 * 96-F2 (R96-A4 §4.1): single error funnel — every failure path in
 * this flow goes through the shared getErrorMessage() instead of
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

/**
 * 93-C5 / F-15 (A4 #3): the sign-in result hand-off — called INSTEAD of
 * the default navigate when the host page owns the post-login routing
 * (e.g. the login page's ?redirect= target).
 */
export interface UseWhatsAppOtpOptions {
  onSuccess?: () => void;
}

/**
 * The WhatsApp OTP state machine (R158 extraction): phone/code/step/
 * loading/error/cooldown, the 96-F2 settling auto-retry, the OTP
 * expiry countdown and the 6-digit auto-submit. The component
 * consuming it renders the two-step form; everything networked or
 * timed lives here.
 */
export function useWhatsAppOtp({ onSuccess }: UseWhatsAppOtpOptions = {}) {
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
  // R102: `wake` selects honest copy for the gateway cold-wake variant
  // (Render-Free idle sleep) vs a freshly-linked channel — same
  // auto-retry machinery, different explanation.
  const [settling, setSettling] = useState<{
    autoPending: boolean;
    wake?: boolean;
  } | null>(null);
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

  // R144-C2 (L16-3): the parsed error envelope customFetch's ApiError
  // carries on `.data` — the SAME shape the old inline
  // `res.json().catch(() => ({}))` fed every !res.ok branch below.
  // Null for network-level and parse-level failures, which belong to the
  // shared network-copy arm. R146 (components audit F4): the duck-type +
  // `.data` cast now delegates to the shared readApiError reader
  // (checkout-errors.ts) — this was its third local copy.
  function apiErrorEnvelope(err: unknown): {
    success?: boolean;
    error?: string;
    expires_at?: string;
    details?: { reason?: string; retry_after_sec?: number };
    token?: string;
    is_new_user?: boolean;
  } | null {
    return (
      (readApiError(err)?.data as NonNullable<ReturnType<typeof apiErrorEnvelope>> | undefined) ??
      null
    );
  }

  async function sendCode() {
    setError("");
    if (!phone || phone.length < 9) {
      setError("رقم الهاتف غير صالح");
      return;
    }
    setLoading(true);
    try {
      // R144-C2 (L16-3): rides customFetch — same URL/method/body; non-2xx
      // throws ApiError whose `.data` IS the parsed envelope the old
      // inline parse fed every !res.ok branch, so the settling /
      // gateway_waking 503 detail arms and the single error funnel read
      // the SAME shape; the previously UNBOUNDED OTP POST gains the 20 s
      // budget (a business 503 whatsapp_settling never matches the
      // boot-gate marker, so it is never retried transparently).
      const data = await customFetch<{
        success?: boolean;
        error?: string;
        expires_at?: string;
        details?: { reason?: string; retry_after_sec?: number };
      }>("/api/auth/whatsapp/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      // Judgment call (disclosed): a 200 whose body is NOT valid JSON
      // used to fall through the `.catch(() => ({}))` as {} — treated as
      // SUCCESS (step "code"). The wrapper now throws ResponseParseError
      // into the network-copy arm — a proxy error page can no longer
      // advance the OTP step. Strictly safer, copy-level change only.
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
      // R144-C2: ApiError branch = the old !res.ok arm, verbatim.
      const body = apiErrorEnvelope(err);
      if (body) {
        // 96-F2 (R96-A4 §1.3E): the channel was JUST linked and is
        // still settling (sender-key / app-state propagation — the
        // production "Waiting for this message" window). Informational,
        // NEVER error-styled: honest copy, auto-retry after
        // retry_after_sec, max 2 auto-retries, then a manual button.
        // This 503 is NOT a rate limit — no cooldown is burned.
        // R102 (cold-wake, R102-B F3): gateway_waking (the Render-Free
        // gateway booting after idle sleep) rides the SAME auto-retry
        // path — the first OTP after a sleep period used to hard-fail
        // 502 and force a manual re-tap.
        if (
          body.details?.reason === "whatsapp_settling" ||
          body.details?.reason === "gateway_waking"
        ) {
          setError("");
          const raw = Number(body.details.retry_after_sec);
          const waitSec =
            Number.isFinite(raw) && raw > 0
              ? Math.min(60, Math.max(3, Math.ceil(raw)))
              : SETTLING_FALLBACK_WAIT_SEC;
          if (settlingRetriesRef.current < SETTLING_MAX_AUTO_RETRIES) {
            settlingRetriesRef.current += 1;
            setSettling({
              autoPending: true,
              wake: body.details?.reason === "gateway_waking",
            });
            cancelSettlingTimer(settlingTimerRef);
            settlingTimerRef.current = window.setTimeout(() => {
              settlingTimerRef.current = null;
              void sendCode();
            }, waitSec * 1000);
          } else {
            // Auto-retry budget spent — keep the honest banner, hand
            // control back to the user (send button re-enabled).
            setSettling({
              autoPending: false,
              wake: body.details?.reason === "gateway_waking",
            });
          }
          return;
        }
        clearSettling();
        // 96-F2 (R96-A4 §4.1): single error funnel — no raw data.error.
        setError(otpErrorMessage(body, "تعذّر إرسال الرمز"));
        if (body.details?.retry_after_sec) {
          setCooldown(body.details.retry_after_sec);
        }
        return;
      }
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
      // R144-C2 (L16-3): rides customFetch — same URL/method/body; a
      // missing-token 200 keeps the old `!data.token` arm verbatim,
      // non-2xx arrives as ApiError whose `.data` IS the parsed envelope
      // the old `!res.ok` arm fed otpErrorMessage, and the previously
      // UNBOUNDED verify POST gains the 20 s budget.
      const data = await customFetch<{
        token?: string;
        error?: string;
        // L1-1 (R143): the verify mint returns is_new_user (the same
        // contract the Firebase + Telegram session mints carry) — read
        // so the default navigation can route a brand-new user to the
        // onboarding welcome instead of /.
        is_new_user?: boolean;
      }>("/api/auth/whatsapp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, referralCode: getReferralCode() }),
      });
      if (!data.token) {
        // 96-F2 (R96-A4 §4.1): single error funnel — no raw data.error.
        setError(otpErrorMessage(data, "فشل التحقق من الرمز"));
        return;
      }
      setToken(data.token);
      // 93-C5 / F-15: redirect target (guarded checkout, cart, …) instead
      // of the hardcoded home — same contract as AuthProviders' onSuccess.
      // L1-1 (R143): the orphaned onboarding journey — with no page-level
      // onSuccess (no explicit ?redirect= target), a brand-new user now
      // lands on /onboarding instead of /; the page's own gate bounces
      // already-onboarded users home so re-entry is safe.
      if (onSuccess) onSuccess();
      else navigate(data.is_new_user === true ? "/onboarding" : "/");
    } catch (err) {
      // R144-C2: ApiError branch = the old !res.ok arm (envelope →
      // otpErrorMessage); everything else keeps the old catch arm's
      // shared Arabic network copy verbatim.
      const body = apiErrorEnvelope(err);
      if (body) {
        setError(otpErrorMessage(body, "فشل التحقق من الرمز"));
        return;
      }
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
  // re-fire the effect on every render. Keying on (step, code, loading)
  // is the correct one-shot semantics here.)
  // A5-F7 (R120-B2): `loading` is a dep so the 6th digit landing while a
  // resend/settle request is in flight still auto-submits once that
  // request settles — the effect used to bail on `if (loading) return`
  // with deps [code, step] only, so the bail path never re-fired and the
  // verify silently no-op'd. The `autoSubmittedFor` ref still guarantees
  // exactly one submit per code value.
  useEffect(() => {
    if (step !== "code") return;
    if (loading) return;
    if (code.length !== 6) return;
    if (autoSubmittedFor.current === code) return;
    autoSubmittedFor.current = code;
    void verifyCode();
    // verifyCode is intentionally omitted (the comment above): keying on
    // (step, code, loading) is the one-shot semantic; autoSubmittedFor
    // guards the single submit per code value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step, loading]);

  const settlingAuto = settling?.autoPending ?? false;

  return {
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
  };
}
