import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { keepPreviousData } from "@tanstack/react-query";
import {
  useListProducts,
  type ListProductsParams,
  type ProductListItem,
} from "@workspace/api-client-native";

import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/states";
import { Icon } from "@/components/icon";
import { PriceDisplay } from "@/components/price-display";
import { ThemedText } from "@/components/themed-text";
import { categoryLabel, categoryMeta } from "@/constants";
import { API_URL } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { productArtUrl } from "@/lib/product-art";
import { radius, spacing, type, useColors } from "@/theme";

import { clearSearchHistory, getSearchHistory, saveSearchHistory } from "./search-history";
/**
 * SearchScreen — the full-screen search (the web's search-dropdown
 * lifecycle, native): autoFocus input, 300ms debounce into
 * useListProducts({search, fields:"list"}), compact result rows, and the
 * recent-search chips (AsyncStorage «subnation_search_history», max 8,
 * saved only on an explicit submit — the web's R94-A1 #16 contract).
 */

const MIN_QUERY_LENGTH = 2;

export function SearchScreen() {
  const colors = useColors();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    void getSearchHistory().then(setHistory);
  }, []);

  // Live search commits behind a 300ms debounce; <2 chars never fetches
  // (the web's suggestion threshold).
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const canQuery = query.length >= MIN_QUERY_LENGTH;

  const params = useMemo<ListProductsParams>(() => {
    const next: ListProductsParams = { fields: "list" };
    if (query) next.search = query;
    return next;
  }, [query]);

  const { data, isLoading, isError, error, refetch } = useListProducts(params, {
    query: { enabled: canQuery, placeholderData: keepPreviousData, staleTime: 60_000 },
  });
  const results = useMemo(() => data ?? [], [data]);

  // An explicit submit commits the search AND writes the history entry.
  const commitSearch = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setInput(trimmed);
    setQuery(trimmed);
    setHistory(await saveSearchHistory(trimmed));
  }, []);

  const clearQuery = useCallback(() => {
    setInput("");
    setQuery("");
  }, []);

  const clearHistory = useCallback(() => {
    void clearSearchHistory();
    setHistory([]);
  }, []);

  const staleError = isError && results.length > 0 ? getErrorMessage(error) : null;

  const listEmpty = (() => {
    if (isLoading && results.length === 0) return <SearchRowsSkeleton />;
    if (isError && results.length === 0) {
      return (
        <ErrorState
          message={getErrorMessage(error)}
          onRetry={() => {
            void refetch();
          }}
        />
      );
    }
    if (results.length === 0) {
      return (
        <EmptyState
          title="لا توجد منتجات تطابق بحثك"
          message="جرّب تغيير كلمة البحث أو تصفّح الفئات من الصفحة الرئيسية"
          actionTitle="مسح البحث"
          onAction={clearQuery}
          symbol="tray"
        />
      );
    }
    return null;
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            minHeight: spacing.touch,
            backgroundColor: colors.secondary,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            borderCurve: "continuous",
            paddingHorizontal: spacing.lg,
          }}
        >
          <Icon sf="magnifyingglass" md="search" size={16} color={colors.onSurface} />
          <TextInput
            autoFocus
            value={input}
            onChangeText={setInput}
            placeholder="ابحث عن منتج…"
            placeholderTextColor={colors.onSurface}
            accessibilityLabel="البحث في المنتجات"
            inputMode="search"
            returnKeyType="search"
            clearButtonMode="while-editing"
            onSubmitEditing={() => {
              void commitSearch(input);
            }}
            style={{
              flex: 1,
              color: colors.foreground,
              fontFamily: type.subhead.fontFamily,
              fontSize: type.subhead.fontSize,
              paddingVertical: spacing.sm,
              textAlignVertical: "center",
            }}
          />
          {input ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="مسح البحث"
              onPress={clearQuery}
              hitSlop={8}
            >
              <Icon sf="xmark.circle.fill" md="cancel" size={16} color={colors.onSurface} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {canQuery ? (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          ListHeaderComponent={
            staleError ? (
              <InlineError
                message={staleError}
                onRetry={() => {
                  void refetch();
                }}
              />
            ) : undefined
          }
          ListEmptyComponent={listEmpty ?? undefined}
          accessibilityLabel={`نتائج البحث: ${query}`}
          renderItem={({ item }) => (
            <SearchProductRow
              product={item}
              onPress={() => router.push(`/product/${item.slug ?? item.id}`)}
            />
          )}
        />
      ) : (
        <HistoryPanel
          history={history}
          onPick={(value) => {
            void commitSearch(value);
          }}
          onClear={clearHistory}
        />
      )}
    </View>
  );
}

/** Compact result row: thumb + name + category + price (web's dropdown row). */
function SearchProductRow({ product, onPress }: { product: ProductListItem; onPress: () => void }) {
  const colors = useColors();
  const art = productArtUrl(product.image_url, API_URL);
  const meta = categoryMeta(product.category);
  const accent = meta ? colors[meta.colorKey] : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={product.name}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        minHeight: spacing.touch + spacing.sm,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: spacing.touch,
          height: spacing.touch,
          backgroundColor: colors.secondary,
          borderRadius: radius.sm,
          borderCurve: "continuous",
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {art ? (
          <Image
            source={{ uri: art }}
            contentFit="cover"
            transition={200}
            accessibilityLabel={product.name}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <Icon
            sf={meta?.sf ?? "shippingbox"}
            md={meta?.md ?? "inventory-2"}
            size={20}
            color={accent}
          />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText
          variant="subhead"
          numberOfLines={1}
          style={{ fontFamily: "ReadexPro-SemiBold" }}
        >
          {product.name}
        </ThemedText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
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
      </View>
      <View
        style={{
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
    </Pressable>
  );
}

/** The resting state: recent-search chips + the clear action. */
function HistoryPanel({
  history,
  onPick,
  onClear,
}: {
  history: string[];
  onPick: (query: string) => void;
  onClear: () => void;
}) {
  const colors = useColors();
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <ThemedText variant="headline">عمليات البحث السابقة</ThemedText>
        {history.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="مسح سجل البحث"
            onPress={onClear}
            hitSlop={8}
          >
            <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
              مسح
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {history.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {history.map((entry) => (
            <Pressable
              key={entry}
              accessibilityRole="button"
              accessibilityLabel={`ابحث عن ${entry}`}
              onPress={() => onPick(entry)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                paddingHorizontal: spacing.lg,
                minHeight: spacing.touch - spacing.sm,
                backgroundColor: colors.secondary,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                borderCurve: "continuous",
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Icon sf="clock" md="history" size={14} color={colors.onSurface} />
              <ThemedText variant="footnote">{entry}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : (
        <ThemedText variant="subhead" style={{ color: colors.onSurface }}>
          ابدأ بالكتابة لعرض النتائج — نتفلكس، سبوتيفاي، ChatGPT والمزيد
        </ThemedText>
      )}
    </View>
  );
}

/** Row-shaped loading skeleton (the results list's known layout). */
function SearchRowsSkeleton() {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {Array.from({ length: 4 }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Skeleton
            style={{ width: spacing.touch, height: spacing.touch, borderRadius: radius.sm }}
          />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Skeleton style={{ height: type.subhead.lineHeight, width: "60%" }} />
            <Skeleton style={{ height: type.footnote.lineHeight, width: "35%" }} />
          </View>
        </View>
      ))}
    </View>
  );
}
