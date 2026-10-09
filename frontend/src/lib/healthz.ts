export interface HealthzSummary {
  status: CheckStatus;
}

const SUMMARY_FALLBACK: HealthzSummary = { status: "degraded" };

/**
 * Public-safe health fetcher. Hits /api/healthz/summary which returns
 * ONLY the aggregate status discriminator — no per-check details, no
 * version, no uptime, no infrastructure info. Used by the public
 * /status page and the (now removed) footer pill.
 *
 * Never throws — degrades to "degraded" on any error so React Query
 * never enters an error state.
 */
export async function fetchHealthzSummary(): Promise<HealthzSummary> {
  let res: Response;
  try {
    res = await fetch("/api/healthz/summary");
  } catch {
    return SUMMARY_FALLBACK;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return SUMMARY_FALLBACK;
  }

  if (!body || typeof body !== "object" || typeof (body as HealthzSummary).status !== "string") {
    return SUMMARY_FALLBACK;
  }

  return body as HealthzSummary;
}

/**
 * Shared response shape of /api/healthz/ready — the ADMIN-GATED detailed
 * readiness endpoint (backend: requireAdmin).
 *
 * R110-E (109-k P3-3): this module used to carry a ready-endpoint fetch
 * helper whose comment claimed the endpoint is public. It is not — a bare
 * fetch gets 401 — and the helper had no remaining callers (the admin
 * system page sends the admin JWT itself); it was removed together with
 * its stale comment. The live consumers of these types are
 * pages/status.tsx (CheckStatus) and pages/admin/system.tsx
 * (fetchAdminHealthReady → HealthzReadyResponse).
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
