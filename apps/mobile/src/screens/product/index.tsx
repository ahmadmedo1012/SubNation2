import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { useNavigation, useRouter } from "expo-router";
import { useGetProductBySlug } from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/states";
import { Icon } from "@/components/icon";
import { PriceDisplay } from "@/components/price-display";
import { QuantityStepper } from "@/components/quantity-stepper";
import { ThemedText } from "@/components/themed-text";
import { categoryMeta } from "@/constants";
import { API_URL } from "@/lib/api";
import { LOW_STOCK_THRESHOLD, MAX_LINE_QUANTITY, useCart } from "@/lib/cart";
import { getErrorMessage } from "@/lib/errors";
import { productArtUrl } from "@/lib/product-art";
import { radius, spacing, type, useColors } from "@/theme";

import { FaqAccordion } from "./faq-accordion";
import { RecommendationsRail } from "./recommendations-rail";
import { VariantSelector } from "./variant-selector";

/**
 * ProductScreen — the PDP (web product.tsx twin, native buy-panel form):
 * hero art, title + category chip, description, the variant selector, the
 * price/stock/quantity buy panel, add-to-cart (cart API → cart tab on
 * success, honest cap alert on refusal), the recommendations rail and the
 * FAQ accordion. All four states; a 404 renders the designed not-found.
 */
export function ProductScreen({ slug }: { slug: string }) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation<{ setOptions: (options: { title?: string }) => void }>();
  const { addItem } = useCart();

  const { data: product, isLoading, isError, error, refetch } = useGetProductBySlug(slug);

  const notFound = isError && error?.status === 404;

  // Stack header carries the product name (titles via Stack options only).
  useEffect(() => {
    if (product?.name) navigation.setOptions({ title: product.name });
  }, [product?.name, navigation]);

  // Variant selection — sorted by price, defaults to the cheapest
  // AVAILABLE option (the web contract); falls back to the first option
  // only when every variant is drained (the product renders sold-out).
  const sortedVariants = useMemo(
    () => (product?.variants ? [...product.variants].sort((a, b) => a.price - b.price) : []),
    [product?.variants],
  );
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);

  // Reset the explicit selection + quantity whenever the product changes
  // (PDP→PDP navigation reuses this component without unmounting).
  useEffect(() => {
    setSelectedVariantId(null);
    setQuantity(1);
  }, [product?.id]);

  const selectedVariant = useMemo(() => {
    if (sortedVariants.length === 0) return null;
    const chosen =
      (selectedVariantId != null
        ? sortedVariants.find((v) => v.id === selectedVariantId)
        : undefined) ??
      sortedVariants.find((v) => v.is_available) ??
      sortedVariants[0]!;
    return chosen;
  }, [sortedVariants, selectedVariantId]);

  // A fallback selection change (cheapest option removed/added on a
  // refetch) re-bases the quantity ceiling honestly.
  useEffect(() => {
    setQuantity(1);
  }, [selectedVariant?.id]);

  // The four states — all hooks are settled, branching starts here.
  if (isLoading && !product) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.lg }}
      >
        <ProductSkeleton />
      </ScrollView>
    );
  }

  if (!product) {
    // A definitive 404 is the designed not-found; anything else (outage,
    // connection failure) is the retryable first-load error.
    if (notFound) {
      return (
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <EmptyState
            title="المنتج غير موجود"
            message="يبدو أن هذا المنتج لم يعد متوفراً أو أن الرابط غير صحيح."
            actionTitle="العودة للكتالوج"
            onAction={() => router.push("/(tabs)/(home)")}
            symbol="shippingbox"
          />
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ErrorState
          message={getErrorMessage(error)}
          onRetry={() => {
            void refetch();
          }}
        />
      </View>
    );
  }

  // Buy panel state (product narrowed non-null below the state branches).
  const multiVariant = sortedVariants.length > 1;
  const canBuy = product.is_available && (selectedVariant === null || selectedVariant.is_available);
  const maxQuantity =
    product.stock_count > 0 ? Math.min(product.stock_count, MAX_LINE_QUANTITY) : MAX_LINE_QUANTITY;

  // Stock verdict — honest at every branch: out / low (single-variant
  // only; a product-level count can over-claim what a specific variant
  // delivers) / in stock.
  const verdict = !product.is_available
    ? { label: "نفد المخزون", color: colors.onSurface }
    : !multiVariant && product.stock_count > 0 && product.stock_count <= LOW_STOCK_THRESHOLD
      ? { label: "كمية محدودة", color: colors.lowStock }
      : { label: "متوفر", color: colors.success };

  const handleAddToCart = () => {
    if (!canBuy) return;
    const applied = addItem({
      productId: product.id,
      variantId: selectedVariant?.id ?? null,
      variantLabel: selectedVariant?.label ?? null,
      slug: product.slug ?? null,
      name: product.name,
      imageUrl: product.image_url ?? null,
      priceLYD: selectedVariant ? selectedVariant.price : product.price,
      salePriceLYD: selectedVariant
        ? (selectedVariant.sale_price ?? null)
        : (product.sale_price ?? null),
      discountPercent: selectedVariant
        ? (selectedVariant.discount_percent ?? null)
        : (product.discount_percent ?? null),
      quantity,
      stockCount: product.stock_count,
    });
    if (!applied) {
      // Honest refusal (R130): the stock-aware raise cap rejected the bump.
      Alert.alert(
        "الحد الأقصى المتوفر",
        product.stock_count != null
          ? `${product.name} — متبقٍ ${product.stock_count} فقط`
          : product.name,
      );
      return;
    }
    router.push("/(tabs)/(cart)");
  };

  const meta = categoryMeta(product.category);
  const accent = meta ? colors[meta.colorKey] : colors.primary;
  const art = productArtUrl(product.image_url, API_URL);
  const faqs = product.faq ?? [];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
    >
      {/* Stale-content rule: a refresh failure keeps the content. */}
      {isError ? (
        <InlineError
          message={getErrorMessage(error)}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : null}

      {/* Hero art — the shelf well under the transparent product art. */}
      <View
        style={{
          aspectRatio: 4 / 3,
          backgroundColor: colors.secondary,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
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
            sf={meta?.sf ?? "shippingbox"}
            md={meta?.md ?? "inventory-2"}
            size={64}
            color={accent}
          />
        )}
      </View>

      {/* Title + category chip */}
      <View style={{ gap: spacing.sm }}>
        <ThemedText variant="title">{product.name}</ThemedText>
        {meta ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`فئة ${meta.label}`}
            onPress={() => router.push(`/category/${meta.slug}`)}
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              backgroundColor: `${accent}1A`,
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
              borderRadius: radius.full,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <Icon sf={meta.sf} md={meta.md} size={12} color={accent} />
            <ThemedText variant="micro" style={{ color: accent, fontFamily: "ReadexPro-SemiBold" }}>
              {meta.label}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {product.description ? (
        <ThemedText variant="body" selectable>
          {product.description}
        </ThemedText>
      ) : null}

      {/* Variant selector */}
      {sortedVariants.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <ThemedText variant="headline">اختر الباقة</ThemedText>
          <VariantSelector
            variants={sortedVariants}
            selectedId={selectedVariant?.id ?? null}
            onSelect={setSelectedVariantId}
          />
        </View>
      ) : null}

      {/* Buy panel — grouped with background + hairline (not a card). */}
      <View
        style={{
          backgroundColor: colors.secondary,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          borderCurve: "continuous",
          padding: spacing.lg,
          gap: spacing.md,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.md,
          }}
        >
          <PriceDisplay
            priceLYD={selectedVariant ? selectedVariant.price : product.price}
            salePriceLYD={
              selectedVariant ? (selectedVariant.sale_price ?? null) : (product.sale_price ?? null)
            }
            discountPercent={
              selectedVariant
                ? (selectedVariant.discount_percent ?? null)
                : (product.discount_percent ?? null)
            }
            ink="buy"
            size="lg"
          />
          <View
            accessibilityLabel={verdict.label}
            style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
          >
            <View
              style={{
                width: spacing.sm,
                height: spacing.sm,
                borderRadius: radius.full,
                backgroundColor: verdict.color,
              }}
            />
            <ThemedText
              variant="footnote"
              style={{ color: verdict.color, fontFamily: "ReadexPro-SemiBold" }}
            >
              {verdict.label}
            </ThemedText>
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.md,
          }}
        >
          <ThemedText variant="subhead">الكمية</ThemedText>
          <QuantityStepper
            quantity={quantity}
            onChange={setQuantity}
            max={maxQuantity}
            disabled={!canBuy}
          />
        </View>

        <Button
          title={canBuy ? "أضف للسلة" : "نفد المخزون"}
          size="lg"
          disabled={!canBuy}
          onPress={handleAddToCart}
          accessibilityHint={canBuy ? `يضيف ${quantity} إلى السلة` : "هذا المنتج غير متوفر حالياً"}
        />
      </View>

      {/* Cross-sell rail */}
      <RecommendationsRail productId={product.id} />

      {/* FAQ */}
      {faqs.length > 0 ? <FaqAccordion faqs={faqs} /> : null}
    </ScrollView>
  );
}

/** PDP-shaped loading skeleton (the known layout, token-sized). */
function ProductSkeleton() {
  return (
    <View style={{ gap: spacing.md }}>
      <Skeleton style={{ aspectRatio: 4 / 3, borderRadius: radius.lg }} />
      <Skeleton style={{ height: type.title.lineHeight, width: "70%" }} />
      <Skeleton
        style={{ height: type.caption.lineHeight, width: "35%", borderRadius: radius.full }}
      />
      <Skeleton style={{ height: type.body.lineHeight, width: "100%" }} />
      <Skeleton style={{ height: type.body.lineHeight, width: "80%" }} />
      <Skeleton
        style={{
          height: (spacing.touch + spacing.md) * 3 + spacing.md,
          borderRadius: radius.md,
          marginTop: spacing.sm,
        }}
      />
    </View>
  );
}
