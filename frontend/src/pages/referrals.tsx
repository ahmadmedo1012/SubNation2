import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { copyToClipboard, formatRelativeTime } from "@/lib/utils";
import {
  Users,
  Copy,
  Check,
  Gift,
  Star,
  Clock,
  CheckCircle,
  Share2,
  Wallet,
  ArrowLeft,
  Zap,
  Trophy,
  UserPlus,
  WifiOff,
  XCircle,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface LoyaltyOverview {
  points: number;
  referral_code: string;
  referrals_credited: number;
  referrals_pending: number;
  referrals_total: number;
  points_rate: { points_per_referral: number };
}

interface ReferralEvent {
  id: number;
  status: "pending" | "credited";
  phone_masked: string;
  created_at: string;
  credited_at: string | null;
  points_earned: number;
}

function CopyBtn({
  text,
  label,
  size = "md",
}: {
  text: string;
  label: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    // Shared helper (secure-context check + execCommand fallback +
    // boolean result) — the previous raw `navigator.clipboard.writeText`
    // rejected silently on non-secure contexts / strict Firefox,
    // leaving the button dead with an unhandled rejection (B4 P1-2).
    const ok = await copyToClipboard(text);
    if (!ok) {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className={`
        flex items-center gap-1.5 rounded-xl font-bold transition-all active:scale-95 press-spring shrink-0
        ${
          failed
            ? "bg-status-error/12 text-status-error border border-status-error/30"
            : copied
              ? "bg-status-success/15 text-status-success border border-status-success/25"
              : "bg-primary/10 hover:bg-primary/18 text-primary border border-primary/15 hover:border-primary/30"
        }
        ${size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm"}
      `}
    >
      {failed ? (
        <XCircle className="w-3.5 h-3.5" />
      ) : copied ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      {failed ? "فشل النسخ" : copied ? "تم النسخ!" : label}
    </button>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-4 border-b border-border/30 last:border-0">
      <div className="w-9 h-9 rounded-xl bg-muted/50 skeleton-shimmer" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-muted/50 rounded-full w-28 skeleton-shimmer" />
        <div className="h-2.5 bg-muted/40 rounded-full w-20 skeleton-shimmer" />
      </div>
      <div className="h-5 w-16 bg-muted/40 rounded-full skeleton-shimmer" />
    </div>
  );
}

export default function ReferralsPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Redirect to login if not authenticated. Runs in an effect so we
  // never trigger a router state update during the render phase.
  useEffect(() => {
    if (!token) navigate("/login");
  }, [token, navigate]);

  const headers: HeadersInit = { Authorization: token ? `Bearer ${token}` : "" };

  // Two coupled queries with shared queryKey scoping. Both:
  //   - run only when authenticated
  //   - 60s staleTime matches the rest of the app (home, navbar, etc.)
  //   - R104 (AG2-4): the per-query `refetchOnWindowFocus: true` overrides
  //     are REMOVED — they were the only two in the app, re-arming the
  //     exact focus-refetch behavior the global QueryClient policy
  //     disables. Freshness on return-to-tab is covered by
  //     SessionActivityManager's visibility resync (invalidates the
  //     money/identity families on visible, throttled 30 s) — the same
  //     freshness contract wallet/orders already run on.
  // Replaces the previous fetch+useState+useEffect-on-mount pattern
  // which never refreshed unless the user reloaded the page — that
  // was the source of the "data feels stale" complaint.
  const overviewQ = useQuery<LoyaltyOverview>({
    queryKey: ["loyalty-overview", token],
    queryFn: () => customFetch<LoyaltyOverview>("/api/loyalty", { headers }),
    enabled: !!token,
    staleTime: 60_000,
  });

  const eventsQ = useQuery<ReferralEvent[]>({
    queryKey: ["loyalty-referrals", token],
    queryFn: async () => {
      const d = await customFetch<ReferralEvent[]>("/api/loyalty/referrals", { headers });
      return Array.isArray(d) ? d : [];
    },
    enabled: !!token,
    staleTime: 60_000,
  });

  const overview = overviewQ.data ?? null;
  const events = eventsQ.data ?? [];
  const loading = overviewQ.isLoading || eventsQ.isLoading;

  // 93-C5 / F-05 (A4 P2 #5): error-as-empty — when a query fails with no
  // data, an outage previously rendered as "لا توجد إحالات بعد" + zeroed
  // stats (the last money-adjacent account page without an error branch).
  // Background refetch failures with stale data still shown are NOT an
  // error screen — only a failed first load is.
  const loadError =
    !loading &&
    ((overviewQ.isError && overviewQ.data == null) || (eventsQ.isError && eventsQ.data == null));

  // Surface a toast on the very first error of either query (not on
  // background refetch errors — those should be silent retries).
  // 93-C5 / F-05: this used to run in the RENDER PHASE (component body) —
  // Sonner's store was mutated mid-render and every re-render while
  // failureCount === 1 re-fired the toast. Moved into an effect with a
  // once-guard.
  const errorToastShown = useRef(false);
  useEffect(() => {
    if (errorToastShown.current) return;
    if (
      (overviewQ.isError && overviewQ.failureCount === 1) ||
      (eventsQ.isError && eventsQ.failureCount === 1)
    ) {
      errorToastShown.current = true;
      toast({ title: "خطأ في التحميل", variant: "destructive" });
    }
  }, [overviewQ.isError, overviewQ.failureCount, eventsQ.isError, eventsQ.failureCount, toast]);

  const referralLink = overview
    ? `${window.location.origin}/register?ref=${overview.referral_code}`
    : "";

  const handleShare = async () => {
    if (!overview) return;
    const msg = `انضم إلى SubNation — متجر الاشتراكات الرقمية بالدينار الليبي 🎬\nاستخدم رمز الإحالة: ${overview.referral_code}\n${referralLink}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "SubNation", text: msg, url: referralLink });
      } catch {}
    } else {
      // Same shared helper as CopyBtn — the raw clipboard fallback used
      // to reject silently with no user feedback (B4 P2-27, twin of P1-2).
      const ok = await copyToClipboard(msg);
      toast({
        title: ok ? "تم نسخ الرسالة" : "تعذّر النسخ",
        description: ok ? "شاركها مع أصدقائك!" : "انسخ الرمز أو الرابط يدوياً من الحقل أعلاه",
        variant: ok ? "default" : "destructive",
      });
    }
  };

  const totalPointsEarned = events
    .filter((e) => e.status === "credited")
    .reduce((s, e) => s + e.points_earned, 0);

  const STEPS = [
    {
      icon: Share2,
      step: "1",
      text: "شارك رابط الإحالة",
      color: "text-primary",
      bg: "bg-primary/10 border-primary/15",
    },
    {
      icon: UserPlus,
      step: "2",
      text: "صديقك يُنشئ حسابه",
      color: "text-status-info",
      bg: "bg-status-info/10 border-status-info/15",
    },
    {
      icon: Wallet,
      step: "3",
      text: "يُتم أول شحن للمحفظة",
      color: "text-status-success",
      bg: "bg-status-success/10 border-status-success/15",
    },
    {
      icon: Gift,
      step: "4",
      text: "تحصل على نقاط فورية",
      color: "text-status-warning",
      bg: "bg-status-warning/10 border-status-warning/15",
    },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-7 page-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/loyalty">
          <button
            aria-label="رجوع لبرنامج الولاء"
            className="w-8 h-8 rounded-lg hover:bg-secondary/70 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors press-spring"
          >
            {/* Back = points RIGHT under the unified RTL icon decision
                (same idiom as terms.tsx / category.tsx back buttons —
                B4 P2-8). Previously a bare ChevronLeft pointing left. */}
            <ChevronLeft className="w-4 h-4 rotate-180" />
          </button>
        </Link>
        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Users className="w-4.5 h-4.5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-black">برنامج الإحالة</h1>
          <p className="text-xs text-muted-foreground">ادعُ أصدقاءك واكسب نقاطاً</p>
        </div>
      </div>

      {loadError ? (
        /* 93-C5 / F-05: distinct from "no referrals" — standard error-card
           idiom (loyalty.tsx) with a retry that re-runs both queries. */
        <div className="text-center py-16 text-muted-foreground bg-card border border-status-error/22 rounded-2xl reveal-up">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-status-error/8 border border-status-error/22 flex items-center justify-center">
            <WifiOff className="w-8 h-8 text-status-error/70" />
          </div>
          <p className="font-black text-lg mb-1.5 text-foreground/80">
            تعذّر تحميل بيانات الإحالات
          </p>
          <p className="text-sm mb-7 max-w-xs mx-auto leading-relaxed">
            حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة
          </p>
          <Button
            onClick={() => {
              void overviewQ.refetch();
              void eventsQ.refetch();
            }}
            className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 active:scale-[0.97] transition-all gap-2 font-bold"
          >
            إعادة المحاولة
          </Button>
        </div>
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              {
                label: "إجمالي الإحالات",
                value: loading ? "—" : String(overview?.referrals_total ?? 0),
                icon: Users,
                color: "text-status-info",
                bg: "bg-status-info/10 border-status-info/15",
              },
              {
                label: "إحالات ناجحة",
                value: loading ? "—" : String(overview?.referrals_credited ?? 0),
                icon: CheckCircle,
                color: "text-status-success",
                bg: "bg-status-success/10 border-status-success/15",
              },
              {
                label: "قيد الانتظار",
                value: loading ? "—" : String(overview?.referrals_pending ?? 0),
                icon: Clock,
                color: "text-status-warning",
                bg: "bg-status-warning/10 border-status-warning/15",
              },
              {
                label: "نقاط مكتسبة",
                value: loading ? "—" : String(totalPointsEarned),
                icon: Star,
                color: "text-status-warning",
                bg: "bg-status-warning/10 border-status-warning/15",
              },
            ].map((s, i) => (
              <div
                key={i}
                className={`bg-card border border-border/50 rounded-2xl p-4 float-in stagger-${i}`}
              >
                <div
                  className={`w-7 h-7 rounded-lg border flex items-center justify-center mb-2.5 ${s.bg}`}
                >
                  <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
                </div>
                <div className={`text-2xl font-black tabular-nums ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5 font-medium">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Referral code + link card */}
          <div className="relative bg-gradient-to-br from-primary/12 via-card to-card border border-primary/20 rounded-2xl p-5 mb-4 overflow-hidden float-in stagger-4">
            {/* Ambient blob */}
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/8 rounded-full blur-3xl pointer-events-none" />

            <div className="relative space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                {/* 96-F6 (R96 A6 #12): truncate guard for long codes — the
                    text-2xl mono code previously had no overflow guard on
                    narrow screens. min-w-0 lets the flex item shrink. */}
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground font-bold mb-1">
                    رمز الإحالة الخاص بك
                  </p>
                  {loading ? (
                    <div className="h-8 w-32 bg-muted/40 rounded-lg skeleton-shimmer" />
                  ) : (
                    <div
                      dir="ltr"
                      className="font-mono text-2xl font-black tracking-[0.2em] text-foreground truncate max-w-full"
                    >
                      {overview?.referral_code ?? "—"}
                    </div>
                  )}
                </div>
                {!loading && overview && (
                  <CopyBtn text={overview.referral_code} label="نسخ الرمز" />
                )}
              </div>

              {/* Link row */}
              {!loading && overview && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div
                    dir="ltr"
                    className="flex-1 bg-background/50 border border-border/50 rounded-xl px-3 py-2 text-xs text-muted-foreground truncate font-mono leading-relaxed text-left"
                  >
                    {referralLink}
                  </div>
                  <CopyBtn text={referralLink} label="نسخ" size="sm" />
                </div>
              )}

              {/* Share button */}
              {!loading && (
                <button
                  onClick={handleShare}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold transition-all active:scale-[0.98] shadow-md shadow-primary/25 press-spring"
                >
                  <Share2 className="w-4 h-4" />
                  مشاركة الرابط
                </button>
              )}
            </div>
          </div>

          {/* Reward info banner */}
          {!loading && overview && (
            <div className="flex items-center gap-3 p-3.5 bg-status-warning/8 border border-status-warning/20 rounded-xl mb-4 float-in stagger-5">
              <div className="w-8 h-8 rounded-lg bg-status-warning/10 border border-status-warning/15 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-status-warning" />
              </div>
              <p className="text-sm text-foreground/80 leading-snug">
                تحصل على{" "}
                <span className="font-black text-status-warning">
                  {overview.points_rate.points_per_referral} نقطة
                </span>{" "}
                عند كل إحالة ناجحة — قابلة للتحويل إلى رصيد في المحفظة
              </p>
            </div>
          )}

          {/* How it works */}
          <div className="bg-card border border-border/50 rounded-2xl p-5 mb-4 float-in stagger-6">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-4 h-4 text-primary" />
              <h2 className="font-black text-sm">كيف يعمل البرنامج؟</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {STEPS.map((s) => (
                <div
                  key={s.step}
                  className="flex flex-col items-center text-center gap-2 p-3 bg-muted/20 rounded-xl border border-border/30"
                >
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center ${s.bg}`}
                  >
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-black flex items-center justify-center">
                    {s.step}
                  </span>
                  <p className="text-xs text-foreground/75 font-medium leading-snug">{s.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Referral history */}
          <div className="bg-card border border-border/50 rounded-2xl overflow-hidden float-in stagger-7">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <h2 className="font-black text-sm">سجل الإحالات</h2>
              </div>
              {events.length > 0 && (
                <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full font-bold">
                  {events.length}
                </span>
              )}
            </div>

            {loading ? (
              <div>
                {Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="py-14 text-center text-muted-foreground">
                <div className="relative w-16 h-16 mx-auto mb-3">
                  <div className="absolute inset-0 bg-muted/30 rounded-2xl blur-sm" />
                  <div className="relative w-16 h-16 rounded-2xl bg-muted/20 border border-border/30 flex items-center justify-center">
                    <Users className="w-7 h-7 opacity-20" />
                  </div>
                </div>
                <p className="text-sm font-bold text-foreground/50 mb-1">لا توجد إحالات بعد</p>
                <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
                  شارك رابطك مع أصدقائك وابدأ في كسب النقاط
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {events.map((ev, i) => {
                  const credited = ev.status === "credited";
                  return (
                    <div
                      key={ev.id}
                      className={`flex items-center gap-3 px-5 py-3.5 float-in stagger-${Math.min(i, 7)}`}
                    >
                      {/* Avatar */}
                      <div
                        className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${
                          credited
                            ? "bg-status-success/10 border-status-success/20"
                            : "bg-yellow-500/10 border-yellow-500/20"
                        }`}
                      >
                        {credited ? (
                          <CheckCircle className="w-4 h-4 text-status-success" />
                        ) : (
                          <Clock className="w-4 h-4 text-status-warning" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground/90 font-mono tracking-wide">
                          {ev.phone_masked}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {credited && ev.credited_at
                            ? `تم الائتمان · ${formatRelativeTime(ev.credited_at)}`
                            : `سجّل · ${formatRelativeTime(ev.created_at)}`}
                        </p>
                      </div>

                      {/* Status / Points */}
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {credited ? (
                          <span className="text-xs font-black text-status-warning bg-status-warning/10 border border-status-warning/20 px-2 py-0.5 rounded-full">
                            +{ev.points_earned} نقطة
                          </span>
                        ) : (
                          /* 96-F6 (R96 A6 #4): /80 → full token — ≈2.2:1 on
                             white in light mode (AA fail); bg/border tints
                             stay as-is. */
                          <span className="text-xs font-bold text-status-warning bg-status-warning/8 border border-status-warning/15 px-2 py-0.5 rounded-full">
                            قيد الانتظار
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* CTA to loyalty */}
          <div className="mt-4 text-center">
            <Link href="/loyalty">
              <button className="flex items-center gap-1.5 mx-auto text-sm text-muted-foreground hover:text-primary transition-colors press-spring">
                <Star className="w-3.5 h-3.5" />
                عرض نقاطي وبرنامج الولاء
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
