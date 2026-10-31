import { useEffect } from "react";
import { View } from "react-native";
import { useNavigation, useRouter } from "expo-router";

import { EmptyState } from "@/components/states";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { categoryMeta } from "@/constants";
import { radius, spacing, useColors } from "@/theme";

import { CatalogScreen } from "./catalog-screen";

/**
 * CategoryScreen — the /category/[slug] landing (web category.tsx twin):
 * the tinted category hero (icon tile + label + accent stripe), then the
 * catalog engine scoped to the category with the sort control and the
 * same four states. Unknown slugs get the designed not-found state.
 */
export function CategoryScreen({ slug }: { slug: string }) {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation<{ setOptions: (options: { title?: string }) => void }>();
  const meta = categoryMeta(slug);

  // Stack header carries the category label (titles via Stack options only).
  useEffect(() => {
    if (meta) navigation.setOptions({ title: meta.label });
  }, [meta, navigation]);

  if (!meta) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState
          title="الفئة غير موجودة"
          message="الفئة المطلوبة غير معروفة. يمكنك تصفّح كل المنتجات من الصفحة الرئيسية."
          actionTitle="العودة للرئيسية"
          onAction={() => router.push("/(tabs)/(home)")}
          symbol="tray"
        />
      </View>
    );
  }

  const accent = colors[meta.colorKey];

  return (
    <CatalogScreen
      category={meta.slug}
      headerTop={() => (
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.xs,
            gap: spacing.sm,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View
              style={{
                width: spacing.touch,
                height: spacing.touch,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${accent}1A`,
                borderWidth: 1,
                borderColor: `${accent}4D`,
                borderRadius: radius.md,
                borderCurve: "continuous",
              }}
              accessibilityLabel={meta.label}
            >
              <Icon sf={meta.sf} md={meta.md} size={22} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText variant="title">{meta.label}</ThemedText>
            </View>
          </View>
          <View
            accessibilityLabel={`فئة ${meta.label}`}
            style={{
              height: 2,
              backgroundColor: accent,
              opacity: 0.65,
              borderRadius: radius.full,
            }}
          />
        </View>
      )}
      titleFor={() => `اشتراكات ${meta.label}`}
    />
  );
}
