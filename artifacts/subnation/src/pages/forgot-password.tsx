import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/layout/Logo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Phone, KeyRound, Lock, Eye, EyeOff, ArrowRight, MessageSquare } from "lucide-react";

type Step = "phone" | "otp" | "done";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-xl">
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

export default function ForgotPasswordPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("phone");

  // Step 1
  const [phone, setPhone] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  // Step 2
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");

  const handlePhoneChange = (v: string) => setPhone(v.replace(/\D/g, "").slice(0, 10));

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    setPhoneError("");
    setPhoneLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "حدث خطأ، حاول مرة أخرى");
      setStep("otp");
    } catch (err: any) {
      setPhoneError(err.message);
    } finally {
      setPhoneLoading(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setResetError("");
    if (newPassword.length < 8) {
      setResetError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError("كلمتا المرور غير متطابقتين");
      return;
    }
    if (otp.length !== 6) {
      setResetError("الكود يجب أن يكون 6 أرقام");
      return;
    }
    setResetLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل تغيير كلمة المرور");
      setStep("done");
    } catch (err: any) {
      setResetError(err.message);
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-bl from-primary/5 via-background to-background">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-5">
            <Logo size="lg" />
          </div>
          <h1 className="text-xl font-black">
            {step === "phone" && "استعادة كلمة المرور"}
            {step === "otp"   && "إدخال كود التحقق"}
            {step === "done"  && "تم بنجاح!"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {step === "phone" && "أدخل رقم هاتفك المسجل"}
            {step === "otp"   && "أدخل الكود الذي وصلك وكلمة المرور الجديدة"}
            {step === "done"  && "يمكنك الآن تسجيل الدخول"}
          </p>
        </div>

        {/* Step indicators */}
        {step !== "done" && (
          <div className="flex items-center justify-center gap-2 mb-6">
            {(["phone", "otp"] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all ${
                  step === s
                    ? "bg-primary text-white shadow-lg shadow-primary/30"
                    : step === "done" || (s === "phone" && step === "otp")
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-secondary/60 text-muted-foreground border border-border"
                }`}>
                  {s === "phone" && step === "otp" ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                </div>
                {i < 1 && <div className={`w-8 h-px transition-all ${step === "otp" ? "bg-emerald-500/40" : "bg-border"}`} />}
              </div>
            ))}
          </div>
        )}

        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl shadow-black/10">

          {/* ── Step 1: Phone ── */}
          {step === "phone" && (
            <form onSubmit={submitPhone} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="phone">رقم الهاتف</Label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="091XXXXXXX"
                    value={phone}
                    onChange={e => handlePhoneChange(e.target.value)}
                    required
                    dir="ltr"
                    className="h-11 text-left pl-3 pr-10"
                    maxLength={10}
                    autoComplete="tel"
                    autoFocus
                  />
                </div>
              </div>
              {phoneError && <ErrorBox msg={phoneError} />}

              {/* Info box */}
              <div className="flex items-start gap-2.5 bg-blue-500/8 border border-blue-500/15 rounded-xl px-3 py-2.5">
                <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  سيتم إرسال كود التحقق إلى فريق الدعم. ستتلقى الكود عبر التواصل المباشر معنا.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-primary hover:bg-primary/90 font-bold text-base shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
                disabled={phoneLoading || phone.length < 9}
              >
                {phoneLoading ? "جارٍ الإرسال..." : "إرسال طلب الاستعادة"}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                تذكرت كلمة المرور؟{" "}
                <Link href="/login" className="text-primary font-bold hover:underline underline-offset-2">
                  تسجيل الدخول
                </Link>
              </div>
            </form>
          )}

          {/* ── Step 2: OTP + New Password ── */}
          {step === "otp" && (
            <form onSubmit={submitReset} className="space-y-4">
              {/* Phone display */}
              <div className="flex items-center justify-between bg-secondary/40 border border-border/50 rounded-xl px-3 py-2.5 text-sm">
                <span className="text-muted-foreground text-xs">الرقم المُرسل إليه</span>
                <span className="font-mono font-bold text-foreground text-xs" dir="ltr">{phone}</span>
              </div>

              {/* OTP input */}
              <div className="space-y-1.5">
                <Label htmlFor="otp">كود التحقق (6 أرقام)</Label>
                <div className="relative">
                  <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="• • • • • •"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    dir="ltr"
                    className="h-11 text-center tracking-[0.5em] text-lg font-black pr-10"
                    maxLength={6}
                    autoFocus
                  />
                </div>
              </div>

              {/* New password */}
              <div className="space-y-1.5">
                <Label htmlFor="newpass">كلمة المرور الجديدة</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="newpass"
                    type={showPass ? "text" : "password"}
                    placeholder="8 أحرف على الأقل"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                    className="pr-10 pl-10 h-11"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div className="space-y-1.5">
                <Label htmlFor="confirmpass">تأكيد كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="confirmpass"
                    type={showConfirm ? "text" : "password"}
                    placeholder="أعد إدخال كلمة المرور"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    className={`pr-10 pl-10 h-11 transition-all ${
                      confirmPassword && newPassword !== confirmPassword
                        ? "border-destructive/50 focus-visible:ring-destructive/30"
                        : confirmPassword && newPassword === confirmPassword
                          ? "border-emerald-500/50"
                          : ""
                    }`}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowConfirm(v => !v)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive">كلمتا المرور غير متطابقتين</p>
                )}
              </div>

              {resetError && <ErrorBox msg={resetError} />}

              <Button
                type="submit"
                className="w-full h-11 bg-primary hover:bg-primary/90 font-bold text-base shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
                disabled={resetLoading || otp.length !== 6 || !newPassword || !confirmPassword}
              >
                {resetLoading ? "جارٍ التغيير..." : "تغيير كلمة المرور"}
              </Button>

              <button type="button" onClick={() => { setStep("phone"); setOtp(""); setNewPassword(""); setConfirmPassword(""); setResetError(""); }}
                className="w-full text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors py-1">
                ← العودة وتغيير الرقم
              </button>
            </form>
          )}

          {/* ── Step 3: Done ── */}
          {step === "done" && (
            <div className="text-center space-y-5 py-2">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <div>
                <p className="font-bold text-foreground mb-1.5">تم تغيير كلمة المرور بنجاح</p>
                <p className="text-sm text-muted-foreground">يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.</p>
              </div>
              <Button
                onClick={() => navigate("/login")}
                className="w-full h-11 bg-primary hover:bg-primary/90 font-bold shadow-lg shadow-primary/25 flex items-center justify-center gap-2"
              >
                <ArrowRight className="w-4 h-4" />
                الذهاب لتسجيل الدخول
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
