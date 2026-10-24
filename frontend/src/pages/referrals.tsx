import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { NETWORK_ERROR_DESCRIPTION } from "@/lib/errors";
import { useLocation, Link } from "wouter";
import { copyToClipboard, formatRelativeTime } from "@/lib/utils";
import {
  Users,
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
  ChevronLeft,
} from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { Skeleton } from "@/components/ui/Skeleton";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { useToast } from "@/hooks/useToast";
import { useSeo } from "@/hooks/useSeo";

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

function SkeletonRow() {
  return (
    /* R139 (precision): the skeleton rows mirror the loaded event
       rows' /20 hairline (loading→loaded parity). */
    <div className="flex items-center gap-3 p-4 border-b border-border/20 last:border-0">
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
  // R146 (audit-frontend-pages F4): RouteAnnouncer announces SPA
  // navigations by reading document.title — this page set none, so
  // loyalty↔referrals hops stayed silent for screen-reader users.
  // notifications.tsx's shape.
  const seoBlock = useSeo({
    title: "برنامج الإحالة — SubNation",
    description:
      "ادعُ أصدقاءك إلى SubNation برمز الإحالة الخاص بك واكسب 50 نقطة عند اعتماد أول شحن لكل صديق.",
    path: "/referrals",
    robots: "noindex,follow",
  });
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Redirect to login if not authenticated. Runs in an effect so we
  // never trigger a router state update during the render phase.
  // R122 (A11-F3): the redirect now PRESERVES the return path (the
  // commerce flows' `?redirect=` idiom — cart/PDP/checkout; login.tsx
  // honors same-origin internal paths only). The path is read INSIDE
  // the effect (not from the useLocation subscription) so the redirect
  // itself can't re-fire the effect and eat the target
  // (checkout.tsx:548 idiom, generalized).
  useEffect(() => {
    if (!token) {
      const { pathname, search } = window.location;
      navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
    }
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
  //
  // R120-B5 (A5-F4/F5/F6): the overview key is the SHARED cache identity
  // with pages/loyalty.tsx (ONE entry for GET /api/loyalty) and carries
  // NO token — the app-wide key convention (generated keys are
  // token-less; auth.tsx clears the cache on logout). Before this, the
  // two pages kept separate entries (["loyalty-overview", token] here,
  // a raw-fetch useState copy there), so a points conversion on
  // /loyalty left THIS page's balance stale for up to 60 s — loyalty's
  // convert mutation now invalidates this exact key. Keep the tuple in
  // sync with loyalty.tsx's LOYALTY_OVERVIEW_QUERY_KEY — pinned by
  // loyalty-referrals-shared-cache.test.tsx.
  const overviewQ = useQuery<LoyaltyOverview>({
    queryKey: ["loyalty", "overview"],
    queryFn: () => customFetch<LoyaltyOverview>("/api/loyalty", { headers }),
    enabled: !!token,
    staleTime: 60_000,
  });

  const eventsQ = useQuery<ReferralEvent[]>({
    // R120-B5 (A5-F6): token dropped from the key (same family prefix as
    // the overview — "loyalty" groups the endpoint's queries).
    queryKey: ["loyalty", "referrals"],
    queryFn: async () => {
      const d = await customFetch<ReferralEvent[]>("/api/loyalty/referrals", { headers });
      // B-F6 (R186): a malformed 200 body THROWS into the page's error
      // card (loadError → FetchErrorCard) — never the zeroed stats +
      // «لا توجد إحالات بعد» false empty (the notifications/loyalty
      // shape-guard class).
      if (!Array.isArray(d)) throw new Error("تعذّر تحميل بيانات الإحالات");
      return d;
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
      // R157: the action-specific copy bar (R111-F2) — the generic
      // «خطأ في التحميل» duplicated the page's FetchErrorCard without
      // saying WHAT failed; the description names the surface.
      toast({
        title: "خطأ في التحميل",
        description: "تعذّر تحميل بيانات الإحالات — أعد المحاولة",
        variant: "destructive",
      });
    }
  }, [overviewQ.isError, overviewQ.failureCount, eventsQ.isError, eventsQ.failureCount, toast]);

  const referralLink = overview
    ? `${window.location.origin}/register?ref=${overview.referral_code}`
    : "";

  const handleShare = async () => {
    if (!overview) return;
    const msg = `انضم إلى SubNation — متجر الاشتراكات الرقمية بالدينار الليبي 🎬\nاستخدم رمز الإحالة: ${overview.referral_code}\n${referralLink}`;
    // B-F9 (R186): the clipboard fallback is shared by BOTH arms — the
    // else-branch's exact copied/failed toast, reused when navigator.share
    // fails for a real reason (a user cancel via AbortError stays silent).
    const copyFallback = async () => {
      // Same shared helper as CopyBtn — the raw clipboard fallback used
      // to reject silently with no user feedback (B4 P2-27, twin of P1-2).
      const ok = await copyToClipboard(msg);
      toast({
        title: ok ? "تم نسخ الرسالة" : "تعذّر النسخ",
        description: ok ? "شاركها مع أصدقائك!" : "انسخ الرمز أو الرابط يدوياً من الحقل أعلاه",
        variant: ok ? "default" : "destructive",
      });
    };
    if (navigator.share) {
      try {
        await navigator.share({ title: "SubNation", text: msg, url: referralLink });
      } catch (err) {
        // navigator.share rejects BOTH for user cancel (AbortError — a
        // silent no-op by design) and for real failures; only the latter
        // fall through to the same clipboard fallback the no-share-API
        // path takes — the old bare `catch {}` swallowed both.
        if ((err as { name?: string })?.name === "AbortError") return;
        await copyFallback();
      }
    } else {
      await copyFallback();
    }
  };

  const totalPointsEarned = events
    .filter((e) => e.status === "credited")
    .reduce((s, e) => s + e.points_earned, 0);

  // R122 (A1-P2): guests get the list-shaped RouteSkeleton instead of the
  // ZEROED frame — the enabled:false queries report loaded with no data,
  // so a guest used to see four "0" stat tiles + a "—" referral code for
  // the frame between mount and the redirect tick (a false "you have no
  // referrals" flash on a money-adjacent page). Same "list" shape
  // ROUTE_SHAPES maps /referrals to (checkout.tsx's R115-I1 guard idiom).
  if (!token) return <RouteSkeleton shape="list" />;

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
      /* R115 (policy B / A8 #18): اعتماد — a rejected first topup never
         credits; the row stays pending until an APPROVED topup lands. */
      text: "يُعتمد أول شحن لصديقك",
      color: "text-status-success",
      bg: "bg-status-success/10 border-status-success/15",
    },
    {
      icon: Gift,
      step: "4",
      text: "تُقيد مكافأة النقاط",
      color: "text-status-warning",
      bg: "bg-status-warning/10 border-status-warning/15",
    },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-7 page-in">
      {seoBlock}
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {/* R122 (A1-P1): the back control is ONE anchor wearing the
            icon-button classes — was a native button nested inside a
            Link (invalid interactive nesting + a doubled tab stop).
            R122 (A1-P2, tap floor): the old w-8 h-8 was 32px — w-11 h-11
            rides the 44px floor the app enforces on every other icon
            control. */}
        <Link
          href="/loyalty"
          aria-label="رجوع لبرنامج الولاء"
          className="w-11 h-11 rounded-lg hover:bg-secondary/70 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors press-spring"
        >
          {/* Back = points RIGHT under the unified RTL icon decision
              (same idiom as terms.tsx / category.tsx back buttons —
              B4 P2-8). Previously a bare ChevronLeft pointing left. */}
          <ChevronLeft className="w-4 h-4 rotate-180" />
        </Link>
        <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Users className="w-4.5 h-4.5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">برنامج الإحالة</h1>
          <p className="text-xs text-muted-foreground">ادعُ أصدقاءك واكسب نقاطاً</p>
        </div>
      </div>

      {loadError ? (
        /* 93-C5 / F-05: distinct from "no referrals" — standard error-card
           idiom (loyalty.tsx) with a retry that re-runs both queries.
           R140 (r139 debt closure — verify-only): this page has NO
           hand-rolled stale/error banner twin. The full-load error
           surface IS the shared FetchErrorCard (role="alert" + the
           canonical retry); a background-refresh failure with stale data
           on screen is NOT an error screen (the derivation above), so no
           stale-keep banner exists to hand-roll. The admin referrals
           twin that DID hand-roll one (pages/admin/referrals.tsx) adopted
           the shared StaleListErrorBanner register this round. */
        <FetchErrorCard
          size="page"
          className="reveal-up"
          title="تعذّر تحميل بيانات الإحالات"
          description={NETWORK_ERROR_DESCRIPTION}
          onRetry={() => {
            void overviewQ.refetch();
            void eventsQ.refetch();
          }}
        />
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
                className={`bg-card border border-border/60 rounded-2xl p-4 float-in stagger-${i}`}
              >
                <div
                  className={`w-7 h-7 rounded-lg border flex items-center justify-center mb-2.5 ${s.bg}`}
                >
                  <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
                </div>
                {/* R139 (precision): the stat VALUE drops its per-tile hue
                    for plain ink + weight + size + tabular-nums — the
                    139-j admin-referrals twin decision (counts are not
                    statuses; the icon stage above carries the identity).
                    Tile edge /50 → /60 — the family resting value. */}
                <div className="text-2xl font-bold tabular-nums text-foreground">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5 font-semibold">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Referral code + link card */}
          {/* R139 (precision): the gradient shell (from-primary/12
              via-card + border-primary/20) retires for the solid family
              card — loyalty's ReferralBox twin; the quiet static corner
              blob stays as the card's depth cue (AuthedHero's twin). */}
          <div className="relative bg-card border border-border/60 rounded-2xl p-5 mb-4 overflow-hidden float-in stagger-4">
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
                    /* R136 (UX-1): Skeleton — the referral-code
                       placeholder, geometry verbatim; the pair is
                       net-new. (SkeletonRow below stays hand-rolled:
                       composite row layout, a documented
                       non-adoption.) */
                    <Skeleton className="h-8 w-32 bg-muted/40 rounded-lg" />
                  ) : (
                    <div
                      dir="ltr"
                      className="font-mono text-2xl font-bold tracking-[0.2em] text-foreground truncate max-w-full"
                    >
                      {overview?.referral_code ?? "—"}
                    </div>
                  )}
                </div>
                {!loading && overview && (
                  <CopyButton text={overview.referral_code} label="نسخ الرمز" size="md" />
                )}
              </div>

              {/* Link row */}
              {!loading && overview && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div
                    dir="ltr"
                    /* R139 (precision): the link row rides the well
                        register's quieter twin (muted/40 + /30), unified
                        with loyalty's ReferralBox link box. */
                    className="flex-1 bg-muted/40 border border-border/30 rounded-xl px-3 py-2 text-xs text-muted-foreground truncate font-mono leading-relaxed text-left"
                  >
                    {referralLink}
                  </div>
                  <CopyButton text={referralLink} label="نسخ" size="sm" />
                </div>
              )}

              {/* Share button */}
              {!loading && (
                /* R139 (precision): the page-primary share CTA
                    de-hand-rolls onto the canonical Button — size="lg" +
                    w-full (the R116-S1 recipe); the retired stack
                    (hover:bg-primary/90 + shadow-md shadow-primary/25 +
                    raw text-white) dies with it. handleShare is
                    byte-identical. */
                <Button onClick={handleShare} size="lg" className="w-full font-bold">
                  <Share2 className="w-4 h-4" />
                  مشاركة الرابط
                </Button>
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
                {/* R139 (precision): tabular-nums on the reward number —
                    weight + tabular, the value from the API's
                    points_rate (no hardcoded constants). */}
                <span className="font-bold text-status-warning tabular-nums">
                  {overview.points_rate.points_per_referral} نقطة
                </span>{" "}
                عن كل إحالة ناجحة (تُقيد عند اعتماد أول شحن لصديقك) — قابلة للتحويل إلى رصيد في
                المحفظة
              </p>
            </div>
          )}

          {/* How it works */}
          {/* R139 (precision): /50 → /60 (family edge); the step tiles'
              /30 → /40 joins the nested-stat-tile register. */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 mb-4 float-in stagger-6">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-4 h-4 text-primary" />
              <h2 className="font-bold text-sm">كيف يعمل البرنامج؟</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {STEPS.map((s) => (
                <div
                  key={s.step}
                  className="flex flex-col items-center text-center gap-2 p-3 bg-muted/20 rounded-xl border border-border/40"
                >
                  <div
                    className={`w-9 h-9 rounded-xl border flex items-center justify-center ${s.bg}`}
                  >
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                  {/* R139 (precision): text-primary-text — the AA-safe
                      brand ink on 11px bold numerals (the wallet
                      InstructionsPanel circles' twin). */}
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary-text text-3xs font-bold flex items-center justify-center">
                    {s.step}
                  </span>
                  <p className="text-xs text-foreground/75 font-semibold leading-snug">{s.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Referral history */}
          {/* R139 (precision): card /50 → /60; the header/body seam
              /40 → /60 and the event rows /30 → /20 — the whatsapp
              section register (a FIRM seam under the section header,
              receipt hairlines between the nested rows). */}
          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden float-in stagger-7">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <h2 className="font-bold text-sm">سجل الإحالات</h2>
              </div>
              {events.length > 0 && (
                /* R139 (precision): the count chip joins the static-badge
                    box family (muted/30 fill + /30 edge). */
                <span className="text-xs text-muted-foreground bg-muted/30 border border-border/30 px-2 py-0.5 rounded-full font-bold tabular-nums">
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
                  {/* R139 (precision): the empty stage joins the r138-h
                      icon-stage values (muted/60 tile + /35 edge + /35
                      glyph + /85 title); the muted blur halo stays — a
                      neutral depth cue, not the banned brand glow. */}
                  <div className="relative w-16 h-16 rounded-2xl bg-muted/60 border border-border/35 flex items-center justify-center">
                    <Users className="w-7 h-7 opacity-35" />
                  </div>
                </div>
                <p className="text-sm font-bold text-foreground/85 mb-1">لا توجد إحالات بعد</p>
                <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
                  شارك رابطك مع أصدقائك وابدأ في كسب النقاط
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/20">
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
                            : /* R123-E4a (P3-h): token-based status-warning
                                  family — was the raw bg-yellow-500/10
                                  border-yellow-500/20 palette while the
                                  icon inside already used
                                  text-status-warning. */
                              "bg-status-warning/10 border-status-warning/20"
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
                        {/* R122 (A1 P2-4): tracking-wide → the arbitrary
                            tracking-[0.2em] form — the named utility is a
                            silent no-op under the global Arabic
                            letter-spacing guard (index.css:917), so this
                            LTR mono phone run rendered with 0 spacing
                            (unified with the referral-code runs). */}
                        <p className="text-sm font-bold text-foreground/90 font-mono tracking-[0.2em]">
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
                          <span className="text-xs font-bold text-status-warning bg-status-warning/10 border border-status-warning/20 px-2 py-0.5 rounded-full tabular-nums">
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
            {/* R122 (A1-P1): the Link wears the CTA classes directly —
                was a native button nested inside a Link (invalid
                interactive nesting + a doubled tab stop). min-h-11 rides
                the 44px tap-target floor while converting. */}
            <Link
              href="/loyalty"
              /* R124-I4 (A5 #1): hover:text-primary is sub-AA on the
                  hover state — the text-safe twin (the 139-j back-link
                  sweep's storefront twin). */
              className="inline-flex items-center min-h-11 gap-1.5 mx-auto text-sm text-muted-foreground hover:text-primary-text transition-colors press-spring"
            >
              <Star className="w-3.5 h-3.5" />
              عرض نقاطي وبرنامج الولاء
              <ArrowLeft className="w-3.5 h-3.5" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
