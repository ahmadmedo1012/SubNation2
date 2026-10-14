# L17 — Deployment, observability & operations audit (R143)

Lane R143-L17 · Repo HEAD `528ef39` (working tree clean) · 2026-10-14.
Scope: Dockerfile end-to-end, compose/Coolify contract, startup & failure
modes, health/readiness, observability (Sentry/alerting/metrics/logs),
rollback readiness, backups, runbook consistency, release identity,
resource hints. INVESTIGATION ONLY — zero modifications, zero deploys,
zero production state changes. All live claims come from public read-only
HTTP probes (full list at the bottom).

---

### L17-1 · P2 · Traefik dashboard + unauthenticated API are publicly exposed on the production VM (port 8080) — the documented firewall contract ("public 22/80/443 only") is not enforced; soketi (6001) is also open

- **Evidence (live probes, 2026-10-14):**
  - `curl http://169.58.100.161:8080/` → `HTTP/1.1 301` → `Location: http://169.58.100.161:8080/dashboard/`
  - `curl http://169.58.100.161:8080/api/version` → `200 {"Version":"3.6.25","Codename":"ramequin","startDate":"2026-10-05T02:19:21Z"}`
  - `curl http://169.58.100.161:8080/api/http/routers` → **200** (full routing table: 13 routers — `http-0-…@docker Host(subnation.ly)`, `https-1-… Host(www.subnation.ly)`, ACME, redirects)
  - `curl http://169.58.100.161:8080/api/http/services` → **200** (13 services; per-service detail includes backend container names/URLs)
  - `curl http://169.58.100.161:8080/dashboard/` → **200** (browsable dashboard)
  - `curl http://169.58.100.161:6001/` → `HTTP/1.1 404 "Not found."` (no Server header — Coolify's soketi/realtime container answering; another listener beyond the contract)
  - Repo contract violated: `docs/deployment/COOLIFY_FINAL_SETUP.md:29-31` ("firewall contract (public 22/80/443 only)"), §2.1:59-60 ("Do NOT publish 8080 on the host — Traefik owns 80/443"); `docs/operations/CONTABO_COOLIFY_OPERATIONS.md` §1 describes the host but never re-verified the Oracle-era firewall contract on Contabo.
- **Root cause:** Coolify's Traefik proxy ships the dashboard/API entrypoint on `:8080` (and soketi on `:6001`) by default; the Contabo host firewall was never confirmed to close them. The Oracle-era provisioning guide that carried the firewall contract (`docs/deprecated/ORACLE_FINAL_SETUP.md`) is explicitly "different cloud" per CONTABO §2 — nobody re-applied or verified the contract after the 2026-10 cutover.
- **Impact:** internet-wide read access to the full edge topology (routers, rules, service names, entrypoints, cert-resolver state, Traefik version + uptime) and a browsable dashboard. The API is read-only and carries no secrets/user data, but it is reconnaissance-grade intel and a version-targeted CVE surface; it also proves the host's perimeter does not match the repo's stated contract.
- **Proposed fix (OPERATOR-ONLY — VM firewall/coolify config, report-and-stop per `.hermes.md`):** close 8080 + 6001 inbound at the Contabo firewall/iptables (or bind the traefik dashboard entrypoint to localhost / disable `api.insecure` in Coolify's proxy config). Then re-probe from outside and record the verification in CONTABO_COOLIFY_OPERATIONS §1.
- **Test requirement:** after the fix, `curl -m 5 http://169.58.100.161:8080/` and `:6001/` must fail to connect (exit 000), while 80/443 keep answering.
- **Risk:** none to app traffic (Traefik edge routing on 80/443 is untouched); skipping the fix leaves the edge topology permanently enumerable.

### L17-2 · P2 · The documented deployed-SHA gate (`/api/healthz` `.version`) is not executable — the public health payload carries no release identity; the only working public signal (SENTRY_RELEASE id in served chunks) is documented nowhere

- **Evidence:**
  - Live: `curl -s https://subnation.ly/api/healthz` → `{"status":"ok"}` — **no `.version` field** (`jq -r .version` yields `null`).
  - `backend/src/routes/health.ts:49-57` — base handler returns `HealthCheckResponse.parse({ status: "ok" })`; schema is `zod.object({ status })` only (`shared/api-zod/src/generated/api.ts:55-57`).
  - Docs that instruct the broken gate: `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md:47-48` (pre-rollback gate 3: `curl -s https://subnation.ly/api/healthz | jq -r .version`) and §8 checklist (:225); `docs/deployment/COOLIFY_FINAL_SETUP.md:263-264` (§8: "`.version` equals the GIT_SHA you deployed"); `docs/operations/CONTABO_COOLIFY_OPERATIONS.md:79-80` (deploy verify step 3).
  - `getReleaseSha()` feeds only admin-gated surfaces (`services/health-checks.service.ts:658,729` → `/api/healthz/ready`; `routes/admin/observability.ts:101`; `routes/admin/diagnostics.ts:181,272`) + logs + Sentry — none public.
  - Working alternative (live-verified, undocumented): the served `assets/instrument-*.js` chunk contains `e.SENTRY_RELEASE={id:"528ef39"}` (sentry-cli inject) — the deployed release is publicly readable from the bundle.
- **Root cause:** `.version` was deliberately removed from public healthz in the May-2026 public infra-leak removal (commit `e292597`, "no per-check details, no uptime, no version"); the Oct-2026 Coolify/rollback/ops docs were written assuming it still exists. Doc-vs-code contradiction never reconciled through R115→R142.
- **Impact:** during a rollback — the exact moment release identity matters — the runbook's own verification command returns `null`. Operators either skip the identity check (gate defeated) or burn incident time. It also removes the only public detector for L17-8 (stale GIT_SHA).
- **Proposed fix:** minimal doc-truth fix — replace the `.version` steps in the three docs with a working probe (SENTRY_RELEASE id in `assets/instrument-*.js`, or an admin-authenticated `/api/healthz/ready` / `/api/admin/observability` call), and record the "public healthz carries no version" decision in the docs that claimed otherwise. (Alternative code path — re-adding a 7-char SHA to the base healthz — reverses a deliberate security decision and needs an explicit operator call.)
- **Test requirement:** after the fix, run the rollback runbook §1 gate 3 verbatim and get a SHA.
- **Risk:** low (docs-only). Leaving it: rollback verification theater.

### L17-3 · P3 · Rollback runbook's hard-floor list ends at R115 while destructive migration stages landed through R135 — the never-deploy list is stale

- **Evidence:** `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md:121-171` — floors documented only for pre-r108 (V1-M20 FK drop, SINGLE_INSTANCE_MODE) and pre-R115 (M21/M22 pair; `6caa63b`/`3a2e2e1` never-deploy). The corpus is now **V1-M1…V1-M34** (`backend/src/migrate.ts` stage headers; latest `── V1-M34 (R135…)` at :2355). Post-R115 destructive stages with no floor entry: V1-M30 `ALTER TABLE users DROP COLUMN organization_id` (:2129) + `DROP TABLE IF EXISTS organizations` (:2145, R123); V1-M27/V1-M33/V1-M34 index drops (:1813, :2347, R123–R135).
- **Root cause:** floor list maintained once (R115) and never extended when destructive stages landed in R123–R135. The general gate-2 (diff live-sha→target over `migrate.ts` + `shared/db/src/schema/`, runbook :44-46) still catches these mechanically — this is a doc-layer gap on top of a sound gate.
- **Proposed fix:** add a pre-R123 floor note (organizations/`users.organization_id` removal) and a standing rule in the runbook: "any stage that DROPs a column/table extends the never-deploy floor — §4 is updated in the same commit that lands the stage."
- **Test requirement:** n/a (documentation).
- **Risk:** an operator rolling back past R123 who relies on the floor list instead of the diff gate boots a binary whose Drizzle schema selects `users.organization_id` → user-read 500s (the historical FK-500 class, one schema over).

### L17-4 · P3 · COOLIFY_FINAL_SETUP §2.2 build-args contract is factually wrong ("the Dockerfile consumes ONLY these ARGs") — the live Sentry sourcemap-upload trio is undiscoverable from the setup doc

- **Evidence:** `docs/deployment/COOLIFY_FINAL_SETUP.md:63-64` — "the Dockerfile consumes ONLY these ARGs" — vs the Dockerfile's actual ARG set: `VITE_APP_VERSION` (:99), `RENDER_GIT_COMMIT` (:117), `SOURCE_COMMIT` (:126), **`SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` (:185-187)**. The R121 sourcemap pipeline is LIVE in production (live probe: `SENTRY_RELEASE={id:"528ef39"}` + sentry-cli debug-id inject present in the served instrument chunk → the token trio IS configured on the Coolify builder) yet §2.2 never mentions it. `ENVIRONMENT_MATRIX.md:40` and `FINAL_PRODUCTION_ENV.md:103` do document the trio — the operator's copy/paste source (§2.2) does not. The r127 inspection already filed this exact directive (`docs/history/inspection-r127/B10-docker-build.md:132-134`) — never applied.
- **Root cause:** §2.2 not updated when R121 added the build args; the r127 fix directive was deferred and lost.
- **Proposed fix:** add to §2.2: optional "sourcemap uploads (secret-bearing, build-time only): `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`" with the H-2 BuildKit-secret caveat, plus `VITE_APP_VERSION`; delete the word "ONLY".
- **Test requirement:** doc review.
- **Risk:** an operator recreating the resource from the doc silently loses sourcemap uploads (cleanly skipped, no error) and audit readers are told an untruth about the image's inputs.

### L17-5 · P3 · No external sub-weekly watchdog: the alerting evaluator, Sentry transport, and Telegram dispatch all die with the process — a dead/hung container produces silence for up to a week

- **Evidence:** the alerting evaluator is in-process (`backend/src/services/alerting.service.ts:263-281`, 60 s `setInterval`, `.unref()`); exit-time Sentry flush is 2 s best-effort (`backend/src/instrument.ts:32-63`); the only out-of-band checks are the weekly CI e2e heartbeat (`.github/workflows/ci.yml:18-19` cron `17 4 * * 1`; `:576-610` guest read-only suite vs `E2E_BASE_URL`) and the human weekly checklist (`docs/operations/FINAL_MONITORING.md:128-134`). Cloudflare is DNS-only (live-verified: `remote_ip=169.58.100.161`, no `cf-ray`) — no CF health checks exist in the path. No uptime monitor is documented anywhere.
- **Root cause:** deliberate architecture (no keepalive traffic to protect Neon economics, DNS-only zone) — the flip side was never compensated with an external liveness probe.
- **Proposed fix:** a 5-minute external uptime probe against **`/api/healthz/live`** (zero-DB by design — `routes/health.ts:147-157`; FINAL_MONITORING §5 explicitly permits probing it and warns against `/summary`, which runs the Neon aggregate). Any free monitor or a scheduled GitHub Actions curl (infra already free/public repo) works; alert destination = the existing Telegram channel.
- **Test requirement:** drill — stop the app (or point the monitor at a dead URL) and confirm the alert fires within one cadence.
- **Risk:** none (probe touches no DB). Current MTTD for a full outage: up to ~7 days or first user complaint.

### L17-6 · P3 · Push-to-deploy webhook does not wait for CI — the in-image typecheck is the only gate actually in the deploy path; a runtime-only boot failure still takes production down

- **Evidence:** `Dockerfile:154-173` (R122 A9-P0-2 comment: "the Coolify push-to-deploy webhook fires on the push itself and builds this image WITHOUT waiting for CI"; the mitigation added was `RUN pnpm run typecheck` inside the build). R142 M-2 then added the CI boot smoke (`.github/workflows/ci.yml:529-557`) — but that runs in CI ~minutes AFTER the webhook already deployed. Production boots that fail at runtime `exit(1)` (`backend/src/server.ts:226-239`) and crash-loop under the restart policy until an operator intervenes; no auto-rollback exists. Precedent: R141's boot-order bug shipped through green CI (`a9f5e83`).
- **Root cause:** structural race — webhook triggers on push; CI gates run in parallel; Coolify has no "deploy only after CI green" gate for webhook deploys.
- **Proposed fix:** operator decision, two honest options: (a) disable the auto-webhook and deploy manually after CI green (costs minutes, matches `.hermes.md` "no automatic deploys" spirit — note `.hermes.md:54-56` already says deploys are explicit user-ordered actions, which the webhook technically violates); or (b) keep the webhook and document the race in COOLIFY_FINAL_SETUP §5 + treat CI red within N minutes of a push as a rollback trigger.
- **Test requirement:** n/a (process).
- **Risk:** as-is, the docs imply CI protects the deploy; it does not (only type-level failures are caught in-path).

### L17-7 · P3 · No memory bound anywhere (container or Node heap) and the VM shape is still unrecorded — OOM behavior on the shared VPS is unmanaged

- **Evidence:** no `--max-old-space-size`/`NODE_OPTIONS`/`ulimit` anywhere in the repo (rg across Dockerfile, compose, deploy/, docs — only the r127 record `docs/history/inspection-r127/B10-docker-build.md:126-130` (B10-F5 P3, never fixed)); `Dockerfile:302` CMD is plain `node --enable-source-maps backend/dist/index.mjs`; `docker-compose.yml` has no `deploy.resources`/`mem_limit`; `docs/operations/CONTABO_COOLIFY_OPERATIONS.md:22-25` — "VM shape: unknown to the repo … Operator: record your Contabo plan here" — open since R118.
- **Root cause:** sizing deferred pending the plan record; the follow-up never happened.
- **Proposed fix:** record the plan; set the Coolify per-resource memory limit and `ENV NODE_OPTIONS=--max-old-space-size=…` (B10-F5 suggested ~512 m as a sane ceiling); add both to the OPERATIONS_RUNBOOK §14 living list.
- **Test requirement:** a week of `docker stats --no-stream` RSS observation (operator, on-VM).
- **Risk:** on a VM shared with Coolify's own Postgres/Redis/Traefik + openwa, an unbounded Node heap spike lets the kernel OOM-killer pick the largest RSS victim — which can be `coolify-db`, turning an app incident into a control-plane incident.

### L17-8 · P3 · GIT_SHA is a manually-synced build arg that WINS over Coolify's auto-injected SOURCE_COMMIT — stale-SHA telemetry is possible and (per L17-2) publicly undetectable

- **Evidence:** precedence chain: `Dockerfile:188` (`VITE_RELEASE_SHA="${GIT_SHA:-${SOURCE_COMMIT:-…}}"`), `backend/src/lib/release-sha.ts:14-19` (same order, `GIT_SHA` first), `backend/build.mjs:209-214`. The rollback procedure requires the operator to hand-update the build arg on every commit change (`FINAL_ROLLBACK_RUNBOOK.md:50-52`, `COOLIFY_FINAL_SETUP.md:263-264` §8), while `CONTABO_COOLIFY_OPERATIONS.md:74-76` misleadingly implies the builder handles it ("The builder pulls `main` and builds the Dockerfile with the new `GIT_SHA`"). If the manually-set `GIT_SHA` is stale, it **overrides** the correct auto `SOURCE_COMMIT` (Coolify's `include_source_commit_in_build`), so logs, Sentry release, and the (admin) health version all report a release that is not running.
- **Root cause:** manual seam + precedence order + no detector (L17-2 removed the public one).
- **Proposed fix:** prefer leaving the Coolify `GIT_SHA` build arg UNSET and relying on SOURCE_COMMIT auto-injection (verify the Coolify setting is on), or add "refresh GIT_SHA" as an explicit deploy-checklist line; document the precedence trap in COOLIFY_FINAL_SETUP §2.2/§7.
- **Test requirement:** redeploy without touching GIT_SHA; compare `SENTRY_RELEASE` id in the served chunk against the deployed commit.
- **Risk:** rollback gate/health checks pass against a wrong-but-plausible value; Sentry events mis-filed under the wrong release.

### L17-9 · P4 · H-2 (deferred R142) still present: `SENTRY_AUTH_TOKEN` passes as a Docker build ARG — intermediate-stage layer-history exposure

- **Evidence:** `Dockerfile:185-192` — `ARG SENTRY_AUTH_TOKEN=""` … `RUN VITE_RELEASE_SHA=… SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN}" … pnpm --filter @workspace/api-server run build`. R142 disposition: DEFER with recorded decision (`docs/engineering/R142/lanes/findings-H.md:35-38`, fix directive = BuildKit `--mount=type=secret`). Live evidence the token IS supplied on the Coolify builder (sourcemap inject present in served chunks). Final runtime image unaffected (fresh `FROM`, runtime stage declares only `GIT_SHA`/`SOURCE_COMMIT` — :199-205).
- **Root cause:** recorded deferral (deploy-contract change, operator-visible).
- **Proposed fix:** as recorded — `RUN --mount=type=secret,id=sentry_token …` + Coolify secret build input, remove the ARG; fold in OPERATIONS_RUNBOOK §14's pending "de-scope to an `org:ci` token" action in the same change.
- **Test requirement:** `docker history --no-trunc` on the build stage shows no token; sourcemaps still upload (SENTRY_RELEASE inject still present in the next deploy's chunks).
- **Risk:** unchanged from R142 assessment (low — VM-local build cache only).

### L17-10 · P4 · FINAL_MONITORING.md line references are stale after the R136 health.ts split (incident-time doc friction)

- **Evidence:** `docs/operations/FINAL_MONITORING.md` cites `health.ts:495-501`, `:757-774`, `:791-801` — the file is now **267 lines** (actual handlers: base :49-57, summary :110-123, live :154-157; the aggregate moved to `services/health-checks.service.ts` in R136 commit `2e5c5b1` "health 959→267"); also `server.ts:55-56,115-117` (actual gate: :71, :117-137, :390), `docker-compose.yml:121-186` (actual healthchecks :142-147/:202-207), `docker-compose.yml:108` (restart is :127).
- **Root cause:** R136 extraction never propagated to the ops doc.
- **Proposed fix:** refresh the refs or switch to route/function names (robust to moves).
- **Test requirement:** n/a.
- **Risk:** doc lookups fail during incidents.

### L17-11 · P4 · OPERATIONS_RUNBOOK §14 "living list" stopped at R134 — post-R134 operator-critical actions live only in scattered docs

- **Evidence:** `OPERATIONS_RUNBOOK.md:709` ("additions through R134"). Open actions NOT on the list: first GHCR `docker.yml` dispatch (rollback §2 image path — `.github/workflows/docker.yml:46-58` OPERATOR STEP; runbook :69-85 confirms no image exists); first **on-VM** restore drill (`docs/DISASTER_RECOVERY.md:353` "PENDING-OPERATOR" — both PASS drills ran from sandboxes); VM shape record (CONTABO §1, feeds L17-7); stop-grace 40 s verification on the SubNation resource (`COOLIFY_FINAL_SETUP.md:194-209`); and this round's L17-1 firewall close.
- **Root cause:** the consolidation habit lapsed after R134.
- **Proposed fix:** one consolidation pass into §14 (or a tracked operator-actions file) with source links.
- **Test requirement:** n/a.
- **Risk:** rollback/DR readiness actions depend on doc archaeology; the §2 image fallback stays dark until someone re-reads docker.yml's header.

### L17-12 · P4 · Socket transport errors are log-only (warn) — never reach Sentry/Telegram

- **Evidence:** `backend/src/lib/socket.ts:446-451` — `socket.on("error", …)` → `logger.warn` only. Contrast: every cron failure captures to Sentry (`backend/src/jobs/cron.ts` throughout, R142 L-3 `captureSchedulerFailure`), scheduler/DB/queue paths use `captureSubsystemException`.
- **Root cause:** per-socket errors are usually disconnect noise — a defensible default that also hides persistent WS-layer degradation.
- **Proposed fix:** one rate-limited `captureSubsystemException("socket", err)` (or an alerting-rule counter) on the transport-error path.
- **Test requirement:** unit test pinning the capture call.
- **Risk:** low; blind spot only.

### L17-13 · P4 · build.mjs sourcemap-upload gate can pass an empty release string

- **Evidence:** `backend/build.mjs:209-220` — `release = (GIT_SHA || RENDER_GIT_COMMIT || SOURCE_COMMIT || "").slice(0, 7)`; the gate checks `release !== "unknown"` but the actual fallback is `""`, so with the token trio set and no SHA the upload runs with `--release=""` (sentry-cli fails → caught → warn; build continues). The `!== "unknown"` check is dead code for this path.
- **Proposed fix:** gate on `release` truthiness (`&& release`).
- **Test requirement:** unit test on the gate expression.
- **Risk:** cosmetic (Coolify always supplies a SHA today).

### L17-14 · P4 · Backend Sentry process tags carry Render-era fallbacks — every production event tags `deploy_id="dev"`, `region="unknown"`, `git_branch="unknown"`

- **Evidence:** `backend/src/lib/sentry.ts:225-239` — `readProcessTags()` reads `RENDER_INSTANCE_ID/RENDER_SERVICE_ID/RENDER_DEPLOY_ID/RENDER_REGION/RENDER_GIT_BRANCH` with fallbacks `local-<pid>` / `"subnation"` / `"dev"` / `"unknown"` / `"unknown"`. On the Coolify deployment none of the RENDER_* vars exist, so 100 % of events carry the fallback values; only `git_commit` (getReleaseSha) is truthful.
- **Proposed fix:** either drop the dead tags or read neutral ones (`GIT_SHA`, `SINGLE_INSTANCE_MODE`, host from `os.hostname()`).
- **Test requirement:** n/a (tag shape).
- **Risk:** misleading filters/queries in the Sentry UI during incidents.

### L17-15 · P4 · Log-bounding (10 MB × 3) is guaranteed only on the compose path — the Coolify production containers' log limits are unverifiable from the repo and the documented `docker inspect` check sits on no checklist

- **Evidence:** `docker-compose.yml:132-139` (logging block) governs the compose/bare-VM path only (header R127-L4 note :74-80: "Coolify's Docker-build resource never reads it"); images cannot enforce log-driver options. `docs/operations/LOGGING_AND_RETENTION_FINAL.md:84-87` honestly flags the caveat and prescribes `docker inspect <container> | grep -A4 LogConfig` — but that step appears on no operator checklist (FINAL_MONITORING §1/§6 do not include it).
- **Proposed fix:** add the one-line LogConfig check to the weekly checklist (§6) and record the observed values once.
- **Test requirement:** on-VM (operator).
- **Risk:** if Coolify's generated compose lacks limits, json-file logs are unbounded (disk creep) — the exact failure FH-A8 F1 was written to prevent.

---

## Verified-healthy (no action)

- **Release identity chain complete and live-verified end-to-end:** GIT_SHA (supplied as the full 40-char SHA) → Dockerfile ARG/ENV → `VITE_RELEASE_SHA` → `instrument.ts` `.slice(0,7)` → live chunk carries `SENTRY_RELEASE={id:"528ef39"}` **== repo HEAD**; backend parity via `getReleaseSha()` (same slice, same precedence). The chain is robust to short-or-long SHA input. Sourcemap upload was active on the deploying build (sentry-cli debug-id inject present).
- **Base image pin fresh (live registry probe):** Dockerfile's pinned digest `sha256:0a7108bf…e402` == the CURRENT `library/node:22-alpine` manifest-list digest on Docker Hub (2026-10-14) — no upstream drift since the R120-B6 pin.
- **Dockerfile quality:** digest-pinned multi-stage build; manifest-first layering in deps AND runtime (R127-L4); pnpm cache mounts; deploy-time typecheck gate; `USER node` (:279); runtime ships only dist + workspace manifests (`worker.mjs` pruned :272); corepack cache pruned in-layer (:253); node as PID 1 (:302) so SIGTERM reaches the 25 s drain (`server.ts:278-366`, idle-socket sweeper included).
- **Healthcheck config is consistent everywhere and fits the cold window:** Dockerfile `--interval=30s --timeout=5s --start-period=150s --retries=3` (:289-290) == compose (:142-147) == COOLIFY doc §4; documented real boots 40–80 s ≪ 150 s; post-start-period tolerance 3×30 s; probe rides the zero-DB base healthz (boot gate answers 503 `starting`, `server.ts:115-137`).
- **Boot failure modes are honest and layered:** port binds first (503 gate), 120 s Neon write-wait + transient retry classification before any DDL (`boot-migrations.ts:7-27`), critical failure → production `exit(1)` (crash-loop, visible), `DISABLE_BOOT_MIGRATIONS` hatch; partial-boot re-runs are probe-based no-ops (idempotent corpus + v2 fingerprint fast-path with constraint-skip marker discipline, `migrate.ts:1-114`).
- **Auth gates live-verified:** `/api/metrics` → 401 unauth (fail-closed, constant-time token compare, 2FA-temp + session-liveness + is_active parity — `routes/metrics.ts:33-113`); `/api/healthz/ready` and `/api/healthz/neon` → 401 unauth (R122 A5-P2 scope fix works live).
- **No sourcemap leak:** `/assets/*.js.map` → 404; `/sw.js.map` → 200 **text/html** (SPA fallback shell, not a map — the R128 B5-F1 fix holds).
- **Edge canonicalization live and matching docs:** www→apex **301**; http→https **301** (R130 record); zone DNS-only confirmed (origin IP answered directly, no `cf-ray`).
- **openwa not publicly exposed:** `169.58.100.161:2785` → connection refused (internal-only as designed).
- **Alerting coverage (in-process):** 10 rules incl. `neon_connection_failure` (critical, ≥1/60 s), `api_5xx_rate_high`, `api_p95_latency_high`, `abnormal_lockouts`; channels telegram/discord/webhook with dedupe + global rate limit; dispatch failures themselves captured to Sentry (`alerting.service.ts:735`). Backend uncaughtException/unhandledRejection both handled with flush (`instrument.ts:34-63`); frontend buffers window error + unhandledrejection + React handler errors through the lazy SDK load (`boot-sentry.ts:114-183`).
- **Backup tooling:** `backup-cron.sh` (secret-safe env parsing, one ledger line, exit-code propagation, retention 14) + `backup-preflight.sh` + `restore-drill-check.sh`; two PASS drills on record (2026-09-25 R112, 2026-10-01 R115 — Neon scratch-branch restore, sha256-recorded artifact); openwa `/data` volume is defense-in-depth with Neon blobs as source of truth. Known, documented gaps: Coolify's own config is re-provision-from-docs (not backed up), Neon PITR window ~6 h, first on-VM drill pending (see L17-11).

---

## Live probe evidence

All probes were read-only HTTP GETs/HEADs from this sandbox, 2026-10-14 ~00:20–00:23 UTC. No production state was touched.

| # | Probe | Result |
|---|---|---|
| 1 | `curl https://subnation.ly/api/healthz` | `200 {"status":"ok"}` · 0.80 s · remote_ip `169.58.100.161` · **no `.version` field** (L17-2) · `cache-control: public, max-age=5` |
| 2 | `curl https://subnation.ly/api/healthz/live` | `200 {"status":"ok"}` · 0.59 s |
| 3 | `curl https://subnation.ly/api/healthz/summary` | `200 {"status":"ok"}` · 1.49 s (readiness aggregate incl. Neon SELECT 1 — healthy) |
| 4 | `curl -D https://subnation.ly/` | HTTP/2 200; full header suite (CSP incl. `*.ingest.de.sentry.io`, HSTS preload, COOP/CORP, `x-request-id`); entry `index-5v7iE5dj.js`, `preload-gate-UNflcRlC.js`, `home-9TEh8JDp.js` |
| 5 | `curl https://subnation.ly/assets/index-5v7iE5dj.js` | 200 · `cache-control: public, max-age=31536000, immutable` |
| 6 | `curl https://subnation.ly/assets/instrument-B7Oc9x_n.js` | 200 · contains `e.SENTRY_RELEASE={id:"528ef39"}` and release const `"528ef3961cb059a63bd3d2359a680dbb6451b429".slice(0,7)` + DSN host `…ingest.de.sentry.io` → **deployed release == repo HEAD 528ef39**; sentry-cli inject present → sourcemap upload ran on the deploying build |
| 7 | `curl https://subnation.ly/assets/index-5v7iE5dj.js.map` (+ `vendor-sentry-CzF-Flc3.js.map`) | **404** — no sourcemap leak |
| 8 | `curl https://subnation.ly/sw.js.map` | 200 **text/html** (SPA fallback shell — not a map; R128 fix holds) |
| 9 | `curl https://www.subnation.ly/` | `301 → https://subnation.ly/` (www→apex live, matches R124/R130 record) |
| 10 | `curl http://subnation.ly/api/healthz` | `301 → https://…` (http→https live) |
| 11 | `curl https://subnation.ly/api/metrics` (no auth) | `401 {"error":"غير مصرح","code":"UNAUTHORIZED"}` — fail-closed |
| 12 | `curl https://subnation.ly/api/healthz/ready`, `/api/healthz/neon` (no auth) | `401` both — admin+settings gate live |
| 13 | `curl http://169.58.100.161:2785/healthz` | connection failed (000) — openwa internal-only |
| 14 | `curl http://169.58.100.161:8080/` / `/api/version` / `/api/http/routers` / `/api/http/services` / `/dashboard/` | `301→/dashboard/` / `200 {"Version":"3.6.25","Codename":"ramequin","startDate":"2026-10-05T02:19:21Z"}` / **200 (13 routers)** / **200 (13 services)** / **200** — **Traefik dashboard + unauthenticated API public** (L17-1) |
| 15 | `curl http://169.58.100.161:6001/` | `404 "Not found."` (soketi answering — another open port; L17-1). Ports 2019/8443: no listener |
| 16 | Docker Hub registry: `GET /v2/library/node/manifests/22-alpine` (auth token, OCI+manifest-list Accept) | current digest `sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402` == Dockerfile pin — base fresh |
| 17 | DNS shape | `subnation.ly` resolved and answered by the origin IP directly (169.58.100.161), no `cf-ray` — Cloudflare DNS-only confirmed |

## Access limitations

This lane had **no Coolify / SSH / Neon / Sentry / Telegram access**. Unverifiable from here (operator follow-ups, not findings):

- **No SSH to the Contabo VM (169.58.100.161):** cannot run `docker ps`/`inspect`/`logs`/`stats`; cannot read `/var/log/subnation-backup.log` or the backup ledger; cannot verify the crontab entry exists; cannot check Coolify's Traefik dynamic-config files on disk; cannot read container `LogConfig` (L17-15) or restart policy as actually generated by Coolify.
- **No Coolify dashboard/API:** cannot read the resources' env/build-args panels (SENTRY token trio, GIT_SHA vs SOURCE_COMMIT setting, `include_source_commit_in_build`, stop-grace 40 s, healthcheck panel values) or deployment history. Build-arg state is inferred only from served artifacts (probe #6).
- **No Neon access:** cannot verify DB compute state, branches, PITR window, or `openwa_sessions` blobs.
- **No Sentry dashboard:** cannot verify the release list, sourcemap resolution quality, alert routing (Discord/Telegram pipelines), or quota.
- **No ghcr.io credentials:** cannot confirm/deny the private `subnation2` package (matches the R127-L4 anonymous-probe state — 403 either way).
- Every production claim above is grounded in the public HTTP probes #1–17 + repo state at HEAD `528ef39`. No modifications were made to the repo (working tree clean; only this findings file was created), and no deploy/restart/production state was touched.
