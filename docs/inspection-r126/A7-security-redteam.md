# R126-A7 — Adversarial Security Red-Team Audit

- **Agent:** R126-A7 (security red-team, parallel fleet round 126)
- **Repo:** `SubNation2` @ HEAD `186b131` (read-only audit; no source changes)
- **Scope:** admin-family RBAC matrix (~116 endpoints), IDOR, rate limits, secrets/crypto, input validity, guest-level live probing of https://subnation.ly, supply-chain pass, R122-residual re-verification.
- **Method:** every claim below is verified at HEAD with file:line, or marked **UNVERIFIED**. Live probes: guest-level GET/HEAD/OPTIONS only, ≤3 requests per endpoint, nothing mutating, no auth attempts.
- **Verdict:** **SHIP-WORTHY** — 0 P0, 0 P1, 4 P2/P3 hardening findings, 5 P4 notes. All previous-round security fixes re-verified intact.

---

## 1. Findings summary

| ID | Sev | Title | Evidence |
|----|-----|-------|----------|
| A7-F1 | **P2** | Dashboard stats routes carry **no permission scope** — any scoped admin (e.g. `support`-only) reads revenue + wallet aggregates | stats.ts:60, stats.ts:142 (mount at admin/index.ts:35, before the scope-gated `protectedRouter`) |
| A7-F2 | **P3** | `script-src-attr 'unsafe-inline'` in live CSP — attribute-injection XSS is un-neutralized by CSP (first-party code has zero inline handlers; risk contingent on a future injection sink) | app.ts:195 (policy), live header (§6); frontend grep: 0 `onclick=`/`dangerouslySetInnerHTML` |
| A7-F3 | **P3** | Admin auth router's 401/rejection paths lack `Cache-Control: no-store` (parity gap vs the R123-E5 no-store hardening; live-verified) | auth.ts (no router-level no-store middleware; `/session` sets it inside the handler at :500 only), live probe §6 |
| A7-F4 | **P3** | Support-ticket admin writes are **un-audited** (reply + status flip — customer-messaging mutations with no audit row) | tickets.ts:208-302 (zero `writeAuditLog` in file) |
| A7-F5 | P4 | `GET /api/metrics` accepts **any-scope admin** (no `settings` scope) — operational telemetry to scoped admins | metrics.ts:33-112 |
| A7-F6 | P4 | `admins.ts` leaf routes rely **solely on the parent mount** for `requireAdmin` (only admin-family router without its own auth) — one remount mistake away from exposure | admins.ts:71,107,221,348,395,446 (no requireAdmin) vs index.ts:39+115 (mount) |
| A7-F7 | P4 | Copilot rate-limit **fails open** on Redis error (documented; userLimiter still in front) | lib/copilot/rate-limit.ts:110 |
| A7-F8 | P4 | Cloudflare edge rate-limit headers disclose a per-IP hashed partition key (`pk=:...:`) to guests | live header §6 (`ratelimit-policy ... pk=:N2Nk...:`) |
| A7-F9 | P4 | `/.well-known/security.txt` + `/security.txt` return **200 SPA HTML** (no real security.txt); unrelated: the deployed `index.html` contains an inline `<script>` that the production CSP itself blocks (dead optimization, not a hole) | live probe §6 |

No P0/P1: no unauthenticated privileged route, no missing-authz route, no cross-tenant IDOR, no secret in code, no brute-force path without a DB-backed ceiling.

---

## 2. RBAC matrix — all admin-family routes (116)

Legend — **Auth**: `RA` = requireAdmin (JWT+sid+is_active, requireAdmin.ts:34-128), `RA+<scope>` = RA + requirePermission(scope) (lib/permissions.ts:69), `pub` = public by design. **RL** = rate-limit class (see §4). **Audit** = writeAuditLog / audit_logs row. Path prefix `/api/admin` unless stated.

### 2.1 admin/auth.ts (mounted at admin root, admin/index.ts:34 — public contract)

| # | Method+Path | Auth | Scope | RL | Audit |
|---|---|---|---|---|---|
| 1 | POST /login (auth.ts:91) | pub | — | authLimiter 10/15m/IP + lockout ×2 | login_attempts rows (lockout) |
| 2 | POST /login/verify-2fa (auth.ts:293) | pub (temp JWT, isTemp enforced :304) | — | authLimiter + `admin-2fa:{id}` 5→15m exp | lockout rows |
| 3 | GET /probe (auth.ts:419) | pub 200-always | — | apiLimiter | — (no-store :420) |
| 4 | GET /session (auth.ts:495) | RA | self | apiLimiter/IP | — (no-store on 200 only — A7-F3) |
| 5 | POST /logout (auth.ts:542) | RA | self | — | ✓ admin.logout |
| 6 | POST /change-password (auth.ts:569) | RA | self | `admin-pwchange:{user}` 5→15m | ✓ fail+success |
| 7 | PATCH /profile (auth.ts:661) | RA + password re-auth | self | — | ✓ fail+success |
| 8 | POST /2fa/setup (auth.ts:809) | RA (+password re-auth when enabled :830) | self | `admin-2fasetup:{user}` :841 | ✓ totp_disabled |
| 9 | POST /2fa/verify-setup (auth.ts:907) | RA | self | `admin-2fa:{id}` :934 (**R122 fix intact**) | ✓ totp_enabled |

### 2.2 admin/stats.ts (mounted at admin root, admin/index.ts:35 — **A7-F1**)

| # | Method+Path | Auth | Scope | RL | Audit |
|---|---|---|---|---|---|
| 10 | GET /stats (stats.ts:60) | RA | **none** ⚠ | apiLimiter/IP | — (no-store ✓) |
| 11 | GET /chart-data (stats.ts:142) | RA | **none** ⚠ | apiLimiter/IP | — (no-store ✓) |

### 2.3 Products & catalog (mount: RA + inventory, admin/index.ts:67-83)

| # | Method+Path | Auth | RL | Audit |
|---|---|---|---|---|
| 12 | GET /products (products.ts:77) | RA+inv | apiLimiter/IP | — (no-store ✓) |
| 13 | POST /products (products.ts:210) | RA+inv | — | ✓ product.create |
| 14 | PATCH /products/:id (products.ts:306) | RA+inv | — | ✓ product.update |
| 15 | DELETE /products/:id (products.ts:394) | RA+inv | — | ✓ product.archive |
| 16 | GET /products/:id/inventory (products.ts:430) | RA+inv | — | — (200-row preview cap :428) |
| 17 | POST /products/:id/inventory/set-count (products.ts:517) | RA+inv | — | ✓ (0..100k bound :523) |
| 18 | POST /products/:id/inventory (products.ts:591) | RA+inv | — | ✓ (500-entry cap :734, GCM at insert, advisory-lock dedup :747-749) |
| 19 | GET /products/:id/variants (product-variants.ts:103) | RA+inv (own router.use(requireAdmin) :36) | — | — |
| 20 | POST /products/:id/variants (product-variants.ts:126) | RA+inv | — | ✓ variant.create |
| 21 | PATCH /products/:id/variants/:variantId (product-variants.ts:219) | RA+inv | — | ✓ variant.update |
| 22 | DELETE /products/:id/variants/:variantId (product-variants.ts:327) | RA+inv | — | ✓ variant.delete |
| 23 | POST /pricing/calculate (pricing-calculator.ts:81) | RA+inv | — | — (pure computation) |
| 24 | GET /pricing/config (pricing-config.ts:42) | RA+inv (own requireAdmin :31) | — | — |
| 25 | PUT /pricing/config (pricing-config.ts:52) | RA+inv | — | ✓ pricing.config.update |
| 26 | POST /pricing/recompute (pricing-config.ts:100) | RA+inv | — | ✓ pricing.recompute |
| 27 | GET /flash-sales (flash-sales.ts:171) | RA+inv | — | — (no-store ✓) |
| 28 | POST /flash-sales (flash-sales.ts:190) | RA+inv | — | ✓ (0-95%, ≤30d, ≤255 title :62-127) |
| 29 | PATCH /flash-sales/:id (flash-sales.ts:243) | RA+inv | — | ✓ |
| 30 | DELETE /flash-sales/:id (flash-sales.ts:370) | RA+inv | — | ✓ flash_sale.deactivate |

### 2.4 Users & referrals (mount: RA + users, admin/index.ts:90-99)

| # | Method+Path | Auth | RL | Audit |
|---|---|---|---|---|
| 31 | GET /users (users.ts:25) | RA+users | apiLimiter/IP | — (PII; no-store ✓; LIKE-escaped :50) |
| 32 | PATCH /users/:id (users.ts:136) | RA+users **+ finance for wallet AND loyalty** (users.ts:213, :310 — B1-3 intact) | idempotency + durable pre-check :343 | ✓ with before/after values |
| 33 | GET /referrals (referrals.ts:25) | RA+users | — | — (no-store ✓) |
| 34 | POST /referrals/:id/credit (referrals.ts:120) | RA+users **+ finance** (referrals.ts:133 intact) | idempotency :138 | ✓ referral.credit + points_ledger |

### 2.5 Money queue (mount: RA + finance, admin/index.ts:61-65)

| # | Method+Path | Auth | RL | Audit |
|---|---|---|---|---|
| 35 | GET /topups (topups.ts:56) | RA+finance | — | — (no-store ✓; pageParam ceiling) |
| 36 | POST /topups/:id/approve (topups.ts:135) | RA+finance | idempotency :144 | ✓ topup.approve |
| 37 | POST /topups/:id/reject (topups.ts:175) | RA+finance | idempotency :183 | ✓ topup.reject |

### 2.6 Orders (mount: RA + orders, admin/index.ts:127-131)

| # | Method+Path | Auth | RL | Audit |
|---|---|---|---|---|
| 38 | GET /orders (orders.ts:189) | RA+orders | apiLimiter/IP | — (no-store ✓; list no longer decrypts credentials :283-295) |
| 39 | GET /orders/:id/credentials (orders.ts:328) | RA+orders | **per-admin volume gate 60/10min** (orders.ts:37-57, R117 intact) + dedup admin alert :339 | ✓ awaited before decrypt :375 |
| 40 | PATCH /orders/bulk-status (orders.ts:434) | RA+orders **+ finance for refunded** (orders.ts:499 — A6-01 intact) | idempotency :437; 200-id cap :444 | ✓ both branches (:577, :707) |

### 2.7 Support & alerts (mount: RA + support, admin/index.ts:101-107)

| # | Method+Path | Auth | RL | Audit |
|---|---|---|---|---|
| 41 | GET /tickets (tickets.ts:36) | RA+support | — | — (no-store ✓) |
| 42 | GET /tickets/:id (tickets.ts:155) | RA+support | — | — |
| 43 | POST /tickets/:id/reply (tickets.ts:208) | RA+support | — | **✗ none (A7-F4)** |
| 44 | PATCH /tickets/:id/status (tickets.ts:271) | RA+support | — | **✗ none (A7-F4)** |
| 45 | POST /alerts/test (alerts.ts:44) | RA+support | — | ✓ alert.test_dispatch |
| 46 | GET /alerts/new (alerts.ts:92) | RA+support | — | — |
| 47 | GET /alerts/unread-count (alerts.ts:122) | RA+support | — | — |
| 48 | GET /alerts (alerts.ts:136) | RA+support | — | — (capped pagination :33-42) |
| 49 | PATCH /alerts/read-all (alerts.ts:160) | RA+support | — | ✗ (own-feed mutation; P4-class) |
| 50 | PATCH /alerts/:id/read (alerts.ts:170) | RA+support | — | ✗ |
| 51 | DELETE /alerts/read (alerts.ts:183) | RA+support | — | ✗ |
| 52 | DELETE /alerts/:id (alerts.ts:193) | RA+support | — | ✗ |
| 53 | DELETE /alerts (alerts.ts:213) | RA+support | — | ✗ |

### 2.8 Admin management & security (mount: RA + admins, admin/index.ts:109-119)

| # | Method+Path | Auth | RL | Audit |
|---|---|---|---|---|
| 54 | GET /admins (admins.ts:71) | RA+admins (parent-mount only — A7-F6) | — | — (no-store ✓) |
| 55 | POST /admins (admins.ts:107) | RA+admins + **subset-bounded grants** :151 (R122 intact) | — | ✓ admin.created |
| 56 | PATCH /admins/:id (admins.ts:221) | RA+admins + subset bound :265 + last-admin guard :285 | — | ✓ admin.updated |
| 57 | POST /admins/:id/disable (admins.ts:348) | RA+admins + self-lock :354 + last-admin guard :361 | — | ✓ admin.disabled |
| 58 | POST /admins/:id/enable (admins.ts:395) | RA+admins + subset bound :416 (re-enable escalation guard) | — | ✓ admin.enabled |
| 59 | GET /admins/scopes (admins.ts:446) | RA+admins | — | — |
| 60 | GET /auth-activity (security.ts:17) | RA+admins | — | — (no-store ✓) |
| 61 | GET /auth-stats (security.ts:70) | RA+admins | — | — |
| 62 | GET /auth-stats/summary (security.ts:83) | RA+admins | — | — |

### 2.9 Settings / observability / diagnostics (mount: RA + settings, admin/index.ts:121-125)

| # | Method+Path | Audit |
|---|---|---|
| 63 | GET /settings (settings.ts:15) | — (no-store ✓) |
| 64 | GET /observability/summary (observability.ts:79) | — |
| 65 | GET /observability/alerts/recent (observability.ts:120) | — |
| 66 | GET /observability/deploys/recent (observability.ts:139) | — |
| 67 | GET /observability/sentry/summary (observability.ts:149) | — |
| 68 | GET /observability/metrics (observability.ts:171) | — |
| 69 | GET /observability/scheduler (observability.ts:194) | — |
| 70 | GET /diagnostics/inventory-health (diagnostics.ts:71) | — |
| 71 | GET /diagnostics (diagnostics.ts:156) | — |
| 72 | GET /diagnostics/sentry-debug (diagnostics.ts:231) | — |
| 73 | GET /diagnostics/whatsapp/sessions (diagnostics.ts:345) | — |
| 74 | POST /diagnostics/whatsapp/sessions (diagnostics.ts:353) | ✓ session_create |
| 75 | POST /diagnostics/whatsapp/sessions/:id/start (diagnostics.ts:368) | ✓ session_start |
| 76 | POST /diagnostics/whatsapp/sessions/:id/pair-code (diagnostics.ts:380) | ✓ session_pair_code |
| 77 | GET /diagnostics/whatsapp/sessions/:id/qr (diagnostics.ts:394) | — |
| 78 | DELETE /diagnostics/whatsapp/sessions/:id (diagnostics.ts:402) | ✓ session_delete |
| 79 | POST /diagnostics/telegram-test (diagnostics.ts:429) | ✗ (P4) |

### 2.10 Risk / forecast / enrichment (mounts: RA + users / inventory, admin/index.ts:48-59)

| # | Method+Path | Audit |
|---|---|---|
| 80 | GET /risk/events (risk.ts:117) | — |
| 81 | GET /risk/events/:id (risk.ts:222) | — |
| 82 | POST /risk/events/:id/label (risk.ts:298) | ✓ risk.label |
| 83 | POST /risk/events/bulk-label (risk.ts:367) | ✓ risk.bulk_label (100-id cap :383) |
| 84 | GET /risk/rules (risk.ts:452) | — |
| 85 | PUT /risk/rules/:id (risk.ts:473) | ✓ risk.rule_update |
| 86 | GET /risk/config (risk.ts:540) | — |
| 87 | PUT /risk/config (risk.ts:598) | ✓ risk.config_update (zod caps :565-596) |
| 88 | GET /risk/dashboard (risk.ts:733) | — |
| 89 | POST /risk/synth (risk.ts:809) | ✓ risk.synth (**403 in production** :810) |
| 90 | GET /forecast/at-risk (forecast.ts:53) | — |
| 91 | GET /forecast/products/:id (forecast.ts:96) | — |
| 92 | GET /enrichment/list (enrichment.ts:73) | — (≤50 limit) |
| 93 | POST /enrichment/:id/publish (enrichment.ts:99) | ✓ in service (publish.ts:104; final-text cap :115) |
| 94 | POST /enrichment/:id/reject (enrichment.ts:157) | ✓ in service (enrichment.service.ts:162) |

### 2.11 Copilot (mount: RA only at protectedRouter, admin/index.ts:43; leaf phase gates + tool-level scopes)

| # | Method+Path | Gate | Notes |
|---|---|---|---|
| 95 | POST /copilot/ask (ask.ts:389) | RA + phase1 :392 + copilotRateLimit :393 | tool catalog + executor both scope-filtered (ask.ts:160-166; read.ts:673-676 re-checks requiredScope at execution) |
| 96 | POST /copilot/draft (draft.ts:302) | RA + phase2 :305 | draft tools scope-filtered (tools/draft.ts:491) |
| 97 | GET /copilot/previews/:id (previews.ts:44) | RA | **owner-scoped** (getOwnedPreview, preview-store.ts:82-90); no-store ✓ |
| 98 | POST /copilot/previews/:id/cancel (previews.ts:90) | RA + rate limit | owner-scoped; audit row via recordNonExecute |
| 99 | POST /copilot/previews/:id/confirm (previews.ts:132) | RA + phase3 :135 | owner-scoped; no_execute tier hard-blocked :162; high-risk needs double-confirm :177-207 |
| 100 | POST /copilot/previews/:id/double-confirm (previews.ts:283) | RA + phase3 :286 | owner-scoped + 3s cooldown |
| 101 | GET /copilot/settings (copilot/settings.ts:35) | RA + hasScope(admins\|settings) :46 | — |
| 102 | PATCH /copilot/settings (copilot/settings.ts:113) | RA + hasScope(admins\|settings) :115 | ✓ audit_logs row :157 |
| 103 | GET /copilot/history (history.ts:40) | RA | owner-scoped (own rows only) |

### 2.12 Admin-family routes elsewhere

| # | Method+Path | Auth | Audit |
|---|---|---|---|
| 104 | GET /api/admin/settings/auth (auth-settings.ts:1154; mount routes/index.ts:59) | RA+settings | — (masked secrets) |
| 105 | PATCH /api/admin/settings/auth/:id (auth-settings.ts:1203) | RA+settings (double-gated) | ✓ settings.auth_provider.update :1262 (keys only) |
| 106 | GET /api/healthz/firebase (health.ts:522) | RA+settings (R122 parity intact) | — |
| 107 | GET /api/healthz/ready (health.ts:820) | RA+settings | — |
| 108-111 | GET /api/healthz/{redis,neon,worker,socket} (health.ts:849-918) | RA+settings | — |
| 112 | GET /api/metrics (metrics.ts:115) | RA (any scope) **or** METRICS_ADMIN_TOKEN constant-time (A7-F5) | — |
| 113 | GET /api/coupons/admin (coupons.ts:257) | RA+finance | — (no-store ✓, 200 cap) |
| 114 | POST /api/coupons/admin (coupons.ts:288) | RA+finance | ✓ |
| 115 | PATCH /api/coupons/admin/:id (coupons.ts:365) | RA+finance | ✓ |
| 116 | DELETE /api/coupons/admin/:id (coupons.ts:421) | RA+finance | ✓ |

**Matrix verdicts**
- Zero routes missing authz. The only "mount-only auth" family is admins.ts (A7-F6, currently safe, verified index.ts:39+115).
- No route performs data access before its authz gate (all handlers run after requireAdmin/requirePermission in the chain; money-mutation finance gates (users.ts:310, referrals.ts:133, orders.ts:499) precede every write).
- Weakest-vs-sensitivity: A7-F1 (stats without scope) — revenue/wallet totals to any-scope admin; everything else maps scope ≥ data sensitivity (money → finance everywhere, incl. loyalty points since points are LYD-convertible).

---

## 3. IDOR cross-tenant analysis (code-level)

Every customer-facing `:id`/`:orderCode` param funnels ownership into the SQL predicate (`and(eq(table.id, …), eq(table.userId, userId))`):

| Route | Evidence | Verdict |
|---|---|---|
| GET /api/orders/:orderCode | orders.ts:366 `and(eq(orderCode), eq(userId))` | GUARDED |
| GET/POST /api/wallet/topups, /ledger, / | wallet.ts:174, 212, 110, 483-492, 563 | GUARDED |
| POST /api/wallet/topups (create + idempotent replay) | wallet.ts:419, 468 — replay lookups also userId-scoped | GUARDED |
| GET /api/loyalty/ledger, /referrals | loyalty.ts:313, 331+ | GUARDED |
| POST /api/loyalty/convert-points | loyalty.ts:179, 199 (userId in tx) | GUARDED |
| PATCH/DELETE /api/cart/items/:id | cart.ts:281, 316 | GUARDED |
| GET/POST /api/support/tickets/:id(/reply) | support.ts:173, 226 | GUARDED |
| POST /api/notifications/:id/read | notifications.ts:59 | GUARDED |
| DELETE /api/auth/sessions/:id | auth.ts:865 | GUARDED |
| Admin copilot previews | getOwnedPreview `and(eq(id), eq(adminId))` preview-store.ts:82-90 | GUARDED (owner-scoped) |
| Admin :id routes (orders/tickets/referrals/topups/users/admins/risk/flash-sales/products/variants/enrichment) | cross-tenant by design (operator surface), all scope-gated + audited; credentials reveal additionally volume-gated + audited (orders.ts:338-378) | BY DESIGN |

No unguarded cross-tenant read/write found. IDs are digit-exact validated everywhere via `intParam` (cart.ts:255-311 documents the R122 tightening).

---

## 4. Rate limits + trust boundary

| Limiter | Value | Key | Mounted at |
|---|---|---|---|
| apiLimiter | 600/min | IP (req.ip; CF-validated) | app.ts:511, 926 (skips authed users + healthz) |
| userLimiter | 1200/min | `u:{userId}` (verified JWT) | app.ts:555, 927 |
| authLimiter | 10/15min | IP | /api/admin/login (+verify-2fa via prefix), /api/auth/firebase/{session,refresh}, /api/auth/telegram*, /api/auth/whatsapp/verify — app.ts:882-922 (single prefix mounts; the R98-F3 double-count bug stays fixed) |
| whatsappStartAuthLimiter | 20/15min | IP | app.ts:606, 921 (CGNAT mitigation) |
| couponValidateLimiter | 10/min | `cu:{userId}` else `/56` IPv6-collapsed IP | app.ts:636, 925 |
| ticketCreateLimiter / ticketReplyLimiter | support.ts:106, 206 | IP / user | per-route |
| copilotRateLimit | per-admin sliding window (Redis, fail-open — A7-F7) | adminId | copilot routes |
| credentials volume gate | 60/10min | adminId (in-memory) | orders.ts:37-57 |
| DB lockouts (lib/lockout.ts — exponential 15→30→60min…) | admin:`{user}:{ip}` 5; `admin-username:{user}` 10 (IP-independent, anti-distributed); `admin-2fa:{id}` 5 (shared budget between verify-2fa and verify-setup); `admin-pwchange:{user}`; `admin-2fasetup:{user}` | identifier (clamped 100) | auth.ts passim |

**XFF/CF-Connecting-IP trust boundary** — cloudflareClientIp.ts honours `CF-Connecting-IP` **only** when the rightmost XFF peer (the one hop the proxy appends) is inside Cloudflare's published ranges (cloudflareClientIp.ts:197-211); forged headers from a direct-to-origin connection are ignored and req.ip falls back to Express's `trust proxy = 1` resolution (app.ts:292). Lockout keys read `req.ip` (auth.ts:133), not raw headers (R97-01 fix intact). Live: legacy `subnation2.onrender.com` origin answers **503** (suspended) — the H11 direct-origin residual is effectively closed; the code backstop remains as defense-in-depth. Direct reachability of the current Coolify origin IP: **UNVERIFIED** (out of guest-probe scope).

Login-brute-force math: distributed attacker against one password — 10 failures/15min globally (username lockout, IP-independent, exp backoff), 5/15min per (user,IP); argon2id per attempt; username-existence oracle closed by uniform 401 + dummy-argon2 timing parity (auth.ts:164-226). 2FA keyspace 10⁶ capped at 5 guesses/15min per admin.

---

## 5. Secrets & crypto (verified at HEAD)

- **ENCRYPTION_KEY**: 32-byte hex enforced at boot (encryption.ts:137-180); AES-256-GCM, v2-prefixed blobs; rotation ladder current→ENCRYPTION_KEY_PREV (never encrypts with prev). **GCM authTagLength: explicit 128-bit** — `createDecipheriv(…, { authTagLength: 16 })` at encryption.ts:211 **plus** a hard `authTag.length !== 16` throw at :219 (mission W7 fix intact at HEAD; single funnel for both key generations).
- **delivered_password decrypt path**: list route no longer decrypts (orders.ts:283-295); the only decrypt surface is GET /orders/:id/credentials — volume-gated **before** any decrypt (orders.ts:338), audit row **awaited before** the material leaves the process (:375), `decrypt_failed` honesty flag (:403).
- **JWT**: `ADMIN_JWT_SECRET` distinct from `SESSION_SECRET`, both fail-fast ≥32 chars (jwt.ts:56-101); every verify pins `algorithms:["HS256"]` (:113); admin tokens carry row-backed `sid`, revoked on logout/password-change (admin-session.ts:44-93); 2FA temp tokens rejected at every gate (requireAdmin.ts:62, metrics.ts:60, socket.ts:310, probe auth.ts:444).
- **Session tokens**: sid = `randomUUID()` hex (admin-session.ts:47); 8h JWT TTL + row expiry; 60s validity cache with immediate purge on revoke.
- **Cookies**: admin_token httpOnly, secure-in-prod, SameSite=Lax default (cookie-options.ts:8-19; `AUTH_COOKIE_SAMESITE=none` is the documented cross-origin override — production is single-origin). Token no longer returned in JSON (auth.ts:279-290).
- **TOTC secrets encrypted at rest** (auth.ts:891-894) with legacy-plaintext passthrough on verify; `verifySync` result-object verdict fix intact (auth.ts:373-374, 960-961).
- **Hardcoded secrets grep**: none in backend source (checked for literal tokens/keys in lib/routes; only env-var references). Frontend has no embedded secrets (Firebase/GA public IDs only).
- **CSRF**: Origin/Referer exact-match gate on all mutating routes, fail-closed boot assertion when allow-list empty in production (app.ts:122-133, 744-876); webhook + /api/cwv the only skips (signed/beacon).
- **Audit-log redaction**: auth-provider PATCH logs field KEYS only (auth-settings.ts:1262-1266); safeDecrypt logs length+format fingerprint, never the value (encryption.ts:405-421).

---

## 6. Live black-box (guest-level, ≤3 req/endpoint — https://subnation.ly, 2026-10-09)

| Check | Result | Assessment |
|---|---|---|
| CSP | full helmet set incl. `base-uri`, `form-action`, `frame-ancestors`, `object-src 'none'` | strong; `script-src-attr 'unsafe-inline'` (A7-F2) and `style-src 'unsafe-inline'` (Tailwind-inherent, accepted) are the only relaxations |
| HSTS | `max-age=63072000; includeSubDomains; preload` | ✓ preload-eligible |
| X-Content-Type-Options | `nosniff` | ✓ |
| COOP / CORP | `same-origin-allow-popups` / `same-origin` | ✓ (Firebase-popup compatible) |
| X-Frame-Options / Referrer-Policy / Permissions-Policy | `SAMEORIGIN` / `strict-origin-when-cross-origin` / camera,mic,geo,usb,midi,accel=() | ✓ |
| HTML shell cache-control | `no-cache, no-store, must-revalidate` | ✓ |
| Authenticated-surface caching | /api/admin/{products,orders,stats} 401s → `cache-control: no-store` ✓; **/api/admin/session 401 → NO Cache-Control** (A7-F3) | parity gap only; 401 bodies are static |
| 404 vs 401 route-existence oracle | `/api/admin/definitely-not-a-route` → **401 identical body** to a real route (`{"error":"غير مصرح","code":"UNAUTHORIZED"}`) | **no route-existence disclosure** for unauthenticated callers (protectedRouter's blanket requireAdmin swallows unmatched admin paths) |
| CORS | OPTIONS /api/admin/login with `Origin: https://evil.example` → **403**, no ACAO/ACAC; same with `Origin: https://subnation.ly` → 204 | ✓ allow-list enforced |
| security.txt | `/.well-known/security.txt` + `/security.txt` → **200 SPA index.html** (soft-404) | A7-F9: serve a real one or 404 |
| robots.txt | disallows /admin, /admin/, /status, /api/ + sitemap | ✓ |
| Rate-limit headers | `ratelimit: "600-in-1min"; r=599` + `ratelimit-policy … pk=:<hash>:` (Cloudflare edge RL) | edge RL = defense-in-depth; `pk` hashed-IP pseudonym disclosed (A7-F8) |
| Legacy origin | subnation2.onrender.com/api/healthz → **503** | direct-origin bypass path dead |
| Healthz | public `{"status":"ok"}` max-age=5; /healthz/summary status-only | scope parity intact |

**A7-F2 CSP inline-attr risk assessment (mandate item):** first-party code has **zero** inline event handlers (`grep onclick|onload|onerror|javascript:` across frontend/src → 0 hits; `dangerouslySetInnerHTML` → 0 hits; index.html handlers → 0). The only inline execution is (a) an inline `<script>` modulepreload hint in the served index.html — which the production CSP itself **blocks** (functional dead code, see A7-F9) — and (b) the documented Firebase Auth SDK popup behavior (app.ts:193-194 comment; `signInWithPopup` in use at firebase-auth.ts:26-30). *(R126-L1 note: (a) was A11-F1's P1 — the gate is now an external `data-home-chunk`-driven script under `/assets/`, CSP-clean; the built shell has zero src-less `<script>`, enforced at build time.)* Real risk: **low** — exploitation requires a separate attribute-injection sink that the React tree does not currently offer; dropping `script-src-attr 'unsafe-inline'` would harden against future sinks but risks the Firebase popup flow the comment says was empirically observed. Recommendation: test removal in staging with the Google-popup + phone-auth flows; ship only if both pass.

---

## 7. Input validity (admin write routes)

- **Bulk arrays**: orders bulk-status 200-id cap (orders.ts:187, 444); risk bulk-label 100 (risk.ts:383) with zod-validated elements (:372); inventory upload 500 entries (products.ts:734); risk config arrays capped (ips/devices/phones ≤100, requireApprovalUserIds ≤1000 — risk.ts:575-595). No unbounded array ingest remains.
- **Strings**: column-aligned caps throughout (username 100/display_name 100 admins.ts:126,176,253; profile 100 auth.ts:690-717; admin_note 500 topups.ts:36; note 500 users.ts:270; ticket reply 4000 tickets.ts:215; title 255 flash-sales; final_text capped enrichment.ts:115; provider fields 500/4000 auth-settings.ts:1184-1193; SEO fields column-bounded via generated zod products.ts:241-246).
- **Numbers**: loyalty 0..10M integer (users.ts:191-208); risk thresholds 0..100 ordered (risk.ts:565-643); set-count 0..100k; coupon value <100% (coupons.ts:304); page/limit clamps + MAX_PAGE everywhere (pageParam).
- **File/image uploads**: none (image_url is a string field, bounded).
- **Outbound templates**: every Telegram HTML interpolation passes `escapeHtml` (telegram.ts:140-284 — phone, productName, orderCode, coupon code all escaped; escapeHtml def at :506). WhatsApp OTP message is a static template with only the 6-digit code (whatsapp-otp.service.ts:543). No template-injection vector found.
- **Minor**: AdminLoginBody password has no max length (unbounded zod string; only express.json's 1mb outer bound) — argon2 pre-hashes with blake2b so cost is negligible; a 512-char cap would be cosmetic parity (P4).

---

## 8. Supply chain (quick pass)

- **Lockfile**: pnpm 9.0, `packageManager pnpm@10.17.0`. Overrides at pnpm-lock.yaml:64-84 are all version bounds (no registry-URL/git overrides): qs≥6.16, body-parser≥2.3, ws≥8.21, esbuild 0.27.3, form-data, brace-expansion, proxy-addr, ip-address, @fastify/busboy, @grpc/grpc-js, protobufjs, websocket-driver, otel instrumentations — consistent with R119's consolidation (ff8fbbf) + R123 additions.
- **Newest entries since R119** (git diff f717c6f→ca363e7, 109 lines): orval 8.40 codegen family, @modelcontextprotocol/sdk, @faker-js/faker, otel api/core/instrumentation bumps, @commander-js/extra-typings — **all dev-time/contracts tooling, zero new runtime prod dependencies**. Runtime deps remain the mainstream set (express 5, helmet 8.1, jsonwebtoken 9.0.3, otplib 13.4, argon2 0.44, firebase-admin 13.6, socket.io 4.8.3, drizzle, zod) — no known-advisory versions spotted at these majors. Full `pnpm audit` not run (read-only mandate).

---

## 9. R122 residual re-verification (three rounds later — all INTACT)

| R122 fix | HEAD evidence |
|---|---|
| Subset-bounded admin grants (A5-P1) | admins.ts:40-48 `grantViolation` (acting set supersedes; "all" only wildcard), applied POST :151, PATCH :265, enable :416. Last-admin guards :285-310, :361-380. |
| 2FA verify-setup lockout (A5-P2) | auth.ts:923-946 — same `admin-2fa:{adminId}` key/budget as /login/verify-2fa, check-before-decrypt, record-on-fail :962, reset-on-success :965. |
| healthz scope parity | health.ts:522, :820, :851, :872, :882, :917 — every detailed healthz endpoint RA+settings; public /healthz/summary is status-only (:802-815). |
| (Adjacent, also re-verified) B1-3 finance gates on money writes | users.ts:213 & :310, referrals.ts:133, orders.ts:499 — all present. |

---

## 10. Recommended next actions (priority order)

1. **A7-F1 (P2):** gate GET /api/admin/stats + /chart-data on a scope — `orders|finance` fits the revenue/wallet data (one-line `requirePermission` at stats router level or mount move under protectedRouter). Attack scenario today: a `support`-only scoped admin (or a session stolen from one) reads total_revenue, today_revenue, total_wallet_balance, user counts — business-sensitive aggregates with zero RBAC friction.
2. **A7-F4 (P3):** add `writeAuditLog` to POST /tickets/:id/reply + PATCH /tickets/:id/status (support admins message customers and mutate ticket state with no trail — the exact class every other admin write covers).
3. **A7-F3 (P3):** add the standard `router.use(no-store)` middleware to adminAuthRouter so 401/error envelopes match the R123-E5 pattern (extend admin-no-store-stragglers.test.ts to the 401 path).
4. **A7-F2 (P3):** staged test of dropping `script-src-attr 'unsafe-inline'` (Firebase Google-popup + phone-auth reCAPTCHA regression pass required before ship).
5. **A7-F6/A7-F5 (P4):** add a defensive `router.use(requireAdmin)` to admins.ts and `requirePermission("settings")` (or document the any-scope decision) on the /api/metrics JWT branch.
6. **A7-F9 (P4):** serve a real /.well-known/security.txt (or make it 404 instead of the SPA 200); optionally delete or nonce the CSP-blocked inline script in index.html.

---

*Report generated by audit agent R126-A7. All file:line references verified at HEAD 186b131 on 2026-10-09. Live evidence captured with curl (guest-level, ≤3 requests/endpoint, no mutations).*
