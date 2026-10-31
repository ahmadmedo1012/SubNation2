import { useEffect, useRef, useState, type ElementRef } from "react";
import { Alert, ScrollView, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  getGetSupportTicketQueryKey,
  getListSupportTicketsQueryKey,
  useGetSupportTicket,
  useReplySupportTicket,
  type SupportTicketDetail,
  type TicketReply,
} from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/states";
import { StatusBadge, ticketStatusBadge } from "@/components/status-badge";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { useColors, radius, spacing } from "@/theme";
import { formatRelativeTime, supportCategoryLabel } from "@/screens/account/dates";
import { SignInPrompt } from "@/screens/account/sign-in-prompt";

/**
 * Ticket thread — the native twin of the web's /support ticket detail:
 *   • the meta band (status badge + category chip + the #id/age stamp);
 *   • the replies timeline — the user's own voice vs «فريق الدعم»,
 *     relative timestamps on the Latin-digit locale;
 *   • the reply composer (useReplySupportTicket): double-submit guard,
 *     draft kept on failure and cleared only on success, the thread +
 *     inbox invalidated after a reply lands;
 *   • a closed ticket shows the terminal notice + the «تذكرة جديدة»
 *     CTA back to the support form (the web's onNewTicket path);
 *   • the four states; a 404 (foreign/stale id) renders a designed
 *     «التذكرة غير موجودة» — never a retry loop that cannot succeed.
 */
export function TicketThreadScreen({ id }: { id: number }) {
  const { status } = useAuth();

  if (status === "guest") {
    return <SignInPrompt message="سجّل دخولك لعرض محادثة هذه التذكرة والرد عليها." />;
  }
  return <TicketThreadContent id={id} />;
}

function TicketThreadContent({ id }: { id: number }) {
  const colors = useColors();

  const {
    data: ticket,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetSupportTicket(id, {
    query: { enabled: Number.isSafeInteger(id) && id > 0 },
  });

  // A 404 (unknown / foreign / stale id) is «التذكرة غير موجودة»,
  // never a connection error with an infinite retry loop.
  const status404 =
    isError && error && typeof error === "object" && "status" in error
      ? (error as { status?: number }).status === 404
      : false;

  if (isLoading) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      >
        <Skeleton style={{ height: 56, borderRadius: radius.md }} />
        <Skeleton
          style={{ height: 72, width: "70%", borderRadius: radius.lg, alignSelf: "flex-start" }}
        />
        <Skeleton
          style={{ height: 88, width: "80%", borderRadius: radius.lg, alignSelf: "flex-end" }}
        />
        <Skeleton
          style={{ height: 60, width: "60%", borderRadius: radius.lg, alignSelf: "flex-start" }}
        />
      </ScrollView>
    );
  }

  if (isError && !status404) {
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
          تعذّر تحميل التذكرة
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

  if (!ticket) {
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
          <Icon sf="message.slash" md="chat_bubble" size={28} color={colors.onSurface} />
        </View>
        <ThemedText variant="headline" style={{ textAlign: "center" }}>
          التذكرة غير موجودة
        </ThemedText>
        <ThemedText variant="subhead" style={{ textAlign: "center", color: colors.onSurface }}>
          تأكد من الرابط أو عُد لقائمة تذاكرك
        </ThemedText>
        <BackToTicketsButton />
      </View>
    );
  }

  return <TicketThreadBody ticket={ticket} />;
}

function TicketThreadBody({ ticket }: { ticket: SupportTicketDetail }) {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const scrollerRef = useRef<ElementRef<typeof ScrollView> | null>(null);

  const [replyText, setReplyText] = useState("");
  const replyMutation = useReplySupportTicket();
  const badge = ticketStatusBadge(ticket.status);
  const closed = ticket.status === "closed";

  // Land at the conversation's end when the thread changes (a new reply
  // is exactly when a scroll is wanted).
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollerRef.current?.scrollToEnd({ animated: false });
    }, 80);
    return () => clearTimeout(timer);
  }, [ticket.id, ticket.replies.length]);

  const handleReply = () => {
    const message = replyText.trim();
    if (!message || replyMutation.isPending) return;
    replyMutation.mutate(
      { id: ticket.id, data: { message } },
      {
        onSuccess: async () => {
          setReplyText("");
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: getGetSupportTicketQueryKey(ticket.id) }),
            queryClient.invalidateQueries({ queryKey: getListSupportTicketsQueryKey() }),
          ]);
        },
        onError: (err: unknown) => {
          // Draft stays — the failure must not eat the user's typing.
          Alert.alert("خطأ", getErrorMessage(err));
        },
      },
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        ref={scrollerRef}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md }}
      >
        {/* ── Meta band ────────────────────────────────────────────── */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            flexWrap: "wrap",
            backgroundColor: colors.surfaceCard,
            borderRadius: radius.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
          }}
        >
          <StatusBadge label={badge.label} tone={badge.tone} />
          <View
            style={{
              backgroundColor: colors.secondary,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.full,
              paddingHorizontal: spacing.sm,
              paddingVertical: 1,
            }}
          >
            <ThemedText variant="micro" style={{ color: colors.onSurface }}>
              {supportCategoryLabel(ticket.category)}
            </ThemedText>
          </View>
          <ThemedText
            variant="micro"
            style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
          >
            {`#${ticket.id} · ${formatRelativeTime(ticket.created_at)}`}
          </ThemedText>
        </View>

        {/* ── Replies timeline ─────────────────────────────────────── */}
        {ticket.replies.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: spacing.xl, gap: spacing.xs }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: colors.secondary,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon sf="message" md="chat_bubble_outline" size={20} color={colors.onSurface} />
            </View>
            <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
              لا توجد رسائل بعد
            </ThemedText>
            <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
              اكتب ردك أدناه لبدء المحادثة
            </ThemedText>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {ticket.replies.map((reply) => (
              <ReplyBubble key={reply.id} reply={reply} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Composer / closed notice ───────────────────────────────── */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: `${colors.border}66`,
          padding: spacing.lg,
          backgroundColor: colors.background,
        }}
      >
        {closed ? (
          <View style={{ alignItems: "center", gap: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon sf="checkmark.circle.fill" md="check_circle" size={14} color={colors.success} />
              <ThemedText
                variant="footnote"
                style={{ color: colors.onSurface, textAlign: "center", flex: 1 }}
              >
                التذكرة مغلقة — أنشئ تذكرة جديدة إذا احتجت مساعدة إضافية
              </ThemedText>
            </View>
            <Button
              title="تذكرة جديدة"
              variant="secondary"
              onPress={() =>
                router.navigate({
                  pathname: "/(tabs)/(account)/support",
                  params: { new: "1" },
                })
              }
              accessibilityHint="يعود لقائمة التذاكر ويفتح نموذج تذكرة جديدة"
            />
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <TextInput
              accessibilityLabel="نص الرد على التذكرة"
              value={replyText}
              onChangeText={setReplyText}
              placeholder="اكتب ردك هنا…"
              placeholderTextColor={colors.onSurface}
              maxLength={4000}
              multiline
              style={{
                minHeight: spacing.touch,
                maxHeight: 160,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                backgroundColor: colors.secondary,
                borderRadius: radius.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: colors.border,
                color: colors.foreground,
                fontFamily: "ReadexPro-Regular",
                fontSize: 17,
                textAlignVertical: "center",
              }}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              {replyMutation.isError ? (
                <ThemedText
                  variant="footnote"
                  style={{ color: colors.error, flex: 1 }}
                  accessibilityRole="alert"
                  selectable
                >
                  {getErrorMessage(replyMutation.error)}
                </ThemedText>
              ) : (
                <ThemedText variant="micro" style={{ color: colors.onSurface, flex: 1 }}>
                  ردك يصل فريق الدعم مباشرة داخل هذه التذكرة
                </ThemedText>
              )}
              <Button
                title="إرسال الرد"
                onPress={handleReply}
                loading={replyMutation.isPending}
                disabled={replyMutation.isPending || !replyText.trim()}
                accessibilityHint="يرسل الرد ويحدّث المحادثة"
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function ReplyBubble({ reply }: { reply: TicketReply }) {
  const colors = useColors();
  const isUser = reply.author_type === "user";

  return (
    <View style={{ alignSelf: isUser ? "flex-end" : "flex-start", maxWidth: "82%", gap: 2 }}>
      {!isUser ? (
        <ThemedText
          variant="micro"
          style={{ color: colors.primaryText, fontFamily: "ReadexPro-SemiBold" }}
        >
          فريق الدعم
        </ThemedText>
      ) : null}
      <View
        style={{
          backgroundColor: isUser ? colors.primary : colors.surfaceCard,
          borderWidth: isUser ? 0 : 1,
          borderColor: colors.border,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          borderBottomStartRadius: isUser ? radius.lg : radius.xs,
          borderBottomEndRadius: isUser ? radius.xs : radius.lg,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
        }}
      >
        <ThemedText
          variant="callout"
          selectable
          style={{ color: isUser ? colors.onTint : colors.foreground }}
        >
          {reply.message}
        </ThemedText>
      </View>
      <ThemedText
        variant="micro"
        style={{ color: colors.onSurface, alignSelf: isUser ? "flex-end" : "flex-start" }}
      >
        {formatRelativeTime(reply.created_at)}
      </ThemedText>
    </View>
  );
}

function BackToTicketsButton() {
  const router = useRouter();
  return (
    <Button
      title="كل تذاكري"
      variant="secondary"
      onPress={() => router.navigate("/(tabs)/(account)/support")}
    />
  );
}
