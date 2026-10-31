import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import * as Linking from "expo-linking";
import { useRouter, useLocalSearchParams, type Href } from "expo-router";
import { useListPublicAuthProviders } from "@workspace/api-client-native";

import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { isFirebaseAuthConfigured } from "@/lib/firebase";
import { storeToken } from "@/lib/auth-store";
import { getErrorMessage } from "@/lib/errors";
import {
  extractTelegramCallbackToken,
  isTelegramAuthCallback,
  startTelegramOidcLogin,
} from "@/lib/telegram-auth";
import {
  clearPendingReferral,
  readPendingReferral,
  stashPendingReferral,
} from "@/hooks/use-whatsapp-otp";
import { useAuth } from "@/lib/auth";
import { radius, spacing, useColors } from "@/theme";

import { BrandMark } from "./brand-mark";
import { ProviderButton } from "./provider-button";
import { hasOnboardingBeenSeen } from "./onboarding-flag";
import { WhatsAppOtpForm } from "./whatsapp-otp-form";

/**
 * LoginScreen — the native read of the web's login page
 * (frontend/src/pages/login.tsx): the passwordless provider family
 * (WhatsApp OTP primary, Telegram OIDC, Google) under the brand header.
 *
 * The four provider-query states (skeleton rows → error retry → empty
 * support note → content), the ?ref= referral stash (AsyncStorage — the
 * native substitute for the web's live-URL read), and the ?redirect=
 * return path (sanitized: same-app "/"-prefixed paths only) all live
 * here; the WhatsApp OTP state machine lives in @/hooks/use-whatsapp-otp
 * and the Telegram OIDC transport in @/lib/telegram-auth.
 *
 * THE NATIVE SESSION MECHANISM: every success path stores a 30-day JWT
 * (mintNativeSession's Set-Cookie capture, or the Telegram deep-link
 * fragment) via storeToken and hands it to useAuth().signIn — the
 * transport then presents it as a Bearer token (lib/api.ts).
 */

/** First value of a route param (expo-router delivers arrays for repeats). */
function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

/**
 * The web's sanitizeInternalPath guard: only same-app paths — a value
 * starting with "/" (and not "//", the protocol-relative escape) can be
 * a router target; anything else (external URLs, protocol-relative,
 * scheme-less) is dropped so ?redirect= can never become an open
 * redirect into a browser.
 */
function sanitizeInternalPath(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ ref?: string | string[]; redirect?: string | string[] }>();
  const { status, user, signIn } = useAuth();

  const refParam = firstParam(params.ref);
  const redirectTarget = sanitizeInternalPath(firstParam(params.redirect));

  // ── Provider catalog (four states) ────────────────────────────────────
  const { data, isLoading, isError, error, refetch } = useListPublicAuthProviders();

  // The backend returns `whatsapp_enabled` (config-only, backward-compat)
  // alongside the schema'd `whatsapp_status`; the generated type predates
  // the field, so it is read defensively — absent/false hides the entry.
  const whatsappEnabled = data
    ? Boolean((data as { whatsapp_enabled?: boolean }).whatsapp_enabled)
    : false;
  const whatsappStatus = data?.whatsapp_status ?? null;

  const telegramProvider = data?.providers.find((p) => p.id === "telegram");
  // The OIDC Authorization Code flow is the ONLY Telegram transport the
  // native app can run (the legacy widget needs a browser page); the
  // button renders only when the operator configured BotFather's OIDC
  // credentials (oidc_enabled, R154).
  const telegramReady =
    telegramProvider?.enabled !== false && Boolean(telegramProvider?.oidc_enabled);

  const googleProvider = data?.providers.find((p) => p.id === "google");
  // R145 D7 honesty gate: a client_side Google row is only actionable
  // when THIS build carries the full EXPO_PUBLIC_FIREBASE_* env set.
  const googleReady =
    googleProvider?.enabled !== false && googleProvider != null && isFirebaseAuthConfigured();

  const hasAnyMethod = whatsappEnabled || telegramReady || googleReady;

  // ── Referral attribution (?ref= at mount → AsyncStorage stash) ────────
  useEffect(() => {
    if (refParam) void stashPendingReferral(refParam);
  }, [refParam]);

  // ── Post-sign-in routing state ────────────────────────────────────────
  const [signInDone, setSignInDone] = useState(false);
  const [authError, setAuthError] = useState("");
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [onboardingSeen, setOnboardingSeen] = useState(false);
  const routedRef = useRef(false);

  useEffect(() => {
    void hasOnboardingBeenSeen().then(setOnboardingSeen);
  }, []);

  /**
   * The shared success path for externally-minted tokens (the Telegram
   * auth session + its deep-link twin): store the JWT, drop the spent
   * referral stash, load the profile. The WhatsApp verify path rides
   * mintNativeSession inside useWhatsAppOtp (same storeToken + signIn).
   */
  const completeExternalSignIn = useCallback(
    async (token: string) => {
      await storeToken(token);
      // The attribution rode the OIDC login URL — the stash is spent.
      await clearPendingReferral();
      await signIn(token);
      setSignInDone(true);
    },
    [signIn],
  );

  // ── Telegram OIDC (the system auth browser) ───────────────────────────
  const handleTelegram = useCallback(async () => {
    if (telegramBusy) return;
    setTelegramBusy(true);
    setAuthError("");
    try {
      const referralCode = await readPendingReferral();
      const token = await startTelegramOidcLogin(referralCode ? { referralCode } : undefined);
      // No token = user cancelled (or a tokenless redirect) — do nothing.
      if (!token) return;
      await completeExternalSignIn(token);
    } catch (err) {
      setAuthError(getErrorMessage(err));
    } finally {
      setTelegramBusy(false);
    }
  }, [telegramBusy, completeExternalSignIn]);

  // ── Cold-start + warm deep links (subnation://auth/callback#token=…) ──
  useEffect(() => {
    const handleCallbackUrl = (raw: string | null) => {
      if (!isTelegramAuthCallback(raw)) return;
      const token = extractTelegramCallbackToken(raw);
      if (!token) return; // cancellation / malformed — no-op
      void completeExternalSignIn(token);
    };
    // Cold start: the URL that launched the app.
    void Linking.getInitialURL().then(handleCallbackUrl);
    // Warm: the auth-session redirect while the login screen is open.
    // On Android the WebBrowser session ALSO lands here alongside its
    // own promise resolution — completeExternalSignIn is idempotent
    // (storeToken + getMe) and the routing guard below fires once.
    const subscription = Linking.addEventListener("url", ({ url }) => handleCallbackUrl(url));
    return () => subscription.remove();
  }, [completeExternalSignIn]);

  // ── Post-sign-in routing ───────────────────────────────────────────────
  // Runs once the profile load settles: the sanitized ?redirect= target
  // first (the guarded checkout/cart return path), then the new-user
  // welcome (the web's is_new_user contract — the native mint surfaces
  // no such flag, so the onboarding gate's own signal,
  // user.onboarded_at, plus the local seen-flag approximate it), else
  // home.
  useEffect(() => {
    if (!signInDone || routedRef.current) return;
    if (status !== "authenticated") return;
    routedRef.current = true;
    if (redirectTarget) {
      router.replace(redirectTarget as Href);
      return;
    }
    const needsWelcome = (user ? user.onboarded_at == null : false) && !onboardingSeen;
    router.replace(needsWelcome ? "/onboarding" : "/");
  }, [signInDone, status, user, redirectTarget, onboardingSeen, router]);

  const dismiss = useCallback(() => {
    if (router.canDismiss()) router.dismiss();
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  const googleGlyph = (
    <ThemedText variant="headline" style={{ color: colors.google, fontFamily: "ReadexPro-Bold" }}>
      G
    </ThemedText>
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        padding: spacing.xl,
        paddingBottom: spacing.xxl,
        gap: spacing.xl,
      }}
    >
      {/* Modal dismissal — the root stack presents login as a modal with
          no header, so the screen owns its escape affordance. */}
      <View style={{ flexDirection: "row", justifyContent: "flex-start" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إغلاق شاشة تسجيل الدخول"
          onPress={dismiss}
          hitSlop={spacing.sm}
          style={({ pressed }) => ({
            width: spacing.touch,
            height: spacing.touch,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.full,
            backgroundColor: colors.surfaceCard,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon sf="xmark" md="close" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Brand header + the screen's one-line value prop (web parity). */}
      <View style={{ alignItems: "center", gap: spacing.md }}>
        <BrandMark />
        <ThemedText variant="title">تسجيل الدخول</ThemedText>
        <ThemedText variant="subhead" style={{ textAlign: "center", color: colors.onSurface }}>
          ثوانٍ معدودة بدون كلمة مرور
        </ThemedText>
      </View>

      {/* The provider family — four states for the catalog query. */}
      <View style={{ gap: spacing.md }}>
        {isLoading ? (
          // Skeleton rows hold the button stack's height (never flash
          // empty while the first fetch resolves).
          <View style={{ gap: spacing.md }} accessibilityLabel="جارٍ تحميل طرق تسجيل الدخول">
            <Skeleton style={{ height: spacing.touch + spacing.sm, borderRadius: radius.md }} />
            <Skeleton style={{ height: spacing.touch + spacing.sm, borderRadius: radius.md }} />
            <Skeleton style={{ height: spacing.touch + spacing.sm, borderRadius: radius.md }} />
          </View>
        ) : isError ? (
          <ErrorState
            message={getErrorMessage(error)}
            onRetry={() => {
              void refetch();
            }}
          />
        ) : !hasAnyMethod ? (
          // No enabled provider at all — an honest support note, not a
          // silent dead zone.
          <EmptyState
            title="لا توجد طرق تسجيل دخول متاحة حالياً"
            message="طرق الدخول معطلة مؤقتاً من فريق التشغيل — تواصل مع الدعم أو أعد المحاولة بعد قليل"
            actionTitle="إعادة المحاولة"
            onAction={() => {
              void refetch();
            }}
            symbol="person.crop.circle"
          />
        ) : (
          <View style={{ gap: spacing.md }}>
            {/* WhatsApp OTP — the primary path (the majority provider in
                Libya); the backend handles new + returning users
                identically (findOrCreateWhatsAppUser). */}
            {whatsappEnabled ? (
              <WhatsAppOtpForm
                channelStatus={whatsappStatus}
                onSuccess={() => {
                  setSignInDone(true);
                }}
              />
            ) : null}

            {/* Telegram — the OIDC Authorization Code flow in the system
                auth browser; the backend redirects successful auth to
                subnation://auth/callback#token=<jwt>. */}
            {telegramReady ? (
              <ProviderButton
                label="المتابعة عبر Telegram"
                busyLabel="جارٍ التحويل إلى Telegram…"
                glyph={{ sf: "paperplane.fill", md: "telegram" }}
                tint={colors.telegram}
                busy={telegramBusy}
                onPress={() => {
                  void handleTelegram();
                }}
                accessibilityHint="يفتح نافذة تسجيل الدخول عبر تيليجرام"
              />
            ) : null}

            {/* Google — renders only when this build carries the Firebase
                native env set; the honest Alert explains the follow-up
                state otherwise (the button never dead-ends silently). */}
            {googleReady ? (
              <ProviderButton
                label="المتابعة عبر Google"
                glyphNode={googleGlyph}
                tint={colors.google}
                onPress={() => {
                  Alert.alert(
                    "تسجيل الدخول عبر Google",
                    "تسجيل الدخول بجوجل يتطلب إعداد Firebase للتطبيق الأصلي — قريباً",
                  );
                }}
                accessibilityHint="يتطلب إعداد Firebase للتطبيق الأصلي"
              />
            ) : null}
          </View>
        )}

        {/* Provider-level transport errors (the Telegram auth session). */}
        {authError ? (
          <View
            accessibilityRole="alert"
            accessibilityLabel={authError}
            style={{
              backgroundColor: colors.surfaceOverlay,
              borderWidth: 1,
              borderColor: colors.error,
              borderRadius: radius.sm,
              borderCurve: "continuous",
              padding: spacing.md,
            }}
          >
            <ThemedText
              variant="caption"
              style={{ textAlign: "center", color: colors.error }}
              selectable
            >
              {authError}
            </ThemedText>
          </View>
        ) : null}
      </View>

      {/* Passwordless footnote — the register/login split on the web is
          one surface natively: the account is created on first sign-in. */}
      <ThemedText variant="footnote" style={{ textAlign: "center", color: colors.onSurface }}>
        الحساب الجديد يُنشأ تلقائياً عند أول تسجيل دخول — لا كلمة مرور في SubNation
      </ThemedText>
    </ScrollView>
  );
}
