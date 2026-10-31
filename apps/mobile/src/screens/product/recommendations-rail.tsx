import { FlatList, View } from "react-native";

import { ProductCard } from "@/components/product-card";
import { Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useGetProductRecommendations } from "@workspace/api-client-native";
import { spacing, type } from "@/theme";

/**
 * RecommendationsRail — the PDP's same-category cross-sell (web
 * RecommendationsSection twin): a horizontal FlatList of compact
 * ProductCards. Decorative secondary data (web R115-I1 policy): hidden
 * DELIBERATELY on a definitive failure (after one retry) or an empty
 * payload — the product itself carries the page's honest error surfaces.
 */

/** Rail tile width (token-derived). */
const TILE_WIDTH = spacing.touch * 4;

export function RecommendationsRail({ productId }: { productId: number }) {
  const { data, isLoading, isError } = useGetProductRecommendations(productId, {
    query: { staleTime: 5 * 60_000, retry: 1 },
  });
  const recommendations = data ?? [];

  if (isError || (!isLoading && recommendations.length === 0)) return null;

  return (
    <View style={{ gap: spacing.sm }}>
      <ThemedText variant="headline">قد يعجبك أيضاً</ThemedText>
      {isLoading ? (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton
              key={i}
              style={{
                width: TILE_WIDTH,
                height: TILE_WIDTH + type.subhead.lineHeight + spacing.xl + spacing.md,
                borderRadius: spacing.sm,
              }}
            />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={recommendations}
          keyExtractor={(item) => String(item.id)}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, paddingEnd: spacing.md }}
          style={{ flexGrow: 0 }}
          accessibilityLabel="منتجات مقترحة"
          renderItem={({ item }) => (
            <ProductCard product={item} compact style={{ width: TILE_WIDTH }} />
          )}
        />
      )}
    </View>
  );
}
