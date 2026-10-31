import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { useRouter } from "expo-router";
import { keepPreviousData } from "@tanstack/react-query";
import {
  getListProductsQueryKey,
  useListProducts,
  type ListProductsParams,
  type ListProductsSort,
} from "@workspace/api-client-native";

import { EmptyState, ErrorState, InlineError, ProductGridSkeleton } from "@/components/states";
import { ProductCard } from "@/components/product-card";
import { ThemedText } from "@/components/themed-text";
import { SORTS, type SortValue } from "@/constants";
import { getErrorMessage } from "@/lib/errors";
import { arabicCount } from "@/lib/money";
import { spacing, useColors } from "@/theme";

import { CatalogFilterChips, CatalogSearchField } from "./catalog-controls";

/**
 * CatalogScreen — the shared catalog engine behind the home tab and the
 * category landing screens (the native twin of the web home's filter
 * quartet + ProductsGrid): the inline search (300ms debounce), sort chips,
 * the متوفر فقط toggle, useListProducts with the ?fields=list projection,
 * the available-first re-order, the four states and pull-to-refresh with
 * the stale-content rule.
 *
 * The screen IS a FlatList (no outer ScrollView) — 2-column grid with the
 * screen-specific hero rendered as the list header.
 */

const PRODUCT_COUNT_FORMS = {
  zero: "منتجات",
  one: "منتج",
  two: "منتجان",
  few: "منتجات",
  many: "منتجاً",
  other: "منتج",
};

/** Committed filters the section header + empty state branch on. */
export interface CatalogFilters {
  search: string;
  sort: SortValue;
  availableOnly: boolean;
}

export function CatalogScreen({
  category = null,
  headerTop,
  showSearchField = false,
  showAvailableToggle = false,
  titleFor,
}: {
  /** Fixed category param (null = the full catalog). */
  category?: string | null;
  /** Screen hero above the controls — receives the engine's clearFilters. */
  headerTop?: (helpers: { clearFilters: () => void }) => ReactNode;
  showSearchField?: boolean;
  showAvailableToggle?: boolean;
  titleFor: (filters: CatalogFilters) => string;
}) {
  const colors = useColors();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortValue>("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Live search commits behind a 300ms debounce (the web's 320ms lifecycle,
  // trimmed so a lone space never arms a phantom filter).
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setSearch("");
    setSort("");
    setAvailableOnly(false);
  }, []);

  const params = useMemo<ListProductsParams>(() => {
    const next: ListProductsParams = { fields: "list" };
    if (category) next.category = category;
    if (search) next.search = search;
    if (sort !== "") next.sort = sort as ListProductsSort;
    if (availableOnly) next.available_only = true;
    return next;
  }, [category, search, sort, availableOnly]);

  const { data, isLoading, isError, error, refetch } = useListProducts(params, {
    query: {
      queryKey: getListProductsQueryKey(params),
      // keepPreviousData: filter changes keep the previous grid as the
      // placeholder — no skeleton flash between committed views.
      placeholderData: keepPreviousData,
      staleTime: 3 * 60 * 1000,
    },
  });

  const products = useMemo(() => data ?? [], [data]);

  // Available products lead the DEFAULT view (web R120-B1): presentation-only
  // re-order, backend order preserved within each group; explicit sort or an
  // active search wins (relevance tiers must not be overridden).
  const displayProducts = useMemo(() => {
    if (sort !== "" || search) return products;
    return [...products].sort((a, b) => Number(b.is_available) - Number(a.is_available));
  }, [products, sort, search]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const clearableFilterCount = [search, sort, availableOnly ? "1" : ""].filter(Boolean).length;
  const categorySlug = category ?? null;
  const isCategoryView = categorySlug != null;

  const title = titleFor({ search, sort, availableOnly });

  const emptyState = (() => {
    if (isCategoryView) {
      return {
        title: "لا توجد منتجات في هذه الفئة حالياً.",
        message: "يُحدَّث الكتالوج باستمرار — تفضّل بزيارتنا لاحقاً",
        actionTitle: "تصفّح كل المنتجات",
        onAction: () => router.push("/(tabs)/(home)"),
      };
    }
    if (clearableFilterCount > 0) {
      const availableOnlyFiltered = availableOnly && clearableFilterCount === 1;
      return {
        title: availableOnlyFiltered
          ? "نفد مخزون كل المنتجات المطابقة حالياً"
          : "لا توجد منتجات تطابق بحثك",
        message: availableOnlyFiltered
          ? "قد تكون هناك نتائج مطابقة لكنها نفدت — جرّب إلغاء فلتر «المتوفّر فقط» لعرضها"
          : "جرّب تغيير الفلتر أو كلمة البحث",
        actionTitle: "مسح جميع الفلاتر",
        onAction: clearFilters,
      };
    }
    return {
      title: "لا توجد منتجات معروضة حالياً",
      message: "يُحدَّث الكتالوج باستمرار — تفضّل بزيارتنا لاحقاً",
      actionTitle: undefined,
      onAction: undefined as (() => void) | undefined,
    };
  })();

  const listEmpty = (() => {
    if (isLoading && products.length === 0) {
      return <ProductGridSkeleton count={6} />;
    }
    if (isError && products.length === 0) {
      return (
        <ErrorState
          message={getErrorMessage(error)}
          onRetry={() => {
            void refetch();
          }}
        />
      );
    }
    if (products.length === 0) {
      return (
        <EmptyState
          title={emptyState.title}
          message={emptyState.message}
          actionTitle={emptyState.actionTitle}
          onAction={emptyState.onAction}
        />
      );
    }
    return null;
  })();

  // Stale-content rule: a refresh failure keeps the content; the InlineError
  // rides above it with a retry.
  const staleError = isError && products.length > 0 ? getErrorMessage(error) : null;

  const header = (
    <View>
      {staleError ? (
        <InlineError
          message={staleError}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : null}

      {headerTop ? headerTop({ clearFilters }) : null}

      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm }}>
        {showSearchField ? (
          <CatalogSearchField value={searchInput} onChangeText={setSearchInput} />
        ) : null}
        <CatalogFilterChips
          availableOnly={availableOnly}
          onToggleAvailable={() => setAvailableOnly((v) => !v)}
          sort={sort}
          onSelectSort={setSort}
          showAvailableToggle={showAvailableToggle}
        />
      </View>

      {/* Section header — the filter-aware title + count + مسح affordance. */}
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: spacing.sm,
          gap: spacing.xs,
        }}
      >
        <ThemedText variant="headline">{title}</ThemedText>
        {!isLoading && (products.length > 0 || clearableFilterCount > 0) ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              flexWrap: "wrap",
            }}
          >
            <ThemedText variant="caption" style={{ color: colors.onSurface }}>
              <ThemedText
                variant="caption"
                style={{
                  color: colors.foreground,
                  fontFamily: "ReadexPro-SemiBold",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {arabicCount(products.length, PRODUCT_COUNT_FORMS)}
              </ThemedText>
              {isCategoryView ? " في هذه الفئة" : null}
            </ThemedText>
            {clearableFilterCount > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`مسح الفلاتر (${clearableFilterCount})`}
                onPress={clearFilters}
                hitSlop={4}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <ThemedText
                  variant="caption"
                  style={{ color: colors.primaryText, fontFamily: "ReadexPro-SemiBold" }}
                >
                  مسح ({clearableFilterCount})
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <FlatList
      data={displayProducts}
      keyExtractor={(item) => String(item.id)}
      numColumns={2}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: spacing.xl, gap: spacing.md }}
      columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
      ListHeaderComponent={header}
      ListEmptyComponent={listEmpty ?? undefined}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void onRefresh();
          }}
          tintColor={colors.primary}
          colors={[colors.primary]}
          progressBackgroundColor={colors.surfaceOverlay}
        />
      }
      style={{ backgroundColor: colors.background }}
      renderItem={({ item }) => (
        <View style={{ flex: 1 }}>
          <ProductCard product={item} />
        </View>
      )}
      accessibilityLabel={title}
    />
  );
}

/** The sort label for a committed sort value (web's SORTS lookup). */
export function sortLabel(value: SortValue): string {
  return SORTS.find((s) => s.value === value)?.label ?? SORTS[0]!.label;
}
