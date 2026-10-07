> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/round-98-repair-plan.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# Round 98 — Repair Plan (الفائق الشمول)

**Input:** 8 audit reports under `docs/inspection-r98/` — **101 findings: 0 P0 · 4 P1 · 17 P2 · ~80 P3**.
**Principles:** free-tier inviolable (no services/workers/Redis/keep-alive) · no broken behavior · exclusive file ownership per wave · every fix verified by targeted tests · audit code not docs.

## Live-data gates verified before planning (main agent, 2026-09-20)

| Check | Result | Decision unlocked |
|---|---|---|
| `admin_users.password_hash` prefixes | **all `$argon2i`** (3 rows) | Remove legacy SHA-256 fallback safely (zero live consumers) |
| `product_variants` exact dupes (NULL-equal) | **ZERO** | `NULLS NOT DISTINCT` on the unique index is data-safe |
| Live unique index def | `(product_id, plan_label, duration_label)` | Schema TS must mirror THESE columns |
| Express / express-rate-limit | 5.2.1 / 8.4.1 | Double-mount = confirmed ERR_ERL_DOUBLE_COUNT → 500 (P1) |
| Frontend cart | localStorage-only (server cart CRUD unconsumed except DELETE) | Re-quote via `GET /api/products/:id` per line |

## Wave A — parallel fix agents (exclusive files)

| Agent | Scope | Key fixes |
|---|---|---|
| **98-F1** backend money | admin/orders.ts, refund.service.ts, pricing.ts | bulk-status source-state guard (P2) · refund coupon used_count restore (P2) · legacy ≥100% coupon clean 400 (P3) |
| **98-F2** frontend money | checkout.tsx, product.tsx, wallet.tsx, cart.tsx | per-unit coupon pre-flight + label math (P1) · variant-switch coupon reset (P1) · price re-quote on mount (P2) · checkout key TTL + abandoned flag (r97 F-07/F-17) · topup key sessionStorage · cart: legacy-v1 removal, storage listener, context memo |
| **98-F3** routes/security | app.ts, metrics.ts, auth.ts, auth-whatsapp.ts, auth-settings.ts, admin/{risk,auth,admins,users,topups,tickets,referrals,alerts,pricing-config}.ts, loyalty.ts, support.ts, products.ts, coupons.ts, lib/crypto.ts, middlewares/requireAdmin.ts | double authLimiter mounts + composition test (P1) · metrics sid revocation (P2) · login-CSRF skip removal (P2) · unlink count/types/404 (P2) · risk-config zod (P2) · no-store family (P3) · dummy-argon2 (P3) · SHA-256 removal · user-JWT body removal (mirror R97-02) · CORS maxAge · role enum + requireRole deletion · P3 hygiene set |
| **98-F4** DB parity | shared/db/src/schema/*, migrate.ts, shared/db/src/index.ts | mirror idx_orders_variant + idx_inventory_variant (P2) · idx_forecasts_at_risk_runout + fk_cart_items_user (P2) · 6 CHECK constraints in TS (P2) · auth_activity tz (P3) · NULLS NOT DISTINCT unique (boot V1-M17 + 0011) · pool.on pino+metric |
| **98-F5** reliability | alerting.service.ts, telegram-webhook.ts, encryption.ts, server.ts, llm-client.ts, openwa.service.ts, risk-config-cache.service.ts, telegram-replay.ts | evalInFlight + in-memory dedup (P2) · webhook /start timeout (P2) · ENCRYPTION_KEY boot assert (P3) · keepAliveTimeout 61s · 5 raw redis wraps · body.ok parse · chatId masking · copilot 90s deadline |
| **98-F6** openwa repo | openwa/src/*, package.json, README | asyncHandler + error middleware (P2) · startSession in-flight guard (P2) · /api no-store · actionable decrypt log · PII masking · contacts bounds · dash pair-code limit · hygiene + dist + 70 tests |
| **98-F7** frontend non-money | referrals.tsx, admin/layout.tsx, admin forms, NotificationBell, App.tsx, ErrorBoundary, home.tsx, vite.config.ts, index.html, main.tsx, auth.tsx, AuthProviders.tsx | referrals abort/seq · alert cursor + r.ok · dirty-state guards · bell try/catch+rollback+seq · retry 4xx filter · boundary reset key · placeholderData · URL filter sync · PWA /assets CacheFirst + offline fallback · raw-fetch hardening (AuthProviders, bell, layout) |
| **98-F8** docs & env docs | README, PLATFORM.md, DISASTER_RECOVERY.md, PROJECT_OVERVIEW.md, OPERATIONS_RUNBOOK.md, env.example, render.yaml, specs/003, post-merge.sh, WHATSAPP_OPERATIONS.md | README keep-alive (P1) + infra rows (P2) · PLATFORM endpoints/status (P2) · DR Redis (P2) · overview banner (P2) · env.example Redis-optional + WHATSAPP_OTP_SETTLE_MS + observability URLs + knobs pass · render.yaml dead-env removal |

## Wave B — sequential (after A, no file conflicts)

**98-F9** — spec/types/dead-code: openapi.yaml (idempotency header, Product.features, User 9 fields, Order cleanup, auth-family paths) + `pnpm codegen` + frontend local-interface removal (product.tsx cast / profile.tsx / checkout.tsx) · 63 dead exports removal · 5 unused deps `pnpm remove` · stale `it.todo` → pointers · `.prettierignore` path · risk-hard-block mount (flag-gated default-off) + spec honest status + test.

## Wave C — full verification (main agent)

typecheck ×3 · lint · backend 1012 tests · frontend 448 tests · openwa 70 tests · 3 builds · drift check.

## Wave D — fallout fixes + re-audit + final report + central commit/push.

## Consciously deferred (documented in final report)

- raw-fetch full migration (99 sites — 5 riskiest hardened in F2/F7, rest queued)
- per-user coupon redemption limit (schema + business decision — spec backlog)
- integer-cents money refactor (bounded-error verified; dedicated pass)
- frontend tests in typecheck + `strictFunctionTypes` enablement (dedicated pass)
- PWA Push registration (product decision) · openwa dash revocation epoch · QR 404/200 contract (documented, consumer-aligned)
- restock path (runbook policy: manual reconciliation, never-restock codified)
