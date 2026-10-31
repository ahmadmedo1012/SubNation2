import { View } from "react-native";

import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useColors, rounded, shadows, spacing } from "@/theme";

/**
 * The auth brand header — the native read of the web's Logo
 * (frontend/src/components/layout/Logo.tsx): a primary tile with the
 * white shield + play mark over the «SubNation» wordmark («Sub» in the
 * foreground ink, «Nation» in the text-safe brand twin).
 *
 * The shield+play mark is composed from the icon kit (shield glyph +
 * centered play glyph in the brand color reads as the play cut-out of
 * the shield) — no hand-drawn SVG paths on native.
 */
export function BrandMark() {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", gap: spacing.md }}>
      <View
        accessible
        accessibilityLabel="SubNation"
        style={{
          width: 56,
          height: 56,
          backgroundColor: colors.primary,
          ...rounded("lg"),
          alignItems: "center",
          justifyContent: "center",
          boxShadow: shadows.raised,
        }}
      >
        <Icon sf="shield.fill" md="shield" size={30} color={colors.onTint} />
        <View
          style={{
            position: "absolute",
            alignItems: "center",
            justifyContent: "center",
          }}
          pointerEvents="none"
        >
          <Icon sf="play.fill" md="play-arrow" size={11} color={colors.primary} />
        </View>
      </View>
      <View
        accessible
        accessibilityLabel="SubNation"
        style={{ flexDirection: "row", direction: "ltr" }}
      >
        <ThemedText variant="title">Sub</ThemedText>
        <ThemedText variant="title" style={{ color: colors.primaryText }}>
          Nation
        </ThemedText>
      </View>
    </View>
  );
}
