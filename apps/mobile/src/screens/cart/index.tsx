import { useCallback } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useClearCart, useGetWallet, type WalletInfo } from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { Card, Divider, SectionHeader } from "@/components/card";
import { Icon } from "@/components/icon";
import { PriceDisplay } from "@/components/price-display";
import { QuantityStepper } from "@/components/quantity-stepper";
import { EmptyState, Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { apiUrl } from "@/lib/api";
import { MAX_LINE_QUANTITY, stockVerdict, useCart, type LocalCartItem } from "@/lib/cart";
import { formatCurrency } from "@/lib/money";
import { useColors, radius, spacing } from "@/theme";

/**
 * Cart — the native port of the web's pages/cart.tsx: the LOCAL cart
 * (lib/cart.tsx) renders the lines; the server's in-tx stock re-check at
 * checkout stays the charge authority, so every price/total here is a
 * display hint (M-law: the device never computes an authoritative total).
 */

/** Effective unit price (sale ?? list) — the web's effectivePrice. */
function effectivePrice(line: LocalCartItem): number {
  return line.salePriceLYD ?? line.priceLYD;
}

/** Honest raise cap: snapshot stock (advisory) × MAX_LINE_QUANTITY. */
function stockAwareCeiling(stockCount: number | null | undefined): number {
  if (stockCount == null) return MAX_LINE_QUANTITY;
  return Math.max(1, Math.min(stockCount, MAX_LINE_QUANTITY));
}

/** Per-line stock notice (advisory snapshot; the web's strings). */
function lineStockNotice(line: LocalCartItem): { text: string; blocked: boolean } | null {
  const stock = line.stockCount ?? null;
  switch (stockVerdict(line)) {
    case "out":
      return { text: "نفد المخزون", blocked: true };
    case "insufficient":
      return { text: `الكمية المتاحة: ${stock}`, blocked: true };
    case "low":
      return { text: `متبقٍ ${stock} فقط`, blocked: false };
    default:
      return null;
  }
}

/** A proven-unchargeable line (stock 0 / qty > snapshot) blocks checkout. */
function lineBlocksCheckout(line: LocalCartItem): boolean {
  const verdict = stockVerdict(line);
  return verdict === "out" || verdict === "insufficient";
}

/** Product art URL — absolute for expo-image (relative → API origin). */
function resolveImageUri(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}

function lineKey(line: LocalCartItem): string {
  return `${line.productId}:${line.variantId ?? 0}`;
}

/** One cart line: thumb, name/variant, stock notice, price, stepper, remove. */
function CartLineRow({ line }: { line: LocalCartItem }) {
  const colors = useColors();
  const { updateQuantity, removeItem } = useCart();
  const price = effectivePrice(line);
  const notice = lineStockNotice(line);
  const uri = resolveImageUri(line.imageUrl);
  const productHref = {
    pathname: "/(tabs)/(home)/product/[slug]",
    params: { slug: String(line.slug ?? line.productId) },
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`عرض المنتج ${line.name}`}
          onPress={() => router.push(productHref)}
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: colors.secondary,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {uri ? (
            <Image
              source={{ uri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="contain"
            />
          ) : (
            <ThemedText variant="headline" style={{ color: colors.onSurface }}>
              {(line.name ?? "?").charAt(0)}
            </ThemedText>
          )}
        </Pressable>

        <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`عرض المنتج ${line.name}`}
            onPress={() => router.push(productHref)}
            hitSlop={4}
          >
            <ThemedText
              variant="subhead"
              numberOfLines={1}
              style={{ fontFamily: "ReadexPro-SemiBold" }}
            >
              {line.name}
            </ThemedText>
          </Pressable>
          {line.variantLabel ? (
            <View
              style={{
                alignSelf: "flex-start",
                backgroundColor: colors.secondary,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
              }}
            >
              <ThemedText variant="micro" style={{ color: colors.onSurface }}>
                {line.variantLabel}
              </ThemedText>
            </View>
          ) : null}
          {notice ? (
            <View
              accessibilityLabel={notice.text}
              style={{
                alignSelf: "flex-start",
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                backgroundColor: notice.blocked ? `${colors.error}1A` : `${colors.warning}1A`,
                borderRadius: radius.full,
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
              }}
            >
              <Icon
                sf={
                  notice.blocked ? "exclamationmark.circle.fill" : "exclamationmark.triangle.fill"
                }
                md={notice.blocked ? "error" : "warning"}
                size={12}
                color={notice.blocked ? colors.error : colors.warning}
              />
              <ThemedText
                variant="micro"
                style={{
                  color: notice.blocked ? colors.error : colors.warning,
                  fontFamily: "ReadexPro-SemiBold",
                }}
              >
                {notice.text}
              </ThemedText>
            </View>
          ) : null}
          <PriceDisplay
            priceLYD={line.priceLYD}
            salePriceLYD={line.salePriceLYD}
            discountPercent={line.discountPercent}
            size="sm"
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`حذف المنتج ${line.name}`}
          onPress={() => removeItem(line.productId, line.variantId)}
          hitSlop={4}
          style={({ pressed }) => ({
            width: spacing.touch,
            height: spacing.touch,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.sm,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {({ pressed }) => (
            <Icon
              sf="trash"
              md="delete"
              size={20}
              color={pressed ? colors.error : colors.onSurface}
            />
          )}
        </Pressable>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: spacing.md,
        }}
      >
        <QuantityStepper
          quantity={line.quantity}
          max={stockAwareCeiling(line.stockCount)}
          onChange={(next) => updateQuantity(line.productId, next, line.variantId)}
        />
        {line.quantity > 1 ? (
          <ThemedText
            variant="footnote"
            style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
            selectable
          >
            {`${line.quantity} × ${formatCurrency(price)} = ${formatCurrency(Math.round(price * line.quantity * 100) / 100)}`}
          </ThemedText>
        ) : null}
      </View>
    </Card>
  );
}

/** Three-line-rows loading shape for the cart-hydration window. */
function CartSkeleton() {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {Array.from({ length: 3 }, (_, i) => (
        <Card key={i}>
          <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
            <Skeleton style={{ width: 56, height: 56, borderRadius: radius.md }} />
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Skeleton style={{ width: "60%", height: 16 }} />
              <Skeleton style={{ width: "40%", height: 12 }} />
            </View>
            <Skeleton style={{ width: 48, height: 24, borderRadius: radius.full }} />
          </View>
        </Card>
      ))}
    </View>
  );
}

/** Guest panel — the auth gate in place of the checkout CTA. */
function SignInPrompt() {
  const colors = useColors();
  return (
    <Card>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        <Icon sf="lock.fill" md="lock" size={18} color={colors.primary} />
        <ThemedText variant="headline">سجّل دخولك للشراء</ThemedText>
      </View>
      <ThemedText variant="subhead" style={{ color: colors.onSurface, marginBottom: spacing.lg }}>
        سلتك محفوظة على جهازك — أنشئ حسابك أو سجّل دخولك لإتمام الطلب والدفع من المحفظة.
      </ThemedText>
      <Button
        title="تسجيل الدخول"
        size="lg"
        onPress={() => router.replace({ pathname: "/login", params: { redirect: "/checkout" } })}
      />
    </Card>
  );
}

export function CartScreen() {
  const colors = useColors();
  const { status } = useAuth();
  const { items, isLoaded, totalLYD, clear } = useCart();
  const authed = status === "authenticated";

  // Balance chip context for the total (checkout owns the actual gate);
  // a failed probe just omits the chip — never a fabricated number.
  const { data: wallet } = useGetWallet({
    query: { enabled: authed },
  });
  const balance = (wallet as WalletInfo | undefined)?.balance ?? null;

  // Best-effort server-side clear (the local cart renders regardless —
  // the web's documented-dead server cart follows along when alive).
  const clearCartMutation = useClearCart();

  const blocking = items.some(lineBlocksCheckout);

  const handleClear = useCallback(() => {
    Alert.alert("إفراغ السلة؟", "ستُزال جميع المنتجات من سلتك نهائياً.", [
      { text: "إلغاء", style: "cancel" },
      {
        text: "إفراغ السلة",
        style: "destructive",
        onPress: () => {
          clear();
          if (authed) {
            void clearCartMutation.mutateAsync().catch(() => {
              // Best-effort only — the UI renders the local cart.
            });
          }
        },
      },
    ]);
  }, [authed, clear, clearCartMutation]);

  if (!isLoaded) {
    return <CartSkeleton />;
  }

  if (items.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState
          title="سلتك فارغة"
          message="ابدأ بتصفح الكتالوج وأضف منتجاتك المفضلة للسلة"
          actionTitle="متابعة التسوق"
          onAction={() => router.navigate("/(tabs)/(home)")}
          symbol="cart"
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
    >
      <SectionHeader
        title={`سلة المشتريات (${items.length})`}
        actionLabel="إفراغ السلة"
        onAction={handleClear}
      />

      {items.map((line) => (
        <CartLineRow key={lineKey(line)} line={line} />
      ))}

      <Card raised>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.sm,
          }}
        >
          <ThemedText variant="subhead" style={{ color: colors.onSurface }}>
            الإجمالي
          </ThemedText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {authed && balance !== null ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs,
                  backgroundColor: colors.secondary,
                  borderRadius: radius.full,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 2,
                }}
              >
                <Icon
                  sf="wallet.fill"
                  md="account-balance-wallet"
                  size={12}
                  color={colors.onSurface}
                />
                <ThemedText
                  variant="micro"
                  style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
                >
                  رصيدك {formatCurrency(balance)}
                </ThemedText>
              </View>
            ) : null}
            <ThemedText variant="title" style={{ fontVariant: ["tabular-nums"] }} selectable>
              {formatCurrency(totalLYD)}
            </ThemedText>
          </View>
        </View>

        {authed && balance !== null && balance < totalLYD ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              gap: spacing.xs,
              marginTop: spacing.sm,
            }}
          >
            <ThemedText
              variant="footnote"
              style={{ color: colors.warning, fontVariant: ["tabular-nums"] }}
            >
              {`تحتاج شحن ${formatCurrency(Math.round((totalLYD - balance) * 100) / 100)} لإتمام الطلب`}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate("/(tabs)/(wallet)")}
              hitSlop={4}
            >
              <ThemedText
                variant="footnote"
                style={{ color: colors.warning, textDecorationLine: "underline" }}
              >
                اشحن المحفظة
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {/* The shared Divider carries only `inset` — the vertical rhythm
            rides the wrapper (type-level fix, no visual change). */}
        <View style={{ marginVertical: spacing.md }}>
          <Divider />
        </View>

        {blocking ? (
          <View
            accessibilityRole="alert"
            style={{
              backgroundColor: `${colors.error}1A`,
              borderRadius: radius.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: `${colors.error}33`,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              marginBottom: spacing.md,
            }}
          >
            <ThemedText
              variant="footnote"
              style={{ color: colors.error, textAlign: "center", fontFamily: "ReadexPro-SemiBold" }}
            >
              بعض العناصر نفد مخزونها — أزلها أو عدّل كميتها للمتابعة
            </ThemedText>
          </View>
        ) : null}

        {authed ? (
          <Button
            title="إتمام الطلب"
            size="lg"
            disabled={blocking}
            accessibilityHint="الانتقال إلى شاشة الدفع"
            onPress={() => router.push("/checkout")}
          />
        ) : (
          <SignInPrompt />
        )}

        <ThemedText
          variant="micro"
          style={{ color: colors.onSurface, textAlign: "center", marginTop: spacing.md }}
        >
          الدفع يُخصم من رصيد محفظتك فوراً — تسليم فوري بعد التأكيد
        </ThemedText>
      </Card>
    </ScrollView>
  );
}
