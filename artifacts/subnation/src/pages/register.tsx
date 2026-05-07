import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useRegister } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Eye, EyeOff, Gift, CheckCircle } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { libyanPhoneError, isValidLibyanPhone } from "@/lib/validation";
import { AuthProviders } from "@/components/AuthProviders";

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const { setToken } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) setReferralCode(ref.toUpperCase());
  }, []);

  const registerMutation = useRegister({
    mutation: {
      onSuccess(data) {
        setToken(data.token ?? null);
        navigate("/");
      },
      onError(err: any) {
        setError(err?.response?.data?.error ?? "حدث خطأ. حاول مرة أخرى.");
      },
    },
  });

  const handlePhoneChange = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
    if (phoneTouched) setPhoneError(libyanPhoneError(digits));
  };

  const handlePhoneBlur = () => {
    setPhoneTouched(true);
    setPhoneError(libyanPhoneError(phone));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPhoneTouched(true);

    const pErr = libyanPhoneError(phone);
    if (pErr) { setPhoneError(pErr); return; }

    if (!isValidLibyanPhone(phone)) {
      setPhoneError("يجب أن يبدأ الرقم بـ 091 أو 092 أو 093 أو 094");
      return;
    }

    registerMutation.mutate({ data: { phone, password, referral_code: referralCode || undefined } });
  };

  const phoneValid = phone.length === 10 && !libyanPhoneError(phone);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-gradient-to-bl from-primary/5 via-background to-background">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-5">
            <Logo size="lg" />
          </div>
          <h1 className="text-xl font-black">إنشاء حساب جديد</h1>
          <p className="text-muted-foreground text-sm mt-1">انضم واشترك بأفضل الخدمات الرقمية</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-black/10">
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-400 flex items-center gap-2">
            <Gift className="w-4 h-4 shrink-0" />
            <span>استخدم رمز إحالة واحصل على <span className="font-bold">5 د.ل</span> مجاناً</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Phone */}
            <div className="space-y-1.5">
              <Label htmlFor="phone">رقم الهاتف</Label>
              <div className="relative">
                <Input
                  id="phone"
                  type="tel"
                  placeholder="091XXXXXXX"
                  value={phone}
                  onChange={e => handlePhoneChange(e.target.value)}
                  onBlur={handlePhoneBlur}
                  required
                  dir="ltr"
                  className={`h-11 text-left pl-10 ${phoneTouched && phoneError ? "border-destructive focus-visible:ring-destructive/30" : phoneValid ? "border-emerald-500/50" : ""}`}
                  maxLength={10}
                  autoComplete="tel"
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  {phoneTouched && phoneValid && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                  {phoneTouched && phoneError && <AlertCircle className="w-4 h-4 text-destructive" />}
                </div>
              </div>
              {phoneTouched && phoneError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <span>{phoneError}</span>
                </p>
              )}
              {!phoneTouched && (
                <p className="text-xs text-muted-foreground">
                  أرقام ليبيانا (091/093) أو مدار (092/094) — 10 أرقام
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">كلمة المرور</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  placeholder="8 أحرف على الأقل"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="pl-10 h-11"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password.length > 0 && password.length < 8 && (
                <p className="text-xs text-yellow-400">تحتاج {8 - password.length} أحرف إضافية</p>
              )}
            </div>

            {/* Referral */}
            <div className="space-y-1.5">
              <Label htmlFor="referral">رمز الإحالة <span className="text-muted-foreground font-normal">(اختياري)</span></Label>
              <Input
                id="referral"
                type="text"
                placeholder="XXXXXXXX"
                value={referralCode}
                onChange={e => setReferralCode(e.target.value.toUpperCase())}
                dir="ltr"
                className="text-left uppercase h-11 font-mono tracking-widest"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-bold text-base shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
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
            <Link href="/login" className="text-primary font-bold hover:underline underline-offset-2">تسجيل الدخول</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
