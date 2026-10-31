import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolView } from "expo-symbols";

/**
 * Icon — the one cross-platform icon primitive (expo-native-ui skill):
 * SF Symbols on iOS, Material Icons on Android, one family per platform.
 * Every usage passes BOTH names; never ship SF-only iconography.
 */
export function Icon({
  sf,
  md,
  size = 24,
  color,
  weight = "medium",
}: {
  /** SF Symbol name (dot notation, e.g. "house.fill"). */
  sf: string;
  /** MaterialIcons glyph name (e.g. "home"). */
  md: keyof typeof MaterialIcons.glyphMap | string;
  size?: number;
  color: string;
  weight?:
    | "thin"
    | "ultraLight"
    | "light"
    | "regular"
    | "medium"
    | "semibold"
    | "bold"
    | "heavy"
    | "black";
}) {
  if (process.env.EXPO_OS === "ios") {
    return <SymbolView name={sf as never} size={size} tintColor={color} weight={weight} />;
  }
  return <MaterialIcons name={md as never} size={size} color={color} />;
}
