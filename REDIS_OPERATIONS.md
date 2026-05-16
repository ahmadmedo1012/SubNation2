# Redis Operations

On-call playbook for the SubNation2 Redis tier.

## 1. Health surface

| Endpoint | Reports | Auth |
|---|---|---|
| `GET /api/healthz/redis` | live ping result with `latencyMs` and per-check failure counter | none |
| `GET /api/healthz/ready` | aggregate of redis + neon + worker + socket | none |
| `GET /api/admin/diagnostics` | Redis connection status + Node memory/uptime | admin JWT |
| `GET /api/admin/observability/summary` | last-known worker heartbeat age | admin JWT |
| `GET /api/metrics` | `redis_*` metrics (see catalog below) | admin JWT or `METRICS_ADMIN_TOKEN` |

## 2. Metric catalog (Redis-specific)

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `redis_ops_total` | counter | `op, status` | every connect/reconnect/end + every `trackRedisOp(op, …)` call |
| `redis_errors_total` | counter | `reason` | client_error, reconnect, disconnect, command, connection_failed, ping_timeout, ping_error |
| `redis_ping_latency_seconds` | histogram | — | 30 s ping watchdog samples (since the new redis-client harden) |
| `redis_degraded_mode_total` | counter | `reason` | fires once per process boot when fallback is active (`missing_in_production`, `missing_in_dev`, `outage_in_dev`, `connect_failed_in_dev`) |

## 3. Triage

### Symptom: `/api/healthz/redis` returns 503 in production

```bash
# 1. Confirm REDIS_URL is set
render-mcp list_logs --resource srv-d7vv91tckfvc73evnccg \
  --text "REDIS_URL is missing"

# 2. If "missing" in recent logs → REDIS_URL was unset by a deploy
#    Restore via update_environment_variables.

# 3. If REDIS_URL set but ping failing → check Upstash/Render KV dashboard:
#    - is the database paused? (free-tier auto-pause)
#    - has the password rotated?
#    - has the host changed?
```

### Symptom: `redis_ping_latency_seconds` p95 spiking >100 ms

Likely network or Redis under load. Check:

- `redis_ops_total{op="ping",status="error"}` — non-zero means timeouts.
- Provider dashboard memory % — `allkeys-lru` evictions cause CPU
  pressure on free tier.
- Recent traffic surge — `http_requests_total` rate.

If the latency is a sustained issue, scale to a paid tier (Render KV
starter or Upstash pay-as-you-go).

### Symptom: `redis_degraded_mode_total{reason="missing_in_production"}` non-zero

The web service is in fallback mode. Rate-limit / dedup / Socket.IO are
single-instance only. Action:

```
1. Check Render env: is REDIS_URL still set?
2. Check Render KV / Upstash: is the database alive?
3. Re-trigger deploy if env was lost.
```

### Symptom: process exit-loop on Render

Logs show `Redis client error - required for production` followed by
`process.exit(1)` and immediate restart.

This is the **fail-closed** behaviour kicking in — the operator promised
Redis would work, the connection broke, the platform refuses to serve
traffic with a broken rate-limit state.

Action: investigate the upstream Redis provider; the platform self-heals
once Redis returns.

If Redis is genuinely down for a long stretch and you want to keep serving
traffic, **temporarily unset `REDIS_URL`** in Render env. The next boot
will fall back to in-memory mode (with the loud warning); restore once
Redis recovers.

### Symptom: alerting service over-firing

```
alerts_dispatched_total{outcome="delivered"} rising fast
alerts_dispatched_total{outcome="deduped"} ≈ 0
```

Dedup is failing — Redis is unreachable for the worker process. Check the
worker service logs; the alerting service falls open on Redis errors
(better to over-alert than to silently drop).

## 4. Maintenance

### Routine

- Once a week, glance at `redis_ping_latency_seconds` p95 — should sit
  under 50 ms. Sustained >100 ms is a scaling signal.
- Once a week, glance at `redis_degraded_mode_total` — should be zero in
  production after the first boot.

### Quarterly

- Memory utilisation in the Redis dashboard. Plan a tier upgrade when
  used > 60 % of limit. The free-tier `allkeys-lru` policy starts evicting
  rate-limit keys at high pressure.

### Rotating the Redis password

```
1. Provider dashboard → reset password → copy new URL
2. update_environment_variables serviceId=srv-d7vv91tckfvc73evnccg \
     envVars=[{key:"REDIS_URL", value:"<new-url>"}]
3. Render auto-redeploys both web + worker.
4. Verify: /api/healthz/redis returns 200 within 30 s of the redeploy.
```

## 5. Scaling thresholds

| Tier | Trigger to upgrade |
|---|---|
| Render KV free 25 MB | memory > 15 MB sustained 24 h, OR eviction events visible in dashboard |
| Upstash free 256 MB | memory > 150 MB sustained 24 h, OR daily QPS > 5K |
| Redis Cloud free 30 MB | memory > 20 MB sustained 24 h |
| Move to clustered Redis | when single-shard QPS > 50K/min sustained |

Record every tier change in Memory_MCP under the
`observability-seo-cwv-maturity:tier-decisions` entity per the spec's
free-tier discipline rule (Property 20).

## 6. Disaster recovery

| Scenario | Recovery |
|---|---|
| Redis provider outage | platform fail-closes (`process.exit(1)`); Render auto-restarts; reconnect strategy retries every 50 ms up to 500 ms cap. Mean recovery time = 30–60 s after Redis returns. |
| Redis data loss (free-tier persistence is none) | rate-limit / dedup / heartbeat keys all have short TTLs; recovery is automatic. No application-level state lives only in Redis. |
| Wrong `REDIS_URL` deployed | next boot fails closed in production. Roll back the env change; previous deploy stays live during the failure. |

## 7. Forbidden operations

- ❌ Never run `FLUSHALL` / `FLUSHDB` against the production Redis. Rate
  limit keys are kept short-TTL'd for a reason.
- ❌ Never use Redis as a transactional store for ledger / wallet /
  payment events. Those live in Neon. The `cache.ts` primitive is
  intentionally nudge-only — readers must tolerate staleness.
- ❌ Never store secrets (API keys, JWTs) in Redis. Sessions live in
  Postgres `sessions` table; tokens live in HttpOnly cookies. Redis is for
  ephemeral coordination, not persistent secret storage.
