import { AuthErrorBanner } from "@/components/AuthErrorBanner";
import { AuthProviders } from "@/components/AuthProviders";
import { FirebasePhoneSignIn } from "@/components/FirebasePhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { CheckCircle, Gift } from "lucide-react";
import { useMemo } from "react";
import { Link } from "wouter";

/**
 * Public register page — passwordless.
 *
 * Identical auth surface to /login (Phone OTP + Google + Telegram
 * when enabled). The only differences from /login:
 *   - active tab on "حساب جديد"
 *   - referral context banner reading ?ref= from URL
 *   - copy emphasises account creation over sign-in
 *
 * Both auth paths (Phone OTP via FirebasePhoneSignIn, Google via
 * AuthProviders) ALREADY pick up `?ref=` from the URL on the client
 * side and pass it to /api/auth/firebase/session — no separate form
 * field is needed.
 */

function readReferralFromUrl(): string {
  if (typeof window === "undefined") return "";
  const ref = new URLSearchParams(window.location.search).get("ref");
  return (ref ?? "").trim().toUpperCase().slice(0, 16);
}

export default function RegisterPage() {
  const referral = useMemo(() => readReferralFromUrl(), []);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 py-8 relative overflow-hidden bg-background">
      {/* Ambient background glows */}
      <div className="absolute top-[-10%] left-[15%] w-80 h-80 bg-primary/5 rounded-full blur-[80px] pointer-events-none blob-drift" />
      <div className="absolute bottom-[-5%] right-[10%] w-64 h-64 bg-primary/4 rounded-full blur-[60px] pointer-events-none blob-drift-slow" />
      <div className="absolute inset-0 dot-grid opacity-20 pointer-events-none" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-6 reveal-up">
          <div className="flex justify-center mb-4">
            <Logo size="lg" />
          </div>
        </div>

        {/* Tabs — clear login vs register */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted/30 border border-border/40 rounded-2xl mb-5 reveal-up stagger-1">
          <Link
            href="/login"
            className="py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors text-center"
          >
            تسجيل الدخول
          </Link>
          <button
            type="button"
            className="py-2.5 rounded-xl text-sm font-bold bg-card text-foreground shadow-sm cursor-default"
            aria-current="page"
          >
            حساب جديد
          </button>
        </div>

        <div className="bg-card border border-border/55 rounded-3xl p-6 shadow-2xl shadow-black/20 reveal-up stagger-2">
          <AuthErrorBanner />

          {/* Referral context banner — emerald + check when applied,
              soft tip when no ?ref= in URL. Both auth paths read the
              URL ref independently, so this is purely for user feedback. */}
          {referral ? (
            <div
              role="status"
              aria-live="polite"
              className="mb-5 p-3 bg-emerald-500/8 border border-emerald-500/22 rounded-xl text-sm text-emerald-400 flex items-center gap-2.5"
            >
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <CheckCircle className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold leading-tight">
                  تم تطبيق رمز الإحالة:{" "}
                  <span className="font-mono tracking-wider">{referral}</span>
                </p>
                <p className="text-[11px] text-emerald-400/80 mt-0.5">
                  ستحصل على <span className="font-bold">5 د.ل</span> مجاناً عند الشحن الأول
                </p>
              </div>
            </div>
          ) : (
            <div className="mb-5 p-2.5 bg-emerald-500/8 border border-emerald-500/18 rounded-xl text-xs text-emerald-400 flex items-center gap-2">
              <Gift className="w-3.5 h-3.5 shrink-0" />
              <span>
                ادعُ صديقاً واحصل على <span className="font-bold">5 د.ل</span> مجاناً
              </span>
            </div>
          )}

          {/* PRIMARY: Phone OTP */}
          <div className="space-y-2">
            <div className="text-center">
              <p className="text-sm font-bold">إنشاء حساب برقم الهاتف</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                نرسل لك رمز تحقق — يتم إنشاء الحساب تلقائياً عند تأكيد الرمز
              </p>
            </div>
            <FirebasePhoneSignIn />
          </div>

          {/* Single divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border/50" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">أو</span>
            <div className="flex-1 h-px bg-border/50" />
          </div>

          {/* SECONDARY: Google + Telegram (when enabled in admin settings) */}
          <AuthProviders />
        </div>

        {/* Footer link to login */}
        <p className="mt-5 text-center text-sm text-muted-foreground reveal-up stagger-3">
          لديك حساب بالفعل؟{" "}
          <Link
            href="/login"
            className="text-primary font-bold hover:text-primary/80 transition-colors"
          >
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
