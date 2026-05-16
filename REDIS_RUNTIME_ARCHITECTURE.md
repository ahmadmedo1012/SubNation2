# Redis Runtime Architecture

How Redis fits into the SubNation2 backend at runtime. Pair with
`REDIS_SETUP.md` for one-time provisioning.

## 1. Topology

```
┌──────────────────────────────────────────────────────────────────────┐
│  Render web (subnation2)                                             │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  backend/src/lib/redis-client.ts  (singleton)                │    │
│  │  ─ connect once on boot                                      │    │
│  │  ─ 30 s ping watchdog → redis_ping_latency_seconds histogram │    │
│  │  ─ event listeners → redis_ops_total + redis_errors_total    │    │
│  │  ─ trackRedisOp(op, fn) wrapper for hot paths                │    │
│  └──────────────────┬───────────────────────────────────────────┘    │
│                     │                                                │
│   rate-limit-redis  │  alerting-service     lib/cache.ts             │
│   (apiLimiter,      │  (dedup SETNX EX 300, (cacheGet/Set/Wrap,      │
│    authLimiter,     │   global INCR window) memory LRU fallback)     │
│    otpLimiters)     │                                                │
│                     │                                                │
│   /api/healthz/redis │ /api/healthz/worker (reads worker:heartbeat)  │
│                     │                                                │
│   lib/socket.ts (separate pubClient/subClient via                    │
│                  @socket.io/redis-adapter — not the singleton)       │
└─────────────────────┼────────────────────────────────────────────────┘
                      │
                      │  TCP redis:// (or TLS rediss://)
                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Redis (Render KV / Upstash / Redis Cloud / Aiven / DO)              │
└──────────────────────────────────────────────────────────────────────┘
                      ▲
                      │
┌─────────────────────┼────────────────────────────────────────────────┐
│  Render worker (subnation-worker)                                    │
│  ┌──────────────────┴───────────────────────────────────────────┐    │
│  │  same lib/redis-client.ts singleton (per-process)            │    │
│  └──────────────────┬───────────────────────────────────────────┘    │
│                     │                                                │
│   worker/heartbeat.ts                                                │
│   ─ SETEX worker:heartbeat 60 every 15 s                             │
│   ─ payload = { ts, version }                                        │
│                                                                      │
│   alerting-service evaluator                                         │
│   ─ runs in worker only (single-instance evaluator                   │
│      to avoid duplicate dispatch)                                    │
│   ─ reads worker:heartbeat, registry counters                        │
│   ─ SETNX dedup keys, INCR global rate-limit                         │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Active Redis users

| Subsystem | Keys / patterns | TTL | Purpose |
|---|---|---|---|
| `apiLimiter` (rate-limit-redis) | `rl:<ip-or-token>` | sliding 1 min | 300 reqs / minute |
| `authLimiter` | `rl:auth:<ip>` | 15 min | 10 attempts / 15 min |
| `otpPhoneLimiter` | `rl:otp-phone:<phone>` | 15 min | 3 OTP / 15 min |
| `otpIpLimiter` | `rl:otp-ip:<ip>` | 60 min | 10 OTP / hour |
| `worker:heartbeat` | single key | 60 s | freshness signal for `/api/healthz/worker` |
| Alerting dedup | `alert:dedup:<rule>|<labelHash>` | 300 s | drop duplicate alerts within 5-min window |
| Alerting global rate-limit | `alert:global:<minute>` | 70 s | hard cap of 30 alerts / minute |
| Health failure counters | `health:fail:<check>` | 60 s | tracks consecutive failures before flipping a check to `failing` |
| `lib/cache.ts` user-cache | `<caller-namespaced>` | caller-defined (default 60 s) | application-level read-through cache |
| Socket.IO adapter | internal pub/sub channels | n/a | cross-instance event fanout |

## 3. Connection sharing rules

- **One singleton** for general commands (rate limit, alerting dedup,
  worker heartbeat, cache, health checks). All callers go through
  `getRedisClient()` or `requireRedisClient()`.
- **One pair** of dedicated pub/sub clients for Socket.IO's Redis adapter
  (`createClient + duplicate` in `lib/socket.ts`) — Socket.IO requires
  separate pub/sub clients that can't be re-used for general commands.

That's exactly **3 connections per process**. Free-tier Redis providers
typically allow 30+ connections, so we're far under the limit even when
horizontally scaled.

## 4. Failure modes

| Failure | Behaviour | Operator signal |
|---|---|---|
| `REDIS_URL` not set in production | fall back to in-memory; `redis_degraded_mode_total{reason="missing_in_production"}` increments | loud `category:"monitoring"` log line on every boot |
| Connection fails at boot in production | `process.exit(1)` — the platform fails closed | Render marks deploy as failed; previous deploy stays live |
| Connection drops mid-flight in production | `error` event → `process.exit(1)`. Render auto-restarts the instance and reconnect attempts begin via the redis client's `reconnectStrategy: retries * 50 ms (capped 500 ms)`. | `redis_errors_total{reason="client_error"}` spike followed by service restart |
| Ping watchdog timeout (>1 s) | `redis_errors_total{reason="ping_timeout"}` increments; service stays up | latency histogram surfaces the slow ping |
| Single command fails | `trackRedisOp` increments `redis_ops_total{op,status="error"}` and `redis_errors_total{reason="command"}`; caller decides whether to retry | per-op metrics |
| Alerting service Redis dedup unavailable | dedup fails open (potential duplicate alerts, never missed alerts); `redis_errors_total{reason="command"}` | `alerts_dispatched_total{outcome:"deduped"}` rate drops to ~0 |

## 5. Bounds & sizing

| Resource | Free-tier (Render KV / Upstash 256 MB) | When to upgrade |
|---|---|---|
| Total memory | 25–256 MB | when key count × avg value > 60% of limit |
| Connections | 30+ | with our 3-per-process pattern, single instance never approaches |
| Eviction policy | `allkeys-lru` (free tiers) | switch to `noeviction` for paid tier so rate-limit keys are never evicted under pressure |
| Persistence | none on free tiers | acceptable — every key has a short TTL anyway |
| QPS budget | Upstash free 10K/day | logging request volume tells you if you need to upgrade |

## 6. Why the singleton is not a hot-reload concern

`lib/redis-client.ts` initialises lazily but only resolves once via
`initPromise`. Subsequent `initRedisClient()` calls return the same
in-flight promise. The web app calls it once from `bootstrap()` in
`server.ts`; the worker calls it once from `startWorker()`. There is no
window during which two parallel connections can coexist.

## 7. Cross-document references

- `REDIS_SETUP.md` — provisioning + env vars
- `CACHE_STRATEGY.md` — what to cache and what NOT to
- `REDIS_OPERATIONS.md` — incident triage / scaling thresholds
- `OBSERVABILITY_SETUP.md` §6 — health endpoints
- `METRICS_AND_MONITORING.md` — full metric catalog
- `ALERTING_ARCHITECTURE.md` — Redis-dependent alert rules
