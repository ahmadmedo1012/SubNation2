# Final Monitoring Runbook — SubNation (self-hosted VM + Coolify)

> What to watch, what the app already tells you, what "normal" looks like, and
> the one traffic rule that must never be broken. Companion docs:
> `docs/deployment/ORACLE_FINAL_SETUP.md` (VM hardening — the original
> provisioning guide, Oracle era), `docs/deployment/
> COOLIFY_FINAL_SETUP.md` (resources), `docs/DISASTER_RECOVERY.md` (backups).
>
> **Observed host (R118, 2026-10-06):** the live VM is a Contabo VPS (not
> Oracle — R117 live probe). Every command below is host-neutral and works
> as written; the Oracle-era guides stay as historical provisioning
> references.

## 1. What to monitor on the VM

Weekly (or during an incident) — all from the host shell:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'   # subnation + openwa: Up, (healthy)
df -h /var/backups /var/log /                        # backups + logs headroom
free -m                                              # RAM; Node RSS via: docker stats --no-stream
docker logs --tail 100 subnation                     # pino JSON, one line per event
docker logs --tail 100 openwa                        # gateway (digits masked — see LOGGING doc)
sudo fail2ban-client status sshd                     # expect: Currently banned: 0
```

- **docker ps health:** both services `Up (healthy)`. The `subnation`
  healthcheck hits `/api/healthz` (30 s interval, 150 s start period);
  `openwa` hits `/healthz:2785` (10 s start period) — `docker-compose.yml:121-186`.
- **Disk:** backups (`/var/backups/subnation`, 14 dumps ≈ MBs) + docker
  json-file logs (capped 10 MB × 3 per service — see
  `docs/operations/LOGGING_AND_RETENTION_FINAL.md`).
- **Memory:** Node RSS (single container, no swap-swap-swap: 4 GB swapfile at
  swappiness 10 is the VM safety net, not a license).
- **fail2ban:** sshd jail active (`ORACLE_FINAL_SETUP.md` §7 — Oracle-era
  provisioning guide; apply the equivalent hardening on the Contabo host).

## 2. What the app exposes

The `/api/healthz` family (`backend/src/routes/health.ts`):

| Route | Auth | Meaning |
|---|---|---|
| `/api/healthz` | public | **Readiness gate.** During boot (pool init + migrations) every `/api/healthz*` path answers **503 `{"status":"starting"}`** and flips to 200 the moment `bootReady` opens (`backend/src/server.ts:55-56,115-117`). This is the URL the compose healthcheck watches. |
| `/api/healthz/live` | public | **Liveness, zero I/O.** No auth, no DB, no Redis, no I/O — always 200 while the event loop is responsive (`health.ts:791-801`). Zero-I/O by design: probing it never touches Neon, so even frequent external probing cannot keep the autosuspended DB awake. |
| `/api/healthz/summary` | public | **Status-only aggregate** for the public /status page: `ok / degraded / failing`, 503 only when the aggregate is `failing` (15 s cache). No per-check details, no version/uptime leak (`health.ts:757-774`). |

Admin-gated extras (Bearer admin JWT): `/api/healthz/ready` (full per-check
breakdown), `/healthz/neon`, `/healthz/redis`, `/healthz/worker`,
`/healthz/socket`, `/healthz/firebase`.

- **503 vs 200:** `healthz`/`summary` 503 = *not ready to serve traffic*
  (boot gate open-but-migrating, or the readiness aggregate is `failing`).
  200 = ready. `/healthz/live` 200 = process alive — it deliberately never
  reports dependency health (conflating the two caused false restarts —
  `health.ts:793-797`).
- **Admin readiness diagnostics** (`backend/src/routes/admin/observability.ts`,
  the /admin System page): server version/uptime, Redis availability (absent
  by design here), recent admin alerts, and the **scheduler topology
  snapshot** — `/api/admin/observability/scheduler` returns
  `mode / active / isLeader / instanceId / reason`. On this deployment expect
  **`mode="single"`, `active=true`, `isLeader=true`** (synthetic in-process
  leadership under `SINGLE_INSTANCE_MODE=true`, `web-scheduler.ts:291-308`),
  with `heartbeat.expected=false` (no Redis → heartbeat inert by design,
  `observability.ts:221-237`).
- **Alerting:** with `ALERTING_ENABLED=true` (default; `=false` is the
  dark-launch gate that only logs `outcome:"would-dispatch"` —
  `services/alerting.service.ts:14,633`) the in-process evaluator (60 s tick)
  dispatches admin alerts over every configured channel: **telegram,
  discord, webhook** (`alerting.service.ts:635`) — as wired via
  `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`,
  `GENERIC_ALERT_WEBHOOK_URL`.

## 3. What is NORMAL

- **Boot → ready:** seconds on a warm Neon; a full cold start incl. the
  migration gate is ~40 s (backend-warm) to ~55-80 s (Neon also asleep — r111
  static timeline, `docs/inspection-r111/CONSOLIDATED-FINDINGS.md`), all well
  inside the compose `start_period: 150s`.
- **Neon autosuspend:** idle DB sleeps (~5 min idle); the first request pays a
  ~2 s wake (r98 measured ~1.8 s). A slow-first-query after quiet periods is
  expected, not an incident.
- **Daily cron slots** (`backend/src/jobs/cron.ts`, all `timezone: "UTC"`):
  - `00:00` admin-alert retention (unread >14 d stale-marked; read >30 d deleted) + `idempotency_keys` retention (48 h)
  - `00:05` admin TOTP advisory check
  - `02:15` demand-forecast runner (dormant unless `WORKER_TIER=true`)
  - `03:30` risk_events retention (90 d unlabeled / 97 d labeled)
  - `03:35` forecast retention (90 d, worker-tier gated)
  - `03:50` catalog enrichment runner (worker-tier gated)
  - `04:00` enrichment retention (90 d, worker-tier gated)
  - `04:30` auth_activity retention (90 d)
  - `05:00` session prune + admin-session prune + notifications retention (90 d read / 180 d unread) + login_attempts retention (7 d) + audit_logs retention (180 d)
- `whatsapp_otps` pruning is NOT a cron slot — opportunistic (throttled 60-min
  fire at the top of `startOtp()` + boot one-shot), 24 h window.
- Quiet log output at idle: an asleep system logs almost nothing. That is the
  point of the deployment shape.

## 4. Failure → first action

| Symptom | Meaning | First action |
|---|---|---|
| `/api/healthz` 503 beyond ~150 s of uptime | migrations stuck or DB unreachable | Neon console (compute state/usage) + `docker logs subnation`; the gate only covers the WAITING window — a genuinely broken boot exits 1 |
| `/api/healthz/live` dead (curl exit 000) | process dead | `docker ps` + `docker inspect subnation`; `restart: unless-stopped` (`docker-compose.yml:108`) should have restarted it — if it restart-loops, read the logs and redeploy from Coolify |
| Socket.IO handshake non-200 through the domain | origin/router issue, not the app | Check the Traefik/Coolify router for the domain + `docker logs subnation` — the zone is **DNS-only (grey)**, so there is no Cloudflare edge in the live path (`CLOUDFLARE_FINAL_CUTOVER.md` §8). Only if the zone is ever re-proxied: Cloudflare dashboard → Network → **WebSockets ON** (the proxied record must allow WS or admin realtime silently downgrades) |
| OTP failures returning `gateway_waking` (503 + `Retry-After: 30`) | openwa not linked or still starting | `docker logs openwa` + the gateway QR/dashboard page; re-pair per `docs/WHATSAPP_OPERATIONS.md` (`whatsapp-otp.service.ts:259`) |
| Alerting silence during a known incident | the alerting evaluator itself died | /admin System page (`/api/admin/observability/*`) — check scheduler topology + recent alerts; verify `ALERTING_ENABLED` and channel env vars; the 60 s evaluator restarts with the container |

## 5. NO keepalive traffic — ever

**Never add self-pings, cron-wakes, or any periodic artificial request.**
Free-tier economics: the r109-era PG-lease heartbeat alone kept Neon compute
awake 24/7 = **720 h/mo ≈ 180 CU-h, against a 100 CU-h/project/month Free
allowance**
(`deploy/env.compose.example:36-38`, `render.yaml:337`) — the Neon-killer
lesson. The old 10-minute keep-alive self-ping of `/api/healthz` + the openwa
gateway was deleted for exactly this reason (`cron.ts:257-265` comment).
`SINGLE_INSTANCE_MODE=true` exists precisely to keep idle Neon coordination
queries at **zero** — no leader election, no lease refresh, nothing. If you
must probe: `/api/healthz/live` and the booted `/api/healthz` handler are
zero-DB (`health.ts:495-501` returns a static ok). **`/api/healthz/summary`
is NOT** — it runs the readiness aggregate incl. a Neon `SELECT 1` (15 s
cache), so periodic summary probing keeps the autosuspended DB awake and
burns the compute allowance.

## 6. Weekly operator checklist

1. `curl -s https://subnation.ly/api/healthz/summary` → `{"status":"ok"}` (or `degraded` with a reason to chase).
2. `docker logs --tail 200 subnation` + `openwa` — skim for `error`/`warn` bursts.
3. `df -h /var/backups /var/log /` — headroom, nothing creeping.
4. `tail -n 5 /var/log/subnation-backup.log` — every line `exit=0 file=subnation-<ISO>.sql.gz keep=14`.
5. Alert sanity: trigger/verify one admin alert path fires (or confirm the last evaluator dispatch in the admin alerts panel) — silence is a finding.
