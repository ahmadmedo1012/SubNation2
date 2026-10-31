import { Stack } from "expo-router";

export default function HomeStack() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "SubNation" }} />
      <Stack.Screen name="search" options={{ title: "البحث" }} />
      <Stack.Screen name="category/[slug]" options={{ title: "التصنيف" }} />
      <Stack.Screen name="product/[slug]" options={{ title: "المنتج" }} />
    </Stack>
  );
}
