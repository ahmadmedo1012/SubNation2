import { Link } from "expo-router";
import { Text, View } from "react-native";

import { useColors, type } from "@/theme";

export default function NotFound() {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
      }}
    >
      <Text style={type.title}>الصفحة غير موجودة</Text>
      <Link href="/" style={{ color: colors.primary }}>
        <Text style={type.body}>العودة للرئيسية</Text>
      </Link>
    </View>
  );
}
