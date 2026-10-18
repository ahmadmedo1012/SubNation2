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
     &fields=list — light grid projection (R124): omits the variant tree
     (62.6% of catalog wire bytes, measured) + usage_terms; grid cards
     read `price` + `variant_count` instead. Absent = full Product shape.
GET  /api/products/:id | /by-slug/:slug
GET  /api/products/stats | /flash-sale  canonical public mounts (R166-B12):
     the SPA consumes the ALIAS forms GET /api/catalog/stats +
     GET /api/flash-sale — both forms are first-class public mounts on the
     same handlers + edge-cache windows (stats 60s / flash-sale 30s CDN).
POST  /api/orders                     atomic purchase (wallet; Idempotency-Key header, 409 IDEMPOTENCY_*)
GET   /api/orders                     latest 200 for user
GET   /api/wallet                     balance + ledger summary
GET   /api/wallet/topups              latest 200
POST  /api/wallet/topups              request topup (429 TOPUP_LIMIT_EXCEEDED at 3 pending)
GET   /api/loyalty                    points/tier/referrals
POST  /api/loyalty/convert-points     {points} → wallet (transactional; Idempotency-Key honored — durable DB-backed claim (V1-M19): same-key retry → 409 already-converted; 409 on race)
GET   /api/loyalty/referrals          masked referee list
GET   /api/support/tickets            latest 200 (+/:id, POST /, POST /:id/reply; 5 tickets/h)
POST  /api/coupons/validate           {code, order_amount} → discount preview
GET/POST/PATCH/DELETE /api/coupons/admin(/:id)  coupon management (finance scope)
GET/DELETE /api/cart; POST/PATCH/DELETE /api/cart/items(/:id)  server cart (snake_case product_id)
GET/POST /api/notifications; POST /api/notifications/:id/read, /read-all

Admin: /api/admin/* — requireAdmin + RBAC scopes
(orders|finance|inventory|support|users|admins|settings), audited.
Money-critical admin routes: PATCH /api/admin/orders/bulk-status (refunds via
RefundService; 207 multi-status on partial failure),
GET/POST/PATCH/DELETE /api/admin/flash-sales(/:id) (discount 0–95%),
POST /api/admin/referrals/:id/credit (+50 points, idempotent),
PATCH /api/admin/users/:id (wallet adjust/set via ledger-backed
AdjustmentService, idempotent; 400/401/403/404/409),
POST /api/admin/topups/:id/approve|reject (finance scope, idempotent).
GET/POST/PATCH/DELETE /api/admin/products/:id/variants(/:variantId)  catalog
     variant CRUD (inventory scope). R167-D: POST/PATCH SUCCESS bodies carry an
     ADDITIVE `warnings` array — items `{kind: "equalized"|"inverted",
     message: "تحذير: …" (Arabic operator copy)}` — IFF the write left the
     product's ACTIVE variant matrix with a cross-duration tier-price
     inconsistency (the R162 rule: two plan labels ordered at one shared
     duration must stay ordered at every other shared duration). Absent when
     clean; NEVER blocks the write (warn-first product decision — operators
     must be able to fix existing bad rows); deactivating the offending
     variant is the documented silencer; exactly one warn-level log line per
     offending write. Response payload only — no error code involved.
POST /api/webhook/telegram — Telegram topup approve/reject callbacks
(secret-token header + TELEGRAM_ADMIN_IDS allowlist; 200/403/503).
Observability: /api/metrics (token-gated), /api/healthz/{ready,redis,neon,worker,socket,firebase} (admin).

Admin operator/curl surface — mounted, authenticated, NO SPA consumer
(R166-B13..B15; reachable via curl with an admin session or the copilot
admin-request tool):
  GET/PUT /api/admin/risk/config        singleton thresholds/allowlist/auto-block (users scope)
  GET    /api/admin/risk/rules          full rule catalog (users scope)
  PUT    /api/admin/risk/rules/:id      toggle enabled / replace expression (users scope)
  POST   /api/admin/risk/synth          TEST-DATA INJECTION (users scope): inserts a synthetic
                                       risk_events row ({level?, event_type?, user_id?}; level
                                       defaults critical, event_type topup_attempt) to verify the
                                       alerting/label flow — hard-403 when NODE_ENV=production.
  GET /api/admin/observability/deploys/recent  retired Render placeholder: stable pending state
                                              by design (deploy history lives in Coolify)
  GET /api/admin/observability/sentry/summary  pending until SENTRY_AUTH_TOKEN is provisioned
  GET /api/admin/diagnostics/sentry-debug?mode=snapshot|message|subsystem|throw
                                              Sentry pipeline verification (settings scope;
                                              mode=throw → captured 500 response)
  POST /api/admin/alerts/test           dispatchTestAlert {rule?} (support scope): fires a synthetic
                                       alert and returns the REAL per-channel delivery outcomes
                                       (telegram/discord/webhook), not hardcoded ok flags.
```

## Operator curl examples (no-SPA-consumer routes)

```bash
# Risk config + rules (users scope) — R166-B13
curl -H "Authorization: Bearer $ADMIN_JWT" https://subnation.ly/api/admin/risk/config
curl -X PUT -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"auto_block":{"hard_block":true}}' https://subnation.ly/api/admin/risk/config
curl -H "Authorization: Bearer $ADMIN_JWT" https://subnation.ly/api/admin/risk/rules
curl -X PUT -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' https://subnation.ly/api/admin/risk/rules/3
# Synthetic event — dev/staging ONLY (403 in production):
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"event_type":"topup_attempt","level":"critical"}' https://subnation.ly/api/admin/risk/synth

# Observability + diagnostics probes (settings scope) — R166-B14
curl -H "Authorization: Bearer $ADMIN_JWT" https://subnation.ly/api/admin/observability/deploys/recent
curl -H "Authorization: Bearer $ADMIN_JWT" https://subnation.ly/api/admin/observability/sentry/summary
curl -H "Authorization: Bearer $ADMIN_JWT" \
  "https://subnation.ly/api/admin/diagnostics/sentry-debug?mode=message"

# Test-alert dispatch (support scope) — R166-B15
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' \
  -d '{"rule":"api_5xx_rate_high"}' https://subnation.ly/api/admin/alerts/test
```
