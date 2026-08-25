<!-- ⚠️ Rewritten 2026-08-25: the previous version documented the retired
password register/login/forgot-password flows and outdated rate limits.
This file now reflects the passwordless auth surface. For exhaustive,
generated contracts see shared/api-spec + shared/api-zod. -->

# SubNation API (operator reference)

Base URL: `https://subnation.ly/api` — all responses JSON. Errors:
`{ "error": string, "code": string }`.

**Auth is passwordless**: Google (Firebase), Telegram widget/MiniApp,
WhatsApp OTP. Sessions are httpOnly cookie `auth_token` (JWT, 30d).
Admin surface: separate JWT (8h) + TOTP.

## Rate limits (per IP)
- General: 600/min (1200/min for authenticated users)
- Auth endpoints: 10 per 15 min (successes count)
- WhatsApp OTP: additional per-phone cooldown + hourly caps

## Core endpoints

```
GET  /api/healthz                     liveness (public)
POST /api/auth/firebase/session       Google ID token → session cookie
POST /api/auth/telegram               Telegram widget payload → session
GET  /api/auth/telegram/callback      redirect-mode variant
POST /api/auth/whatsapp/start         {phone} → sends OTP
POST /api/auth/whatsapp/verify        {phone, code} → session
GET  /api/auth/providers              enabled providers + whatsapp flag
GET  /api/auth/me                     current user
POST /api/auth/logout                 clears session cookie

GET  /api/products?category=&search=&sort=&available_only=
GET  /api/products/:id | /by-slug/:slug
GET  /api/products/stats | /flash-sale
POST  /api/orders                     atomic purchase (wallet)
GET   /api/orders                     latest 200 for user
GET   /api/wallet                     balance + ledger summary
GET   /api/wallet/topups              latest 200
POST  /api/wallet/topups              request topup
GET   /api/loyalty                    points/tier/referrals
POST  /api/loyalty/convert-points     {points} → wallet (transactional)
GET   /api/support/tickets            latest 200
GET   /api/coupons/validate?code=

Admin: /api/admin/* — requireAdmin + RBAC scopes
(orders|finance|inventory|support|users|admins|settings), audited.
Observability: /api/metrics (token-gated), /api/healthz/{ready,redis,neon,worker,socket,firebase} (admin).
```
