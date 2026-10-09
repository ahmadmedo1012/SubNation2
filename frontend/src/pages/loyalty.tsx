import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { Input } from "@/components/ui/input";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { formatCount, formatCurrency, formatDate, tierColor, tierLabel } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, getGetWalletQueryKey } from "@workspace/api-client-react";
import {
  AlertCircle,
  ArrowUpLeft,
  ChevronLeft,
  Crown,
  Gift,
  History,
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
  // R115 (A8 #8 / A12): GET /api/loyalty has served tier_thresholds since
  // the round-94 contract regen — the page used to delete it from its
  // local interface and re-hardcode {500, 2000, 5000} for the progress
  // bar. Consumed now (fallback below only for a pre-R115 API shape).
  tier_thresholds?: { silver: number; gold: number; platinum: number };
  points_rate: { points_per_referral: number; points_per_lyd: number };
}

/** One points_ledger row as served by GET /api/loyalty/ledger (R115). */
interface PointsLedgerEntry {
  id: number;
  type: string;
  type_label: string;
  points_delta: number;
  points_after: number;
  lyd_credited: number | null;
  created_at: string;
}

function StatSkeleton() {
  return <div className="bg-card border border-border rounded-2xl h-[108px] skeleton-shimmer" />;
}

// ── AUD103-2-F3 (r103): durable conversion-intent key ──────────────────────
//
// Same envelope as the checkout unit keys (98-F2): {k, t, f} — key, TTL
// stamp, intent fingerprint (the points amount being converted). A key
// older than the TTL is a stale intent; a different points amount is a
// NEW intent (never replay the old charge onto different data). Every
// access is try/catch-guarded so private-mode/quota failures degrade to
// unstable keys instead of blocking the money path.
const CONVERT_KEY = "subnation_convert_key";
const CONVERT_KEY_TTL_MS = 10 * 60 * 1000;

interface StoredConvertKey {
  /** The Idempotency-Key header value. */
  k: string;
  /** Date.now() at mint time — the TTL stamp. */
  t: number;
  /** Intent fingerprint — `convert|<points>`. */
  f: string;
}

function loadStoredConvertKey(fingerprint: string): string | null {
  try {
    const raw = localStorage.getItem(CONVERT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConvertKey>;
    if (typeof parsed.k !== "string" || !parsed.k) return null;
    if (typeof parsed.t !== "number" || Number.isNaN(parsed.t)) return null;
    if (Date.now() - parsed.t > CONVERT_KEY_TTL_MS) return null;
    if (parsed.f !== fingerprint) return null;
    return parsed.k;
  } catch {
    return null;
  }
}

function persistStoredConvertKey(fingerprint: string, key: string): void {
  try {
    const entry: StoredConvertKey = { k: key, t: Date.now(), f: fingerprint };
    localStorage.setItem(CONVERT_KEY, JSON.stringify(entry));
  } catch {
    // degraded: unstable keys (pre-fix behavior) — never throw on money path
  }
}

function clearStoredConvertKey(): void {
  try {
    localStorage.removeItem(CONVERT_KEY);
  } catch {
    // ignore
  }
}

// ── R120-B5 (A5-F4/F5/F6): ONE cache identity for GET /api/loyalty ─────────
//
// The key below is SHARED with pages/referrals.tsx (its overview query
// reads the same endpoint). Before R120 the loyalty page kept its own
// raw-fetch + useState copy while referrals used
// ["loyalty-overview", token] — two caches for one endpoint, so a points
// conversion invalidated neither the twin it didn't know about, leaving
// /referrals showing a stale balance for up to the 60 s staleTime. The
// key deliberately carries NO token (F6, the app-wide convention —
// generated getGetMeQueryKey-style keys are token-less and auth.tsx
// clears the whole cache on logout, so cross-account bleed cannot
// happen). If this tuple ever changes, change referrals.tsx with it —
// pinned by loyalty-referrals-shared-cache.test.tsx.
const LOYALTY_OVERVIEW_QUERY_KEY = ["loyalty", "overview"] as const;
// The points-history twin (GET /api/loyalty/ledger) — same family prefix
// so a family-wide invalidation catches both.
const LOYALTY_LEDGER_QUERY_KEY = ["loyalty", "ledger"] as const;

/** Payload shape guard (B4 P1-3): a 5xx {error} envelope or a malformed
 * 200 must never reach `data.points.toLocaleString()` — the queryFn
 * throws it into the error state, and the render branch below re-checks
 * so even a cross-page cached entry (referrals' queryFn has no guard)
 * degrades to the error card instead of the ErrorBoundary. */
function isLoyaltyPayload(d: unknown): d is LoyaltyData {
  return (
    !!d &&
    typeof (d as LoyaltyData).points === "number" &&
    typeof (d as LoyaltyData).points_rate === "object" &&
    (d as LoyaltyData).points_rate !== null
  );
}

export default function LoyaltyPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // R120-B5 (A5-F4): the page data now rides react-query — the SAME
  // ["loyalty","overview"] cache entry referrals.tsx reads (see the
  // key's docblock above). This replaces the raw fetch + useState copy
  // that went stale on the twin page after a conversion. Error/empty
  // semantics are preserved verbatim: a failed first load (no cached
  // data) renders the error card; a background-refetch failure with
  // stale data still on screen is NOT an error screen.
  const overviewQ = useQuery<LoyaltyData>({
    queryKey: LOYALTY_OVERVIEW_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/loyalty", {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        // React Query's signal aborts on unmount/cancel — the raw fetch
        // below used to run to completion even after the page died.
        signal,
      });
      // res.ok check: a 5xx arrives as an {error} envelope, and the
      // render path dereferences d.points/d.tier directly — without
      // this gate the old code fed the envelope into the UI (B4 P1-3).
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as unknown;
      // Payload shape guard: don't let a malformed 200 reach
      // `data.points.toLocaleString()` — render the error state
      // instead of crashing into the ErrorBoundary.
      if (!isLoyaltyPayload(d)) throw new Error("bad payload");
      return d;
    },
    enabled: !!token,
    // 60 s matches the app-wide default (App.tsx) and referrals.tsx.
    staleTime: 60_000,
  });

  const data = overviewQ.data ?? null;
  const loading = overviewQ.isLoading;
  // Distinct from "no data": an API outage / 5xx envelope previously
  // rendered a blank page under the header (data=null, no error branch)
  // or crashed the render via `data.points.toLocaleString()` when the
  // body was an error envelope instead of the loyalty payload (B4 P1-3).
  const loadError =
    (overviewQ.isError && data == null) || (data != null && !isLoyaltyPayload(data));

  // R115 (A8 P2): the POINTS HISTORY — GET /api/loyalty/ledger. Kept as
  // a separate query from the page data: a failed history fetch must
  // never blank the stats/conversion cards above (and vice versa).
  const ledgerQ = useQuery<PointsLedgerEntry[]>({
    queryKey: LOYALTY_LEDGER_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const r = await fetch("/api/loyalty/ledger", {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as unknown;
      // Array shape guard → distinct error state, never a fake
      // "no history yet".
      if (!Array.isArray(d)) throw new Error("bad payload");
      return d;
    },
    enabled: !!token,
    staleTime: 60_000,
  });

  const history = ledgerQ.data ?? [];
  const historyLoading = ledgerQ.isLoading;
  const historyError = ledgerQ.isError && ledgerQ.data == null;

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
  //
  // AUD103-2-F3 (r103): the intent key now lives in localStorage (same
  // envelope as the checkout unit keys — TTL + intent fingerprint) so it
  // SURVIVES TAB DEATH. The previous useRef died with the tab, so a
  // retry after a crash/PWA-kill minted a fresh key that the durable
  // V1-M19 layer correctly saw as a NEW conversion — spending the points
  // twice (at the fair rate, but not what the user asked for). This is
  // exactly the window r102 closed for checkout/product; loyalty was
  // left on the r99 in-memory pattern.
  //
  // Not user-scoped: the backend scopes idempotency keys per user
  // (`u{userId}:{key}`), so a shared-device slot collision between two
  // accounts at worst degrades to the pre-fix behavior for the FIRST
  // account (fresh key on its retry) — never a cross-account replay.

  const headers = { Authorization: token ? `Bearer ${token}` : "" };

  // Login redirect: the queries above are gated on `enabled: !!token`,
  // so an unauthenticated visit never fetches.
  // R122 (A11-F3): the redirect now PRESERVES the return path (the
  // commerce flows' `?redirect=` idiom — cart/PDP/checkout; login.tsx
  // honors same-origin internal paths only), so a post-login user
  // lands back on the loyalty program instead of `/`. The path is read
  // INSIDE the effect (not from the useLocation subscription) so the
  // redirect itself can't re-fire the effect and eat the target
  // (checkout.tsx:548 idiom, generalized).
  useEffect(() => {
    if (!token) {
      const { pathname, search } = window.location;
      navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
    }
  }, [token, navigate]);

  // R115 (A12 de-hardcode / A8 #8+#10): EVERY conversion gate on this
  // page (min, multiples, step, max, placeholder, copy) derives from
  // GET /api/loyalty's points_rate.points_per_lyd — the same field the
  // live preview already used. The literal 100 remains ONLY as the
  // pre-load fallback (data?. chains keep the referral box rendering
  // while the first fetch is in flight). Server side enforces the very
  // same constant (routes/loyalty.ts reads POINTS_PER_LYD).
  const pointsPerLyd = data?.points_rate.points_per_lyd ?? 100;

  // R115 (A8 #8): tier thresholds likewise derive from the API's
  // tier_thresholds (fallback = the historical literals, pre-load only).
  const TIER_THRESHOLDS_FALLBACK: Record<string, number> = {
    silver: 500,
    gold: 2000,
    platinum: 5000,
  };
  const tierThresholds: Record<string, number> = data?.tier_thresholds ?? TIER_THRESHOLDS_FALLBACK;

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    const pts = parseInt(convertPoints);
    if (!pts || pts < pointsPerLyd) {
      toast({ title: `الحد الأدنى ${pointsPerLyd} نقطة`, variant: "destructive" });
      return;
    }
    // R115 (A8 #10): the multiples rule is now client-checked too — a
    // typed 150 used to discover it only via the server's 400.
    if (pts % pointsPerLyd !== 0) {
      toast({
        title: `يجب أن تكون النقاط من مضاعفات ${pointsPerLyd}`,
        variant: "destructive",
      });
      return;
    }
    setConverting(true);
    // A new attempt clears the previous failure — the inline banner is
    // persistent BY DESIGN, not permanent.
    setConvertError(null);
    // 99-M4 + AUD103-2-F3: mint-once-per-intent, durable across tab death
    // (see the helpers' docblock above for the full envelope).
    const fingerprint = `convert|${pts}`;
    const intentKey = loadStoredConvertKey(fingerprint) ?? generateIdempotencyKey();
    persistStoredConvertKey(fingerprint, intentKey);
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
        if (result?.code !== "IDEMPOTENCY_IN_FLIGHT") clearStoredConvertKey();
        // R111-F2 Q1: the vague «فشلت العملية» fallback is below the
        // app's error-copy bar — calm + actionable, matching the
        // page-banner phrasing family («تعذّر … — حاول مرة أخرى»).
        throw new Error(result?.error || "تعذّر إتمام العملية — حاول مرة أخرى");
      }
      toast({ title: "تم التحويل", description: result.message });
      // 99-M4: success is terminal — the next conversion mints a fresh key.
      clearStoredConvertKey();
      setConvertPoints("");
      // Money moved: the Navbar balance (useGetMe) and the wallet page
      // (useGetWallet) caches go stale for up to 60 s otherwise — same
      // invalidation pair as checkout/product after a purchase (B4 P1-7).
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      // R120-B5 (A5-F4/F5): the SHARED loyalty cache identity — the same
      // ["loyalty","overview"] entry referrals.tsx renders from. The
      // old local-only refetch left /referrals showing the pre-convert
      // points for up to 60 s after money moved. Both queries on this
      // page are active observers, so this single call refreshes the
      // stats tiles here AND arms the twin page's entry for its next
      // mount; the ledger refetch also pulls the conversion_out row the
      // mutation just appended (R115).
      queryClient.invalidateQueries({ queryKey: LOYALTY_OVERVIEW_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: LOYALTY_LEDGER_QUERY_KEY });
    } catch (err: unknown) {
      // R111-F2 Q1 (same family as the throw above): actionable fallback
      // instead of the vague «فشلت العملية».
      const message =
        err instanceof Error && err.message ? err.message : "تعذّر إتمام العملية — حاول مرة أخرى";
      // Inline + persistent (cleared on the next attempt) — the toast
      // alone expired after 4 s, losing the failure on a money action.
      setConvertError(message);
      toast({ title: "خطأ", description: message, variant: "destructive" });
    } finally {
      setConverting(false);
    }
  };

  const tierProgressPercent = data?.next_tier
    ? Math.max(
        2,
        Math.min(
          100,
          100 - (data.next_tier.remaining / (tierThresholds[data.next_tier.tier] ?? 1)) * 100,
        ),
      )
    : 100;

  // R115 (A8 #10): persistent inline WHY-invalid text for the conversion
  // input — the min/multiples rules used to surface only as a 4s toast
  // after submit. Shown while typing (cleared with the field); the
  // submit-time guards above remain as the belt-and-suspenders.
  const convertValidation: string | null = (() => {
    if (!convertPoints) return null;
    const pts = parseInt(convertPoints);
    if (!Number.isFinite(pts) || pts <= 0) return "أدخل عدداً صحيحاً من النقاط";
    if (pts < pointsPerLyd) return `الحد الأدنى للتحويل ${pointsPerLyd} نقطة`;
    if (pts % pointsPerLyd !== 0)
      return `يجب أن تكون النقاط من مضاعفات ${pointsPerLyd} (${pointsPerLyd}، ${
        pointsPerLyd * 2
      }، ...)`;
    return null;
  })();

  const HOW_TO_EARN = [
    {
      icon: <Users className="w-4 h-4 text-status-info" />,
      bg: "bg-status-info/10",
      label: "إحالة صديق يُعتمد أول شحن له",
      points: `+${data?.points_rate.points_per_referral ?? 50} نقطة`,
    },
    {
      icon: <ShoppingCart className="w-4 h-4 text-status-success" />,
      bg: "bg-status-success/10",
      label: "عند كل عملية شراء",
      /* R115 (A8 #6): the earn rate stated explicitly — floor(final paid
       * price) points, i.e. 1 point per 1 LYD. NOTE: unlike the referral
       * and conversion rates, the backend exposes NO earn-rate constant
       * (checkout.service awards floor(finalPrice) directly) — the 1:1
       * here pins the policy value in copy; if the award formula ever
       * changes, this line changes with it. */
      points: "نقطة لكل 1 د.ل مدفوع",
    },
    {
      icon: <Crown className="w-4 h-4 text-slate-400" />,
      bg: "bg-slate-400/10",
      label: `المستوى الفضي (${tierThresholds.silver} د.ل إنفاق)`,
      /* R115 (A8 #7): «مزايا إضافية» was an unbacked promise — zero perk
       * implementations exist. Tiers are progress markers for now. */
      points: "مزايا قريباً",
    },
    {
      icon: <Star className="w-4 h-4 text-status-warning" />,
      bg: "bg-status-warning/10",
      label: `المستوى الذهبي (${tierThresholds.gold} د.ل إنفاق)`,
      points: "مزايا قريباً",
    },
  ];

  const HOW_REFERRAL_WORKS = [
    { icon: <Share2 className="w-4 h-4 text-primary" />, step: "1", text: "شارك رابط الإحالة" },
    { icon: <Users className="w-4 h-4 text-primary" />, step: "2", text: "صديقك يسجل حسابه" },
    /* R115 (policy B): اعتماد — a rejected first topup never credits. */
    {
      icon: <Wallet className="w-4 h-4 text-primary" />,
      step: "3",
      text: "يُعتمد أول شحن للمحفظة",
    },
  ];

  // R122 (A1-P2): guests get the detail-shaped RouteSkeleton instead of
  // the zeroed page frame — the enabled:false queries report loaded with
  // no data, so a guest used to see the tier/points fallback literals
  // («برونزي»، 0 نقطة) for the frame between mount and the redirect tick.
  // Same "detail" shape ROUTE_SHAPES maps /loyalty to (checkout.tsx's
  // R115-I1 guard idiom).
  if (!token) return <RouteSkeleton shape="detail" />;

  return (
    <div className="max-w-4xl mx-auto px-4 py-7 page-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-status-warning/10 border border-status-warning/20 flex items-center justify-center">
          <Star className="w-4.5 h-4.5 text-status-warning" />
        </div>
        <div>
          <h1 className="text-xl font-bold">الولاء والإحالة</h1>
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
        <FetchErrorCard
          size="page"
          className="reveal-up"
          title="تعذّر تحميل بيانات الولاء"
          description="حدث خطأ في الاتصال — تحقّق من شبكتك ثم أعد المحاولة"
          onRetry={() => void overviewQ.refetch()}
        />
      ) : data && isLoyaltyPayload(data) ? (
        <div className="space-y-4">
          {/* Stats Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Points */}
            <div className="bg-card border border-border/60 rounded-2xl p-5 float-in">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-3 font-bold">
                <Star className="w-3.5 h-3.5 text-status-warning" />
                نقاطي
              </div>
              <div className="text-3xl font-bold text-status-warning mb-1 tabular-nums">
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
              <div className={`text-2xl font-bold mb-2.5 ${tierColor(data.tier)}`}>
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
                  <p className="text-3xs text-muted-foreground">
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
              <div className="text-3xl font-bold text-status-info mb-1 tabular-nums">
                {data.referrals_credited}
              </div>
              <div className="text-sm text-muted-foreground">
                {data.referrals_pending > 0 && (
                  <span className="text-status-warning font-bold ml-1">
                    {/* R123-E4a (P2): pending-terminology canon — a
                        pending referral is «قيد الانتظار» (waiting on the
                        friend's first topup), matching referrals.tsx's
                        stat tile + row chip; was the «معلق/معلقان/معلقة»
                        family, a third word for one concept. Noun set
                        rides formatCount (إحالة/إحالتان/إحالات). */}
                    {formatCount(data.referrals_pending, {
                      one: "إحالة قيد الانتظار",
                      two: "إحالتان قيد الانتظار",
                      few: "إحالات قيد الانتظار",
                      many: "إحالة قيد الانتظار",
                      other: "إحالة قيد الانتظار",
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
                <h2 className="font-bold text-base mb-1">ادعُ أصدقاءك</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {/* R115 (policy B): اعتماد — the award lands on the
                      friend's first APPROVED topup, not at signup. */}
                  عند اشتراك صديقك واعتماد أول شحن له،
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
                  /* R122 (A1 P2-4): tracking-widest was a silent no-op — the
                     global Arabic letter-spacing guard (index.css:917)
                     zeroes the five tracking utilities app-wide, so the
                     SAME referral code rendered with 0.2em spacing on
                     /referrals and 0 here. Arbitrary form unified to
                     tracking-[0.2em] for LTR mono runs. */
                  className="flex-1 bg-background/50 border border-border rounded-xl px-3 py-2.5 font-mono text-sm font-bold tracking-[0.2em] truncate text-left"
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
            {/* R122 (A1-P1): the Link wears the CTA classes directly —
                was a native button nested inside a Link (invalid
                interactive nesting + a doubled tab stop; lowercase
                markup slipped past the R120-B7 sweep's capitalized-only
                regex). min-h-11 rides the app-wide 44px tap-target floor
                while converting. */}
            <Link
              href="/referrals"
              /* R124-I1 (A3/A5 P2): text-primary-text — raw text-primary is
                  the surface tone (~3.9:1 dark, sub-AA for this 14px bold
                  CTA text); button.tsx's link variant pins the convention. */
              className="w-full min-h-11 py-2 flex items-center justify-center gap-2 rounded-xl bg-primary/8 hover:bg-primary/15 border border-primary/20 hover:border-primary/30 text-primary-text text-sm font-bold transition-all active:scale-[0.98] press-spring"
            >
              <Users className="w-3.5 h-3.5" />
              عرض سجل الإحالات الكامل
              <ChevronLeft className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Points Conversion */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-4">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary" />
              </div>
              <h2 className="font-bold">تحويل النقاط إلى رصيد</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4 mr-10">
              كل{" "}
              <span className="font-bold text-foreground">
                {data.points_rate.points_per_lyd} نقطة
              </span>{" "}
              = <span className="font-bold text-primary-text">1 د.ل</span>
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

            {data.points < pointsPerLyd ? (
              <div className="flex items-center gap-3 p-3.5 bg-muted/35 rounded-xl text-sm text-muted-foreground">
                <ArrowUpLeft className="w-4 h-4 shrink-0 text-primary" />
                <span>
                  تحتاج إلى{" "}
                  {/* R111-F2 C2: tier remainder is ANY number — a frozen
                      «نقطة» was wrong for 3-10 (should be «نقاط»). Routed
                      through the shared formatCount plural engine like the
                      20+ other count sites (utils.ts:49). R115: the
                      threshold itself is the API's points_per_lyd. */}
                  <span className="font-bold text-foreground">
                    {formatCount(pointsPerLyd - data.points, {
                      few: "نقاط",
                      many: "نقطة",
                      other: "نقطة",
                    })}
                  </span>{" "}
                  إضافية للوصول للحد الأدنى ({pointsPerLyd} نقطة)
                </span>
              </div>
            ) : (
              <form onSubmit={handleConvert} className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <Input
                    /* R124-I1 (A4 P3): the R96 wallet keyboard contract
                       (wallet.tsx's amount field) — the storefront's last
                       type="number" still accepted e/+ on desktop, fired
                       no sensible mobile Enter label and invited browser
                       autofill into a points field. type="text" +
                       inputMode="numeric" + autoComplete="off" +
                       enterKeyHint="done" instead; the min/multiples
                       rules stay enforced by convertValidation +
                       handleConvert's own gates (the numeric attrs are
                       inert on text inputs but kept as the declared
                       domain — the wallet amount field's pattern). */
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    enterKeyHint="done"
                    min={pointsPerLyd}
                    max={Math.floor(data.points / pointsPerLyd) * pointsPerLyd}
                    step={pointsPerLyd}
                    placeholder={`عدد النقاط (${pointsPerLyd}، ${pointsPerLyd * 2}، ...)`}
                    value={convertPoints}
                    onChange={(e) => setConvertPoints(e.target.value)}
                    dir="ltr"
                    aria-invalid={convertValidation !== null}
                    aria-describedby={convertValidation ? "convert-input-validation" : undefined}
                    className="text-left h-11"
                  />
                  {/* R115 (A8 #10): persistent inline WHY-invalid text —
                      shown while the value breaks the min/multiples rules,
                      not only as a post-submit toast. */}
                  {convertValidation && (
                    <p
                      id="convert-input-validation"
                      className="text-xs text-destructive mt-1.5 px-1"
                      role="note"
                    >
                      {convertValidation}
                    </p>
                  )}
                  {convertPoints &&
                    !convertValidation &&
                    (() => {
                      /* R94-A1 #14 (P3): the preview hardcoded /100 AND showed
                       * for non-multiple values the server rejects (150 →
                       * «1.50 د.ل» then 400 «يجب أن تكون النقاط من مضاعفات
                       * 100»). Use the live rate (same field as the gates)
                       * and only preview server-acceptable multiples. */
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
                  {converting ? "جارٍ…" : "تحويل"}
                </Button>
              </form>
            )}
          </div>

          {/* How to earn */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-5">
            <h2 className="font-bold text-sm mb-3">كيف تكسب النقاط؟</h2>
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
                    <span className="text-sm font-semibold leading-snug">{row.label}</span>
                  </div>
                  <span className="text-xs font-bold text-primary-text whitespace-nowrap">
                    {row.points}
                  </span>
                </div>
              ))}
            </div>
            {/* R115 (A8 #7): tiers are progress markers in this phase — the
                perks lines above promise nothing until perks actually
                ship. */}
            <p className="text-2xs text-muted-foreground mt-3 leading-relaxed">
              المستويات مؤشرات تقدّم في هذه المرحلة — سنُعلن عن مزاياها عند تفعيلها.
            </p>
          </div>

          {/* R115 (A8 P2 + A1): the POINTS HISTORY — every point movement
              attributed (purchase awards, referral credits, conversions
              out, refund reversals, admin corrections), newest first.
              The balance is finally explainable in the UI: «why do I have
              exactly 750 points?» is now a list. */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 float-in stagger-6">
            <div className="flex items-center gap-2.5 mb-4">
              <History className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-bold text-sm">سجل النقاط</h2>
              {history.length > 0 && (
                <span className="mr-auto text-xs text-muted-foreground font-semibold">
                  {formatCount(history.length, {
                    one: "حركة",
                    two: "حركتان",
                    few: "حركات",
                    many: "حركة",
                    other: "حركة",
                  })}
                </span>
              )}
            </div>

            {historyLoading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl">
                    <div className="w-7 h-7 rounded-lg bg-muted skeleton-shimmer shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 bg-muted skeleton-shimmer rounded-full w-2/5" />
                      <div className="h-2.5 bg-muted/70 skeleton-shimmer rounded-full w-1/3" />
                    </div>
                    <div className="h-5 w-14 bg-muted skeleton-shimmer rounded-full shrink-0" />
                  </div>
                ))}
              </div>
            ) : historyError ? (
              /* Same idiom as the page-level error branch: an outage is
                 NOT «لا توجد حركات» — retry offered, stats above stay. */
              <FetchErrorCard
                size="compact"
                title="تعذّر تحميل سجل النقاط"
                description="حدث خطأ في الاتصال — أعد المحاولة لعرض حركات نقاطك"
                onRetry={() => void ledgerQ.refetch()}
              />
            ) : history.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <div className="w-14 h-14 rounded-2xl bg-muted/70 border border-border/40 flex items-center justify-center mx-auto mb-3.5">
                  <Star className="w-6 h-6 opacity-25" />
                </div>
                <p className="font-bold text-sm mb-1 text-foreground/80">لا توجد حركات نقاط بعد</p>
                <p className="text-xs text-muted-foreground max-w-[220px] mx-auto leading-relaxed">
                  ستظهر هنا نقاط الشراء والإحالة والتحويل
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 lg:max-h-[420px] overflow-y-auto scrollbar-none">
                {history.map((e, i) => {
                  const delta = e.points_delta ?? 0;
                  const gain = delta >= 0;
                  return (
                    <div
                      key={e.id ?? i}
                      className={`float-in stagger-${Math.min(i, 8)} flex items-center gap-3 p-3 bg-muted/20 hover:bg-muted/35 rounded-xl transition-colors`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold mb-0.5">
                          {e.type_label ?? e.type ?? "حركة"}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {typeof e.points_after === "number" && (
                            <span className="text-3xs text-muted-foreground tabular-nums">
                              الرصيد: {e.points_after}
                            </span>
                          )}
                          {/* conversion rows pin the LYD they yielded
                              (lyd_credited) — the rate snapshot in the
                              ledger row itself. */}
                          {typeof e.lyd_credited === "number" && (
                            <span
                              dir="ltr"
                              className="text-3xs text-status-success font-bold tabular-nums"
                            >
                              +{formatCurrency(e.lyd_credited)}
                            </span>
                          )}
                          {e.created_at && (
                            <span className="text-3xs text-muted-foreground">
                              · {formatDate(e.created_at)}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="flex items-center gap-1 shrink-0">
                        {/* dir="ltr": the sign must lead the number inside
                            the RTL layout; the unit sits in the RTL flow. */}
                        <span
                          dir="ltr"
                          className={`text-xs font-bold tabular-nums ${
                            gain ? "text-status-warning" : "text-foreground/80"
                          }`}
                        >
                          {gain ? "+" : "-"}
                          {Math.abs(delta)}
                        </span>
                        <span className="text-3xs text-muted-foreground">نقطة</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
