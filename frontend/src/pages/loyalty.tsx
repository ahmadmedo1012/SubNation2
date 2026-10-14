import { apiErrorData } from "@/components/checkout/checkout-errors";
import { FetchErrorCard } from "@/components/ui/fetch-error-card";
import { RouteSkeleton } from "@/components/ui/route-skeleton";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ErrorCode, getErrorMessage } from "@/lib/errors";
import { generateIdempotencyKey } from "@/lib/idempotency";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  convertPoints as convertPointsApi,
  customFetch,
  getGetMeQueryKey,
  getGetWalletQueryKey,
} from "@workspace/api-client-react";
import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  clearStoredConvertKey,
  loadStoredConvertKey,
  persistStoredConvertKey,
} from "@/components/loyalty/loyalty-convert-key";
import {
  isLoyaltyPayload,
  type LoyaltyData,
  type PointsLedgerEntry,
} from "@/components/loyalty/loyalty-meta";
import {
  computeTierProgressPercent,
  resolveTierThresholds,
} from "@/components/loyalty/loyalty-tiers";
import { StatsRow } from "@/components/loyalty/StatsRow";
import { ReferralBox } from "@/components/loyalty/ReferralBox";
import { ConvertPointsCard } from "@/components/loyalty/ConvertPointsCard";
import { HowToEarnCard } from "@/components/loyalty/HowToEarnCard";
import { LedgerHistoryCard } from "@/components/loyalty/LedgerHistoryCard";

/* R137 (FE decomposition): this page is the /loyalty orchestration
   core. The presentational surfaces live as verbatim extracts under
   components/loyalty/ (StatsRow, ReferralBox, ConvertPointsCard,
   HowToEarnCard, LedgerHistoryCard + the loyalty-convert-key /
   loyalty-meta / loyalty-tiers pure modules) — they take values +
   callbacks only. Everything that coordinates money stays HERE: both
   queries, the SHARED ["loyalty","overview"] cache identity, the
   conversion gates, handleConvert with the durable intent-key
   lifecycle, and the four post-success cache invalidations. The
   structure is pinned by loyalty-decomposition-r137.test.ts; the DOM
   + money contract by the loyalty-* render suites. */

// R136 (UX-1): StatSkeleton moved into ui/Skeleton's SkeletonText —
// the 3-tile stats grid renders as one announcing wrapper (role=status
// + sr-only «جارٍ التحميل…», net-new) + plain tiles with the same
// bg-card/border/rounded-2xl/h-[108px] geometry, verbatim.

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
    // R144-C1 (L16-3): the twin raw fetches ride customFetch now (the
    // wrapper referrals.tsx already uses for this exact key) — same URL,
    // same auth header, same react-query signal; the 20 s budget +
    // boot-gate retry arrive by construction. Non-2xx throws ApiError
    // into the query error state (the old `HTTP ${r.status}` message was
    // never rendered — FetchErrorCard copy is generic), the payload
    // shape guard below stays verbatim.
    queryFn: async ({ signal }) => {
      const d = (await customFetch<unknown>("/api/loyalty", {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        signal,
      })) as unknown;
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
      const d = (await customFetch<unknown>("/api/loyalty/ledger", {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        signal,
      })) as unknown;
      // Array shape guard → distinct error state, never a fake
      // "no history yet".
      if (!Array.isArray(d)) throw new Error("bad payload");
      return d as PointsLedgerEntry[];
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
  const tierThresholds: Record<string, number> = resolveTierThresholds(data?.tier_thresholds);

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    // R-140-o central (flag 1): the re-entry guard the other three money
    // flows ride (checkout AUD103-2-F8, topup 97-F5, single-buy) — the
    // CTA's disabled predicate blocks discrete clicks, but a same-frame
    // Enter+click pair (or a slow keyboard double-fire) reached this
    // handler twice: the idempotency key + same body made the backend
    // replay-safe (409 in-flight), yet the SECOND rejection still armed
    // the persistent destructive banner while the first attempt was
    // succeeding — a spurious failure on a successful conversion. One
    // line closes the hole the gate-chain audit found.
    if (converting) return;
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
      // G-1 (R142): the raw fetch carried NO abort — a dead link kept the
      // CTA armed until the browser's ~300 s TCP timeout, so the durable
      // retry contract was unreachable in exactly the failure mode it
      // exists for. The generated convertPoints() rides customFetch's 20 s
      // budget (checkout's createOrder / the wallet topup mutation idiom);
      // the durable Idempotency-Key stays attached per call and non-2xx
      // responses arrive as ApiError with the {error, code} envelope on
      // .data (customFetch parses the body safely — a non-JSON 502 is an
      // honest Arabic error, never an English SyntaxError).
      const result = await convertPointsApi(
        { points: pts },
        {
          headers: {
            ...headers,
            "Idempotency-Key": intentKey,
          },
        },
      );
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
      // 99-M4: only a DEFINITIVE HTTP rejection resolves the intent — a
      // 409 IDEMPOTENCY_IN_FLIGHT (the same-key conversion is still
      // executing server-side) and a network-level failure (the outcome
      // is unknown — the retry must replay) both keep the durable key.
      const envelope = apiErrorData(err);
      if (envelope && envelope.code !== ErrorCode.IDEMPOTENCY_IN_FLIGHT) clearStoredConvertKey();
      // R111-F2 Q1 (calm + actionable fallback): getErrorMessage prefers
      // the backend's own Arabic sentence and collapses network/middleware
      // text to the Arabic fallback (the 96-F7 leak guard).
      const message = getErrorMessage(err) || "تعذّر إتمام العملية — حاول مرة أخرى";
      // Inline + persistent (cleared on the next attempt) — the toast
      // alone expired after 4 s, losing the failure on a money action.
      setConvertError(message);
      toast({ title: "خطأ", description: message, variant: "destructive" });
    } finally {
      setConverting(false);
    }
  };

  // R115 (A8 #8): the progress bar derives from the API's thresholds —
  // pure math (components/loyalty/loyalty-tiers.ts), one call site.
  const tierProgressPercent = computeTierProgressPercent(data?.next_tier, tierThresholds);

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
        <SkeletonText
          count={3}
          wrapperClassName="grid grid-cols-1 sm:grid-cols-3 gap-4"
          /* R139 (precision): border-border (full strength) → /60 —
             the loaded StatsRow tiles' resting edge (139-a's
             loading→loaded frame-parity discipline; the r136 docblock
             recorded the geometry as "verbatim", but the tiles it
             previews have rested at /60 since r138 — the full-strength
             edge flashed on every cold load's swap). */
          className="bg-card border border-border/60 rounded-2xl h-[108px]"
          lastShorter={false}
        />
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
          <StatsRow data={data} tierProgressPercent={tierProgressPercent} />

          {/* Referral Box */}
          <ReferralBox data={data} />

          {/* Points Conversion */}
          <ConvertPointsCard
            data={data}
            pointsPerLyd={pointsPerLyd}
            convertPoints={convertPoints}
            onConvertPointsChange={setConvertPoints}
            converting={converting}
            convertError={convertError}
            convertValidation={convertValidation}
            onConvert={handleConvert}
          />

          {/* How to earn */}
          <HowToEarnCard
            pointsPerReferral={data.points_rate.points_per_referral ?? 50}
            tierThresholds={tierThresholds}
          />

          {/* R115 (A8 P2 + A1): the POINTS HISTORY — every point movement
              attributed (purchase awards, referral credits, conversions
              out, refund reversals, admin corrections), newest first.
              The balance is finally explainable in the UI: «why do I have
              exactly 750 points?» is now a list. */}
          <LedgerHistoryCard
            history={history}
            historyLoading={historyLoading}
            historyError={historyError}
            onRetry={() => void ledgerQ.refetch()}
          />
        </div>
      ) : null}
    </div>
  );
}
