import { FlatList, Pressable, TextInput, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { SORTS, type SortValue } from "@/constants";
import { radius, spacing, type, useColors } from "@/theme";

/**
 * The catalog's inline controls (home lane private): the live search field
 * and the filter-chip scroller (متوفر فقط toggle + the web's four sort
 * options). State stays with the parent — these are pure presentational
 * controls taking values + callbacks.
 */

export function CatalogSearchField({
  value,
  onChangeText,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: spacing.touch,
          backgroundColor: colors.secondary,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          borderCurve: "continuous",
          paddingHorizontal: spacing.lg,
        },
        style,
      ]}
    >
      <Icon sf="magnifyingglass" md="search" size={16} color={colors.onSurface} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="ابحث عن اشتراك…"
        placeholderTextColor={colors.onSurface}
        accessibilityLabel="البحث في المنتجات"
        inputMode="search"
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={{
          flex: 1,
          color: colors.foreground,
          fontFamily: type.subhead.fontFamily,
          fontSize: type.subhead.fontSize,
          paddingVertical: spacing.sm,
          textAlignVertical: "center",
        }}
      />
    </View>
  );
}

type ChipItem =
  | { kind: "available"; key: string }
  | { kind: "sort"; key: string; value: SortValue; label: string };

/**
 * The filter-chip scroller: the in-stock toggle (success-tinted when on)
 * followed by the sort options (the web's SORTS labels; the active one
 * reads as the tinted pill).
 */
export function CatalogFilterChips({
  availableOnly,
  onToggleAvailable,
  sort,
  onSelectSort,
  showAvailableToggle = true,
  style,
}: {
  availableOnly: boolean;
  onToggleAvailable: () => void;
  sort: SortValue;
  onSelectSort: (value: SortValue) => void;
  showAvailableToggle?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();

  const items: ChipItem[] = [
    ...(showAvailableToggle ? ([{ kind: "available", key: "available" }] as ChipItem[]) : []),
    ...SORTS.map((s): ChipItem => ({
      kind: "sort",
      key: `sort-${s.value}`,
      value: s.value,
      label: s.label,
    })),
  ];

  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(item) => item.key}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm, paddingEnd: spacing.lg }}
      style={[{ flexGrow: 0 }, style]}
      renderItem={({ item }) => {
        if (item.kind === "available") {
          return (
            <FilterChip
              label="متوفر فقط"
              active={availableOnly}
              accent={colors.success}
              icon={{ sf: "shippingbox", md: "inventory-2" }}
              accessibilityState={{ checked: availableOnly }}
              onPress={onToggleAvailable}
            />
          );
        }
        const active = item.value === sort;
        return (
          <FilterChip
            label={item.label}
            active={active}
            accent={colors.primary}
            accessibilityState={{ selected: active }}
            onPress={() => onSelectSort(item.value)}
          />
        );
      }}
    />
  );
}

function FilterChip({
  label,
  active,
  accent,
  icon,
  onPress,
  accessibilityState,
}: {
  label: string;
  active: boolean;
  accent: string;
  icon?: { sf: string; md: string };
  onPress: () => void;
  accessibilityState?: { checked?: boolean; selected?: boolean };
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
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
        borderColor: active ? `${accent}4D` : colors.border,
        backgroundColor: active ? `${accent}26` : colors.secondary,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {icon ? <Icon sf={icon.sf} md={icon.md} size={14} color={accent} /> : null}
      <ThemedText
        variant="footnote"
        style={{ fontFamily: "ReadexPro-SemiBold", color: active ? accent : colors.onSurface }}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}
