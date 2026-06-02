# Contract: Risk Events (Review Queue + Investigation)

**Endpoints**:

- `GET /api/admin/risk/events` — review queue (filterable list)
- `GET /api/admin/risk/events/:id` — single event (investigation view)
- `POST /api/admin/risk/events/:id/label` — single label
- `POST /api/admin/risk/events/bulk-label` — bulk label

**Auth**: admin + 2FA.

## GET /api/admin/risk/events

### Query parameters

| Param        | Type                                      | Default | Description                                  |
| ------------ | ----------------------------------------- | ------- | -------------------------------------------- |
| `level`      | `low` \| `medium` \| `high` \| `critical` | (none)  | Filter by level                              |
| `eventType`  | string                                    | (none)  | Filter by event type (e.g., `login_failure`) |
| `from`       | ISO 8601                                  | (none)  | Created-at lower bound                       |
| `to`         | ISO 8601                                  | (none)  | Created-at upper bound                       |
| `ruleFired`  | string                                    | (none)  | Filter by rule name                          |
| `userSearch` | string                                    | (none)  | Search by user id or email (prefix match)    |
| `cursor`     | string                                    | (none)  | Opaque pagination cursor                     |
| `limit`      | integer (1-100)                           | `50`    | Page size                                    |

### Response (200)

```ts
{
  items: Array<{
    id: string,
    userId: string | null,
    eventType: string,
    score: number,
    level: 'low' | 'medium' | 'high' | 'critical',
    confidence: number,
    ruleFired: string[],
    actionTaken: 'none' | 'log' | 'soft_block' | 'hard_block' | 'alert',
    createdAt: string,
  }>,
  nextCursor: string | null,
}
```

## GET /api/admin/risk/events/:id

### Response (200)

```ts
{
  id: string,
  userId: string | null,
  eventType: string,
  score: number,
  level: 'low' | 'medium' | 'high' | 'critical',
  confidence: number,
  ruleFired: string[],
  statisticalSignals: {
    z_topup?: number,
    velocity_orders_1h?: number,
    velocity_orders_6h?: number,
    velocity_orders_24h?: number,
    geo_new_country?: boolean,
    geo_distinct_countries_30d?: number,
    time_of_day_deviation?: number,
    failed_logins_last_10m?: number,
    otp_requests_last_1h?: number,
    [key: string]: number | boolean | string | null,
  },
  mlScore: number | null,           // Phase 3
  topFeatures: Array<{              // Phase 3
    feature: string,
    shap: number,
    description: string,            // human-readable
  }> | null,
  actionTaken: 'none' | 'log' | 'soft_block' | 'hard_block' | 'alert',
  ipAddress: string,                // redacted for non-admin IP ranges
  userAgent: string,                // truncated to 256 chars
  createdAt: string,
  user: {                           // snapshot at time of event
    id: string,
    email: string | null,
    phone: string | null,
    createdAt: string,
  } | null,
  labels: Array<{
    label: 'confirmed_fraud' | 'false_positive' | 'escalated',
    labeledBy: string,              // admin user id
    labeledAt: string,
    notes: string | null,
  }>,
}
```

### Errors

- `404 Not Found`: event does not exist.

## POST /api/admin/risk/events/:id/label

### Request body

```ts
{
  label: 'confirmed_fraud' | 'false_positive' | 'escalated',
  notes?: string,                   // <= 2000 chars
}
```

### Response (200)

```ts
{
  id: string,                        // label id
  riskEventId: string,
  label: 'confirmed_fraud' | 'false_positive' | 'escalated',
  labeledBy: string,
  labeledAt: string,
  notes: string | null,
}
```

### Errors

- `404 Not Found`: event does not exist.
- `409 Conflict`: event already has a label.

## POST /api/admin/risk/events/bulk-label

### Request body

```ts
{
  eventIds: string[],                // <= 100
  label: 'confirmed_fraud' | 'false_positive' | 'escalated',
  notes?: string,
}
```

### Response (200)

```ts
{
  applied: number,                   // count of events labeled
  skipped: Array<{ eventId: string, reason: 'not_found' | 'already_labeled' }>,
}
```

### Errors

- `400 Bad Request`: `eventIds` empty or > 100.
- `403 Forbidden`: not admin or 2FA not completed.
