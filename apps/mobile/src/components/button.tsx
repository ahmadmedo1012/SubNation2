import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useColors, radius, spacing } from "@/theme";
import { ThemedText } from "./themed-text";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

/**
 * Button — the design-system contract: variants (visual intent), sizes
 * (token-mapped), pressed/disabled/loading states with a11y roles, and a
 * style prop that merges LAST (callers adjust layout, never identity).
 */
export function Button({
  variant = "primary",
  size = "md",
  title,
  loading = false,
  disabled = false,
  style,
  textStyle,
  onPress,
  accessibilityHint,
}: {
  variant?: Variant;
  size?: Size;
  title: string;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const colors = useColors();

  const variants: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.primary, fg: colors.onTint },
    secondary: { bg: colors.secondary, fg: colors.foreground, border: colors.border },
    ghost: { bg: "transparent", fg: colors.primary, border: colors.border },
    destructive: { bg: colors.destructive, fg: colors.onTint },
  };

  const sizes: Record<
    Size,
    { paddingVertical: number; paddingHorizontal: number; minHeight: number }
  > = {
    sm: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, minHeight: 36 },
    md: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, minHeight: spacing.touch },
    lg: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl, minHeight: 52 },
  };

  const v = variants[variant];
  const s = sizes[size];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: v.bg,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: spacing.xs,
          opacity: isDisabled ? 0.4 : pressed ? 0.7 : 1,
          ...s,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <ThemedText
          variant={size === "lg" ? "headline" : "subhead"}
          style={[{ color: v.fg, fontFamily: "ReadexPro-SemiBold" }, textStyle]}
        >
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}
