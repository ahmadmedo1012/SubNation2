import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatCurrency, tierColor, tierLabel } from "@/lib/utils";
import {
  ArrowUpRight,
  ChevronLeft,
  Crown,
  Gift,
  Share2,
  ShoppingCart,
  Star,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";

interface LoyaltyData {
  points: number;
  tier: string;
  lifetime_spend: number;
  referral_code: string;
  referral_link: string;
  referrals_total: number;
  referrals_credited: number;
  referrals_pending: number;
  points_value_lyd: string;
  next_tier: { tier: string; label: string; remaining: number } | null;
  points_rate: { points_per_referral: number; points_per_lyd: number };
}

function StatSkeleton() {
  return <div className="bg-card border border-border rounded-2xl h-[108px] skeleton-shimmer" />;
}

export default function LoyaltyPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [convertPoints, setConvertPoints] = useState("");
  const [converting, setConverting] = useState(false);

  const headers = { Authorization: token ? `Bearer ${token}` : "" };

  const fetchData = () => {
    if (!token) return;
    setLoading(true);
    fetch("/api/loyalty", { headers })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    fetchData();
  }, [token]);

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    const pts = parseInt(convertPoints);
    if (!pts || pts < 100) {
      toast({ title: "الحد الأدنى 100 نقطة", variant: "destructive" });
      return;
    }
    setConverting(true);
    try {
      const res = await fetch("/api/loyalty/convert-points", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ points: pts }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      toast({ title: "تم التحويل", description: result.message });
      setConvertPoints("");
      fetchData();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setConverting(false);
    }
  };

  const TIER_THRESHOLDS: Record<string, number> = { silver: 500, gold: 2000, platinum: 5000 };

  const tierProgressPercent = data?.next_tier
    ? Math.max(
        2,
        Math.min(
          100,
          100 - (data.next_tier.remaining / (TIER_THRESHOLDS[data.next_tier.tier] ?? 1)) * 100,
        ),
      )
    : 100;

  const HOW_TO_EARN = [
    {
      icon: <Users className="w-4 h-4 text-blue-400" />,
      bg: "bg-blue-400/10",
      label: "إحالة صديق يُتم أول شحن",
      points: `+${data?.points_rate.points_per_referral ?? 50} نقطة`,
    },
    {
      icon: <ShoppingCart className="w-4 h-4 text-emerald-400" />,
      bg: "bg-emerald-400/10",
      label: "عند كل عملية شراء",
      points: "نقاط تلقائية",
    },
    {
      icon: <Crown className="w-4 h-4 text-slate-400" />,
      bg: "bg-slate-400/10",
      label: "المستوى الفضي (500 د.ل إنفاق)",
      points: "مزايا إضافية",
    },
    {
      icon: <Star className="w-4 h-4 text-yellow-400" />,
      bg: "bg-yellow-400/10",
      label: "المستوى الذهبي (2000 د.ل إنفاق)",
      points: "أولوية الدعم",
    },
  ];

  const HOW_REFERRAL_WORKS = [
    { icon: <Share2 className="w-4 h-4 text-primary" />, step: "1", text: "شارك رابط الإحالة" },
    { icon: <Users className="w-4 h-4 text-primary" />, step: "2", text: "صديقك يسجل حسابه" },
    { icon: <Wallet className="w-4 h-4 text-primary" />, step: "3", text: "يُتم أول شحن للمحفظة" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-7 page-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-yellow-400/10 border border-yellow-400/20 flex items-center justify-center">
          <Star className="w-4.5 h-4.5 text-yellow-400" />
        </div>
        <div>
          <h1 className="text-xl font-black">الولاء والإحالة</h1>
          <p className="text-xs text-muted-foreground">اكسب نقاطاً وادعُ أصدقاءك</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <StatSkeleton key={i} />
          ))}
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Stats Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Points */}
            <div className="bg-card border border-border/60 rounded-2xl p-5 float-in">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3 font-bold">
                <Star className="w-3.5 h-3.5 text-yellow-400" />
                نقاطي
              </div>
              <div className="text-3xl font-black text-yellow-400 mb-1 tabular-nums">
                {data.points.toLocaleString()}
              </div>
              <div className="text-sm text-muted-foreground flex items-center gap-1">
                <span className="font-bold text-foreground tabular-nums">
                  {data.points_value_lyd}
                </span>
                <span>د.ل</span>
              </div>
            </div>

            {/* Tier */}
            <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-1">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3 font-bold">
                <TrendingUp className="w-3.5 h-3.5" />
                مستواي
              </div>
              <div className={`text-2xl font-black mb-2.5 ${tierColor(data.tier)}`}>
                {tierLabel(data.tier)}
              </div>
              {data.next_tier ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      التالي:{" "}
                      <span className="font-bold text-foreground">{data.next_tier.label}</span>
                    </span>
                    <span className="tabular-nums">{formatCurrency(data.next_tier.remaining)}</span>
                  </div>
                  {/* Enhanced tier progress */}
                  <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700 bg-gradient-to-l from-primary via-primary/70 to-primary/40"
                      style={{ width: `${tierProgressPercent}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    متبقٍ {formatCurrency(data.next_tier.remaining)} للترقية
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-cyan-400 font-bold">
                  <Crown className="w-3.5 h-3.5" />
                  أعلى مستوى
                </div>
              )}
            </div>

            {/* Referrals */}
            <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-2">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3 font-bold">
                <Users className="w-3.5 h-3.5 text-blue-400" />
                إحالاتي
              </div>
              <div className="text-3xl font-black text-blue-400 mb-1 tabular-nums">
                {data.referrals_credited}
              </div>
              <div className="text-sm text-muted-foreground">
                {data.referrals_pending > 0 && (
                  <span className="text-yellow-400 font-bold ml-1">
                    {data.referrals_pending} معلق ·
                  </span>
                )}
                إحالة ناجحة
              </div>
            </div>
          </div>

          {/* Referral Box */}
          <div className="bg-gradient-to-br from-primary/10 via-card to-card border border-primary/20 rounded-2xl p-5 float-in stagger-3">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="font-black text-base mb-1">ادعُ أصدقاءك</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  عند اشتراك صديقك وإتمام أول شحن،
                  <span className="text-yellow-400 font-bold">
                    {" "}
                    تحصل على {data.points_rate.points_per_referral} نقطة
                  </span>
                </p>
              </div>
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                <Gift className="w-4.5 h-4.5 text-primary" />
              </div>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 bg-background/50 border border-border rounded-xl px-3 py-2.5 font-mono text-sm font-black tracking-widest truncate">
                  {data.referral_code}
                </div>
                <CopyButton text={data.referral_code} label="نسخ" />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 bg-background/40 border border-border/50 rounded-xl px-3 py-2 text-xs text-muted-foreground truncate font-mono">
                  {data.referral_link ||
                    `${window.location.origin}/register?ref=${data.referral_code}`}
                </div>
                <CopyButton
                  text={
                    data.referral_link ||
                    `${window.location.origin}/register?ref=${data.referral_code}`
                  }
                  label="رابط"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs mb-3">
              {HOW_REFERRAL_WORKS.map((s) => (
                <div
                  key={s.step}
                  className="bg-background/40 border border-border/40 rounded-xl p-2.5 flex flex-col items-center gap-1.5"
                >
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    {s.icon}
                  </div>
                  <div className="font-bold text-foreground/80 leading-tight">{s.text}</div>
                </div>
              ))}
            </div>
            <Link href="/referrals">
              <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-primary/8 hover:bg-primary/15 border border-primary/20 hover:border-primary/30 text-primary text-sm font-bold transition-all active:scale-[0.98] press-spring">
                <Users className="w-3.5 h-3.5" />
                عرض سجل الإحالات الكامل
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </Link>
          </div>

          {/* Points Conversion */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-4">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary" />
              </div>
              <h2 className="font-black">تحويل النقاط إلى رصيد</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4 mr-10">
              كل{" "}
              <span className="font-bold text-foreground">
                {data.points_rate.points_per_lyd} نقطة
              </span>{" "}
              = <span className="font-bold text-primary">1 د.ل</span>
            </p>

            {data.points < 100 ? (
              <div className="flex items-center gap-3 p-3.5 bg-muted/35 rounded-xl text-sm text-muted-foreground">
                <ArrowUpRight className="w-4 h-4 shrink-0 text-primary" />
                <span>
                  تحتاج إلى{" "}
                  <span className="font-bold text-foreground">{100 - data.points} نقطة</span> إضافية
                  للوصول للحد الأدنى (100 نقطة)
                </span>
              </div>
            ) : (
              <form onSubmit={handleConvert} className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <Input
                    type="number"
                    min="100"
                    max={Math.floor(data.points / 100) * 100}
                    step="100"
                    placeholder="عدد النقاط (100، 200، ...)"
                    value={convertPoints}
                    onChange={(e) => setConvertPoints(e.target.value)}
                    dir="ltr"
                    className="text-left h-11"
                  />
                  {convertPoints && parseInt(convertPoints) >= 100 && (
                    <p className="text-xs text-emerald-400 mt-1.5 px-1 font-bold">
                      ستحصل على {((parseInt(convertPoints) || 0) / 100).toFixed(2)} د.ل
                    </p>
                  )}
                </div>
                <Button
                  type="submit"
                  disabled={converting || !convertPoints}
                  className="bg-primary hover:bg-primary/90 shrink-0 h-11 px-5 font-bold active:scale-95 transition-all"
                >
                  {converting ? "جارٍ..." : "تحويل"}
                </Button>
              </form>
            )}
          </div>

          {/* How to earn */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-5">
            <h2 className="font-black text-sm mb-3">كيف تكسب النقاط؟</h2>
            <div className="space-y-2">
              {HOW_TO_EARN.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 p-3 bg-muted/20 hover:bg-muted/35 rounded-xl transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg ${row.bg} flex items-center justify-center shrink-0`}
                    >
                      {row.icon}
                    </div>
                    <span className="text-sm font-medium leading-snug">{row.label}</span>
                  </div>
                  <span className="text-xs font-black text-primary whitespace-nowrap">
                    {row.points}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
