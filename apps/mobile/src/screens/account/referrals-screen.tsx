import { Share, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import {
  useGetLoyalty,
  useListReferrals,
  type ReferralEventItem,
} from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatNumber } from "@/lib/money";
import { useColors, radius, spacing } from "@/theme";
import { formatRelativeTime } from "./dates";
import { SignInPrompt } from "./sign-in-prompt";

/**
 * Referrals — the native twin of the web's /referrals page:
 *   • the stats quartet (total / credited / pending / earned points);
 *   • the referral-code card — a big selectable Text (the platform's
 *     long-press selection menu carries copy) + the referral_link row +
 *     a full-width Share action (RN core Share.share — no clipboard
 *     package is installed; see credential-card.tsx for the same
 *     documented limitation);
 *   • the 50-points-per-approved-topup reward note (values from the
 *     API's points_rate, never hardcoded);
 *   • the invited-friends list with per-referral status badges and the
 *     200-row honesty chip;
 *   • the four states everywhere.
 */

/** The backend caps the referral list at 200 rows per page. */
const REFERRALS_PAGE_CAP = 200;

export function ReferralsScreen() {
  const { status } = useAuth();

  if (status === "guest") {
    return (
      <SignInPrompt message="سجّل دخولك لعرض رمز الإحالة الخاص بك ومتابعة مكافآت دعوة أصدقائك." />
    );
  }
  return <ReferralsContent />;
}

function ReferralsContent() {
  const colors = useColors();
  const router = useRouter();

  const overview = useGetLoyalty();
  const events = useListReferrals();

  const data = overview.data ?? null;
  const rows = events.data ?? [];
  const loading = overview.isLoading || events.isLoading;

  // Error-as-empty is forbidden: an outage with nothing on screen is an
  // honest error card with retry — a background-refresh failure with
  // stale content up is NOT.
  const loadError =
    !loading &&
    ((overview.isError && overview.data == null) || (events.isError && events.data == null));

  const referralCode = data?.referral_code ?? "";
  const referralLink = data?.referral_link ?? "";
  const pointsPerReferral = data?.points_rate.points_per_referral ?? 50;

  const totalPointsEarned = rows
    .filter((e) => e.status === "credited")
    .reduce((sum, e) => sum + e.points_earned, 0);

  const handleShare = () => {
    if (!data) return;
    const message = [
      "انضم إلى SubNation — متجر الاشتراكات الرقمية بالدينار الليبي",
      `استخدم رمز الإحالة: ${referralCode}`,
      referralLink,
    ].join("\n");
    // A dismissed share sheet is a no-op, never an error surface.
    Share.share({ title: "SubNation", message, url: referralLink || undefined }).catch(() => {});
  };

  if (loadError) {
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
          تعذّر تحميل بيانات الإحالات
        </ThemedText>
        <ThemedText
          variant="subhead"
          style={{ textAlign: "center", color: colors.onSurface }}
          selectable
        >
          {overview.isError && overview.data == null
            ? getErrorMessage(overview.error)
            : getErrorMessage(events.error)}
        </ThemedText>
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <Button
            title="إعادة المحاولة"
            variant="secondary"
            onPress={() => {
              void overview.refetch();
              void events.refetch();
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md }}
    >
      {/* ── Stats quartet ──────────────────────────────────────────── */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        <StatTile
          label="إجمالي الإحالات"
          value={loading ? "—" : formatNumber(data?.referrals_total ?? 0)}
          icon={{ sf: "person.2.fill", md: "group" }}
          color={colors.info}
        />
        <StatTile
          label="إحالات ناجحة"
          value={loading ? "—" : formatNumber(data?.referrals_credited ?? 0)}
          icon={{ sf: "checkmark.circle.fill", md: "check_circle" }}
          color={colors.success}
        />
        <StatTile
          label="قيد الانتظار"
          value={loading ? "—" : formatNumber(data?.referrals_pending ?? 0)}
          icon={{ sf: "clock.fill", md: "schedule" }}
          color={colors.warning}
        />
        <StatTile
          label="نقاط مكتسبة"
          value={loading ? "—" : formatNumber(totalPointsEarned)}
          icon={{ sf: "star.fill", md: "star" }}
          color={colors.warning}
        />
      </View>

      {/* ── Referral code + link card ──────────────────────────────── */}
      <View style={cardStyle(colors)}>
        <ThemedText
          variant="micro"
          style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
        >
          رمز الإحالة الخاص بك
        </ThemedText>
        {loading ? (
          <Skeleton style={{ height: 32, width: 132, borderRadius: radius.sm }} />
        ) : (
          // Big selectable Text — long-press selection carries the copy
          // action (no clipboard package installed; see the docblock).
          <ThemedText
            variant="title"
            selectable
            accessibilityLabel={`رمز الإحالة ${referralCode || "—"}`}
            style={{ direction: "ltr", textAlign: "left", fontVariant: ["tabular-nums"] }}
            numberOfLines={1}
          >
            {referralCode || "—"}
          </ThemedText>
        )}

        {!loading && referralLink ? (
          <View
            style={{
              backgroundColor: colors.secondary,
              borderRadius: radius.md,
              borderCurve: "continuous",
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              minHeight: spacing.touch,
              justifyContent: "center",
            }}
          >
            <ThemedText
              variant="footnote"
              selectable
              accessibilityLabel="رابط الإحالة"
              style={{ color: colors.onSurface, direction: "ltr", textAlign: "left" }}
              numberOfLines={1}
            >
              {referralLink}
            </ThemedText>
          </View>
        ) : null}

        {!loading && data ? (
          <Button
            title="مشاركة الرابط"
            size="lg"
            onPress={handleShare}
            accessibilityHint="يفتح قائمة المشاركة لإرسال رمز الإحالة"
          />
        ) : null}
      </View>

      {/* ── Reward note (the 50-points-per-approved-topup copy) ────── */}
      {!loading && data ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            backgroundColor: `${colors.warning}14`,
            borderWidth: 1,
            borderColor: `${colors.warning}38`,
            borderRadius: radius.md,
            borderCurve: "continuous",
            padding: spacing.md,
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: radius.sm,
              borderCurve: "continuous",
              backgroundColor: `${colors.warning}1A`,
              borderWidth: 1,
              borderColor: `${colors.warning}30`,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon sf="bolt.fill" md="bolt" size={16} color={colors.warning} />
          </View>
          <ThemedText variant="callout" style={{ flex: 1 }}>
            تحصل على{" "}
            <ThemedText
              variant="callout"
              style={{
                color: colors.warning,
                fontFamily: "ReadexPro-Bold",
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatNumber(pointsPerReferral)} نقطة
            </ThemedText>{" "}
            عن كل إحالة ناجحة (تُقيد عند اعتماد أول شحن لصديقك) — قابلة للتحويل إلى رصيد في المحفظة
          </ThemedText>
        </View>
      ) : null}

      {/* ── How it works ───────────────────────────────────────────── */}
      <HowItWorksCard />

      {/* ── Invited-friends history ───────────────────────────────── */}
      <View style={cardStyle(colors)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon sf="person.2.fill" md="group" size={16} color={colors.onSurface} />
          <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold", flex: 1 }}>
            سجل الإحالات
          </ThemedText>
          {rows.length > 0 ? (
            <View
              style={{
                backgroundColor: colors.secondary,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.full,
                paddingHorizontal: spacing.sm,
                paddingVertical: 1,
              }}
            >
              <ThemedText
                variant="micro"
                style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
              >
                {/* A full page is a TRUNCATED window, not the total —
                    the stat tiles above carry the true aggregate. */}
                {rows.length >= REFERRALS_PAGE_CAP
                  ? "عرض آخر 200 إحالة"
                  : formatNumber(rows.length)}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {loading ? (
          <View style={{ gap: spacing.md }}>
            {Array.from({ length: 3 }, (_, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <Skeleton style={{ width: 36, height: 36, borderRadius: radius.sm }} />
                <Skeleton style={{ flex: 1, height: 40, borderRadius: radius.sm }} />
                <Skeleton style={{ width: 64, height: 20, borderRadius: radius.full }} />
              </View>
            ))}
          </View>
        ) : rows.length === 0 ? (
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
              <Icon sf="person.2" md="group" size={24} color={colors.onSurface} />
            </View>
            <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
              لا توجد إحالات بعد
            </ThemedText>
            <ThemedText variant="footnote" style={{ color: colors.onSurface, textAlign: "center" }}>
              شارك رابطك مع أصدقائك وابدأ في كسب النقاط
            </ThemedText>
          </View>
        ) : (
          <View>
            {rows.map((event, index) => (
              <ReferralRow key={event.id} event={event} first={index === 0} />
            ))}
          </View>
        )}
      </View>

      {/* CTA to the loyalty screen */}
      <Button
        title="عرض نقاطي وبرنامج الولاء"
        variant="ghost"
        onPress={() => router.push("/(tabs)/(account)/loyalty")}
        accessibilityHint="يفتح شاشة نقاط الولاء"
      />
    </ScrollView>
  );
}

// ── Stat tile ───────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: { sf: string; md: string };
  color: string;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexBasis: "47%",
        flexGrow: 1,
        backgroundColor: colors.surfaceCard,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.sm,
          borderCurve: "continuous",
          backgroundColor: `${color}1A`,
          borderWidth: 1,
          borderColor: `${color}30`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon sf={icon.sf} md={icon.md} size={14} color={color} />
      </View>
      {/* Counts are not statuses — emphasis by weight + size + tabular
          digits; the icon stage above carries the identity. */}
      <ThemedText variant="headline" style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </ThemedText>
      <ThemedText
        variant="micro"
        style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
      >
        {label}
      </ThemedText>
    </View>
  );
}

// ── How it works ────────────────────────────────────────────────────────────

function HowItWorksCard() {
  const colors = useColors();

  const steps: { icon: { sf: string; md: string }; color: string; text: string }[] = [
    {
      icon: { sf: "square.and.arrow.up", md: "share" },
      color: colors.primary,
      text: "شارك رابط الإحالة",
    },
    {
      icon: { sf: "person.badge.plus", md: "person_add" },
      color: colors.info,
      text: "صديقك يُنشئ حسابه",
    },
    {
      icon: { sf: "creditcard.fill", md: "account_balance_wallet" },
      color: colors.success,
      text: "يُعتمد أول شحن لصديقك",
    },
    {
      icon: { sf: "gift.fill", md: "card_giftcard" },
      color: colors.warning,
      text: "تُقيد مكافأة النقاط",
    },
  ];

  return (
    <View style={cardStyle(colors)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon sf="trophy.fill" md="emoji-events" size={16} color={colors.primary} />
        <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
          كيف يعمل البرنامج؟
        </ThemedText>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        {steps.map((step, index) => (
          <View
            key={step.text}
            style={{
              flex: 1,
              alignItems: "center",
              gap: spacing.sm,
              backgroundColor: colors.secondary,
              borderRadius: radius.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: colors.border,
              padding: spacing.md,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.sm,
                borderCurve: "continuous",
                backgroundColor: `${step.color}1A`,
                borderWidth: 1,
                borderColor: `${step.color}30`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon sf={step.icon.sf} md={step.icon.md} size={16} color={step.color} />
            </View>
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: radius.full,
                backgroundColor: `${colors.primary}1A`,
                alignItems: "center",
                justifyContent: "center",
              }}
              accessibilityLabel={`الخطوة ${index + 1}`}
            >
              <ThemedText
                variant="micro"
                style={{
                  color: colors.primaryText,
                  fontFamily: "ReadexPro-Bold",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {String(index + 1)}
              </ThemedText>
            </View>
            <ThemedText
              variant="micro"
              style={{
                color: colors.foreground,
                fontFamily: "ReadexPro-SemiBold",
                textAlign: "center",
              }}
            >
              {step.text}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Referral row ────────────────────────────────────────────────────────────

function ReferralRow({ event, first }: { event: ReferralEventItem; first: boolean }) {
  const colors = useColors();
  const credited = event.status === "credited";

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
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.sm,
          borderCurve: "continuous",
          backgroundColor: credited ? `${colors.success}1A` : `${colors.warning}1A`,
          borderWidth: 1,
          borderColor: credited ? `${colors.success}33` : `${colors.warning}33`,
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        accessibilityLabel={credited ? "إحالة ناجحة" : "إحالة قيد الانتظار"}
      >
        <Icon
          sf={credited ? "checkmark.circle.fill" : "clock.fill"}
          md={credited ? "check_circle" : "schedule"}
          size={16}
          color={credited ? colors.success : colors.warning}
        />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {/* direction:"ltr" — the mask "091****567" carries internal
            neutrals; the RTL base direction would visually flip its
            segments. */}
        <ThemedText
          variant="callout"
          selectable
          style={{ direction: "ltr", textAlign: "left", fontVariant: ["tabular-nums"] }}
        >
          {event.phone_masked}
        </ThemedText>
        <ThemedText variant="micro" style={{ color: colors.onSurface }}>
          {credited && event.credited_at
            ? `تم الائتمان · ${formatRelativeTime(event.credited_at)}`
            : `سجّل · ${formatRelativeTime(event.created_at)}`}
        </ThemedText>
      </View>

      {credited ? (
        <View
          style={{
            backgroundColor: `${colors.warning}1A`,
            borderWidth: 1,
            borderColor: `${colors.warning}30`,
            borderRadius: radius.full,
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
          }}
        >
          <ThemedText
            variant="micro"
            style={{
              color: colors.warning,
              fontFamily: "ReadexPro-SemiBold",
              fontVariant: ["tabular-nums"],
            }}
          >
            {`+${formatNumber(event.points_earned)} نقطة`}
          </ThemedText>
        </View>
      ) : (
        <View
          style={{
            backgroundColor: `${colors.warning}12`,
            borderWidth: 1,
            borderColor: `${colors.warning}26`,
            borderRadius: radius.full,
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
          }}
        >
          <ThemedText
            variant="micro"
            style={{ color: colors.warning, fontFamily: "ReadexPro-SemiBold" }}
          >
            قيد الانتظار
          </ThemedText>
        </View>
      )}
    </View>
  );
}

// ── Shared shell ────────────────────────────────────────────────────────────

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
