import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import type { Order } from "@workspace/api-client-native";

import { Icon } from "@/components/icon";
import { PriceDisplay } from "@/components/price-display";
import { StatusBadge, orderStatusBadge } from "@/components/status-badge";
import { ThemedText } from "@/components/themed-text";
import { apiUrl } from "@/lib/api";
import { formatCurrency, arabicCount } from "@/lib/money";
import { useColors, radius, spacing } from "@/theme";
import { formatRowDate } from "@/screens/account/dates";

/** Arabic plural forms for order counts (the web's SUBJECT registry). */
const ORDER_COUNT_FORMS = {
  zero: "طلب",
  one: "طلب",
  two: "طلبان",
  few: "طلبات",
  many: "طلباً",
  other: "طلب",
};

export function orderCountLabel(count: number): string {
  return arabicCount(count, ORDER_COUNT_FORMS);
}

/** The status accent for the row's logical-start edge (RTL = right edge). */
function statusAccentColor(
  status: string,
  colors: { success: string; info: string; error: string; warning: string },
): string {
  if (status === "completed") return colors.success;
  if (status === "refunded") return colors.info;
  if (status === "failed") return colors.error;
  return colors.warning;
}

/**
 * The orders-list row card — the native twin of the web's OrderRow:
 * product tile + name/variant + code/date chips on the start side,
 * amount + status badge on the end side, a 3px status accent on the
 * logical-start edge, and the refund receipt chip on refunded rows.
 */
export function OrderRowCard({ order }: { order: Order }) {
  const colors = useColors();
  const router = useRouter();
  const badge = orderStatusBadge(order.status);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`طلب ${order.product_name}، ${badge.label}`}
      onPress={() => router.push(`/(tabs)/(orders)/${encodeURIComponent(order.order_code)}`)}
      style={({ pressed }) => ({
        backgroundColor: colors.surfaceCard,
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: pressed ? colors.foreground : colors.border,
        borderStartWidth: 3,
        borderStartColor: statusAccentColor(order.status, colors),
        padding: spacing.lg,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        {/* Product image tile (letter fallback for legacy rows). */}
        <View
          style={{
            width: spacing.touch,
            height: spacing.touch,
            borderRadius: radius.sm,
            borderCurve: "continuous",
            backgroundColor: colors.secondary,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {order.product_image_url ? (
            <Image
              source={{ uri: apiUrl(order.product_image_url) }}
              style={{ width: "100%", height: "100%" }}
              contentFit="contain"
              accessibilityLabel={order.product_name}
            />
          ) : (
            <ThemedText variant="headline" style={{ color: colors.onSurface }}>
              {(order.product_name ?? "؟").charAt(0)}
            </ThemedText>
          )}
        </View>

        {/* Main content */}
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
          <ThemedText
            variant="subhead"
            numberOfLines={1}
            style={{ fontFamily: "ReadexPro-SemiBold" }}
          >
            {order.product_name}
          </ThemedText>
          {order.variant_label ? (
            <View
              style={{
                alignSelf: "flex-start",
                backgroundColor: colors.secondary,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: spacing.sm,
                paddingVertical: 1,
              }}
            >
              <ThemedText variant="micro" numberOfLines={1} style={{ color: colors.onSurface }}>
                {order.variant_label}
              </ThemedText>
            </View>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              flexWrap: "wrap",
            }}
          >
            <View
              style={{
                backgroundColor: colors.secondary,
                borderRadius: radius.xs,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: spacing.sm,
                paddingVertical: 1,
                direction: "ltr",
              }}
            >
              <ThemedText variant="micro" selectable style={{ color: colors.onSurface }}>
                {order.order_code}
              </ThemedText>
            </View>
            {order.created_at ? (
              <ThemedText variant="micro" style={{ color: colors.onSurface }}>
                {formatRowDate(order.created_at)}
              </ThemedText>
            ) : null}
            {order.coupon_code ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 2,
                  backgroundColor: `${colors.success}1A`,
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: `${colors.success}38`,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 1,
                }}
              >
                <Icon sf="tag.fill" md="sell" size={10} color={colors.success} />
                <ThemedText variant="micro" style={{ color: colors.success, direction: "ltr" }}>
                  {order.coupon_code}
                </ThemedText>
              </View>
            ) : null}
          </View>
          {/* Refund receipt — info tone: the money came back. */}
          {order.status === "refunded" ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                alignSelf: "flex-start",
                backgroundColor: `${colors.info}1A`,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: `${colors.info}38`,
                paddingHorizontal: spacing.sm,
                paddingVertical: 1,
              }}
              accessibilityLabel={`استُرد ${formatCurrency(order.amount)} إلى محفظتك`}
            >
              <Icon sf="arrow.uturn.backward" md="undo" size={10} color={colors.info} />
              <ThemedText
                variant="micro"
                style={{ color: colors.info, fontVariant: ["tabular-nums"] }}
              >
                استُرد {formatCurrency(order.amount)} إلى محفظتك
              </ThemedText>
            </View>
          ) : null}
        </View>

        {/* End side: amount + status */}
        <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
          {(order.discount_amount ?? 0) > 0 ? (
            <ThemedText
              variant="footnote"
              style={{
                color: colors.onSurface,
                textDecorationLine: "line-through",
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatCurrency((order.amount ?? 0) + (order.discount_amount ?? 0))}
            </ThemedText>
          ) : null}
          <PriceDisplay priceLYD={order.amount} size="md" ink="browsing" />
          <StatusBadge label={badge.label} tone={badge.tone} />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The cluster chip rendered ABOVE the first row of every run of ≥2
 * consecutive orders sharing one order_group_id («عملية شراء واحدة»).
 */
export function OrderClusterChip({ runCount }: { runCount: number }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", paddingTop: spacing.xs }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          backgroundColor: colors.secondary,
          borderRadius: radius.full,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: spacing.md,
          paddingVertical: 2,
        }}
      >
        <Icon sf="square.stack.3d.up" md="layers" size={12} color={colors.onSurface} />
        <ThemedText variant="micro" style={{ color: colors.onSurface }}>
          عملية شراء واحدة ({orderCountLabel(runCount)})
        </ThemedText>
      </View>
    </View>
  );
}
