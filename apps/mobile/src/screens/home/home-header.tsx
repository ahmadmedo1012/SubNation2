import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useGetWallet } from "@workspace/api-client-native";

import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { formatCurrency } from "@/lib/money";
import { radius, spacing, useColors } from "@/theme";

/**
 * HomeHeader — the home tab's header row: the search entry (faux search
 * bar navigating to the full-screen search) and, beside it, the
 * authenticated user's wallet-balance shortcut chip (guests get the
 * sign-in entry instead — the auth rules' prompt pattern).
 */
export function HomeHeader() {
  const colors = useColors();
  const router = useRouter();
  const { status } = useAuth();
  const authenticated = status === "authenticated";

  // Decorative secondary data (web R111-F1 rule): wallet failures degrade
  // to the plain label — the catalog below carries the honest error surface.
  const { data: wallet } = useGetWallet({
    query: { enabled: authenticated, staleTime: 60_000 },
  });

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
      }}
    >
      <Pressable
        accessibilityRole="search"
        accessibilityLabel="البحث في المنتجات"
        onPress={() => router.push("/search")}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: spacing.touch,
          paddingHorizontal: spacing.lg,
          backgroundColor: colors.secondary,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          borderCurve: "continuous",
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <Icon sf="magnifyingglass" md="search" size={16} color={colors.onSurface} />
        <ThemedText variant="subhead" style={{ color: colors.onSurface }}>
          ابحث عن منتج…
        </ThemedText>
      </Pressable>

      {authenticated ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={wallet ? `المحفظة — ${formatCurrency(wallet.balance)}` : "المحفظة"}
          onPress={() => router.push("/(tabs)/(wallet)")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            minHeight: spacing.touch,
            paddingHorizontal: spacing.md,
            backgroundColor: colors.secondary,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            borderCurve: "continuous",
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Icon
            sf="creditcard.fill"
            md="account_balance_wallet"
            size={16}
            color={colors.primaryText}
          />
          <ThemedText
            variant="footnote"
            style={{
              color: colors.foreground,
              fontFamily: "ReadexPro-SemiBold",
              fontVariant: ["tabular-nums"],
            }}
          >
            {wallet ? formatCurrency(wallet.balance) : "المحفظة"}
          </ThemedText>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تسجيل الدخول"
          onPress={() => router.push("/login")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            minHeight: spacing.touch,
            paddingHorizontal: spacing.md,
            backgroundColor: colors.secondary,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            borderCurve: "continuous",
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Icon sf="person.crop.circle" md="person" size={16} color={colors.primaryText} />
          <ThemedText
            variant="footnote"
            style={{ color: colors.foreground, fontFamily: "ReadexPro-SemiBold" }}
          >
            تسجيل الدخول
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}
