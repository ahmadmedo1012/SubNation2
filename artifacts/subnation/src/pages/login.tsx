import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { Logo } from "@/components/layout/Logo";

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
        setError(err?.response?.data?.error ?? "حدث خطأ. حاول مرة أخرى.");
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ data: { phone, password } });
  };

  // Format phone input to auto-insert structure
  const handlePhoneChange = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 10);
    setPhone(digits);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-background">
      {/* Ambient background glows */}
      <div className="absolute top-[-10%] right-[15%] w-96 h-96 bg-primary/6 rounded-full blur-[80px] pointer-events-none blob-drift" />
      <div className="absolute bottom-[-5%] left-[10%] w-72 h-72 bg-primary/4 rounded-full blur-[60px] pointer-events-none blob-drift-slow" />
      <div className="absolute inset-0 dot-grid opacity-30 pointer-events-none" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8 reveal-up">
          <div className="flex justify-center mb-5">
            <Logo size="lg" />
          </div>
          <h1 className="text-xl font-black">تسجيل الدخول</h1>
          <p className="text-muted-foreground/75 text-sm mt-1">أدخل بيانات حسابك للمتابعة</p>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-6 shadow-2xl shadow-black/20 reveal-up stagger-2">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">رقم الهاتف</Label>
              <div className="relative">
                <Input
                  id="phone"
                  type="tel"
                  placeholder="091XXXXXXX"
                  value={phone}
                  onChange={e => handlePhoneChange(e.target.value)}
                  required
                  dir="ltr"
                  className="h-11 text-left pl-3"
                  maxLength={10}
                  autoComplete="tel"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">كلمة المرور</Label>
                <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-2 hover:underline">
                  نسيت كلمة المرور؟
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="pl-10 h-11"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-xl">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-primary hover:bg-primary/90 font-bold text-base shadow-xl shadow-primary/25 transition-all active:scale-[0.97] cta-glow"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border/50" />
            <span className="text-xs text-muted-foreground/60">أو</span>
            <div className="flex-1 h-px bg-border/50" />
          </div>

          {/* Google Sign-In */}
          <GoogleSignInButton />

          <div className="mt-5 text-center text-sm text-muted-foreground/75">
            ليس لديك حساب؟{" "}
            <Link href="/register" className="text-primary font-bold hover:text-primary/80 transition-colors">إنشاء حساب جديد</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleSignInButton() {
  const { setToken } = useAuth();
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleLogin = async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError("تسجيل الدخول عبر Google غير مفعّل حالياً");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const credential = await requestGoogleCredential(clientId);
      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل التحقق من Google");
      setToken(data.token);
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full h-11 flex items-center justify-center gap-3 border border-border/60 rounded-xl bg-card hover:bg-muted/50 hover:border-border transition-all duration-180 active:scale-[0.97] font-medium text-sm disabled:opacity-60 press-spring"
      >
        <GoogleIcon />
        {loading ? "جارٍ التحقق..." : "المتابعة عبر Google"}
      </button>
      {error && (
        <p className="text-xs text-destructive text-center">{error}</p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

// Prompt Google Identity Services popup and return credential
function requestGoogleCredential(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!(window as any).google?.accounts?.id) {
      // Load the script on demand
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = () => initAndPrompt();
      script.onerror = () => reject(new Error("تعذّر تحميل مكتبة Google"));
      document.head.appendChild(script);
    } else {
      initAndPrompt();
    }

    function initAndPrompt() {
      (window as any).google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: any) => {
          if (response.credential) resolve(response.credential);
          else reject(new Error("لم يتم إكمال تسجيل الدخول"));
        },
        cancel_on_tap_outside: true,
      });
      (window as any).google.accounts.id.prompt((notification: any) => {
        if (notification.isSkippedMoment() || notification.isDismissedMoment()) {
          reject(new Error("تم إلغاء تسجيل الدخول"));
        }
      });
    }
  });
}
