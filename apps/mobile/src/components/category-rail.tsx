import { FlatList, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";

import { Icon } from "./icon";
import { ThemedText } from "./themed-text";
import { CATEGORIES, type CategoryMeta } from "@/constants";
import { radius, spacing, useColors } from "@/theme";

/**
 * CategoryRail — the horizontal category-chips row (the native twin of the
 * web's filter-bar chips + CategoryRail navigation contract): the 7 live
 * categories, each linking to its /category/[slug] landing screen, plus a
 * leading «الكل» reset chip. The active chip (matching `activeSlug`) reads
 * as the calm tinted pill — the web's active-chip vocabulary.
 */
export function CategoryRail({
  activeSlug = null,
  onAllPress,
  style,
}: {
  /** The currently-active category slug (null → «الكل» is active). */
  activeSlug?: string | null;
  /** «الكل» chip action — resets the catalog filters in place. */
  onAllPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const router = useRouter();
  const all = activeSlug == null;

  const chip = (
    label: string,
    accent: string | null,
    active: boolean,
    onPress: () => void,
    icon?: CategoryMeta,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.lg,
        minHeight: spacing.touch - spacing.sm,
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: active ? (accent ? `${accent}4D` : `${colors.primary}4D`) : colors.border,
        backgroundColor: active
          ? accent
            ? `${accent}26`
            : `${colors.primary}26`
          : colors.secondary,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {icon ? (
        <Icon sf={icon.sf} md={icon.md} size={14} color={accent ?? colors.foreground} />
      ) : null}
      <ThemedText
        variant="footnote"
        style={{
          fontFamily: "ReadexPro-SemiBold",
          color: active ? (accent ?? colors.primaryText) : colors.onSurface,
        }}
      >
        {label}
      </ThemedText>
    </Pressable>
  );

  return (
    <FlatList
      horizontal
      data={CATEGORIES}
      keyExtractor={(item) => item.slug}
      showsHorizontalScrollIndicator={false}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
      style={[{ flexGrow: 0 }, style]}
      ListHeaderComponent={
        onAllPress ? <View>{chip("الكل", null, all, onAllPress)}</View> : undefined
      }
      renderItem={({ item }) => {
        const active = item.slug === activeSlug;
        const accent = colors[item.colorKey];
        return (
          <View>
            {chip(item.label, accent, active, () => router.push(`/category/${item.slug}`), item)}
          </View>
        );
      }}
      accessibilityLabel="تصفّح حسب الفئة"
    />
  );
}
