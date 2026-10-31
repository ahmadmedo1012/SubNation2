import { type ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { useColors, radius, shadows, spacing } from "@/theme";
import { ThemedText } from "./themed-text";

/**
 * Card — children composition (never twelve content props). Grouped with
 * background + hairline border like the web's surface cards, subtle
 * shadow only when raised.
 */
export function Card({
  children,
  style,
  raised = false,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const base: ViewStyle = {
    backgroundColor: colors.surfaceCard,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...(raised ? { boxShadow: shadows.raised } : {}),
  };

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [base, { opacity: pressed ? 0.85 : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

/** Section header — title + optional trailing action label. */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
      }}
    >
      <ThemedText variant="headline">{title}</ThemedText>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
          <ThemedText variant="subhead" style={{ color: colors.primary }}>
            {actionLabel}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Hairline divider. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const colors = useColors();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: colors.border,
        marginStart: inset,
        marginEnd: 0,
      }}
      accessibilityRole="separator"
    />
  );
}
