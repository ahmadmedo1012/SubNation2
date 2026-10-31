/**
 * R165 (the R162 ADR §6.2) — pure clustering for the orders list, ported
 * verbatim from the web's lib/order-groups.ts: runs of CONSECUTIVE rows
 * sharing one non-null order_group_id render under one «عملية شراء واحدة»
 * chip. Historical NULL-group rows never cluster; every row keeps its own
 * identity/amount/status and stays individually tappable — grouping is
 * presentational only.
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
 * adjacent; interleaved rows break the run honestly rather than
 * reordering history.
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
    let end = i + 1;
    while (end < orders.length && orders[end].order_group_id === group) end += 1;
    const runLength = end - i;
    if (runLength >= 2) clusters.set(i, runLength);
    i = end;
  }
  return clusters;
}
