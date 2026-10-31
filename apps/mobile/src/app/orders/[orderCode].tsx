import { useLocalSearchParams } from "expo-router";

import { OrderDetailScreen } from "@/screens/orders/order-detail-screen";

/**
 * The web receipt URL alias (review R7-a P2-4).
 *
 * The app claims the WHOLE subnation.ly domain for App Links/Universal
 * Links (app.config.ts intentFilters pathPrefix "/", associatedDomains
 * applinks:subnation.ly) — so https://subnation.ly/orders/SNDB…, the
 * web's own order-receipt URL (sent in its notifications/emails), must
 * resolve in-app instead of falling to +not-found. The detail screen
 * itself lives at the ROOT /[orderCode] route ((tabs)/(orders)/
 * contributes no segments); this alias renders the same screen under
 * the web-shaped /orders/[code] path.
 */
export default function OrderWebAliasRoute() {
  const params = useLocalSearchParams<{ orderCode: string | string[] }>();
  const orderCode = Array.isArray(params.orderCode)
    ? (params.orderCode[0] ?? "")
    : (params.orderCode ?? "");
  return <OrderDetailScreen orderCode={orderCode} />;
}
