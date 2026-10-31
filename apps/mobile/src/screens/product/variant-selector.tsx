import { Pressable, View } from "react-native";
import type { ProductVariant } from "@workspace/api-client-native";

import { PriceDisplay } from "@/components/price-display";
import { ThemedText } from "@/components/themed-text";
import { formatCurrency } from "@/lib/money";
import { radius, spacing, useColors } from "@/theme";

/**
 * VariantSelector — the PDP's plan/duration picker (web VariantSelector
 * twin, native list form): one row per sellable option, sorted by price,
 * with the honest per-option stock state (out-of-stock options disabled
 * and labeled «نفد المخزون»). Selection state stays with the screen —
 * the price panel, stepper and CTA all key off it.
 */
export function VariantSelector({
  variants,
  selectedId,
  onSelect,
}: {
  variants: ProductVariant[];
  selectedId: number | null;
  onSelect: (variantId: number) => void;
}) {
  const colors = useColors();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="اختر الباقة"
      style={{ gap: spacing.sm }}
    >
      {variants.map((variant) => {
        const selected = variant.id === selectedId;
        const out = !variant.is_available;
        const effective = variant.sale_price ?? variant.price;
        return (
          <Pressable
            key={variant.id}
            accessibilityRole="radio"
            accessibilityLabel={`${variant.label} — ${formatCurrency(effective)}${out ? " — نفد المخزون" : ""}`}
            accessibilityState={{ selected, disabled: out }}
            disabled={out}
            onPress={() => onSelect(variant.id)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              minHeight: spacing.touch,
              borderWidth: 1,
              borderColor: selected ? `${colors.primary}4D` : colors.border,
              backgroundColor: selected ? `${colors.primary}1A` : colors.secondary,
              borderRadius: radius.md,
              borderCurve: "continuous",
              opacity: out ? 0.5 : pressed ? 0.75 : 1,
            })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
                {variant.label}
              </ThemedText>
              {out ? (
                <ThemedText variant="micro" style={{ color: colors.onSurface }}>
                  نفد المخزون
                </ThemedText>
              ) : null}
            </View>
            <PriceDisplay
              priceLYD={variant.price}
              salePriceLYD={variant.sale_price ?? null}
              discountPercent={variant.discount_percent ?? null}
              ink="browsing"
              size="sm"
            />
          </Pressable>
        );
      })}
    </View>
  );
}
