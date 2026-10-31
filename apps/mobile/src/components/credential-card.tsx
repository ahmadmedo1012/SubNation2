import { useCallback, useState, type ReactNode } from "react";
import { Pressable, Share, View, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "./icon";
import { ThemedText } from "./themed-text";
import { useColors, radius, spacing } from "@/theme";

/**
 * CredentialCard — one delivered-credential row (email / password / extra
 * details) on the order-detail receipt.
 *
 * Clipboard limitation (documented, sanctioned): React Native core ships
 * no clipboard API and expo-clipboard is NOT installed in this project,
 * so the copy affordances are (1) `selectable` Text — the platform's
 * native long-press selection menu carries the copy action — and (2) the
 * core Share API (`Share.share({ message })`) for handing the value to
 * any installed target. When a clipboard module lands, a copy button can
 * join these two without touching the masking logic.
 *
 * Security contract: values are masked by default («••••••••»), revealed
 * only behind an explicit eye toggle, and NEVER placed in accessibility
 * labels, testIDs or logs — the label alone is announced.
 */

const MASK = "••••••••";

export function CredentialCard({
  label,
  value,
  secret = false,
  multiline = false,
  style,
}: {
  label: string;
  value: string;
  /** Mask until the user explicitly reveals (passwords). */
  secret?: boolean;
  /** Free-text delivery details: wrap instead of truncating. */
  multiline?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const [revealed, setRevealed] = useState(false);

  const share = useCallback(() => {
    Share.share({ message: value }).catch(() => {
      // A dismissed share sheet (or a platform without targets) is a
      // no-op, never an error surface for the buyer.
    });
  }, [value]);

  const showValue = !secret || revealed;

  return (
    <View style={[{ gap: spacing.xs }, style]}>
      <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
        {label}
      </ThemedText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: colors.secondary,
            borderRadius: radius.sm,
            borderCurve: "continuous",
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            minHeight: spacing.touch,
            justifyContent: "center",
          }}
        >
          <ThemedText
            variant="callout"
            selectable
            style={{
              direction: "ltr",
              textAlign: "left",
              fontVariant: ["tabular-nums"],
            }}
            numberOfLines={multiline ? undefined : 1}
          >
            {showValue ? value : MASK}
          </ThemedText>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.xs }}>
          {secret ? (
            <IconPressable
              accessibilityLabel={revealed ? `إخفاء ${label}` : `إظهار ${label}`}
              onPress={() => setRevealed((v) => !v)}
              sf={revealed ? "eye.slash.fill" : "eye.fill"}
              md={revealed ? "visibility-off" : "visibility"}
            />
          ) : null}
          <IconPressable
            accessibilityLabel={`مشاركة ${label}`}
            onPress={share}
            sf="square.and.arrow.up"
            md="share"
          />
        </View>
      </View>
    </View>
  );
}

function IconPressable({
  accessibilityLabel,
  onPress,
  sf,
  md,
  children,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  sf: string;
  md: string;
  children?: ReactNode;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: spacing.touch,
        height: spacing.touch,
        borderRadius: radius.sm,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.surfaceOverlay : "transparent",
      })}
    >
      <Icon sf={sf} md={md} size={20} color={colors.onSurface} />
      {children}
    </Pressable>
  );
}
