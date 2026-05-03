import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, tierLabel, tierColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  User, Phone, Shield, Star, Wallet, LogOut, Eye, EyeOff,
  CheckCircle, AlertCircle, Lock, Crown, TrendingUp, Copy, Check,
  ChevronLeft, Gift
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/18 text-primary text-xs font-bold transition-all active:scale-95 shrink-0"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "تم" : "نسخ"}
    </button>
  );
}

export default function ProfilePage() {
  const { token, logout } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token]);

  const { data: user, isLoading } = useGetMe({
    query: { enabled: !!token, retry: false, queryKey: getGetMeQueryKey() },
    request: { headers: { Authorization: token ? `Bearer ${token}` : "" } },
  });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");
    setPwSuccess(false);

    if (!currentPassword.trim()) { setPwError("أدخل كلمة المرور الحالية"); return; }
    if (newPassword.length < 6) { setPwError("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل"); return; }
    if (newPassword !== confirmPassword) { setPwError("كلمتا المرور غير متطابقتين"); return; }

    setChangingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "فشل تغيير كلمة المرور");
      setPwSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "تم تغيير كلمة المرور", description: "تم تحديث كلمة مرورك بنجاح." });
    } catch (err: any) {
      setPwError(err.message);
    } finally {
      setChangingPassword(false);
    }
  };

  const tier = user?.loyalty_tier ?? "bronze";
  const tierBg: Record<string, string> = {
    bronze: "from-amber-600/15 via-card to-card border-amber-600/20",
    silver: "from-slate-400/15 via-card to-card border-slate-400/20",
    gold: "from-yellow-400/15 via-card to-card border-yellow-400/20",
    platinum: "from-cyan-400/15 via-card to-card border-cyan-400/20",
  };

  if (!token) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-7 page-in">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <User className="w-4.5 h-4.5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-black">حسابي</h1>
          <p className="text-xs text-muted-foreground">إدارة معلومات حسابك</p>
        </div>
      </div>

      <div className="space-y-4">

        {/* User card */}
        {isLoading ? (
          <div className="rounded-2xl h-36 skeleton-shimmer border border-border/50" />
        ) : user ? (
          <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 ${tierBg[tier] ?? tierBg.bronze}`}>
            <div className="absolute inset-0 dot-grid opacity-30 pointer-events-none" />
            <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-primary/8 blur-2xl pointer-events-none" />

            <div className="relative flex items-start gap-4">
              {/* Avatar */}
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/10 border border-primary/22 flex items-center justify-center shrink-0 shadow-inner">
                <span className="text-2xl font-black text-primary">
                  {user.phone?.slice(-2) ?? "U"}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`text-xs font-black px-2 py-0.5 rounded-full border ${tierColor(tier)} bg-current/10 border-current/20`}
                    style={{ color: "inherit" }}>
                    <span className={tierColor(tier)}>{tierLabel(tier)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-sm font-bold mb-2.5" dir="ltr">
                  <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-foreground">{user.phone}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background/40 border border-border/40 rounded-xl px-3 py-2">
                    <div className="text-[10px] text-muted-foreground mb-0.5">الرصيد</div>
                    <div className="font-black text-sm text-primary tabular-nums">{formatCurrency(user.wallet_balance ?? 0)}</div>
                  </div>
                  <div className="bg-background/40 border border-border/40 rounded-xl px-3 py-2">
                    <div className="text-[10px] text-muted-foreground mb-0.5">النقاط</div>
                    <div className="font-black text-sm text-yellow-400 tabular-nums flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      {user.loyalty_points ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Quick links */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { href: "/wallet", icon: Wallet, label: "المحفظة", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
            { href: "/orders", icon: Shield, label: "طلباتي", color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20" },
            { href: "/loyalty", icon: Crown, label: "الولاء", color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/20" },
            { href: "/referrals", icon: Gift, label: "الإحالات", color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20" },
          ].map(item => (
            <Link key={item.href} href={item.href}>
              <div className={`flex flex-col items-center gap-2 p-3.5 rounded-2xl border bg-card hover:border-border transition-all cursor-pointer group press-spring text-center ${item.border}`}>
                <div className={`w-9 h-9 rounded-xl ${item.bg} border ${item.border} flex items-center justify-center group-hover:scale-110 transition-transform duration-150`}>
                  <item.icon className={`w-4.5 h-4.5 ${item.color}`} />
                </div>
                <span className="text-xs font-bold text-foreground/80">{item.label}</span>
                <ChevronLeft className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary transition-colors" />
              </div>
            </Link>
          ))}
        </div>

        {/* Change password */}
        <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-2">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
              <Lock className="w-3.5 h-3.5 text-primary" />
            </div>
            <h2 className="font-black">تغيير كلمة المرور</h2>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-3.5">
            {/* Current password */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">كلمة المرور الحالية</Label>
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10 h-10 text-sm"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">كلمة المرور الجديدة</Label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10 h-10 text-sm"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(v => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">تأكيد كلمة المرور</Label>
              <div className="relative">
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 text-sm"
                  dir="ltr"
                />
                {confirmPassword && newPassword && (
                  <div className="absolute left-3 top-1/2 -translate-y-1/2">
                    {confirmPassword === newPassword
                      ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                      : <AlertCircle className="w-4 h-4 text-destructive" />
                    }
                  </div>
                )}
              </div>
            </div>

            {/* Feedback */}
            {pwError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/8 border border-destructive/20 px-3 py-2.5 rounded-xl shake">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {pwError}
              </div>
            )}
            {pwSuccess && (
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/8 border border-emerald-500/20 px-3 py-2.5 rounded-xl">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                تم تغيير كلمة المرور بنجاح
              </div>
            )}

            <Button
              type="submit"
              disabled={changingPassword}
              className="w-full h-10 bg-primary hover:bg-primary/90 font-bold shadow-md shadow-primary/20 cta-glow"
            >
              {changingPassword ? "جارٍ التغيير..." : "تغيير كلمة المرور"}
            </Button>
          </form>
        </div>

        {/* Danger zone */}
        <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-3">
          <h2 className="font-black text-sm mb-3 text-muted-foreground">خيارات الحساب</h2>
          <Button
            variant="outline"
            onClick={() => { logout(); navigate("/"); }}
            className="w-full h-10 border-destructive/30 text-destructive hover:bg-destructive/8 hover:border-destructive/50 font-bold transition-all"
          >
            <LogOut className="w-4 h-4 ml-2" />
            تسجيل الخروج
          </Button>
        </div>

      </div>
    </div>
  );
}
