import { useAuth } from "@/lib/auth";
import { isFirebaseAuthConfigured } from "@/lib/firebase";
import { exchangeCurrentFirebaseUser, requireFirebaseAuth } from "@/lib/firebase-auth";
import { ConfirmationResult, RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { Loader2, Phone, RotateCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useLocation } from "wouter";

interface FirebasePhoneSignInProps {
  dividerLabel?: string;
}

const COOLDOWN_TIME = 60;

export function FirebasePhoneSignIn({ dividerLabel }: FirebasePhoneSignInProps) {
  const recaptchaId = useId().replace(/:/g, "");
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

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
    if (message.includes("فشل إنشاء جلسة آمنة")) return "تعذّر إنشاء الجلسة. حاول مرة أخرى.";
    if (message.includes("لم يتم إكمال تسجيل الدخول"))
      return "لم يتم إكمال تسجيل الدخول. حاول مرة أخرى.";
    return message;
  };

  const sendCode = async () => {
    setError("");
    setLoading(true);
    try {
      const auth = requireFirebaseAuth();
      const appVerifier = new RecaptchaVerifier(auth, recaptchaId, { size: "invisible" });
      const result = await signInWithPhoneNumber(auth, toE164LibyanPhone(phone), appVerifier);
      setConfirmation(result);
      setCooldown(COOLDOWN_TIME);
    } catch (err: unknown) {
      const errorMessage = (err as Error)?.message || "تعذّر إرسال كود التحقق";
      setError(getFriendlyError(errorMessage));
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
    } finally {
      setLoading(false);
    }
  };

  const resetFlow = () => {
    setConfirmation(null);
    setCode("");
    setError("");
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
      <div id={recaptchaId} />
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
