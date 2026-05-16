import { AuthProviders } from "@/components/AuthProviders";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { isValidLibyanPhone, libyanPhoneError } from "@/lib/validation";
import { useRegister } from "@workspace/api-client-react";
import { AlertCircle, CheckCircle, Eye, EyeOff, Gift } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation } from "wouter";

interface RegisterFormData {
  phone: string;
  password: string;
  referral_code?: string;
}

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const { setToken } = useAuth();
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    defaultValues: {
      phone: "",
      password: "",
      referral_code: "",
    },
  });

  const phone = watch("phone");
  const password = watch("password");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      // Use setValue from react-hook-form
      // Note: We'll handle this in the defaultValues or a separate effect
    }
  }, []);

  const registerMutation = useRegister({
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

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    e.target.value = digits;
  };

  const onSubmit = (data: RegisterFormData) => {
    setError("");
    setPhoneTouched(true);

    const pErr = libyanPhoneError(data.phone);
    if (pErr) {
      // This will be caught by the form validation
      return;
    }

    if (!isValidLibyanPhone(data.phone)) {
      return;
    }

    registerMutation.mutate({
      data: {
        phone: data.phone,
        password: data.password,
        referral_code: data.referral_code || undefined,
      },
    });
  };

  const phoneValid = phone.length === 10 && !libyanPhoneError(phone);
  const passwordStrength = password.length === 0 ? null : password.length < 8 ? "weak" : "ok";

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 py-8 relative overflow-hidden bg-background">
      {/* Ambient background glows */}
      <div className="absolute top-[-10%] left-[15%] w-80 h-80 bg-primary/5 rounded-full blur-[80px] pointer-events-none blob-drift" />
      <div className="absolute bottom-[-5%] right-[10%] w-64 h-64 bg-primary/4 rounded-full blur-[60px] pointer-events-none blob-drift-slow" />
      <div className="absolute inset-0 dot-grid opacity-20 pointer-events-none" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-7 reveal-up">
          <div className="flex justify-center mb-5">
            <Logo size="lg" />
          </div>
          <h1 className="text-xl font-black tracking-tight">إنشاء حساب جديد</h1>
          <p className="text-muted-foreground text-sm mt-1.5">انضم واشترك بأفضل الخدمات الرقمية</p>
        </div>

        <div className="bg-card border border-border/55 rounded-3xl p-6 shadow-2xl shadow-black/20 reveal-up stagger-1">
          {/* Referral bonus banner */}
          <div className="mb-4 p-3 bg-emerald-500/8 border border-emerald-500/18 rounded-2xl text-sm text-emerald-400 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
              <Gift className="w-3.5 h-3.5" />
            </div>
            <span>
              استخدم رمز إحالة واحصل على <span className="font-bold">5 د.ل</span> مجاناً
            </span>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Phone */}
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-sm font-bold">
                رقم الهاتف
              </Label>
              <div className="relative">
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
                  onBlur={() => setPhoneTouched(true)}
                  dir="ltr"
                  className={`h-11 text-left pl-10 rounded-xl transition-all duration-200 bg-card ${
                    phoneTouched && errors.phone
                      ? "border-destructive/60 focus:border-destructive focus:ring-2 focus:ring-destructive/15"
                      : phoneValid
                        ? "border-emerald-500/50 focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/12"
                        : "border-border/55 focus:border-primary/50 focus:ring-2 focus:ring-primary/12"
                  }`}
                  maxLength={10}
                  autoComplete="tel"
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  {phoneTouched && phoneValid && !errors.phone && (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  )}
                  {phoneTouched && (errors.phone || !phoneValid) && (
                    <AlertCircle className="w-4 h-4 text-destructive" />
                  )}
                </div>
              </div>
              {errors.phone && phoneTouched ? (
                <p className="text-xs text-destructive flex items-center gap-1">
                  {errors.phone.message}
                </p>
              ) : !phoneTouched ? (
                <p className="text-xs text-muted-foreground">
                  أرقام ليبيانا (091/093) أو مدار (092/094) — 10 أرقام
                </p>
              ) : null}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-bold">
                كلمة المرور
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  placeholder="8 أحرف على الأقل"
                  {...register("password", {
                    required: "كلمة المرور مطلوبة",
                    minLength: {
                      value: 8,
                      message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل",
                    },
                  })}
                  className="pl-10 h-11 rounded-xl border-border/55 focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all duration-200 bg-card"
                  autoComplete="new-password"
                  aria-describedby={
                    errors.password ? "password-error" : error ? "register-error" : undefined
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
              {passwordStrength === "weak" && !errors.password && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-yellow-400/70 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min((password.length / 8) * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-yellow-400 shrink-0">
                    تحتاج {8 - password.length} أحرف
                  </p>
                </div>
              )}
              {passwordStrength === "ok" && (
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 h-1 rounded-full bg-emerald-500/30 overflow-hidden">
                    <div className="h-full bg-emerald-500/70 rounded-full w-full" />
                  </div>
                  <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                </div>
              )}
            </div>

            {/* Referral */}
            <div className="space-y-1.5">
              <Label htmlFor="referral" className="text-sm font-bold">
                رمز الإحالة{" "}
                <span className="text-muted-foreground font-normal text-xs">(اختياري)</span>
              </Label>
              <Input
                id="referral"
                type="text"
                placeholder="XXXXXXXX"
                {...register("referral_code")}
                onChange={(e) => {
                  e.target.value = e.target.value.toUpperCase();
                }}
                dir="ltr"
                className="text-left uppercase h-11 font-mono tracking-widest rounded-xl border-border/55 focus:border-primary/50 focus:ring-2 focus:ring-primary/12 transition-all duration-200 bg-card"
              />
            </div>

            {error && (
              <div
                id="register-error"
                role="alert"
                aria-live="polite"
                className="flex items-center gap-2 text-destructive text-sm bg-destructive/8 border border-destructive/20 px-3.5 py-2.5 rounded-xl shake"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-bold text-base shadow-lg shadow-primary/25 transition-all active:scale-[0.97] rounded-xl mt-1 cta-glow"
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? "جارٍ إنشاء الحساب..." : "إنشاء الحساب"}
            </Button>
          </form>

          <div className="mt-5">
            <AuthProviders dividerLabel="أو سجل عبر" />
          </div>

          <div className="mt-5 text-center text-sm text-muted-foreground">
            لديك حساب؟{" "}
            <Link
              href="/login"
              className="text-primary font-bold hover:text-primary/80 transition-colors"
            >
              تسجيل الدخول
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
