import { useMemo } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListSessionsQueryKey,
  useDeleteSession,
  useListSessions,
  type UserSession,
} from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { useColors, radius, spacing } from "@/theme";
import { formatFullDate } from "./dates";
import { SignInPrompt } from "./sign-in-prompt";

/**
 * Sessions — the native twin of the web's «الأجهزة النشطة» panel:
 *   • device rows from useListSessions — the backend's Arabic
 *     device label (describeDeviceInArabic), with a local UA parser as
 *     the fallback, the IP partially masked, and the created-at stamp;
 *   • «الجلسة الحالية» on the current row (the API's `current` flag;
 *     fallback: the newest row — the list is createdAt-DESC);
 *   • per-row revoke via the GENERATED useDeleteSession mutation
 *     (DELETE /api/auth/sessions/:id landed in the generated client
 *     this round — the temporary hand-written wrapper in
 *     @/lib/sessions-api is now a re-export shim) behind an
 *     Alert.alert confirm, with the list invalidated on success;
 *   • revoking the CURRENT session tears the local session down via
 *     signOut (the token is dead the moment the row is deleted);
 *   • the four states everywhere.
 */

export function SessionsScreen() {
  const { status } = useAuth();

  if (status === "guest") {
    return <SignInPrompt message="سجّل دخولك لعرض أجهزتك النشطة وإدارة جلسات تسجيل الدخول." />;
  }
  return <SessionsContent />;
}

function SessionsContent() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { signOut } = useAuth();

  const { data, isLoading, isError, error, refetch } = useListSessions();
  const deleteSession = useDeleteSession();

  const sessions = useMemo(() => data?.sessions ?? [], [data]);

  // The current row: the API's `current` flag when present, else the
  // newest row (the list is createdAt-DESC — the most recent login).
  const currentId = useMemo(() => {
    const flagged = sessions.find((s) => s.current === true);
    if (flagged?.id) return flagged.id;
    return sessions[0]?.id ?? null;
  }, [sessions]);

  const confirmRevoke = (session: UserSession) => {
    const device = session.device ?? friendlyDeviceLabel(session.user_agent);
    Alert.alert(
      "إلغاء الجلسة",
      `هل أنت متأكد من رغبتك في إنهاء جلسة «${device}»؟${
        session.id === currentId ? " ستحتاج لتسجيل الدخول مجدداً على هذا الجهاز." : ""
      }`,
      [
        { text: "إلغاء", style: "cancel" },
        {
          text: "إنهاء الجلسة",
          style: "destructive",
          onPress: () => void revoke(session),
        },
      ],
      { cancelable: true },
    );
  };

  const revoke = async (session: UserSession) => {
    if (!session.id || deleteSession.isPending) return;
    try {
      await deleteSession.mutateAsync({ id: session.id });
      if (session.id === currentId) {
        // The token just died server-side — tear the local session down
        // now instead of waiting for the next 401.
        await signOut();
        return;
      }
      await queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
    } catch (err: unknown) {
      Alert.alert("فشل إنهاء الجلسة", getErrorMessage(err));
    }
  };

  if (isLoading) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      >
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} style={{ height: 72, borderRadius: radius.md }} />
        ))}
      </ScrollView>
    );
  }

  if (isError && !data) {
    // An outage is never the «لا توجد جلسات نشطة» empty list.
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
          gap: spacing.md,
        }}
        accessibilityRole="alert"
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            backgroundColor: `${colors.error}1A`,
            borderWidth: 1,
            borderColor: `${colors.error}38`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon
            sf="wifi.exclamationmark"
            md="signal_wifi_connected_no_internet4"
            size={28}
            color={colors.error}
          />
        </View>
        <ThemedText variant="headline" style={{ textAlign: "center" }}>
          تعذّر تحميل الجلسات
        </ThemedText>
        <ThemedText
          variant="subhead"
          style={{ textAlign: "center", color: colors.onSurface }}
          selectable
        >
          {getErrorMessage(error)}
        </ThemedText>
        <Button title="إعادة المحاولة" variant="secondary" onPress={() => void refetch()} />
      </View>
    );
  }

  if (sessions.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xxl,
          gap: spacing.sm,
        }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            backgroundColor: colors.secondary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon sf="iphone.gen3" md="smartphone" size={28} color={colors.onSurface} />
        </View>
        <ThemedText variant="headline" style={{ textAlign: "center" }}>
          لا توجد جلسات نشطة
        </ThemedText>
        <ThemedText variant="subhead" style={{ textAlign: "center", color: colors.onSurface }}>
          لا توجد جلسات نشطة لعرضها.
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md }}
    >
      {/* Grouped rows with hairlines — the active-device roster. */}
      <View
        style={{
          backgroundColor: colors.surfaceCard,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        }}
      >
        {sessions.map((session, index) => (
          <SessionRow
            key={session.id ?? index}
            session={session}
            isCurrent={session.id !== undefined && session.id === currentId}
            revoking={deleteSession.isPending}
            first={index === 0}
            onRevoke={() => confirmRevoke(session)}
          />
        ))}
      </View>

      <ThemedText variant="micro" style={{ color: colors.onSurface, textAlign: "center" }}>
        يمكنك إنهاء أي جلسة من الجلسات النشطة أعلاه — لن يتأثر تسجيل دخولك على الأجهزة الأخرى.
      </ThemedText>
    </ScrollView>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

function SessionRow({
  session,
  isCurrent,
  revoking,
  first,
  onRevoke,
}: {
  session: UserSession;
  isCurrent: boolean;
  revoking: boolean;
  first: boolean;
  onRevoke: () => void;
}) {
  const colors = useColors();
  const device = session.device ?? friendlyDeviceLabel(session.user_agent);

  return (
    <View
      style={{
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: isCurrent ? `${colors.primary}0D` : "transparent",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        gap: spacing.xs,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            borderCurve: "continuous",
            backgroundColor: isCurrent ? `${colors.primary}1A` : colors.secondary,
            borderWidth: 1,
            borderColor: isCurrent ? `${colors.primary}33` : colors.border,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          accessibilityLabel={device}
        >
          <Icon
            sf="iphone.gen3"
            md="smartphone"
            size={16}
            color={isCurrent ? colors.primary : colors.onSurface}
          />
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <ThemedText
            variant="callout"
            style={{ fontFamily: "ReadexPro-SemiBold" }}
            numberOfLines={1}
          >
            {device}
          </ThemedText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              flexWrap: "wrap",
            }}
          >
            {session.ip ? (
              <ThemedText
                variant="micro"
                selectable
                style={{ color: colors.onSurface, direction: "ltr", fontVariant: ["tabular-nums"] }}
              >
                {maskIp(session.ip)}
              </ThemedText>
            ) : null}
            {session.created_at ? (
              <ThemedText variant="micro" style={{ color: colors.onSurface }}>
                {`سجّل ${formatFullDate(session.created_at)}`}
              </ThemedText>
            ) : null}
          </View>
        </View>

        <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
          {isCurrent ? (
            <View
              style={{
                backgroundColor: `${colors.primary}1A`,
                borderWidth: 1,
                borderColor: `${colors.primary}33`,
                borderRadius: radius.full,
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
              }}
            >
              <ThemedText
                variant="micro"
                style={{ color: colors.primary, fontFamily: "ReadexPro-SemiBold" }}
              >
                الجلسة الحالية
              </ThemedText>
            </View>
          ) : (
            <Button
              title="إنهاء الجلسة"
              variant="secondary"
              size="sm"
              loading={revoking}
              disabled={revoking}
              onPress={onRevoke}
              accessibilityHint="يطلب تأكيداً قبل إنهاء الجلسة"
            />
          )}
        </View>
      </View>
    </View>
  );
}

// ── Presentation helpers ────────────────────────────────────────────────────

/**
 * Friendly Arabic device label from the raw user-agent — the local
 * fallback twin of the backend's describeDeviceInArabic (the API's
 * `device` field is the primary source; this only covers a row whose
 * label the backend left empty).
 */
function friendlyDeviceLabel(ua: string | null | undefined): string {
  if (!ua) return "جهاز غير معروف";
  const s = ua.toLowerCase();

  let browser = "متصفح غير معروف";
  if (s.includes("edg/")) browser = "إيدج";
  else if (s.includes("opr/") || s.includes("opera")) browser = "أوبرا";
  else if (s.includes("samsungbrowser")) browser = "متصفح سامسونج";
  else if (s.includes("firefox")) browser = "فيرفكس";
  else if (s.includes("chrome") || s.includes("crios")) browser = "كروم";
  else if (s.includes("safari")) browser = "سفاري";

  let os = "جهاز غير معروف";
  if (s.includes("android")) os = "أندرويد";
  else if (s.includes("iphone") || s.includes("ipad") || s.includes("ios")) {
    os = s.includes("ipad") ? "آيباد" : "آيفون";
  } else if (s.includes("windows")) os = "ويندوز";
  else if (s.includes("mac os") || s.includes("macintosh")) os = "ماك";
  else if (s.includes("linux")) os = "لينكس";

  return `${browser} على ${os}`;
}

/**
 * Partially mask an IP address («197.1.•.•» / «2a01:4f8:•:•») — enough
 * to recognize a network, never enough to pin a device.
 */
export function maskIp(ip: string): string {
  if (ip.includes(".")) {
    const octets = ip.split(".");
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.•.•`;
    }
    return `${ip.slice(0, Math.max(1, Math.floor(ip.length / 2)))}•`;
  }
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean);
    if (groups.length >= 2) {
      return `${groups[0]}:${groups[1]}:•:•`;
    }
  }
  return "•";
}
