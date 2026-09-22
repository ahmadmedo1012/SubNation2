# Environment Variable Matrix

> r107 canonical matrix for SubNation2 + openwa. Legend:
> **Req** = required (boot fails / feature dead without it) · **Sec** = secret
> (never in build args, logs, or frontend) · `D`efault shown when unset.
> Failure behavior: what actually happens when the var is missing/broken.

## 1. SubNation backend — required at boot (production)

| Variable | Req | Sec | Default | Used by | Failure when missing |
|---|---|---|---|---|---|
| `DATABASE_URL` | ✔ | ✔ | — | `shared/db/src/index.ts` (pg pool) | module-load throw → exit(1) |
| `SESSION_SECRET` | ✔ | ✔ | — | `lib/jwt.ts` (user JWT) | throw (≥32 chars enforced) |
| `ENCRYPTION_KEY` | ✔ | ✔ | — | `lib/encryption.ts` (AES-256-GCM) | boot assert fails (exactly 64 hex) |
| `ADMIN_JWT_SECRET` | ✔ prod | ✔ | dev: derived+warn | `lib/jwt.ts` | prod throw; equals SESSION_SECRET → reject |
| `APP_URL` / `APP_ORIGINS` | ✔ prod | ✖ | — | CORS/CSRF/Socket.IO (`lib/origins.ts`) | prod boot-aborts with empty allow-list |
| `PORT` | ✖ | ✖ | `8080` | `server.ts` | binds 8080 |

## 2. SubNation backend — behavior knobs

| Variable | Sec | Default | Used by | Notes / failure |
|---|---|---|---|---|
| `AUTH_COOKIE_SAMESITE` | ✖ | `lax` prod-safe | `app.ts` cookie flags | same-origin now; `none` only for the old split |
| `REDIS_URL` | ✔ | unset | `lib/redis-client.ts` + consumers | unset = in-memory fallbacks (current prod shape); set-but-down = capped backoff, boot degrades ≤8 s, never exits |
| `DISABLE_WEB_SCHEDULERS` | ✖ | `false` | `lib/web-scheduler.ts` | **true with no worker = all crons silently dead** (keep false) |
| `DISABLE_BOOT_MIGRATIONS` | ✖ | `false` | `server.ts` | emergency rollback hatch only |
| `WORKER_TIER` | ✖ | unset | cron slot gating | unset on the single container is correct |
| `DB_POOL_MAX` / `DB_IDLE_TIMEOUT_MS` / `DB_CONNECTION_TIMEOUT_MS` | ✖ | `8` / `10000` / `30000` | pool init | 8 matches Neon free compute |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | ✖ | `25000` (r107) | `server.ts` drain | keep BELOW compose `stop_grace_period` (40 s) |
| `SCHEDULER_LEASE_REFRESH_MS` | ✖ | `25000` (r107) | `lib/scheduler-coordinator.ts` | capped at TTL/2; see migration doc §9 for the Neon-awake trade |
| `SCHEDULER_LEASE_TTL_SEC` | ✖ | `60` (r107) | same | ≥10 enforced |
| `SCHEDULER_OP_TIMEOUT_MS` | ✖ | `2000` | leadership ops | test/ops override |
| `GIT_SHA` | ✖ | — | `lib/release-sha.ts` | falls to RENDER_GIT_COMMIT → "unknown" (cosmetic) |
| `SLOW_QUERY_THRESHOLD_MS` | ✖ | `250` | db instrumentation | warn-log only |
| `SENTRY_DSN` / `SENTRY_TRACES_SAMPLE_RATE` / `SENTRY_PROFILES_SAMPLE_RATE` | DSN ✖ | `0.1` / `0` | `lib/sentry.ts` | unset = Sentry off cleanly |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` | ✔ | — | `build.mjs` sourcemaps | unset = upload silently skipped |
| `SENTRY_DASHBOARD_URL` / `NEON_DASHBOARD_URL` / `RENDER_DASHBOARD_URL` | ✖ | — | admin observability links | unset = link hidden |
| `ALERTING_ENABLED` | ✖ | — | `services/alerting.service.ts` | unset/false = NOBODY paged |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | ✔ | — | alerting ops bot | unset = channel degrades per-channel |
| `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_ADMIN_IDS` | ✔ | — | approval gateway | unset = approval webhook disabled |
| `DISCORD_WEBHOOK_URL` / `GENERIC_ALERT_WEBHOOK_URL` | ✔ | — | alerting channels | per-channel degrade |
| `METRICS_ADMIN_TOKEN` | ✔ | — | `/api/metrics` bearer | unset = metrics endpoint 404-class denial |
| `WHATSAPP_OTP_BASE_URL` / `WHATSAPP_OTP_API_KEY` | API_KEY ✔ | — | `services/openwa.service.ts` | unset = OTP 503 `gateway_disabled`; base can be the compose-internal `http://openwa:2785` |
| `WHATSAPP_OTP_SESSION` / `WHATSAPP_OTP_AUTO_CREATE_SESSION` / `WHATSAPP_OTP_SETTLE_MS` / `WHATSAPP_OTP_OPERATOR_E164` | ✖ | `subnation-otp` / `true` / `45000` / — | same | settle window clamped 0-300000 |
| `COPILOT_PROVIDER` / `COPILOT_API_KEY` / `COPILOT_MODEL` / `COPILOT_BASE_URL` | API_KEY ✔ | — | copilot + enrichment | all-four-or-nothing; feature disabled cleanly |
| `FIREBASE_AUTH_ENABLED` / `FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT_JSON` | SA-JSON ✔ | — | `lib/firebase-admin.ts` | unset = Google/Telegram identity off, WhatsApp OTP unaffected |
| `OTP_HMAC_KEY` | ✔ | derives from SESSION_SECRET | `whatsapp-otp.service.ts` | explicit key recommended in prod |
| `ENRICHMENT_RUNNER_ENABLED` / `FORECAST_RUNNER_ENABLED` | ✖ | `false` | runners | worker-tier gated, inert today |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_RESET_PASSWORD` | PASSWORD ✔ | — | seed script only | never needed at runtime |
| `ALLOW_DEMO_SEED` | ✖ | — | seed guard | keep unset in prod |

## 3. SubNation frontend — BUILD-TIME (baked into the SPA; Vite ARGs in the Dockerfile)

| Variable | Sec | Default when empty | Notes |
|---|---|---|---|
| `VITE_API_BASE_URL` / `VITE_API_URL` | ✖ | same-origin relative `/api` | **LEAVE EMPTY on the single-origin stack** — the #1 migration trap |
| `VITE_SOCKET_URL` | ✖ | same-origin `io(undefined)` | same rule |
| `VITE_APP_ORIGIN` / `VITE_APP_VERSION` | ✖ | `https://subnation.ly` fallback in SEO builders | product domain, not hosting |
| `VITE_SENTRY_DSN` | ✖ (DSNs are public) | Sentry off | |
| `VITE_RELEASE_SHA` | ✖ | — | Dockerfile resolves `GIT_SHA ?? RENDER_GIT_COMMIT` (r107) |
| `VITE_GA_TRACKING_ID` / `VITE_GSC_VERIFICATION` | ✖ | loader off / no tag | |
| `VITE_GOOGLE_CLIENT_ID` / `VITE_FIREBASE_*` (9 vars) | ✖ | provider hidden | public-by-design web config |
| `VITE_OPENWA_DOCS_URL` | ✖ | built-in Render gateway URL (r107) | admin deep-link only; set to the new gateway origin after it migrates |

## 4. openwa gateway (compose service 2)

| Variable | Req | Sec | Default | Failure when missing |
|---|---|---|---|---|
| `OPENWA_API_KEY` | ✔ | ✔ | — | exit(1) at boot; also gates persistence + dashboard secret fallback |
| `PERSISTENCE_URL` | ✔* | ✔ | unset = no persistence | *required for session survival across restarts; gateway otherwise runs on the local folder |
| `OPENWA_CREDENTIALS_KEY` | rec | ✔ | derives from API key | set once, ≥32 chars, never rotate casually |
| `DATA_DIR` | ✖ | ✖ | `/data` (Dockerfile) | mount the volume or lose the hot folder |
| `PORT` | ✖ | ✖ | `2785` | compose sets it per-service |
| `LOG_LEVEL` | ✖ | ✖ | `info` | |
| `DASHBOARD_USERNAME` + `DASHBOARD_PASSWORD` | ✖ | PASSWORD ✔ | unset = dashboard disabled | both required together, ≥8 chars |
| `DASHBOARD_SESSION_SECRET` | ✖ | ✔ | scrypt(API key) | ≥32 chars recommended |

## 5. Compose-only (docker-compose.yml interpolation)

| Variable | Default | Purpose |
|---|---|---|
| `SUBNATION_HOST_PORT` | `127.0.0.1:3000` | host binding for local debugging |
| `OPENWA_HOST_PORT` | `127.0.0.1:3001` | same for the gateway |
| `OPENWA_REPO_DIR` | `../openwa` | where the sibling clone lives for variant-A builds |

## 6. Dev / Test profiles

- **Development (pnpm dev):** everything optional except DATABASE_URL +
  SESSION_SECRET (dev-derived ADMIN_JWT_SECRET warns), empty APP_ORIGINS =
  permissive socket/CORS mode. Tests run against mocks (backend vitest) —
  no real Neon/Redis needed.
- **docker-verify.sh:** requires the four boot-critical secrets + DATABASE_URL
  only; everything else defaults to the same-origin contract.
- **Production (compose/Coolify):** sections 1 + 4 required; 2/3 per feature.

Dead variables (kept out of confusion): `BASE_PATH`, `WORKER_ROLE`,
`SENTRY_DSN_BACKEND/FRONTEND`, `VITE_FIREBASE_MEASUREMENT_ID` — documented
DEAD in `config/env.example`; do not resurrect.
