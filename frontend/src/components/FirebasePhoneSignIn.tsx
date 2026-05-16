import { useAuth } from "@/lib/auth";
import { isFirebaseAuthConfigured } from "@/lib/firebase";
import { exchangeCurrentFirebaseUser, requireFirebaseAuth } from "@/lib/firebase-auth";
import {
  type Auth,
  type ConfirmationResult,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";
import { Loader2, Phone, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLocation } from "wouter";

interface FirebasePhoneSignInProps {
  dividerLabel?: string;
}

const COOLDOWN_TIME = 60;

/**
 * Errors that indicate the current `RecaptchaVerifier` instance is in a
 * poisoned state and must be cleared + rebuilt before the user can retry.
 */
function isVerifierPoisonedError(message: string): boolean {
  return (
    message.includes("auth/captcha-check-failed") ||
    message.includes("auth/code-expired") ||
    message.includes("auth/expired-recaptcha-token") ||
    message.includes("recaptcha-not-enabled")
  );
}

export function FirebasePhoneSignIn({ dividerLabel }: FirebasePhoneSignInProps) {
  // Stable id for the recaptcha container, scoped to this component instance.
  const recaptchaId = useId().replace(/:/g, "");
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // ── Verifier lifecycle ─────────────────────────────────────────────────────
  //
  // The RecaptchaVerifier owns a DOM widget. We must:
  //  - Create exactly ONE per component mount (avoid stacking widgets).
  //  - Clean it up when the component unmounts (avoid leak / stale handle).
  //  - Rebuild it after an auth/captcha-check-failed or expired-recaptcha-token
  //    error, because the underlying widget is now in a poisoned state.
  //  - Rebuild it when the user resets the phone-input flow (defensive — the
  //    verifier itself doesn't strictly require this, but it keeps the
  //    surface predictable).

  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const authRef = useRef<Auth | null>(null);

  /** Build a fresh RecaptchaVerifier targeting our container id. */
  const buildVerifier = useCallback((auth: Auth): RecaptchaVerifier => {
    return new RecaptchaVerifier(auth, recaptchaId, {
      size: "invisible",
      callback: () => {
        // reCAPTCHA solved automatically (invisible mode). No-op — Firebase
        // proceeds with signInWithPhoneNumber once verify() resolves.
      },
      "expired-callback": () => {
        // The widget's token expired before we used it. Mark the verifier as
        // null so the next sendCode rebuilds it.
        try {
          verifierRef.current?.clear();
        } catch {
          // ignore — clear() can throw if the widget is already gone
        }
        verifierRef.current = null;
      },
    });
  }, [recaptchaId]);

  /** Get a working verifier — building one on first use, reusing afterwards. */
  const getOrBuildVerifier = useCallback(
    async (): Promise<RecaptchaVerifier> => {
      const auth = authRef.current ?? (await requireFirebaseAuth());
      authRef.current = auth;
      if (!verifierRef.current) {
        verifierRef.current = buildVerifier(auth);
      }
      return verifierRef.current;
    },
    [buildVerifier],
  );

  // Eager initialisation — build the verifier as soon as the container exists.
  // This warms up reCAPTCHA so the first sendCode click feels instant.
  useEffect(() => {
    if (!isFirebaseAuthConfigured()) return;
    let cancelled = false;

    (async () => {
      try {
        const auth = await requireFirebaseAuth();
        if (cancelled) return;
        authRef.current = auth;
        // Don't overwrite an existing verifier (StrictMode mounts twice in dev).
        if (!verifierRef.current && document.getElementById(recaptchaId)) {
          verifierRef.current = buildVerifier(auth);
        }
      } catch {
        // Defer error reporting until the user actually tries to send.
      }
    })();

    return () => {
      cancelled = true;
      try {
        verifierRef.current?.clear();
      } catch {
        // ignore — widget may have already been removed from the DOM
      }
      verifierRef.current = null;
      authRef.current = null;
    };
  }, [recaptchaId, buildVerifier]);

  // Cooldown timer for resend.
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [cooldown]);

  if (!isFirebaseAuthConfigured()) return null;

  const referralCode =
    new URLSearchParams(window.location.search).get("ref")?.toUpperCase() ?? undefined;

  const getFriendlyError = (message: string) => {
    if (message.includes("auth/captcha-check-failed"))
      return "فشل التحقق من الكابتشا. حاول مرة أخرى.";
    if (message.includes("auth/invalid-phone-number"))
      return "رقم الهاتف غير صالح. تأكد من كتابته بشكل صحيح.";
    if (message.includes("auth/too-many-requests"))
      return "تم تجاوز عدد المحاولات. انتظر 5 دقائق ثم حاول مجدداً.";
    if (message.includes("auth/code-expired")) return "انتهت صلاحية الكود. اطلب كوداً جديداً.";
    if (message.includes("auth/invalid-verification-code")) return "كود التحقق غير صحيح.";
    if (message.includes("auth/internal-error"))
      return "حدث خطأ داخلي. تأكد من تفعيل خدمة الهاتف في Firebase.";
    if (message.includes("auth/quota-exceeded"))
      return "تجاوزت الحد اليومي لإرسال الرسائل. حاول غداً.";
    if (message.includes("auth/user-disabled"))
      return "تم تعطيل هذا الحساب. يرجى التواصل مع الدعم.";
    if (message.includes("auth/network-request-failed"))
      return "تعذّر الاتصال بالشبكة. تحقق من اتصالك ثم أعد المحاولة.";
    if (message.includes("recaptcha-not-enabled"))
      return "خدمة الكابتشا غير مفعّلة. تواصل مع الدعم.";
    if (message.includes("فشل إنشاء جلسة آمنة")) return "تعذّر إنشاء الجلسة. حاول مرة أخرى.";
    if (message.includes("لم يتم إكمال تسجيل الدخول"))
      return "لم يتم إكمال تسجيل الدخول. حاول مرة أخرى.";
    return message;
  };

  const sendCode = async () => {
    setError("");
    setLoading(true);
    try {
      const verifier = await getOrBuildVerifier();
      const auth = authRef.current!;
      const result = await signInWithPhoneNumber(auth, toE164LibyanPhone(phone), verifier);
      setConfirmation(result);
      setCooldown(COOLDOWN_TIME);
    } catch (err: unknown) {
      const errorMessage = (err as Error)?.message || "تعذّر إرسال كود التحقق";
      setError(getFriendlyError(errorMessage));
      // If the verifier is in a poisoned state, clear it so the next attempt
      // rebuilds a fresh widget.
      if (isVerifierPoisonedError(errorMessage)) {
        try {
          verifierRef.current?.clear();
        } catch {
          // ignore
        }
        verifierRef.current = null;
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!confirmation) return;
    setError("");
    setLoading(true);
    try {
      await confirmation.confirm(code.trim());
      const session = await exchangeCurrentFirebaseUser(referralCode);
      setToken(session.token);
      navigate("/");
    } catch (err: unknown) {
      const errorMessage = (err as Error)?.message || "فشل التحقق من الكود";
      setError(getFriendlyError(errorMessage));
      // Verification failure (wrong code, expired) doesn't poison the
      // verifier, but if the code expired we rebuild on next sendCode.
      if (errorMessage.includes("auth/code-expired")) {
        try {
          verifierRef.current?.clear();
        } catch {
          // ignore
        }
        verifierRef.current = null;
      }
    } finally {
      setLoading(false);
    }
  };

  const resetFlow = () => {
    setConfirmation(null);
    setCode("");
    setError("");
    // Rebuild the verifier proactively so the next sendCode is fresh.
    try {
      verifierRef.current?.clear();
    } catch {
      // ignore
    }
    verifierRef.current = null;
  };

  return (
    <div className="space-y-2.5">
      {dividerLabel && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-xs text-muted-foreground">{dividerLabel}</span>
          <div className="flex-1 h-px bg-border/50" />
        </div>
      )}
      {!confirmation ? (
        <div className="flex gap-2">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="091XXXXXXX"
            disabled={loading}
            dir="ltr"
            className="flex-1 h-11 rounded-xl border border-border/60 bg-card px-3 text-left text-sm outline-none focus:border-primary/50 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={sendCode}
            disabled={loading || phone.length < 9 || cooldown > 0}
            className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 flex items-center gap-2 transition-all active:scale-95"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : cooldown > 0 ? (
              <span className="text-xs">{cooldown}s</span>
            ) : (
              <Phone className="w-4 h-4" />
            )}
            {cooldown > 0 ? "" : "إرسال"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="كود التحقق"
              disabled={loading}
              dir="ltr"
              className="flex-1 h-11 rounded-xl border border-border/60 bg-card px-3 text-center tracking-widest text-sm outline-none focus:border-primary/50 disabled:opacity-50"
            />
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
          <button
            onClick={resetFlow}
            disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            تغيير الرقم
          </button>
        </div>
      )}
      {/*
        reCAPTCHA container. Must remain in the DOM throughout the component's
        lifetime — the RecaptchaVerifier renders an invisible widget inside it
        on first verify(). Removing/re-keying this node would orphan the widget.
      */}
      <div id={recaptchaId} aria-hidden="true" />
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 animate-in fade-in slide-in-from-top-1">
          <p className="text-xs text-destructive text-center leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  );
}

function toE164LibyanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("218")) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return `+218${digits.slice(1)}`;
  if (digits.length === 9) return `+218${digits}`;
  throw new Error("رقم الهاتف غير صالح");
}
