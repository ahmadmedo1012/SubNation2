import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, type PressableProps } from "react-native";

import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useColors, rounded, spacing } from "@/theme";

/**
 * The one-click provider button — the neutral resting register every
 * auth provider shares on the web (WhatsAppPhoneSignIn's pristine
 * button / ProviderButton / TelegramLoginButton are byte-identical
 * resting styles): card surface, hairline border, brand-tinted glyph,
 * «المتابعة عبر <Provider>» label. Busy swaps the glyph for a spinner
 * and the label for the per-provider busy copy.
 */
export function ProviderButton({
  label,
  busyLabel,
  glyph,
  glyphNode,
  tint,
  busy = false,
  disabled = false,
  onPress,
  accessibilityHint,
}: {
  /** Resting label, e.g. «المتابعة عبر WhatsApp». */
  label: string;
  /** Busy label, e.g. «جارٍ التحويل…». Defaults to the resting label. */
  busyLabel?: string;
  /** SF Symbol + MaterialIcons names for the provider glyph. */
  glyph?: { sf: string; md: string };
  /** Custom glyph node — the Google "G" brand mark (a typographic mark:
   *  neither icon family carries a Google glyph, so the brand letter
   *  renders from the type ramp in the provider's brand tint). */
  glyphNode?: ReactNode;
  /** Brand tint for the glyph (a provider color token from the theme). */
  tint: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: PressableProps["onPress"];
  accessibilityHint?: string;
}) {
  const colors = useColors();
  const inert = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor: colors.border,
          ...rounded("md"),
          minHeight: spacing.touch,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
          opacity: inert ? 0.6 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tint} />
      ) : glyphNode ? (
        glyphNode
      ) : (
        <Icon sf={glyph?.sf ?? "circle"} md={glyph?.md ?? "circle"} size={20} color={tint} />
      )}
      <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
        {busy ? (busyLabel ?? label) : label}
      </ThemedText>
    </Pressable>
  );
}
