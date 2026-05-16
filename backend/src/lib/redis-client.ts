/**
 * Singleton Redis client for the SubNation backend.
 *
 * One client is shared by:
 *   - rate-limit-redis (general commands)
 *   - the alerting service (dedup + global rate-limit keys)
 *   - the worker heartbeat
 *   - the extended /api/healthz/{redis,neon,worker,socket} endpoints
 *
 * Socket.IO's Redis adapter requires its own dedicated pub/sub clients
 * (createClient + duplicate) — that lives in lib/socket.ts and is intentionally
 * separate from this singleton.
 *
 * In production, connection failure is fatal (process.exit(1)) so the platform
 * never silently degrades to in-memory rate limiting under multi-instance
 * deployment. In development we log a warning and continue with no Redis.
 */

import { createClient, type RedisClientType } from "redis";
import { logger } from "./logger";

let redisClient: RedisClientType | null = null;
let initPromise: Promise<RedisClientType | null> | null = null;

/** True after `initRedisClient` has resolved at least once. */
let initialised = false;

/**
 * Lazily create the singleton client. Safe to call many times: the second and
 * subsequent calls return the same in-flight promise.
 */
export function initRedisClient(): Promise<RedisClientType | null> {
  if (initPromise) return initPromise;

  const isProduction = process.env.NODE_ENV === "production";

  if (!process.env.REDIS_URL) {
    if (isProduction) {
      logger.warn(
        "REDIS_URL is missing in production. Falling back to in-memory stores. This is NOT recommended for production scaling.",
      );
    }
    initialised = true;
    initPromise = Promise.resolve(null);
    return initPromise;
  }

  redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 500),
    },
  }) as RedisClientType;

  redisClient.on("error", (err) => {
    if (isProduction) {
      logger.fatal({ err }, "Redis client error - required for production");
      process.exit(1);
    }
    logger.warn({ err }, "Redis client error - falling back to in-memory rate limiting");
    redisClient = null;
  });

  initPromise = redisClient
    .connect()
    .then(() => {
      logger.info("Redis client connected");
      initialised = true;
      return redisClient;
    })
    .catch((err) => {
      if (isProduction) {
        logger.fatal({ err }, "Failed to connect to Redis - required for production");
        process.exit(1);
      }
      logger.warn({ err }, "Failed to connect to Redis - falling back to in-memory rate limiting");
      redisClient = null;
      initialised = true;
      return null;
    });

  return initPromise;
}

/**
 * Synchronous accessor. Returns the connected client, or null if Redis is not
 * available (dev fallback) or has not finished initialising yet.
 */
export function getRedisClient(): RedisClientType | null {
  return redisClient;
}

/**
 * Throwing accessor for code paths that absolutely require Redis (alerting
 * dedup keys, etc.).
 */
export function requireRedisClient(): RedisClientType {
  if (!redisClient) {
    throw new Error(
      "Redis client not initialized. Ensure initRedisClient() has been awaited before use.",
    );
  }
  return redisClient;
}

/** True once initRedisClient() has either connected or fallen back. */
export function isRedisInitialised(): boolean {
  return initialised;
}
