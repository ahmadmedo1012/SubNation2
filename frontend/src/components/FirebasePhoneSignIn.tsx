import { useId, useState } from "react";
import { ConfirmationResult, RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { Loader2, Phone } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { exchangeCurrentFirebaseUser, requireFirebaseAuth } from "@/lib/firebase-auth";
import { isFirebaseAuthConfigured } from "@/lib/firebase";

interface FirebasePhoneSignInProps {
  dividerLabel?: string;
}

export function FirebasePhoneSignIn({ dividerLabel }: FirebasePhoneSignInProps) {
  const recaptchaId = useId().replace(/:/g, "");
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!isFirebaseAuthConfigured()) return null;

  const referralCode =
    new URLSearchParams(window.location.search).get("ref")?.toUpperCase() ?? undefined;

  const sendCode = async () => {
    setError("");
    setLoading(true);
    try {
      const auth = requireFirebaseAuth();
      const appVerifier = new RecaptchaVerifier(auth, recaptchaId, { size: "invisible" });
      const result = await signInWithPhoneNumber(auth, toE164LibyanPhone(phone), appVerifier);
      setConfirmation(result);
    } catch (err: any) {
      setError(err.message ?? "تعذّر إرسال كود التحقق");
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
    } catch (err: any) {
      setError(err.message ?? "فشل التحقق من الكود");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {dividerLabel && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-xs text-muted-foreground/60">{dividerLabel}</span>
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
            dir="ltr"
            className="flex-1 h-11 rounded-xl border border-border/60 bg-card px-3 text-left text-sm outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={sendCode}
            disabled={loading || phone.length < 9}
            className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
            إرسال
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="كود التحقق"
            dir="ltr"
            className="flex-1 h-11 rounded-xl border border-border/60 bg-card px-3 text-center tracking-widest text-sm outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={verifyCode}
            disabled={loading || code.length < 6}
            className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            تحقق
          </button>
        </div>
      )}
      <div id={recaptchaId} />
      {error && <p className="text-xs text-destructive text-center pt-1">{error}</p>}
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
