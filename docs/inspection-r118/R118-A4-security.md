# R118-A4 — End-to-End Security Audit (SubNation2)

- **Scope**: admin auth chain, TOTP state, WhatsApp OTP, rate-limit coverage, live security headers, CORS/CSRF, encryption at rest, secrets hygiene, dependencies, admin surface.
- **HEAD**: `ef3d0c3` (main, clean tree). Stack: pnpm monorepo · backend `@workspace/api-server` (Express 5.2.1) · Neon Postgres 17 · production https://subnation.ly.
- **Mode**: READ-ONLY. Code review + 14 live GET/HEAD probes (no auth attempts, no scans, no writes) + 7 read-only DB SELECTs (scripts/r118_a4_db.js — classifications only, no credential values printed).

## Probe list (14 requests, all GET/HEAD)

| # | Probe | Result |
|---|---|---|
| 1 | `HEAD https://subnation.ly/` | 200 — HSTS preload, full CSP, COOP/CORP, nosniff, XFO SAMEORIGIN, Referrer-Policy, Permissions-Policy; no Server/X-Powered-By banner |
| 2 | `HEAD /api/healthz` | 200, `Cache-Control: public, max-age=5`, full header set |
| 3 | `HEAD /api/nonexistent-audit-path` | 404 JSON (API not swallowed by SPA) |
| 4 | `HEAD /api/admin/stats` (unauth) | **401** |
| 5 | `HEAD /api/metrics` (unauth) | **401** |
| 6 | `GET /api/products?limit=1` + `Origin: https://evil.example` | **403**, NO `Access-Control-Allow-Origin` — CORS gate live |
| 7 | `HEAD /api/auth/probe` | 200, `no-store` + `ratelimit: "600-in-1min"; r=598` (draft-8 headers prove apiLimiter live, IP-keyed) |
| 8 | `HEAD /api/healthz/ready` | **401** (admin-gated as designed) |
| 9 | `HEAD /api/admin/diagnostics` | **401** |
| 10 | `HEAD /api/admin/copilot/history` | **401** |
| 11 | `HEAD /api/healthz/summary` | 200, `max-age=15` (public coarse status by design) |
| 12 | `HEAD /api/admin/probe` | 200 `no-store` (200-always cookie-presence probe, by design — returns `authenticated:false` only) |
| 13 | `HEAD /api/admin/admins` | **401** |
| 14 | `HEAD /api/admin/settings/auth` | **401** |

No `Set-Cookie` was observed on ANY unauthenticated response (failed logins set no cookie; cookies are minted only on full auth success — code-verified, see F-chain below).

---

## FINDINGS

### F1. Admin account `ahmadmedo` (permissions `["all"]`) runs without a second factor — TOTP implemented but NOT enrolled
**[P1]**
- **Evidence (DB, read-only)**: `admin_users`: exactly 1 row — `ahmadmedo`, `role=admin`, `is_active=true`, `permissions=["all"]`, **`totp_enabled=false`, `totp_secret IS NULL`**, `password_hash` = `$argon2id$` (len 97).
- **Evidence (code)**: TOTP is fully implemented — `backend/src/routes/admin/auth.ts:255-266` (login issues 10-min `isTemp` challenge), `:292-382` (verify-2fa + per-admin lockout), `:779-895` (setup + verify-setup with 93-A1 S5 re-auth gate); `backend/src/jobs/security-advisories.ts:44-77` (weekly `admin:no-totp` advisory exists precisely because this admin has `["all"]` without TOTP). Live DB shows the advisory condition is TRUE today.
- **Docs truth**: `docs/operations/FINAL_ADMIN_TOTP_SETUP.md` is **accurate, not aspirational** — §6 states "Enrollment on the live account remains OPEN (r111): `ahmadmedo` still has `totp_enabled = false`". Every code claim in the doc was verified at HEAD (line cites match).
- **Blast radius of the missing factor** (what a password-only compromise reaches): reveal buyers' delivered order credentials (per-order, now volume-gated 60/10 min — F-chain V13), approve/reject wallet topups (**money mint**), issue refunds, change pricing, create unlimited coupons, create/disable admin accounts, full user PII. Compensating controls are real (argon2id 64 MiB, 5-per-(user,ip) + 10-global-per-username lockouts, 10/15min/IP login limiter, uniform-401 no-username-oracle, revocable sessions) — they cap *guessing*, not phishing/keylogging/credential reuse.
- **Impact**: single password is the only factor on the money account.
- **Fix**: operator runs `FINAL_ADMIN_TOTP_SETUP.md` §2 (settings → security → enroll, ~10 min, no code change). The weekly advisory already nags until done.
- **Effort**: S (operator action only).

### F2. No encryption-key versioning — ENCRYPTION_KEY rotation would orphan every stored credential
**[P2]**
- **Evidence**: `backend/src/lib/encryption.ts:91-98` — blob format is `iv:authTag:ciphertext` with **no version/keyId byte**; `parseKey()` (:13-19) reads one raw 32-byte hex key; the rotation NOTE (:64-67) admits "a NEW key makes previously-encrypted rows undecryptable (safeDecrypt returns null)".
- **Live DB exposure today**: 10 `inventory.account_password` + 5 `orders.delivered_password` rows carry ciphertext (0 plaintext — see V8). A blind rotation = those 15 credentials become unrecoverable (R117 made `decrypt_failed` honest, so panels show empty, not garbage — but the data is still lost without the old key).
- **Impact**: no current exploit; rotation is a data-loss event with no dual-key window. Key is also not currently rotated at all (single-key lifetime).
- **Fix sketch**: (1) prefix future blobs `v2:iv:tag:ct` (isEncrypted stays shape-compatible via the existing 3-part check with a v2 branch); (2) add `ENCRYPTION_KEY_PREV` honored by decrypt-only fallback; (3) one-shot re-encrypt job over `inventory.account_password` + `orders.delivered_password` (≤ a few hundred rows); (4) only then retire the old key. Rotation then = generate new key (`scripts/generate-production-secrets.sh`), run job, redeploy.
- **Effort**: M (format branch + migration job + test fixtures).

### F3. Coupon validate is a live/dead enumeration oracle (documented, mitigated, still present)
**[P3]**
- **Evidence**: `backend/src/routes/coupons.ts:120-127` — nonexistent code → **404**, inactive/expired/maxed → **400**, live → 200. The repo itself documents the oracle: app.ts:574-583 ("a usable oracle for scraping every active coupon code"). Mitigation: `couponValidateLimiter` 10/min per-user (anonymous per-IP /56, `app.ts:593-615`) + `requireUser` on the route.
- **Residual**: an authed account can still test ~14,400 codes/day; codes are operator-chosen strings up to 40 chars (`coupons.ts:29`) — a weak operator code (e.g. `SAVE10`) is findable. Accepted trade-off (r4/SEC-92-04 hardening already applied).
- **Fix sketch**: uniform 404 for inactive/expired/maxed (client already shows distinct Arabic copy from `details.reason` only for live failures — needs a small client tweak), or minimum-entropy code guidance in the admin coupon form. Low priority.
- **Effort**: S.

### F4. TOTP secret stored unencrypted at rest (`admin_users.totp_secret`)
**[P3]**
- **Evidence**: `shared/db/src/schema/admin_users.ts:37` — `totpSecret: varchar(255)` plaintext; auth.ts:848-854 stores `generateSecret()` output as-is; verify reads it raw (`auth.ts:350, 883`).
- **Live state**: `has_totp_secret=false` (F1) — **no live exposure today**; becomes relevant the moment F1 is remediated.
- **Impact**: a DB-dump leak that defeats argon2id offline (or any SQL read) also defeats the second factor — the attacker can mint valid TOTP codes from the secret. Common industry practice is plaintext TOTP secrets, but this repo already has AES-256-GCM helpers + boot-asserted key, so the marginal cost of encrypting is near zero.
- **Fix sketch**: encrypt with the existing `encrypt()/safeDecrypt()` pair on write/read (wrap in the same change as F1 enrollment); handle the legacy-plaintext passthrough via `isEncrypted()` the same way inventory passwords do.
- **Effort**: S.

### F5. `Access-Control-Allow-Credentials: true` emitted on responses with no Origin header
**[P3] (cosmetic)**
- **Evidence**: probes 1-5, 8-14 all show `access-control-allow-credentials: true` with NO `Access-Control-Allow-Origin` (the `cors` package sets ACAC unconditionally once `credentials:true`, `app.ts:378-396`). Inert without ACAO (browser refuses credentialed responses lacking ACAO), but it is scanner-visible misconfig noise and invites future misuse of the flag.
- **Fix sketch**: only set ACAC when the request Origin matched the allowlist (custom `headers` hook or pre-flight-only middleware).
- **Effort**: S.

---

## RATE-LIMIT COVERAGE MAP (every public route file at HEAD)

Global wiring: `app.ts:839-885` — auth-family limiter mounts come BEFORE `app.use("/api", apiLimiter/userLimiter)`; `apiLimiter` (IP, 600/min, unauth traffic, `app.ts:468-510`), `userLimiter` (userId, 1200/min, authed traffic, `app.ts:512-534`), store = Redis when `REDIS_URL` set else memory (resilient store, `lib/rate-limit-store.ts`); key generator = library default `ipKeyGenerator` (IPv6 /56-64 collapsed, CF-validated `req.ip` via `cloudflareClientIp` mounted at `app.ts:311`).

| Endpoint(s) | Limiter(s) | Budget | Verdict |
|---|---|---|---|
| ALL `/api/*` unauthenticated | apiLimiter (IP) | 600/min | ✅ PROTECTED — **global IP limiting exists** |
| ALL `/api/*` authenticated (user token) | userLimiter (userId) | 1200/min | ✅ PROTECTED (per-identity) |
| POST `/api/auth/firebase/session`, `/refresh` | authLimiter (IP) | 10/15min | ✅ PROTECTED |
| POST `/api/admin/login` + `/login/verify-2fa` (prefix mount) | authLimiter (IP) + DB lockouts: 5/(username,ip), 10 global/username, 5/2FA-admin | 10/15min | ✅ PROTECTED (double-mount bug 98-F3 fixed; limiter-composition test pins it) |
| POST `/api/auth/telegram` (+`/webapp`, GET `/callback` — same prefix) | authLimiter (IP) | 10/15min | ✅ PROTECTED |
| POST `/api/auth/whatsapp/start` | whatsappStartAuthLimiter (IP) + per-phone 60s cooldown + 5/hour + advisory lock | 20/15min | ✅ PROTECTED (CGNAT-friendly split) |
| POST `/api/auth/whatsapp/verify` | authLimiter (IP) + 5-attempt/code hard-consume | 10/15min | ✅ PROTECTED |
| POST `/api/coupons/validate` | couponValidateLimiter (userId / IPv6-56) | 10/min | ✅ PROTECTED (enumeration-capped — see F3) |
| POST `/api/support/tickets` | ticketCreateLimiter (userId) | 5/hour | ✅ PROTECTED |
| POST `/api/support/tickets/:id/reply` | ticketReplyLimiter (userId) | 30/hour | ✅ PROTECTED |
| POST `/api/orders` (checkout) | requireUser + risk gates + idempotency + userLimiter | 1200/min/user | ✅ PROTECTED |
| POST `/api/wallet/topups` | requireUser + risk gates + idempotency + userLimiter | 1200/min/user | ✅ PROTECTED |
| /api/cart/* (GET/POST/PATCH/DELETE) | requireUser + userLimiter | 1200/min/user | ✅ PROTECTED |
| GET `/api/products*` + `/catalog/stats` + `/flash-sale` aliases | apiLimiter + 60s edge cache (`catalogCache`) | 600/min IP | ✅ PROTECTED (public catalog by design) |
| GET `/api/healthz`, `/live`, `/summary` | limiter-skipped (`app.ts:495-503`) + Cache-Control 5s/15s; no per-request DB on hot paths | — | ✅ BY DESIGN (probe budget protection; coarse public status only) |
| POST `/api/cwv` | apiLimiter + 8kb text body cap (`cwv.ts:180-186`) | 600/min IP | ✅ PROTECTED |
| POST `/api/webhook/telegram` | apiLimiter + `x-telegram-bot-api-secret-token` timing-safe verify, fail-closed 503 if unset (`telegram-webhook.ts:207-218`) + update-id replay guard | 600/min IP | ✅ PROTECTED (signature-gated) |
| GET `/api/auth/probe`, `/api/auth/providers`, `/api/admin/probe` | apiLimiter | 600/min IP | ✅ PROTECTED (probe verified live: draft-8 headers present) |
| GET `/api/metrics` | requireMetricsAuth (admin JWT w/ full revocation posture, or constant-time static token) | auth-gated | ✅ PROTECTED (401 live) |
| ALL `/api/admin/*` except login/probe | protectedRouter(requireAdmin) + scoped requirePermission mounts (`routes/admin/index.ts:38-131`) | — | ✅ PROTECTED (401 live ×5 surfaces probed) |
| GET `/api/admin/orders/:id/credentials` | **R117 reveal gate**: 60/10min per-admin sliding window + 429 + named deduped alert (`admin/orders.ts:36-56, 253-276`) | 60/10min/admin | ✅ VERIFIED AT HEAD (const `CREDENTIALS_VIEW_MAX=60`, window 10min, `credentials-sweep:<adminId>` alert names the admin) |

**UNPROTECTED endpoints: none found.** Worst case anywhere is the global 600/min/IP anonymous budget. Note (consistent with R117 design): admin-cookie traffic is NOT covered by userLimiter (it keys on the *user* token only), so admin surfaces ride the IP-keyed 600/min — which is exactly why the per-admin reveal gate exists.

---

## VERIFIED-OK (13 clusters)

1. **Password hashing**: argon2id m=65536 KiB, t=3, p=1 (`lib/crypto.ts:11-16`, OWASP-2024 class) + `needsRehash` self-migration; legacy SHA-256 fallback removed with fail-closed `resetRequired`; constant `DUMMY_PASSWORD_HASH` burns the same ~100 ms on every miss branch (username/timing oracle parity, auth.ts:176-241). Live DB: hash is `$argon2id`, len 97.
2. **JWT**: HS256 with algorithms pinned on every verify (`jwt.ts:113`); `SESSION_SECRET` ≥32 chars fail-fast (:14-20); **separate `ADMIN_JWT_SECRET`** ≥32, must ≠ SESSION_SECRET, production refuses to boot without it, dev-only derived fallback is loud-warned (F-001, :53-103); admin tokens 8h, user tokens 30d.
3. **Admin session chain**: every session = durable `admin_sessions` row + `sid` claim (`lib/admin-session.ts:44-61`); production rejects sid-less tokens (`requireAdmin.ts:78-84`); logout = row revocation + cookie clear + audit (auth.ts:515-525); password change revokes ALL sessions (:607-614); 2FA-disable requires password re-auth (S5, :796-846); revocation cache ≤60s with immediate purge on the logout/password paths; retention prune job (:183-205) — live DB: 6 rows, 0 live, all expired/revoked (cleanup works).
4. **2FA temp-token half-session**: `isTemp` rejected at requireAdmin (:62-67), /probe (:421-423), and /metrics (metrics.ts:53-60) — the V1-CRITICAL bypass class is closed on all three verifiers. 10-min TTL + per-admin 5-attempt lockout on the verify step.
5. **Session fixation / privilege change**: fresh random `sid` per login (no cookie reuse); `requireAdmin` re-reads `is_active` + `permissions` from the row **per request, uncached** (:99-126) — a permission downgrade or disable applies immediately without waiting for session expiry.
6. **Cookies**: `httpOnly`, `secure` in prod, `SameSite=Lax` (single-origin shape; `AUTH_COOKIE_SAMESITE=none` opt-in documented), `path=/` (`cookie-options.ts:12-20`, auth.ts:40-45); raw JWTs never returned in bodies (R97-02 — cookie sentinel `__cookie_session__` for users, admin login returns no token); zero Set-Cookie on any unauthenticated live response.
7. **CSRF gate**: Origin/Referer validation on ALL mutating methods in ALL environments, URL-parsed **exact** scheme+host match (no prefix bypass), hostile "auth cookie + no Origin/Referer" rule, fail-closed + boot assertion when the allowlist is empty in production (`app.ts:69-127, 701-835`); `/api/cwv` and `/api/webhook/*` the only skips (beacon semantics / signature-verified callbacks).
8. **Encryption at rest / delivered credentials**: AES-256-GCM, 12-byte random IV per value, 16-byte auth tag, boot fail-fast on key shape (`encryption.ts`); admin writes encrypt (`admin/products.ts:563, 606`); checkout stores the AT-REST ciphertext passthrough (`checkout.service.ts:534` + H2 comment); **live DB classification: `inventory.account_password` 10 encrypted / 0 plaintext / 3 null; `orders.delivered_password` 5 encrypted / 0 plaintext / 2 null** — zero plaintext credential rows in the database.
9. **WhatsApp OTP**: CSPRNG `randomInt` 6-digit (`lib/whatsapp-otp.ts:56-59`); HMAC-SHA256 with purpose-scoped derived key `HMAC(SESSION_SECRET,"whatsapp-otp-v1")` + `OTP_HMAC_KEY` override (A8-07, service :40-61); constant-time compare; 5-min TTL; 5-attempt cap with hard-consume + atomic increment; CAS consume (replay-proof, race-proof); per-phone 60s cooldown + 5/hour; start serialized by `pg_try_advisory_lock` on a **dedicated lockPool max 2** with destroy-on-unlock-failure (R117 fixes verified at HEAD: `shared/db/src/index.ts:122-132`, service :219-290); failed delivery leaves no row; responses never contain the code; live DB: 2 rows, all `code_hash` len-64, 0 exhausted.
10. **CORS**: exact-origin allowlist gate 403s disallowed origins BEFORE the `cors` middleware (clean 403, no 500 — live probe 6: evil.example → 403, no ACAO); credentials:true scoped to allowlisted origins only; preflight cached 600s; boot warn for split-era origin vars restored at HEAD (`origins.ts:38-56`, called at `app.ts:34`).
11. **Admin surface wiring**: every `routes/admin/*` file is behind `protectedRouter.use(requireAdmin)` + a scoped `requirePermission` mount (`admin/index.ts:38-131`); only login/probe are public by design; diagnostics + observability are double-gated (inline requireAdmin + `settings` scope parent); copilot routes each apply requireAdmin + phase gates, and the tool layer enforces `isPathAllowed` (/api/admin/ prefix + URL re-normalization, `services/copilot/admin-request-tool.ts:146+`); metrics endpoint = admin JWT (full revocation parity incl. sid + is_active) or constant-time static token — 401 live.
12. **IDOR + XSS + injection**: ownership predicates on `orders/:orderCode`, support tickets, notifications (`and(eq(...userId))` at orders.ts:329, support.ts:172, notifications.ts:57); **zero `dangerouslySetInnerHTML` in frontend/src** (rg — single test reads innerHTML) so ticket/reply text renders as React-escaped text; DB-backed OG share card HTML-escapes all DB strings (`app.ts:1004-1009`); Drizzle parameterizes all queries + `escapeLikeTerm` on ILIKE (R116 A6-9).
13. **Secrets + deps**: no `AIza…`/`sk-…`/`BEGIN PRIVATE KEY`/hardcoded `secret=` in the tree (matches are test fixtures + redaction tests only); `.gitignore` covers `/.env*`, `frontend/.env*`, `backend/.env*` with `*.example` exceptions; Firebase service account loaded from env vars only (`firebase-admin.ts:39-99`), never a repo file; frontend Firebase keys are the public-by-design VITE_ web config; docs contain no credential-bearing URLs/tokens/JWTs; `scripts/generate-production-secrets.sh` is CSPRNG-based with per-secret shape rules. Dependency posture: express 5.2.1, jsonwebtoken 9.0.3, helmet 8.1.0, pg 8.20.0, socket.io 4.8.3, argon2 0.44.0, otplib 13.4.0, express-rate-limit 8.4.1, pino 9.14 — all current majors, no abandoned/suspicious packages in the 25-dep backend set; **pnpm audit could not run in this sandbox** (no pnpm binary; `npm audit` rejects the pnpm lockfile — ENOLOCK) — recommend one manual `pnpm audit --prod` on an operator machine.

---

## Stats

**Findings by severity: P0: 0 · P1: 1 · P2: 1 · P3: 3 (+ 13 VERIFIED-OK)**

Top remediation order: (1) enroll TOTP on `ahmadmedo` (F1, kills the P1 + pre-answers F4), (2) key-versioning + re-encrypt job (F2), (3) encrypt the TOTP secret column in the same change (F4), (4) coupon 404-uniformity (F3), (5) ACAC header hygiene (F5).
