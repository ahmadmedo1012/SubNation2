import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { listOrders, type Order } from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { useColors, radius, spacing } from "@/theme";
import { SignInPrompt } from "@/screens/account/sign-in-prompt";
import { OrderClusterChip, OrderRowCard, orderCountLabel } from "./order-row";
import { computeOrderGroupClusters } from "./order-groups";

/**
 * Orders list — the native twin of the web's /orders page:
 *   • filter chips over the status buckets (الكل / قيد المعالجة / مكتمل,
 *     plus the refunded-failed bucket once it is non-empty — the web's
 *     honest chip set);
 *   • order-group clustering («عملية شراء واحدة») over the visible list;
 *   • accumulating load-more over the route's ?page= param (a plain-array
 *     contract: a full page MIGHT have a next one, the first short page is
 *     the definite end);
 *   • the four states everywhere — first-load skeleton, error with retry
 *     (a background-refresh failure with stale rows on screen is an
 *     InlineError, never an error screen), designed empty states, content.
 */

/** The route's page size (the web's frozen 200-row contract). */
const ORDERS_PAGE_SIZE = 200;

type OrderFilter = "all" | "pending" | "completed" | "failed";

interface FilterChip {
  value: OrderFilter;
  label: string;
  count: number;
  tone: "primary" | "warning" | "success" | "info";
}

export function OrdersListScreen() {
  const { status } = useAuth();

  if (status === "guest") {
    return <SignInPrompt message="سجّل دخولك لعرض طلباتك ومتابعة حالتها وبيانات التسليم." />;
  }
  return <OrdersListContent />;
}

function OrdersListContent() {
  const colors = useColors();
  const router = useRouter();
  const [filter, setFilter] = useState<OrderFilter>("all");

  const {
    data: pages,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteQuery<Order[], Error>({
    queryKey: ["/api/orders", "load-more"],
    queryFn: ({ pageParam, signal }) =>
      listOrders({ page: pageParam as number, limit: ORDERS_PAGE_SIZE }, { signal }),
    initialPageParam: 1,
    // Plain-array honesty: a full page might continue; a short page ends it.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === ORDERS_PAGE_SIZE ? allPages.length + 1 : undefined,
  });

  // Accumulated list — dedup by id (a purchase between page requests
  // shifts offset boundaries, so a row can repeat across pages).
  const orders = useMemo(() => {
    const seen = new Set<number>();
    const rows: Order[] = [];
    for (const page of pages?.pages ?? []) {
      for (const order of page) {
        if (seen.has(order.id)) continue;
        seen.add(order.id);
        rows.push(order);
      }
    }
    return rows;
  }, [pages]);

  // A background-refresh failure with stale rows still on screen is NOT
  // an error screen — only a failed first load is.
  const loadError = isError && (pages?.pages.length ?? 0) === 0;

  const [pending, completed, failed] = useMemo(
    () => [
      // "processing" is not in the generated OrderStatus union — the
      // pending bucket is "pending" alone (verified against the schema).
      orders.filter((o) => o.status === "pending"),
      orders.filter((o) => o.status === "completed"),
      orders.filter((o) => o.status === "failed" || o.status === "refunded"),
    ],
    [orders],
  );

  const chips: FilterChip[] = [
    { value: "all", label: "الكل", count: orders.length, tone: "primary" },
    { value: "pending", label: "قيد المعالجة", count: pending.length, tone: "warning" },
    { value: "completed", label: "مكتمل", count: completed.length, tone: "success" },
  ];
  // The refunded/failed bucket only joins the dial once it is non-empty
  // (the web's chip set — a fresh user with one pending order sees no
  // redundant filtering UI).
  if (failed.length > 0) {
    chips.push({ value: "failed", label: "مُسترد / فشل", count: failed.length, tone: "info" });
  }

  const visibleOrders = useMemo(() => {
    switch (filter) {
      case "pending":
        return pending;
      case "completed":
        return completed;
      case "failed":
        return failed;
      default:
        return orders;
    }
  }, [filter, orders, pending, completed, failed]);

  // Cluster runs are computed over the VISIBLE list (the R165 contract).
  const groupClusters = useMemo(() => computeOrderGroupClusters(visibleOrders), [visibleOrders]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          padding: spacing.lg,
          gap: spacing.md,
        }}
      >
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} style={{ height: 92, borderRadius: radius.md }} />
        ))}
      </View>
    );
  }

  if (loadError) {
    return <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} />;
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        title="لا توجد طلبات بعد"
        message="ابدأ بتصفح الكتالوج واشترِ أول اشتراك رقمي"
        actionTitle="تصفح الكتالوج"
        onAction={() => router.navigate("/(tabs)/(home)")}
        symbol="shippingbox"
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isError ? (
        <InlineError message={getErrorMessage(error)} onRetry={() => void refetch()} />
      ) : null}

      {/* Filter chips — a fixed toolbar above the list. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: spacing.xs,
          gap: spacing.sm,
        }}
        accessibilityLabel="تصفية الطلبات حسب الحالة"
      >
        {chips.map((chip) => (
          <FilterChipButton
            key={chip.value}
            chip={chip}
            active={filter === chip.value}
            onSelect={() => setFilter(chip.value)}
          />
        ))}
      </ScrollView>

      <FlatList
        data={visibleOrders}
        keyExtractor={(order) => String(order.id)}
        renderItem={({ item, index }) => {
          const runCount = groupClusters.get(index);
          return (
            <View style={{ gap: spacing.sm }}>
              {runCount !== undefined ? <OrderClusterChip runCount={runCount} /> : null}
              <OrderRowCard order={item} />
            </View>
          );
        }}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xs,
          paddingBottom: spacing.xl,
          gap: spacing.md,
        }}
        ListEmptyComponent={
          <View style={{ padding: spacing.xxl, alignItems: "center", gap: spacing.sm }}>
            <ThemedText variant="headline">لا توجد طلبات في هذا التصنيف</ThemedText>
            <Button
              variant="secondary"
              size="sm"
              title="عرض الكل"
              onPress={() => setFilter("all")}
            />
          </View>
        }
        ListFooterComponent={
          hasNextPage ? (
            <View style={{ alignItems: "center", paddingTop: spacing.sm }}>
              <Button
                variant="secondary"
                title="تحميل المزيد"
                loading={isFetchingNextPage}
                disabled={isFetching && !isFetchingNextPage}
                onPress={() => void fetchNextPage()}
              />
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

function FilterChipButton({
  chip,
  active,
  onSelect,
}: {
  chip: FilterChip;
  active: boolean;
  onSelect: () => void;
}) {
  const colors = useColors();
  const toneColor =
    chip.tone === "warning"
      ? colors.warning
      : chip.tone === "success"
        ? colors.success
        : chip.tone === "info"
          ? colors.info
          : colors.primary;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${chip.label}، ${orderCountLabel(chip.count)}`}
      accessibilityState={{ selected: active }}
      onPress={onSelect}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        minHeight: 36,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.full,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: active ? `${toneColor}55` : colors.border,
        backgroundColor: active
          ? `${toneColor}1A`
          : pressed
            ? colors.secondary
            : colors.surfaceCard,
      })}
    >
      <ThemedText
        variant="footnote"
        style={{
          color: active ? toneColor : colors.foreground,
          fontFamily: active ? "ReadexPro-SemiBold" : "ReadexPro-Regular",
        }}
      >
        {chip.label}
      </ThemedText>
      <ThemedText
        variant="micro"
        style={{ color: active ? toneColor : colors.onSurface, fontVariant: ["tabular-nums"] }}
      >
        {chip.count}
      </ThemedText>
    </Pressable>
  );
}
