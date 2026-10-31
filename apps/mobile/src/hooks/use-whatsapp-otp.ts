import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { customFetch, type ApiError } from "@workspace/api-client-native";

import { API_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { mintNativeSession } from "@/lib/auth-store";
import { getErrorMessage } from "@/lib/errors";

/**
 * The WhatsApp OTP state machine — a port of the web's
 * frontend/src/hooks/useWhatsAppOtp.ts (the 469-line machine behind
 * WhatsAppPhoneSignIn): phone/code/step/loading/error/cooldown atoms,
 * the settling auto-retry (96-F2), the OTP expiry countdown and the
 * 6-digit auto-submit. The presentational shell lives at
 * src/screens/auth/whatsapp-otp-form.tsx.
 *
 * Native deltas from the web machine (semantics preserved):
 *   • /start rides the shared client's customFetch (same URL, method,
 *     body and error-envelope reads; the base URL + CSRF Origin shim
 *     are bootstrapped once from the root layout).
 *   • /verify rides mintNativeSession — the native session mechanism
 *     (lib/auth-store.ts): POSTs with the Origin header, captures the
 *     `auth_token` JWT from Set-Cookie, stores it in SecureStore.
 *   • The referral code is stashed to AsyncStorage (?ref= at mount
 *     time) instead of read from window.location at click time.
 *   • No clipboard-paste button: RN TextInputs paste natively and the
 *     onChangeText funnel runs the same extractOtpDigits normalizer.
 */

const COOLDOWN_DEFAULT = 60;
/** 96-F2 (R96-A4 §1.3E): settling auto-retry budget before the manual button takes over. */
const SETTLING_MAX_AUTO_RETRIES = 2;
/** 96-F2 (R96-A4 §1.3E): wait when the backend omits/garbles retry_after_sec — keeps the «أقل من دقيقة» copy honest. */
const SETTLING_FALLBACK_WAIT_SEC = 30;

/**
 * 97-F5 (R97-A4 §8 / F-05 — P2): Arabic-Indic (٠-٩) and Persian (۰-۹)
 * digit CONVERTER — ported verbatim from the web hook. An
 * Arabic-locale keyboard, or a phone number copied from an Arabic
 * contact card / OTP written in Arabic-Indic digits, delivers these
 * glyphs; a bare `raw.replace(/\D/g, "")` DELETES them (JS `\D` is
 * [^0-9] — the Arabic digits are non-digit to it), so pasting
 * «+٢١٨٩١٠٠٨٩٩٧٥» would empty the field and show «رقم الهاتف غير صالح» —
 * the PRIMARY sign-in path silently locked for Libyan users. Both the
 * phone normalizer and the OTP extractor below CONVERT first.
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
 * backend normalizeLibyanPhone contract — ported verbatim. After
 * converting Arabic-Indic / Persian digits to Latin and stripping
 * non-digits (a pasted "+" disappears here), international prefixes
 * are removed so the stored value is always the LOCAL form:
 *   "+218 91 345 6789"   → "913456789"
 *   "00218913456789"     → "913456789"
 *   "+2180913456789"     → "0913456789"
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
 * Extract the OTP from any pasted text — ported verbatim. Converts
 * Arabic-Indic / Persian digits first (an OTP copied from a
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
 * 96-F2 (R96-A4 §4.1): single error funnel — ported verbatim. The
 * whatsapp route bodies carry BOTH a precise Arabic `error` string and
 * a generic `code` (INVALID_DATA / UNAUTHORIZED / SERVICE_UNAVAILABLE);
 * feeding the whole body to getErrorMessage would let the generic code
 * table SHADOW the route's specific copy (e.g. «غير مصرح — سجّل دخولك…»
 * for a plain OTP mismatch). So: the precise string is funneled as
 * `error` (getErrorMessage passes it through verbatim), a code-only
 * body maps through the shared Arabic table, and anything else falls
 * back to the caller's context copy.
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

/** Cancels a pending settling auto-retry (stable identity for effect cleanups). */
function cancelSettlingTimer(timer: { current: ReturnType<typeof setTimeout> | null }): void {
  if (timer.current !== null) {
    clearTimeout(timer.current);
    timer.current = null;
  }
}

// ── Referral attribution (the web reads ?ref= from the live URL at
// click time; the native app has no URL bar, so the login route stashes
// the ?ref= param here at mount time and the verify mint reads it back) ──

const PENDING_REFERRAL_KEY = "subnation_pending_referral";

/** Normalize a raw referral code like every auth surface does (trim → uppercase → 16-char cap). */
function normalizeReferralCode(raw: string): string | undefined {
  const normalized = raw.trim().toUpperCase().slice(0, 16);
  return normalized || undefined;
}

/** Stash a `?ref=` code for the post-login signup attribution. */
export async function stashPendingReferral(raw: string): Promise<void> {
  const code = normalizeReferralCode(raw);
  if (!code) return;
  try {
    await AsyncStorage.setItem(PENDING_REFERRAL_KEY, code);
  } catch {
    // Persistence failure must never block the sign-in flow — the
    // attribution is simply lost for this install.
  }
}

/** Read the stashed referral code (undefined when none / unreadable). */
export async function readPendingReferral(): Promise<string | undefined> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
    return raw ? normalizeReferralCode(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Drop the stashed code (the mint consumed the attribution). */
export async function clearPendingReferral(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    // Removing a missing key is a no-op state-wise.
  }
}

/** The parsed error envelope the route bodies carry (the web's apiErrorEnvelope shape). */
interface WhatsappErrorEnvelope {
  success?: boolean;
  error?: string;
  code?: string;
  expires_at?: string;
  details?: { reason?: string; retry_after_sec?: number };
  token?: string;
  is_new_user?: boolean;
}

/** customFetch's ApiError carries the parsed envelope on `.data` (duck-typed, like the web's readApiError). */
function apiErrorEnvelope(err: unknown): WhatsappErrorEnvelope | null {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as ApiError<WhatsappErrorEnvelope>).data;
    return data && typeof data === "object" ? data : null;
  }
  return null;
}

/**
 * 96-F2 (R96-A4 §4.1): the verify funnel — ApiError (customFetch)
 * envelopes ride otpErrorMessage; mintNativeSession throws a plain
 * Error carrying the route's precise Arabic message on `.message` plus
 * the generic `.code`, so it is re-shaped into the envelope (precise
 * wording outranks the code table); anything else gets the shared
 * Arabic network copy.
 */
function verifyErrorMessage(err: unknown): string {
  const envelope = apiErrorEnvelope(err);
  if (envelope) return otpErrorMessage(envelope, "فشل التحقق من الرمز");
  if (err instanceof Error) {
    const coded = err as Error & { code?: string };
    return otpErrorMessage({ error: coded.message, code: coded.code }, "فشل التحقق من الرمز");
  }
  return getErrorMessage(err);
}

/**
 * The sign-in result hand-off — called after the session is stored and
 * `useAuth().signIn` has loaded the profile; the host screen owns the
 * post-login routing (the web's 93-C5 / F-15 contract).
 */
export interface UseWhatsAppOtpOptions {
  onSuccess?: (token: string) => void;
}

/**
 * The WhatsApp OTP state machine: phone/code/step/loading/error/
 * cooldown, the 96-F2 settling auto-retry, the OTP expiry countdown
 * and the 6-digit auto-submit. The component consuming it renders the
 * two-step form; everything networked or timed lives here.
 */
export function useWhatsAppOtp({ onSuccess }: UseWhatsAppOtpOptions = {}) {
  const { signIn } = useAuth();
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
  // `wake` selects honest copy for the gateway cold-wake variant
  // (Render-Free idle sleep) vs a freshly-linked channel.
  const [settling, setSettling] = useState<{
    autoPending: boolean;
    wake?: boolean;
  } | null>(null);
  // 96-F2 (R96-A4 §4.1): OTP TTL (expires_at from /start) → subtle M:SS countdown.
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [expiryLeft, setExpiryLeft] = useState(0);
  // Guards against re-submitting the same 6-digit value twice (e.g.
  // when the auto-submit effect fires after the user has manually
  // tapped "تحقق" but the network request hasn't returned yet).
  const autoSubmittedFor = useRef<string | null>(null);
  // Settling auto-retry bookkeeping (refs: timer identity + budget).
  const settlingRetriesRef = useRef(0);
  const settlingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Rides the shared client (base URL + Origin shim from the root
      // bootstrap) — same URL/method/body as the web; non-2xx throws
      // ApiError whose `.data` IS the parsed envelope the settling /
      // gateway_waking 503 detail arms and the single error funnel read.
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
    } catch (err) {
      const body = apiErrorEnvelope(err);
      if (body) {
        // 96-F2 (R96-A4 §1.3E): the channel was JUST linked and is
        // still settling (sender-key / app-state propagation — the
        // production "Waiting for this message" window). Informational,
        // NEVER error-styled: honest copy, auto-retry after
        // retry_after_sec, max 2 auto-retries, then a manual button.
        // This 503 is NOT a rate limit — no cooldown is burned.
        // R102 (cold-wake): gateway_waking (the Render-Free gateway
        // booting after idle sleep) rides the SAME auto-retry path.
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
            settlingTimerRef.current = setTimeout(() => {
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
      // The native session mechanism (lib/auth-store.ts): POSTs with
      // the CSRF Origin header, captures the `auth_token` JWT from
      // Set-Cookie, stores it in SecureStore, returns it. The mint
      // succeeds for new AND returning users identically — the backend
      // runs findOrCreateWhatsAppUser server-side.
      const referral = await readPendingReferral();
      const token = await mintNativeSession(
        "/api/auth/whatsapp/verify",
        {
          phone,
          code,
          // The live route reads `referralCode` (camelCase) while the
          // OpenAPI schema declares `referral_code` — send BOTH so the
          // attribution lands regardless of which shape the deployed
          // backend reads.
          ...(referral ? { referral_code: referral, referralCode: referral } : {}),
        },
        API_URL,
      );
      if (referral) {
        // The attribution was passed to the mint — the stash is spent.
        await clearPendingReferral();
      }
      // Load the profile (AuthProvider's getMe) BEFORE the host routes,
      // so the new-user decision below reads fresh state.
      await signIn(token);
      onSuccess?.(token);
    } catch (err) {
      setError(verifyErrorMessage(err));
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

  // Auto-submit when 6 digits are entered, exactly once per code value.
  // This is the canonical OTP UX — the moment the user finishes typing
  // (or paste-fills) the code, we verify without requiring an extra tap.
  // `loading` is a dep so the 6th digit landing while a resend/settle
  // request is in flight still auto-submits once that request settles;
  // the `autoSubmittedFor` ref still guarantees exactly one submit per
  // code value. (verifyCode is intentionally omitted — keying on
  // (step, code, loading) is the one-shot semantic.)
  useEffect(() => {
    if (step !== "code") return;
    if (loading) return;
    if (code.length !== 6) return;
    if (autoSubmittedFor.current === code) return;
    autoSubmittedFor.current = code;
    void verifyCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step, loading]);

  const settlingAuto = settling?.autoPending ?? false;

  return {
    phone,
    setPhone,
    code,
    setCode,
    step,
    // The pristine → phone reveal (the web machine's exposed setStep —
    // the pristine ProviderButton's press handler is the only caller).
    setStep,
    loading,
    error,
    cooldown,
    settling,
    expiresAt,
    expiryLeft,
    settlingAuto,
    sendCode,
    verifyCode,
    resetFlow,
  };
}
