# Contract: Risk Dashboard

**Endpoint**: `GET /api/admin/risk/dashboard`
**Auth**: admin (existing `requireAdmin` + 2FA)
**Zod schema**: `RiskDashboardResponse` in `shared/api-zod/src/risk.ts`
**OpenAPI**: extended in `shared/api-spec/openapi.yaml`

## Request

No request body. Query parameters (all optional):

- `windowHours` (integer, default `24`): time window for the
  top-line metrics.

## Response (200)

```ts
{
  metrics: {
    windowHours: 24,
    eventsScored: number,
    percentFlagged: number,           // medium + above
    confirmedFraudCount: number,      // from labels in window
    falsePositiveCount: number,        // from labels in window
    falsePositiveRate: number,         // falsePositive / (falsePositive + confirmedFraud) over labels
  },
  liveFeed: Array<{
    id: string,                        // riskEventId
    userId: string | null,
    eventType: string,
    score: number,
    level: 'low' | 'medium' | 'high' | 'critical',
    confidence: number,
    actionTaken: string,
    createdAt: string,                 // ISO 8601
  }>,                                  // top 10 high-risk in last hour
  userHeatmap: Array<{
    userId: string,
    aggregatedScore: number,
    recentHighCount: number,           // high+ in last 24h
    lastEventAt: string,
  }>,                                  // top 20 users by aggregated risk in last 24h
  ruleHealth: Array<{
    ruleId: string,
    ruleName: string,
    firedCount24h: number,
    lastFiredAt: string | null,
    stale: boolean,                    // true if lastFiredAt > 30 days ago
  }>,
}
```

## Errors

- `401 Unauthorized`: not signed in.
- `403 Forbidden`: not admin or 2FA not completed.
- `500 Internal Server Error`: scoring service unreachable;
  the dashboard falls back to cached data and a warning is
  returned in the response (see Failure modes in plan §7.5).
