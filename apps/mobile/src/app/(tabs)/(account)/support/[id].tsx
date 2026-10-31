import { useLocalSearchParams } from "expo-router";

import { TicketThreadScreen } from "@/screens/support/ticket-thread-screen";

export default function TicketThreadRoute() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const raw = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  const id = Number.parseInt(raw, 10);
  return <TicketThreadScreen id={Number.isSafeInteger(id) && id > 0 ? id : 0} />;
}
