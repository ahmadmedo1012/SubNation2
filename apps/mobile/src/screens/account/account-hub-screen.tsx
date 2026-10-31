import { Alert, Pressable, ScrollView, View } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useGetMe, type LinkedIdentity } from "@workspace/api-client-native";

import { Icon } from "@/components/icon";
import { InlineError, Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency, formatNumber } from "@/lib/money";
import { useColors, radius, spacing } from "@/theme";
import { tierColorKey, tierLabel } from "./dates";
import { SignInPrompt } from "./sign-in-prompt";

/**
 * Account hub — the native twin of the web's /profile page, reshaped for
 * the mobile menu idiom: a tier-tinted identity card (name / phone /
 * linked providers / balance + points from useGetMe) over a single
 * grouped menu surface (rows separated by hairlines — NOT boxed cards),
 * a confirm-guarded sign-out, and the app version row.
 */
export function AccountHubScreen() {
  const { status } = useAuth();

  if (status === "guest") {
    return <SignInPrompt message="سجّل دخولك لإدارة حسابك ومحفظتك ونقاطك وجلساتك." />;
  }
  return <AccountHubContent />;
}

function AccountHubContent() {
  const colors = useColors();
  const { signOut } = useAuth();

  const { data: user, isLoading, isError, error, refetch } = useGetMe({ query: { enabled: true } });

  const appVersion = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;

  const confirmSignOut = () => {
    Alert.alert(
      "تسجيل الخروج",
      "هل أنت متأكد من رغبتك في تسجيل الخروج من حسابك؟",
      [
        { text: "إلغاء", style: "cancel" },
        { text: "تسجيل الخروج", style: "destructive", onPress: () => void signOut() },
      ],
      { cancelable: true },
    );
  };

  const menu: MenuRow[] = [
    {
      label: "المحفظة",
      icon: { sf: "creditcard.fill", md: "account_balance_wallet" },
      href: "/(tabs)/(wallet)",
    },
    {
      label: "نقاط الولاء",
      icon: { sf: "crown.fill", md: "stars" },
      href: "/(tabs)/(account)/loyalty",
    },
    {
      label: "الإحالات",
      icon: { sf: "gift.fill", md: "card_giftcard" },
      href: "/(tabs)/(account)/referrals",
    },
    {
      label: "الدعم الفني",
      icon: { sf: "headphones", md: "headset_mic" },
      href: "/(tabs)/(account)/support",
    },
    {
      label: "الإشعارات",
      icon: { sf: "bell.fill", md: "notifications" },
      href: "/(tabs)/(account)/notifications",
    },
    {
      label: "الأجهزة والجلسات",
      icon: { sf: "iphone.gen3", md: "smartphone" },
      href: "/(tabs)/(account)/sessions",
    },
    {
      label: "الشروط والخصوصية",
      icon: { sf: "doc.text.fill", md: "description" },
      href: "/(tabs)/(account)/terms",
    },
  ];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg }}
    >
      {/* ── Identity card ────────────────────────────────────────────── */}
      {isLoading ? (
        <Skeleton style={{ height: 168, borderRadius: radius.lg }} />
      ) : isError ? (
        // A failed /auth/me never blanks the hub: honest inline error +
        // retry; the menu below stays usable.
        <InlineError message={getErrorMessage(error)} onRetry={() => void refetch()} />
      ) : user ? (
        <IdentityCard
          displayName={user.display_name}
          phone={user.phone}
          tier={user.loyalty_tier}
          balance={user.wallet_balance}
          points={user.loyalty_points}
          linkedIdentities={user.linked_identities}
        />
      ) : null}

      {/* ── Menu — grouped rows with hairlines ──────────────────────── */}
      <View
        style={{
          backgroundColor: colors.surfaceCard,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        }}
      >
        {menu.map((row, index) => (
          <MenuRowButton key={row.href} row={row} first={index === 0} />
        ))}
        <View style={{ height: 1, backgroundColor: colors.border }} accessibilityRole="separator" />
        <MenuRowButton
          row={{
            label: "تسجيل الخروج",
            icon: { sf: "rectangle.portrait.and.arrow.right", md: "logout" },
            onPress: confirmSignOut,
            destructive: true,
          }}
          first={false}
        />
      </View>

      {/* ── Version row ──────────────────────────────────────────────── */}
      <View style={{ alignItems: "center", paddingBottom: spacing.sm }}>
        <ThemedText
          variant="micro"
          style={{ color: colors.onSurface, direction: "ltr" }}
          selectable
        >
          {`SubNation · الإصدار ${appVersion ?? "—"}`}
        </ThemedText>
      </View>
    </ScrollView>
  );
}

interface MenuRow {
  label: string;
  icon: { sf: string; md: string };
  href?: string;
  onPress?: () => void;
  destructive?: boolean;
}

function MenuRowButton({ row, first }: { row: MenuRow; first: boolean }) {
  const colors = useColors();
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.label}
      onPress={() => {
        if (row.onPress) {
          row.onPress();
          return;
        }
        if (row.href) router.push(row.href);
      }}
      style={({ pressed }) => ({
        minHeight: spacing.touch + spacing.xs,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        backgroundColor: pressed ? colors.surfaceOverlay : "transparent",
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Icon
          sf={row.icon.sf}
          md={row.icon.md}
          size={20}
          color={row.destructive ? colors.error : colors.primary}
        />
        <ThemedText
          variant="callout"
          style={{
            flex: 1,
            color: row.destructive ? colors.error : colors.foreground,
            fontFamily: row.destructive ? "ReadexPro-SemiBold" : "ReadexPro-Regular",
          }}
        >
          {row.label}
        </ThemedText>
        {!row.onPress ? (
          <Icon sf="chevron.left" md="chevron-left" size={16} color={colors.onSurface} />
        ) : null}
      </View>
    </Pressable>
  );
}

function IdentityCard({
  displayName,
  phone,
  tier,
  balance,
  points,
  linkedIdentities,
}: {
  displayName?: string | null;
  phone: string;
  tier: string;
  balance: number;
  points: number;
  linkedIdentities?: LinkedIdentity[];
}) {
  const colors = useColors();
  const tierColor = colors[tierColorKey(tier)];

  const avatarInitial =
    displayName?.trim()?.charAt(0)?.toUpperCase() ||
    (phone.startsWith("tg_") || phone.startsWith("fb_") || phone.startsWith("gh_")
      ? "U"
      : phone.slice(-2) || "U");

  return (
    <View
      style={{
        backgroundColor: colors.surfaceCard,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: `${tierColor}33`,
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        {/* Avatar tile */}
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: colors.secondary,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ThemedText variant="title" style={{ color: colors.primary }}>
            {avatarInitial}
          </ThemedText>
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
          {/* Tier badge */}
          <View
            style={{
              alignSelf: "flex-start",
              backgroundColor: `${tierColor}1A`,
              borderWidth: 1,
              borderColor: `${tierColor}30`,
              borderRadius: radius.full,
              paddingHorizontal: spacing.md,
              paddingVertical: 2,
            }}
          >
            <ThemedText
              variant="micro"
              style={{ color: tierColor, fontFamily: "ReadexPro-SemiBold" }}
            >
              {tierLabel(tier)}
            </ThemedText>
          </View>

          {displayName ? (
            <ThemedText variant="headline" numberOfLines={1}>
              {displayName}
            </ThemedText>
          ) : null}

          {/* Phone row (Telegram accounts read as their provider). */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            {phone.startsWith("tg_") ? (
              <>
                <Icon sf="iphone" md="smartphone" size={12} color={colors.onSurface} />
                <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
                  حساب Telegram
                </ThemedText>
              </>
            ) : (
              <>
                <Icon sf="phone.fill" md="call" size={12} color={colors.onSurface} />
                <ThemedText
                  variant="footnote"
                  style={{ color: colors.onSurface, direction: "ltr" }}
                  selectable
                >
                  {phone}
                </ThemedText>
              </>
            )}
          </View>
        </View>
      </View>

      {/* Balance + points summary */}
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.secondary,
            borderRadius: radius.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}
        >
          <ThemedText variant="micro" style={{ color: colors.onSurface }}>
            الرصيد
          </ThemedText>
          <ThemedText
            variant="headline"
            style={{ color: colors.primaryText, fontVariant: ["tabular-nums"] }}
          >
            {formatCurrency(balance)}
          </ThemedText>
        </View>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.secondary,
            borderRadius: radius.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}
        >
          <ThemedText variant="micro" style={{ color: colors.onSurface }}>
            النقاط
          </ThemedText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon sf="star.fill" md="star" size={12} color={colors.warning} />
            <ThemedText
              variant="headline"
              style={{ color: colors.warning, fontVariant: ["tabular-nums"] }}
            >
              {formatNumber(points)}
            </ThemedText>
          </View>
        </View>
      </View>

      {/* Linked providers */}
      {linkedIdentities && linkedIdentities.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <ThemedText variant="micro" style={{ color: colors.onSurface }}>
            الحسابات المرتبطة
          </ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {linkedIdentities.map((identity) => (
              <View
                key={`${identity.provider}:${identity.provider_uid}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs,
                  backgroundColor: `${colors.success}1A`,
                  borderWidth: 1,
                  borderColor: `${colors.success}38`,
                  borderRadius: radius.full,
                  paddingHorizontal: spacing.md,
                  paddingVertical: 2,
                }}
              >
                <Icon sf="link" md="link" size={10} color={colors.success} />
                <ThemedText variant="micro" style={{ color: colors.success }}>
                  {providerDisplayName(identity.provider)}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function providerDisplayName(provider: string): string {
  if (provider === "google.com") return "Google";
  if (provider === "firebase.com") return "رقم الهاتف";
  if (provider === "telegram.org") return "Telegram";
  return provider;
}
