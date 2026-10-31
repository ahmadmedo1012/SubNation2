import { View } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useColors, radius, spacing } from "@/theme";

/**
 * SignInPrompt — the guest state for every auth-gated account-surface
 * screen (expo-data-fetching skill: a designed guard, never a crash and
 * never a zeroed frame). One CTA to the root login modal; the copy is
 * per-surface via props.
 */
export function SignInPrompt({
  message,
  ctaLabel = "تسجيل الدخول",
}: {
  /** Surface-specific Arabic line explaining what signing in unlocks. */
  message: string;
  ctaLabel?: string;
}) {
  const colors = useColors();
  const router = useRouter();

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
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.full,
          backgroundColor: `${colors.primary}1A`,
          borderWidth: 1,
          borderColor: `${colors.primary}38`,
          alignItems: "center",
          justifyContent: "center",
        }}
        accessibilityRole="image"
        accessibilityLabel="تسجيل الدخول"
      >
        <Icon
          sf="person.crop.circle.badge.clock"
          md="account_circle"
          size={30}
          color={colors.primary}
        />
      </View>
      <ThemedText variant="headline" style={{ textAlign: "center" }}>
        سجّل دخولك للمتابعة
      </ThemedText>
      <ThemedText
        variant="subhead"
        style={{ textAlign: "center", color: colors.onSurface, maxWidth: 320 }}
      >
        {message}
      </ThemedText>
      <Button
        title={ctaLabel}
        size="lg"
        onPress={() => router.push("/login")}
        accessibilityHint="يفتح شاشة تسجيل الدخول"
      />
    </View>
  );
}
