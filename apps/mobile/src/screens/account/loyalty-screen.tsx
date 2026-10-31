import { useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetLoyaltyQueryKey,
  getGetMeQueryKey,
  getGetWalletQueryKey,
  getLoyaltyLedger,
  useConvertPoints,
  useGetLoyalty,
  type GetLoyaltyLedger200Item,
  type LoyaltySummary,
} from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { InlineError, Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { apiErrorCode } from "@/lib/api";
import { ErrorCode, getErrorMessage } from "@/lib/errors";
import {
  INTENT_SLOTS,
  INTENT_TTL_MS,
  clearIntentKey,
  generateIdempotencyKey,
  loadIntentKey,
  persistIntentKey,
} from "@/lib/idempotency";
import { arabicCount, formatCurrency, formatNumber } from "@/lib/money";
import { useColors, radius, spacing } from "@/theme";
import { formatShortDate, tierColorKey, tierLabel } from "./dates";
import { SignInPrompt } from "./sign-in-prompt";

/**
 * Loyalty — the native twin of the web's /loyalty page:
 *   • the stats trio (points / tier + progress / referrals) with tier
 *     accents from the theme's tier tokens;
 *   • the convert-points money action — ONE durable Idempotency-Key per
 *     conversion INTENT (the INTENT_SLOTS.convert envelope from
 *     @/lib/idempotency, mint-once-per-intent like the web's
 *     loyalty-convert-key.ts): minted before the POST, kept across
 *     retries of the same intent (a lost response replays the cached
 *     server result instead of converting twice), cleared only at
 *     accounted success or a definitive rejection;
 *   • the points ledger (every movement attributed, newest first) with
 *     the plain-array load-more contract;
 *   • the four states everywhere — first-load skeletons, an honest
 *     error+retry, designed empty states, content.
 */

/** The ledger route's page size (the backend's paged-branch default). */
const LEDGER_PAGE_SIZE = 100;

/** The ledger's accumulating load-more cache identity. */
const LEDGER_QUERY_KEY = ["/api/loyalty/ledger", "load-more"] as const;

/** Historical tier-threshold literals — pre-load fallback only (the
 * web loyalty-tiers.ts TIER_THRESHOLDS_FALLBACK twin). */
const TIER_THRESHOLDS_FALLBACK = { silver: 500, gold: 2000, platinum: 5000 };

/** Arabic plural forms for the points noun (the web's family table). */
const POINTS_FORMS = {
  zero: "نقاط",
  one: "نقطة",
  two: "نقطتان",
  few: "نقاط",
  many: "نقطة",
  other: "نقطة",
} as const;

/** Arabic plural forms for ledger movements. */
const MOVEMENT_FORMS = {
  zero: "حركات",
  one: "حركة",
  two: "حركتان",
  few: "حركات",
  many: "حركة",
  other: "حركة",
} as const;

/**
 * The tier progress bar's percent toward the next tier — clamped to
 * [2, 100] (a barely-started bar still reads as started; a rounding
 * overshoot can't overflow); 100 when there is no next tier (platinum
 * is the top). Port of the web's loyalty-tiers.ts pure function.
 */
function computeTierProgressPercent(
  nextTier: LoyaltySummary["next_tier"],
  tierThresholds: Record<string, number>,
): number {
  return nextTier
    ? Math.max(
        2,
        Math.min(100, 100 - (nextTier.remaining / (tierThresholds[nextTier.tier] ?? 1)) * 100),
      )
    : 100;
}

export function LoyaltyScreen() {
  const { status } = useAuth();

  if (status === "guest") {
    return (
      <SignInPrompt message="سجّل دخولك لمتابعة نقاطك ومستواك وتحويل نقاطك إلى رصيد في المحفظة." />
    );
  }
  return <LoyaltyContent />;
}

function LoyaltyContent() {
  const colors = useColors();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useGetLoyalty();

  const ledger = useInfiniteQuery({
    queryKey: LEDGER_QUERY_KEY,
    queryFn: ({ pageParam, signal }) =>
      getLoyaltyLedger({ page: pageParam as number, limit: LEDGER_PAGE_SIZE }, { signal }),
    initialPageParam: 1,
    // Plain-array honesty: a full page MIGHT have a next one; a short
    // page is the definite end.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === LEDGER_PAGE_SIZE ? allPages.length + 1 : undefined,
  });

  // The conversion draft + the persistent failure line (cleared on the
  // next attempt — a money-action error must not expire silently).
  const [pointsInput, setPointsInput] = useState("");
  const [convertError, setConvertError] = useState<string | null>(null);

  // G-2 (the sibling money screens' discipline — checkout's order
  // mutation, the wallet's topup mutation): the generated mutationFn
  // closes over `request` at RENDER time, so the per-INTENT
  // Idempotency-Key rides a STABLE ref whose headers are read at fetch
  // time and synced right before mutateAsync below.
  const convertRequestRef = useRef<{ headers: Record<string, string> }>({ headers: {} });
  const convertMutation = useConvertPoints({ request: convertRequestRef.current });
  const converting = convertMutation.isPending;

  const pointsPerLyd = data?.points_rate.points_per_lyd ?? 100;
  const pointsPerReferral = data?.points_rate.points_per_referral ?? 50;
  const tierThresholds = data?.tier_thresholds ?? TIER_THRESHOLDS_FALLBACK;
  const tierProgressPercent = computeTierProgressPercent(data?.next_tier ?? null, tierThresholds);

  // Persistent inline WHY-invalid text while typing (the submit-time
  // guards below remain the belt-and-suspenders) — the web contract.
  const convertValidation: string | null = (() => {
    if (!pointsInput) return null;
    const pts = Number.parseInt(pointsInput, 10);
    if (!Number.isFinite(pts) || pts <= 0) return "أدخل عدداً صحيحاً من النقاط";
    if (pts < pointsPerLyd) return `الحد الأدنى للتحويل ${pointsPerLyd} نقطة`;
    if (pts % pointsPerLyd !== 0)
      return `يجب أن تكون النقاط من مضاعفات ${pointsPerLyd} (${pointsPerLyd}، ${
        pointsPerLyd * 2
      }، …)`;
    return null;
  })();

  // The live preview — only for server-acceptable multiples.
  const previewAmount = useMemo(() => {
    if (!pointsInput || convertValidation) return null;
    const pts = Number.parseInt(pointsInput, 10);
    if (!Number.isFinite(pts) || pts < pointsPerLyd || pts % pointsPerLyd !== 0) return null;
    return pts / pointsPerLyd;
  }, [pointsInput, convertValidation, pointsPerLyd]);

  // Accumulated ledger — dedup by id (a conversion between page
  // requests shifts offset boundaries, so a row can repeat).
  const ledgerEntries = useMemo(() => {
    const seen = new Set<number>();
    const rows: GetLoyaltyLedger200Item[] = [];
    for (const page of ledger.data?.pages ?? []) {
      for (const entry of page) {
        if (entry.id !== undefined) {
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
        }
        rows.push(entry);
      }
    }
    return rows;
  }, [ledger.data]);

  // A background-refresh failure with stale rows on screen is NOT an
  // error screen — only a failed first load is.
  const ledgerLoadError = ledger.isError && (ledger.data?.pages.length ?? 0) === 0;

  const handleConvert = async () => {
    // Re-entry guard: the CTA's disabled predicate blocks discrete taps,
    // but a same-frame double-fire must not reach the money path twice.
    if (converting) return;
    const pts = Number.parseInt(pointsInput, 10);
    if (!Number.isFinite(pts) || pts < pointsPerLyd) {
      setConvertError(`الحد الأدنى ${pointsPerLyd} نقطة`);
      return;
    }
    if (pts % pointsPerLyd !== 0) {
      setConvertError(`يجب أن تكون النقاط من مضاعفات ${pointsPerLyd}`);
      return;
    }
    setConvertError(null);

    // ONE durable key per conversion intent — minted lazily on the
    // intent's first attempt, reused across retries (a network drop
    // after a server-side commit replays the cached response instead of
    // converting AGAIN), cleared only at a definitive resolution.
    const fingerprint = `convert|${pts}`;
    const intentKey =
      (await loadIntentKey(INTENT_SLOTS.convert, INTENT_TTL_MS, fingerprint)) ??
      generateIdempotencyKey();
    await persistIntentKey(INTENT_SLOTS.convert, fingerprint, intentKey);

    try {
      // Belt-and-suspenders: the stable request object's header is read
      // at fetch time — sync it right before the POST.
      convertRequestRef.current.headers["Idempotency-Key"] = intentKey;
      const result = await convertMutation.mutateAsync({ data: { points: pts } });
      Alert.alert("تم التحويل", result.message);
      // Success is terminal — the next conversion mints a fresh key.
      await clearIntentKey(INTENT_SLOTS.convert);
      setPointsInput("");
      // Money moved: identity, wallet, the loyalty overview and the
      // ledger (the conversion_out row) all go stale otherwise.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetLoyaltyQueryKey() }),
        queryClient.invalidateQueries({ queryKey: LEDGER_QUERY_KEY }),
      ]);
    } catch (err: unknown) {
      // Only a DEFINITIVE HTTP rejection resolves the intent — a 409
      // IDEMPOTENCY_IN_FLIGHT (same-key conversion still executing
      // server-side) and a network-level failure (outcome unknown — the
      // retry must replay) both keep the durable key.
      const code = apiErrorCode(err);
      if (code && code !== ErrorCode.IDEMPOTENCY_IN_FLIGHT) {
        await clearIntentKey(INTENT_SLOTS.convert);
      }
      setConvertError(getErrorMessage(err) || "تعذّر إتمام العملية — حاول مرة أخرى");
    }
  };

  if (isLoading) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      >
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <Skeleton style={{ flex: 1, height: 132, borderRadius: radius.lg }} />
          <Skeleton style={{ flex: 1, height: 132, borderRadius: radius.lg }} />
          <Skeleton style={{ flex: 1, height: 132, borderRadius: radius.lg }} />
        </View>
        <Skeleton style={{ height: 150, borderRadius: radius.lg }} />
        <Skeleton style={{ height: 120, borderRadius: radius.lg }} />
        <Skeleton style={{ height: 220, borderRadius: radius.lg }} />
      </ScrollView>
    );
  }

  if (isError && !data) {
    // A failed first load with nothing on screen — an honest error with
    // retry (never a zeroed stats frame).
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
          gap: spacing.md,
        }}
        accessibilityRole="alert"
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            backgroundColor: `${colors.error}1A`,
            borderWidth: 1,
            borderColor: `${colors.error}38`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon
            sf="wifi.exclamationmark"
            md="signal_wifi_connected_no_internet4"
            size={28}
            color={colors.error}
          />
        </View>
        <ThemedText variant="headline" style={{ textAlign: "center" }}>
          تعذّر تحميل بيانات الولاء
        </ThemedText>
        <ThemedText
          variant="subhead"
          style={{ textAlign: "center", color: colors.onSurface }}
          selectable
        >
          {getErrorMessage(error)}
        </ThemedText>
        <Button title="إعادة المحاولة" variant="secondary" onPress={() => void refetch()} />
      </View>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md }}
    >
      {isError ? (
        <InlineError message={getErrorMessage(error)} onRetry={() => void refetch()} />
      ) : null}

      {/* ── Stats trio ─────────────────────────────────────────────── */}
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <PointsTile points={data.points} valueLyd={Number(data.points_value_lyd)} />
        <TierTile
          tier={data.tier}
          nextTier={data.next_tier}
          progressPercent={tierProgressPercent}
        />
        <ReferralsTile credited={data.referrals_credited} pending={data.referrals_pending} />
      </View>

      {/* ── Convert-points card (the money action) ─────────────────── */}
      <ConvertCard
        points={data.points}
        pointsPerLyd={pointsPerLyd}
        value={pointsInput}
        onChange={setPointsInput}
        validation={convertValidation}
        previewAmount={previewAmount}
        converting={converting}
        convertError={convertError}
        onConvert={() => void handleConvert()}
      />

      {/* ── How to earn ───────────────────────────────────────────── */}
      <HowToEarnCard pointsPerReferral={pointsPerReferral} tierThresholds={tierThresholds} />

      {/* ── Points ledger ──────────────────────────────────────────── */}
      <LedgerCard
        entries={ledgerEntries}
        isLoading={ledger.isLoading}
        loadError={ledgerLoadError}
        error={ledger.error}
        onRetry={() => void ledger.refetch()}
        hasNextPage={ledger.hasNextPage}
        isFetchingNextPage={ledger.isFetchingNextPage}
        isFetching={ledger.isFetching}
        onLoadMore={() => void ledger.fetchNextPage()}
      />
    </ScrollView>
  );
}

// ── Stats tiles ─────────────────────────────────────────────────────────────

function PointsTile({ points, valueLyd }: { points: number; valueLyd: number }) {
  const colors = useColors();
  return (
    <View style={[tileStyle(colors), { flex: 1 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon sf="star.fill" md="star" size={12} color={colors.warning} />
        <ThemedText variant="micro" style={{ color: colors.onSurface }}>
          نقاطي
        </ThemedText>
      </View>
      <ThemedText variant="title" style={{ color: colors.warning, fontVariant: ["tabular-nums"] }}>
        {formatNumber(points)}
      </ThemedText>
      <ThemedText
        variant="footnote"
        style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
      >
        {formatCurrency(valueLyd)}
      </ThemedText>
    </View>
  );
}

function TierTile({
  tier,
  nextTier,
  progressPercent,
}: {
  tier: string;
  nextTier: LoyaltySummary["next_tier"];
  progressPercent: number;
}) {
  const colors = useColors();
  const tierColor = colors[tierColorKey(tier)];

  return (
    <View style={[tileStyle(colors), { flex: 1.25, gap: spacing.sm }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon sf="chart.line.uptrend.xyaxis" md="trending-up" size={12} color={colors.onSurface} />
        <ThemedText variant="micro" style={{ color: colors.onSurface }}>
          مستواي
        </ThemedText>
      </View>
      <ThemedText variant="headline" style={{ color: tierColor, fontFamily: "ReadexPro-Bold" }}>
        {tierLabel(tier)}
      </ThemedText>
      {nextTier ? (
        <View style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <ThemedText variant="micro" style={{ color: colors.onSurface }}>
              التالي:{" "}
              <ThemedText
                variant="micro"
                style={{ color: colors.foreground, fontFamily: "ReadexPro-SemiBold" }}
              >
                {nextTier.label}
              </ThemedText>
            </ThemedText>
            <ThemedText
              variant="micro"
              style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
            >
              {formatCurrency(nextTier.remaining)}
            </ThemedText>
          </View>
          <View
            style={{
              height: 6,
              borderRadius: radius.full,
              backgroundColor: colors.secondary,
              overflow: "hidden",
            }}
            accessibilityLabel={`تقدّم المستوى ${progressPercent}%`}
          >
            <View
              style={{
                height: "100%",
                width: `${progressPercent}%`,
                backgroundColor: colors.primary,
                borderRadius: radius.full,
              }}
            />
          </View>
          <ThemedText variant="micro" style={{ color: colors.onSurface }}>
            {`متبقٍ ${formatCurrency(nextTier.remaining)} للترقية`}
          </ThemedText>
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Icon sf="crown.fill" md="workspace_premium" size={12} color={colors.tierPlatinum} />
          <ThemedText
            variant="micro"
            style={{ color: colors.tierPlatinum, fontFamily: "ReadexPro-SemiBold" }}
          >
            أعلى مستوى
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function ReferralsTile({ credited, pending }: { credited: number; pending: number }) {
  const colors = useColors();
  return (
    <View style={[tileStyle(colors), { flex: 1 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon sf="person.2.fill" md="group" size={12} color={colors.info} />
        <ThemedText variant="micro" style={{ color: colors.onSurface }}>
          إحالاتي
        </ThemedText>
      </View>
      <ThemedText variant="title" style={{ color: colors.info, fontVariant: ["tabular-nums"] }}>
        {formatNumber(credited)}
      </ThemedText>
      <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
        {pending > 0 ? (
          <ThemedText
            variant="footnote"
            style={{ color: colors.warning, fontFamily: "ReadexPro-SemiBold" }}
          >
            {arabicCount(pending, {
              zero: "إحالات",
              one: "إحالة قيد الانتظار",
              two: "إحالتان قيد الانتظار",
              few: "إحالات قيد الانتظار",
              many: "إحالة قيد الانتظار",
              other: "إحالة قيد الانتظار",
            })}
            {" · "}
          </ThemedText>
        ) : null}
        إحالة ناجحة
      </ThemedText>
    </View>
  );
}

// ── Convert card ────────────────────────────────────────────────────────────

function ConvertCard({
  points,
  pointsPerLyd,
  value,
  onChange,
  validation,
  previewAmount,
  converting,
  convertError,
  onConvert,
}: {
  points: number;
  pointsPerLyd: number;
  value: string;
  onChange: (value: string) => void;
  validation: string | null;
  previewAmount: number | null;
  converting: boolean;
  convertError: string | null;
  onConvert: () => void;
}) {
  const colors = useColors();
  const belowMinimum = points < pointsPerLyd;

  return (
    <View style={cardStyle(colors)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: radius.sm,
            borderCurve: "continuous",
            backgroundColor: `${colors.primary}1A`,
            borderWidth: 1,
            borderColor: `${colors.primary}30`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon sf="bolt.fill" md="bolt" size={14} color={colors.primary} />
        </View>
        <ThemedText variant="headline">تحويل النقاط إلى رصيد</ThemedText>
      </View>
      <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
        كل{" "}
        <ThemedText
          variant="footnote"
          style={{ color: colors.foreground, fontFamily: "ReadexPro-SemiBold" }}
        >
          {formatNumber(pointsPerLyd)} نقطة
        </ThemedText>{" "}
        ={" "}
        <ThemedText
          variant="footnote"
          style={{ color: colors.primaryText, fontFamily: "ReadexPro-SemiBold" }}
        >
          1 د.ل
        </ThemedText>
      </ThemedText>

      {/* Persistent conversion failure — cleared only when a new
          attempt starts (never a seconds-long flash on a money action). */}
      {convertError ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            backgroundColor: `${colors.error}1A`,
            borderWidth: 1,
            borderColor: `${colors.error}38`,
            borderRadius: radius.md,
            borderCurve: "continuous",
            padding: spacing.md,
          }}
          accessibilityRole="alert"
        >
          <Icon sf="exclamationmark.circle.fill" md="error" size={16} color={colors.error} />
          <ThemedText variant="footnote" style={{ color: colors.error, flex: 1 }} selectable>
            {`تعذّر التحويل: ${convertError}`}
          </ThemedText>
        </View>
      ) : null}

      {belowMinimum ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            backgroundColor: colors.secondary,
            borderRadius: radius.md,
            borderCurve: "continuous",
            padding: spacing.md,
          }}
        >
          <Icon sf="arrow.up.left" md="call-made" size={16} color={colors.primary} />
          <ThemedText variant="footnote" style={{ color: colors.onSurface, flex: 1 }}>
            تحتاج إلى{" "}
            <ThemedText
              variant="footnote"
              style={{ color: colors.foreground, fontFamily: "ReadexPro-SemiBold" }}
            >
              {arabicCount(pointsPerLyd - points, POINTS_FORMS)}
            </ThemedText>{" "}
            {`إضافية للوصول للحد الأدنى (${formatNumber(pointsPerLyd)} نقطة)`}
          </ThemedText>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <TextInput
            accessibilityLabel="عدد النقاط للتحويل"
            accessibilityHint={`مضاعفات ${pointsPerLyd} نقطة على الأقل`}
            value={value}
            onChangeText={onChange}
            keyboardType="number-pad"
            autoComplete="off"
            placeholder={`عدد النقاط (${pointsPerLyd}، ${pointsPerLyd * 2}، …)`}
            placeholderTextColor={colors.onSurface}
            maxLength={9}
            style={{
              direction: "ltr",
              textAlign: "left",
              minHeight: spacing.touch,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              backgroundColor: colors.secondary,
              borderRadius: radius.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: validation ? colors.error : colors.border,
              color: colors.foreground,
              fontFamily: "ReadexPro-Regular",
              fontSize: 17,
              fontVariant: ["tabular-nums"],
            }}
          />
          {validation ? (
            <ThemedText variant="footnote" style={{ color: colors.error }} accessibilityRole="note">
              {validation}
            </ThemedText>
          ) : null}
          {previewAmount !== null ? (
            <ThemedText
              variant="footnote"
              style={{
                color: colors.success,
                fontFamily: "ReadexPro-SemiBold",
                fontVariant: ["tabular-nums"],
              }}
            >
              {`ستحصل على ${formatCurrency(previewAmount)}`}
            </ThemedText>
          ) : null}
          <Button
            title={converting ? "جارٍ…" : "تحويل"}
            onPress={onConvert}
            disabled={!value || converting}
            loading={converting}
            accessibilityHint="يحوّل النقاط إلى رصيد في محفظتك"
          />
        </View>
      )}
    </View>
  );
}

// ── How-to-earn card ────────────────────────────────────────────────────────

function HowToEarnCard({
  pointsPerReferral,
  tierThresholds,
}: {
  pointsPerReferral: number;
  tierThresholds: Record<string, number>;
}) {
  const colors = useColors();

  const rows: { icon: { sf: string; md: string }; color: string; label: string; points: string }[] =
    [
      {
        icon: { sf: "person.2.fill", md: "group" },
        color: colors.info,
        label: "إحالة صديق يُعتمد أول شحن له",
        points: `+${formatNumber(pointsPerReferral)} نقطة`,
      },
      {
        icon: { sf: "cart.fill", md: "shopping-cart" },
        color: colors.success,
        label: "عند كل عملية شراء",
        points: "نقطة لكل 1 د.ل مدفوع",
      },
      {
        icon: { sf: "crown.fill", md: "workspace_premium" },
        color: colors.tierSilver,
        label: `المستوى الفضي (${formatCurrency(tierThresholds.silver)} إنفاق)`,
        points: "مزايا قريباً",
      },
      {
        icon: { sf: "star.fill", md: "star" },
        color: colors.warning,
        label: `المستوى الذهبي (${formatCurrency(tierThresholds.gold)} إنفاق)`,
        points: "مزايا قريباً",
      },
    ];

  return (
    <View style={cardStyle(colors)}>
      <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
        كيف تكسب النقاط؟
      </ThemedText>
      {/* Hairline rows, not boxed chips (the grouped-rows discipline). */}
      <View>
        {rows.map((row, index) => (
          <View
            key={row.label}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              paddingVertical: spacing.md,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: `${colors.border}66`,
            }}
          >
            <Icon sf={row.icon.sf} md={row.icon.md} size={16} color={row.color} />
            <ThemedText variant="callout" style={{ flex: 1 }}>
              {row.label}
            </ThemedText>
            <ThemedText
              variant="footnote"
              style={{
                color: colors.primaryText,
                fontFamily: "ReadexPro-SemiBold",
                fontVariant: ["tabular-nums"],
              }}
            >
              {row.points}
            </ThemedText>
          </View>
        ))}
      </View>
      <ThemedText variant="micro" style={{ color: colors.onSurface }}>
        المستويات مؤشرات تقدّم في هذه المرحلة — سنُعلن عن مزاياها عند تفعيلها.
      </ThemedText>
    </View>
  );
}

// ── Ledger card ─────────────────────────────────────────────────────────────

function LedgerCard({
  entries,
  isLoading,
  loadError,
  error,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  isFetching,
  onLoadMore,
}: {
  entries: GetLoyaltyLedger200Item[];
  isLoading: boolean;
  loadError: boolean;
  error: unknown;
  onRetry: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
}) {
  const colors = useColors();

  return (
    <View style={cardStyle(colors)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon sf="clock.arrow.circlepath" md="history" size={16} color={colors.onSurface} />
        <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold", flex: 1 }}>
          سجل النقاط
        </ThemedText>
        {entries.length > 0 ? (
          <ThemedText variant="micro" style={{ color: colors.onSurface }}>
            {arabicCount(entries.length, MOVEMENT_FORMS)}
          </ThemedText>
        ) : null}
      </View>

      {loadError ? (
        <InlineRetry message={getErrorMessage(error)} onRetry={onRetry} />
      ) : isLoading ? (
        <View style={{ gap: spacing.md }}>
          {Array.from({ length: 3 }, (_, i) => (
            <View
              key={i}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                paddingVertical: spacing.xs,
              }}
            >
              <Skeleton style={{ width: 28, height: 28, borderRadius: radius.sm }} />
              <Skeleton style={{ flex: 1, height: 34, borderRadius: radius.sm }} />
              <Skeleton style={{ width: 56, height: 20, borderRadius: radius.full }} />
            </View>
          ))}
        </View>
      ) : entries.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.xs }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor: colors.secondary,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon sf="star" md="star_border" size={24} color={colors.onSurface} />
          </View>
          <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
            لا توجد حركات نقاط بعد
          </ThemedText>
          <ThemedText variant="footnote" style={{ color: colors.onSurface, textAlign: "center" }}>
            ستظهر هنا نقاط الشراء والإحالة والتحويل
          </ThemedText>
        </View>
      ) : (
        <View>
          {entries.map((entry, index) => (
            <LedgerRow key={entry.id ?? index} entry={entry} first={index === 0} />
          ))}
          {hasNextPage ? (
            <View style={{ alignItems: "center", paddingTop: spacing.md }}>
              <Button
                variant="secondary"
                size="sm"
                title="تحميل المزيد"
                loading={isFetchingNextPage}
                disabled={isFetching && !isFetchingNextPage}
                onPress={onLoadMore}
              />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function LedgerRow({ entry, first }: { entry: GetLoyaltyLedger200Item; first: boolean }) {
  const colors = useColors();
  const delta = entry.points_delta ?? 0;
  const gain = delta >= 0;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: `${colors.border}66`,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <ThemedText variant="footnote" style={{ fontFamily: "ReadexPro-SemiBold" }}>
          {entry.type_label ?? entry.type ?? "حركة"}
        </ThemedText>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}
        >
          {typeof entry.points_after === "number" ? (
            <ThemedText
              variant="micro"
              style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
            >
              {`الرصيد: ${formatNumber(entry.points_after)}`}
            </ThemedText>
          ) : null}
          {typeof entry.lyd_credited === "number" ? (
            <ThemedText
              variant="micro"
              style={{
                color: colors.success,
                fontFamily: "ReadexPro-SemiBold",
                direction: "ltr",
                fontVariant: ["tabular-nums"],
              }}
            >
              {`+${formatCurrency(entry.lyd_credited)}`}
            </ThemedText>
          ) : null}
          {entry.created_at ? (
            <ThemedText variant="micro" style={{ color: colors.onSurface }}>
              {`· ${formatShortDate(entry.created_at)}`}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        {/* direction:"ltr" — the sign must lead the number inside the
            RTL layout; the unit sits in the RTL flow. */}
        <ThemedText
          variant="callout"
          style={{
            color: gain ? colors.foreground : colors.onSurface,
            fontFamily: "ReadexPro-Bold",
            direction: "ltr",
            fontVariant: ["tabular-nums"],
          }}
        >
          {`${gain ? "+" : "-"}${formatNumber(Math.abs(delta))}`}
        </ThemedText>
        <ThemedText variant="micro" style={{ color: colors.onSurface }}>
          {arabicCount(Math.abs(delta), POINTS_FORMS)}
        </ThemedText>
      </View>
    </View>
  );
}

// ── Shared shells ───────────────────────────────────────────────────────────

/** Non-blocking inline retry strip for the ledger's in-card error state. */
function InlineRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.sm,
        backgroundColor: colors.secondary,
        borderRadius: radius.sm,
        borderCurve: "continuous",
        borderStartWidth: 3,
        borderStartColor: colors.error,
        padding: spacing.md,
      }}
      accessibilityRole="alert"
    >
      <ThemedText variant="footnote" style={{ flex: 1 }} selectable>
        {message}
      </ThemedText>
      <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
        <ThemedText variant="footnote" style={{ color: colors.primary }}>
          إعادة
        </ThemedText>
      </Pressable>
    </View>
  );
}

function tileStyle(colors: ReturnType<typeof useColors>) {
  return {
    backgroundColor: colors.surfaceCard,
    borderRadius: radius.lg,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  };
}

function cardStyle(colors: ReturnType<typeof useColors>) {
  return {
    backgroundColor: colors.surfaceCard,
    borderRadius: radius.lg,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  };
}
