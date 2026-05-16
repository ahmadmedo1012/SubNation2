# Redis Setup

Operator-facing setup guide. Pair with `REDIS_RUNTIME_ARCHITECTURE.md` for
the design, `CACHE_STRATEGY.md` for read-through patterns, and
`REDIS_OPERATIONS.md` for incident triage.

## 1. What needs to be true for production

The backend code path expects exactly **one** environment variable:

```
REDIS_URL=redis[s]://[user:]<password>@<host>:<port>
```

That's it. Every Redis-dependent system (rate limiting, Socket.IO adapter,
worker heartbeat, alerting dedup, alerting global rate-limit, the
`lib/cache.ts` primitive, the extended `/api/healthz/*` endpoints) reads
from the singleton in `backend/src/lib/redis-client.ts`, which connects
exactly once at boot using `REDIS_URL`.

Boot policy:

| Scenario | Behaviour |
|---|---|
| `REDIS_URL` set, connection succeeds | Normal operation. `redis_ops_total{op="connect", status="success"}` increments once. |
| `REDIS_URL` unset, `NODE_ENV=production` | Loud `category:"monitoring"` log line, `redis_degraded_mode_total{reason="missing_in_production"}` increments. **In-memory fallback active**, multi-instance state is per-instance. Single-instance deployments still function. |
| `REDIS_URL` unset, `NODE_ENV=development` | Quiet info log; in-memory fallback is fine for dev. |
| `REDIS_URL` set, connection fails in production | **`process.exit(1)`**. The platform fails closed rather than serve traffic with broken rate limits. |
| `REDIS_URL` set, connection fails in dev | Warns + falls back. |

## 2. Pick one provider

Three options, pick whichever fits your billing posture:

### A. Render's free-tier KV (one-click via blueprint or MCP)

`render.yaml` already declares the service. To create it:

```bash
# Via Render MCP — single call, no billing
create_key_value name=subnation-redis plan=free region=oregon
```

After creation, Render auto-injects `REDIS_URL` into the web + worker
services because `render.yaml` has:

```yaml
- key: REDIS_URL
  fromService:
    type: redis
    name: subnation-redis
    property: connectionString
```

Free tier: 25 MB, `allkeys-lru` eviction. Sufficient for rate-limit /
session / dedup keys at SubNation's current scale.

### B. Upstash Redis (free tier 256 MB)

Sign up at https://upstash.com, create a Redis database, copy the
**connection URL** (not the REST URL, not the REST token). It looks like:

```
rediss://default:<random-password>@<region>-<name>-<id>.upstash.io:<port>
```

Then via Render MCP `update_environment_variables`:

```
REDIS_URL=<that URL>
```

Use `rediss://` (TLS) — Upstash requires it.

### C. Redis Cloud (free 30 MB)

Same shape — sign up, create a database, copy the connection URL, paste as
`REDIS_URL`.

## 3. Setting REDIS_URL on Render

Two paths:

**Render dashboard** → service → Environment → add `REDIS_URL` →
save → triggers a redeploy.

**Render MCP** (no dashboard click):

```
update_environment_variables serviceId=srv-d7vv91tckfvc73evnccg \
  envVars=[{key:"REDIS_URL", value:"<paste-url-here>"}]
```

Note: the second tool *merges* with existing env by default — your other
env vars are preserved.

## 4. Verify production after setting REDIS_URL

```bash
# 1. Health endpoints all flip to "ok"
curl https://subnation2.onrender.com/api/healthz/ready | jq '.checks'
# expect: redis.status="ok", neon.status="ok", worker.status="ok", socket.status="ok"

# 2. Redis ping latency surfaces on /api/metrics
curl -H "Authorization: Bearer $METRICS_ADMIN_TOKEN" \
  https://subnation2.onrender.com/api/metrics | grep redis_ping_latency_seconds

# 3. Worker heartbeat freshness
curl https://subnation2.onrender.com/api/healthz/worker | jq '.'
# expect: status="ok", lastCheckedAt within last 60s

# 4. No more "REDIS_URL is missing" log lines
render-mcp list_logs --resource srv-d7vv91tckfvc73evnccg --text "REDIS_URL is missing"
# expect: empty after the post-set deploy
```

## 5. What to set alongside REDIS_URL

These don't depend on Redis but are ramped together:

| Var | Purpose | Recommended |
|---|---|---|
| `METRICS_ADMIN_TOKEN` | static token for `/api/metrics` | random ≥32 chars (`openssl rand -hex 32`) |
| `ALERTING_ENABLED` | flip to `true` only after 24 h of dark-launch logs look clean | start `false` |
| `DISCORD_WEBHOOK_URL` | optional alert channel | empty if not used |
| `GENERIC_ALERT_WEBHOOK_URL` | optional alert channel | empty if not used |
| `ALERT_AUTH_FAILURE_DELTA` | per-eval-window auth failures threshold | 20 (default) |
| `ALERT_LOCKOUT_DELTA` | per-eval-window lockouts threshold | 10 (default) |
| `ALERT_FIREBASE_FAIL_DELTA` | per-eval-window firebase verifyIdToken failures threshold | 5 (default) |

## 6. Worker service

Provisioning the Redis instance is necessary but not sufficient — the
**worker service** also has to exist (it's the process that writes
`worker:heartbeat` and runs the alerting evaluator). Two options:

1. Re-apply `render.yaml` as a Render Blueprint (dashboard → New →
   Blueprint → point at this repo). The `subnation-worker` entry creates
   the worker service.
2. Or temporarily disable the heartbeat alert and run cron in the web
   process — but this loses cross-instance heartbeat freshness if you ever
   scale the web tier.

Free-tier worker is not available on Render (workers need `starter` ≥). If
that's a billing concern, skip the worker for now — the web service still
functions; only `worker_heartbeat_missing` alert and the alerting
evaluator are inactive.
