import { Stack } from "expo-router";

export default function AccountStack() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "حسابي" }} />
      <Stack.Screen name="loyalty" options={{ title: "نقاط الولاء" }} />
      <Stack.Screen name="referrals" options={{ title: "الإحالات" }} />
      <Stack.Screen name="notifications" options={{ title: "الإشعارات" }} />
      <Stack.Screen name="sessions" options={{ title: "الأجهزة والجلسات" }} />
      <Stack.Screen name="terms" options={{ title: "الشروط والخصوصية" }} />
      <Stack.Screen name="support/index" options={{ title: "الدعم الفني" }} />
      <Stack.Screen name="support/[id]" options={{ title: "التذكرة" }} />
    </Stack>
  );
}
