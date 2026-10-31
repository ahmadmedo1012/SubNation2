import { View, type StyleProp, type ViewStyle } from "react-native";

import { formatCurrency } from "@/lib/money";
import { useColors, spacing } from "@/theme";
import { ThemedText } from "./themed-text";

/**
 * PriceDisplay — the M17 LYD idiom through the single formatCurrency.
 * Money ink tiers (web DESIGN.md): browsing = foreground, buy moment =
 * primary, ledger = primaryText. Discount badge renders only when a
 * flash-sale/sale price is active.
 */
export function PriceDisplay({
  priceLYD,
  salePriceLYD,
  discountPercent,
  ink = "browsing",
  size = "md",
  style,
}: {
  priceLYD: number;
  salePriceLYD?: number | null;
  discountPercent?: number | null;
  ink?: "browsing" | "buy" | "ledger";
  size?: "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const effective = salePriceLYD ?? priceLYD;
  const hasSale = salePriceLYD !== null && salePriceLYD !== undefined && salePriceLYD < priceLYD;

  const inkColor =
    ink === "buy" ? colors.primary : ink === "ledger" ? colors.primaryText : colors.foreground;
  const fontSize = size === "sm" ? 15 : size === "lg" ? 22 : 17;

  return (
    <View
      style={[
        { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
        style,
      ]}
    >
      <ThemedText
        variant="headline"
        style={{
          color: inkColor,
          fontSize,
          lineHeight: fontSize * 1.3,
          fontVariant: ["tabular-nums"],
        }}
      >
        {formatCurrency(effective)}
      </ThemedText>
      {hasSale ? (
        <ThemedText
          variant="footnote"
          style={{
            color: colors.onSurface,
            textDecorationLine: "line-through",
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatCurrency(priceLYD)}
        </ThemedText>
      ) : null}
      {hasSale && discountPercent && discountPercent > 0 ? (
        <View
          style={{
            backgroundColor: colors.primary,
            borderRadius: 999,
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
          }}
          accessibilityLabel={`خصم ${discountPercent}%`}
        >
          <ThemedText
            variant="micro"
            style={{ color: colors.onTint, fontFamily: "ReadexPro-SemiBold" }}
          >
            {`-${discountPercent}%`}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}
