# Neon Cold-Start Runbook — SubNation

> Status: CURRENT @ 2026-10-06 (R118).
> Scope: what happens when the Neon compute auto-suspends, how to tell a
> cold-start from a real outage in under two minutes, and the mitigation
> menu. Companion: `docs/operations/FINAL_MONITORING.md` (the weekly
> checklist + alert rules), `docs/deployment/NEON_IDLE_ECONOMICS.md` (the
> free-tier CU math), `docs/deployment/COOLIFY_FINAL_SETUP.md` (resources).
>
> Production DB (verified R118, 2026-10-06 — `docs/inspection-r118/
> R118-A3-database.md`): Neon Postgres 17, endpoint
> `ep-spring-term-avwgxrte-pooler.c-11.us-east-1.aws.neon.tech` (PgBouncer
> pooled), branch `br-lucky-bird-avkvvzo7`, region us-east-1, 12 MB /
> 42 tables.

## 1. What cold-start is

Neon's free compute **scales to zero**: after ~5 minutes with no connections
the compute suspends (auto-suspend is a control-plane setting — it is not
visible at the SQL level; R118-A3 §Neon-specific checks). The next
connection pays a **resume penalty of 0.5–2 s** before the first query runs:

- R117 live measurement (2026-10-05, probe-host→Neon `SELECT 1`):
  **1,326 ms** cold connect vs 215 ms warm
  (`docs/inspection-r117/live-production-smoke.md:80`).
- R118-A3 measurement (2026-10-06): three fresh direct connects →
  **1,434 / 1,525 / 1,402 ms** to first `SELECT 1` (≈1.4 s steady).

Two further penalties stack on the first request after idle, both from
`R118-A6-performance.md` F-3:

- **Pool reconnect** — the pg pool drops idle clients after
  `idleTimeoutMillis = 30_000` (`shared/db/src/index.ts:43,82`), so the first
  request also pays a fresh TLS handshake to us-east-1 (~0.3–0.5 s from the
  EU origin).
- **No edge cache** — Cloudflare is DNS-only (grey cloud, verified R118:
  no `cf-ray` on any response), so the `Cache-Control: s-maxage=60` on
  catalog routes (`backend/src/routes/products.ts:44`) currently caches
  nowhere but the visitor's browser.

The keep-alive cron was **removed by design** in R117 for free-tier quota
reasons (`backend/src/jobs/cron.ts:241-269`) — see §6 before considering one.

## 2. How it manifests (symptoms)

| Symptom | Cause | Expected duration |
|---|---|---|
| `/api/healthz/summary` returns `"degraded"` shortly after an idle window | The first measured Neon probe exceeded the 500 ms degraded threshold (`backend/src/routes/health.ts`) — R117 root-caused this exact flap live (5/5 degraded aggregates during idle; all-ok once warmed) | One aggregate cycle (15 s cache) |
| First storefront request after idle takes 1–2.5 s | Pool reconnect + Neon resume (§1) — one visitor per idle period | One request |
| `/api/healthz/ready` (admin view) shows the neon check yellow while everything else is green | Same probe latency, seen with per-check detail | One cycle |
| Product-detail cache miss ~+300 ms even when warm | NOT cold-start — that is the us-east-1 RTT tax (R118-A6 F-1) | Constant |

Note: production traffic rides the **pooled** endpoint (PgBouncer), so real
requests amortize the resume; the visible flaps are the health aggregate's
first probe and the first storefront hit (R118-A3).

## 3. What already absorbs it (R117 warmup probe)

`checkNeonWith` (`backend/src/routes/health.ts:241-263`) runs an
**unmeasured warmup probe first** — the resume penalty is absorbed inside
the health aggregate — and then measures steady-state:

- A genuine Neon outage still escalates exactly as before via the normal
  streak counters (`health.ts:297-308`) — the warmup probe only filters the
  cold-resume case, not real failures.
- Worst case (5 s warmup + 5 s measured) exceeds the 8 s aggregate bound →
  `boundedAggregate` (`health.ts:730-757`) returns a never-cached degraded
  snapshot and resets in `finally` — no wedge, no stale cache (R118-A1
  VERIFIED-OK #5).
- The warmup probe protects **the health aggregate only** — it does not
  warm the path for `/api/products` (R118-A6 F-3).
- It is in the code at HEAD; the **live deploy must be current** for this
  behavior to exist in production (live was behind main at R118 —
  `docs/operations/OPERATOR_ACTIONS_R118.md` action 1).

## 4. What to check (the two-minute triage)

```bash
# 1. Hit the public summary twice, ~30 s apart (its cache is 15 s):
curl -s https://subnation.ly/api/healthz/summary
sleep 30
curl -s https://subnation.ly/api/healthz/summary

# 2. Cold start: first hit "degraded", second hit {"status":"ok"} → done.
#    Both "degraded" → go to §5.

# 3. Admin detail view (requires the admin session — bare curl is 401 by
#    design, see FINAL_MONITORING §2; A7 F24):
#    /api/healthz/ready — per-check detail incl. the neon latency check.
```

- Second hit `ok` → cold start, no action. The store self-heals.
- Storefront check (optional): `curl -s -o /dev/null -w '%{time_total}\n'
  https://subnation.ly/api/products` twice — first hit pays the resume,
  second sits near the network floor (~0.78 s from the R118 census sandbox;
  `R118-A6-performance.md` §1).

## 5. When to panic

Escalate to a real incident when **any** of these hold:

- `/api/healthz/summary` stays `degraded` for **> 10 minutes** with the DB
  demonstrably awake (two hits 30 s apart both degraded, §4).
- `/api/healthz/ready` shows the neon check failing with **high latency on
  a warm connection** (not just the first probe), or repeated probe errors.
- The storefront API errors (5xx/timeouts), not merely one slow request.

Then follow `docs/operations/FINAL_MONITORING.md` (triage table + alert
rules) and, if data is at risk, `docs/DISASTER_RECOVERY.md`. Neon status:
check the Neon project console (the app's DB is project `calm-art-99771185`
per `docs/NEON_MCP_SETUP.md` — endpoint verified live R118).

## 6. Mitigation menu (operator decisions, not defaults)

| Option | Effect | Cost / caveat |
|---|---|---|
| **Accept it** (do nothing) | One 1–2.5 s outlier per idle period; React Query retry already masks it for users | Zero. This is the current state (R118-A6 F-3b). |
| **Re-enable Cloudflare proxy (orange cloud)** | The edge serves `s-maxage=60` catalog + sitemap and `immutable` assets — most anonymous cold traffic never reaches Neon (R118-A6 F-3a; also closes the "no edge cache" gap) | **Loop lesson first**: the R116 Cloudflare loop was caused by the in-app hostname redirect (removed in `f10bb9b`), not the proxy itself — but do NOT re-proxy until you have verified there is no hostname-rewriting redirect at any layer. The planned Traefik www→apex 301 (`docs/operations/WWW_TO_APEX_301.md`) is a permanent redirect at the origin — verify one www URL end-to-end (curl -I, expect 301 → apex, then 200) after any re-proxy. Also re-check the R117-A4 DNS-only observations (`docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md` §8). TLS/origin config: CLOUDFLARE_FINAL_CUTOVER §1–§4 describes the proxied setup. |
| **Move Neon to eu-central-1 (Frankfurt)** | RTT ~100 ms → ~5–10 ms: cuts ~200–300 ms off **every uncached DB request** (R118-A6 F-1: detail ≈ 3 sequential stages, catalog ≈ 2). Data is tiny (59 products / 263 variants / 12 MB) — a branch-copy + `DATABASE_URL` repoint is an S/M-effort move | Does **not** remove cold-start (auto-suspend is independent of region) — it shortens every warm path. Numbers + procedure sketch: `R118-A6-performance.md` F-1. |
| **Keep-alive ping (NOT recommended)** | A `SELECT 1` every <5 min would keep the compute awake | A 4-min keep-alive ≈ **~190 CU-h/month** on the 0.25 CU compute ≈ the entire Neon free allowance (R118-A6 F-3c; economics: `docs/deployment/NEON_IDLE_ECONOMICS.md`). The old keep-alive cron was removed for exactly this reason (`jobs/cron.ts:241-269`). |

### Related env knob: `DB_IDLE_TIMEOUT_MS=240000`

R118-A6 F-6: the pg pool's `idleTimeoutMillis` defaults to 30 s
(`shared/db/src/index.ts:43,82` — env `DB_IDLE_TIMEOUT_MS`, unset = 30000),
so on a low-traffic store most requests >30 s
apart open a **new** TLS connection to us-east-1 — stacking ~0.3–0.5 s onto
precisely the requests that may also pay the cold-start. Setting the env
(the code already reads it) to **4 minutes** — just under Neon's 5-min
suspend — removes the churn for sub-4-minute gaps while suspended
connections still die at 5 min and are replaced lazily by the pool's error
handling. No code change; operator decision
(`docs/operations/OPERATOR_ACTIONS_R118.md` action 7).
