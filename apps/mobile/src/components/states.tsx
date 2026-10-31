import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { SymbolView } from "expo-symbols";

import { useColors, spacing, radius } from "@/theme";
import { Button } from "./button";
import { ThemedText } from "./themed-text";

/**
 * The four screen states (expo-data-fetching skill): loading, error,
 * empty, content. Empty is a DESIGNED state (explain + next action),
 * errors offer retry, first-load shows skeletons/spinner — never flash
 * "empty" while the first fetch is resolving.
 */

export function LoadingState({ label = "جارٍ التحميل…" }: { label?: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.md,
        padding: spacing.xl,
      }}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <ActivityIndicator size="large" />
      <ThemedText variant="subhead">{label}</ThemedText>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.md,
        padding: spacing.xl,
      }}
      accessibilityRole="alert"
    >
      <SymbolView
        name={"wifi.exclamationmark" as never}
        size={40}
        tintColor="#ed5a5a"
        fallback={<View style={{ width: 40, height: 40 }} />}
      />
      <ThemedText variant="headline">حدث خطأ</ThemedText>
      <ThemedText variant="subhead" style={{ textAlign: "center" }} selectable>
        {message}
      </ThemedText>
      {onRetry ? <Button title="إعادة المحاولة" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({
  title,
  message,
  actionTitle,
  onAction,
  symbol = "tray",
}: {
  title: string;
  message?: string;
  actionTitle?: string;
  onAction?: () => void;
  symbol?: string;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        padding: spacing.xxl,
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
        <SymbolView
          name={symbol as never}
          size={28}
          tintColor={colors.onSurface}
          fallback={<View style={{ width: 28, height: 28 }} />}
        />
      </View>
      <ThemedText variant="headline" style={{ textAlign: "center" }}>
        {title}
      </ThemedText>
      {message ? (
        <ThemedText variant="subhead" style={{ textAlign: "center", color: colors.onSurface }}>
          {message}
        </ThemedText>
      ) : null}
      {actionTitle && onAction ? (
        <View style={{ marginTop: spacing.md }}>
          <Button title={actionTitle} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

/** Non-blocking inline refresh error (stale content stays visible). */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.sm,
        margin: spacing.md,
        padding: spacing.md,
        borderRadius: radius.sm,
        backgroundColor: colors.secondary,
        borderStartWidth: 3,
        borderStartColor: colors.error,
      }}
      accessibilityRole="alert"
    >
      <ThemedText variant="footnote" style={{ flex: 1 }} selectable>
        {message}
      </ThemedText>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
          <ThemedText variant="footnote" style={{ color: colors.primary }}>
            إعادة
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Skeleton block — shimmer-free neutral placeholder (reduced-motion safe). */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: colors.secondary,
          borderRadius: radius.sm,
          borderCurve: "continuous",
        },
        style,
      ]}
      accessibilityLabel="عنصر قيد التحميل"
    />
  );
}

/** Product-card-shaped loading grid. */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: spacing.md,
        padding: spacing.lg,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          style={{
            width: "47%",
            height: 200,
            borderRadius: radius.md,
            flexGrow: 1,
            flexBasis: "47%",
          }}
        />
      ))}
    </View>
  );
}
