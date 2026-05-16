import { AuthProviders } from "@/components/AuthProviders";
import { FirebasePhoneSignIn } from "@/components/FirebasePhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useLogin } from "@workspace/api-client-react";
import { AlertCircle, ChevronDown, Eye, EyeOff, Loader2 } from "lucide-react";
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
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    defaultValues: { phone: "", password: "" },
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
        {/* Logo */}
        <div className="text-center mb-6 reveal-up">
          <div className="flex justify-center mb-4">
            <Logo size="lg" />
          </div>
        </div>

        {/* Tabs — clear login vs register */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted/30 border border-border/40 rounded-2xl mb-5 reveal-up stagger-1">
          <button
            type="button"
            className="py-2.5 rounded-xl text-sm font-bold bg-card text-foreground shadow-sm cursor-default"
            aria-current="page"
          >
            تسجيل الدخول
          </button>
          <Link
            href="/register"
            className="py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors text-center"
          >
            حساب جديد
          </Link>
        </div>

        <div className="bg-card border border-border/55 rounded-3xl p-6 shadow-2xl shadow-black/25 reveal-up stagger-2">
          {/* Top-of-card error banner — always visible when set */}
          {error && (
            <div
              id="login-error"
              role="alert"
              aria-live="polite"
              className="flex items-start gap-2 text-destructive text-sm bg-destructive/8 border border-destructive/20 px-3.5 py-2.5 rounded-xl shake mb-4"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* PRIMARY: Phone OTP — recommended path */}
          <div className="space-y-2">
            <div className="text-center">
              <p className="text-sm font-bold">تسجيل الدخول برقم الهاتف</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                نرسل لك رمز تحقق عبر رسالة نصية — لا تحتاج كلمة مرور
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

          {/* SECONDARY: Google */}
          <AuthProviders />

          {/* TERTIARY: Password fallback (collapsed by default) */}
          <div className="mt-4 border-t border-border/30 pt-4">
            <button
              type="button"
              onClick={() => setShowPasswordForm((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 rounded-lg"
              aria-expanded={showPasswordForm}
              aria-controls="password-login-form"
            >
              <span>لدي حساب بكلمة مرور</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${showPasswordForm ? "rotate-180" : ""}`}
              />
            </button>

            {showPasswordForm && (
              <form
                id="password-login-form"
                onSubmit={handleSubmit(onSubmit)}
                className="space-y-3 mt-3 animate-in fade-in slide-in-from-top-1 duration-150"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-xs font-bold">
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
                    className="h-11 text-left pl-3 rounded-xl bg-card"
                    maxLength={10}
                    autoComplete="tel"
                  />
                  {errors.phone && (
                    <p className="text-[11px] text-destructive">{errors.phone.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-xs font-bold">
                      كلمة المرور
                    </Label>
                    <Link
                      href="/forgot-password"
                      className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
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
                        minLength: { value: 8, message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" },
                      })}
                      className="pl-10 h-11 rounded-xl bg-card"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-lg"
                      aria-label={showPass ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-[11px] text-destructive">{errors.password.message}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="outline"
                  className="w-full h-10 rounded-xl text-sm"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      جارٍ تسجيل الدخول...
                    </>
                  ) : (
                    "تسجيل الدخول بكلمة المرور"
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>

        {/* Footer link to register */}
        <p className="mt-5 text-center text-sm text-muted-foreground reveal-up stagger-3">
          ليس لديك حساب؟{" "}
          <Link
            href="/register"
            className="text-primary font-bold hover:text-primary/80 transition-colors"
          >
            إنشاء حساب جديد
          </Link>
        </p>
      </div>
    </div>
  );
}
