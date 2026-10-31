import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter, type Href } from "expo-router";

import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { radius, spacing, type, useColors } from "@/theme";

import { hasOnboardingBeenSeen, markOnboardingSeen } from "./onboarding-flag";

/**
 * OnboardingScreen — the native read of the web's post-signup welcome
 * (frontend/src/pages/onboarding.tsx): a 2-step informational welcome
 * (value prop → next actions). Nothing is collected — profile editing
 * lives in the account hub; this screen only establishes the value
 * proposition and hands over clear next actions.
 *
 * Completion flips the LOCAL seen-flag (AsyncStorage): the generated API
 * client carries NO onboarding-complete operation (verified — grep
 * "nboarding" in shared/api-client-react/src/generated), and the task
 * contract bans hand-written fetches, so no server call is made this
 * round. The login router + this screen's bounce gate read the flag so a
 * user who completed the welcome once is never routed back into it.
 */

/** A feature row — icon stage + title + description (the web's FeatureRow). */
function FeatureRow({
  glyph,
  tint,
  title,
  description,
}: {
  glyph: { sf: string; md: string };
  tint: string;
  title: string;
  description: string;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
      <View
        style={{
          width: spacing.touch,
          height: spacing.touch,
          borderRadius: radius.sm,
          borderCurve: "continuous",
          backgroundColor: colors.secondary,
          alignItems: "center",
          justifyContent: "center",
        }}
        accessibilityRole="image"
        accessibilityLabel={title}
      >
        <Icon sf={glyph.sf} md={glyph.md} size={20} color={tint} />
      </View>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <ThemedText variant="headline">{title}</ThemedText>
        <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
          {description}
        </ThemedText>
      </View>
    </View>
  );
}

export function OnboardingScreen() {
  const colors = useColors();
  const router = useRouter();
  const { status, user } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [completing, setCompleting] = useState(false);
  // null = the AsyncStorage read is still in flight.
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    void hasOnboardingBeenSeen().then(setSeen);
  }, []);

  // Guest gate (the web's no-token redirect): sign in first, then land
  // back on the welcome the signup flow intended.
  useEffect(() => {
    if (status === "guest") {
      router.replace({ pathname: "/login", params: { redirect: "/onboarding" } });
    }
  }, [status, router]);

  // Already onboarded server-side (a returning web user) → home.
  useEffect(() => {
    if (user && user.onboarded_at != null) router.replace("/");
  }, [user, router]);

  // Already completed the NATIVE welcome once → home (re-entry guard).
  useEffect(() => {
    if (seen === true) router.replace("/");
  }, [seen, router]);

  /** Mark the welcome complete (local flag) and route to the target. */
  const complete = useCallback(
    async (target: string) => {
      if (completing) return;
      setCompleting(true);
      try {
        await markOnboardingSeen();
      } catch {
        // Persistence failure must never trap the user on the welcome.
      } finally {
        router.replace(target as Href);
      }
    },
    [completing, router],
  );

  // While the auth hydration + the local flag read settle, hold the
  // card's shape with skeletons — never flash the welcome (or empty).
  const settling = status !== "authenticated" || seen === null;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        padding: spacing.xl,
        gap: spacing.xl,
      }}
    >
      {settling ? (
        <View style={{ gap: spacing.md }} accessibilityLabel="جارٍ التحميل">
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <Skeleton
              style={{
                width: spacing.touch + spacing.sm,
                height: spacing.touch + spacing.sm,
                borderRadius: radius.lg,
              }}
            />
            <Skeleton style={{ width: "60%", height: type.title.lineHeight }} />
            <Skeleton style={{ width: "80%", height: type.subhead.lineHeight }} />
          </View>
          <Skeleton style={{ height: spacing.touch + spacing.xl, borderRadius: radius.md }} />
          <Skeleton style={{ height: spacing.touch + spacing.xl, borderRadius: radius.md }} />
          <Skeleton style={{ height: spacing.touch + spacing.xl, borderRadius: radius.md }} />
          <Skeleton style={{ height: spacing.touch + spacing.sm, borderRadius: radius.md }} />
        </View>
      ) : (
        <View style={{ gap: spacing.xl }}>
          {/* Progress dots — 2 steps. */}
          <View
            accessibilityLabel={`الخطوة ${step} من 2`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.xs,
            }}
          >
            {[1, 2].map((s) => (
              <View
                key={s}
                style={{
                  width: s === step ? spacing.xxl : spacing.lg,
                  // The web's h-1.5 dot (6px) from the 4-point grid.
                  height: spacing.xs + spacing.xs / 2,
                  borderRadius: radius.full,
                  backgroundColor: s === step ? colors.primary : colors.secondary,
                }}
              />
            ))}
          </View>

          {step === 1 ? (
            <View style={{ gap: spacing.xl }}>
              <View style={{ alignItems: "center", gap: spacing.md }}>
                <View
                  style={{
                    width: spacing.touch + spacing.sm,
                    height: spacing.touch + spacing.sm,
                    borderRadius: radius.lg,
                    borderCurve: "continuous",
                    backgroundColor: `${colors.primary}1F`,
                    borderWidth: 1,
                    borderColor: `${colors.primary}38`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  accessibilityRole="image"
                  accessibilityLabel="مرحباً بك في SubNation"
                >
                  <Icon sf="sparkles" md="stars" size={26} color={colors.primary} />
                </View>
                <ThemedText variant="title" style={{ textAlign: "center" }}>
                  مرحباً بك في SubNation
                </ThemedText>
                <ThemedText
                  variant="subhead"
                  style={{ textAlign: "center", color: colors.onSurface }}
                >
                  سوق الاشتراكات الرقمية في ليبيا — بالدينار الليبي، تسليم فوري، ودعم محلي.
                </ThemedText>
              </View>

              <View style={{ gap: spacing.lg }}>
                <FeatureRow
                  glyph={{ sf: "shippingbox.fill", md: "local_shipping" }}
                  tint={colors.primary}
                  title="تسليم فوري"
                  description="في أغلب الحالات تصلك بيانات الاشتراك فور تأكيد الدفع، وخلال 24 ساعة كحد أقصى."
                />
                <FeatureRow
                  glyph={{ sf: "checkmark.shield.fill", md: "verified_user" }}
                  tint={colors.primary}
                  title="دفع آمن بمحفظتك"
                  description="اشحن مرة، اشترِ بدون تكرار بيانات الدفع."
                />
                <FeatureRow
                  glyph={{ sf: "bag.fill", md: "shopping-bag" }}
                  tint={colors.primary}
                  title="كتالوج كامل"
                  description="نتفلكس، ديزني+، باراماونت+، سبوتيفاي وأكثر."
                />
              </View>

              <Button
                title="التالي"
                size="lg"
                onPress={() => setStep(2)}
                accessibilityHint="ينتقل إلى الخطوة الثانية"
              />
            </View>
          ) : (
            <View style={{ gap: spacing.xl }}>
              <View style={{ alignItems: "center", gap: spacing.md }}>
                <View
                  style={{
                    width: spacing.touch + spacing.sm,
                    height: spacing.touch + spacing.sm,
                    borderRadius: radius.lg,
                    borderCurve: "continuous",
                    backgroundColor: `${colors.success}1F`,
                    borderWidth: 1,
                    borderColor: `${colors.success}38`,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  accessibilityRole="image"
                  accessibilityLabel="جاهز للبدء"
                >
                  <Icon sf="bag.fill" md="shopping-bag" size={26} color={colors.success} />
                </View>
                <ThemedText variant="title" style={{ textAlign: "center" }}>
                  جاهز للبدء
                </ThemedText>
                <ThemedText
                  variant="subhead"
                  style={{ textAlign: "center", color: colors.onSurface }}
                >
                  اختر إلى أين تتوجّه — يمكنك دائماً العودة لإعدادات حسابك من صفحة حسابك.
                </ThemedText>
              </View>

              <View style={{ gap: spacing.md }}>
                <Button
                  title="ابدأ التسوق"
                  size="lg"
                  disabled={completing}
                  loading={completing}
                  onPress={() => {
                    void complete("/");
                  }}
                  accessibilityHint="ينهي الترحيب وينتقل إلى الرئيسية"
                />
                <Button
                  title="شحن المحفظة أولاً"
                  variant="secondary"
                  size="lg"
                  disabled={completing}
                  onPress={() => {
                    void complete("/wallet");
                  }}
                  accessibilityHint="ينهي الترحيب وينتقل إلى المحفظة"
                />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="السابق"
                disabled={completing}
                onPress={() => setStep(1)}
                style={({ pressed }) => ({
                  minHeight: spacing.touch,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: completing ? 0.5 : pressed ? 0.7 : 1,
                })}
              >
                <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
                  السابق
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* The skip affordance — completes AND navigates (44px target). */}
          <View
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}
            accessibilityLabel="يمكنك تخطّي هذه الشاشة في أي وقت من هنا"
          >
            <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
              يمكنك تخطّي هذه الشاشة في أي وقت من{" "}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تخطّي الترحيب"
              disabled={completing}
              onPress={() => {
                void complete("/");
              }}
              hitSlop={spacing.xs}
              style={({ pressed }) => ({
                minHeight: spacing.touch,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: spacing.xs,
                opacity: completing ? 0.5 : pressed ? 0.7 : 1,
              })}
            >
              <ThemedText
                variant="footnote"
                style={{ color: colors.primaryText, textDecorationLine: "underline" }}
              >
                هنا
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
