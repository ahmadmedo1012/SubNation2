/**
 * Recommended reorder quantity (011-inventory-demand-forecast, T014).
 *
 * Single pure function. Spec: research §R-2.
 *
 *   reorder_qty = max(0, predicted_demand_30d * 1.2 - current_stock)
 *
 * The 1.2 factor is a 20% safety stock that absorbs DoW variance over
 * a 30-day window plus the typical ±1-day order-arrival jitter. Floored
 * at zero so a well-stocked product surfaces "no reorder needed".
 */

const SAFETY_STOCK_FACTOR = 1.2;

export function recommendReorderQty(
  predictedDemand30d: number,
  currentStock: number,
): number {
  const desired = predictedDemand30d * SAFETY_STOCK_FACTOR;
  const gap = desired - currentStock;
  if (!Number.isFinite(gap) || gap <= 0) return 0;
  return Math.ceil(gap);
}
