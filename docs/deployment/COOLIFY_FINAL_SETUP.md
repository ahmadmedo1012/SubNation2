# Coolify Final Setup — SubNation + OpenWA (R112 production)

> Step-by-step Coolify resource configuration for the final Oracle cutover.
> The AUTHORITATIVE production strategy is declared in the header comment of
> `docker-compose.yml` (R112) — this doc implements it:
>
> 1. **SubNation** = a Coolify resource building THIS repository from Git
>    (repo-root Dockerfile); every deploy traces to an exact commit;
>    rollback = redeploy an older commit.
> 2. **OpenWA** = a SEPARATE Coolify service running the IMMUTABLE image
>    `ghcr.io/ahmadmedo1012/openwa:sha-<short>` (multi-arch, per-commit
>    tags). Pin the exact sha tag; `:latest`/`:main` are dev-only.
> 3. **Emergency fallback** = `ghcr.io/ahmadmedo1012/subnation2:sha-<short>`
>    (prebuilt, same pinning rule) if the Coolify builder is broken.
>
> Companions: `ORACLE_FINAL_SETUP.md` (VM prep — first) ·
> `CLOUDFLARE_FINAL_CUTOVER.md` (DNS switch, last) ·
> `FINAL_ROLLBACK_RUNBOOK.md` (rollback) · `ENVIRONMENT_MATRIX.md` (env
> matrix) · `deploy/env.compose.example` (runtime template).
>
> UI honesty: Coolify's UI evolves; panels are named by FUNCTION (Environment
> Variables / build args / Domains / Health Check) — match by function if a
> label differs in your version.

## 1. Prerequisites

- [ ] Coolify installed on the Oracle VM (wizard done, strong admin
      password). VM prep — firewall contract (public 22/80/443 only), swap,
      Docker: `docs/deployment/ORACLE_FINAL_SETUP.md`.
- [ ] GitHub connected to Coolify (source-control providers) with a token
      that can READ `ahmadmedo1012/SubNation2` (private repo; read-only PAT).
- [ ] Secrets generated ONCE, stored offline:
      `./scripts/generate-production-secrets.sh` → SESSION_SECRET, ENCRYPTION_KEY
      (64 hex), ADMIN_JWT_SECRET, OPENWA_API_KEY, OPENWA_CREDENTIALS_KEY, plus
      WHATSAPP_OTP_API_KEY pre-filled = OPENWA_API_KEY (MUST stay identical;
      dashboard: `DASHBOARD_ENABLED=1`).
- [ ] Neon reachable FROM the VM: `DATABASE_URL` (app) and
      `PERSISTENCE_URL` (gateway sessions — same DB is fine).
- [ ] The exact short SHA being deployed — `git rev-parse --short HEAD` (HEAD
      at writing: `521234f`) for GIT_SHA (§2.2) + the openwa `sha-` tag (§3).

## 2. Resource 1 — SubNation (Git repository, Docker build pack)

### 2.1 Resource shape

- Type: application from a **Git repository** → GitHub →
  `ahmadmedo1012/SubNation2`, branch `main`, root directory `/`.
- Build pack: **Docker** (builds the repo-root `Dockerfile`). Do NOT point
  this resource at `docker-compose.yml` — compose is the local/bare-VM path,
  not the production one.
- Destination: the **Coolify docker network** (the one Traefik watches) —
  BOTH resources must share it; it is what makes `http://openwa:2785`
  routable from SubNation (§2.3).
- Container port **8080** (Dockerfile EXPOSE 8080 / ENV PORT=8080; the app
  serves API + SPA single-origin). Do NOT publish 8080 on the host —
  Traefik owns 80/443. Exactly ONE replica (SINGLE_INSTANCE_MODE).

### 2.2 Build args (enter in the build-args panel — public, non-secret
values only; the Dockerfile consumes ONLY these ARGs; secrets never pass
through build args)

```
# required for release identity:
GIT_SHA=521234f              # the EXACT short SHA being deployed — lands in
                             # /api/healthz .version, logs, Sentry release tag
VITE_APP_ORIGIN=https://subnation.ly

# optional, public-only (empty default = feature cleanly off):
VITE_SENTRY_DSN=
VITE_GA_TRACKING_ID=
VITE_GSC_VERIFICATION=
VITE_GOOGLE_CLIENT_ID=
VITE_FIREBASE_AUTH_ENABLED=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_OPENWA_DOCS_URL=        # admin WhatsApp docs deep-link — LEAVE EMPTY in
                             # the default topology (the gateway is internal;
                             # the admin page degrades to a plain hint). Set a
                             # restricted dashboard hostname only if you
                             # expose one.
```

**CRITICAL — leave `VITE_API_BASE_URL`, `VITE_SOCKET_URL`, `VITE_API_URL`
EMPTY (do not set them at all).** From `docker-compose.yml`'s header:

> SINGLE-ORIGIN CONTRACT — DO NOT BREAK: Leave VITE_API_BASE_URL /
> VITE_SOCKET_URL / VITE_API_URL EMPTY. The backend serves the SPA itself;
> empty build vars make the browser use relative /api paths and same-origin
> WebSockets (api-config.ts). Setting them to any absolute origin silently
> re-splits the deployment.

Empty = relative `/api` + same-origin WebSocket — the correct single-origin
shape; anything else breaks cookies/CORS/sockets at runtime.

### 2.3 Runtime env (Environment Variables panel — from
`deploy/env.compose.example`, required block)

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
SESSION_SECRET=<generated>          # 32+ chars
ENCRYPTION_KEY=<generated>          # exactly 64 hex chars
ADMIN_JWT_SECRET=<generated>        # must differ from SESSION_SECRET
APP_URL=https://subnation.ly
APP_ORIGINS=https://subnation.ly,https://www.subnation.ly
APP_ORIGIN=https://subnation.ly     # admin alert deep links
AUTH_COOKIE_SAMESITE=lax            # single-origin: lax is the strong setting
SINGLE_INSTANCE_MODE=true           # ONE replica ONLY — crons double-run at 2
DISABLE_WEB_SCHEDULERS=false        # no worker tier exists; true kills crons
WHATSAPP_OTP_BASE_URL=http://openwa:2785
WHATSAPP_OTP_API_KEY=<identical to OPENWA_API_KEY on the openwa resource>
WHATSAPP_OTP_SESSION=subnation-otp
WHATSAPP_OTP_AUTO_CREATE_SESSION=true
ALERTING_ENABLED=true               # alerting dark = dead checkouts page nobody
```

`WHATSAPP_OTP_BASE_URL` note: `http://openwa:2785` is the compose-network
service name; in Coolify use whatever name routes to the openwa resource on
the shared Coolify network — resource/service named `openwa` →
`http://openwa:2785` resolves; else the internal hostname/FQDN Coolify
shows. Verify before the first OTP:

```bash
docker exec <subnation-container> \
  wget -qO- http://openwa:2785/healthz   # must answer — else fix the name
```

Optional integrations (unset = cleanly off; full list:
`ENVIRONMENT_MATRIX.md` §2): `SENTRY_DSN`, `TELEGRAM_BOT_TOKEN` +
`TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`, `COPILOT_*`,
`FIREBASE_SERVICE_ACCOUNT_JSON`, `METRICS_ADMIN_TOKEN`. Leave at default:
`DISABLE_BOOT_MIGRATIONS` (emergency hatch — keep false). No `VITE_*` here
(build-time, §2.2); no `PORT` override (Dockerfile pins 8080).

Emergency fallback (Coolify builder broken): redeploy this resource as a
registry image `ghcr.io/ahmadmedo1012/subnation2:sha-<short>` — private
package, so the VM needs a one-time `docker login ghcr.io` with a
`read:packages` PAT. Same env, same pinning rule.
**PENDING (r113):** the `subnation2` GHCR package does not exist yet — the
repo's `docker.yml` workflow has never run (it triggers manually / on `v*`
tags, and GitHub Actions is currently billing-suspended). One manual
`workflow_dispatch` run after Actions is restored publishes the first
sha-tagged image; until then the only rollback path is redeploy-from-git
(the primary path anyway).

## 3. Resource 2 — OpenWA (registry image, sha-pinned)

- Type: application from a **registry image** (public registry).
- Image: `ghcr.io/ahmadmedo1012/openwa:sha-<short>` — PIN THE EXACT TAG.
  Where to find it: the openwa repo's GitHub Actions docker workflow
  publishes a `sha-<short>` tag per commit (run summary + GHCR package
  page), or `docker manifest inspect ghcr.io/ahmadmedo1012/openwa:sha-<short>`
  (public image — no login). `:latest`/`:main` float — dev-only.
- Destination: the SAME Coolify docker network as SubNation. Container
  port 2785; no host publish; no public domain (§6).
- Runtime env (the gateway's COMPLETE read-set — nothing else):

```env
OPENWA_API_KEY=<generated>          # == WHATSAPP_OTP_API_KEY on SubNation
PERSISTENCE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
OPENWA_CREDENTIALS_KEY=<generated>  # generate ONCE — only the FIRST rotation
                                    # is transparent; a second forces QR re-pair
# optional operator dashboard (disabled when unset):
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<8+ chars>
DASHBOARD_SESSION_SECRET=<32+ chars>
```

- Persistent volume mounted at `/data` — Baileys auth state (DB stays the
  source of truth for restart survival; the volume is defense-in-depth:
  keeps the hot auth folder, faster restores).

## 4. Healthchecks (both resources)

| Resource | Path | Port | Start period | Why |
|---|---|---|---|---|
| SubNation | `/api/healthz` | 8080 | **~150 s** | boot migrations + cold Neon: 503 `starting` until the readiness gate opens, then 200 |
| OpenWA | `/healthz` | 2785 | ~10 s (fast) | gateway boots in seconds; no migrations |

Interval 30 s, timeout 5 s, retries 3 — mirrors the Dockerfile/compose healthchecks
(Coolify reads the image HEALTHCHECK by default; enter these if the panel asks).

## 5. Deployment order

Either order works. OpenWA is the OTP dependency, but SubNation's OTP path is
retryable: gateway down/cold → backend answers `503 gateway_waking` +
`Retry-After: 30`, frontend auto-retries. Recommended: deploy **SubNation
first** (watch `/api/healthz` 503 → 200), then **OpenWA within minutes**.
The first E2E OTP test (and the `subnation-otp` restore from Neon) needs
both up — run it before attaching traffic (`MIGRATION_RUNBOOK.md` Ph. 5).

## 6. Domains (Traefik routing + Let's Encrypt)

- SubNation resource → **Domains**: add `https://subnation.ly` AND
  `https://www.subnation.ly`. Traefik generates the routers; certs come
  from **Let's Encrypt production** (staging certs fail Cloudflare Full
  strict). Both hosts must appear in `APP_ORIGINS` (§2.3).
- LE issuance requires the hostname to resolve to the VM once — see the
  pre-issuance note in `CLOUDFLARE_FINAL_CUTOVER.md` §5 BEFORE the DNS switch.
- **OpenWA gets NO public domain** — internal only (the backend reaches it
  over the Coolify network). Exception: if the operator wants the dashboard/QR
  pages from the internet, expose them ULTRA-restricted — Cloudflare Access (or
  a strict IP allowlist) in front of a dedicated hostname: the gateway's API
  auth is the single API key (no admin tier) — a bare public domain is a no-go.

## 7. Rollback

- **SubNation (Git resource):** redeploy the previous commit — older SHA
  + matching `GIT_SHA` build arg. Migrations are idempotent, additive-policy
  (emergency hatch: `DISABLE_BOOT_MIGRATIONS=true`, see `ENVIRONMENT_MATRIX.md`).
- **OpenWA (image resource):** switch the image tag back to the previous
  `sha-<short>` and redeploy.
- Full rollback choreography: `docs/deployment/FINAL_ROLLBACK_RUNBOOK.md`.

## 8. Copy/paste checklist

- [ ] GitHub connected to Coolify
- [ ] SubNation resource created (Git, `main`, Docker build pack)
- [ ] OpenWA resource created (registry image, `sha-`-pinned)
- [ ] runtime env entered (both resources — §2.3 / §3)
- [ ] build args entered (SubNation — exact `GIT_SHA`; API/socket `VITE_*` EMPTY)
- [ ] healthchecks green (both resources)
- [ ] domain attached + HTTPS green (SubNation — LE production)
- [ ] `/api/healthz` 200 through the domain — and `.version` equals the
      GIT_SHA you deployed (deployed-SHA gate, `MIGRATION_RUNBOOK.md` Ph. 4)
