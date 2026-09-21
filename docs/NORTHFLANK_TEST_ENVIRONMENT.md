# Northflank Test/Secondary Environment

> **Status: PREPARED — awaiting a valid Northflank API token to execute the
> deployment.** All prerequisites (deploy key, deployment scripts, env matrix,
> local verification) are complete. See "Deployment procedure" below.

Date: 2026-09-21
Context: Render account is temporarily billing-suspended. Northflank becomes
the **temporary parallel runtime** so development and testing can continue
immediately. This is **not** a production migration.

## Non-negotiable principles

1. **Render remains the production deployment.** Nothing about the Render
   configuration (render.yaml, services, env) is changed by this effort.
2. **Neon remains the database.** The Northflank backend uses the same Neon
   connection string as production (data parity — the catalog, users, and
   orders are all served from the canonical database). No Northflank database
   is provisioned. No destructive migration/seed/reset is ever run.
3. **Vercel remains the frontend host.** No production frontend change.
4. **No DNS cutover.** `subnation.ly` / `www` / Cloudflare records stay
   exactly as they are until the Northflank deployment is fully verified AND
   the operator explicitly decides otherwise.
5. **No keepalive traffic.** No self-pings, no cron pings, no external
   pingers, no GitHub keepalive workflows. The event-driven maintenance
   architecture from the free-tier round is preserved.
6. **No Redis.** The existing PG-lease + in-memory fallbacks remain in effect.

## Architecture

```
PRODUCTION (unchanged, currently suspended):
  subnation.ly → Cloudflare → Render (subnation2 + openwa-gateway)
  Vercel (subnation-seven.vercel.app) → Render API
  Neon (ep-spring-term-…-pooler.c-11.us-east-1.aws.neon.tech / neondb)

TEST / PARALLEL RUNTIME (Northflank, project "subnation-test"):
  subnation-backend  ← builds SubNation2 @ main (Dockerfile, port 8080,
                       health /api/healthz, serves API + SPA on one origin)
  openwa-gateway     ← builds openwa @ main (Dockerfile, port 2785,
                       health /healthz, X-API-Key auth, session persistence
                       in the same Neon DB via PERSISTENCE_URL)
  subnation-backend → openwa-gateway (WHATSAPP_OTP_BASE_URL)
  Both use the existing Neon DB (read/write parity, no destructive ops).
```

## What was prepared (2026-09-21)

| Item | Detail |
| --- | --- |
| Read-only GitHub deploy key | `northflank-deploy-readonly` (key id 163953141) added to `ahmadmedo1012/SubNation2` — lets Northflank build the private repo without any broad credential. The openwa repo is public and needs no key. |
| Deployment orchestrator | `/home/z/my-project/scripts/northflank/deploy.py` (validate / project / openwa / backend / wire / status / smoke). Idempotent; state in `.secrets/nf_state.json`. |
| Token hygiene | The orchestrator structurally validates the API token (JWT decode + tokenId hex check) before any call, and dies with a clear message if the token is corrupted. |
| Env matrix | Derived from `scripts/restore_env_vars.json` (production values — same secrets, same DB). See table below. |
| Local verification | `pnpm install --frozen-lockfile` ✓ · lint 0 errors ✓ · typecheck ✓ · backend tests 1212/1212 ✓ · frontend tests 561/561 ✓ · backend+frontend builds ✓ (PWA 12 entries / 385.54 KiB) |
| Commits at time of prep | SubNation2 `263c98b` (r103) · openwa `97e65e6` (round-98) |

## Environment configuration (values live in Northflank, never committed)

**subnation-backend** (build args + runtime env):

- Build args: `VITE_API_BASE_URL`/`VITE_SOCKET_URL` left **empty** → the SPA
  uses relative `/api` paths against whatever origin serves it (same-origin
  default; no hardcoded URLs in the bundle). Firebase web config is passed
  through as public build args.
- Runtime: `NODE_ENV=production`, `DATABASE_URL` (existing Neon), `DB_POOL_MAX=8`,
  `DB_IDLE_TIMEOUT_MS=10000`, `DB_CONNECTION_TIMEOUT_MS=30000`,
  `SESSION_SECRET`/`ADMIN_JWT_SECRET`/`ENCRYPTION_KEY` (production values —
  required for existing user/admin sessions and encrypted fields to work),
  `APP_URL`/`APP_ORIGIN`/`APP_ORIGINS` = Northflank URL + `https://subnation.ly`
  + `https://www.subnation.ly`, `VERCEL_FRONTEND_ORIGIN=https://subnation-seven.vercel.app`,
  `AUTH_COOKIE_SAMESITE=none` (Secure + HttpOnly remain enforced),
  `WHATSAPP_OTP_BASE_URL` = Northflank openwa URL, `WHATSAPP_OTP_API_KEY` /
  `WHATSAPP_OTP_SESSION=subnation-otp` / `WHATSAPP_OTP_AUTO_CREATE_SESSION=true` /
  `WHATSAPP_OTP_OPERATOR_E164=218910089975`, `FIREBASE_AUTH_ENABLED=true`,
  `FIREBASE_PROJECT_ID=subnation-2571e`, `ALERTING_ENABLED=false` (test env —
  no alert noise), `DISABLE_WEB_SCHEDULERS=false`, `DISABLE_BOOT_MIGRATIONS=false`
  (migrations are idempotent, lock-protected, and already applied).

**openwa-gateway** (runtime env):

- `OPENWA_API_KEY` (matches backend `WHATSAPP_OTP_API_KEY`), `PERSISTENCE_URL`
  (same Neon URL — session credentials are AES-256-GCM encrypted at rest and
  auto-restored at boot), `LOG_LEVEL=info`.
- `OPENWA_CREDENTIALS_KEY` intentionally **unset** → legacy derivation from
  `OPENWA_API_KEY`, so any session blobs persisted by the Render gateway
  decrypt without migration. If the operator ever set a dedicated
  `OPENWA_CREDENTIALS_KEY` on the Render gateway, it must be provided for
  session restore; OTP would otherwise need a fresh QR pairing.
- `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` unset → operator dashboard
  disabled (smaller surface; pairing via authenticated API if ever needed).

## Deployment procedure

Prerequisite: a valid Northflank API token in
`/home/z/my-project/.secrets/nf_token.txt` (owner-role, created via
Northflank → Settings → API → Create API token, copied with the copy button).

```bash
python3 /home/z/my-project/scripts/northflank/deploy.py validate  # token + account check
python3 /home/z/my-project/scripts/northflank/deploy.py project   # create project subnation-test
python3 /home/z/my-project/scripts/northflank/deploy.py openwa    # build + deploy openwa-gateway
python3 /home/z/my-project/scripts/northflank/deploy.py backend   # build + deploy subnation-backend
# wait for builds (~5-10 min each; `deploy.py status` to poll)
python3 /home/z/my-project/scripts/northflank/deploy.py wire      # apply real URLs into backend env + build args, rebuild
python3 /home/z/my-project/scripts/northflank/deploy.py smoke     # 17-check read-only smoke suite
```

The `wire` step exists because Northflank URLs are only generated after
service creation; it PATCHes `APP_URL`/`APP_ORIGIN`/`APP_ORIGINS`/
`WHATSAPP_OTP_BASE_URL` + `VITE_APP_ORIGIN` with the real URLs and triggers a
rolling rebuild. The bootstrap gate (503 `starting` on `/api/healthz`) keeps
health probes honest during cold start.

## Smoke suite (read-only, no purchases, no real OTP)

`deploy.py smoke` verifies: backend healthz · products API count · Arabic
names · local `/products/` images · categories · product detail by slug ·
variants · pricing sanity · auth providers config · user session gate (401) ·
wallet read gate (401) · orders read gate (401) · admin auth path (wrong-creds
probe) · Socket.IO handshake · openwa healthz · openwa API key auth (401
without key / 200 with key) · SPA shell + manifest.json + sw.js. Latencies are
recorded per check into `logs/nf-smoke-results.json`.

## Rollback

Northflank failing or being abandoned requires **no action** on production:
simply stop using the Northflank URLs. Optionally delete the
`subnation-test` Northflank project (single click / one API call) and remove
the `northflank-deploy-readonly` key from GitHub (Deploy keys in repo
settings). Render, Vercel, Neon, and DNS are untouched throughout.

## Known limitations (test runtime)

- Firebase service account is not configured on the test backend (the
  Render-only secret), so Google Sign-In token verification will fail there;
  WhatsApp OTP + username/password auth remain fully testable.
- The Northflank backend runs schedulers under the Postgres leader lease
  against the same Neon DB. If Render is ever resumed simultaneously, the
  leader lock ensures no double-execution of cron jobs.
- Catalog/admin writes made against the test runtime affect the canonical
  database — treat it with production discipline.
