import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { formatCount, formatCurrency, tierColor, tierLabel } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, getGetWalletQueryKey } from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowUpLeft,
  ChevronLeft,
  Crown,
  Gift,
  Share2,
  ShoppingCart,
  Star,
  TrendingUp,
  Users,
  Wallet,
  WifiOff,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const queryClient = useQueryClient();
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [loading, setLoading] = useState(true);
  // Distinct from "no data": an API outage / 5xx envelope previously
  // rendered a blank page under the header (data=null, no error branch)
  // or crashed the render via `data.points.toLocaleString()` when the
  // body was an error envelope instead of the loyalty payload (B4 P1-3).
  const [loadError, setLoadError] = useState(false);
  const [convertPoints, setConvertPoints] = useState("");
  const [converting, setConverting] = useState(false);
  // Conversion failures used to be toast-only (4 s) — a money-critical
  // error must stay visible until the next attempt clears it (B4 P1-7).
  const [convertError, setConvertError] = useState<string | null>(null);
  // 99-M4 (R99-A2 P2 — money): ONE Idempotency-Key per conversion INTENT.
  // Minted lazily on the intent's first attempt, reused across retries of
  // the same intent (network drop after a server-side commit → retry
  // replays the cached response instead of converting AGAIN), cleared on
  // a definitive resolution so the next conversion is a fresh intent.
  const convertIntentKeyRef = useRef<string | null>(null);

  const headers = { Authorization: token ? `Bearer ${token}` : "" };

  const fetchData = useCallback(() => {
    if (!token) return;
    const headers = { Authorization: token ? `Bearer ${token}` : "" };
    setLoading(true);
    setLoadError(false);
    fetch("/api/loyalty", { headers })
      .then(async (r) => {
        // res.ok check: a 5xx arrives as an {error} envelope, and the
        // render path dereferences d.points/d.tier directly — without
        // this gate the old code fed the envelope into the UI.
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: LoyaltyData) => {
        // Payload shape guard: don't let a malformed 200 reach
        // `data.points.toLocaleString()` — render the error state
        // instead of crashing into the ErrorBoundary.
        if (!d || typeof d.points !== "number" || !d.points_rate) {
          throw new Error("bad payload");
        }
        setData(d);
      })
      .catch(() => {
        setData(null);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    fetchData();
  }, [token, navigate, fetchData]);

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    const pts = parseInt(convertPoints);
    if (!pts || pts < 100) {
      toast({ title: "الحد الأدنى 100 نقطة", variant: "destructive" });
      return;
    }
    setConverting(true);
    // A new attempt clears the previous failure — the inline banner is
    // persistent BY DESIGN, not permanent.
    setConvertError(null);
    // 99-M4: mint-once-per-intent (see convertIntentKeyRef above).
    const intentKey = convertIntentKeyRef.current ?? generateIdempotencyKey();
    convertIntentKeyRef.current = intentKey;
    try {
      const res = await fetch("/api/loyalty/convert-points", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": intentKey,
        },
        body: JSON.stringify({ points: pts }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      if (!res.ok) {
        // 99-M4: only a non-IN_FLIGHT rejection resolves the intent — a 409
        // IDEMPOTENCY_IN_FLIGHT means the same-key conversion is still
        // executing server-side and the retry MUST replay it (keep the key).
        if (result?.code !== "IDEMPOTENCY_IN_FLIGHT") convertIntentKeyRef.current = null;
        throw new Error(result?.error || "فشلت العملية");
      }
      toast({ title: "تم التحويل", description: result.message });
      // 99-M4: success is terminal — the next conversion mints a fresh key.
      convertIntentKeyRef.current = null;
      setConvertPoints("");
      // Money moved: the Navbar balance (useGetMe) and the wallet page
      // (useGetWallet) caches go stale for up to 60 s otherwise — same
      // invalidation pair as checkout/product after a purchase (B4 P1-7).
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error && err.message ? err.message : "فشلت العملية";
      // Inline + persistent (cleared on the next attempt) — the toast
      // alone expired after 4 s, losing the failure on a money action.
      setConvertError(message);
      toast({ title: "خطأ", description: message, variant: "destructive" });
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
      icon: <Users className="w-4 h-4 text-status-info" />,
      bg: "bg-status-info/10",
      label: "إحالة صديق يُتم أول شحن",
      points: `+${data?.points_rate.points_per_referral ?? 50} نقطة`,
    },
    {
      icon: <ShoppingCart className="w-4 h-4 text-status-success" />,
      bg: "bg-status-success/10",
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
      icon: <Star className="w-4 h-4 text-status-warning" />,
      bg: "bg-status-warning/10",
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
        <div className="w-9 h-9 rounded-xl bg-status-warning/10 border border-status-warning/20 flex items-center justify-center">
          <Star className="w-4.5 h-4.5 text-status-warning" />
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
      ) : loadError ? (
        /* Distinct from "no data": an outage/expired session previously
           fell through to a blank page under the header — same error
           idiom as home/category/flash-sales (B4 P1-3). */
        <div className="text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl reveal-up">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
            <WifiOff className="w-8 h-8 text-status-error/70" />
          </div>
          <p className="font-black text-lg mb-1.5 text-foreground/80">تعذّر تحميل بيانات الولاء</p>
          <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
            حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة
          </p>
          <Button
            onClick={() => fetchData()}
            className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
          >
            إعادة المحاولة
          </Button>
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Stats Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Points */}
            <div className="bg-card border border-border/60 rounded-2xl p-5 float-in">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3 font-bold">
                <Star className="w-3.5 h-3.5 text-status-warning" />
                نقاطي
              </div>
              <div className="text-3xl font-black text-status-warning mb-1 tabular-nums">
                {/* Round-3 (8-e §2): bare toLocaleString() follows the
                    DEVICE locale — Arabic-locale devices rendered Arabic-Indic
                    numerals (١٢٣٤) on this tile while the wallet balance one
                    screen over shows Latin digits. Pin the same Latin-digit
                    grouping as the rest of the money UI. */}
                {data.points.toLocaleString("en-US")}
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
                <div className="flex items-center gap-1.5 text-xs text-cyan-600 font-bold">
                  <Crown className="w-3.5 h-3.5" />
                  أعلى مستوى
                </div>
              )}
            </div>

            {/* Referrals */}
            <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-2">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3 font-bold">
                <Users className="w-3.5 h-3.5 text-status-info" />
                إحالاتي
              </div>
              <div className="text-3xl font-black text-status-info mb-1 tabular-nums">
                {data.referrals_credited}
              </div>
              <div className="text-sm text-muted-foreground">
                {data.referrals_pending > 0 && (
                  <span className="text-status-warning font-bold ml-1">
                    {formatCount(data.referrals_pending, {
                      one: "معلق",
                      two: "معلقان",
                      few: "معلقة",
                      many: "معلقة",
                      other: "معلق",
                    })}{" "}
                    ·
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
                  <span className="text-status-warning font-bold">
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
                <div
                  dir="ltr"
                  className="flex-1 bg-background/50 border border-border rounded-xl px-3 py-2.5 font-mono text-sm font-black tracking-widest truncate text-left"
                >
                  {data.referral_code}
                </div>
                <CopyButton text={data.referral_code} label="نسخ" />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div
                  dir="ltr"
                  className="flex-1 bg-background/40 border border-border/50 rounded-xl px-3 py-2 text-xs text-muted-foreground truncate font-mono text-left"
                >
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

            {/* Persistent conversion failure (B4 P1-7): cleared only when a
                new attempt starts — a 4-second toast lost money-action
                errors on this exact card. */}
            {convertError && (
              <div
                role="alert"
                className="mb-4 flex items-center gap-2.5 p-3.5 bg-status-error/10 border border-status-error/25 rounded-xl text-sm text-status-error font-bold"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="leading-relaxed">تعذّر التحويل: {convertError}</span>
              </div>
            )}

            {data.points < 100 ? (
              <div className="flex items-center gap-3 p-3.5 bg-muted/35 rounded-xl text-sm text-muted-foreground">
                <ArrowUpLeft className="w-4 h-4 shrink-0 text-primary" />
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
                  {convertPoints &&
                    (() => {
                      /* R94-A1 #14 (P3): the preview hardcoded /100 AND showed
                       * for non-multiple values the server rejects (150 →
                       * «1.50 د.ل» then 400 «يجب أن تكون النقاط من مضاعفات
                       * 100»). Use the live rate (same field as line 384) and
                       * only preview server-acceptable multiples. */
                      const rate = data.points_rate.points_per_lyd;
                      const points = parseInt(convertPoints) || 0;
                      if (!rate || points < rate || points % rate !== 0) return null;
                      return (
                        <p className="text-xs text-status-success mt-1.5 px-1 font-bold">
                          ستحصل على {formatCurrency(points / rate)}
                        </p>
                      );
                    })()}
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
