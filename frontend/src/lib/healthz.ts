/**
 * Robust /api/healthz/ready fetcher.
 *
 * Never throws. The backend always returns a valid JSON body with a
 * `status` discriminator and a per-check breakdown — even for 503
 * (genuine critical failure). React Query's default `(r) => r.json()`
 * pattern would treat an HTTP error as a network failure, retry, and
 * fill DevTools with red 503 lines + Sentry breadcrumbs. That's noise
 * for an endpoint whose 503 is by-design (means "Neon down" or
 * "Redis down").
 *
 * This wrapper:
 *   • Reads the body regardless of HTTP status (always JSON now).
 *   • Treats network errors as a synthesized `degraded` result so
 *     React Query NEVER enters an error state.
 *   • Logs nothing (Sentry captures real network errors elsewhere
 *     via instrumentation).
 *
 * Used by:
 *   - frontend/src/components/layout/SystemStatusPill.tsx
 *   - frontend/src/pages/status.tsx
 *   - frontend/src/pages/admin/system.tsx
 */

export type CheckStatus = "ok" | "degraded" | "failing";

export interface HealthCheck {
  status: CheckStatus;
  optional?: boolean;
  latencyMs?: number;
  error?: string;
  note?: string;
  lastCheckedAt: string;
}

export interface HealthzReadyResponse {
  status: CheckStatus;
  checks: Record<string, HealthCheck>;
  version: string;
  uptimeSec: number;
}

const FALLBACK: HealthzReadyResponse = {
  status: "degraded",
  checks: {},
  version: "unknown",
  uptimeSec: 0,
};

export async function fetchHealthzReady(): Promise<HealthzReadyResponse> {
  let res: Response;
  try {
    res = await fetch("/api/healthz/ready", {
      // No credentials needed — endpoint is public.
      // No retry headers — caller (React Query) controls cadence.
    });
  } catch {
    // Network failure (offline, DNS, etc.). Return synthesized degraded
    // so React Query never sees an error. Real-time UI still shows
    // "degraded" yellow (not failure red) which is the correct semantic.
    return FALLBACK;
  }

  // 503 is informative on this endpoint — body still has status="failing"
  // + per-check details. Parse anyway. 200 + degraded is the common case.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return FALLBACK;
  }

  // Defensive shape check — the backend always returns the right shape,
  // but a CDN-injected error page or proxy fault could break this.
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as HealthzReadyResponse).status !== "string"
  ) {
    return FALLBACK;
  }

  return body as HealthzReadyResponse;
}

/**
 * True iff the user has at least one critical subsystem down. Keeps the
 * "should I scream at the user" decision in one place.
 */
export function hasCriticalFailure(data: HealthzReadyResponse): boolean {
  if (data.status !== "failing") return false;
  return Object.values(data.checks).some(
    (check) => check.status === "failing" && check.optional !== true,
  );
}
