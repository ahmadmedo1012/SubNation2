import { Text, View } from "react-native";

import { useColors, type } from "@/theme";

export default function Placeholder() {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={type.subhead}>قيد الإنشاء</Text>
    </View>
  );
}
