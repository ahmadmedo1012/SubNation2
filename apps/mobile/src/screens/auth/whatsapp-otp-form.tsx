import { Pressable, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { extractOtpDigits, normalizePhoneInput, useWhatsAppOtp } from "@/hooks/use-whatsapp-otp";
import { useColors, radius, spacing, type } from "@/theme";

import { ProviderButton } from "./provider-button";

/**
 * WhatsAppOtpForm — the native read of the web's WhatsAppPhoneSignIn
 * (frontend/src/components/auth/WhatsAppPhoneSignIn.tsx): the pristine
 * one-click button that expands into the two-step OTP form (phone →
 * 6-digit code). Every stateful/networked/timed step lives in
 * useWhatsAppOtp (the ported state machine); this file only renders it.
 *
 * Native deltas from the web shell (semantics preserved):
 *   • No clipboard-paste button — RN TextInputs paste natively and the
 *     onChangeText funnel runs the same extractOtpDigits normalizer
 *     (pasting the whole WhatsApp message extracts the code).
 *   • No maxLength on either input: a paste must arrive COMPLETE so the
 *     normalizers can strip +218 / 00218 prefixes (phone) and pull the
 *     first 6 digits out of arbitrary text (code).
 *   • The input + action stack vertically (input full-width, primary
 *     action full-width below) — the web's inline input+button row is
 *     too cramped for 44px targets on small phones.
 */

/** M:SS with Latin digits (5:00) — app-wide Latin-numeral convention. */
function formatMSS(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** A 44px-minimum quiet text action («تراجع» / «تغيير الرقم» / resend). */
function QuietAction({
  label,
  disabled = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={spacing.xs}
      style={({ pressed }) => ({
        minHeight: spacing.touch,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.md,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function WhatsAppOtpForm({
  /** Live gateway pairing status (whatsapp_status) — honest hints under the pristine button. */
  channelStatus,
  /** Called after the session mint + profile load; the host owns the routing. */
  onSuccess,
}: {
  channelStatus?: string | null;
  onSuccess?: () => void;
}) {
  const colors = useColors();
  const {
    phone,
    setPhone,
    code,
    setCode,
    step,
    setStep,
    loading,
    error,
    cooldown,
    settling,
    expiresAt,
    expiryLeft,
    settlingAuto,
    sendCode,
    verifyCode,
    resetFlow,
  } = useWhatsAppOtp({ onSuccess });

  const inputStyle = {
    backgroundColor: colors.surfaceOverlay,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderCurve: "continuous" as const,
    color: colors.foreground,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    minHeight: spacing.touch,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    // Phone number + OTP are Latin-digit fields — force LTR inside the
    // RTL-forced app (the web's dir="ltr" on both inputs).
    direction: "ltr" as const,
  };

  return (
    <View style={{ gap: spacing.md }} accessibilityLabel="تسجيل الدخول عبر واتساب">
      {step === "pristine" ? (
        // Pristine entry — the exact one-click register the other provider
        // buttons share (byte-identical resting style); the two-step OTP
        // form reveals only after the user opts in. The backend handles
        // new + returning users identically (findOrCreateWhatsAppUser).
        <View style={{ gap: spacing.sm }}>
          <ProviderButton
            label="المتابعة عبر WhatsApp"
            glyph={{ sf: "message.fill", md: "chat" }}
            tint={colors.whatsapp}
            onPress={() => setStep("phone")}
            accessibilityHint="يفتح نموذج رقم الهاتف لإرسال رمز التحقق"
          />
          {/* Honest channel hints (the web's r95/96-F2/97-F5 trio — never
              error-styled, never blocking the attempt). */}
          {channelStatus === "settling" ? (
            <ThemedText variant="caption" style={{ textAlign: "center", color: colors.onSurface }}>
              قناة WhatsApp ربطت للتو — تُهيَّأ الآن وتصبح جاهزة خلال أقل من دقيقة
            </ThemedText>
          ) : null}
          {channelStatus === "failed" ? (
            <ThemedText variant="caption" style={{ textAlign: "center", color: colors.onSurface }}>
              قناة WhatsApp غير مرتبطة حاليًا — جارٍ إصلاحها من فريق التشغيل؛ استخدم Google أو
              Telegram مؤقتًا
            </ThemedText>
          ) : null}
          {channelStatus &&
          channelStatus !== "ready" &&
          channelStatus !== "settling" &&
          channelStatus !== "failed" ? (
            <ThemedText variant="caption" style={{ textAlign: "center", color: colors.onSurface }}>
              قناة WhatsApp قيد الربط مؤقتاً — يمكنك المحاولة، أو استخدم Google / Telegram الآن
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {step === "phone" ? (
        <View style={{ gap: spacing.sm }}>
          <TextInput
            value={phone}
            onChangeText={(next) => setPhone(normalizePhoneInput(next))}
            placeholder="09XXXXXXXX"
            placeholderTextColor={colors.onSurface}
            accessibilityLabel="رقم الهاتف"
            textContentType="telephoneNumber"
            keyboardType="phone-pad"
            inputMode="tel"
            returnKeyType="done"
            autoCorrect={false}
            autoFocus
            textAlign="left"
            style={inputStyle}
          />
          <Button
            title={cooldown > 0 ? `إعادة الإرسال (${cooldown} ث)` : "إرسال الرمز"}
            onPress={() => {
              void sendCode();
            }}
            loading={loading}
            disabled={loading || settlingAuto || phone.length < 9 || cooldown > 0}
            accessibilityHint="يرسل رمز التحقق إلى رقم الهاتف عبر واتساب"
          />
          {/* The OTP-mechanism disclosure (the web's R139 line) — placed on
              the phone step, before the send commits the number. */}
          <ThemedText variant="caption" style={{ textAlign: "center", color: colors.onSurface }}>
            سيصلك رمز التحقق عبر WhatsApp
          </ThemedText>
          <ThemedText variant="micro" style={{ textAlign: "center", color: colors.onSurface }}>
            تُقبل أرقام ليبيانا ومدار التي تبدأ بـ 091 / 092 / 093 / 094.
          </ThemedText>
          <QuietAction label="تراجع" disabled={loading} onPress={resetFlow} />
        </View>
      ) : null}

      {step === "code" ? (
        <View style={{ gap: spacing.sm }}>
          <TextInput
            value={code}
            onChangeText={(next) => setCode(extractOtpDigits(next))}
            placeholder="رمز التحقق"
            placeholderTextColor={colors.onSurface}
            accessibilityLabel="رمز التحقق المكوّن من 6 أرقام"
            textContentType="oneTimeCode"
            keyboardType="number-pad"
            inputMode="numeric"
            returnKeyType="done"
            autoCorrect={false}
            autoFocus
            textAlign="center"
            // Latin-digit OTP tracking (the web's deliberate 0.2em on the
            // bare-digits field — the Arabic letter-spacing guard applies
            // to the type ramp, not this ltr Latin-digit input).
            style={[inputStyle, { letterSpacing: spacing.xs }]}
          />
          <Button
            title="تحقق"
            onPress={() => {
              void verifyCode();
            }}
            loading={loading}
            disabled={loading || code.length < 6}
            accessibilityHint="يتحقق من الرمز ويسجّل دخولك"
          />
          {/* OTP TTL (expires_at from /start) — subtle M:SS countdown. */}
          {expiresAt !== null ? (
            <ThemedText
              variant="micro"
              style={{ textAlign: "center", color: colors.onSurface }}
              accessibilityLiveRegion="polite"
            >
              {expiryLeft > 0
                ? `ينتهي خلال ${formatMSS(expiryLeft)}`
                : "انتهت صلاحية الرمز — استخدم «إعادة الإرسال» للحصول على رمز جديد"}
            </ThemedText>
          ) : null}
          {/* The missing-recovery path — re-sends to the SAME stored phone,
              honors the cooldown. */}
          <QuietAction
            label={
              cooldown > 0
                ? `لم يصلك الرمز؟ إعادة الإرسال (${cooldown} ث)`
                : "لم يصلك الرمز؟ إعادة الإرسال"
            }
            disabled={loading || settlingAuto || cooldown > 0}
            onPress={() => {
              void sendCode();
            }}
          />
          <QuietAction label="تغيير الرقم" disabled={loading} onPress={resetFlow} />
        </View>
      ) : null}

      {/* The settling banner — informational, never error-styled: honest
          wait copy while an auto-retry is pending, a manual retry CTA once
          the budget is spent. */}
      {settling && !error ? (
        <View
          accessibilityLabel="قناة واتساب قيد التهيئة"
          style={{
            backgroundColor: colors.secondary,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.sm,
            borderCurve: "continuous",
            padding: spacing.md,
          }}
        >
          <ThemedText variant="caption" style={{ textAlign: "center", color: colors.onSurface }}>
            {settling.autoPending
              ? settling.wake
                ? "خدمة WhatsApp تستيقظ من السكون الآن — ستُرسل الرمز تلقائيًا خلال لحظات"
                : "قناة WhatsApp ربطت للتو — تُهيَّأ الآن وستُرسل الرمز تلقائيًا خلال أقل من دقيقة"
              : settling.wake
                ? "ما زالت خدمة WhatsApp تستيقظ من السكون — أعد المحاولة أو استخدم Google / Telegram"
                : "ما زالت قناة WhatsApp قيد التهيئة — أعد المحاولة أو استخدم Google / Telegram"}
          </ThemedText>
        </View>
      ) : null}

      {error ? (
        <View
          accessibilityRole="alert"
          accessibilityLabel={error}
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
            {error}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}
