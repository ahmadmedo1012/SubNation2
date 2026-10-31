import { Stack } from "expo-router";

import { CheckoutScreen } from "@/screens/checkout";

/**
 * Checkout — a root-stack screen above the tabs (the money funnel).
 * The title rides the Stack options (the root layout hides headers by
 * default; this screen opts back in so the native back affordance
 * escapes the funnel).
 */
export default function CheckoutRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "إتمام الطلب", headerShown: true }} />
      <CheckoutScreen />
    </>
  );
}
