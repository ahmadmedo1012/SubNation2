import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  createSupportTicket,
  useListSupportTickets,
  type CreateSupportTicketBodyCategory,
  type SupportTicketSummary,
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
import { SUPPORT_FAQ } from "./support-faq";

/**
 * Support — the native twin of the web's /support page:
 *   • the FAQ accordion (SUPPORT_FAQ — the same verbatim canon the web
 *     renders) stays PUBLIC, exactly like the web;
 *   • the ticket surface (create form + inbox) is auth-gated — a guest
 *     gets the styled sign-in CTA panel above the FAQ, not a crash;
 *   • the open-ticket form: category pills from the GENERATED
 *     CreateSupportTicketBody enum (billing / order / technical /
 *     account / other), subject+message validation, double-submit
 *     guard, draft kept on failure and cleared only on success;
 *   • the tickets list (ticketStatusBadge + the last-reply preview) →
 *     the stack-pushed thread screen;
 *   • the four states everywhere.
 */

/** Category pills — the generated CreateSupportTicketBody enum, in the
 * web CATEGORIES order, with the web's Arabic labels. */
const CATEGORIES: { value: CreateSupportTicketBodyCategory; icon: { sf: string; md: string } }[] = [
  { value: "billing", icon: { sf: "creditcard.fill", md: "credit-card" } },
  { value: "order", icon: { sf: "shippingbox.fill", md: "inventory-2" } },
  { value: "technical", icon: { sf: "wrench.fill", md: "build" } },
  { value: "account", icon: { sf: "person.fill", md: "person" } },
  { value: "other", icon: { sf: "message.fill", md: "chat-bubble-outline" } },
];

interface TicketFormState {
  title: string;
  message: string;
  category: CreateSupportTicketBodyCategory;
}

const EMPTY_FORM: TicketFormState = { title: "", message: "", category: "other" };

export function SupportScreen() {
  const colors = useColors();
  const { status } = useAuth();
  const isAuthenticated = status === "authenticated";

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg }}
    >
      <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
        نرد عادةً خلال 15 دقيقة إلى ساعة في أوقات العمل — التذاكر خارجها تُعالَج أول النهار
      </ThemedText>

      {isAuthenticated ? <TicketsSurface /> : <GuestTicketsPanel />}

      {/* The FAQ stays public (web parity — the Q&A canon is pre-login
          content; only the ticket inbox is auth-gated). */}
      <FaqSection />
    </ScrollView>
  );
}

// ── Authed surface: create form + inbox ─────────────────────────────────────

function TicketsSurface() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string }>();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<TicketFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // The closed-ticket CTA on the thread screen deep-links back here
  // with ?new=1 — open the create form once, then clear the param.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (params.new === "1" && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setShowCreate(true);
      router.setParams({ new: undefined });
    }
  }, [params.new, router]);

  const { data: tickets, isLoading, isError, error, refetch } = useListSupportTickets();

  const openCount = useMemo(
    () => (tickets ?? []).filter((t) => t.status === "open").length,
    [tickets],
  );

  const closeCreateForm = () => {
    setShowCreate(false);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async () => {
    // Double-submit guard — the CTA disables, but a same-frame
    // double-fire must not reach the POST twice.
    if (submitting) return;
    if (!form.title.trim() || !form.message.trim()) {
      Alert.alert("بيانات ناقصة", "أدخل العنوان والرسالة");
      return;
    }
    setSubmitting(true);
    try {
      await createSupportTicket({
        title: form.title,
        message: form.message,
        category: form.category,
      });
      Alert.alert("تم إنشاء التذكرة", "سيرد فريق الدعم قريباً");
      setForm(EMPTY_FORM);
      setShowCreate(false);
      // The inbox's newest row is this ticket — pull it in.
      void refetch();
    } catch (err: unknown) {
      // Draft stays — the failure must not eat the user's typing.
      Alert.alert("خطأ", getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1 }}>
          <ThemedText variant="headline">تذاكري</ThemedText>
          {openCount > 0 ? (
            <View
              style={{
                backgroundColor: `${colors.info}1A`,
                borderWidth: 1,
                borderColor: `${colors.info}33`,
                borderRadius: radius.full,
                paddingHorizontal: spacing.sm,
                paddingVertical: 1,
              }}
            >
              <ThemedText
                variant="micro"
                style={{
                  color: colors.info,
                  fontFamily: "ReadexPro-SemiBold",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {openCount}
              </ThemedText>
            </View>
          ) : null}
        </View>
        {!showCreate ? (
          <Button
            title="تذكرة جديدة"
            size="sm"
            onPress={() => setShowCreate(true)}
            accessibilityHint="يفتح نموذج تذكرة دعم جديدة"
          />
        ) : (
          <Button title="إغلاق النموذج" variant="ghost" size="sm" onPress={closeCreateForm} />
        )}
      </View>

      {showCreate ? (
        <CreateTicketForm
          form={form}
          onChange={setForm}
          submitting={submitting}
          onSubmit={() => void handleSubmit()}
          onCancel={closeCreateForm}
        />
      ) : null}

      {isLoading ? (
        <View style={{ gap: spacing.md }}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} style={{ height: 88, borderRadius: radius.md }} />
          ))}
        </View>
      ) : isError && !tickets ? (
        // An outage is never «لا توجد تذاكر دعم».
        <InlineErrorCard
          message={getErrorMessage(error)}
          onRetry={() => void refetch()}
          title="تعذّر تحميل التذاكر"
        />
      ) : !tickets || tickets.length === 0 ? (
        <EmptyTicketsCard onNewTicket={() => setShowCreate(true)} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {tickets.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Create-ticket form ──────────────────────────────────────────────────────

function CreateTicketForm({
  form,
  onChange,
  submitting,
  onSubmit,
  onCancel,
}: {
  form: TicketFormState;
  onChange: (form: TicketFormState) => void;
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const colors = useColors();

  return (
    <View style={cardStyle(colors)}>
      <ThemedText variant="headline">تذكرة دعم جديدة</ThemedText>

      {/* Category pills */}
      <View>
        <ThemedText
          variant="micro"
          style={{
            color: colors.onSurface,
            fontFamily: "ReadexPro-SemiBold",
            marginBottom: spacing.sm,
          }}
        >
          الفئة
        </ThemedText>
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}
          accessibilityLabel="تصنيف التذكرة"
        >
          {CATEGORIES.map((c) => {
            const selected = form.category === c.value;
            return (
              <Pressable
                key={c.value}
                accessibilityRole="button"
                accessibilityLabel={supportCategoryLabel(c.value)}
                accessibilityState={{ selected }}
                onPress={() => onChange({ ...form, category: c.value })}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs,
                  minHeight: 36,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.md,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: selected ? `${colors.primary}4D` : colors.border,
                  backgroundColor: selected
                    ? `${colors.primary}1A`
                    : pressed
                      ? colors.secondary
                      : "transparent",
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Icon
                  sf={c.icon.sf}
                  md={c.icon.md}
                  size={13}
                  color={selected ? colors.primary : colors.onSurface}
                />
                <ThemedText
                  variant="footnote"
                  style={{
                    color: selected ? colors.primary : colors.foreground,
                    fontFamily: selected ? "ReadexPro-SemiBold" : "ReadexPro-Regular",
                  }}
                >
                  {supportCategoryLabel(c.value)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Subject */}
      <View style={{ gap: spacing.xs }}>
        <ThemedText
          variant="micro"
          style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
        >
          عنوان المشكلة *
        </ThemedText>
        <TextInput
          accessibilityLabel="عنوان المشكلة"
          value={form.title}
          onChangeText={(title) => onChange({ ...form, title })}
          placeholder="وصف مختصر للمشكلة…"
          placeholderTextColor={colors.onSurface}
          maxLength={255}
          style={inputStyle(colors)}
        />
      </View>

      {/* Message */}
      <View style={{ gap: spacing.xs }}>
        <ThemedText
          variant="micro"
          style={{ color: colors.onSurface, fontFamily: "ReadexPro-SemiBold" }}
        >
          تفاصيل المشكلة *
        </ThemedText>
        <TextInput
          accessibilityLabel="تفاصيل المشكلة"
          value={form.message}
          onChangeText={(message) => onChange({ ...form, message })}
          placeholder="اشرح المشكلة بالتفصيل لنتمكن من مساعدتك بشكل أسرع…"
          placeholderTextColor={colors.onSurface}
          maxLength={4000}
          multiline
          style={[inputStyle(colors), { minHeight: 104, textAlignVertical: "top" }]}
        />
      </View>

      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <Button
          title="إلغاء"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={onCancel}
          disabled={submitting}
        />
        <Button
          title={submitting ? "جارٍ الإرسال…" : "إرسال التذكرة"}
          style={{ flex: 1 }}
          onPress={onSubmit}
          loading={submitting}
          disabled={submitting}
        />
      </View>
    </View>
  );
}

// ── Ticket rows ─────────────────────────────────────────────────────────────

function TicketRow({ ticket }: { ticket: SupportTicketSummary }) {
  const colors = useColors();
  const router = useRouter();
  const badge = ticketStatusBadge(ticket.status);
  const hasAdminReply = ticket.last_reply?.author_type === "admin";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`تذكرة ${ticket.title}`}
      accessibilityHint="يفتح محادثة التذكرة"
      onPress={() => router.push(`/(tabs)/(account)/support/${ticket.id}`)}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceOverlay : colors.surfaceCard,
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: colors.border,
        borderStartWidth: 3,
        borderStartColor:
          ticket.status === "open"
            ? `${colors.info}8C`
            : ticket.status === "in_progress"
              ? `${colors.warning}8C`
              : colors.border,
        padding: spacing.lg,
        gap: spacing.sm,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <ThemedText
          variant="subhead"
          numberOfLines={1}
          style={{ flex: 1, fontFamily: "ReadexPro-SemiBold" }}
        >
          {ticket.title}
        </ThemedText>
        <StatusBadge label={badge.label} tone={badge.tone} />
      </View>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}
      >
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
        <ThemedText variant="micro" style={{ color: colors.onSurface }}>
          {formatRelativeTime(ticket.created_at)}
        </ThemedText>
      </View>
      {ticket.last_reply ? (
        <View
          style={{
            backgroundColor: hasAdminReply ? `${colors.primary}12` : colors.secondary,
            borderRadius: radius.sm,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: hasAdminReply ? `${colors.primary}26` : colors.border,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
          }}
        >
          <ThemedText variant="footnote" numberOfLines={1} style={{ color: colors.onSurface }}>
            <ThemedText
              variant="footnote"
              style={{
                color: hasAdminReply ? colors.primaryText : colors.onSurface,
                fontFamily: "ReadexPro-SemiBold",
              }}
            >
              {hasAdminReply ? "فريق الدعم:" : "أنت:"}
            </ThemedText>{" "}
            {ticket.last_reply.message}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

function EmptyTicketsCard({ onNewTicket }: { onNewTicket: () => void }) {
  const colors = useColors();
  return (
    <View
      style={[cardStyle(colors), { alignItems: "center", padding: spacing.xl, gap: spacing.sm }]}
    >
      <View
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
        }}
      >
        <Icon sf="headphones" md="headset_mic" size={24} color={colors.onSurface} />
      </View>
      <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
        لا توجد تذاكر دعم
      </ThemedText>
      <ThemedText variant="footnote" style={{ color: colors.onSurface, textAlign: "center" }}>
        أنشئ تذكرة جديدة — نرد عادةً خلال 15 دقيقة إلى ساعة في أوقات العمل
      </ThemedText>
      <Button title="تذكرة جديدة" onPress={onNewTicket} />
    </View>
  );
}

// ── Guest panel (the ticket surface's gate — the FAQ below stays public) ────

function GuestTicketsPanel() {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={[cardStyle(colors), { alignItems: "center", gap: spacing.sm }]}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: `${colors.primary}1A`,
          borderWidth: 1,
          borderColor: `${colors.primary}33`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon sf="message.fill" md="chat-bubble-outline" size={24} color={colors.primary} />
      </View>
      <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
        تحتاج مساعدة شخصية؟
      </ThemedText>
      <ThemedText variant="footnote" style={{ color: colors.onSurface, textAlign: "center" }}>
        سجّل الدخول لفتح تذكرة دعم ومتابعة الرد من هذه الشاشة
      </ThemedText>
      <Button
        title="سجّل الدخول لفتح تذكرة"
        onPress={() => router.push("/login")}
        accessibilityHint="يفتح شاشة تسجيل الدخول"
      />
    </View>
  );
}

// ── FAQ ─────────────────────────────────────────────────────────────────────

function FaqSection() {
  const colors = useColors();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <View style={{ gap: spacing.md }}>
      <View>
        <ThemedText variant="headline">الأسئلة الشائعة</ThemedText>
        <ThemedText variant="footnote" style={{ color: colors.onSurface, marginTop: 2 }}>
          الأسئلة التي يطرحها المستخدمون قبل أول عملية شراء — اضغط على أي سؤال لرؤية الإجابة.
        </ThemedText>
      </View>
      <View style={{ gap: spacing.sm }}>
        {SUPPORT_FAQ.map((item, index) => {
          const open = openIndex === index;
          return (
            <View
              key={index}
              style={{
                backgroundColor: colors.surfaceCard,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                borderCurve: "continuous",
                overflow: "hidden",
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.question}
                accessibilityState={{ expanded: open }}
                onPress={() => setOpenIndex(open ? null : index)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  paddingHorizontal: spacing.lg,
                  minHeight: spacing.touch,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <ThemedText variant="subhead" style={{ flex: 1, fontFamily: "ReadexPro-SemiBold" }}>
                  {item.question}
                </ThemedText>
                <Icon
                  sf={open ? "chevron.up" : "chevron.down"}
                  md={open ? "expand-less" : "expand-more"}
                  size={16}
                  color={colors.onSurface}
                />
              </Pressable>
              {open ? (
                <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
                  <ThemedText variant="callout" style={{ color: colors.onSurface }} selectable>
                    {item.answer}
                  </ThemedText>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Shared shells ───────────────────────────────────────────────────────────

function cardStyle(colors: ReturnType<typeof useColors>) {
  return {
    backgroundColor: colors.surfaceCard,
    borderRadius: radius.lg,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  };
}

function inputStyle(colors: ReturnType<typeof useColors>) {
  return {
    minHeight: spacing.touch as number,
    paddingHorizontal: spacing.md as number,
    paddingVertical: spacing.sm as number,
    backgroundColor: colors.secondary,
    borderRadius: radius.md,
    borderCurve: "continuous" as const,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.foreground,
    fontFamily: "ReadexPro-Regular",
    fontSize: 17,
  };
}

function InlineErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={[cardStyle(colors), { alignItems: "center", gap: spacing.sm }]}
      accessibilityRole="alert"
    >
      <Icon
        sf="wifi.exclamationmark"
        md="signal_wifi_connected_no_internet4"
        size={24}
        color={colors.error}
      />
      <ThemedText variant="subhead" style={{ fontFamily: "ReadexPro-SemiBold" }}>
        {title}
      </ThemedText>
      <ThemedText
        variant="footnote"
        style={{ color: colors.onSurface, textAlign: "center" }}
        selectable
      >
        {message}
      </ThemedText>
      <Button title="إعادة المحاولة" variant="secondary" onPress={onRetry} />
    </View>
  );
}
