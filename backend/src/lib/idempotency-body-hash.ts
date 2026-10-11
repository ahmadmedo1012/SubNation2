import { createHash } from "node:crypto";

/**
 * Canonical request-body hash — the ONE definition of "the same request"
 * for idempotency across BOTH layers:
 *
 *   - the Redis middleware (middlewares/idempotency.ts, R122 A3-P2-4) —
 *     the fast 24h-TTL dedup for clients that send Idempotency-Key;
 *   - the DURABLE idempotency layer (lib/idempotency.ts + the
 *     idempotency_keys table, R134/A7-F4) — the pre-tx lookup predicate
 *     and the in-tx claim column.
 *
 * R134 (A7-F4): before this module the durable layer stored NO body
 * fingerprint, so within the 48h retention a client reusing one
 * Idempotency-Key with a DIFFERENT body got the original result
 * replayed (200 + Idempotent-Replayed) instead of the designed 409 —
 * money-safe (no second charge; scoping + ownership re-checks hold)
 * but the client's record diverged from the platform's. The durable
 * predicate now compares this hash: match (or NULL legacy claim) →
 * replay, mismatch → 409 IDEMPOTENCY_KEY_REUSE — the same semantics
 * the Redis layer enforces, so both layers agree on every request.
 *
 * Exported (not middleware-private) so the durable claim writers can
 * hash at the ROUTE layer (req.body, post-express.json) — hashing
 * inside the services would re-derive from parsed/normalized inputs
 * and silently define a second equivalence relation.
 */

/**
 * Canonical JSON serializer — recursively sorts object keys so the hash
 * is keyed on the VALUE of the body, not the byte order a particular
 * client's serializer happened to emit. Mirrors JSON.stringify
 * semantics for everything else (arrays keep their order — order is
 * semantic there; object keys whose value is `undefined` are dropped;
 * non-JSON primitives stringify to "null"), so the canonical form of a
 * body equals its JSON.stringify form whenever key order already
 * agrees.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // Primitives (and functions/symbols, which JSON.stringify cannot
    // represent): delegate — undefined serializes to "null" in arrays and
    // is dropped from objects by the caller's key filter below.
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  // Sorted key set, undefined-valued keys dropped (JSON.stringify parity).
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`)
    .join(",")}}`;
}

/**
 * Hash the CANONICAL form (R122 A3-P2-4): the raw JSON.stringify was
 * key-order sensitive — a non-UI client (or a client-library upgrade
 * that changes key order) retrying a semantically identical body would
 * get a false 409 instead of the replay. Reordered-but-equal bodies
 * hash equal. 64 lowercase hex chars (sha256) — the durable column is
 * varchar(64).
 */
export function canonicalBodyHash(body: unknown): string {
  return createHash("sha256")
    .update(canonicalJsonStringify(body ?? null))
    .digest("hex");
}

/**
 * The durable-reuse 409 envelope, byte-shaped like the middleware's
 * (middlewares/idempotency.ts) — clients see ONE shape whether the
 * Redis layer or the durable layer classified the reuse.
 */
export const IDEMPOTENCY_KEY_REUSE_MESSAGE =
  "تمت إعادة استخدام معرف العملية مع طلب مختلف. استخدم معرفًا جديدًا للعمليات الجديدة.";
export const IDEMPOTENCY_KEY_REUSE_CODE = "IDEMPOTENCY_KEY_REUSE";
