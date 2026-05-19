/**
 * Slow-query observation for the Drizzle / pg pool.
 *
 * Audit P1-4: when a query suddenly starts taking 500 ms+ under load,
 * we want to know WHICH query without waiting for users to complain.
 *
 * Strategy: monkey-patch pool.query AND pool.connect at boot time.
 *   - pool.query: covers the ~95% of Drizzle calls that go straight
 *     through the pool.
 *   - pool.connect: the Client returned to Drizzle for transactions
 *     has its own .query method; we patch that too so transactional
 *     queries are also timed.
 *
 * Patching is idempotent — calling instrumentDbPool() twice is safe;
 * the second call is a no-op via the `__instrumented` marker.
 *
 * Performance overhead: one process.hrtime.bigint() before + after
 * each query, plus the prom-client histogram observe(). ~1 μs per
 * query — orders of magnitude below the slowest legitimate query
 * we'd ever care about, so the instrumentation itself never shows
 * up in the slow-query log.
 *
 * Configuration:
 *   SLOW_QUERY_THRESHOLD_MS — default 250. Set to 0 to log every
 *                              query (debugging only — VERY chatty).
 *
 * The histogram bucket distribution is tuned for the SubNation
 * workload: most queries 1-10 ms (auth, single-row reads), some
 * 10-100 ms (joins), tail at 100-1000 ms (admin reports).
 */

import { logger } from "./logger";
import { getRegistry, safeObserve } from "./metrics";
import { captureSubsystemException } from "./sentry";

// Minimal structural types — we don't import pg directly because the
// pg dep lives in @workspace/db, not the backend package. The shapes
// below match pg.Pool / pg.Client surfaces exactly enough for what
// we wrap.
interface PgQueryConfig {
  text?: string;
}
interface PgClientLike {
  query: (...args: unknown[]) => unknown;
}
interface PgPoolLike extends PgClientLike {
  connect: (...args: unknown[]) => Promise<PgClientLike>;
}

/**
 * Sentinel marker we set on a wrapped Pool / Client so we can detect
 * whether instrumentation has already been applied. Plain symbol —
 * inaccessible from outside this module.
 */
const INSTRUMENTED = Symbol.for("subnation.db.instrumented");

const DEFAULT_THRESHOLD_MS = 250;
const HISTOGRAM_NAME = "pg_query_duration_seconds";

function getThresholdMs(): number {
  const raw = process.env.SLOW_QUERY_THRESHOLD_MS;
  if (raw == null || raw === "") return DEFAULT_THRESHOLD_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_THRESHOLD_MS;
}

/**
 * Lazily-registered prom-client histogram so /api/metrics surfaces
 * the actual query-duration distribution. Buckets cover sub-ms
 * through multi-second.
 */
function getDurationHistogram() {
  const reg = getRegistry();
  let hist = reg.getSingleMetric(HISTOGRAM_NAME) as
    | import("prom-client").Histogram<string>
    | undefined;
  if (!hist) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const promClient = require("prom-client") as typeof import("prom-client");
    hist = new promClient.Histogram({
      name: HISTOGRAM_NAME,
      help: "Postgres query duration (seconds)",
      labelNames: ["slow"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [reg],
    });
  }
  return hist;
}

/** Extract a normalized query text from any pg query argument shape. */
function extractQueryText(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object") {
    const cfg = arg as PgQueryConfig;
    if (typeof cfg.text === "string") return cfg.text;
  }
  return "<unknown>";
}

/** Truncate SQL for log output to keep log lines bounded. */
function truncateSql(sql: string, maxLen = 200): string {
  const trimmed = sql.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "…";
}

/**
 * Wrap a single .query method (on Pool or Client) so it records
 * duration. Pool.query and Client.query share the same surface so
 * one wrapper covers both.
 */
function wrapQueryMethod(
  target: PgClientLike & { [INSTRUMENTED]?: boolean },
  thresholdMs: number,
): void {
  if (target[INSTRUMENTED]) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (target.query as any).bind(target);

  // The pg .query signature is heavily overloaded (string, config,
  // string+params, string+params+callback, etc.). Mirror that with a
  // single function that times the result regardless of shape.
  function wrapped(this: PgClientLike, ...args: unknown[]): unknown {
    const start = process.hrtime.bigint();
    const sql = extractQueryText(args[0]);

    function record(error?: unknown): void {
      const ns = Number(process.hrtime.bigint() - start);
      const ms = ns / 1e6;
      const seconds = ns / 1e9;
      const slow = ms > thresholdMs;
      safeObserve(getDurationHistogram(), { slow: slow ? "1" : "0" }, seconds);
      if (slow) {
        logger.warn(
          {
            slow_query: true,
            duration_ms: Math.round(ms),
            sql: truncateSql(sql),
            error: error instanceof Error ? error.message : undefined,
          },
          "[slow-query] threshold exceeded",
        );
      }
    }

    // Detect callback-style: pg accepts (text, params, cb) or (config, cb).
    const cbIndex = args.findIndex((a, i) => i > 0 && typeof a === "function");
    if (cbIndex >= 0) {
      const originalCb = args[cbIndex] as (err: Error | null, result: unknown) => void;
      args[cbIndex] = (err: Error | null, result: unknown) => {
        record(err);
        originalCb(err, result);
      };
      return original(...args);
    }

    // Promise-style.
    let result: unknown;
    try {
      result = original(...args);
    } catch (err) {
      record(err);
      throw err;
    }

    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(
        (value) => {
          record();
          return value;
        },
        (err) => {
          record(err);
          throw err;
        },
      );
    }
    record();
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target.query = wrapped as any;
  target[INSTRUMENTED] = true;
}

/**
 * Install slow-query instrumentation on the supplied pg.Pool.
 *
 * Idempotent: safe to call multiple times.
 *
 * MUST be called after the pool is created and before any query
 * fires through it. Practically: invoke once during boot in
 * server.ts, immediately after importing the pool from @workspace/db.
 */
export function instrumentDbPool(pool: unknown): void {
  type InstrumentedPool = PgPoolLike & { [INSTRUMENTED]?: boolean };
  const p = pool as InstrumentedPool;
  if (p[INSTRUMENTED]) return;

  const thresholdMs = getThresholdMs();

  // 1. Patch pool.query (covers most Drizzle calls).
  wrapQueryMethod(p, thresholdMs);

  // 2. Patch pool.connect so each Client returned for transactions
  //    also has wrapped query. Clients are pooled and reused, but
  //    once wrapped they stay wrapped (idempotent marker).
  const originalConnect = p.connect.bind(p);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (p as any).connect = (...args: unknown[]): unknown => {
    const result = originalConnect(...(args as []));
    if (result && typeof (result as Promise<PgClientLike>).then === "function") {
      return (result as Promise<PgClientLike>).then((client) => {
        wrapQueryMethod(client as PgClientLike & { [INSTRUMENTED]?: boolean }, thresholdMs);
        return client;
      });
    }
    return result;
  };

  // 3. Wire pool 'error' events to Sentry with the postgres subsystem
  //    tag. The shared/db package's own listener still logs to
  //    console; this listener captures the error to Sentry for
  //    incident triage. Pool errors are RARE and CRITICAL — they
  //    indicate the pool itself is failing (DNS, TLS, auth, peer
  //    reset, etc.), not just a single query.
  //
  //    Using `(pool as PgPoolEventEmitter).on(...)` because the
  //    structural type doesn't include EventEmitter shape; pg.Pool
  //    extends EventEmitter at runtime.
  type PgPoolEventEmitter = {
    on: (event: "error", listener: (err: Error) => void) => void;
  };
  (p as unknown as PgPoolEventEmitter).on("error", (err: Error) => {
    captureSubsystemException("postgres", err, {
      pool_state: "client_error",
    });
  });

  logger.info(
    {
      threshold_ms: thresholdMs,
      histogram: HISTOGRAM_NAME,
      sentry_capture: true,
    },
    "[db] slow-query instrumentation installed",
  );
}
