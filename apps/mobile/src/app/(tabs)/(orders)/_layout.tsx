import { Stack } from "expo-router";

export default function OrdersStack() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "طلباتي" }} />
      <Stack.Screen name="[orderCode]" options={{ title: "تفاصيل الطلب" }} />
    </Stack>
  );
}
