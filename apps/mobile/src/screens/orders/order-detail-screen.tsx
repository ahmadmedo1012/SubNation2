import { Pressable, ScrollView, Share, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useGetOrder, type Order } from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { CredentialCard } from "@/components/credential-card";
import { Icon } from "@/components/icon";
import { PriceDisplay } from "@/components/price-display";
import { StatusBadge, orderStatusBadge } from "@/components/status-badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { formatCurrency } from "@/lib/money";
import { useColors, radius, spacing } from "@/theme";
import { formatRelativeTime } from "@/screens/account/dates";
import { SignInPrompt } from "@/screens/account/sign-in-prompt";

/**
 * Order detail — the native twin of the web's /orders/:code page:
 *   • a receipt header card (status accent bar, product identity, the
 *     two-rung delivery stepper, the amount — emphasis by weight/size
 *     only, never color) + coupon line;
 *   • delivered credentials for completed orders — masked by default,
 *     reveal + Share (see credential-card.tsx for the clipboard note),
 *     NEVER in analytics/logs or accessibility labels;
 *   • the honest decrypt-failure branch and the «قيد الإعداد» prep card;
 *   • the failed/refunded terminal card (refund amount + the
 *     points-reversal note);
 *   • four states, with a 404 (unknown/foreign code) rendering a designed
 *     «الطلب غير موجود» — never a retry loop that cannot succeed.
 */
export function OrderDetailScreen({ orderCode }: { orderCode: string }) {
  const { status } = useAuth();

  if (status === "guest") {
    return <SignInPrompt message="سجّل دخولك لعرض تفاصيل هذا الطلب وبيانات التسليم." />;
  }
  return <OrderDetailContent orderCode={orderCode} />;
}

function OrderDetailContent({ orderCode }: { orderCode: string }) {
  const colors = useColors();
  const router = useRouter();

  const {
    data: order,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetOrder(orderCode, {
    query: { enabled: orderCode.length > 0 },
  });

  // A 404 (ORDER_NOT_FOUND — unknown code / another user's order / stale
  // link) is «الطلب غير موجود», never a connection error with an
  // infinite retry loop.
  const status404 =
    isError && error && typeof error === "object" && "status" in error
      ? (error as { status?: number }).status === 404
      : false;

  if (isLoading) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        style={{ backgroundColor: colors.background }}
      >
        <Skeleton style={{ height: 180, borderRadius: radius.lg }} />
        <Skeleton style={{ height: 140, borderRadius: radius.lg }} />
        <Skeleton style={{ height: 80, borderRadius: radius.lg }} />
      </ScrollView>
    );
  }

  if (isError && !status404) {
    return <ErrorState message={getErrorMessage(error)} onRetry={() => void refetch()} />;
  }

  if (!order) {
    return (
      <EmptyState
        title="الطلب غير موجود"
        message="تأكد من رقم الطلب أو عُد لقائمة طلباتك"
        actionTitle="كل طلباتي"
        onAction={() => router.navigate("/(tabs)/(orders)")}
        symbol="shippingbox"
      />
    );
  }

  const badge = orderStatusBadge(order.status);
  const discountAmount = order.discount_amount ?? 0;
  const couponCode = order.coupon_code ?? null;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md }}
    >
      {/* ── Receipt header card ─────────────────────────────────────── */}
      <View
        style={{
          backgroundColor: colors.surfaceCard,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        }}
      >
        {/* Status accent bar */}
        <View
          style={{
            height: 3,
            backgroundColor:
              order.status === "completed"
                ? colors.success
                : order.status === "refunded"
                  ? colors.info
                  : order.status === "failed"
                    ? colors.error
                    : colors.warning,
          }}
        />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
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

            <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
              <ThemedText variant="headline" style={{ fontFamily: "ReadexPro-Bold" }}>
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
                  <ThemedText variant="micro" style={{ color: colors.onSurface }}>
                    {order.variant_label}
                  </ThemedText>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                <ThemedText
                  variant="micro"
                  selectable
                  style={{ color: colors.onSurface, direction: "ltr" }}
                >
                  {order.order_code}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="مشاركة رقم الطلب"
                  hitSlop={6}
                  onPress={() => {
                    Share.share({ message: order.order_code }).catch(() => {});
                  }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
                >
                  <Icon sf="square.and.arrow.up" md="share" size={12} color={colors.onSurface} />
                </Pressable>
              </View>
              {order.order_group_id ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="ضمن عملية شراء واحدة — عرض كل الطلبات"
                  onPress={() => router.navigate("/(tabs)/(orders)")}
                  style={({ pressed }) => ({
                    alignSelf: "flex-start",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.xs,
                    marginTop: spacing.xs,
                    backgroundColor: colors.secondary,
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: colors.border,
                    paddingHorizontal: spacing.md,
                    paddingVertical: 2,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Icon sf="square.stack.3d.up" md="layers" size={12} color={colors.onSurface} />
                  <ThemedText variant="micro" style={{ color: colors.onSurface }}>
                    ضمن عملية شراء واحدة
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>

            <StatusBadge label={badge.label} tone={badge.tone} />
          </View>

          <StatusSteps status={order.status} />

          {/* Amount row — emphasis by weight/size only (receipt idiom). */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.md,
              paddingTop: spacing.md,
              borderTopWidth: 1,
              borderTopColor: `${colors.border}66`,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Icon sf="clock" md="schedule" size={12} color={colors.onSurface} />
              <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
                {order.created_at ? formatRelativeTime(order.created_at) : "—"}
              </ThemedText>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              {discountAmount > 0 ? (
                <ThemedText
                  variant="footnote"
                  style={{
                    color: colors.onSurface,
                    textDecorationLine: "line-through",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatCurrency(order.amount + discountAmount)}
                </ThemedText>
              ) : null}
              <PriceDisplay priceLYD={order.amount} size="lg" ink="browsing" />
            </View>
          </View>

          {/* Coupon line — the discount reads positive (success ink). */}
          {couponCode && discountAmount > 0 ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                flexWrap: "wrap",
                marginTop: spacing.xs,
                paddingTop: spacing.sm,
                borderTopWidth: 1,
                borderTopColor: `${colors.border}66`,
              }}
            >
              <Icon sf="tag.fill" md="sell" size={12} color={colors.success} />
              <ThemedText variant="footnote" style={{ color: colors.success }}>
                كوبون{" "}
                <ThemedText
                  variant="footnote"
                  style={{
                    color: colors.success,
                    fontFamily: "ReadexPro-SemiBold",
                    direction: "ltr",
                  }}
                >
                  {couponCode}
                </ThemedText>
              </ThemedText>
              <View
                style={{
                  backgroundColor: `${colors.success}1A`,
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: `${colors.success}38`,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 1,
                }}
              >
                <ThemedText
                  variant="micro"
                  style={{ color: colors.success, fontVariant: ["tabular-nums"] }}
                >
                  وفّرت {formatCurrency(discountAmount)}
                </ThemedText>
              </View>
            </View>
          ) : null}
        </View>
      </View>

      {/* ── Delivery / credentials ──────────────────────────────────── */}
      <DeliveryRegion order={order} />

      {/* ── Failed / refunded terminal card ────────────────────────── */}
      <OrderTerminalCard order={order} />

      {/* ── Actions ────────────────────────────────────────────────── */}
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <Button
          title="تصفح المزيد"
          size="lg"
          style={{ flex: 1 }}
          onPress={() => router.navigate("/(tabs)/(home)")}
        />
        <Button
          title="كل طلباتي"
          variant="secondary"
          size="lg"
          style={{ flex: 1 }}
          onPress={() => router.navigate("/(tabs)/(orders)")}
        />
      </View>

      {/* Support continuation */}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="مشكلة في هذا الطلب؟ تواصل مع الدعم"
        onPress={() => router.push("/(tabs)/(account)/support")}
        style={({ pressed }) => ({
          alignItems: "center",
          paddingVertical: spacing.sm,
          flexDirection: "row",
          gap: spacing.xs,
          justifyContent: "center",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Icon sf="arrow.up.forward.app" md="open-in-new" size={12} color={colors.onSurface} />
        <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
          مشكلة في هذا الطلب؟ تواصل مع الدعم
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

/** The two-rung delivery stepper (استُلم الطلب → تم التسليم). */
function StatusSteps({ status }: { status: string }) {
  const colors = useColors();
  if (status === "failed" || status === "refunded") return null;
  const done = status === "completed";

  const Rung = ({ complete, label }: { complete: boolean; label: string }) => (
    <View style={{ alignItems: "center", gap: spacing.xs }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.full,
          borderWidth: 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: complete ? `${colors.success}26` : colors.secondary,
          borderColor: complete ? `${colors.success}73` : colors.border,
        }}
      >
        {complete ? (
          <Icon sf="checkmark.circle.fill" md="check_circle" size={16} color={colors.success} />
        ) : (
          <Icon sf="clock" md="schedule" size={14} color={colors.onSurface} />
        )}
      </View>
      <ThemedText
        variant="micro"
        style={{
          color: complete ? colors.success : colors.onSurface,
          fontFamily: "ReadexPro-SemiBold",
          textAlign: "center",
        }}
      >
        {label}
      </ThemedText>
    </View>
  );

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Rung complete label="استُلم الطلب" />
      <View
        style={{
          flex: 1,
          height: 2.5,
          borderRadius: radius.full,
          backgroundColor: done ? `${colors.success}66` : colors.border,
        }}
        accessibilityRole="separator"
      />
      <Rung complete={done} label="تم التسليم" />
    </View>
  );
}

/**
 * The mutually-exclusive delivery trio: the credentials receipt
 * (delivered), the honest decrypt-failure alert, or the «قيد الإعداد»
 * prep card — null on the failed/refunded terminal states where the
 * terminal card owns the view.
 */
function DeliveryRegion({ order }: { order: Order }) {
  const colors = useColors();
  const router = useRouter();

  const hasDelivery = Boolean(
    order.delivered_email || order.delivered_password || order.delivered_extra_details,
  );
  // The backend's honest signal: a completed, credential-bearing row whose
  // payload could not be decrypted with the current key — point at support
  // instead of promising data that will never arrive.
  const decryptFailed = !hasDelivery && Boolean(order.decrypt_failed);

  if (order.status === "failed" || order.status === "refunded") return null;

  if (hasDelivery) {
    return (
      <View
        style={{
          backgroundColor: colors.surfaceCard,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: `${colors.success}38`,
          padding: spacing.lg,
          gap: spacing.md,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: radius.sm,
              borderCurve: "continuous",
              backgroundColor: `${colors.success}1F`,
              borderWidth: 1,
              borderColor: `${colors.success}38`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon sf="checkmark.shield.fill" md="verified_user" size={14} color={colors.success} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
              بيانات الحساب
            </ThemedText>
            <ThemedText variant="micro" style={{ color: colors.onSurface }}>
              انسخ بياناتك بأمان
              {order.delivered_at ? ` · سُلّمت ${formatRelativeTime(order.delivered_at)}` : ""}
            </ThemedText>
          </View>
        </View>

        {order.delivered_email ? (
          <CredentialCard label="البريد الإلكتروني" value={order.delivered_email} />
        ) : null}
        {order.delivered_password ? (
          <CredentialCard label="كلمة المرور" value={order.delivered_password} secret />
        ) : null}
        {order.delivered_extra_details ? (
          <CredentialCard label="تفاصيل إضافية" value={order.delivered_extra_details} multiline />
        ) : null}

        {order.delivered_usage_terms ? (
          <View
            style={{
              flexDirection: "row",
              gap: spacing.sm,
              backgroundColor: `${colors.warning}14`,
              borderWidth: 1,
              borderColor: `${colors.warning}38`,
              borderRadius: radius.md,
              borderCurve: "continuous",
              padding: spacing.md,
            }}
          >
            <Icon sf="info.circle.fill" md="info" size={16} color={colors.warning} />
            <ThemedText variant="footnote" style={{ color: colors.warning, flex: 1 }}>
              {order.delivered_usage_terms}
            </ThemedText>
          </View>
        ) : null}
      </View>
    );
  }

  if (decryptFailed) {
    return (
      <View
        style={{
          backgroundColor: colors.surfaceCard,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: `${colors.warning}4D`,
          padding: spacing.xl,
          alignItems: "center",
          gap: spacing.sm,
        }}
        accessibilityRole="alert"
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            backgroundColor: `${colors.warning}1A`,
            borderWidth: 1,
            borderColor: `${colors.warning}40`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon sf="exclamationmark.shield.fill" md="gpp_maybe" size={22} color={colors.warning} />
        </View>
        <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
          تعذّر فك تشفير بيانات التسليم
        </ThemedText>
        <ThemedText variant="footnote" style={{ color: colors.onSurface, textAlign: "center" }}>
          طلبك مكتمل ومحفوظ، لكن بيانات الحساب تعذّر فك تشفيرها حالياً. تواصل مع الدعم وستصلك
          بياناتك فوراً.
        </ThemedText>
        <Button title="تواصل مع الدعم" onPress={() => router.push("/(tabs)/(account)/support")} />
      </View>
    );
  }

  return (
    <View
      style={{
        backgroundColor: colors.surfaceCard,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.xl,
        alignItems: "center",
        gap: spacing.sm,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          backgroundColor: colors.secondary,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon sf="clock.fill" md="schedule" size={22} color={colors.onSurface} />
      </View>
      <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
        قيد الإعداد
      </ThemedText>
      <ThemedText variant="footnote" style={{ color: colors.onSurface, textAlign: "center" }}>
        سيتم تسليم بيانات الحساب فور اكتمال الطلب — عادةً فوراً، وبحد أقصى 24 ساعة. سنُشعرك فور
        جهوزيته.
      </ThemedText>
    </View>
  );
}

/**
 * The failed/refunded terminal card — refund amount, the points-reversal
 * note and the in-card support CTA (the moment the user needs help most).
 */
export function OrderTerminalCard({ order }: { order: Order }) {
  const colors = useColors();
  const router = useRouter();

  if (order.status !== "failed" && order.status !== "refunded") return null;
  const refunded = order.status === "refunded";

  return (
    <View
      style={{
        backgroundColor: colors.surfaceCard,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: refunded ? `${colors.info}38` : `${colors.error}38`,
        padding: spacing.xl,
        alignItems: "center",
        gap: spacing.sm,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          backgroundColor: refunded ? `${colors.info}14` : `${colors.error}14`,
          borderWidth: 1,
          borderColor: refunded ? `${colors.info}38` : `${colors.error}38`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {refunded ? (
          <Icon sf="arrow.uturn.backward.circle.fill" md="undo" size={22} color={colors.info} />
        ) : (
          <Icon sf="xmark.circle.fill" md="cancel" size={22} color={colors.error} />
        )}
      </View>
      <ThemedText
        variant="subhead"
        style={{
          fontFamily: "ReadexPro-SemiBold",
          color: refunded ? colors.info : colors.error,
        }}
      >
        {refunded ? "تم الاسترداد" : "فشل الطلب"}
      </ThemedText>
      <ThemedText
        variant="footnote"
        style={{ color: colors.onSurface, textAlign: "center", fontVariant: ["tabular-nums"] }}
      >
        {refunded
          ? `استُرد ${formatCurrency(order.amount)} إلى محفظتك تلقائياً`
          : "يرجى التواصل مع الدعم الفني إن احتجت مساعدة"}
      </ThemedText>
      {refunded ? (
        <ThemedText variant="micro" style={{ color: colors.onSurface, textAlign: "center" }}>
          كما خُصمت نقاط الشراء المستردة — نقاط هذا الطلب من رصيد نقاطك.
        </ThemedText>
      ) : null}
      <Button title="تواصل مع الدعم" onPress={() => router.push("/(tabs)/(account)/support")} />
    </View>
  );
}
