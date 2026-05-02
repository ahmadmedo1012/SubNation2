import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useRegister } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Eye, EyeOff, Gift } from "lucide-react";

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const { setToken } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    registerMutation.mutate({ data: { phone, password, referral_code: referralCode || undefined } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-bl from-primary/5 via-background to-background">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary mx-auto flex items-center justify-center mb-4">
            <span className="text-white font-black text-xl">SN</span>
          </div>
          <h1 className="text-2xl font-black">إنشاء حساب جديد</h1>
          <p className="text-muted-foreground text-sm mt-1">انضم إلى سبنيشن واشترك بأفضل الخدمات</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl">
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-400 flex items-center gap-2">
            <Gift className="w-4 h-4 shrink-0" />
            <span>استخدم رمز إحالة واحصل على 5 د.ل مجاناً في محفظتك</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">رقم الهاتف</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="09XXXXXXXX"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                dir="ltr"
                className="text-left"
              />
            </div>
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
                  className="pl-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="referral">رمز الإحالة (اختياري)</Label>
              <Input
                id="referral"
                type="text"
                placeholder="XXXXXXXX"
                value={referralCode}
                onChange={e => setReferralCode(e.target.value.toUpperCase())}
                dir="ltr"
                className="text-left uppercase"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 font-bold" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? "جارٍ إنشاء الحساب..." : "إنشاء الحساب"}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm text-muted-foreground">
            لديك حساب بالفعل؟{" "}
            <Link href="/login" className="text-primary font-bold hover:underline">تسجيل الدخول</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
