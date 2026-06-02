# Contract: Admin Actions on Users

**Endpoints**:

- `POST /api/admin/risk/users/:userId/lock` — set `users.isActive=false`
- `POST /api/admin/risk/users/:userId/unlock` — set `users.isActive=true`
- `POST /api/admin/risk/users/:userId/force-reauth` — invalidate sessions; force re-auth via existing provider
- `POST /api/admin/risk/users/:userId/require-approval` — flag user so wallet/order state changes require admin approval

**Auth**: admin + 2FA. All writes audit-logged with `action='risk.<action_name>'`,
`target=<userId>`, `actor=<admin_user_id>`, `meta={reason}`.

**Constitution alignment**:

- Principle I (Financial Integrity): none of these endpoints are installed on
  the purchase critical path. `force-reauth` and `require-approval` change a
  flag the wallet/order routes consult on the _next_ request — they never
  block an in-flight transaction.
- Principle II (Passwordless Customer Auth): `force-reauth` reuses the
  existing Google / Telegram / WhatsApp providers. It deletes
  `sessions` rows so the next request restarts the existing flow; it never
  introduces a new auth path.

## Path parameters

- `userId` (uuid): the customer user id (NOT an admin user id).

## Request body (shared)

```ts
{
  reason?: string,                   // <= 500 chars; written into audit_logs.meta.reason
}
```

## POST /api/admin/risk/users/:userId/lock

### Response (200)

```ts
{
  userId: string,
  isActive: false,
  lockedAt: string,                  // ISO 8601
  auditLogId: string,
}
```

### Errors

- `404 Not Found`: user does not exist.
- `409 Conflict`: user is already locked.

## POST /api/admin/risk/users/:userId/unlock

### Response (200)

```ts
{
  userId: string,
  isActive: true,
  unlockedAt: string,
  auditLogId: string,
}
```

### Errors

- `404 Not Found`: user does not exist.
- `409 Conflict`: user is not currently locked.

## POST /api/admin/risk/users/:userId/force-reauth

### Behavior

- Writes one row to `risk_events` with `eventType='admin_force_reauth'`,
  `actionTaken='soft_block'`, `score=0`, `level='low'` (the score is
  irrelevant here — this is an admin-initiated action, not a detection).
- Deletes all rows from `sessions` where `user_id=:userId`. The next request
  from the user's browser receives a 401 and re-enters the existing provider
  flow.
- Writes to `audit_logs` with `action='risk.force_reauth'`.

### Response (200)

```ts
{
  userId: string,
  sessionsInvalidated: number,
  riskEventId: string,               // the soft_block row created
  auditLogId: string,
}
```

### Errors

- `404 Not Found`: user does not exist.

## POST /api/admin/risk/users/:userId/require-approval

### Behavior

- Adds `userId` to `risk_config.requireApprovalUserIds` (jsonb array on the
  singleton config row).
- The wallet-topup and order-create routes consult this list on every
  request; if the requesting user is in it, the route returns
  `202 Accepted` with `pendingApproval: true` and creates an
  `admin_alerts` entry for review.
- Removable via `DELETE /api/admin/risk/users/:userId/require-approval`
  (out of scope for this contract; same auth + audit pattern).

### Response (200)

```ts
{
  userId: string,
  requireApprovalSetAt: string,
  auditLogId: string,
}
```

### Errors

- `404 Not Found`: user does not exist.
- `409 Conflict`: user is already in the require-approval list.

## Common errors

- `401 Unauthorized`: not signed in.
- `403 Forbidden`: not admin or 2FA not completed.
- `400 Bad Request`: `reason` exceeds 500 chars.
