// R137 (FE admin decomposition): the chart-error classifier moved verbatim
// from pages/admin/dashboard.tsx — pure, React-free. The chartError
// computation stays in the page (it owns the query + the banner gate).

/** R127-L1 (B1 §3.1): a 401 from the generated chart fetcher is the
 *  global admin-session handler's business (toast + redirect fired
 *  inside customFetch) — the chart error banner below stays quiet on
 *  it. ApiError is type-only from the package, so the check duck-types
 *  `status` (the alerts.tsx R126-L8b idiom). */
export function isSessionExpiredError(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 401;
}
