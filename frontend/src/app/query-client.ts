/**
 * R137 (2-b — the App.tsx route-registry decomposition): the app-wide
 * TanStack QueryClient + its retry predicate, extracted VERBATIM from
 * App.tsx. React-free module (the QueryClient constructor is not a
 * React import); the instance is a module singleton shared by App.tsx
 * (QueryClientProvider) and app/boot-head-start.ts (the catalog
 * prefetch), and isRetryableQueryError is re-exported through App.tsx
 * for the query-retry regression suite.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 60 seconds stale time to reduce redundant requests on route changes
      staleTime: 60_000,
      // Keep unused data for 5 min before GC to support quick back-navigation
      gcTime: 5 * 60_000,
      // 98-F7 (r97 F-13): retry ONLY on retryable failures — network errors
      // and HTTP 5xx. The previous `retry: 1` re-fired 4xx requests too:
      // every 404 (expired product link), 400 (validation) and 401
      // (expired session — the admin 401 handler already toasts +
      // redirects; the extra retry just doubled the failure latency and
      // the 401 noise). One retry max, same budget as before.
      retry: (failureCount: number, error: unknown) =>
        failureCount < 1 && isRetryableQueryError(error),
      // Don't refetch on window focus for mobile UX (reduces spinner flashes)
      refetchOnWindowFocus: false,
      // Don't refetch on network reconnect either. Default is "always",
      // which means a single network blip (mobile WiFi → cellular
      // handoff, brief offline) triggers ALL active queries to refetch
      // simultaneously across every connected client — a textbook DB
      // pool storm under any non-trivial concurrency. The existing
      // staleTime + on-mount + on-event refetch logic is sufficient
      // for freshness; reconnect storms are pure waste.
      refetchOnReconnect: false,
    },
  },
});

/**
 * 98-F7 (r97 F-13): should this query failure be retried?
 *
 *   - TypeError ⇒ retryable. customFetch maps both its request timeouts
 *     and the browser's offline/DNS failures onto the canonical
 *     network-error TypeError ("Failed to fetch" — see
 *     toNetworkErrorShape in shared/api-client-react/custom-fetch.ts);
 *     raw-fetch queryFns reject with the same browser TypeError.
 *   - An error carrying a numeric `status` (customFetch wraps every
 *     non-2xx HTTP response in ApiError with `status`) ⇒ retryable only
 *     for 5xx (500/502/503/504 — transient server-side). 4xx is a
 *     client-side contract verdict (404/400/401/403/409…) — retrying
 *     the identical request can never succeed.
 *   - Anything else (a thrown Error from a hand-rolled queryFn, an
 *     AbortError from unmount cancellation) ⇒ not retried; component
 *     error paths own the surfacing.
 *
 * ApiError is TYPE-exported from @workspace/api-client-react (no runtime
 * export), so the check duck-types the `status` field instead of
 * instanceof — same contract, no import-boundary coupling.
 *
 * Exported for the query-retry regression test (same pattern as
 * DeferredSocketInitializer below).
 */
export function isRetryableQueryError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" && status >= 500 && status <= 599;
}
