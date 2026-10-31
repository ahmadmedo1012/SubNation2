import { useLocalSearchParams } from "expo-router";

import { OrderDetailScreen } from "@/screens/orders/order-detail-screen";

export default function OrderDetailRoute() {
  const params = useLocalSearchParams<{ orderCode: string | string[] }>();
  const orderCode = Array.isArray(params.orderCode)
    ? (params.orderCode[0] ?? "")
    : (params.orderCode ?? "");
  return <OrderDetailScreen orderCode={orderCode} />;
}
