> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r98/security.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R98-A4 — Security Deep Audit (JWT/CSRF/CORS/cookies/admin/rate-limit/sanitization/secrets/openwa/headers/timing)

Agent: R98-A4 (security deep audit, read-only)
Date: 2026-09-20 (post final-deep-audit-2026-09-20, HEAD 4d2dbf1 era)
Scope: SubNation2 (backend + frontend + shared) auth/security surface; sibling repo `openwa` — dashboard/API-key auth only.
Method: static code reading only. Every claim below was verified against the cited file:line. No tests executed, no network calls, no modifications.

---

## Verdict

No P0, no P1. The auth/security core has already absorbed five hardening rounds and is in genuinely strong shape: HS256 pinned on every verify, fail-fast secret validation, row-backed revocation on both user and admin surfaces, an exact-origin CSRF gate that fails closed, a CF-validated client-IP pipeline feeding every limiter/lockout/audit row, argon2id, timing-safe compares on every static credential (admin password, TOTP path lockouts, OTP hashes, Telegram HMACs, metrics token, openwa X-API-key, openwa dashboard login), no `dangerouslySetInnerHTML`/`innerHTML` anywhere in the frontend, no committed env files, and a redaction-aware logger. The findings below are one P2 (header parity gap on the Vercel deployment — matters for the pending cutover) and six P3 hardening/consistency items.

Prior-round closures were re-verified and are NOT re-reported: sourcemap exposure + build guard, openwa OPENWA_CREDENTIALS_KEY separation (persist.ts:32-59 — distinct key, backward-compatible legacy decrypt, re-key path), gitleaks CI (fixtures space-separated; .gitleaks.toml), csrf-gate spacing (the custom admin-jwt-secret rule requires 32+ consecutive chars — unaffected by spacing).

---

## Findings

### [P2] Vercel-served SPA ships without CSP, HSTS, and COOP — the header set exists only on the Render-served HTML
- **Where:** `vercel.json:6-27` (headers: X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, Cache-Control — **no** `Content-Security-Policy`, **no** `Strict-Transport-Security`, **no** `Cross-Origin-Opener-Policy`); `backend/src/app.ts:151-266` (helmet CSP + HSTS 2y preload + COOP `same-origin-allow-popups` — applies only to responses served by the Express app, i.e. the Render origin / current `subnation.ly → Render` path).
- **Evidence:** The Vercel deployment (`subnation-seven.vercel.app`, live; `vercel.json` framework `null`, output `frontend/dist/public`) serves `index.html` with only the vercel.json header set. `frontend/index.html` contains no CSP meta tag. The full CSP (script-src self + Firebase/GA/recaptcha hosts, object-src none, frameSrc, workerSrc blob:…) and HSTS live exclusively in the backend helmet config, which never sees a request served by Vercel.
- **Attack scenario:** On the Vercel origin there is no CSP mitigation at all: any injected inline script, third-party script, or compromised dependency executes unrestricted (the SPA holds an in-memory user JWT and admin PII in the query cache). No HSTS means an first-visit http→https interception (SSL-strip) on the vercel.app host is not pre-empted. This becomes the **canonical** exposure the moment the operator switches `subnation.ly` from Render to Vercel (the documented pending action) — at that point the site loses CSP+HSTS+COOP entirely.
- **Fix (minimal):** Mirror the app.ts helmet header set into `vercel.json` `headers` before the cutover: `Content-Security-Policy` (copy the app.ts directives, minus trusted-types — same caveat documented there), `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `Cross-Origin-Opener-Policy: same-origin-allow-popups`. Keep `X-Frame-Options: DENY` (already present, stricter than the backend's sameorigin — fine).

### [P3] User-scoped `loyalty`/`support` and most admin data surfaces lack `Cache-Control: no-store` (inconsistent with the A7/round-94 pattern)
- **Where:** `backend/src/routes/loyalty.ts` (router-level: none), `backend/src/routes/support.ts` (none), admin data routers `admin/orders.ts`, `admin/users.ts`, `admin/topups.ts`, `admin/tickets.ts`, `admin/referrals.ts`, `admin/alerts.ts` (reads only). Contrast: `orders.ts:23-24`, `wallet.ts:24-25`, `cart.ts:12-13`, `notifications.ts:12-13` all set `no-store` via `router.use`; `admin/auth.ts:258` (probe) sets `private, max-age=0, no-store`; `admin/observability.ts:151` sets no-store.
- **Evidence:** grep for `Cache-Control` across `backend/src/routes` — only the files above have it (plus public products/seo/health caching).
- **Attack scenario:** Authenticated PII (loyalty balances, ticket threads, admin order/user lists) returned without `Cache-Control` can be heuristically cached by an intermediary (corporate/shared proxy) or, with the strong ETags the app sets (`app.ts:283`), retained by back-button cache contexts. Practical risk is low (no `Last-Modified`, Cloudflare does not cache `/api` JSON by default), but the A7 fix itself documents why user-scoped surfaces should carry explicit `no-store`.
- **Fix:** Add the same one-line `router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();})` to `loyalty.ts`, `support.ts`, and the admin data routers (or centrally for all `/api` responses that pass `requireUser`/`requireAdmin`).

### [P3] User JWT is still returned in the JSON body by 4 auth routes (admin side closed this in R97-02)
- **Where:** `backend/src/routes/auth.ts:518-524` (`/firebase/session` returns `token`), `auth.ts:615-618` (`/firebase/refresh`), `routes/auth-whatsapp.ts:229-232` (`/whatsapp/verify`), `routes/auth-settings.ts:867` + `:909` (`/telegram`, `/telegram/webapp`). Frontend holder: `frontend/src/lib/auth.tsx` (token state) → `frontend/src/lib/auth-token-holder.ts:22-33` (module-level in-memory) → Bearer via `customFetch`.
- **Evidence:** The httpOnly cookie is the declared primary transport (`res.cookie` on the same routes); the body `token` is the legacy dual transport. The admin surface removed its body token in R97-02 (`routes/admin/auth.ts:139-150` — comment documents exactly this XSS-surface rationale).
- **Attack scenario:** Any XSS during an active session (or a malicious browser extension) can read the 30-day credential from JS memory (`auth-token-holder`), not just the response body. No localStorage exposure exists (verified: zero token writes to local/sessionStorage — only theme/cart/search/idempotency keys). This is a documented/accepted tradeoff (specs/004 research: "localStorage holds no auth-bearing values"), but it is asymmetric with the admin fix.
- **Fix:** Mirror R97-02: stop returning `token` in the body (the cookie + `__cookie_session__` sentinel already drive the SPA), or at minimum have `setToken` accept the sentinel-only flow and drop the Bearer mirror for user routes.

### [P3] Admin login username-existence timing oracle
- **Where:** `backend/src/routes/admin/auth.ts:87-92` — when the username is not found, the route replies 401 **without** running argon2; when the user exists, `verifyPassword` (argon2id 64 MiB, 3 iterations — `lib/crypto.ts:11-16`) adds ~50-150 ms.
- **Evidence:** Both paths return the identical body (`اسم المستخدم أو كلمة المرور غير صحيحة`) — the response envelope is uniform, but the wall-clock delta is the classic enumeration signal.
- **Attack scenario:** A remote attacker measuring response time distinguishes valid admin usernames from invalid ones. Practical exploitability is capped by `authLimiter` (10/15 min/IP, app.ts:808), the DB-backed lockout keyed `admin:<username>:<CF-validated-IP>` (5 fails → 15-min lock with exponential backoff), and the fact that this deployment has one operator account. Still a cheap fix.
- **Fix:** On the `!admin` branch, run `verifyPassword(password, DUMMY_ARGON2_HASH)` (a pre-computed hash of a random string) before returning, so both branches pay the argon2 cost. (Same pattern already applied on the openwa dashboard — `openwa/src/dashboard.ts:134-141` compares both fields timing-safely.)

### [P3] Legacy SHA-256 password fallback with static salt and non-constant-time compare
- **Where:** `backend/src/lib/crypto.ts:22-38` — hashes not starting with `$argon2` fall back to `sha256(password + "subnation_salt")` compared with `===`.
- **Evidence:** Any pre-argon2 admin row still hashed this way is trivially crackable offline (static salt, fast hash) and the comparison is not timing-safe. `needsRehash` migrates it on next **successful** login, but a row that never logs in stays weak forever; the fallback has no expiry.
- **Attack scenario:** Conditional — requires (a) a legacy row to still exist in `admin_users` and (b) a DB/hash leak. Nothing in the live deployment indicates such a row (the seed path uses argon2 — `migrate.ts:1652`), so this is hygiene, not an active hole.
- **Fix:** Remove the fallback at the next breaking window and force a password reset for any row whose hash does not start with `$argon2` (fail login with "reset required"); or at minimum log a loud security warning when the legacy path validates.

### [P3] CORS preflight responses are not cacheable (no `maxAge`)
- **Where:** `backend/src/app.ts:374-383` — `cors({ origin: [...], credentials: true })` with no `maxAge` option → no `Access-Control-Max-Age` header on OPTIONS.
- **Evidence:** Every cross-origin browser request from the Vercel SPA (`VITE_API_BASE_URL=https://subnation2.onrender.com`, render.yaml:75-81; the fetch bridge forces `credentials:"include"` — `frontend/src/lib/api-config.ts:52`) pays a fresh preflight round-trip per browser cache window.
- **Attack scenario:** None (security-neutral). Pure latency on the split deployment; noted because preflight caching is part of the CORS scope checklist.
- **Fix:** `maxAge: 600` in the cors options (preflights are cacheable without security impact since the origin list is static).

### [P3] `POST /api/admin/admins` accepts a free-form `role` string; `requireRole` is dead code that would honor it
- **Where:** `backend/src/routes/admin/admins.ts:115` (`role: role && typeof role === "string" ? role : "admin"` — stored + echoed, no enum validation); `middlewares/requireAdmin.ts:144-154` (`requireRole` — exported, **zero call sites** repo-wide, grepped; grants `super_admin` an unconditional pass).
- **Evidence:** Authorization today is driven exclusively by the permissions array (`lib/permissions.ts:43-49` — `hasPermission` checks `"all"` or the exact scope; every admin mount in `routes/admin/index.ts:39-126` uses `requireAdmin` + `requirePermission`). So a rogue `role` value confers nothing — **no escalation path exists as implemented**.
- **Attack scenario:** Latent only: if anyone ever wires `requireRole(...)` back in (it looks like a legitimate API and even documents `super_admin` bypass), a `role:"super_admin"` string minted through this endpoint becomes a full bypass. Hygiene finding.
- **Fix:** Validate `role` against a fixed enum (`admin` | `super_admin`-if-ever) or drop the field entirely from the create contract; delete or gate the unused `requireRole` helper.

### Informational (no action required, documented for the record)

1. **Admin login success writes no `audit_logs` row** — `routes/admin/auth.ts:41-151` has `writeAuditLog` on logout/password/profile/2FA but not on successful login. The `admin_sessions` row does capture IP+UA+timestamp (`lib/admin-session.ts:44-59`), and failures are recorded in `login_attempts`; if the security panel (`admin/security.ts` auth-activity) is meant to cover admin logins too, add `admin.login` rows.
2. **Dev-only default admin** — `migrate.ts:1641-1655` seeds `SubNation@2026` when `ADMIN_PASSWORD` is unset **outside production**; production refuses to boot the seed (error log, no insert). Correct posture; listed so nobody "fixes" the dev convenience without knowing it is intentional.
3. **SameSite=None in production is a deliberate, gated tradeoff** — render.yaml:68-69 sets `AUTH_COOKIE_SAMESITE=none` because the SPA (subnation.ly / vercel.app) calls the API cross-origin on `subnation2.onrender.com`; the Origin/Referer CSRF gate (app.ts:679-798) is the CSRF barrier, with the SEC-92-01 boot assertion + runtime fail-closed branch if the allow-list is ever empty. Tradeoff documented as designed.
4. **`requireUser`/`/api/auth/probe` fail OPEN on session-row DB probe errors** (requireUser.ts:71-81, auth.ts:383-391) — JWT signature is still cryptographically valid; the 60 s row cache bounds revocation latency. Documented posture, acceptable.
5. **express-rate-limit MemoryStore** (Redis absent in prod per render.yaml) — v8 sweeps expired keys on an interval; the openwa limiter sweeps every 60 s (`openwa/src/rate-limit.ts:309-326`) and the dashboard lockout map every 10 min (`openwa/src/dashboard.ts:145-151`). Bounded.

---

## Scope verification (what was checked and found correct)

### 1. JWT / session
- `backend/src/lib/jwt.ts:111` — **every** verify pins `algorithms: ["HS256"]` (user, admin, 2FA temp, metrics, socket). No `alg: none` surface; jsonwebtoken 9 confusion class closed.
- `jwt.ts:4-20` — `SESSION_SECRET` fail-fast at boot if missing or < 32 chars. `jwt.ts:55-101` — `ADMIN_JWT_SECRET` is a distinct env var in production (fail-fast, ≥ 32 chars, **rejected if equal to SESSION_SECRET**); non-prod falls back to `SESSION_SECRET + "_admin"` with a loud deprecation warning (dev-only path, documented for removal).
- TTLs: user JWT 30 d (`jwt.ts:104`, cookie maxAge 30 d, `SESSION_TTL_MS`); admin 8 h (`jwt.ts:145`, `admin-session.ts:30`); 2FA challenge token 10 min (`routes/admin/auth.ts:122-125`).
- **Logout/revocation is real, not stateless-accepted:** user logout deletes the `sessions` row (`routes/auth.ts:48-54`) and `requireUser` re-checks the row per request with a 60 s cache (`middlewares/requireUser.ts:52-70`); logout-all deletes every row (`auth.ts:106`); `/api/auth/probe` enforces the same (`auth.ts:373-392`). Admin: token carries `sid`, `requireAdmin` validates the `admin_sessions` row (revoked/expired → 401) and **fail-closes on sid-less tokens in production** (`middlewares/requireAdmin.ts:75-101`); logout revokes the row, password-change revokes all rows (`routes/admin/auth.ts:376-386, 465-472`); socket identity is re-verified every 5 min against the same rows (`lib/socket.ts:19-32, 108-111`).
- **Frontend storage:** httpOnly cookie is the transport; the JWT never touches localStorage/sessionStorage (verified by grep — storage keys are theme/cart/search/idempotency/alert-id/cwv only). In-memory copy in React state + `auth-token-holder.ts` module variable; `__cookie_session__` sentinel for cookie-authenticated boots (`auth.tsx`). Admin: body token removed (R97-02), `admin_token` httpOnly cookie only, temp 2FA token in React state only. XSS/CSRF tradeoff as implemented: cookie + Origin gate + SameSite=None(prod); bearer mirror exists for the user side only (see P3 #3).

### 2. Cookies
- Every issuance path uses `getAuthCookieOptions` (`lib/cookie-options.ts:12-20`): `httpOnly: true`, `secure: NODE_ENV === "production"`, `sameSite: env (prod=none per render.yaml)`, `path: "/"`, maxAge param. Verified at all 8 `res.cookie` sites: `routes/auth.ts:514, 611`, `routes/auth-whatsapp.ts:225`, `routes/auth-settings.ts:864, 906, 970`, `routes/admin/auth.ts:139, 228` (admin cookie = same options, 8 h; the duplicate `httpOnly/secure` keys at admin/auth.ts:35-38 are redundant but harmless).
- All 4 `clearCookie` sites mirror issuance options (`auth.ts:81, 123, 159`, `admin/auth.ts:383`) so removal matches name/path/sameSite.
- Cookie names `auth_token` / `admin_token` — distinct, no session-collision; openwa dashboard uses `openwa_dash` (own host anyway).
- Proxy: `app.set("trust proxy", 1)` (app.ts:269) set before `cloudflareClientIp` (app.ts:294) — secure-flag and `req.ip` resolution are correct behind the Render edge; `CF-Connecting-IP` is honored only when the rightmost XFF peer is a published Cloudflare range (middlewares/cloudflareClientIp.ts:182-211), so a forged header on the always-reachable `onrender.com` origin cannot spoof `req.ip`.

### 3. CSRF gate
- Global mount before all routes (app.ts:800). Applies to POST/PUT/PATCH/DELETE. Exact-origin matching via `new URL()` protocol+host comparison (app.ts:730-738) — no substring/startsWith bypass. Cookie-bearing requests with **neither Origin nor Referer are 403'd** (app.ts:747-754). Empty allow-list in production: boot aborts (SEC-92-01, app.ts:103-114) AND the runtime branch fails closed for cookie requests (app.ts:765-794).
- **Mutating-route enumeration (all verified):** every non-skip POST/PUT/PATCH/DELETE under `/api` is behind the gate. Exemptions, each with its justification in code:
  - `/api/auth/firebase/session`, `/api/auth/firebase/refresh` — Firebase ID-token signature is the credential (app.ts:686-695); the route reads `currentUserId` from the Authorization header only, never from the ambient cookie (auth.ts:442-446) — no cookie-assisted account-link CSRF.
  - `/api/cwv` — `navigator.sendBeacon` (no Origin on most browsers); beacon body is schema-validated, label-cardinality-bounded (routes/cwv.ts:29-101) and IP-limited by apiLimiter.
  - `/api/webhook/*` — Telegram secret-token HMAC gate + admin-ID allowlist (routes/telegram-webhook.ts:166-177, 81-95).
  - `/health` — probes; health routes are GET-only (grep verified).
- No double-submit/synchronizer token exists — the Origin/Referer gate plus SameSite is the design (documented in app.ts:86-99 as the ONLY barrier under SameSite=None). This is the accepted architecture; per instruction, csrf-gate hardening from prior rounds is not re-reported.

### 4. Admin protection matrix — see summary table at the end. Highlights:
- `routes/admin/index.ts:39` — `protectedRouter.use(requireAdmin)`; every sensitive sub-router additionally gated by `requirePermission(scope)`.
- The two routers mounted at the admin root outside `protectedRouter` are self-guarded: `admin/auth.ts` (login/verify-2fa public-by-design with lockout+limiter; everything else inline `requireAdmin`) and `admin/stats.ts:27, 84` (inline `requireAdmin`).
- `requireAdmin` rejects 2FA temp tokens (V1-CRITICAL closure), validates the session row, re-checks `is_active`, and refreshes permissions from the DB per request (middlewares/requireAdmin.ts:28-135).
- **Mass assignment:** `PATCH /api/admin/users/:id` accepts ONLY wallet/loyalty/note fields (routes/admin/users.ts:136-137) — no role/identity reach; `PATCH /api/admin/admins/:id` only displayName+permissions with the "all"-grant escalation guard (admins.ts:23-26, 104-106, 190-192) + last-admin guard + enable-`all` re-enable guard (admins.ts:289-312). Storefront has no user profile-update route at all (onboarding only writes flags — auth.ts:721-730).
- Audit logging is present on all money/identity admin writes (see grep list: topups approve/reject, products create/update/archive/inventory, variants, flash-sales, users wallet/loyalty, admins create/update/disable/enable, pricing, risk rules/config/labels, whatsapp sessions, settings auth-provider, 2FA/password/profile) — gap noted informationally for admin login success.

### 5. CORS
- Allowed origins: `APP_ORIGINS, FRONTEND_ORIGINS, VERCEL_FRONTEND_ORIGIN` parsed exact (trailing slashes trimmed) in `lib/origins.ts` — production values in render.yaml: `https://subnation.ly, https://www.subnation.ly, https://subnation-seven.vercel.app`.
- A pre-gate 403s any disallowed Origin before the cors middleware (app.ts:338-373); empty list in production → 403 (fail-closed, defense-in-depth under the boot assertion). `credentials: true` with a **plain array** — never `*`, never a callback reflecting arbitrary origins. Socket.IO handshake uses the same exact-match allowlist (lib/socket.ts:170-175). Preflight caching is the one gap (P3 #6).

### 6. Rate limiting
- Layers: `apiLimiter` 600/min/IP unauthenticated (skips authed traffic), `userLimiter` 1200/min/userId (JWT-verified, memoized per request — app.ts:435-521), `authLimiter` 10/15 min on firebase session/refresh, admin login + verify-2fa, telegram callback + webapp (app.ts:804-814), `whatsappStartAuthLimiter` 20/15 min (app.ts:550-559), `couponValidateLimiter` 10/min keyed user-then-IPv4/56 (app.ts:580-602), support ticket create/reply limiters (routes/support.ts:109, 208), openwa 240/min general + 60/min sends + 5/h pair-code.
- Key extraction: `req.ip` — trust-proxy-1 resolution overridden by CF-validated `CF-Connecting-IP` (see §2). Default `ipKeyGenerator` (IPv4 passthrough, IPv6 /56 or /64) prevents address-cycling. Anonymous coupon fallback explicitly delegates to `ipKeyGenerator(req.ip)` (SEC-92-04).
- Brute-force caps on credentials: DB-backed lockout with 5-fail threshold and exponential backoff (lib/lockout.ts:65-89) keyed `admin:<username>:<CF-IP>` (login, R97-01 fixed the raw-header forging), `admin-2fa:<id>`, `admin-pwchange:<username>`, `admin-2fasetup:<username>`; OTP: 60 s cooldown + 5/hour/phone + 5 attempts/code + consume-on-success (lib/whatsapp-otp.ts:36-42; service layer).
- Store bounds: MemoryStore (v8 internal sweeping) or the resilient Redis store with per-command 500 ms timeouts and fallback cooldown (lib/rate-limit-store.ts) — no unbounded growth vector found; Redis is intentionally absent in prod (render.yaml:279-286) with documented degradation.

### 7. Stored-input sanitization / XSS
- **Zero** `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, or `document.write` in `frontend/src` (grep). React auto-escaping covers product names/descriptions/features, admin-entered content, user display names, order data.
- Server-rendered HTML (OG share cards) escapes name/description/image URL (app.ts:909-914, applied at 926-937).
- Telegram delivery: `parse_mode: "HTML"` + `escapeTelegramHtml` on all user-controlled fields (routes/wallet.ts:289-301, lib/telegram.ts:509); the webhook's `/start` reply uses Markdown but interpolates only numeric IDs it just echoed from Telegram's own payload (routes/telegram-webhook.ts:202-213); `editMessageText` on callback re-sends the bot's own prior text without parse_mode (no injection).
- Error responses: global handler returns localized strings only (app.ts:982-1013); ZodError details carry field paths/messages, not raw values; openwa returns generic error codes (`check_failed`, `pair_code_failed`) — no stack traces anywhere (grep for `err.message` in openwa responses: only client-side toast code).
- **No file-upload endpoints exist** (no multer/busboy/formidable — grep). "Inventory upload" is a parsed text paste with GCM encryption at rest (routes/admin/products.ts:625-637).

### 8. Secrets hygiene
- No `.env` committed — `git ls-files` shows only `frontend/.env.example`; `.gitignore` excludes `/.env*`, `frontend/.env` (only `.example` allowed). `config/env.example` contains placeholders only.
- Gitleaks CI + `.gitleaks.toml` in place (prior round, verified present).
- Source grep for hardcoded credential patterns: all hits are test fixtures (space-separated gitleaks-hardened values) — excluded per scope.
- No VAPID keys / web-push anywhere (grep: zero hits).
- JWT secrets: no dev-secret fallback in the production path — boot throws (jwt.ts:6-20, 74-84). Dev-only derivation fallback for ADMIN_JWT_SECRET is loud + non-prod only.
- Logging: pino redact list covers passwords, all token transports, totp_secret, api keys, bot tokens, nested `body.*`/`req.body.*` paths + one-level wildcards (lib/logger.ts:69-163, tests pin it). pino-http serializers emit only method+status (app.ts:642-655). The Telegram approval fetches log only status codes (wallet.ts:320-323).

### 9. openwa (auth/headers only, per scope)
- **API key:** `requireKey` uses `timingSafeEqual` with length guard (src/index.ts:481-492) — not `===`. 401 generic. Key required at boot (index.ts:87-89 — "refusing an open relay").
- **Dashboard (/):** username+password, **both compared timing-safely** (dashboard.ts:134-142); brute-force lockout 5 fails/15 min → 15-min lock keyed on the **last** XFF entry (Render-appended, not client-forgeable — dashboard.ts:99-109) with a 10-min sweep bounding the map; session cookie HMAC-SHA256-signed (verify: timingSafeEqual, dashboard.ts:66-79), httpOnly, SameSite=Lax, Secure-in-prod, 12 h TTL; CSRF backstop validates Origin host === request host on non-GET /dash (index.ts:599-615); dashboard secret falls back to scrypt(API_KEY) memoized (CPU-DoS fix, dashboard.ts:33-48).
- **Rate limits:** mounted BEFORE the key gate so key-guessing is IP-bounded too (index.ts:632); sliding-window store swept every 60 s (rate-limit.ts:318-340).
- **Headers:** CSP (default-src none + self scripts with escaped-only dynamic values), X-Frame-Options DENY, nosniff, Referrer-Policy no-referrer, no-store on dynamic pages, `x-powered-by` disabled (index.ts:503-523). `express.json({ limit: "256kb" })` (index.ts:524). Session-name regex `[A-Za-z0-9-]{3,50}` blocks HTML injection into the QR page (index.ts:666). No stack leaks in any error response.

### 10. Header audit (SubNation)
- Render/Express: full helmet CSP (Firebase/GA-compatible), HSTS 2 y preload+includeSubDomains, COOP same-origin-allow-popups, X-Content-Type-Options, XFO sameorigin, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy default-deny (app.ts:143-265). SPA fallback + sw + robots: no-cache/no-store (app.ts:856-865, 956).
- Vercel: nosniff + XFO DENY + Referrer-Policy + Permissions-Policy + no-cache on non-assets, 1 y immutable on /assets (vercel.json) — **CSP/HSTS/COOP missing** (the P2 above).
- Authenticated API caching: no-store on orders/wallet/cart/notifications (+ admin probe/observability), `private, max-age=30` on /me and /probe, public caching only on products/seo/healthz — gaps are P3 #2.

### 11. Timing attacks / password policy
- Password hashing: **argon2id** (64 MiB / t=3 / p=1, lib/crypto.ts:11-16) with `needsRehash` self-migration. OTP: HMAC-SHA256 bound to (code, phone, purpose) + `timingSafeEqual` (lib/whatsapp-otp.ts:67-92). TOTP verify via otplib with per-admin lockout (auth.ts:196-218). Metrics token: constant-time (routes/metrics.ts:13-20). Telegram widget + WebApp: HMAC verified with `timingSafeEqual` + freshness windows (lib/telegram-auth.ts:100-123, 264-281). Webhook secret: constant-time (telegram-webhook.ts:34-39). openwa: constant-time on key, username, password, cookie signature.
- User enumeration: admin login has the timing delta (P3 #4) but a uniform 401 body; WhatsApp `/start` does not reveal registration state (find-or-create happens on verify; recipient_not_on_whatsapp is a WhatsApp-network fact, not an account oracle); `/api/coupons/validate` 404/200 oracle is explicitly capped at 10/min (app.ts:561-580).
- Password policy: admin min 8 chars at create + change (admins.ts:97-99, auth.ts:421); no complexity/breach-list requirements (acceptable for a single-operator admin, noting it).

---

## Admin-protection matrix (route → guard status)

| Route (under `/api`) | Auth guard | Scope gate | Audit log | Status |
|---|---|---|---|---|
| POST /admin/login | public (by design) + authLimiter + DB lockout (IP+username) | — | login_attempts rows | ✅ |
| POST /admin/login/verify-2fa | public (temp token) + authLimiter + per-admin 2FA lockout | isTemp verified, is_active re-checked | — | ✅ |
| GET /admin/probe | 200-always probe; sid-row validated; temp rejected; no-store | — | — | ✅ |
| GET /admin/session | requireAdmin | — | — | ✅ |
| POST /admin/logout | requireAdmin | — | admin.logout | ✅ |
| POST /admin/change-password | requireAdmin + old-password + lockout | — | pass. changed/failed | ✅ |
| PATCH /admin/profile | requireAdmin + old-password | — | profile changed/failed | ✅ |
| POST /admin/2fa/setup · /2fa/verify-setup | requireAdmin + password-re-entry when disabling | — | totp enabled/disabled/failed | ✅ |
| GET /admin/stats · /admin/chart-data | requireAdmin (inline) | — | — (reads) | ✅ |
| /admin/topups/* (approve/reject/list) | requireAdmin | finance | topup.approve/reject | ✅ |
| /admin/products/* + inventory | requireAdmin | inventory | product.create/update/archive/inventory.* | ✅ |
| /admin/products/:id/variants/* | router.use(requireAdmin) | inventory (parent mount) | product.variant.* | ✅ |
| /admin/pricing/config · /recompute · /calculate | requireAdmin (router-level or inline) | inventory | pricing.config.update/recompute | ✅ |
| /admin/flash-sales/* | requireAdmin | inventory | flash_sale.create/update/deactivate | ✅ |
| /admin/orders/:id/status · /bulk-status · bulk-refund | requireAdmin | orders | order.bulk_* | ✅ |
| /admin/users (list) · PATCH /admin/users/:id | requireAdmin | users | user.update | ✅ |
| /admin/referrals/* | requireAdmin | users | — (reads + payout action via service) | ✅ |
| /admin/tickets/* (list/reply/status) | requireAdmin | support | — (service-level trail) | ✅ |
| /admin/alerts/* (read/mark/delete/test) | requireAdmin | support | alert.test_dispatch | ✅ |
| /admin/admins (list/create/patch/disable/enable/scopes) | parent mount requireAdmin | admins + "all"-grant guard | admin.created/updated/disabled/enabled | ✅ (role-string hygiene → P3 #7) |
| /admin/security (auth-activity, auth-stats) | requireAdmin | admins | — (reads) | ✅ |
| /admin/settings/* | requireAdmin | settings | settings.auth_provider.update | ✅ |
| /admin/settings/auth (authProviderAdminRouter) | requireAdmin + requirePermission("settings") at mount | settings | — | ✅ |
| /admin/observability/* · /diagnostics/* | requireAdmin | settings | whatsapp.session_* | ✅ |
| /admin/risk/* (events/rules/config/dashboard/synth) | requireAdmin | users | risk.label/rule_update/config_update/synth | ✅ |
| /admin/forecast/* | requireAdmin | inventory | — (reads + run-store) | ✅ |
| /admin/enrichment/* | requireAdmin | inventory | — (run/draft stores) | ✅ |
| /admin/copilot/* (ask/draft/history/settings/previews) | requireAdmin (inline per route + parent) | phase flags + per-tool scopes | copilot audit trail | ✅ |
| GET /api/metrics | requireMetricsAuth (admin JWT or METRICS_ADMIN_TOKEN, constant-time; temp rejected) | — | — | ✅ |
| POST /api/coupons/admin · PATCH · DELETE | requireAdmin + requirePermission("finance") inline | finance | — (coupon rows) | ✅ |
| POST /api/webhook/telegram | Telegram secret-token (constant-time) + TELEGRAM_ADMIN_IDS allowlist | — | logger | ✅ |

No admin route was found that relies on a controller-only role check without the middleware — the single historically flagged pattern (2FA temp token acceptance) is closed at every verifier (requireAdmin, /api/metrics, admin probe, socket).

---

## Counts

- **P0: 0** · **P1: 0** · **P2: 1** · **P3: 6** · Informational: 5

## Files audited (primary)

backend/src: app.ts, lib/{jwt,session,admin-session,session-liveness,cookie-options,origins,crypto,whatsapp-otp,lockout,permissions,audit,logger,rate-limit-store,telegram-auth}.ts, middlewares/{requireAdmin,requireUser,cloudflareClientIp}.ts, routes/{auth,auth-whatsapp,auth-settings,telegram-webhook,metrics,cwv,health,wallet,coupons,support,loyalty,orders,notifications,cart}.ts, routes/admin/{index,auth,admins,users,topups,orders,products,product-variants,flash-sales,alerts,tickets,security,settings,stats,observability,diagnostics,risk,pricing-config}.ts, migrate.ts (seed paths), test/env.ts.
frontend/src: lib/{auth.tsx,auth-token-holder,user-session,admin-session,api-config,socket,firebase-auth}.ts(x), hooks/use-admin-headers.ts, pages/admin/login.tsx, index.html.
shared: api-client-react/src/custom-fetch.ts.
config: vercel.json, render.yaml, .gitignore, .gitleaks.toml, config/env.example.
openwa/src: index.ts, dashboard.ts, rate-limit.ts, persist.ts (key separation re-verified), dashboard-html.ts (escaping spot-check).

## Recommended next actions (priority order)

1. Add CSP + HSTS + COOP to vercel.json **before** the operator flips subnation.ly to Vercel (P2 — the only finding that becomes a real exposure the day the cutover happens).
2. Uniform `no-store` on loyalty/support + admin data routers (P3, one-line each).
3. Dummy-argon2 on the admin-login unknown-username branch (P3).
4. Mirror R97-02 on the four user-auth routes (drop body `token`) or document the accepted tradeoff explicitly in specs/004 (it is currently implicit).
5. Remove the legacy SHA-256 password fallback at the next breaking window; validate `role` in POST /admin/admins and delete the dead `requireRole` helper.
