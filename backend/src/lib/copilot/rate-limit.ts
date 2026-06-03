/**
 * Per-admin sliding-window rate limit for the AI Admin Copilot
 * (010-ai-admin-copilot, T025 / FR-SAFETY-004).
 *
 * Two windows enforced atomically per request:
 *   - 30 commands per 60 seconds
 *   - 200 commands per 3600 seconds
 *
 * Implementation: Redis sorted sets + Lua. Each admin has two ZSETs keyed
 * `copilot:rl:1m:<adminId>` and `copilot:rl:1h:<adminId>`. We trim by
 * window end, count, and ZADD inside one EVAL so concurrent requests
 * cannot overshoot.
 *
 * Fallback behavior:
 *   - REDIS_URL unset (in-memory mode): use a process-local Map. This is
 *     OK for dev / single-instance deploy; on horizontal scale-out the
 *     limits become per-instance, matching the existing constitution
 *     fallback policy for rate-limit-redis.
 *   - Redis error mid-request: fail-OPEN (allow the request) and log.
 *     The constitution prefers fail-closed for security; we deliberately
 *     diverge here because (a) requireAdmin already authenticated, (b)
 *     the LLM call cost is bounded by token budget anyway, and (c) the
 *     constitution's existing IP/user rate-limits are in front of this.
 */

import type { NextFunction, Request, Response } from "express";
import { Counter } from "prom-client";
import { ErrorCode, createErrorResponse } from "../errors";
import { logger } from "../logger";
import { getRedisClient } from "../redis-client";
import { getRegistry } from "../metrics";
import type { AdminAuthenticatedRequest } from "../../middlewares/requireAdmin";

const WINDOW_MIN_SEC = 60;
const LIMIT_MIN = 30;
const WINDOW_HOUR_SEC = 3600;
const LIMIT_HOUR = 200;
const COUNTER_NAME = "copilot_rate_limit_denials_total";

let denialCounter: Counter<string> | null = null;
function counter(): Counter<string> {
  if (denialCounter) return denialCounter;
  const reg = getRegistry();
  const existing = reg.getSingleMetric(COUNTER_NAME) as Counter<string> | undefined;
  denialCounter =
    existing ??
    new Counter({
      name: COUNTER_NAME,
      help: "Copilot rate-limit denials (per-admin sliding window).",
      labelNames: ["window"] as const,
      registers: [reg],
    });
  return denialCounter;
}

const MEMORY: Map<string, number[]> = new Map();

function memoryCheck(key: string, windowSec: number, limit: number, now: number): number {
  const cutoff = now - windowSec * 1000;
  const arr = (MEMORY.get(key) ?? []).filter((t) => t > cutoff);
  if (arr.length >= limit) {
    MEMORY.set(key, arr);
    return Math.max(1, Math.ceil((arr[0]! + windowSec * 1000 - now) / 1000));
  }
  arr.push(now);
  MEMORY.set(key, arr);
  return 0;
}

const LUA_SCRIPT = `
local key       = KEYS[1]
local window_ms = tonumber(ARGV[1])
local limit     = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local cutoff    = now - window_ms
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after_ms = window_ms
  if oldest[2] then
    retry_after_ms = (tonumber(oldest[2]) + window_ms) - now
    if retry_after_ms < 1 then retry_after_ms = 1 end
  end
  return retry_after_ms
end
redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
redis.call('PEXPIRE', key, window_ms + 1000)
return 0
`;

async function redisCheck(
  key: string,
  windowSec: number,
  limit: number,
  now: number,
): Promise<number> {
  const client = getRedisClient();
  if (!client) {
    return memoryCheck(key, windowSec, limit, now);
  }
  try {
    const res = await client.eval(LUA_SCRIPT, {
      keys: [key],
      arguments: [String(windowSec * 1000), String(limit), String(now)],
    });
    const retryAfterMs = Number(res ?? 0);
    return retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : 0;
  } catch (err) {
    logger.warn({ err, key }, "copilot rate-limit Redis EVAL failed; failing open");
    return 0;
  }
}

export async function copilotRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const adminReq = req as AdminAuthenticatedRequest;
  if (!adminReq.adminId) {
    res.status(401).json(createErrorResponse("غير مصرح", ErrorCode.UNAUTHORIZED));
    return;
  }
  const now = Date.now();
  const minKey = `copilot:rl:1m:${adminReq.adminId}`;
  const hourKey = `copilot:rl:1h:${adminReq.adminId}`;

  const minWait = await redisCheck(minKey, WINDOW_MIN_SEC, LIMIT_MIN, now);
  if (minWait > 0) {
    counter().inc({ window: "1m" });
    res.setHeader("Retry-After", String(minWait));
    res.status(429).json({
      error: "تم تجاوز الحد الأقصى للأوامر في الدقيقة",
      code: "COPILOT_RATE_LIMITED",
      retry_after_seconds: minWait,
      window: "1m",
    });
    return;
  }

  const hourWait = await redisCheck(hourKey, WINDOW_HOUR_SEC, LIMIT_HOUR, now);
  if (hourWait > 0) {
    counter().inc({ window: "1h" });
    res.setHeader("Retry-After", String(hourWait));
    res.status(429).json({
      error: "تم تجاوز الحد الأقصى للأوامر في الساعة",
      code: "COPILOT_RATE_LIMITED",
      retry_after_seconds: hourWait,
      window: "1h",
    });
    return;
  }

  next();
}
