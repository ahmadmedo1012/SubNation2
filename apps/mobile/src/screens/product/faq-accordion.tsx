import { useState } from "react";
import { Pressable, View } from "react-native";
import type { ProductFaqItem } from "@workspace/api-client-native";

import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { radius, spacing, useColors } from "@/theme";

/**
 * FaqAccordion — the PDP's curated FAQ (web FaqAccordion twin): simple
 * expandable rows, no library, one row open at a time.
 */
export function FaqAccordion({ faqs }: { faqs: ProductFaqItem[] }) {
  const colors = useColors();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <View style={{ gap: spacing.sm }} accessibilityLabel="الأسئلة الشائعة">
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <ThemedText variant="headline">الأسئلة الشائعة</ThemedText>
        <ThemedText
          variant="footnote"
          style={{ color: colors.onSurface, fontVariant: ["tabular-nums"] }}
        >
          {faqs.length}
        </ThemedText>
      </View>

      {faqs.map((faq, index) => {
        const open = openIndex === index;
        return (
          <View
            key={index}
            style={{
              backgroundColor: colors.secondary,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              borderCurve: "continuous",
              overflow: "hidden",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={faq.question}
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
                {faq.question}
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
                  {faq.answer}
                </ThemedText>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
