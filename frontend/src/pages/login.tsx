import { AuthProviders } from "@/components/AuthProviders";
import { FirebasePhoneSignIn } from "@/components/FirebasePhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useLogin } from "@workspace/api-client-react";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation } from "wouter";
import { getErrorMessage } from "../lib/errors";

interface LoginFormData {
  phone: string;
  password: string;
}

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { setToken } = useAuth();
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    defaultValues: {
      phone: "",
      password: "",
    },
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess(data) {
        setToken(data.token ?? null);
        navigate("/");
      },
      onError(err: unknown) {
        setError(getErrorMessage(err));
      },
    },
  });

  const onSubmit = (data: LoginFormData) => {
    setError("");
    loginMutation.mutate({ data });
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    e.target.value = digits;
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 relative overflow-hidden bg-background">
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
          <p className="text-muted-foreground text-sm mt-1.5">أدخل بيانات حسابك للمتابعة</p>
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

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-sm font-bold">
                رقم الهاتف
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="091XXXXXXX"
                {...register("phone", {
                  required: "رقم الهاتف مطلوب",
                  validate: (value) => {
                    const digits = value.replace(/\D/g, "");
                    if (digits.length !== 10) return "يجب أن يكون الرقم 10 أرقام";
                    const prefix = digits.slice(0, 3);
                    if (!["091", "092", "093", "094"].includes(prefix)) {
                      return "يجب أن يبدأ الرقم بـ 091 أو 092 أو 093 أو 094";
                    }
                    return true;
                  },
                })}
                onChange={handlePhoneChange}
                dir="ltr"
                className="h-11 text-left pl-3 rounded-xl border-border/55 focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all duration-200 bg-card"
                maxLength={10}
                autoComplete="tel"
                aria-describedby={errors.phone ? "phone-error" : error ? "login-error" : undefined}
              />
              {errors.phone && (
                <p id="phone-error" className="text-xs text-destructive flex items-center gap-1">
                  {errors.phone.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-bold">
                  كلمة المرور
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  نسيت كلمة المرور؟
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  {...register("password", {
                    required: "كلمة المرور مطلوبة",
                    minLength: {
                      value: 8,
                      message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل",
                    },
                  })}
                  className="pl-10 h-11 rounded-xl border-border/55 focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all duration-200 bg-card"
                  autoComplete="current-password"
                  aria-describedby={
                    errors.password ? "password-error" : error ? "login-error" : undefined
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-lg touch-target flex items-center justify-center"
                  aria-label={showPass ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="text-xs text-destructive flex items-center gap-1">
                  {errors.password.message}
                </p>
              )}
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
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  جارٍ تسجيل الدخول...
                </>
              ) : (
                "تسجيل الدخول"
              )}
            </Button>
          </form>

          <div className="mt-5">
            <AuthProviders dividerLabel="أو" />
          </div>

          <div className="mt-4">
            <FirebasePhoneSignIn dividerLabel="أو عبر كود الهاتف" />
          </div>

          <div className="mt-5 text-center text-sm text-muted-foreground">
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
