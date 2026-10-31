import { memo, useRef } from "react";
import { Alert, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";

import { Button } from "./button";
import { Icon } from "./icon";
import { PriceDisplay } from "./price-display";
import { ThemedText } from "./themed-text";
import { categoryLabel, categoryMeta } from "@/constants";
import { API_URL } from "@/lib/api";
import { LOW_STOCK_THRESHOLD, useCart } from "@/lib/cart";
import { arabicCount, formatCurrency } from "@/lib/money";
import { productArtUrl } from "@/lib/product-art";
import { radius, spacing, useColors } from "@/theme";

/**
 * ProductCard — the catalog tile (native port of the web's
 * frontend/src/components/ProductCard.tsx). The ONE card surface on the
 * discovery screens: art well + name + category badge + price + honest
 * stock state, plus the mobile quick-add CTA the web card carries.
 *
 * `compact` renders the small rail tile (PDP recommendations): 4:3 art,
 * one-line name, price, no CTA — navigation only.
 */

/** Structural product shape both ProductListItem and ProductRecommendation satisfy. */
export interface ProductCardProduct {
  id: number;
  slug?: string | null;
  name: string;
  image_url?: string | null;
  price: number;
  price_from?: boolean;
  category?: string | null;
  is_available: boolean;
  stock_count?: number | null;
  sale_price?: number | null;
  discount_percent?: number | null;
  variant_count?: number | null;
}

const VARIANT_COUNT_FORMS = {
  zero: "باقات",
  one: "باقة",
  two: "باقتان",
  few: "باقات",
  many: "باقة",
  other: "باقة",
};

function ProductCardInner({
  product,
  compact = false,
  style,
}: {
  product: ProductCardProduct;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const router = useRouter();
  const { addItem } = useCart();
  // 96-F4: 500ms re-entry lock — a double-tap on a laggy phone must not
  // add quantity 2 in one gesture.
  const lastAddTapRef = useRef<number | null>(null);

  const cat = categoryMeta(product.category);
  const accent = cat ? colors[cat.colorKey] : colors.primary;
  const unavailable = !product.is_available;
  const art = productArtUrl(product.image_url, API_URL);
  const displayPrice = product.sale_price ?? product.price;
  const variantCount = product.variant_count ?? 0;
  const isLowStock =
    product.is_available &&
    product.stock_count != null &&
    product.stock_count > 0 &&
    product.stock_count <= LOW_STOCK_THRESHOLD;

  const href = `/product/${product.slug ?? product.id}`;

  const handleAddToCart = () => {
    if (unavailable) return;
    const now = Date.now();
    if (lastAddTapRef.current !== null && now - lastAddTapRef.current < 500) return;
    lastAddTapRef.current = now;
    // List projection carries no variant tree — quick-add rides the
    // product-level price (the «تبدأ من» number the card displays) with a
    // null variant, the same line the web's grid cards build.
    const applied = addItem({
      productId: product.id,
      variantId: null,
      variantLabel: null,
      slug: product.slug ?? null,
      name: product.name ?? "",
      imageUrl: product.image_url ?? null,
      priceLYD: product.price,
      salePriceLYD: product.sale_price ?? null,
      discountPercent: product.discount_percent ?? null,
      stockCount: product.stock_count ?? null,
    });
    if (!applied) {
      Alert.alert(
        "بلغت الحد الأقصى المتاح",
        product.stock_count != null
          ? `${product.name} — متبقٍ ${product.stock_count} فقط`
          : (product.name ?? undefined),
      );
    }
  };

  // One descriptive label so screen readers announce the full card state.
  const ariaLabel = [
    product.name,
    categoryLabel(product.category),
    `${product.price_from ? "تبدأ من " : ""}${formatCurrency(displayPrice)}`,
    variantCount > 1 ? arabicCount(variantCount, VARIANT_COUNT_FORMS) : null,
    unavailable ? "نفد المخزون" : null,
    isLowStock ? `متبقٍ ${product.stock_count} فقط` : null,
  ]
    .filter(Boolean)
    .join("، ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ariaLabel}
      accessibilityState={{ disabled: unavailable }}
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        {
          backgroundColor: colors.surfaceCard,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          borderCurve: "continuous",
          overflow: "hidden",
          opacity: unavailable ? 0.55 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {/* Art well — the shelf surface under the transparent product art. */}
      <View
        style={{
          aspectRatio: compact ? 4 / 3 : 1,
          backgroundColor: colors.secondary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Category accent line (the web tile's identity stripe). */}
        <View
          style={{
            position: "absolute",
            top: 0,
            start: 0,
            end: 0,
            height: 2,
            backgroundColor: accent,
            opacity: 0.65,
          }}
        />
        {art ? (
          <Image
            source={{ uri: art }}
            contentFit="cover"
            transition={200}
            accessibilityLabel={product.name}
            style={{
              position: "absolute",
              top: spacing.md,
              bottom: spacing.md,
              start: spacing.md,
              end: spacing.md,
            }}
          />
        ) : (
          <Icon
            sf={cat?.sf ?? "shippingbox"}
            md={cat?.md ?? "inventory-2"}
            size={40}
            color={accent}
          />
        )}
        {unavailable ? (
          <View
            style={{
              position: "absolute",
              top: spacing.sm,
              start: spacing.sm,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              backgroundColor: "rgba(0,0,0,0.75)",
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
              borderRadius: radius.full,
            }}
          >
            <Icon sf="lock.fill" md="lock" size={10} color={colors.onTint} />
            <ThemedText
              variant="micro"
              style={{ color: colors.onTint, fontFamily: "ReadexPro-SemiBold" }}
            >
              نفد
            </ThemedText>
          </View>
        ) : null}
      </View>

      {/* Body */}
      <View style={{ padding: compact ? spacing.sm : spacing.md, gap: spacing.xs }}>
        <ThemedText
          variant="subhead"
          numberOfLines={compact ? 1 : 2}
          style={{ fontFamily: "ReadexPro-SemiBold" }}
        >
          {product.name}
        </ThemedText>

        {!compact ? (
          <View
            style={{
              alignSelf: "flex-start",
              backgroundColor: `${accent}1A`,
              borderRadius: radius.full,
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
            }}
          >
            <ThemedText variant="micro" style={{ color: accent, fontFamily: "ReadexPro-SemiBold" }}>
              {categoryLabel(product.category)}
            </ThemedText>
          </View>
        ) : null}

        <View
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" }}
        >
          {product.price_from ? (
            <ThemedText variant="micro" style={{ color: colors.onSurface }}>
              تبدأ من
            </ThemedText>
          ) : null}
          <PriceDisplay
            priceLYD={product.price}
            salePriceLYD={product.sale_price ?? null}
            discountPercent={product.discount_percent ?? null}
            ink="browsing"
            size="sm"
          />
        </View>

        {!compact ? (
          <View style={{ minHeight: 18, justifyContent: "center" }}>
            {unavailable ? (
              <ThemedText
                variant="micro"
                style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
              >
                نفد
              </ThemedText>
            ) : variantCount > 1 ? (
              <ThemedText
                variant="micro"
                style={{
                  color: accent,
                  fontFamily: "ReadexPro-SemiBold",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {arabicCount(variantCount, VARIANT_COUNT_FORMS)}
              </ThemedText>
            ) : isLowStock ? (
              <ThemedText
                variant="micro"
                style={{
                  color: colors.lowStock,
                  fontFamily: "ReadexPro-SemiBold",
                  fontVariant: ["tabular-nums"],
                }}
              >
                متبقٍ {product.stock_count} فقط
              </ThemedText>
            ) : product.stock_count != null ? (
              <ThemedText
                variant="micro"
                style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
              >
                كمية {product.stock_count > 99 ? "99+" : product.stock_count}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Quick-add CTA (the web mobile card's always-on buy affordance). */}
      {!compact ? (
        product.is_available ? (
          <Button
            title="أضف للسلة"
            size="sm"
            onPress={handleAddToCart}
            accessibilityHint={`${product.name} — ${formatCurrency(displayPrice)}`}
            style={{ margin: spacing.md, marginTop: 0 }}
          />
        ) : (
          <View
            style={{
              margin: spacing.md,
              marginTop: 0,
              minHeight: 36,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor: colors.secondary,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: spacing.xs,
            }}
          >
            <Icon sf="lock.fill" md="lock" size={14} color={colors.onSurface} />
            <ThemedText
              variant="footnote"
              style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
            >
              نفد المخزون
            </ThemedText>
          </View>
        )
      ) : null}
    </Pressable>
  );
}

export const ProductCard = memo(
  ProductCardInner,
  (prev, next) =>
    prev.product.id === next.product.id &&
    prev.product.slug === next.product.slug &&
    prev.product.name === next.product.name &&
    prev.product.image_url === next.product.image_url &&
    prev.product.price === next.product.price &&
    prev.product.sale_price === next.product.sale_price &&
    prev.product.category === next.product.category &&
    prev.product.discount_percent === next.product.discount_percent &&
    prev.product.is_available === next.product.is_available &&
    prev.product.stock_count === next.product.stock_count &&
    prev.product.variant_count === next.product.variant_count &&
    prev.compact === next.compact,
);
