# SubNation2 Platform

> **Status banner (2026-09-20):** this file is a snapshot dated 2026-09-02 and
> its "all working / LIVE" claims predate the free-infrastructure round. For
> current state see **OPERATIONS_RUNBOOK §5 (free-tier posture)** and
> `docs/free-tier-optimization-2026-09-20.md` / `docs/final-audit-2026-09-20.md`.
> Deploy IDs and commit refs below are historical records, kept as-is.

## Production URLs (as of 2026-09-20)

- Frontend (Vercel): https://subnation-seven.vercel.app — **LIVE**
- Frontend (custom domain): https://subnation.ly and https://www.subnation.ly —
  currently 503 while Render is suspended (Cloudflare → Render direct; see runbook)
- Backend (Render): https://subnation2.onrender.com — **SUSPENDED** (operator
  billing gate)
- OpenWA Gateway: https://openwa-gateway-7aaa.onrender.com — **SUSPENDED**
  (same billing gate)
- Neon Database: ep-spring-term-avwgxrte-pooler.c-11.us-east-1.aws.neon.tech
  (project `calm-art-99771185`) — live

## Deployment

- Frontend: Vercel (auto-deploy on push to main)
- Backend: Render (`srv-d7vv91tckfvc73evnccg`, region oregon, plan free)
- Last successful deploy: `dep-dac6e3n10e5c73bei34g` (commit `8878fd3`)

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
- `GET /api/orders/:orderCode` — order tracking (requireUser-gated, `orders.ts:305`)
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

| Service        | ID                       | Status                                                     | Purpose                        |
| -------------- | ------------------------ | ---------------------------------------------------------- | ------------------------------ |
| SubNation2     | srv-d7vv91tckfvc73evnccg | SUSPENDED (operator billing gate — see OPERATIONS_RUNBOOK) | Main API + Socket.IO           |
| openwa-gateway | srv-da6piju7bikc739anbtg | SUSPENDED (same billing gate)                              | WhatsApp OTP gateway (Baileys) |
| SmartBot       | srv-d94hn57aqgkc73ds0vhg | LIVE                                                       | Unrelated (Python)             |
| POS            | srv-d8sps3cmmk8c739eo6lg | SUSPENDED                                                  | Unrelated                      |
| Smart-Menu     | srv-d8q9a768bjmc738hhh90 | SUSPENDED                                                  | Unrelated                      |
| zu-connect     | srv-d8ne9tcm0tmc73e2c4b0 | SUSPENDED                                                  | Unrelated                      |
| lyosint        | srv-d8ir0se47okc739lh3d0 | LIVE                                                       | Unrelated                      |

## Critical Env Vars (all set on Render)

- `DATABASE_URL` — Neon Postgres connection (regenerated 2026-09-02)
- `SESSION_SECRET` — JWT session signing
- `ADMIN_JWT_SECRET` — admin JWT signing
- `ENCRYPTION_KEY` — data-at-rest encryption (32-byte hex)
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — admin login
- `APP_ORIGINS` — CORS allowlist (sync:true in render.yaml)
- `VERCEL_FRONTEND_ORIGIN` — Vercel origin (sync:true, persisted)
- `FRONTEND_ORIGINS` — secondary origin list

## Custom Domain Status (as of 2026-09-20: 503 while Render is suspended)

- `subnation.ly` — verified, HTTPS — currently 503 (Cloudflare → suspended Render)
- `www.subnation.ly` — verified, HTTPS — currently 503 (same)
- DNS resolved via Cloudflare to Render (direct, not Vercel); an operator
  option in the free-tier doc is repointing DNS to Vercel

## WhatsApp OTP

- Session name: subnation-otp
- Gateway base URL: https://openwa-gateway-7aaa.onrender.com
- API key: stored in Render env `WHATSAPP_OTP_API_KEY` (server-side only)
- Admin UI: https://subnation-seven.vercel.app/admin/whatsapp

## Last Updated

2026-09-20 — suspended-state pass (98-F8); original snapshot 2026-09-02 ("full
platform operational"). Runbook §free-tier is the current-state source.
