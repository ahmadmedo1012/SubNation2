import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { useColors, radius, spacing } from "@/theme";
import { Icon } from "./icon";
import { ThemedText } from "./themed-text";

/**
 * QuantityStepper — 44px touch targets, honest ceilings (MAX_LINE_QUANTITY
 * and advisory stock), tabular-nums counter, LTR-insulated control row.
 */
export function QuantityStepper({
  quantity,
  onChange,
  max = 99,
  disabled = false,
  style,
}: {
  quantity: number;
  onChange: (next: number) => void;
  max?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const atMin = quantity <= 1;
  const atMax = quantity >= max;

  const stepButton = (direction: -1 | 1, label: string, atLimit: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || atLimit}
      onPress={() => onChange(quantity + direction)}
      hitSlop={4}
      style={{
        width: spacing.touch,
        height: spacing.touch,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.sm,
        backgroundColor: colors.secondary,
        opacity: disabled || atLimit ? 0.35 : 1,
      }}
    >
      <Icon
        sf={direction === 1 ? "plus" : "minus"}
        md={direction === 1 ? "add" : "remove"}
        size={20}
        color={colors.foreground}
      />
    </Pressable>
  );

  return (
    <View
      style={[
        { flexDirection: "row", alignItems: "center", gap: spacing.sm, direction: "ltr" },
        style,
      ]}
      accessibilityLabel={`الكمية ${quantity}`}
    >
      {stepButton(-1, "تقليل الكمية", atMin)}
      <ThemedText
        variant="headline"
        style={{ minWidth: 32, textAlign: "center", fontVariant: ["tabular-nums"] }}
      >
        {quantity}
      </ThemedText>
      {stepButton(1, "زيادة الكمية", atMax)}
    </View>
  );
}
