# Contract: User Risk History

**Endpoint**: `GET /api/admin/risk/users/:userId/history`
**Auth**: admin + 2FA.

## Path parameters

- `userId` (uuid): the user id.

## Query parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `from` | ISO 8601 | (90 days ago) | Lower bound |
| `to` | ISO 8601 | (now) | Upper bound |
| `limit` | integer (1-200) | `50` | Page size |

## Response (200)

```ts
{
  user: {
    id: string,
    email: string | null,
    phone: string | null,
    createdAt: string,
    isActive: boolean,
  },
  riskTimeline: Array<{
    bucketStart: string,             // ISO 8601, hourly bucket
    aggregatedScore: number,         // avg score in bucket
    levelDistribution: { low: number, medium: number, high: number, critical: number },
  }>,
  eventLog: Array<{
    id: string,                      // riskEventId
    eventType: string,
    score: number,
    level: 'low' | 'medium' | 'high' | 'critical',
    actionTaken: string,
    createdAt: string,
    label: 'confirmed_fraud' | 'false_positive' | 'escalated' | null,
  }>,
  actionHistory: Array<{             // admin actions on this user from audit_logs
    action: 'lock' | 'unlock' | 'force_reauth' | 'require_approval',
    actor: string,                   // admin user id
    at: string,                      // ISO 8601
    reason: string | null,
  }>,
  featureSnapshot: {
    accountAgeDays: number,
    lifetimeTopupCount: number,
    lifetimeOrderCount: number,
    averageTopupAmount: number,
    stddevTopupAmount: number,
    recentFailedLogins: number,      // last 1h
    recentOtpRequests: number,       // last 1h
    recentTopupAmount: number,       // last 1h
    recentOrderCount: number,        // last 1h
    distinctCountriesLast30d: number,
  },
}
```

## Errors

- `404 Not Found`: user does not exist.
- `403 Forbidden`: not admin or 2FA not completed.
