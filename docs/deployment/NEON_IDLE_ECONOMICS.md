# NEON IDLE ECONOMICS — the single-instance contract (R112, final)

> Why this stack keeps Neon's free-tier compute allowance alive by default,
> proven from code at HEAD `521234f`. This is the economics gate for the
> cutover: if any claim here regresses, the free-tier Neon budget burns.

## 1. The problem this design solves (the Neon-killer lesson)

Neon free tier allows ~192 compute-hours/month (an always-on 0.25 CU × 30
days ≈ 180-190 h). The r109 B6 audit **proved live** that the pre-r108
scheduler topology burned Neon 24/7: the PG-lease leadership refresher alone
issued **92.4% of all UPDATE traffic** on the database — a heartbeat every
few seconds, around the clock ≈ 720 h/month of kept-awake compute. Autosuspend
never triggered because the lease never went idle. That build is still what
production runs until the cutover; the fix ships with the first r112 boot.

## 2. What `SINGLE_INSTANCE_MODE=true` means (proven from source)

`backend/src/lib/web-scheduler.ts:133` reads the flag; `:301-315` builds a
**synthetic in-process leadership object** instead of calling
`acquireSchedulerLeadership()`:

```
instanceId: `single-instance-${process.pid}`
isLeader:   true (getter — for the whole process lifetime)
release():  no-op (nothing to hand over — there is no other instance)
```

Therefore, in this mode the process performs:

- ❌ **no leader election** (no Redis `scheduler:leader` lock loop)
- ❌ **no PG-lease heartbeat** (the Neon-killer is structurally absent)
- ❌ **no periodic coordination query of any kind** — zero idle DB chatter
- ✅ **schedulers still run** — `if (leadership.isLeader) startLeaderJobs()`
  fires cron/watchers/alerting/boot one-shots in-process
  (`web-scheduler.ts:333-341`; the boot log line enumerates all 16 one-shots:
  sessionPrune … loginAttemptsRetention, auditLogsRetention)
- ✅ **cron inventory remains complete** — the full slot list in
  `backend/src/jobs/cron.ts` runs (hourly pulses, the 05:00 UTC retention
  slot, OTP prune every :15, flash-sale catch-up…); r110 pinned the cron
  inventory and isolated the 05:00 slot
- ✅ **scheduler state is observable** — mode `"single"` in the admin
  readiness snapshot (`/api/healthz/summary` + admin observability; r110 made
  the no-Redis single-instance shape read as OK, not degraded)

Regression suite: `backend/src/lib/__tests__/web-scheduler-single-instance.test.ts`
(6 tests) + the demotion/dedup suites from r110.

## 3. The required companion flags (both verified in `env.compose.example`)

| Flag | Production value | Why |
|---|---|---|
| `DISABLE_WEB_SCHEDULERS` | **must be `false`** (or empty) | `true` kills every cron in the web process; no dedicated worker exists in this topology — the crons would simply never run (`web-scheduler.ts:135-152`) |
| `DISABLE_BOOT_MIGRATIONS` | `false` | emergency-only escape hatch |
| `REDIS_URL` | **unset** | no Redis in the target architecture; the app's rate-limiting/caching fall back to in-process implementations by design |

## 4. The scaling law (MUST NOT be violated)

**`SINGLE_INSTANCE_MODE=true` ⇒ exactly ONE subnation replica.** The mode is
a declaration, not a lock: there is no election to stop a second replica,
and every cron/watcher/alert would **double-run** (double OTP prunes, double
alert bursts, double inventory sweeps). `docker-compose.yml`'s header,
`deploy/env.compose.example`, and the preflight script all state it;
`scripts/final-cutover-preflight.sh` §C verifies the flag, and the operator
checklist forbids scaling. Horizontal scale requires unsetting the flag
(back to r107 election topology + Redis + a worker tier).

## 5. Idle DB activity budget (what Neon actually sees per day at rest)

| Source | Idle rate | Note |
|---|---|---|
| Scheduler coordination | **0 queries** | the entire point of §2 |
| Health probes | **0 DB queries** | `/api/healthz/live` is zero-I/O by design; `/api/healthz` reads the boot-gate latch (in-memory) post-startup; Docker/Traefik probe every 30 s |
| Keepalive/self-ping | **none — forbidden** | deleted in r110 (`cron.ts` grave marker); no service may wake the DB on a schedule |
| Cron jobs | ~fixed, bounded | hourly pulses touch their own small tables; the 05:00 UTC slot batches retention (login_attempts, audit_logs, OTP prune batching r110); each is a short burst then idle |
| Real traffic | on demand | first request after idle pays the Neon wake (~1.8 s measured, r98) — the cold-start fast path (r104) keeps boot off the DB until necessary |

Net effect: with no customers online, Neon compute sleeps. The free-tier
allowance is spent only when the store is actually used.

## 6. Connection pool behavior

`shared/db` runs a Neon-aware pool (acquire timeout + pool ceiling tuned in
r108 openwa parity + r109 pool hardening): connections are held per-request,
released immediately, and the pool does not poll. Combined with §5, idle
hours hold **zero open queries**. (Neon's proxy holds the TCP endpoint; a
held idle TCP connection does not count as compute activity.)

## 7. Why Redis is unnecessary here (and stays out)

Every Redis consumer in the codebase has a designed in-process fallback:
rate limiting (in-memory buckets), catalog cache (in-process LRU with the
r111 byte budget), session store (PG), scheduler leadership (§2 — removed
entirely). Redis existed for the multi-instance Render topology; the
single-instance Oracle topology has one process, one schedule owner, one
rate-limit namespace. Adding Redis back would add a service to run, a
secret to rotate, and a network hop — for zero capability.

## 8. Startup traffic (bounded, one-shot)

Cold boot sequence (server.ts boot gate): bind port → answer 503
"starting" → run `bootMigrations()` (probe-based: **zero DDL at steady
state**, r111 static-pass) → sequential boot one-shots (7 s delay,
`BOOT_ONE_SHOT_DELAY_MS`) → open the readiness gate. First-boot after
cutover additionally applies the 4 pending non-destructive migrations
(r111 T3, incl. V1-M20). After that, restarts are quiet: no re-DDL, no
burst beyond the one-shots' small queries.

## 9. How to re-prove the economics at runtime (post-cutover)

```bash
# on the VM — after 1 hour of idle, expect ZERO recent loglines like
# "scheduler" coordination or lease refresh, and a sleeping Neon compute:
docker logs subnation --since 60m | grep -i "lease\|election"   # → empty
# Neon console → the compute's "Active time" graph should flatline at idle
```

Both checks are in `docs/operations/FINAL_MONITORING.md` §"what is normal".
