import { AuthProviders } from "@/components/AuthProviders";
import { FirebasePhoneSignIn } from "@/components/FirebasePhoneSignIn";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { isValidLibyanPhone, libyanPhoneError } from "@/lib/validation";
import { useRegister } from "@workspace/api-client-react";
import { AlertCircle, CheckCircle, ChevronDown, Eye, EyeOff, Gift, Loader2 } from "lucide-react";
import { useState } from "react";
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
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [error, setError] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    defaultValues: { phone: "", password: "", referral_code: "" },
  });

  const phone = watch("phone");
  const password = watch("password");

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
    if (libyanPhoneError(data.phone)) return;
    if (!isValidLibyanPhone(data.phone)) return;
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
          {/* Referral bonus banner — small, always visible */}
          <div className="mb-4 p-2.5 bg-emerald-500/8 border border-emerald-500/18 rounded-xl text-xs text-emerald-400 flex items-center gap-2">
            <Gift className="w-3.5 h-3.5 shrink-0" />
            <span>
              استخدم رمز إحالة واحصل على <span className="font-bold">5 د.ل</span> مجاناً
            </span>
          </div>

          {/* Top-of-card error banner — always visible when set */}
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-start gap-2 text-destructive text-sm bg-destructive/8 border border-destructive/20 px-3.5 py-2.5 rounded-xl shake mb-4"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* PRIMARY: Phone OTP — fastest signup path */}
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

          {/* SECONDARY: Google */}
          <AuthProviders />

          {/* TERTIARY: Password fallback (collapsed by default) */}
          <div className="mt-4 border-t border-border/30 pt-4">
            <button
              type="button"
              onClick={() => setShowPasswordForm((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5 rounded-lg"
              aria-expanded={showPasswordForm}
              aria-controls="password-register-form"
            >
              <span>إنشاء حساب بكلمة مرور</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${showPasswordForm ? "rotate-180" : ""}`}
              />
            </button>

            {showPasswordForm && (
              <form
                id="password-register-form"
                onSubmit={handleSubmit(onSubmit)}
                className="space-y-3 mt-3 animate-in fade-in slide-in-from-top-1 duration-150"
              >
                {/* Phone */}
                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-xs font-bold">
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
                      className={`h-11 text-left pl-10 rounded-xl bg-card transition-colors ${
                        phoneTouched && errors.phone
                          ? "border-destructive/60"
                          : phoneValid
                            ? "border-emerald-500/50"
                            : "border-border/55"
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
                  {errors.phone && phoneTouched && (
                    <p className="text-[11px] text-destructive">{errors.phone.message}</p>
                  )}
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-bold">
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
                      className="pl-10 h-11 rounded-xl bg-card"
                      autoComplete="new-password"
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
                  <Label htmlFor="referral" className="text-xs font-bold">
                    رمز الإحالة{" "}
                    <span className="text-muted-foreground font-normal text-[10px]">
                      (اختياري)
                    </span>
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
                    className="text-left uppercase h-11 font-mono tracking-widest rounded-xl bg-card"
                  />
                </div>

                <Button
                  type="submit"
                  variant="outline"
                  className="w-full h-10 rounded-xl text-sm"
                  disabled={registerMutation.isPending}
                >
                  {registerMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      جارٍ إنشاء الحساب...
                    </>
                  ) : (
                    "إنشاء الحساب بكلمة مرور"
                  )}
                </Button>
              </form>
            )}
          </div>
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
