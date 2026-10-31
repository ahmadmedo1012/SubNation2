import { Stack } from "expo-router";

export default function WalletStack() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "المحفظة" }} />
    </Stack>
  );
}
