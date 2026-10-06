# Final Production Environment Contract (r115)

> FINAL. Reconciled against code at HEAD 521234f (r112) and RE-VERIFIED
> UNCHANGED at the R115 release `6f14bc3` (2026-10-01): a diff of the
> R112→R115 delta over `backend/src` + `shared/` + `frontend/src` shows
> **zero `process.env.*` / `import.meta.env.*` readers added or removed** —
> every row below stands exactly as written. Rows re-verified at ef3d0c3
> (R118-A7). Every variable
> below was enumerated with `rg -o "process\.env\.[A-Z_0-9]+"` over
> `backend/src` + `shared/`, `rg -o "import\.meta\.env\.[A-Z_0-9]+"` over
> `frontend/src`, and the same over the openwa repo's `src`. Cross-checked
> against `deploy/env.compose.example`, `config/env.example`,
> `docs/deployment/ENVIRONMENT_MATRIX.md`, `backend/src/lib/env.ts`,
> `scripts/src/validate-production-env.ts`, `Dockerfile`, `docker-compose.yml`,
> and render.yaml before its deletion (2026-10-05, `62ee976`). **Zero undocumented variables · zero phantom
> variables · zero stale Render-only requirements.**
>
> Legend — **Req**: required (boot fails / validator errors without it) ·
> **Sec**: secret (never in build args, logs, or the bundle) · **Default**:
> value used when unset · compose-profile = required by
> `validate-production-env.ts --profile compose`.
> Secrets live in Coolify env screens only → `SECRET_HANDLING_FINAL.md`.

## 1. SubNation runtime — boot-required

| Variable | Purpose | Required? | Secret? | Service | Build-time/runtime | Default | Operator action |
|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | Neon Postgres pool (`shared/db`) | ✔ | ✔ | SubNation | runtime | — | Paste Neon direct URL with `sslmode=require` |
| `SESSION_SECRET` | User JWT signing (`lib/jwt.ts`) | ✔ | ✔ | SubNation | runtime | — | ≥32 chars; generate, never share |
| `ADMIN_JWT_SECRET` | Admin JWT signing; MUST differ from `SESSION_SECRET` | ✔ prod | ✔ | SubNation | runtime | dev: derived+warn | ≥32 chars, distinct value |
| `ENCRYPTION_KEY` | AES-256-GCM at-rest (`lib/encryption.ts`) | ✔ | ✔ | SubNation | runtime | — | EXACTLY 64 hex chars (`openssl rand -hex 32`) |
| `APP_URL` | Canonical origin; CSRF gate base (`lib/origins.ts`) | ✔ prod | ✖ | SubNation | runtime | — | `https://subnation.ly` |
| `APP_ORIGINS` | CORS/CSRF/Socket.IO allow-list | ✔ prod | ✖ | SubNation | runtime | — | `https://subnation.ly,https://www.subnation.ly` |
| `WHATSAPP_OTP_BASE_URL` | Gateway REST address (`services/openwa.service.ts`) | ✔ compose | ✖ | SubNation | runtime | unset = OTP 503 | `http://openwa:2785` on the compose network (Coolify: the internal openwa service URL) |
| `WHATSAPP_OTP_API_KEY` | Gateway auth — SubNation's copy of the key | ✔ compose | ✔ | SubNation | runtime | — | MUST EQUAL `OPENWA_API_KEY` |
| `WHATSAPP_OTP_SESSION` | Stable OTP session name | ✔ compose | ✖ | SubNation | runtime | **no default** | `subnation-otp` |

## 2. SubNation runtime — deployment contract flags

| Variable | Purpose | Required? | Secret? | Service | Build-time/runtime | Default | Operator action |
|---|---|---|---|---|---|---|---|
| `SINGLE_INSTANCE_MODE` | Single-container scheduler ownership; no leader election, no PG-lease heartbeat, Neon autosuspend preserved | ✔ (=true) | ✖ | SubNation | runtime | `false` | Set `true`; NEVER scale >1 replica |
| `DISABLE_WEB_SCHEDULERS` | Kill-switch for all crons | ✔ (=false) | ✖ | SubNation | runtime | `false` | Keep `false` (no worker exists) |
| `DISABLE_BOOT_MIGRATIONS` | Emergency rollback hatch | ✔ (=false) | ✖ | SubNation | runtime | `false` | Keep `false` |
| `AUTH_COOKIE_SAMESITE` | Cookie SameSite flag (`app.ts`) | ✖ | ✖ | SubNation | runtime | `lax` | Keep `lax` (single-origin) |
| `APP_ORIGIN` | Deep links in admin alerts/SEO | ✖ | ✖ | SubNation | runtime | falls back to `APP_URL` | Set = `APP_URL`; must sit inside the origins set |
| `CSRF_ALLOWED_ORIGINS` | Extra Origin/Referer allow-list entries | ✖ | ✖ | SubNation | runtime | unset = APP_URL/APP_ORIGINS only | Leave unset |
| `ALLOW_DEMO_SEED` | Prod demo-catalog seeding guard (`migrate.ts`) | ✖ | ✖ | SubNation | runtime | unset = blocked in prod | Leave unset |
| `WORKER_TIER` / `WORKER_TIER_ID` | Worker-tier gating for forecast/enrichment crons + run labels | ✖ | ✖ | SubNation | runtime | unset | Leave unset (no worker tier) |
| `MIGRATIONS_FORCE_RECONCILE` | Bypass migration fingerprint fast-path | ✖ | ✖ | SubNation | runtime | `false` | Leave unset |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | First-boot admin bootstrap seed only | ✖ | PASSWORD ✔ | SubNation | runtime (seed path) | `admin` / — | Unset — prod admin already exists |
| `FULFILLMENT_PROVIDER` | Fulfillment registry switch (fail-safe manual) | ✖ | ✖ | SubNation | runtime | `manual` | Leave unset or `manual` |
| `RISK_PIPELINE_ENABLED` | Anomaly-pipeline dark-launch gate | ✖ | ✖ | SubNation | runtime | dormant | Leave unset |

## 3. SubNation runtime — container, release identity, tuning (defaults correct — leave unset)

| Variable | Purpose | Required? | Secret? | Service | Build-time/runtime | Default | Operator action |
|---|---|---|---|---|---|---|---|
| `PORT` | HTTP bind (`server.ts`) | ✖ | ✖ | SubNation | runtime | `8080` | Set by image/compose — never in `.env` |
| `API_PORT` | Legacy port fallback (`PORT` wins) | ✖ | ✖ | SubNation | runtime | — | Leave unset |
| `NODE_ENV` | Mode gates (prod boot asserts) | ✖ | ✖ | SubNation | runtime | `production` (image ENV) | Image-pinned |
| `FRONTEND_DIST` | Where Express serves the built SPA (`app.ts`) | ✖ | ✖ | SubNation | runtime | `/app/frontend/dist/public` (image ENV) | Image-pinned |
| `TZ` | OS timezone (cron docs pinned UTC) | ✖ | ✖ | SubNation | runtime (image ENV) | `UTC` | Image-pinned |
| `GIT_SHA` | Neutral release identity → logs/health/Sentry | ✖ | ✖ | SubNation | build arg → runtime | `RENDER_GIT_COMMIT` → `unknown` | Coolify supplies; nothing to set |
| `LOG_LEVEL` | pino level (backend + openwa) | ✖ | ✖ | SubNation | runtime | `info` | Leave unset |
| `DB_POOL_MAX` / `DB_IDLE_TIMEOUT_MS` / `DB_CONNECTION_TIMEOUT_MS` | Pool sizing (`shared/db`) | ✖ | ✖ | SubNation | runtime | `8` / `30000` / `10000` | Leave unset (code defaults match Neon free) |
| `PG_STATEMENT_TIMEOUT_MS` | Per-connection statement_timeout | ✖ | ✖ | SubNation | runtime | `15000` | Leave unset |
| `MIGRATION_WRITE_WAIT_MAX_MS` / `MIGRATION_WRITE_WAIT_POLL_MS` / `MIGRATION_LEADER_WAIT_MAX_MS` / `MIGRATION_TRANSIENT_BACKOFF_MS` / `MIGRATION_PG_LOCK_WAIT_MAX_MS` | Boot-migration wait/backoff budgets (`lib/boot-migrations.ts`) | ✖ | ✖ | SubNation | runtime | `120000` / `2000` / `300000` / `5000` / `90000` | Leave unset |
| `SCHEDULER_LEASE_REFRESH_MS` / `SCHEDULER_LEASE_TTL_SEC` / `SCHEDULER_OP_TIMEOUT_MS` / `BOOT_ONE_SHOT_DELAY_MS` | Lease timings — inert while `SINGLE_INSTANCE_MODE=true` | ✖ | ✖ | SubNation | runtime | `25000` / `60` / `2000` / `7000` | Leave unset (flip-back knobs only) |
| `REDIS_URL` | Optional Redis; in-memory fallbacks by design | ✖ | ✔ | SubNation | runtime | unset = fallbacks | **Leave unset** (no Redis on Coolify; single-instance shape) |
| `REDIS_CONNECT_TIMEOUT_MS` / `REDIS_COMMAND_TIMEOUT_MS` | Redis client budgets (dormant) | ✖ | ✖ | SubNation | runtime | `8000` / `500` | Leave unset |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | SIGTERM drain budget | ✖ | ✖ | SubNation | runtime | `25000` | Keep < compose `stop_grace_period` (40 s) |
| `HEALTH_CHECK_TIMEOUT_MS` / `HEALTH_AGGREGATE_TIMEOUT_MS` | /healthz race budgets | ✖ | ✖ | SubNation | runtime | `5000` / `8000` | Leave unset |
| `SLOW_QUERY_THRESHOLD_MS` | Slow-query warn threshold | ✖ | ✖ | SubNation | runtime | `250` | Leave unset |
| `METRICS_ENABLED` / `NEW_HEALTH_CHECKS_ENABLED` | Informational flags surfaced by diagnostics | ✖ | ✖ | SubNation | runtime | `true` / `true` | Leave unset |
| `WHATSAPP_OTP_AUTO_CREATE_SESSION` | Auto-create OTP session on first send | ✖ | ✖ | SubNation | runtime | `true` | Keep `true` |
| `WHATSAPP_OTP_SETTLE_MS` | Post-pairing settle gate (clamped 0–300000) | ✖ | ✖ | SubNation | runtime | `45000` | Leave unset |
| `WHATSAPP_OTP_OPERATOR_E164` | Operator number for pairing/warm-up | ✖ | ✖ | SubNation | runtime | — | Set only when re-linking is needed |
| `WHATSAPP_OTP_DISABLE_EPOCH_MEMORY` | Revert settle epoch memory to per-process | ✖ | ✖ | SubNation | runtime | unset = enabled | Leave unset |
| `OTP_HMAC_KEY` | Explicit OTP HMAC key override (≥32 chars) | ✖ | ✔ | SubNation | runtime | derives `HMAC(SESSION_SECRET,"whatsapp-otp-v1")` | Leave unset (derivation is the default) |
| `ALERT_DB_FAILURE_THROTTLE_MS` | Alert side-channel throttle during DB outages | ✖ | ✖ | SubNation | runtime | `3600000` | Leave unset |
| `AWS_REGION` | Sentry region-telemetry fallback only (`lib/sentry.ts`) | ✖ | ✖ | SubNation | runtime | `unknown` | Leave unset |

## 4. SubNation runtime — optional integrations (unset = cleanly disabled)

| Variable | Purpose | Required? | Secret? | Service | Build-time/runtime | Default | Operator action |
|---|---|---|---|---|---|---|---|
| `ALERTING_ENABLED` | Master alerting switch | recommended | ✖ | SubNation | runtime | unset = **ENABLED** (only literal `false` disables) | Set `true` |
| `ALERTING_RUNBOOK_URL` | Alert runbook deep links | ✖ | ✖ | SubNation | runtime | `<APP_URL>/OPERATIONS_RUNBOOK.md` | Leave unset |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Ops alert bot (both or neither) | ✖ | ✔ | SubNation | runtime | unset = channel degrades | Set as a pair if used |
| `TELEGRAM_WEBHOOK_SECRET` + `TELEGRAM_ADMIN_IDS` | Telegram approval gateway | ✖ | ✔ | SubNation | runtime | unset = disabled | Optional |
| `DISCORD_WEBHOOK_URL` / `GENERIC_ALERT_WEBHOOK_URL` | Alert channels | ✖ | ✔ | SubNation | runtime | unset = per-channel degrade | Optional |
| `METRICS_ADMIN_TOKEN` | `/api/metrics` bearer (constant-time compared) | ✖ | ✔ | SubNation | runtime | unset = endpoint denied | Optional |
| `SENTRY_DSN` | Backend Sentry (DSN public-by-design) | ✖ | ✖ | SubNation | runtime | unset = Sentry off | Optional |
| `SENTRY_TRACES_SAMPLE_RATE` / `SENTRY_PROFILES_SAMPLE_RATE` / `SENTRY_DEBUG` | Sentry sampling/verbosity | ✖ | ✖ | SubNation | runtime | `0.1` / `0` / off | Leave unset |
| `SENTRY_DASHBOARD_URL` / `NEON_DASHBOARD_URL` | Admin observability deep links | ✖ | ✖ | SubNation | runtime | unset = link hidden | Optional |
| `COPILOT_PROVIDER` / `COPILOT_API_KEY` / `COPILOT_MODEL` / `COPILOT_BASE_URL` | Admin copilot LLM (all-four-or-nothing) | ✖ | API_KEY ✔ | SubNation | runtime | unset = disabled | Optional set |
| `FIREBASE_AUTH_ENABLED` / `FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin (Google sign-in) | ✖ | SA-JSON ✔ | SubNation | runtime | unset = off | Optional; JSON blob OR discrete form |
| `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | Discrete service-account alternative (`lib/firebase-admin.ts`) | ✖ | ✔ | SubNation | runtime | unset | Pick one form only |
| `GCLOUD_PROJECT` / `GOOGLE_APPLICATION_CREDENTIALS` | ADC fallbacks in `firebase-admin.ts` | ✖ | ✖ | SubNation | runtime | unset | Leave unset |
| `GOOGLE_CLIENT_ID` | Backend Google OAuth client id (`auth-settings.ts`) | ✖ | ✖ | SubNation | runtime | unset = provider hidden | Optional |
| `ENRICHMENT_RUNNER_ENABLED` / `ENRICHMENT_DAILY_TOKEN_CAP` / `ENRICHMENT_PER_RUN_CAP` / `FORECAST_RUNNER_ENABLED` | Predictive runners (also need `WORKER_TIER=true`) | ✖ | ✖ | SubNation | runtime | `false` / `50000` / `50` / `false` | Leave unset (inert without a worker) |
| `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` | Source-map upload in `backend/build.mjs` | ✖ | ✔ | SubNation | **build-time only** | unset = upload skipped | CI/GHCR concern — never Coolify runtime env |

## 5. SubNation build-time — VITE_* (baked into the SPA at `docker build`)

Declared as `ARG` in the Dockerfile; pass via Coolify build args (or compose
`build.args`). Never secret. **Rows 1–3 are the single-origin contract.**

| Variable | Purpose | Required? | Secret? | Service | Build-time/runtime | Default | Operator action |
|---|---|---|---|---|---|---|---|
| `VITE_API_BASE_URL` | Absolute API origin | ✖ | ✖ | SubNation build | build-time | empty = relative `/api` | **MUST stay EMPTY** (#1 migration trap) |
| `VITE_SOCKET_URL` | Absolute Socket.IO origin | ✖ | ✖ | SubNation build | build-time | empty = same-origin `io(undefined)` | **MUST stay EMPTY** |
| `VITE_API_URL` | Legacy alias of the above | ✖ | ✖ | SubNation build | build-time | empty | **MUST stay EMPTY** |
| `VITE_APP_ORIGIN` | Canonical origin for SEO/OG tags | recommended | ✖ | SubNation build | build-time | `https://subnation.ly` fallback | Set = `APP_URL` (validator checks membership) |
| `VITE_APP_VERSION` | Sentry release tag override | ✖ | ✖ | SubNation build | build-time | falls to `VITE_RELEASE_SHA` | Leave unset |
| `VITE_SENTRY_DSN` | Frontend Sentry (public by design) | ✖ | ✖ | SubNation build | build-time | unset = off | Optional |
| `VITE_GA_TRACKING_ID` | GA4 loader | ✖ | ✖ | SubNation build | build-time | unset = loader off | Optional |
| `VITE_GSC_VERIFICATION` | Search Console meta tag — read by `frontend/vite.config.ts` (index.html), **zero `import.meta.env` readers by design** | ✖ | ✖ | SubNation build | build-time | unset = no tag | Optional |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth button config | ✖ | ✖ | SubNation build | build-time | unset = hidden | Optional |
| `VITE_FIREBASE_AUTH_ENABLED` + `VITE_FIREBASE_API_KEY` / `_AUTH_DOMAIN` / `_PROJECT_ID` / `_APP_ID` / `_STORAGE_BUCKET` / `_MESSAGING_SENDER_ID` | Firebase web SDK config (public-by-design) | ✖ | ✖ | SubNation build | build-time | unset = provider hidden | Optional, as a set |
| `VITE_OPENWA_DOCS_URL` | Admin WhatsApp page docs deep-link | ✖ | ✖ | SubNation build | build-time | unset = header link hidden | Optional (set to new gateway origin) |
| `VITE_RELEASE_SHA` | Release tag for Sentry | ✖ | ✖ | SubNation build | build-time (derived) | `GIT_SHA ?? RENDER_GIT_COMMIT` | Not an ARG — never set directly |
| `RENDER_GIT_COMMIT` | Render-injected ARG feeding `VITE_RELEASE_SHA` | ✖ | ✖ | SubNation build | build-time (ARG) | empty | Coolify passes `GIT_SHA` instead |
| `import.meta.env.BASE_URL` / `MODE` | Vite builtins | — | — | SubNation build | build-time | Vite-managed | Not operator variables |

## 6. openwa gateway — runtime (compose service 2 / Coolify service 2)

| Variable | Purpose | Required? | Secret? | Service | Build-time/runtime | Default | Operator action |
|---|---|---|---|---|---|---|---|
| `OPENWA_API_KEY` | Gateway auth (open-relay guard; also gates persistence + dashboard secret fallback) | ✔ (exit 1) | ✔ | openwa | runtime | — | MUST EQUAL `WHATSAPP_OTP_API_KEY` |
| `PERSISTENCE_URL` | Neon Postgres for session persistence (self-creates `openwa_sessions`) | ✔ compose | ✔ | openwa | runtime | unset = local folder only | Separate URL; may be the SAME Neon DB as `DATABASE_URL` |
| `OPENWA_CREDENTIALS_KEY` | Session-credential encryption (persist.ts) | ✔ compose | ✔ | openwa | runtime | derives from API key (legacy) | ≥32 chars; MUST differ from `OPENWA_API_KEY`; **generate ONCE** |
| `DATA_DIR` | Hot auth-folder root | ✖ | ✖ | openwa | runtime | `/data` (image ENV) | Mount the `openwa-data` volume |
| `PORT` | Gateway bind | ✖ | ✖ | openwa | runtime | `2785` (image/compose) | Compose-owned |
| `NODE_ENV` | Mode | ✖ | ✖ | openwa | runtime | `production` (image ENV) | Image-pinned |
| `LOG_LEVEL` | Gateway logger | ✖ | ✖ | openwa | runtime | `info` | Leave unset |
| `DASHBOARD_USERNAME` + `DASHBOARD_PASSWORD` | Operator dashboard (pair or neither; ≥8 chars) | ✖ | PASSWORD ✔ | openwa | runtime | unset = disabled | Optional pair |
| `DASHBOARD_SESSION_SECRET` | Dashboard cookie signing | ✖ | ✔ | openwa | runtime | scrypt(API key) | ≥32 chars if the dashboard is on |
| `OPENWA_SELF_SEND_LID` | Self-send LID routing opt-out | ✖ | ✖ | openwa | runtime | unset = enabled | `0` only to disable |
| `TRUST_PROXY` | Forwarded-header trust (rate-limit identity) | ✖ | ✖ | openwa | runtime | unset = trust rightmost XFF | Set `0` ONLY for direct-publish (no proxy) |

## 7. Compose-only interpolation (never consumed by app code)

| Variable | Purpose | Required? | Secret? | Service | Build-time/runtime | Default | Operator action |
|---|---|---|---|---|---|---|---|
| `SUBNATION_HOST_PORT` / `OPENWA_HOST_PORT` | Host port bindings for bare-VM compose | ✖ | ✖ | compose | compose-time | `127.0.0.1:3000` / `127.0.0.1:3001` | Loopback-only; delete under Coolify Traefik |
| `OPENWA_REPO_DIR` | Sibling openwa clone path (local Variant-A builds) | ✖ | ✖ | compose | compose-time | `../openwa` | Local builds only — production uses the GHCR image |

## 8. Legacy Render-only — DO NOT SET on Coolify

Verified against the frozen `render.yaml` (and code). Every row below is either
defined only in `render.yaml`, platform-injected by Render, or a documented-dead
entry. Carrying any of these onto Coolify re-splits or misconfigures the stack.

| Variable | Why it exists there | Operator action |
|---|---|---|
| `VERCEL_FRONTEND_ORIGIN` | render.yaml pin REMOVED (R116 A7-2) — Vercel→Render split remnant; backend still reads it in `lib/origins.ts` for rollback compat | Leave unset on the single-origin stack |
| `FRONTEND_ORIGINS` | render.yaml `sync:false` — same split-deployment class | DO NOT SET |
| `RENDER_DASHBOARD_URL` | render.yaml `sync:false` — Render console deep link (admin observability) | DO NOT SET — link dies with Render anyway |
| `ADMIN_RESET_PASSWORD` | render.yaml `"false"` — seed-script flag (`scripts/src/seed.ts`), zero backend runtime readers | DO NOT SET |
| render.yaml's `VITE_API_BASE_URL` / `VITE_SOCKET_URL` / `VITE_API_URL` = `https://subnation2.onrender.com` | The frozen blueprint's split-origin values | DO NOT SET — must be EMPTY on Coolify (§5) |
| `RENDER_DEPLOY_ID` / `RENDER_GIT_BRANCH` / `RENDER_GIT_COMMIT` / `RENDER_INSTANCE_ID` / `RENDER_REGION` / `RENDER_SERVICE_ID` / `RENDER_SERVICE_NAME` | Render platform-injected (read by diagnostics/Sentry telemetry for display only); NOT defined in render.yaml | No action — absent on Coolify; `GIT_SHA` is the neutral replacement |
| `WORKER_TIER` worker tier | render.yaml documents a future manual worker service; the tier was removed from the blueprint | Keep unset until a real worker exists |
| `REDIS_URL` (Render Redis attachment) | **Intentionally absent from render.yaml** — no Redis is provisioned anywhere; backend degrades to in-memory fallbacks by design | Leave unset on Coolify |
| `GITHUB_*` (token/app/webhook) | **None exist** — grepped render.yaml and all sources: zero matches | Nothing to migrate |
| `BASE_PATH`, `WORKER_ROLE`, `SENTRY_DSN_BACKEND` / `SENTRY_DSN_FRONTEND`, `VITE_FIREBASE_MEASUREMENT_ID`, `VITE_APP_NAME`, `VITE_FIREBASE_DATABASE_URL`, `NEON_API_KEY`, `FRONTEND_PORT` | Documented dead / dev-only / template-only in `config/env.example` — zero production readers (verified by grep) | Never set |

## 9. Hard rules (the equality/shape contract)

1. `WHATSAPP_OTP_API_KEY` **=** `OPENWA_API_KEY` (SubNation sends it; openwa
   timing-safe-validates it). The ONLY required equality.
2. `OPENWA_CREDENTIALS_KEY` **≠** `OPENWA_API_KEY` (separate encryption domain).
3. `ENCRYPTION_KEY` is exactly **64 hex chars** (32 bytes).
4. `SESSION_SECRET` and `ADMIN_JWT_SECRET` are each **≥32 chars** and **differ
   from each other** (and from `ENCRYPTION_KEY`).
5. `VITE_API_BASE_URL` / `VITE_SOCKET_URL` / `VITE_API_URL` stay **EMPTY** —
   single-origin: the backend serves the SPA; empty = relative `/api` +
   same-origin WebSockets. Setting any re-splits the deployment.
6. `DATABASE_URL` and `PERSISTENCE_URL` are separate Neon URLs — the SAME
   database is fine; openwa self-creates its `openwa_sessions` table.
7. `SINGLE_INSTANCE_MODE=true` + `DISABLE_WEB_SCHEDULERS=false` is THE
   production contract (validator errors in the compose profile otherwise).

## 10. Validating the filled env

```bash
pnpm --filter @workspace/scripts exec tsx src/validate-production-env.ts \
  --file .env --profile compose --strict
```

Must **exit 0** before any deploy minutes are spent. It catches: template
placeholders that pass length rules, wrong `ENCRYPTION_KEY` shape, every
forbidden secret equality, the `WHATSAPP_OTP_API_KEY`/`OPENWA_API_KEY` parity,
origin-set consistency, non-empty `VITE_API_*` on a single-origin stack, and the
`SINGLE_INSTANCE_MODE`/Redis-economics gate — all without printing values.
Post-deploy, re-verify with `scripts/final-cutover-preflight.sh` (§B/§C re-check
shapes and equalities, value-silent). Generation:
`scripts/generate-production-secrets.sh` — correct shapes, nothing written to
disk or repo, never rotates existing values → `SECRET_HANDLING_FINAL.md`.
