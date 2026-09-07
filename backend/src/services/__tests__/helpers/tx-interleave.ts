import { vi } from "vitest";

/**
 * Race-simulation harness for drizzle-transaction services under the
 * single-session pglite test DB (round-92, B2-01/B2-02 tests).
 *
 * The production races we need to regression-test (refund × concurrent
 * points award; two same-reference topup approvals) live in the window
 * between a transaction's SELECT and its guarded UPDATE. PGlite is a
 * single Postgres session — two real client connections cannot interleave
 * (a query issued on the outer client while a transaction holds the queue
 * deadlocks; verified empirically), so `Promise.all` of two services only
 * exercises sequential ordering, never the read→write window.
 *
 * This helper simulates the interleaving INSIDE the window:
 *
 *   1. `db.transaction` is wrapped; the transaction callback receives a
 *      Proxy of the real tx.
 *   2. When the service runs `tx.select(fields)` and `matchSelectFields`
 *      identifies the read that opens the vulnerable window, the returned
 *      builder is wrapped so that — after the SELECT's rows resolve but
 *      BEFORE the service sees them — `writer(realTx)` executes on the
 *      REAL transaction session. This is exactly the committed-concurrent-
 *      writer state the guarded UPDATE will then evaluate against
 *      (READ COMMITTED re-checks the WHERE against the latest row version;
 *      a PGlite BEFORE-UPDATE trigger cannot simulate this because WHERE
 *      evaluation precedes row triggers).
 *   3. The service continues with the stale rows it already "read", the
 *      optimistic-lock predicate re-asserts the stale column values, and
 *      the 0-rows outcome exercises the production CONCURRENCY_ERROR /
 *      unique-violation path.
 *
 * Caveat (documented per the audit's testing note): the writer's mutation
 * rolls back with the service transaction when the service fails — in
 * production the concurrent writer would have committed independently.
 * The assertion target is the service's ERROR + no double-apply, which is
 * exactly what the optimistic-lock guarantees; the "winner keeps its
 * write" half of the guarantee is covered by the sequential happy-path
 * tests in the same suites.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- drizzle builder
   internals are intentionally opaque here; the proxy forwards shape. */

export interface InterleaveOptions {
  /** Return true for the SELECT whose resolved read starts the race window. */
  matchSelectFields: (fields: unknown) => boolean;
  /** The "concurrent committed writer" — runs through the REAL tx session. */
  writer: (realTx: any) => Promise<void>;
}

/** Install the interleave on `db.transaction`; returns a restore function. */
export function interleaveWriterAfterSelect(db: any, opts: InterleaveOptions): () => void {
  const original = db.transaction.bind(db);
  const spy = vi
    .spyOn(db, "transaction")
    .mockImplementation((cb: any, config?: any) =>
      original((tx: any) => cb(wrapTx(tx, opts)), config),
    );
  return () => spy.mockRestore();
}

function wrapTx(tx: any, opts: InterleaveOptions): any {
  const armed = { done: false };
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === "select") {
        return (...args: unknown[]) => {
          const builder = target.select(...args);
          if (!armed.done && opts.matchSelectFields(args[0])) {
            armed.done = true;
            return wrapThenable(builder, () => opts.writer(target));
          }
          return builder;
        };
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => value.apply(target, args);
    },
  });
}

/**
 * Wrap a drizzle query builder so the first `await` runs the underlying
 * query, then `runWriter()`, then delivers the (stale) rows. Every chained
 * method (`.from/.where/.limit/.for/...`) re-wraps its object result.
 */
function wrapThenable(builder: any, runWriter: () => Promise<void>): any {
  return new Proxy(builder, {
    get(target, prop) {
      if (prop === "then") {
        return (onFulfilled?: (rows: unknown) => unknown, onRejected?: (err: unknown) => unknown) =>
          target.then(async (rows: unknown) => {
            await runWriter();
            return onFulfilled ? onFulfilled(rows) : rows;
          }, onRejected);
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (result !== null && typeof result === "object") {
          return wrapThenable(result, runWriter);
        }
        return result;
      };
    },
  });
}
