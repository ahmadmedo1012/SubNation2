import { AuthProviders } from "@/components/AuthProviders";
import { FirebasePhoneSignIn } from "@/components/FirebasePhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useLogin } from "@workspace/api-client-react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { getErrorMessage } from "../lib/errors";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { setToken } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");

  const loginMutation = useLogin({
    mutation: {
      onSuccess(data) {
        setToken(data.token ?? null);
        navigate("/");
      },
      onError(err: any) {
        setError(getErrorMessage(err));
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ data: { phone, password } });
  };

  const handlePhoneChange = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-background">
      {/* Ambient background glows */}
      <div className="absolute top-[-10%] right-[15%] w-96 h-96 bg-primary/5 rounded-full blur-[90px] pointer-events-none blob-drift" />
      <div className="absolute bottom-[-5%] left-[10%] w-72 h-72 bg-primary/4 rounded-full blur-[70px] pointer-events-none blob-drift-slow" />
      <div className="absolute inset-0 dot-grid opacity-25 pointer-events-none" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8 reveal-up">
          <div className="flex justify-center mb-5">
            <Logo size="lg" />
          </div>
          <h1 className="text-xl font-black tracking-tight">تسجيل الدخول</h1>
          <p className="text-muted-foreground/65 text-sm mt-1.5">أدخل بيانات حسابك للمتابعة</p>
        </div>

        <div className="bg-card border border-border/55 rounded-3xl p-6 shadow-2xl shadow-black/25 reveal-up stagger-2">
          {/* Firebase recommendation banner */}
          <div className="flex items-start gap-3 bg-primary/5 border border-primary/15 rounded-xl px-4 py-3 mb-5">
            <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-bold text-primary">نوصي باستخدام Firebase</span> لتسجيل الدخول
              عبر Google أو كود الهاتف - أكثر أماناً وأسهل.
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-sm font-bold">
                رقم الهاتف
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="091XXXXXXX"
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                required
                dir="ltr"
                className="h-11 text-left pl-3 rounded-xl border-border/55 focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all duration-200 bg-card"
                maxLength={10}
                autoComplete="tel"
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-bold">
                  كلمة المرور
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground/70 hover:text-primary transition-colors"
                >
                  نسيت كلمة المرور؟
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pl-10 h-11 rounded-xl border-border/55 focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all duration-200 bg-card"
                  autoComplete="current-password"
                  aria-describedby={error ? "login-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors p-1 -m-1 rounded-lg touch-target flex items-center justify-center"
                  aria-label={showPass ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                id="login-error"
                role="alert"
                aria-live="polite"
                className={`flex items-center gap-2 text-destructive text-sm bg-destructive/8 border border-destructive/20 px-3.5 py-2.5 rounded-xl ${error ? "shake" : ""}`}
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-bold text-base shadow-xl shadow-primary/25 transition-all active:scale-[0.97] cta-glow rounded-xl mt-1"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
            </Button>
          </form>

          <div className="mt-5">
            <AuthProviders dividerLabel="أو" />
          </div>

          <div className="mt-4">
            <FirebasePhoneSignIn dividerLabel="أو عبر كود الهاتف" />
          </div>

          <div className="mt-5 text-center text-sm text-muted-foreground/65">
            ليس لديك حساب؟{" "}
            <Link
              href="/register"
              className="text-primary font-bold hover:text-primary/80 transition-colors"
            >
              إنشاء حساب جديد
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
