import {
  getGetMeQueryKey,
  getGetWalletLedgerQueryKey,
  getGetWalletQueryKey,
  getListTopupsQueryKey,
} from "@workspace/api-client-react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * R127-B6-2/B6-3 (B6 sockets audit) — the shared socket-resync
 * invalidation sets, ONE definition per session family.
 *
 * Both "something changed while this tab wasn't listening" paths
 * converged on the same two key-sets, previously duplicated (and
 * half-orphaned) across three call sites:
 *
 *   - `SOCKET_RESYNC_EVENT` (lib/socket.ts fires it exactly once per
 *     documented disconnect → reconnect cycle): SessionActivityManager
 *     answers it for the storefront money families, SocketInitializer
 *     for the admin families (R127-B6-3 restored the storefront
 *     consumer — the R104 page-scoped split had orphaned it, leaving
 *     the money screens (wallet.tsx / order-detail.tsx, both poll-less)
 *     stale through an active-tab WiFi↔cellular blip while the
 *     lib/socket.ts docblock still promised the invalidation).
 *
 *   - visibilitychange(visible) resync in SessionActivityManager
 *     (covers deliberate socket PARKS — reason "io client disconnect"
 *     never arms the resync flag): R127-B6-2 added the admin families
 *     there — tickets + risk-event lists have NO polling fallback
 *     (refetchOnWindowFocus off app-wide), so an operator's parked
 *     console previously stayed stale indefinitely on those queues
 *     while the 300 s pages self-healed.
 *
 *   - `admin-stats-update` pushes in SocketInitializer share the admin
 *     set (single source — a key added here lands in every path at
 *     once; that is exactly how the products key stayed missing from
 *     the push handler while products.tsx claimed coverage — R127-B6-6).
 */

/**
 * The STOREFRONT transactional families — the money-screen recovery set:
 * the families use-socket.ts invalidates on live topup events (topups /
 * wallet / me / ledger — R-140-o aligned the two halves on the same
 * money surfaces), plus the orders sweep its order-updated handler owns:
 *   - orders list + every open order-detail (predicate sweep — the
 *     detail key is [`/api/orders/${orderCode}`]);
 *   - wallet balance ([ "/api/wallet" ]);
 *   - wallet topups ([ "/api/wallet/topups" ]);
 *   - wallet statement ([ "/api/wallet/ledger" ]) — R-140-o: the §4
 *     explainability surface ("every LYD movement") is rendered by
 *     wallet.tsx from this family; a resync that refreshed the balance
 *     but not the statement left the money screen contradicting its
 *     own totals through the same blip the set exists for;
 *   - current user ([ "/api/auth/me" ]).
 *
 * Catalog/product queries are deliberately NOT part of this set (same
 * anti-refetch-storm policy as the QueryClient defaults in App.tsx).
 */
export function invalidateStorefrontTransactionalFamilies(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const first = query.queryKey[0];
      return typeof first === "string" && first.startsWith("/api/orders");
    },
  });
  void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
  void queryClient.invalidateQueries({ queryKey: getListTopupsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: getGetWalletLedgerQueryKey() });
  void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  // R153: the paged notifications-history family — the /notifications
  // page holds no socket of its own, so a reconnect previously left its
  // rows stale until a remount (the bell recovered, the page did not).
  void queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  // R187 (B-F3): the loyalty family — loyalty.tsx/referrals.tsx ride the
  // shared ["loyalty", …] keys (R120-B5) and hold no socket of their
  // own either; referral credits, refund point reversals and purchase
  // awards had no client-side invalidation on this path. Same rationale
  // as the notifications entry above (the R153 "page holds no socket of
  // its own" precedent).
  void queryClient.invalidateQueries({ queryKey: ["loyalty"] });
}

/**
 * The ADMIN realtime families — the key-set every admin-stats-update
 * push, the admin SOCKET_RESYNC_EVENT answer and (R127-B6-2) the
 * visibility-return resync share. Prefix-invalidations cover every
 * params variant of each list (dashboard's {limit:8} recent orders,
 * orders' {}, users' {search} variants, tickets' {status} variants,
 * products' list params…).
 *
 *   - "/api/admin/stats"    — dashboard cards + layout badges
 *   - "/api/admin/orders"   — orders list + dashboard recent
 *   - "/api/admin/topups"   — topups queue
 *   - "/api/admin/users"    — customers list
 *   - "/api/admin/tickets"  — R126-L3: no polling on the tickets page
 *   - "admin-risk-events" / "admin-risk-dashboard" — R126-L3: the risk
 *     surfaces have no polling either
 *   - "/api/admin/products" — R127-B6-6: the products write family
 *     emits admin-stats-update (R126-L4) and products.tsx's base-key
 *     invalidation comment claims socket coverage; the 60 s poll is
 *     the dropout fallback.
 */
export function invalidateAdminRealtimeFamilies(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/admin/orders"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/admin/topups"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/admin/tickets"] });
  void queryClient.invalidateQueries({ queryKey: ["admin-risk-events"] });
  void queryClient.invalidateQueries({ queryKey: ["admin-risk-dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
  // R134 (the R126-A1-1 + A1-26 close-out): the three react-query families
  // the socket set never carried — another operator's approve used to tick
  // the KPI tiles (stats key) while the revenue chart below kept the
  // pre-approve series, and referrals/pricing-config tabs stayed stale
  // until manual refresh. Prefix keys: chart-data matches every
  // days-variant; pricing-config covers the config family. Coupons stays
  // raw-local-state (no query key to invalidate — its fold into
  // react-query is the remaining A1-26 half).
  void queryClient.invalidateQueries({ queryKey: ["/api/admin/chart-data"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/admin/referrals"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/admin/pricing/config"] });
  // R153 (reconnect badge gap): the alerts families — the live
  // admin-alert-new handler invalidates them, but the RESYNC set never
  // did, so after a disconnect→reconnect the alerts badge/unread count
  // lagged until the 5-minute fallback poll. Same key roots the alerts
  // page's useQuery calls use.
  void queryClient.invalidateQueries({ queryKey: ["admin-alerts"] });
  void queryClient.invalidateQueries({ queryKey: ["admin-alerts-unread-count"] });
}
