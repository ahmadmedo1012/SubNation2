import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { useAdminLogin } from "@workspace/api-client-react";
import { AlertCircle, Eye, EyeOff, KeyRound, Shield } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

export default function AdminLoginPage() {
  const [, navigate] = useLocation();
  const { setAdminToken } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");

  const [needs2FA, setNeeds2FA] = useState(false);
  const [tempToken, setTempToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  const loginMutation = useAdminLogin({
    mutation: {
      onSuccess(data) {
        if (data.requires_2fa) {
          setNeeds2FA(true);
          setTempToken(data.temp_token!);
          return;
        }
        setAdminToken(data.token ?? null);
        navigate("/admin");
      },
      onError(err: any) {
        setError(getErrorMessage(err));
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (needs2FA) {
      verify2FA();
    } else {
      loginMutation.mutate({ data: { username, password } });
    }
  };

  const verify2FA = async () => {
    setIsVerifying(true);
    try {
      const res = await fetch("/api/admin/login/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temp_token: tempToken, code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "رمز خاطئ");

      setAdminToken(data.token);
      navigate("/admin");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-bl from-primary/5 via-background to-background">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mx-auto flex items-center justify-center mb-4 shadow-lg shadow-primary/10">
            {needs2FA ? (
              <KeyRound className="w-7 h-7 text-primary" />
            ) : (
              <Shield className="w-7 h-7 text-primary" />
            )}
          </div>
          <h1 className="text-xl font-black">{needs2FA ? "المصادقة الثنائية" : "لوحة الإدارة"}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {needs2FA
              ? "الرجاء إدخال رمز التحقق من تطبيق Authenticator"
              : "SubNation — وصول مقيد للمسؤولين"}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-black/10">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!needs2FA ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="username">اسم المستخدم</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="admin"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    dir="ltr"
                    className="text-left h-11"
                    aria-describedby={error ? "admin-login-error" : undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">كلمة المرور</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPass ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pl-10 h-11"
                      aria-describedby={error ? "admin-login-error" : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={showPass ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="otpCode">رمز التحقق (6 أرقام)</Label>
                <Input
                  id="otpCode"
                  type="text"
                  placeholder="000000"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  dir="ltr"
                  className="text-center h-11 tracking-widest text-lg font-mono"
                  autoFocus
                />
              </div>
            )}

            {error && (
              <div
                id="admin-login-error"
                role="alert"
                aria-live="polite"
                className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-xl"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-bold text-base shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
              disabled={loginMutation.isPending || isVerifying}
            >
              {loginMutation.isPending || isVerifying
                ? "جارٍ التحقق..."
                : needs2FA
                  ? "تأكيد الدخول"
                  : "دخول الإدارة"}
            </Button>

            {needs2FA && (
              <Button
                type="button"
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setNeeds2FA(false);
                  setOtpCode("");
                  setError("");
                }}
              >
                العودة لتسجيل الدخول
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
