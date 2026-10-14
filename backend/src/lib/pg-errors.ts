/**
 * Postgres unique-violation (SQLSTATE 23505), unwrapped through
 * DrizzleQueryError.cause (node-postgres carries the code on the wrapper,
 * pglite on the cause — both levels checked). Constraint-agnostic: callers
 * that must match ONE constraint keep their own narrower check
 * (topup.service.ts's payment-reference variant is the precedent).
 *
 * R146 review F2: extracted from the byte-identical copies in
 * firebase-auth.service.ts and telegram-auth-flow.ts.
 */
export function isUniqueViolation(err: unknown): boolean {
  const wrapper = err as { code?: string; cause?: unknown } | null;
  const driver = (wrapper?.cause ?? err) as { code?: string } | null;
  return (driver?.code ?? wrapper?.code) === "23505";
}
