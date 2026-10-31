import { useLocalSearchParams } from "expo-router";

import { CategoryScreen } from "@/screens/home/category";

export default function CategoryRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CategoryScreen slug={typeof slug === "string" ? slug : ""} />;
}
