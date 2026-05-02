import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { formatCurrency, tierLabel, tierColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Star, Gift, Copy, Check, ArrowRight, Users, TrendingUp, Zap, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-sm font-bold transition-colors">
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "تم النسخ!" : label}
    </button>
  );
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
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [token]);

  if (!token) { navigate("/login"); return null; }

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    const pts = parseInt(convertPoints);
    if (!pts || pts < 100) { toast({ title: "الحد الأدنى 100 نقطة", variant: "destructive" }); return; }

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

  const tierProgressPercent = data?.next_tier
    ? Math.max(0, Math.min(100, 100 - (data.next_tier.remaining / (
        data.next_tier.tier === "silver" ? 500 :
        data.next_tier.tier === "gold" ? 1500 : 3000
      )) * 100))
    : 100;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Star className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-black">الولاء والإحالة</h1>
          <p className="text-sm text-muted-foreground">اكسب نقاطاً وادعُ أصدقاءك</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-card border border-border rounded-xl h-32 animate-pulse" />)}
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2 font-bold uppercase tracking-wide">
                <Star className="w-3.5 h-3.5 text-yellow-400" />
                نقاطي
              </div>
              <div className="text-3xl font-black text-yellow-400 mb-1">{data.points.toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">= {data.points_value_lyd} د.ل</div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2 font-bold uppercase tracking-wide">
                <TrendingUp className="w-3.5 h-3.5" />
                مستواي
              </div>
              <div className={`text-2xl font-black mb-1 ${tierColor(data.tier)}`}>{tierLabel(data.tier)}</div>
              {data.next_tier ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>التالي: {data.next_tier.label}</span>
                    <span>{formatCurrency(data.next_tier.remaining)} متبقٍ</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${tierProgressPercent}%` }} />
                  </div>
                </div>
              ) : (
                <div className="text-xs text-cyan-400 font-bold">أعلى مستوى! 🎉</div>
              )}
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2 font-bold uppercase tracking-wide">
                <Users className="w-3.5 h-3.5 text-blue-400" />
                إحالاتي
              </div>
              <div className="text-3xl font-black text-blue-400 mb-1">{data.referrals_credited}</div>
              <div className="text-sm text-muted-foreground">
                {data.referrals_pending > 0 && <span className="text-yellow-400">{data.referrals_pending} معلق · </span>}
                إجمالي ناجح
              </div>
            </div>
          </div>

          {/* Referral Box */}
          <div className="bg-gradient-to-br from-primary/10 via-card to-card border border-primary/20 rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="font-black text-lg mb-1">ادعُ أصدقاءك</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  شارك رمز إحالتك — عند اشتراك صديق وإتمام أول شحن،
                  <span className="text-yellow-400 font-bold"> تحصل على {data.points_rate.points_per_referral} نقطة</span>
                </p>
              </div>
              <Gift className="w-8 h-8 text-primary shrink-0" />
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-secondary rounded-lg px-3 py-2.5 font-mono text-sm font-bold">{data.referral_code}</div>
                <CopyButton text={data.referral_code} label="نسخ الرمز" />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-secondary rounded-lg px-3 py-2.5 text-xs text-muted-foreground truncate font-mono">{window.location.origin}/register?ref={data.referral_code}</div>
                <CopyButton text={`${window.location.origin}/register?ref=${data.referral_code}`} label="نسخ الرابط" />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
              {[
                { icon: "1️⃣", text: "شارك الرابط" },
                { icon: "2️⃣", text: "صديقك يسجل" },
                { icon: "3️⃣", text: "يتم شحن محفظته" },
              ].map((s, i) => (
                <div key={i} className="bg-muted/40 rounded-lg p-2.5">
                  <div className="text-lg mb-1">{s.icon}</div>
                  <div className="text-muted-foreground">{s.text}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Points Conversion */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-5 h-5 text-primary" />
              <h2 className="font-black">تحويل النقاط إلى رصيد</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              كل <span className="font-bold text-foreground">{data.points_rate.points_per_lyd} نقطة</span> = <span className="font-bold text-primary">1 د.ل</span> في محفظتك
            </p>

            {data.points < 100 ? (
              <div className="p-3 bg-muted/40 rounded-xl text-sm text-muted-foreground">
                تحتاج إلى <span className="font-bold text-foreground">{100 - data.points} نقطة</span> إضافية للوصول للحد الأدنى (100 نقطة)
              </div>
            ) : (
              <form onSubmit={handleConvert} className="flex gap-3">
                <div className="flex-1">
                  <Input
                    type="number"
                    min="100"
                    max={Math.floor(data.points / 100) * 100}
                    step="100"
                    placeholder="عدد النقاط (100، 200، ...)"
                    value={convertPoints}
                    onChange={e => setConvertPoints(e.target.value)}
                    dir="ltr"
                    className="text-left"
                  />
                  {convertPoints && parseInt(convertPoints) >= 100 && (
                    <p className="text-xs text-emerald-400 mt-1 px-1">
                      ستحصل على {(parseInt(convertPoints) / 100).toFixed(2)} د.ل
                    </p>
                  )}
                </div>
                <Button type="submit" disabled={converting || !convertPoints} className="bg-primary hover:bg-primary/90 shrink-0">
                  {converting ? "جاري التحويل..." : "تحويل"}
                </Button>
              </form>
            )}
          </div>

          {/* How points are earned */}
          <div className="bg-card border border-border rounded-2xl p-6">
            <h2 className="font-black mb-4">كيف تكسب النقاط؟</h2>
            <div className="space-y-3">
              {[
                { icon: "👥", label: "إحالة صديق يُتم أول شحن", points: `+${data.points_rate.points_per_referral} نقطة` },
                { icon: "🛒", label: "عند كل عملية شراء", points: "نقاط تلقائية" },
                { icon: "💰", label: "المستوى الفضي (500 د.ل إنفاق)", points: "مزايا إضافية" },
                { icon: "⚡", label: "المستوى الذهبي (2000 د.ل إنفاق)", points: "أولوية الدعم" },
              ].map((row, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{row.icon}</span>
                    <span className="text-sm">{row.label}</span>
                  </div>
                  <span className="text-xs font-bold text-primary">{row.points}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
