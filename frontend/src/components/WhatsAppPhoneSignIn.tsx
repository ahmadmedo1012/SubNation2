import { useAuth } from "@/lib/auth";
import { Loader2, MessageCircle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

/**
 * WhatsApp phone sign-in / registration.
 *
 * Two-step flow that mirrors `FirebasePhoneSignIn`:
 *   1. User enters Libyan phone (9- or 10-digit local form).
 *   2. We POST to /api/auth/whatsapp/start — backend sends a 6-digit
 *      OTP via OpenWA. The cleartext code is NEVER returned to us.
 *   3. User enters the code received on WhatsApp.
 *   4. We POST to /api/auth/whatsapp/verify — backend validates,
 *      issues JWT + httpOnly cookie, returns { token, is_new_user }.
 *   5. We store the token via the auth context and navigate to /.
 *
 * Coexists with the existing Firebase Phone OTP form on the same page;
 * neither blocks the other. The component renders nothing if the
 * gateway isn't enabled (caller decides whether to mount it via
 * `enabled` prop, typically backed by a /api/auth/providers probe).
 */

interface WhatsAppPhoneSignInProps {
  /** When false, the component renders nothing. */
  enabled?: boolean;
  /** Optional divider label rendered above the form. */
  dividerLabel?: string;
}

const COOLDOWN_DEFAULT = 60;

export function WhatsAppPhoneSignIn({
  enabled = true,
  dividerLabel,
}: WhatsAppPhoneSignInProps) {
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!enabled) return null;

  // Read referral from URL — both phone OTP paths read it independently
  // so this is consistent with FirebasePhoneSignIn.
  function getReferralCode(): string | undefined {
    if (typeof window === "undefined") return undefined;
    const ref = new URLSearchParams(window.location.search)
      .get("ref")
      ?.trim()
      .toUpperCase()
      .slice(0, 16);
    return ref || undefined;
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
        details?: { reason?: string; retry_after_sec?: number };
      };
      if (!res.ok) {
        setError(data.error ?? "تعذّر إرسال الرمز");
        if (data.details?.retry_after_sec) {
          setCooldown(data.details.retry_after_sec);
        }
        return;
      }
      setStep("code");
      setCooldown(COOLDOWN_DEFAULT);
    } catch {
      setError("تعذّر الاتصال بالخادم، حاول مجدداً");
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
        setError(data.error ?? "فشل التحقق من الرمز");
        return;
      }
      setToken(data.token);
      navigate("/");
    } catch {
      setError("تعذّر الاتصال بالخادم، حاول مجدداً");
    } finally {
      setLoading(false);
    }
  }

  function resetFlow() {
    setStep("phone");
    setCode("");
    setError("");
  }

  return (
    <div className="space-y-2.5">
      {dividerLabel && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-xs text-muted-foreground">{dividerLabel}</span>
          <div className="flex-1 h-px bg-border/50" />
        </div>
      )}
      {step === "phone" ? (
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
            className="h-11 px-4 rounded-xl bg-[#25D366] text-white font-bold text-sm disabled:opacity-60 flex items-center gap-2 transition-all active:scale-95"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : cooldown > 0 ? (
              <span className="text-xs">{cooldown}s</span>
            ) : (
              <MessageCircle className="w-4 h-4" />
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
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 animate-in fade-in slide-in-from-top-1">
          <p className="text-xs text-destructive text-center leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  );
}
