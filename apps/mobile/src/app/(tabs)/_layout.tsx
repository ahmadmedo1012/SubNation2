import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useColors } from "@/theme";

/**
 * The 5-tab native navigation — mirrors the web's own mobile bottom nav
 * (MobileNav.tsx): الرئيسية / المحفظة / طلباتي / السلة / حسابي.
 * NativeTabs renders the platform's real tab bar (liquid glass on iOS 26+,
 * Material 3 bottom navigation on Android).
 */
export default function TabsLayout() {
  const colors = useColors();
  return (
    <NativeTabs tintColor={colors.primary}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>الرئيسية</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(wallet)">
        <NativeTabs.Trigger.Icon sf="creditcard.fill" md="account_balance_wallet" />
        <NativeTabs.Trigger.Label>المحفظة</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(orders)">
        <NativeTabs.Trigger.Icon sf="doc.text.fill" md="receipt_long" />
        <NativeTabs.Trigger.Label>طلباتي</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(cart)">
        <NativeTabs.Trigger.Icon sf="cart.fill" md="shopping_cart" />
        <NativeTabs.Trigger.Label>السلة</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Icon sf="person.fill" md="person" />
        <NativeTabs.Trigger.Label>حسابي</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
