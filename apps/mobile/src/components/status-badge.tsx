import { View, type StyleProp, type ViewStyle } from "react-native";

import { useColors, radius, spacing } from "@/theme";
import { ThemedText } from "./themed-text";

/**
 * StatusBadge — status → (label, tint) for orders, topups, tickets.
 * Colors follow the web's status semantics (success/warning/error/info).
 */
export type BadgeTone = "success" | "warning" | "error" | "info" | "neutral" | "primary";

export function StatusBadge({
  label,
  tone = "neutral",
  style,
}: {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const tones: Record<BadgeTone, { fg: string; bg: string }> = {
    success: { fg: colors.success, bg: `${colors.success}1A` },
    warning: { fg: colors.warning, bg: `${colors.warning}1A` },
    error: { fg: colors.error, bg: `${colors.error}1A` },
    info: { fg: colors.info, bg: `${colors.info}1A` },
    neutral: { fg: colors.onSurface, bg: colors.secondary },
    primary: { fg: colors.primary, bg: `${colors.primary}1A` },
  };
  const t = tones[tone];
  return (
    <View
      style={[
        {
          backgroundColor: t.bg,
          borderRadius: radius.full,
          paddingHorizontal: spacing.sm,
          paddingVertical: 2,
          alignSelf: "flex-start",
        },
        style,
      ]}
      accessibilityLabel={label}
    >
      <ThemedText variant="micro" style={{ color: t.fg, fontFamily: "ReadexPro-SemiBold" }}>
        {label}
      </ThemedText>
    </View>
  );
}

/** Order status → label/tone (mirrors the web's statusLabel). */
export function orderStatusBadge(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case "completed":
      return { label: "مكتمل", tone: "success" };
    case "processing":
    case "pending":
      return { label: "قيد المعالجة", tone: "warning" };
    case "cancelled":
    case "refunded":
      return { label: status === "refunded" ? "مسترجع" : "ملغي", tone: "error" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/** Topup status → label/tone. */
export function topupStatusBadge(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case "approved":
      return { label: "معتمد", tone: "success" };
    case "pending":
      return { label: "قيد المراجعة", tone: "warning" };
    case "rejected":
      return { label: "مرفوض", tone: "error" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/** Ticket status → label/tone. */
export function ticketStatusBadge(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case "open":
      return { label: "مفتوح", tone: "info" };
    case "in_progress":
      return { label: "قيد المتابعة", tone: "warning" };
    case "closed":
      return { label: "مغلق", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}
