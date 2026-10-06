# SubNation2 Platform

> **Status banner (2026-09-22, r108):** the platform is a FINAL MIGRATION
> CANDIDATE for self-hosted Oracle Cloud (ARM64) + Coolify + Docker. The
> app code is hosting-agnostic (r107 audit: no Render/Vercel runtime
> coupling; all `RENDER_*` reads degrade gracefully; a neutral `GIT_SHA`
> release identity covers every platform — completed to all admin surfaces
> in r108). R108 closed the final gaps: `SINGLE_INSTANCE_MODE` (zero
> periodic Neon coordination queries — idle autosuspend preserved), the
> V1-M20 idempotency FK fix, no-Redis migration mutual exclusion, a
> 37-rule pre-deploy env validator, compose secret isolation + log
> rotation, and the CI cost/trap fixes. Artifacts: `docker-compose.yml`
> (full stack), `deploy/env.compose.example`,
> `scripts/docker-verify.sh`, multi-arch image workflows, and
> `docs/deployment/{COOLIFY_ORACLE_MIGRATION,MIGRATION_RUNBOOK,
> ENVIRONMENT_MATRIX,FINAL_MIGRATION_READINESS}.md` +
> `docs/architecture/PRODUCTION_ARCHITECTURE.md`. The DNS cutover happened
> (2026-10): production is LIVE on Coolify at a self-hosted VM (observed
> host R117: Contabo) + Neon; Render/Vercel are retired legacy, NOT a
> rollback path.
>
> **Status banner (2026-09-20):** this file is a snapshot dated 2026-09-02 and
> its "all working / LIVE" claims predate the free-infrastructure round. For
> current state see **`docs/README.md` (docs index)** and
> `OPERATIONS_RUNBOOK.md` (on-call); `docs/free-tier-optimization-2026-09-20.md` /
> `docs/final-audit-2026-09-20.md` are dated records.
> Deploy IDs and commit refs below are historical records, kept as-is.

## Production URLs — **HISTORICAL SNAPSHOT (2026-09-20), ALL RETIRED/SUSPENDED**

> **r113 label: LEGACY / ROLLBACK ONLY — NOT CURRENT PRODUCTION.** Every
> Render/Vercel-era URL below is DOWN (Render billing-suspended
> since ~2026-09-11; the Vercel mirror drifted and its integration fails on
> every push — removal is an operator action,
> `docs/deployment/FINAL_OPERATOR_INPUTS.md` §account-level cleanup).
> Exception: `subnation.ly` itself is the LIVE canonical production identity,
> serving from Coolify on the self-hosted VM (observed host R117: Contabo) +
> Neon since the 2026-10 cutover —
> `docs/architecture/FINAL_PRODUCTION_TOPOLOGY.md`. Values kept verbatim as
> the historical reference they document.

- Frontend (Vercel): https://subnation-seven.vercel.app — **LEGACY MIRROR,
  STALE** (was "live" in the 2026-09-20 snapshot; the split stack is retired)
- Frontend (custom domain): https://subnation.ly and https://www.subnation.ly —
  LIVE on Coolify since the 2026-10 cutover (was 503 while Render was
  suspended, pre-2026-10-01); the domain is the CANONICAL production
  identity (`docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md`)
- Backend (Render): https://subnation2.onrender.com — LEGACY, billing-suspended
- OpenWA Gateway: https://openwa-gateway-7aaa.onrender.com — LEGACY,
  billing-suspended (the gateway now ships as
  `ghcr.io/ahmadmedo1012/openwa:sha-<short>` on the same VM)
- Neon Database: ep-spring-term-avwgxrte-pooler.c-11.us-east-1.aws.neon.tech
  (project `calm-art-99771185`) — live (external, unchanged by the migration)

## Deployment — LEGACY (the 2026-09-20 stack; current stack: self-hosted VM + Coolify)

- Frontend: Vercel (auto-deploy on push to main) — **retired split-stack
  mirror**; the SPA now ships from the same origin as the API
- Backend: Render (`srv-d7vv91tckfvc73evnccg`, region oregon, plan free) —
  **billing-suspended (dead — not a rollback path)**
  (`docs/deployment/RENDER_LEGACY_FALLBACK.md`)
- Last successful deploy: `dep-dac6e3n10e5c73bei34g` (commit `8878fd3`)
  (historical record)
- Current deployment: `docs/deployment/COOLIFY_FINAL_SETUP.md`

## CORS Origins (allow-listed on backend)

- https://subnation.ly
- https://www.subnation.ly
- https://subnation-seven.vercel.app
- http://localhost:5173 (dev)
- http://localhost:3000 (dev)

## API Endpoints (verified against routes)

Public:

- `GET /api/healthz` — liveness
- `GET /api/healthz/live` — public liveness (no auth)
- `GET /api/healthz/summary` — public status summary
- `GET /api/products` — product catalog
- `GET /api/flash-sale` — active flash sale
- `GET /api/catalog/stats` — catalog statistics

Auth-gated (returns 401 without session):

- `GET /api/cart` — user's cart
- `POST /api/cart/items` — add to cart
- `PATCH /api/cart/items/:id` — update quantity
- `DELETE /api/cart/items/:id` — remove item
- `DELETE /api/cart` — clear cart
- `GET /api/orders` — user's orders
- `GET /api/orders/:orderCode` — order tracking (requireUser-gated, `orders.ts:319`)
- `POST /api/orders` — create order (there is no `/api/orders/checkout` route)
- `GET /api/wallet` — wallet balance
- `GET /api/loyalty` — loyalty points

Admin-gated (returns 401 without admin):

- `GET /api/healthz/ready` — detailed readiness
- `GET /api/healthz/firebase` — Firebase config
- `GET /api/admin/diagnostics/whatsapp/*` — WhatsApp session management
- `GET /api/admin/*` — admin panel
- `GET /api/coupons/admin` — coupon management

## Frontend Pages

Public:

- `/` — home
- `/products` — product catalog
- `/flash-sales` — flash sale page
- `/product/:slug` — product detail
- `/login` — login (3 OAuth: Telegram, Google, WhatsApp)
- `/register` — registration
- `/terms` — terms of service
- `/category/:slug` — category browse
- `/loyalty` — loyalty program info

Auth-gated (SPA route, redirects to /login if not authed):

- `/cart` — shopping cart
- `/checkout` — checkout flow
- `/orders` — order history
- `/order-detail/:orderCode` — order detail
- `/wallet` — wallet top-up
- `/profile` — user profile
- `/support` — support tickets
- `/referrals` — referral program
- `/onboarding` — new user onboarding

Admin (requires admin role):

- `/admin` — dashboard
- `/admin/whatsapp` — WhatsApp OTP session management
- `/admin/orders` — order management
- `/admin/products` — product management
- `/admin/pricing` — pricing calculator
- `/admin/users` — user management
- `/admin/coupons` — coupon management
- `/admin/promotions` — promotions/flash sales
- `/admin/system` — system health
- `/admin/risk` — risk dashboard
- `/admin/settings` — auth provider settings
- `/admin/alerts` — alerting
- `/admin/admins` — admin user management
- `/admin/security` — security settings
- `/admin/referrals` — referral management
- `/admin/tickets` — support ticket management
- `/admin/topups` — wallet top-up requests

## Render Services Inventory

| Service        | ID                       | Status                                                 | Purpose                        |
| -------------- | ------------------------ | ------------------------------------------------------ | ------------------------------ |
| SubNation2     | srv-d7vv91tckfvc73evnccg | free tier — sleeps when idle (by design; R104 posture) | Main API + Socket.IO           |
| openwa-gateway | srv-da6piju7bikc739anbtg | free tier — sleeps when idle (by design)               | WhatsApp OTP gateway (Baileys) |
| SmartBot       | srv-d94hn57aqgkc73ds0vhg | LIVE                                                   | Unrelated (Python)             |
| POS            | srv-d8sps3cmmk8c739eo6lg | SUSPENDED                                              | Unrelated                      |
| Smart-Menu     | srv-d8q9a768bjmc738hhh90 | SUSPENDED                                              | Unrelated                      |
| zu-connect     | srv-d8ne9tcm0tmc73e2c4b0 | SUSPENDED                                              | Unrelated                      |
| lyosint        | srv-d8ir0se47okc739lh3d0 | LIVE                                                   | Unrelated                      |

## Critical Env Vars (all set on Render)

- `DATABASE_URL` — Neon Postgres connection (regenerated 2026-09-02)
- `SESSION_SECRET` — JWT session signing
- `ADMIN_JWT_SECRET` — admin JWT signing
- `ENCRYPTION_KEY` — data-at-rest encryption (32-byte hex)
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — admin login
- `APP_ORIGINS` — CORS allowlist (sync:true in render.yaml)
- `VERCEL_FRONTEND_ORIGIN` — Vercel origin (sync:true, persisted)
- `FRONTEND_ORIGINS` — secondary origin list

## Custom Domain Status (as of 2026-09-20: 503 while Render was suspended — live on Coolify since 2026-10)

- `subnation.ly` — verified, HTTPS — was 503 (Cloudflare → suspended Render)
  pre-2026-10-01; now LIVE via DNS-only Cloudflare → VM (Traefik/LE) → Coolify
- `www.subnation.ly` — verified, HTTPS — same history; both apex and www serve 200 today
- DNS resolved via Cloudflare to Render (direct, not Vercel) in that era; the
  zone is DNS-only (grey) today — `docs/deployment/CLOUDFLARE_FINAL_CUTOVER.md` §8

## WhatsApp OTP

> **LEGACY (Render/Vercel era) entry points below.** Current: the gateway
> is internal at `http://openwa:2785` (Coolify compose network — never
> exposed), the key lives in the Coolify env / compose `.env`
> (`WHATSAPP_OTP_API_KEY`), and the admin UI is
> `https://subnation.ly/admin/whatsapp`.

- Session name: subnation-otp
- Gateway base URL: https://openwa-gateway-7aaa.onrender.com
- API key: stored in Render env `WHATSAPP_OTP_API_KEY` (server-side only)
- Admin UI: https://subnation-seven.vercel.app/admin/whatsapp

## Last Updated

2026-09-20 — suspended-state pass (98-F8); original snapshot 2026-09-02 ("full
platform operational"). 2026-10-06 — R118 truth pass: cutover recorded;
`subnation.ly` LIVE on Coolify (self-hosted Contabo VM) + Neon. Current state:
`docs/README.md` (docs index).
