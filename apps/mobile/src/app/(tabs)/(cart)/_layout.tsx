import { Stack } from "expo-router";

export default function CartStack() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "السلة" }} />
    </Stack>
  );
}
