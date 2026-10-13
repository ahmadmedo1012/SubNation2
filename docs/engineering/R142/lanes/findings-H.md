# Lane H — Authentication / Authorization / Sessions / Privacy / Security & Supply Chain

Round R142 · Task 142-H1 · Read-only audit · HEAD `a9f5e83` (tree clean except `docs/engineering/` audit outputs)
Lens: /cso (attacker · boundary · impact for every finding) + Ponytail 6 lenses. Evidence before assurance.

---

## Auth architecture map (verified in source, not docs)

**Customer identity — three mints, one session shape.**
1. *Firebase/Google*: SPA `signInWithFirebaseGoogle` → `getIdToken` → `POST /api/auth/firebase/session` (also `/firebase/refresh`). Backend `verifyFirebaseIdToken(id_token, checkRevoked=true)` (routes/auth.ts:544), phone-provider tokens permanently rejected (auth.ts:554), account-link conflicts escalate to a consent-token flow (F-003).
2. *Telegram*: redirect flow (TelegramLoginButton.tsx builds `oauth.telegram.org/auth?…return_to=/auth/telegram-callback`) → SPA decodes `#tgAuthResult` → `POST /api/auth/telegram` (HMAC-SHA256(botToken) per lib/telegram-auth.ts, timing-safe, 30-min freshness, replay hash claimed once — Redis NX/EX or bounded memory); Mini App flow `POST /api/auth/telegram/webapp` (HMAC("WebAppData", botToken), 24h freshness). The legacy `GET /api/auth/telegram/callback` mint is additionally behind the B1-1 same-origin Sec-Fetch-Site/Referer gate (lib/telegram-callback.ts — fail-closed).
3. *WhatsApp OTP*: `POST /api/auth/whatsapp/start` → OpenWA external image sends a 6-digit code (randomInt CSPRNG, HMAC-bound to phone+purpose, 5-attempt cap, 5-min TTL, per-phone 60s/5-per-hour, process-wide daily cap) → `POST /api/auth/whatsapp/verify` → guarded compare-and-set consume.

All three converge on `createUserSession` (lib/session.ts): UUID `sessionId` + `sessions` row (UA/IP/30-day expiry) + JWT `{userId, sessionId}` signed with `SESSION_SECRET` (HS256 pinned). **Transport:** httpOnly cookie (`auth_token`, SameSite=lax default, secure in prod, path=/) — the JWT is never in a response body (sentinel `__cookie_session__`, 98-F3) and never persisted client-side (React state only; no localStorage of the credential — verified frontend/src/lib/auth.tsx). **TTL/rotation:** 30d JWT = 30d row = 30d cookie; no refresh-token rotation for the app session (Firebase rotates its own ID token). **Invalidation:** session-row deletion (logout/logout-all/user deletion) enforced by `requireUser` via `isSessionRowLive` (60 s in-process cache, ownership predicate sid+userId) on every authed request, by the socket handshake + 5-min re-verify, and by `/api/auth/probe`. Legacy sid-less tokens are rejected in production (fail-closed).

**Admin identity.** Username + argon2id password (`POST /api/admin/login`, OWASP params, dummy-hash timing parity, per-(username,ip) 5-attempt + per-username 10-attempt exponential lockout) → optional TOTP (`otplib`) with a 10-min `isTemp` half-session token that `requireAdmin` and the socket handshake both reject → `createAdminSession`: 8h JWT `{adminId, role, sid}` signed with the **distinct** `ADMIN_JWT_SECRET` + `admin_sessions` row; every request re-validates the row (revocation truth: logout / password-change / soft-disable `is_active`), permissions read live per request. Cookie `admin_token` httpOnly 8h. RBAC: path-scoped `requirePermission` gates under one `requireAdmin` mount (routes/admin/index.ts:40-120).

**Trust boundaries:** (a) browser→backend HTTP (Origin/Referer CSRF gate on every state-changing method; CORS exact-origin gate; CSP/HSTS/COOP headers); (b) browser→WS (origin allowlist + JWT + DB liveness); (c) Telegram→backend (bot-token HMAC + replay claim); (d) Firebase→backend (verified ID token); (e) WhatsApp-user→backend (OTP HMAC + caps); (f) admin-browser→backend (argon2 + 2FA + sid row). Secrets: `SESSION_SECRET`/`ADMIN_JWT_SECRET`/`ENCRYPTION_KEY`/`OTP_HMAC_KEY` env-only, fail-fast boot checks, never in output.

**Horizontal authz (traced to queries, not just guards).** orders GET list/:orderCode, wallet topups/ledger/summary, cart items, loyalty ledger, notifications, support tickets, sessions — all parameterized Drizzle queries scoped `eq(table.userId, userId)` from the `requireUser`-verified token (orders.ts:137/398, wallet.ts:97/168/206, cart.ts:126/316/380, notifications.ts:56-115, support.ts:51/173/226, auth.ts:870). Cart mutations pre-check ownership via SELECT then write by id (rows never change owners — no exploitable TOCTOU).

---

## Findings

Severity ladder P0 (critical) → P4 (nit/info). No P0/P1 found. The auth surface has been hardened by ≥10 prior audit rounds (F-001/F-003/F-009/98-F3/A8-01..09/SEC-92-01..04/B1-1/B1-4/R97-01/R110-01/RT-4/V1-CRITICAL/V1-H3…) — all previously documented fixes verified present in source, none regressed.

### H-1 · P3 — Money-read surfaces have no horizontal-authz regression test
- **Attacker / boundary / impact:** an authenticated customer (user A) against the customer money routes. Today every query is correctly userId-scoped — I verified the predicates in source. But nothing in the suite fails if a refactor drops the `eq(table.userId, userId)` predicate from `GET /api/orders/:orderCode` (orders.ts:398), `GET /api/wallet/topups` (wallet.ts:168), `GET /api/wallet/ledger` (wallet.ts:206), or `GET /api/loyalty/ledger`. A dropped predicate lets user A enumerate order codes / read user B's order history (order rows carry `has_credentials` flags, totals, status) and B's full money ledger — a silent P1 privacy breach that ships green.
- **Concrete case:** cart has exactly this test class (cart.test.ts:411 "refuses to mutate another user's row (404)", :532 "returns 404 for an item belonging to another user"), and sessions (auth-sessions.test.ts:309) and notifications (notifications.test.ts:105) pin cross-user isolation — but the only tests touching orders/:orderCode exercise credential serialization (orders-credentials-serialization.test.ts), and user-money-history-pagination.test.ts paginates a single user's own rows. The gap is the money family.
- **Minimal fix:** one pglite harness test per surface (the cart test is the template): seed users A+B with distinct rows, request B's orderCode/ledger with A's cookie → assert 404 / empty list; B's rows never appear in A's list responses. Four small `it()` blocks, no new infrastructure.
- **If we skip it:** the strongest authz property in the system (per-user money privacy) is guarded by source-review only; the next refactor of those WHERE clauses is unguarded.

### H-2 · P4 — SENTRY_AUTH_TOKEN passes as a Docker build ARG (intermediate-stage layer history)
- **Attacker / boundary / impact:** an attacker with access to the Coolify builder VM's Docker daemon / build cache (or CI runner cache for docker.yml GHCR builds) — the `build` stage's layer history. Docker records ARG values consumed by a `RUN` in that stage's image history (`docker history --no-trunc`). Dockerfile:185-192 runs `SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN}" pnpm --filter … run build`, so the token is materialized in the discarded build stage's metadata on the builder.
- **Mitigations already present (why this is P4, not P2):** the value is never baked as a default ("Never bake real values as defaults" comment), the runtime stage is a fresh layer chain that only `COPY --from=build`s filesystem content (the ARG never reaches the final image's config), and the token's scope is Sentry source-map upload (a nuisance credential, not a data-plane secret). Real-world exposure requires daemon/build-cache access on the build host — at which point the host itself is compromised.
- **Minimal fix:** switch the sourcemap-upload step to BuildKit secret mounts: `RUN --mount=type=secret,id=sentry_token SENTRY_AUTH_TOKEN=$(cat /run/secrets/sentry_token) …` and pass `--secret id=sentry_token,env=SENTRY_AUTH_TOKEN` at build time (Coolify supports secret build inputs). One RUN line + build arg removal.
- **If we skip it:** residual risk stays confined to builder-host cache inspection.

### H-3 · P4 — `pnpm audit --prod`: 1 HIGH + 1 MODERATE, both unfixable firebase-admin transitives (upstream-blocked)
- **Evidence (network available — NOT BLOCKED):** `corepack pnpm audit --prod` at HEAD:
  - HIGH · node-forge ≤1.4.0 · GHSA-86w9-cpqp-85rv (RSA PKCS#1 v1.5 nested DigestAlgorithm) · path `backend>firebase-admin>node-forge` · **no patched version exists** (`patched: <0.0.0`).
  - MODERATE · uuid <11.1.1 · GHSA-w5hq-g745-h8pq (buffer bounds in v3/v5/v6) · paths `backend>firebase-admin>@google-cloud/firestore>google-gax>uuid` and `backend>firebase-admin>@google-cloud/storage>uuid` · patched ≥11.1.1 (upstream must bump).
- **Attacker / boundary / impact:** low for this deployment — node-forge in firebase-admin is used for service-account/cert parsing, not for verifying attacker-controlled RSA signatures (token verification rides Google JWKS); the uuid issue needs a caller passing a shared buffer to uuid v3/v5/v6, which this codebase never does. Recorded because the CVE gate's own posture (ci.yml: critical=block, high=inform) means this passes CI silently.
- **Minimal fix:** none possible in-repo without a firebase-admin release; track upstream and re-run `pnpm audit --prod` on the next firebase-admin bump (the weekly CI schedule job already re-checks). If a pin override were forced it would break firebase-admin's own resolution — deliberately not recommended.
- **If we skip it:** nothing — visibility only.

### H-4 · P4 — Legacy `?token=` branch in auth-callback.tsx is dead-but-armed login-CSRF-shaped code
- **Attacker / boundary / impact:** a victim's browser hitting `/auth/callback?token=<JWT>`. The branch (auth-callback.tsx:46-57) `setToken(token)` from the URL — the classic login-CSRF / session-fixation shape: an attacker who could mint a valid JWT for their own account and lure the victim to this URL would confuse the SPA into rendering the attacker's identity.
- **Why it is not exploitable today:** since 98-F3, **no mint route returns the JWT in any response body** (all return the `__cookie_session__` sentinel; the real credential is httpOnly-cookie-only), so a browser-side attacker cannot read their own token to construct the link. The A8-09 `replaceState` scrub already removes the value from history once read.
- **Concrete case:** the branch's own doc says "The legacy branch is removed once every active session has rolled over via the cookie path." That rollover is long complete (98-F3 predates ≥40 rounds; all 30-day sessions minted since carry cookies only).
- **Minimal fix:** delete the `if (token)` branch (auth-callback.tsx:46-57) + its `setToken`/`useAuth` wiring if unreferenced — 8 lines. Defense-in-depth for a shape that can only grow attackers over time (any future route that ever echoes a real token re-arms it).
- **If we skip it:** dormant code carrying a documented attack shape; risk only materializes if a future change reintroduces body-borne tokens.

### H-5 · P4 (info) — Two adjudicated env-coupling notes (no action required)
1. **Cookie `secure` is keyed to NODE_ENV, not the request scheme** (cookie-options.ts:15). If a deployment ever serves TLS traffic with `NODE_ENV` unset, `auth_token`/`admin_token` ship without `Secure`. Every other production posture (secret fail-fasts, CSRF boot assertion, prod fail-closed branches) keys off the same variable, so a NODE_ENV loss fails loudly elsewhere first. Note-level.
2. **Dev-only default admin password** in migrate.ts:3372 (`ADMIN_PASSWORD || <literal>`): production **refuses to seed** without `ADMIN_PASSWORD` (migrate.ts:3363-3368, fail-loud). This is census `hardcoded_secret_like` #3 — adjudicated: dev/staging convenience default, not a production credential, and the literal is hashed at seed time (never stored in cleartext).

---

## Census adjudications (charter item: 4 hardcoded_secret_like, 31 eval_like repo-wide)

| # | Site | Verdict |
|---|------|---------|
| 1 | `backend/src/lib/copilot/__tests__/secret-scan.test.ts` — fake postgres/redis/AKIA/JWT strings | Test corpus proving the outbound scanner; deliberately + file-exactly allowlisted in `.gitleaks.toml`. Not a credential. |
| 2 | `backend/src/lib/__tests__/jwt-admin-secret.test.ts` — STRONG_SESSION/STRONG_ADMIN (32+ chars) | Synthetic values sized to pass the ≥32-char boot validation. Not credentials. |
| 3 | `backend/src/migrate.ts:3372` — default admin password literal | Dev-only; production refuses to seed without ADMIN_PASSWORD (see H-5.2). |
| 4 | `backend/src/lib/__tests__/telegram-auth.test.ts:12` — BOT_TOKEN fixture | Self-labeled "not-real-do-not-reuse"; same fake token family used across telegram tests. |

eval_like in MY files: `TelegramLoginButton.tsx:10` — a **comment** explaining why the widget script is bypassed (its internal eval breaks CSP); `copilot/rate-limit.ts:103` — `client.eval(LUA_SCRIPT)` is **Redis Lua EVAL of a constant script**, not JS eval. Repo-wide remaining eval_like sites (Redis `.eval` in boot-migrations.ts, jsdom type decls, test files) are owned by other lanes; none is a JS-eval sink in production code (verified by targeted grep: zero `eval(`/`new Function(` in non-test source).

## Hunt results (verified clean — evidence, not assurance)

- **SQL injection:** zero non-parameterized user-input queries. All `sql\`\`` templates bind via Drizzle parameter interpolation; every `sql.raw` site interpolates internal constants only (retention job table names from hardcoded specs, test TRUNCATE table list — backend/src/jobs/*, test/db.ts:554). Drizzle `eq/and` used everywhere user input reaches a predicate.
- **XSS:** zero `dangerouslySetInnerHTML` / `innerHTML=` sinks in frontend/src + backend/src (grep). Server error strings render as React text nodes (WhatsAppPhoneSignIn error funnel — safe). CSP prod: no unsafe-inline/unsafe-eval scripts (helmet-config.ts:55-72).
- **SSRF:** every backend `fetch` target is env/config-derived (telegram API + bot token from env/DB, OpenWA `config.baseUrl`, copilot LLM `args.baseUrl`) — no user-controlled URL reaches a fetch. Frontend navigations go to fixed hosts (oauth.telegram.org with server-parsed numeric bot_id) with same-origin-guarded redirect params (TelegramLoginButton.tsx:91-102, telegram-callback.tsx:109-120).
- **Weak randomness:** OTP = `crypto.randomInt` (CSPRNG); session sids/admin sids = `randomUUID`/`randomBytes`; referral codes = `randomBytes`; argon2id salt internal. The only `Math.random` in an auth-adjacent path is the frontend idempotency-key fallback, explicitly documented as a non-secret collision token with CSPRNG preferred (idempotency.ts:103-127). All timing-sensitive compares use `timingSafeEqual` (Telegram HMAC, OTP hash, socket).
- **Rate-limit coverage on OTP/login/checkout:** complete — authLimiter 10/15min/IP on firebase session+refresh, admin login, telegram, whatsapp/verify (successes counted — SMS-bomb closed); whatsappStartAuthLimiter 20/15min (CGNAT); OTP per-phone 60s/5-per-hour/5-attempts + global daily cap; money-intent limiters 12/min on POST orders/wallet-topups/loyalty-convert; coupon enumeration 10/min per user with /56 IPv6 collapse; body limit 1mb. No uncovered auth surface found.
- **CSRF/CORS/CSP/cookies:** CSRF Origin gate on all mutating methods in all envs (fail-closed shapes documented + tested); CORS exact-origin + ACAC only on allowed origins; CSP reviewed above; cookies httpOnly+secure(prod)+lax(prod) on both tokens; logout clears with matching attributes.
- **Session storage:** `sessions`/`admin_sessions` rows store id/user/UA(≤255)/IP(≤45)/expiry only — no tokens, no secrets; retention prune jobs bounded.
- **Supply chain:** all GitHub Actions SHA-pinned (ci.yml + docker.yml, incl. gitleaks-action v2.3.9 + GITLEAKS_VERSION 8.27.2 pin); `permissions: contents: read` default with per-job opt-ins only where needed (security-events:write for SARIF, packages:write only on push jobs); `persist-credentials: false` on every checkout; lockfile `9.0` with 1,410 integrity hashes, `--frozen-lockfile` in both CI and Docker (manifest↔lockfile drift = build failure); Dockerfile digest-pinned base + `USER node` + sources excluded from runtime image; `.gitleaks.toml` allowlists audited — narrow, file-exact, version-matrix-documented, with 3 history-only commits pinned by SHA and rotation runbook referenced.
- **Admin-vs-customer separation:** admin tokens signed with a distinct secret (boot-enforced inequality), rejected by `verifyUserToken` (test-pinned); user tokens cannot verify as admin; 2FA temp token rejected at both HTTP and WS gates; scope-gated admin-alerts room reconciles live on WS re-verify; customer routes all live under `/api/*` routers with `requireUser` — no shared mount where a user token reaches an admin surface.

## Missing tests (charter item — beyond H-1)

- Covered boundaries: session revocation (auth-sessions, auth-probe-revocation), CSRF gate (csrf-gate.test.ts, telegram-callback-csrf.test.ts), CORS gate (cors-origin-gate.test.ts), RBAC composition (rbac-composition.test.ts), admin lockout (admin-auth-lockout.test.ts), socket temp-token/identity (socket-auth, socket-admin-temp-token), OTP crypto/caps (whatsapp-otp, auth-whatsapp-*), horizontal authz for cart/sessions/notifications.
- **Not covered:** H-1's four money-read surfaces; frontend has no test for TelegramLoginButton / auth-callback / telegram-callback pages (component logic incl. the guarded redirect parser is untested — the guard regex behavior is duplicated across 3 files with no pin; a regression in any copy ships silently).

## Not checked / BLOCKED

- `pnpm audit` full (dev deps) — intentionally out of scope (`--prod` per charter); ran successfully, network NOT blocked.
- OpenWA external image internals (one-gateway-per-credential invariant) — outside this repo by charter (external `ghcr.io/ahmadmedo1012/openwa`).
- Live runtime probing of cookies/headers (would require prod traffic) — static truth only; deploy/env.compose.example reviewed for env shape but Coolify's actual env values are operator-only (.hermes.md boundary).
- `routes/admin/auth.ts` lines 201-994 (2FA verify, change-password, profile) and `wallet.ts`/`orders.ts` handler bodies beyond the auth-relevant ranges — read as targeted spot-verifications, primary ownership sits with the routes/DB lanes.
