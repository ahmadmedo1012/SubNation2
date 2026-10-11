# R134-A5 — Security & supply-chain + CI config audit

**Agent:** A5 (security-CI, round 134) · **Repo:** `main` @ `5d5227c`, tree clean
**Scope:** auth surfaces (login/register/refresh, session manager, OTP lock pool, 2FA
setup/verify, password change, credential encryption v2), RBAC middleware + permission
model coherence, CSP/headers vs live, secrets hygiene, supply chain (`pnpm audit` prod +
full vs the accepted register), CI config truth (develop filter, path-filter, impeccable
gate, e2e, gitleaks allowlist, Dockerfile/.dockerignore), rate-limit coverage on
auth+money mutations.
**Method:** full reads of every target file at HEAD; one **empirical Express
composition test** (node script against the repo's own `express@5.2.1`) proving the
RBAC mount semantics; `pnpm audit --prod` + full `pnpm audit --json` parsed; local
`impeccable@4.1.0` gate run (exit-code evidence); 4 read-only GET/HEAD live probes on
`https://subnation.ly` (shell, /api/healthz with hostile Origin, /api/admin/audit-logs,
/api/auth/me — nothing authenticated, nothing mutated, ≤2 hits/endpoint). Read
docs/inspection-r129/B4 + r130/A9 FIRST — inherited-open register respected (CSP
`script-src-attr`, /api/metrics any-scope, admins.ts mount-only auth, copilot
rate-limit fail-open, Cloudflare ratelimit disclosure, security.txt soft-200 — not
re-litigated). Exclusion list respected (A7-F4 body_hash, A8-*, A5-F4 bell, A5-F6
/sw.js.map, Embronic, Cloudflare CDN, inventory loading).
**Read-only:** zero source/config/test modifications, zero git mutations. Only this
report + the worklog append were written. (Sandbox note: this clone's `origin` remote
URL embeds a GitHub PAT — a platform artifact of the audit environment, not a repo
defect; it never entered any file and is not printed here.)

**Verdict: 0 P0 · 0 P1 · 1 P2 · 3 P4.** The auth spine is in excellent shape; the one
structural defect is in the RBAC **enforcement composition** (fail-closed
over-restriction, not escalation). Supply chain is exactly at the accepted register —
zero new prod findings. CI is truthful; the `develop` filter is confirmed inert and
**safe to remove now**.

---

## 1. Findings

### A5-F1 [P2] RBAC enforcement composes CUMULATIVELY — every root-mounted `requirePermission` gate fires for EVERY protected admin request; scoped admins are 403'd by unrelated gates and the R122 subset-grant story is functionally dead at runtime

**Where:** `backend/src/routes/admin/index.ts:44-142` (mounts), `backend/src/lib/permissions.ts:69-85` (gate factory).

**Mechanics.** `protectedRouter.use("/", requirePermission(scope), someRouter)` —
Express `use("/")` is a prefix match on **every** path. The permission middleware
therefore executes for **every request that reaches that layer**, not only for routes
inside the sibling router. The ALL-PATHS gates, in mount order, are:

| admin/index.ts | scope | router behind it |
|---|---|---|
| :49 | `users` | risk |
| :54 | `inventory` | forecast |
| :60 | `inventory` | enrichment |
| :62-66 | `finance` | topups |
| :68-73 | `inventory` | products + variants |
| :74-79 | `inventory` | pricing-calculator + pricing-config |
| :80-84 | `inventory` | flash-sales |
| :91-95 | `users` | users |
| :96-100 | `users` | referrals |
| :102-105 | `support` | tickets |
| :110-114 | `admins` | security |
| :138-142 | `orders` | orders |

(Path-scoped, CORRECT mounts: :108 `/alerts`, :120-124 `/audit-logs`, :126-130
`/admins`, :132 `/settings`, :134 `/observability`, :136 `/diagnostics` — the R127
`/audit-logs` commit shows the intended pattern was already known when it mattered.)

**Empirical proof (repo's own express 5.2.1, simulated composition):** a request to
`/api/admin/orders` traversed **eleven** gates — `users, inventory, finance,
inventory, inventory, inventory, users, users, support, admins, orders` — before the
orders handler ran. In the real tree, `requirePermission` 403s on a missing scope, so
the FIRST unrelated gate terminates the request:

- An `["orders"]`-scoped admin requesting `GET /api/admin/orders` → **403 from the
  `users` gate at :49** — never reaches the orders router.
- An `["users"]`-scoped admin → 403 from the `inventory` gate at :54.
- Net effect: the effective requirement for ANY protected admin route is the
  near-full union **{users, inventory, finance, support, admins, orders}** — only
  `"all"` (or a 6-scope union) works. Every strict subset grant minted through the
  R122 subset-bounded admin UI (orders-only, finance-only, support-only…) is
  completely non-functional: the admin can log in (auth routes are ungated) but
  403s on their own scope's routes.

**Why nobody noticed:** production's sole active admin holds `["all"]`
(`admin/stats.ts:81` documents this, verified live at R126). Every RBAC test mounts
routers **directly with path scoping** — `admins-rbac-subset.test.ts:29-37` even
claims "The mount mirrors production (routes/admin/index.ts:115-119)" while mounting
`app.use("/api/admin/admins", requireAdmin, requirePermission("admins"), …)` — a
shape production does NOT use for the root-mounted routers. The one test that mounts
the full adminRouter (`admin-no-store-stragglers.test.ts`) seeds
`permissions: ["all"]` (:89), so the composition is invisible to the suite. The
R126-A7 RBAC matrix documented the intended per-scope story and never exercised a
scoped admin against the real composition. The mounts pre-date R127 (79e1d23 only
hoisted `requireAdmin` into `protectedRouter.use` — same semantics before and after).

**Security direction:** fail-CLOSED. No privilege escalation, no IDOR, no missing
gate — `requireAdmin` still fronts everything (`protectedRouter.use(requireAdmin)`
:40; copilot leaf routes self-gate; stats self-gates per-route at stats.ts:63/:182).
The harm is model coherence + availability + an operational incentive to hand out
`"all"` (privilege inflation by workaround).

**Fix sketch (effort ~2-4h):** the sub-routers define their own full paths
(`/topups`, `/orders`, …), so the parent mount must stay at `/` for path resolution —
move each gate to a **path-prefixed mount** (`protectedRouter.use("/topups", …)` +
strip the prefix inside the sub-router) **or** (smaller diff) add a
`router.use(requirePermission(scope))` at the top of each sub-router file and delete
the root-mounted gates in index.ts. Either way, add ONE integration test that mounts
the REAL `adminRouter` and asserts: (a) `["orders"]` reaches `/orders` and 403s on
`/topups`, (b) `["users"]` reaches `/users` and 403s on `/orders`. Coordinate with
A1's per-route gating sweep — this is the mount-level twin of their route-level check.

---

### A5-F2 [P4] `requireUser` 401 envelopes ship NO `Cache-Control: no-store` — the user-side twin of the R126 admin fix (A7-F3) never happened

**Where:** `backend/src/middlewares/requireUser.ts:33-45, 57-72` (no Cache-Control anywhere in the middleware) — live-verified: `GET https://subnation.ly/api/auth/me` unauthenticated → **401 with NO cache-control header**, while `GET /api/admin/audit-logs` → 401 + `cache-control: no-store` (the R126 `requireAdmin` entry stamp, requireAdmin.ts:47).

The R122/R123/R126 no-store sweeps covered authenticated user GET bodies (/me,
/sessions, /providers/linked, wallet, orders, …) and the admin middleware's own 401s,
but `requireUser`'s rejection envelopes (every unauthenticated hit on every user
route) still answer bare — the exact "an intermediary must never cache an auth
envelope" argument that fixed the admin side. Lower value than the admin twin (the
body is a generic Arabic 401 with no PII), hence P4. **Fix:** one
`res.setHeader("Cache-Control", "no-store")` at requireUser entry (mirror
requireAdmin.ts:35-47, handlers that set their own value override it verbatim).
Effort: 2 lines + the straggler-test idiom.

### A5-F3 [P4] The CI impeccable gate resolves its engine from the npm registry at run time — version-pinned but not artifact-pinned

**Where:** `.github/workflows/ci.yml:325` — `run: npx -y impeccable@4.1.0 detect frontend/src/`.

The version IS pinned (drift-proof ruleset, per the in-file R127 note) but the
artifact is fetched from the public registry on every run — a compromised
`impeccable` npm package or registry-mirror path would execute inside the `checks`
job. Blast radius is small (job holds `contents: read` only, no secrets, no
persist-credentials — verified :288-291) so this is hardening, not exposure: the
cheapest robust forms are a lockfile-pinned devDependency (`pnpm dlx`-style
resolution through the committed lockfile digest) or an inline SHA checksum verify
before execution. Verified GREEN at HEAD this round (see §6) — the waiver migration
R129-A3 shipped works. Effort: ~30 min.

### A5-F4 [P4] `.dockerignore` lists `.github` twice — dead weight, zero risk

**Where:** `.dockerignore:3` and last line (`.github` appears in both the top block
and the R104 non-build-content block). Harmless duplicate; tidy in the next
docker/config-touching commit. (Noted as dead weight per the mission, not as a defect.)

---

## 2. Auth surfaces — verified clean (negative results, fresh eyes)

1. **Login/register/refresh (`routes/auth.ts`):** cookie is the sole session
   transport — body `token` is the `__cookie_session__` sentinel on every mint
   (:44, :609-615, :714-717; auth-whatsapp.ts:45, auth-settings.ts:155). Logout
   deletes the session row + revokes Firebase tokens + clears the cookie with
   mirrored options (:59-104); logout-all deletes ALL rows first (:119-146).
   `/providers/unlink` validates types+bounds (98-F3), counts OTHER identities
   before refusing the last unlink (:270-299), `.returning()` honest-404 (:313-337).
   `/probe` enforces session-row liveness + ownership + prod sid-less fail-closed
   (:447-483) while keeping the 200-always contract. `/firebase/session` rejects
   phone-provider tokens outright (:549-559), handles link-consent 409 with masked
   hints (:622-647), returns 500 (not 401) on infra errors to avoid refresh loops.
   `/sessions` + `DELETE /sessions/:id` are userId-scoped with honest 404s
   (:800-870, :857-870).
2. **Session manager (`lib/session.ts`):** uniform UUID sid + sessions row + JWT
   carrying `{userId, sessionId}` for ALL channels; insert is best-effort (row
   failure → token still issued → prod requireUser then rejects it: the known,
   r97-documented availability trade, unchanged — not re-reported).
   `session-liveness.ts`: 60 s TTL cache keyed `${sid}:${userId}` (B1-4 ownership
   predicate), opportunistic prune. `requireUser`: fail-closed on invalid/expired,
   fail-open ONLY on DB-probe error (logged loudly), prod rejects sid-less legacy
   tokens (AUD103-3-F5 posture intact).
3. **OTP lock pool (R117) — intact:** `whatsapp-otp.service.ts` takes
   `pg_try_advisory_lock(hashtext('otp-start:'||phone))` on a DEDICATED
   `lockPool` (max 2, never the runtime pool); saturation → honest retryable 429;
   unlock query bounded (F-4 timeout) with destroy-on-stuck so Postgres drops the
   session lock server-side; failure paths fire deduped admin alerts (F-5). Crypto
   module (`lib/whatsapp-otp.ts`): CSPRNG 6-digit codes, HMAC-SHA256 over
   `code:phone:purpose` (domain separation), timingSafeEqual, 5-attempt
   cap/60 s cooldown/5-hour cap/5-min TTL; verify consumes atomically
   (`isNull(consumedAt)` guards, :740-810). Route maps every failure reason to an
   honest status/code (+Retry-After where meaningful) — no code leakage in any
   response body.
4. **2FA (R122 fix intact + no regressions):** `/login/verify-2fa` pins HS256,
   rejects non-temp tokens, re-checks `is_active` (A8-04), per-admin
   `admin-2fa:{id}` lockout (H10) with exponential backoff, otplib v13
   verdict-object check (`.valid`, R118-B1c), decrypt-failure → uniform 401 WITHOUT
   burning the admin's attempt budget. `/2fa/setup` requires password re-auth
   whenever 2FA was ENABLED (93-A1 S5) behind `admin-2fasetup:` lockout; fresh
   enrollment verifies a PRESENT password, never accepts a silently-wrong one.
   `/2fa/verify-setup` shares the `admin-2fa:{adminId}` budget with verify-2fa
   (R122 A5-P2 fix at :938-961 — the 10^6 keyspace is not guessable with an
   abandoned pending enrollment + stolen session). Temp token rejected at every
   downstream gate (requireAdmin.ts:76-83; probe :459-461).
5. **Password change (R126 honesty):** type-guarded body, 8-char minimum, argon2
   re-auth behind `admin-pwchange:` lockout, revokes ALL admin sessions on success
   (A8-01), audit-logged on both outcomes. `/profile` re-auth + bounds aligned to
   the columns (B2-F3) + 23505 → 409.
6. **Credential encryption v2 (`lib/encryption.ts`):** AES-256-GCM, 12-byte IV,
  **strict 128-bit tag** enforced at the single decrypt funnel (W7), v2 prefix
   marking, current→PREV fallback ladder for BOTH generations (R119-B1 unified —
   N-rotation survivable), prev key NEVER used to encrypt, boot fail-fast +
   advisory PREV checks (malformed → warn+disable, PREV==current → warn no-op),
   throttled safeDecrypt warns with redacted fingerprints only. No new defects.

## 3. RBAC model (beyond A5-F1)

`permissions.ts`: exact-match scope check + `"all"` wildcard, no prefix/substring
match — grants remain subset-bounded at mint time (R122 pins in
admins-rbac-subset.test.ts). `requireAdmin`: no-store stamp, cookie-first, HS256
pinned verify, temp-token rejection, sid row enforcement + prod sid-less
fail-closed, live row lookup for is_active + CURRENT permissions (revocation of
scopes takes effect on the next request — no stale-JWT permission window).
Copilot: leaf routes self-gate with requireAdmin + phase + ANY-of scope semantics
(`hasScope` — appropriate for its multi-surface design), refusals audited.
`requireRole` legacy shim still routes through requireAdmin (no bypass). The ONLY
coherence defect is the mount composition (A5-F1).

## 4. Headers/CSP — live vs app.ts parity (probe evidence, 2026-10-11)

Live `https://subnation.ly/` headers match `app.ts:163-290` byte-for-byte in every
security-relevant directive: CSP `default-src 'self'`; `script-src 'self'` + the
Google/Firebase/GA hosts with **no `unsafe-inline`/`unsafe-eval` in prod**
(`app.ts:178`); `script-src-attr 'unsafe-inline'` = the KNOWN inherited register
item (not re-litigated); `object-src 'none'`; `frame-ancestors 'self'` +
`base-uri 'self'` + `form-action 'self'` present via helmet v8 defaults (so the
frame-ancestors question is answered: present, consistent with X-Frame-Options
SAMEORIGIN which remains as belt-and-suspenders); HSTS `max-age=63072000;
includeSubDomains; preload`; `x-content-type-options: nosniff`;
`cross-origin-opener-policy: same-origin-allow-popups`;
`cross-origin-resource-policy: same-origin`;
`permissions-policy: camera=(), microphone=(), geolocation=(), usb=(),
payment=(self), midi=(), accelerometer=()`. Shell + admin 401 + user-401-family
responses carry the security header set uniformly. `cache-control: no-cache,
no-store, must-revalidate` on the SPA shell. CSRF gate live-verified: hostile
`Origin: https://evil.example` → **403** (createCorsOriginGate, app.ts:349-384).
No unsafe regressions vs R130's byte-check. One parity gap: A5-F2 (user 401s).

## 5. Secrets hygiene

- `.gitleaks.toml` unchanged in shape since R130: custom critical rules (Sentry
  DSNs, webhooks, metrics token, Telegram bot token, SESSION_SECRET /
  ADMIN_JWT_SECRET / ENCRYPTION_KEY by env-name + length), the R112 mechanism
  matrix comments, and the **commit-only global allowlist over exactly 3
  historical SHAs** (:305-311) — the one empirically-working shape for the
  full-history dispatch/schedule scans. All 3 SHAs verified to exist in history
  (2 predate this clone's shallow window — CI's `fetch-depth: 0` sees them;
  local shallowness is a clone artifact, not a repo defect). No broadened
  regexes, no new path allowlists.
- Fresh sweep for secret-shaped strings at HEAD: `sk_live_`, `ghp_`,
  `github_pat_`, `xoxb-`, `AKIA…`, `-----BEGIN PRIVATE KEY-----`, live-JWT
  prefixes → **only** intentional test fixtures (copilot secret-scan corpus,
  redaction tests — all path-allowlisted by design). The Firebase web-key
  literal exists ONLY inside `.gitleaks.toml`'s own allowlist entry + a regex
  EXAMPLE in `specs/004-security-audit/research.md:485`; source reads it from
  `VITE_FIREBASE_API_KEY` env. HEAD is clean.

## 6. Supply chain — pnpm audit vs the accepted register

**`pnpm audit --prod`:** `0 critical · 1 high · 2 moderate` — **byte-identical to
the accepted register**: node-forge ≤1.4.0 HIGH (GHSA-86w9-cpqp-85rv, via
firebase-admin@13.9.0, no upstream fix, `recommendation: None`) + uuid <11.1.1
moderate ×2 paths (GHSA-w5hq-g745-h8pq, via google-gax/gaxios). **Delta: ZERO new
prod findings.** The CI block-on-critical gate (`pnpm audit --prod --audit-level
critical`) therefore still exits 0 — truthful.
**Full `pnpm audit`:** `0 critical · 27 high · 16 moderate · 4 low` — ALL in
dev/build chains (vite ≤7.3.4 fs.deny/launch-editor, vitest/@vitest/mocker,
postcss map-loading family, fast-uri ×7, nanoid ×3, browserslist ×2, braces,
extract-zip, tmp, lodash, picomatch, esbuild dev-server, fflate,
baseline-browser-mapping, basic-ftp, source-map-js, sprintf-js, fast-copy) — none
of these ship in the runtime image (R127 manifest-first `--prod --filter
@workspace/api-server...` install; verified Dockerfile:251-254). Policy
(block-on-critical, dev-deps informational) unchanged and still coherent.

## 7. CI config truth (`.github/workflows/ci.yml` full read)

- **`develop` branch filter (:5, :7) — CONFIRMED still present and SAFE TO REMOVE
  NOW.** The repo has exactly one branch (`main`, local + `origin`; `git branch -a`
  evidence) — pushes/PRs to a nonexistent `develop` cannot trigger anything, so the
  entries are inert dead weight, exactly as `.hermes.md:16-19` documents. Removal
  affects no gate, no required check, no schedule (the cron/dispatch triggers are
  branch-independent). The R127-B9 "bundle with a config-touching commit" plan
  never happened; this round's verdict: remove `develop` from BOTH `push` and
  `pull_request` filters in the next ci.yml touch (or standalone — it is a
  2-token, zero-behavior change).
- **Path-filter behavior (docs-only pushes):** correct — `filter` job
  (:117-153) + ALWAYS-ON `secret-scan` (:31-106) run; `checks`/`tests`/`build`
  skip via `needs.filter.outputs.code != 'true'` unless schedule/dispatch
  (:273-276, :379-382, :434-437); `audit` skips on non-dep pushes
  (:195-198). The `code` filter includes `.github/workflows/ci.yml`, Dockerfile,
  docker-compose.yml, tsconfigs — a CI-config-only push still runs the full
  matrix (verified by reading the filter list :136-150). No coverage hole.
- **Impeccable gate — EMPIRICALLY GREEN at HEAD:** local run of the exact CI
  command (`impeccable@4.1.0 detect frontend/src/`) → **exit 0, 0 anti-patterns,
  1 advisory** (radius token note, advisory-only by design). The R129-A3 waiver
  migration into `.impeccable/config.json` (`detector` wrapper + `ignoreValues`
  bounce entry, both repo-root + frontend copies) works; `ignoreRules` stays `[]`.
  R129-A3 F1/F2 confirmed closed.
- **e2e job (:493-528):** dispatch/schedule only (correct — needs a running
  stack); guest read-only suite; `E2E_BASE_URL` from repo variables with a loud
  localhost default; action SHAs pinned (R127 B9 F1/F9 fix intact). The weekly
  heartbeat (R128-IMP-4) rides the same Monday 04:17 UTC cron as the full
  gitleaks-history scan + prod audit — coherent.
- **Action pinning:** all 6 unique actions resolve to full 40-hex SHAs with
  tag comments (checkout v5.1.0, gitleaks-action v2.3.9, codeql upload-sarif
  v4.38.1, dorny/paths-filter v3.0.4, pnpm/action-setup v4, setup-node v5.0.0).
  No moving tags remain. `persist-credentials: false` on EVERY checkout.
  Workflow-level `contents: read`; only secret-scan escalates
  (`security-events: write`, justified for SARIF). `concurrency` +
  `cancel-in-progress` on. Synthetic env values only. **No config drift beyond
  the develop filter; no dead weight beyond it (and A5-F4's dockerignore dup).**
- **Dockerfile/.dockerignore image hygiene:** base digest-pinned
  (`node:22-alpine@sha256:0a71…` with documented bump procedure, :34-36);
  deploy-time `pnpm run typecheck` gate (R122 A9-P0-2, :173); manifest-first
  runtime `--prod --ignore-scripts` install (R127-L4); runtime ships only
  `backend/dist` + `frontend/dist` (sources stay in the discarded build stage);
  `USER node` (F-011); HEALTHCHECK on the public healthz; node direct as PID 1;
  corepack cache deleted in-layer (B10 F4). `.dockerignore` excludes `.git`,
  nested `.env*` (FH-A6), `.secrets`, backups, docs/specs. Image hygiene: no
  truths to report, only the A5-F4 dup nit.

## 8. Rate-limit coverage on auth + money mutations

All limiters (`app.ts:512-659`): apiLimiter 600/min/IP unauth (CGNAT-sized) /
userLimiter 1200/min per verified-userId / authLimiter 10/15min /
whatsappStartAuthLimiter 20/15min (CGNAT split) / couponValidateLimiter 10/min
per-user with IPv6-/56-safe anonymous fallback. Mounts (`app.ts:883-928`):
`/api/auth/firebase/session` + `/refresh` → authLimiter; `/api/admin/login`
(prefix — covers verify-2fa, the 98-F3 double-mount fix) → authLimiter;
`/api/auth/telegram` → authLimiter; `/api/auth/whatsapp/start` → 20/15;
`/verify` → authLimiter; `/api/coupons/validate` → coupon gate; then the blanket
`/api` apiLimiter + userLimiter. **No unthrottled mutation route exists:** every
money mutation (orders/checkout, wallet topups, admin topup approve/reject,
referral credit, loyalty convert, cart, support replies) is requireUser-or-
requireAdmin-gated, therefore inside userLimiter (or the stricter auth gates),
and carries its own DB-backed idempotency (wallet:243, orders idempotency
middleware, admin topups/referrals per R126 matrix) plus per-surface lockouts
(admin login ×2 keys, pwchange, 2fa, 2fasetup, OTP orchestration, orders
credentials per-admin 60/10min volume gate R117). Composition guard pinned by
`limiter-composition.test.ts`. **Clean — no findings.**

---

## 9. Ranked summary

| # | Sev | Title | Evidence | Fix sketch / effort |
|---|---|---|---|---|
| A5-F1 | **P2** | RBAC gates mounted at `/` compose cumulatively — scoped admins 403'd by unrelated gates; subset enforcement dead at runtime (fail-closed) | admin/index.ts:44-142 (12 root-mounted gates); empirical express 5.2.1 traversal; admins-rbac-subset.test.ts:29-37 claims a mirror production doesn't use; sole prod admin holds ["all"] (stats.ts:81) | Move gates to path-prefixed mounts or into each sub-router; add full-adminRouter scoped-admin integration test. ~2-4h |
| A5-F2 | P4 | `requireUser` 401s ship no `no-store` (user-side twin of R126 A7-F3) | requireUser.ts (no Cache-Control); live: /api/auth/me 401 bare vs /api/admin/audit-logs 401 + no-store | 2-line entry stamp mirroring requireAdmin.ts:47. 15 min |
| A5-F3 | P4 | CI impeccable engine fetched from npm at run time (version-pinned, not artifact-pinned) | ci.yml:325; job blast radius contained (contents:read, no creds) | Lockfile-pinned devDep or checksum verify. ~30 min |
| A5-F4 | P4 | `.dockerignore` duplicate `.github` entry | .dockerignore:3 + last line | Tidy in next docker-touching commit. 1 min |

**Confirmed-clean:** auth surfaces (§2), RBAC model below the mount layer (§3),
live headers parity (§4), secrets hygiene (§5), supply chain (§6: prod delta vs
accepted register = ZERO), path-filter/impeccable/e2e/action-pinning/Docker
(§7), rate-limit coverage (§8).
