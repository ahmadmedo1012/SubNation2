# Contract: Risk Rules + Config

**Endpoints**:
- `GET /api/admin/risk/rules` — list all rules
- `PUT /api/admin/risk/rules/:id` — edit a rule (toggle or update expression)
- `GET /api/admin/risk/config` — read singleton config
- `PUT /api/admin/risk/config` — update singleton config

**Auth**: admin + 2FA. All writes audit-logged.

## GET /api/admin/risk/rules

### Response (200)

```ts
{
  items: Array<{
    id: string,
    name: string,                    // unique, stable
    description: string,
    expression: { /* DSL */ },
    enabled: boolean,
    version: number,
    createdBy: string,
    createdAt: string,
    updatedBy: string,
    updatedAt: string,
  }>,
}
```

## PUT /api/admin/risk/rules/:id

### Request body

```ts
{
  description?: string,
  expression?: { /* DSL */ },
  enabled?: boolean,
  // version is incremented automatically; rollback is to a previous version
  // via a separate endpoint (POST /api/admin/risk/rules/:id/rollback) — out of scope here
}
```

### Response (200)

```ts
{
  // updated rule, same shape as GET
}
```

### Errors

- `400 Bad Request`: invalid DSL expression.
- `404 Not Found`: rule does not exist.
- `403 Forbidden`: not admin or 2FA not completed.

## GET /api/admin/risk/config

### Response (200)

```ts
{
  thresholds: { low: number, medium: number, high: number, critical: number },
  allowlist: { ips: string[], devices: string[], phones: string[] },
  autoBlockEnabled: { softBlock: boolean, hardBlock: boolean, alert: boolean },
  modelEnabled: boolean,             // Phase 3
  updatedBy: string,
  updatedAt: string,
}
```

## PUT /api/admin/risk/config

### Request body

```ts
{
  thresholds?: { low: number, medium: number, high: number, critical: number },
  allowlist?: { ips?: string[], devices?: string[], phones?: string[] },
  autoBlockEnabled?: { softBlock?: boolean, hardBlock?: boolean, alert?: boolean },
  modelEnabled?: boolean,
}
```

### Validation

- `thresholds.low < thresholds.medium < thresholds.high <
  thresholds.critical`; all in `[0, 100]`.
- `autoBlockEnabled.hardBlock = true` requires
  `modelEnabled = true`; otherwise the request is rejected.

### Response (200)

```ts
{
  // updated config, same shape as GET
}
```

### Errors

- `400 Bad Request`: invalid thresholds; hardBlock without modelEnabled.
- `403 Forbidden`: not admin or 2FA not completed.
