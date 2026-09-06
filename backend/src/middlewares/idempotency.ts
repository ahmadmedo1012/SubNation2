/**
 * Idempotency middleware — F-008 (security audit 004) bundle S-01.
 *
 * Reads the `Idempotency-Key` header on state-changing admin endpoints
 * and dedupes duplicate requests via Redis. The first request runs
 * normally and its response is cached for 24 hours; subsequent requests
 * with the same key replay the cached response with an
 * `Idempotent-Replayed: true` response header.
 *
 * Failure modes (graceful degrade — availability over strict guarantees):
 *
 *   - **Redis unavailable**: log warn + pass through. The deployment
 *     already fail-closes Redis at boot in production (lib/redis-client.ts),
 *     so this branch is reachable in dev / test only. It avoids breaking
 *     the test suite when pglite-only.
 *
 *   - **Key absent**: log warn (operator-facing) + pass through. Phase-1
 *     admin UI does not yet send the header; this branch lets the
 *     remediation land without a synchronised UI deploy. A follow-up
 *     change makes the header REQUIRED on the same routes once the UI
 *     is updated.
 *
 *   - **Same key, different body hash**: 409 Conflict. A retry that
 *     reuses an Idempotency-Key with a different intent is a client
 *     bug; surfacing it as 409 prevents silent body-mismatch.
 *
 *   - **Cached request still in flight (in-progress sentinel)**: 409.
 *     Avoids two concurrent retries both running the underlying mutation
 *     while neither sees the other's result yet. (Best-effort — Redis
 *     SETNX with a short TTL.)
 *
 * Cache shape (Redis):
 *   key:   `idempotent:{adminId}:{routeKey}:{userKey}`
 *   value: `{"hash":"...","status":...,"body":...,"completedAt":...}`
 *
 * The middleware never caches non-2xx responses — a transient DB error
 * should not lock the admin out of retry.
 *
 * Closes audit Finding F-008 (specs/004-security-audit/security.md).
 */

import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { getRedisClient } from "../lib/redis-client";
import { logger } from "../lib/logger";

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24h
const IN_FLIGHT_TTL_SECONDS = 60; // short — covers retry-during-execution
const IN_FLIGHT_SENTINEL = "__in_flight__";

interface CachedResponse {
  hash: string;
  status: number;
  body: unknown;
  completedAt: string; // ISO-8601 for audit
}

interface SubjectAttachedRequest extends Request {
  adminId?: number;
  userId?: number;
}

function bodyHash(body: unknown): string {
  // Deterministic enough — JSON.stringify with sorted keys would be
  // even better, but the admin UI is the only sender so insertion order
  // is stable.
  return createHash("sha256")
    .update(JSON.stringify(body ?? null))
    .digest("hex");
}

/**
 * Build the Redis cache key. Scoping to (subject, route, userKey)
 * means two different actors can use the same Idempotency-Key string
 * without colliding — the dedup is per-admin AND per-end-user (V4-P0:
 * POST /api/orders now mounts this middleware with the userId subject).
 */
function buildCacheKey(
  subjectKind: "admin" | "user",
  subjectId: number,
  routeKey: string,
  userKey: string,
): string {
  return `idempotent:${subjectKind}:${subjectId}:${routeKey}:${userKey}`;
}

export interface IdempotencyOptions {
  /**
   * Logical route identifier baked into the cache key. Stable across
   * deploys so a redeploy mid-retry does not allow re-execution.
   */
  routeKey: string;
}

export function idempotency(opts: IdempotencyOptions) {
  const { routeKey } = opts;

  return async function idempotencyMiddleware(
    req: SubjectAttachedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const userKey = req.header("idempotency-key") ?? req.header("Idempotency-Key");

    // Subject: admin routes decorate adminId (requireAdmin); user routes
    // decorate userId (requireUser). Either scope dedups correctly.
    const isAdmin = typeof req.adminId === "number";
    const subjectId = isAdmin ? req.adminId : req.userId;

    // No subject (route mounted without an auth middleware upstream)
    // — refuse to dedup; this is a programming error, not user input.
    if (typeof subjectId !== "number") {
      logger.warn(
        { route: routeKey, path: req.path },
        "idempotency middleware reached without an authenticated subject — passing through",
      );
      next();
      return;
    }
    const subjectKind = isAdmin ? ("admin" as const) : ("user" as const);

    if (!userKey || typeof userKey !== "string" || userKey.length < 8) {
      // Phase-1 transitional path (see file header). Log so ops can
      // measure how many admin mutations still arrive without the
      // header; tighten to 400 once the UI is updated.
      logger.warn(
        { route: routeKey, path: req.path, subjectKind, subjectId },
        "mutation arrived without Idempotency-Key — pass-through; tighten in follow-up",
      );
      next();
      return;
    }

    const redis = getRedisClient();
    if (!redis) {
      // Redis unavailable in this environment (dev / test). The
      // production boot path fail-closes when REDIS_URL is set but the
      // connection errors, so we only reach this branch in environments
      // that explicitly chose in-memory mode.
      logger.warn(
        { route: routeKey, path: req.path },
        "idempotency middleware: Redis unavailable — pass-through (dev/test only)",
      );
      next();
      return;
    }

    const cacheKey = buildCacheKey(subjectKind, subjectId, routeKey, userKey);
    const reqHash = bodyHash(req.body);

    let cached: CachedResponse | null = null;
    try {
      const raw = await redis.get(cacheKey);
      if (raw) {
        if (raw === IN_FLIGHT_SENTINEL) {
          res.status(409).json({
            success: false,
            message: "طلب سابق بنفس المعرف لا يزال قيد المعالجة. حاول مرة أخرى بعد قليل.",
            code: "IDEMPOTENCY_IN_FLIGHT",
          });
          return;
        }
        cached = JSON.parse(raw) as CachedResponse;
      }
    } catch (err) {
      logger.warn({ err, route: routeKey }, "idempotency middleware: cache lookup failed");
      // Fall through to live processing — never block on cache errors.
    }

    if (cached) {
      if (cached.hash !== reqHash) {
        res.status(409).json({
          success: false,
          message:
            "تمت إعادة استخدام معرف العملية مع طلب مختلف. استخدم معرفًا جديدًا للعمليات الجديدة.",
          code: "IDEMPOTENCY_KEY_REUSE",
        });
        return;
      }
      // Replay the original successful response.
      res.setHeader("Idempotent-Replayed", "true");
      res.setHeader("Idempotent-Original-At", cached.completedAt);
      res.status(cached.status).json(cached.body);
      return;
    }

    // Mark in-flight (best-effort) so a concurrent retry sees a clear
    // signal. NX ensures we don't overwrite a winning request's cached
    // response if it just landed.
    try {
      await redis.set(cacheKey, IN_FLIGHT_SENTINEL, {
        EX: IN_FLIGHT_TTL_SECONDS,
        NX: true,
      });
    } catch (err) {
      logger.warn({ err, route: routeKey }, "idempotency middleware: in-flight marker failed");
    }

    // Capture the response so we can cache it on success.
    const originalJson = res.json.bind(res);
    let captured = false;
    res.json = function (body: unknown) {
      if (!captured) {
        captured = true;
        // Cache only successful responses so a transient DB error does
        // not lock subsequent retries out.
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const payload: CachedResponse = {
            hash: reqHash,
            status: res.statusCode,
            body,
            completedAt: new Date().toISOString(),
          };
          // Fire-and-forget — the response is already going out the wire.
          // A failed cache write means the retry will run live, which is
          // safe (the underlying service is itself transactional).
          redis
            .set(cacheKey, JSON.stringify(payload), { EX: IDEMPOTENCY_TTL_SECONDS })
            .catch((err) =>
              logger.warn({ err, route: routeKey }, "idempotency middleware: cache write failed"),
            );
        } else {
          // Non-2xx — drop the in-flight sentinel so a corrected retry can run.
          redis.del(cacheKey).catch(() => {
            /* best-effort */
          });
        }
      }
      return originalJson(body);
    };

    next();
  };
}
