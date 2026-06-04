/**
 * Redis flag helpers for the inventory demand-forecasting feature
 * (011-inventory-demand-forecast, T011).
 *
 * Two distinct keys:
 *   forecast:alerts:paused         — no TTL; set by the capture-rate
 *                                     retention job when SC-008 trips.
 *                                     Manual-clear only (research §R-8).
 *   forecast_alert:<product_id>    — 7-day TTL; set when an alert
 *                                     fires for a product so the next
 *                                     6 days' forecasts don't re-alert
 *                                     on the same product (research §R-3).
 *
 * All helpers degrade safely when Redis is unavailable — the forecasting
 * pipeline must never fail because the cache is down (matches the
 * existing risk-config-cache.service.ts posture).
 */

import { logger } from "../logger";
import { getRedisClient } from "../redis-client";

const ALERTS_PAUSED_KEY = "forecast:alerts:paused";
const ALERT_DEDUPE_PREFIX = "forecast_alert:";
const ALERT_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function isAlertingPaused(): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) return false;
    const v = await redis.get(ALERTS_PAUSED_KEY);
    return v !== null;
  } catch (err) {
    logger.warn({ err, category: "forecast.flags" }, "[forecast] isAlertingPaused: redis read failed; assuming not paused");
    return false;
  }
}

export async function pauseAlerting(reason: string): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.set(ALERTS_PAUSED_KEY, reason, { NX: true });
  } catch (err) {
    logger.warn({ err, category: "forecast.flags" }, "[forecast] pauseAlerting: redis write failed");
  }
}

export async function resumeAlerting(): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.del(ALERTS_PAUSED_KEY);
  } catch (err) {
    logger.warn({ err, category: "forecast.flags" }, "[forecast] resumeAlerting: redis write failed");
  }
}

/**
 * Try to claim the dedupe lock for a product. Returns true iff this is
 * the first alert for that product within the 7-day window. False
 * means an earlier alert has already fired and we should skip.
 */
export async function tryClaimAlertDedupe(productId: number): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) return true; // Best-effort: emit when cache is down rather than swallow.
    const key = `${ALERT_DEDUPE_PREFIX}${productId}`;
    const result = await redis.set(key, "1", { NX: true, EX: ALERT_DEDUPE_TTL_SECONDS });
    return result === "OK";
  } catch (err) {
    logger.warn(
      { err, productId, category: "forecast.flags" },
      "[forecast] tryClaimAlertDedupe: redis write failed; emitting anyway",
    );
    return true;
  }
}
