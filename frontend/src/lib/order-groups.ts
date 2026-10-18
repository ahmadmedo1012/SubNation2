/**
 * R165 (the R162 ADR §6.2): pure clustering for the /orders list — runs
 * of CONSECUTIVE rows sharing one non-null order_group_id render under
 * one «عملية شراء واحدة» affordance. Historical NULL-group rows never
 * cluster (a backfill could only fabricate groups); every row keeps its
 * own identifier/amount/status and stays individually linked — grouping
 * is presentational only.
 *
 * Pure + localStorage-free so orders.tsx and its tests share ONE
 * definition of a cluster (the same discipline as coupon-quote.ts).
 */

export interface GroupClusterableOrder {
  id: number;
  order_group_id?: string | null;
}

/**
 * Compute the cluster runs over a newest-first orders list: a Map from
 * the START index of each qualifying run (≥2 consecutive orders sharing
 * one non-null order_group_id) to the run's length.
 *
 * Consecutive-only by design: the list is newest-first and orders of one
 * attempt were created within seconds of each other, so they arrive
 * adjacent; interleaved rows (a purchase between another attempt's
 * units) break the run honestly rather than reordering history.
 */
export function computeOrderGroupClusters<T extends GroupClusterableOrder>(
  orders: T[],
): Map<number, number> {
  const clusters = new Map<number, number>();
  let i = 0;
  while (i < orders.length) {
    const group = orders[i].order_group_id;
    if (!group) {
      i += 1;
      continue;
    }
    // Extend the run while the group id matches on consecutive rows.
    let end = i + 1;
    while (end < orders.length && orders[end].order_group_id === group) end += 1;
    const runLength = end - i;
    if (runLength >= 2) clusters.set(i, runLength);
    i = end;
  }
  return clusters;
}
