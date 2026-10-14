# Lane R143-L10 — Security & dependency risk (FRESH audit)

Round R143 · HEAD `528ef39` (tree clean; read-only investigation, zero modifications).
Lens: fresh dependency audit + input/output handling + sensitive-data exposure + secrets
hygiene + crypto assumptions + admin boundary + Docker + supply chain.
Severity: P0=exploitable now · P1=serious exposure · P2=material · P3=meaningful · P4=hardening polish.

---

## H-3 fresh assessment (charter mandate)

**Audit runs (network available, not blocked):** `corepack pnpm audit --prod` executed at
repo root, in `backend/`, and in `frontend/` (all three read the same shared workspace
lockfile → identical output). Result at HEAD `528ef39`:

```
3 vulnerabilities found — Severity: 2 moderate | 1 high
HIGH     node-forge ≤1.4.0   GHSA-86w9-cpqp-85rv  patched: <0.0.0 (NO patch exists)
         path: backend>firebase-admin>node-forge
MODERATE uuid <11.1.1        GHSA-w5hq-g745-h8pq  patched: >=11.1.1
         paths: backend>firebase-admin>@google-cloud/firestore>google-gax>uuid
                backend>firebase-admin>@google-cloud/storage>uuid
```

Identical advisory set to R142's H-3 record — no new advisories appeared, none disappeared.

**Installed versions** (`corepack pnpm list firebase-admin node-forge uuid --depth 2` in
backend + lockfile `rg "^  uuid@" pnpm-lock.yaml`):

| Package | Installed | Verdict |
|---|---|---|
| firebase-admin | **13.9.0** | one minor + a major behind upstream |
| node-forge (via firebase-admin) | 1.4.0 | vulnerable (HIGH) |
| uuid (firebase-admin direct) | 11.1.1 | **patched** — not a vulnerable path |
| uuid (via @google-cloud/storage 7.19.0) | 8.3.2 | vulnerable (MODERATE) |
| uuid (via @google-cloud/firestore 7.11.6 → google-gax 4.6.1) | 9.0.1 | vulnerable (MODERATE) |

**Upstream status (checked live against the npm registry via `corepack pnpm view`):**

1. **node-forge itself: STILL UNPATCHED.** `dist-tags.latest = 1.4.0`, `time.modified
   2026-03-24` — no release since; GHSA-86w9-cpqp-85rv's `patched: <0.0.0` stands.
2. **firebase-admin HAS shipped fixes — H-3's "upstream-blocked" verdict is now STALE.**
   - `firebase-admin@13.10.0` (latest 13.x, a MINOR bump from installed 13.9.0) has
     **removed `node-forge` from its dependency list entirely** (its deps are now
     jwks-rsa/jsonwebtoken/@fastify/busboy/farmhash-modern/google-auth-library… —
     `pnpm view firebase-admin@13.10.0 dependencies` shows no node-forge). The HIGH
     disappears on a minor version bump.
   - `firebase-admin@14.5.0` (latest) additionally moves `@google-cloud/storage` to
     `^8.1.0` (which has **dropped its uuid dependency**) and `@google-cloud/firestore`
     to `^9.1.0` → `google-gax ^6.0.1` (which has **dropped its uuid dependency**).
     On 14.5.0 both MODERATE paths disappear too. (On 13.10.0 the two moderates
     remain — its optional deps still point at storage ^7.19.0 / firestore ^7.11.0.)

**Exploitability in THIS deployment (unchanged from H-3's analysis, re-verified):**
- node-forge is reached only from `firebase-admin/lib/app/credential-internal.js:177-179`
  — `forge.pki.privateKeyFromPem(this.privateKey)`, i.e. parsing OUR OWN service-account
  key (the app boots firebase-admin via `cert()` from `FIREBASE_SERVICE_ACCOUNT_JSON`,
  backend/src/lib/firebase-admin.ts:127). The GHSA is an RSA **signature-verification**
  flaw (nested DigestAlgorithm acceptance); this app never verifies attacker-controlled
  RSA signatures with forge — ID-token verification rides Google JWKS (jwks-rsa +
  jsonwebtoken). Not triggerable by any request input here.
- The uuid buffer-bounds issue needs a caller handing uuid v3/v5/v6 a shared buffer;
  nothing in firebase-admin/google-gax/storage call paths reachable from this app does
  that. Moreover the backend imports only `firebase-admin/auth` and `firebase-admin/app`
  (rg over backend/src) — @google-cloud/storage and @google-cloud/firestore are
  **optionalDependencies that are physically installed** (present in
  node_modules/.pnpm: `@google-cloud+storage@7.19.0`, `@google-cloud+firestore@7.11.6`,
  `google-gax@4.6.1`) **but never imported by app code** (not resolvable from
  backend/src — pnpm strict isolation).
- CI gate posture (ci.yml: critical=block, high=inform) means this passes CI silently —
  the weekly scheduled audit job is the re-check safety net.

**Actionable recommendation (this changes H-3's disposition from "no fix possible"
to "cheap fix available"):**
1. Bump `firebase-admin` **13.9.0 → 13.10.0** (minor) — removes the HIGH entirely,
   no pnpm override needed, no API surface change expected within a minor.
2. Evaluate **14.5.0** (major) on a branch with the firebase auth test battery
   (`backend/src/routes/__tests__/auth-firebase-session.test.ts`,
   `auth-firebase-refresh.test.ts`, `services/__tests__/firebase-auth.service.test.ts`)
   to also clear both moderates; ship only when those suites stay green.
3. Do NOT pin-override node-forge/uuid in pnpm-workspace.yaml — that would break
   firebase-admin's own resolution (H-3's original judgment still correct).
4. Re-run `pnpm audit --prod` after the bump and update the H-3 ledger entry.

---

## Findings

### L10-1 · P3 · H-3 verdict is stale: a firebase-admin release path now exists for the unpatchable node-forge HIGH
- **Evidence:** `corepack pnpm view firebase-admin version` → 14.5.0 (installed 13.9.0);
  `corepack pnpm view firebase-admin@13.10.0 dependencies` → node-forge absent (dropped
  in favor of farmhash-modern); `corepack pnpm view node-forge version` → still 1.4.0
  (advisory unpatched in the package itself). See H-3 section above for full audit output.
- **Root cause:** R142 recorded H-3 as upstream-blocked ("no firebase-admin release");
  upstream has since published 13.10.0 … 14.5.0, and the 13.x line already sheds
  node-forge. The ledger's recommendation ("track upstream, re-run audit on the next
  firebase-admin bump") was correct — the bump is now available and due.
- **Proposed fix:** dependency upgrade (out of scope for this read-only lane): bump
  firebase-admin to ≥13.10.0 (HIGH gone) / ideally 14.5.0 (moderates gone), then
  `pnpm audit --prod` must report 0/0/0. Not exploitable today (see exploitability
  notes) — severity is "known HIGH carried in a real-money prod that is now cheaply
  removable", not an active risk.
- **Test requirement:** firebase session/refresh/verify suites green post-bump;
  `pnpm audit --prod` exit 0; healthz smoke (firebase-admin boot with cert()).
- **Risk of skipping:** residual reputation/gate debt; the audit output stays red for
  every future round; a future refactor that starts using storage/firestore or forge
  paths would inherit live code with the HIGH.

### L10-2 · P4 · SENTRY_AUTH_TOKEN still rides a Docker build ARG into an intermediate layer (H-2 debt, unchanged)
- **Evidence:** Dockerfile:185-192 — `ARG SENTRY_AUTH_TOKEN=""` … `RUN
  SENTRY_AUTH_TOKEN="${SENTRY_AUTH_TOKEN}" … pnpm --filter @workspace/api-server run build`.
  ARG values consumed by a RUN are recorded in that build stage's image history
  (`docker history --no-trunc`) on the builder host.
- **Root cause:** R142 H-2, deliberately deferred as debt (deploy-contract change,
  operator-visible). Re-verified unchanged at HEAD: default is empty ("Never bake real
  values as defaults" comment holds), the runtime stage is a fresh layer chain that only
  `COPY --from=build`s filesystem content, so the final image config never carries it;
  scope is Sentry source-map upload only.
- **Proposed fix (when scheduled):** BuildKit secret mount — `RUN --mount=type=secret,
  id=sentry_token SENTRY_AUTH_TOKEN=$(cat /run/secrets/sentry_token) …` + Coolify
  `--secret id=sentry_token,env:SENTRY_AUTH_TOKEN` build input; delete the ARG.
- **Test requirement:** `docker history` on the built stage shows no token; sourcemaps
  still upload (Sentry release visible); build succeeds with the secret absent (skip
  path exercised).
- **Risk of skipping:** confined to builder-host build-cache inspection; token scope is
  nuisance-level (sourcemap upload), not data-plane.

### L10-3 · P4 · Frontend idempotency-key generator keeps a Math.random last-resort fallback (documented non-secret)
- **Evidence:** frontend/src/lib/idempotency.ts:110-127 — `generateIdempotencyKey()`
  prefers `crypto.randomUUID()`, then `crypto.getRandomValues(bytes)`, and only when
  BOTH are absent fills bytes via `Math.floor(Math.random()*256)` (:125). The doc
  comment (:103-108) explicitly states keys are collision-resistance tokens, not
  secrets, and CSPRNG is preferred "so a user can't trivially guess another admin's
  keys".
- **Root cause:** totality fallback for non-browser contexts (SSR previews, test
  runners). Every browser SubNation supports has crypto.randomUUID, so the branch is
  dead in practice.
- **Proposed fix:** none required (P4 hardening polish): optionally make the
  last-resort branch throw in production builds so it can never silently weaken keys,
  or delete it and assert `typeof crypto.randomUUID === "function"` at boot.
- **Test requirement:** existing idempotency tests; a new one pinning that the
  Math.random arm is unreachable in browser-like environments if the guard is added.
- **Risk of skipping:** negligible — keys are non-secret, the fallback is documented,
  and the backend's payment_reference/idempotency-key battery is the real control.

### L10-4 · P4 (info) · Vulnerable optional deps (@google-cloud/storage, firestore, google-gax) are installed but never imported — advisory surface only
- **Evidence:** node_modules/.pnpm contains `@google-cloud+storage@7.19.0`,
  `@google-cloud+firestore@7.11.6`, `google-gax@4.6.1`, `node-forge@1.4.0` (installed
  because pnpm installs firebase-admin's optionalDependencies by default), yet
  `node -e require.resolve(...)` from backend/src → MODULE_NOT_FOUND for all of them;
  backend/src imports only `firebase-admin/auth` + `firebase-admin/app` (rg verified).
- **Root cause:** firebase-admin marks storage/firestore optional; the app uses only
  the Auth surface, so the vulnerable code is dead weight on disk (it inflates install
  size and keeps the two moderate advisories in the audit output).
- **Proposed fix:** resolved automatically by L10-1's firebase-admin 14.5.0 bump
  (storage 8.x/firestore 9.x drop uuid). Alternatively `pnpm install
  --no-optional` shapes exist but would need verification that firebase-admin auth
  paths don't lazy-require them — not worth it before the version bump.
- **Test requirement:** none beyond L10-1's.
- **Risk of skipping:** none at runtime (unreachable code); audit-output noise only.

---

## Verified clean at HEAD 528ef39 (evidence, not assurance)

1. **XSS output handling:** repo-wide rg for `dangerouslySetInnerHTML`,
   `\.innerHTML\s*=`, `insertAdjacentHTML`, `document.write` over frontend/src +
   backend/src at HEAD → **zero sinks in source** (all matches are docs/history and one
   test that READS innerHTML to assert rendering). All rendering is React-escaped text
   nodes. CSP (backend/src/lib/helmet-config.ts:50-203): production scriptSrc has NO
   unsafe-inline/unsafe-eval (dev-only), imgSrc tightened to 'self'+data: (R136 F2),
   HSTS 2y preload, COOP same-origin-allow-popups, objectSrc 'none' — headers config
   verified in source; deployment verified in prior live rounds (R126/R130 header
   probes), not re-probed here per read-only prod rule.
2. **Input validation spot-checks (highest-risk surfaces):**
   - No multer/busboy/multipart anywhere — the "inventory upload" is a JSON-body
     structured route (`POST /api/admin/products/:id/inventory`, routes/admin/
     products.ts:651) behind `requireAdmin`, with per-entry kind/email/password
     validation, length caps (`ACCOUNT_PASSWORD_PLAINTEXT_MAX`), reject-on-first-
     malformed, encryption at INSERT, advisory-lock dedup (products.ts:809).
   - Telegram webhook (routes/telegram-webhook.ts): shared-secret header with
     `timingSafeEqual` (:36-41, :240-244), TELEGRAM_ADMIN_IDS allowlist before any
     money action (:123-136), strict regex parser for callback_data (:104-113),
     still-pending re-check before mutation, audit row per decision (:199-209).
   - Raw SQL: every non-test `sql.raw` site interpolates internal constants only —
     migrate.ts boot reconciler (hardcoded table/constraint specs), jobs retention
     specs + reencrypt-v1-credentials.ts hardcoded spec.table/column arrays,
     forecast-retention.ts constants. No route file uses sql.raw outside tests; user
     input reaches predicates only via Drizzle eq/and parameterization;
     `escapeLikeTerm` present for ILIKE paths (arabic-search.ts + callers).
3. **Sensitive-data exposure:** non-test `console.*` calls carry only error
   strings/labels (alerting.service.ts:911/919, metrics.ts:362-441, sentry.ts:323-468,
   instrument.ts:45/60, seed logs) — no user data/tokens. pino REDACT_PATHS exported +
   nested-complete (lib/logger.ts:71,189-190) pinned by
   logger-nested-redaction.test.ts. Sentry: recursive deepSanitize with 40+ sensitive
   field names, JWT-shape heuristic on ANY string value (sentry.ts:147-158), URL
   token-param stripping (:194-203), over-redaction-by-design for "code"/"phone".
   **E-2 verified landed:** lib/body-parser-recovery.ts:114 ships
   `bodyLength: rawBody.length` (was `bodyPreview: rawBody.slice(0, 80)`) with the
   E-2 (R142) comment; regression test asserts `fields.bodyLength` (body-parser-
   recovery.test.ts:78). Error responses: globalErrorHandler emits generic Arabic 500
   with no internals (lib/error-handler.ts:84-87); zod issues minimized to
   {path, code} (R120-B3).
4. **Secrets hygiene:** .gitignore covers `/.env`, `/.env.*` (with .example
   allowlists) + backend/frontend per-package envs + `.secrets/` (lines 34-44, 127-130);
   `git ls-files` shows no tracked .env; only frontend/.env.example on disk (55 lines
   of public VITE_* vars + comments; zero SECRET/PRIVATE/PASSWORD matches). Secret-
   pattern rg (BEGIN PRIVATE KEY / sk- / ghp_ / AKIA / xox / AIza / password=): source
   matches are exclusively test fixtures (secret-scan.test.ts, redaction.test.ts —
   adjudicated in R142-H's census), PEM-header SUBSTRING CHECKS (firebase-admin.ts:72,
   health.ts:80 — `parsed.private_key.includes("BEGIN PRIVATE KEY")` validation of the
   env-provided service account, no value in code), and Arabic UI labels
   (security-meta.ts). No committed credential VALUES found anywhere. gitleaks runs in
   CI with a maintained .gitleaks.toml (15 KB).
5. **Cryptographic assumptions:** lib/encryption.ts — AES-256-GCM, fresh
   `randomBytes(12)` IV per encrypt (:183), strict 128-bit auth-tag length enforced on
   every decrypt funnel (:219-221), 32-byte env key fail-fast at boot (:137-180),
   current→PREV rotation ladder, v2 prefix versioning. No ECB, no static IV, no
   hardcoded key. Session tokens: user `sessionId = crypto.randomUUID()`
   (lib/session.ts:38), admin `sid = randomUUID()` (admin-session.ts:47), JWTs HS256
   pinned on every verify (lib/jwt.ts:113), SESSION_SECRET/ADMIN_JWT_SECRET distinct +
   ≥32-char boot-enforced (:54-96). TOTP secrets: encrypted at rest
   (`totpSecret: encrypt(secret)` routes/admin/auth.ts:928; `safeDecrypt` on every
   read :371/:988). OTP codes: `crypto.randomInt` CSPRNG (whatsapp-otp.ts:16 comment +
   implementation). Math.random in backend exists only in __tests__ fixtures.
   Frontend non-test Math.random: sampling decisions (web-vitals, boot-sentry),
   copilot conversation ids, and L10-3's documented fallback — none security-bearing.
6. **Admin boundary:** rate limiting re-verified complete at app.ts:230-286 —
   authLimiter (10/15min/IP) on firebase session+refresh, admin login, telegram,
   whatsapp/verify; whatsappStartAuthLimiter (20/15min, CGNAT-friendly) on start;
   money-intent limiters on orders/wallet-topups/loyalty-convert; coupon enumeration
   limiter; apiLimiter+userLimiter global. Admin surface: single mount under
   requireAdmin (routes/admin/index.ts:40) + path-scoped requirePermission RBAC; 2FA
   temp token rejected at HTTP gate (middlewares/requireAdmin.ts:76) and socket
   handshake (R142-H verified); distinct ADMIN_JWT_SECRET with boot-enforced
   inequality. CSP noted in (1). Horizontal authz predicates spot-verified unchanged
   (orders/wallet scoped `eq(table.userId, userId)`).
7. **Docker/container:** Dockerfile — digest-pinned node 22-alpine base (:36),
   `USER node` before EXPOSE/CMD (:279, non-root runtime), HEALTHCHECK on
   /api/healthz (:289-290, 30s/5s/150s/3 retries; mirrored in docker-compose.yml
   :142-147), no secrets baked (all ARG defaults empty; only SENTRY_AUTH_TOKEN is a
   runtime-supplied ARG — L10-2), TS sources excluded from the runtime image (only
   dist/ + manifests), --frozen-lockfile in both install stages, corepack cache
   scrubbed. docker-compose.yml: bounded json-file logs (10m×3), stop_grace 40s above
   the 25s drain budget, openwa sibling gets ONLY its own env read-set (no shared
   .env pass-through), 127.0.0.1 host port bindings.
8. **Supply chain:** pnpm-lock.yaml lockfileVersion 9.0 with **1,410 sha512 integrity
   hashes**, zero `http://` registry/tarball references (rg). `--frozen-lockfile`
   in CI and Docker. pnpm-workspace.yaml carries **minimumReleaseAge = 1440 min**
   (1-day release-age rule — documented supply-chain attack defense). All GitHub
   Actions `uses:` SHA-pinned in ci.yml AND docker.yml (checkout/setup-node/pnpm/
   gitleaks-action v2.3.9/codeql/upload-artifact/build-push — full 40-hex pins
   verified). Node base image digest-pinned with a documented bump procedure.

## Not checked / out of scope

- Live production probing (headers, cookies, rate limits at subnation.ly) — read-only
  mandate, no prod traffic; CSP/headers posture rests on source + prior live probes.
- OpenWA external image internals (ghcr.io/ahmadmedo1012/openwa) — outside this repo.
- `pnpm audit` full dev-deps — charter scope is `--prod`.
- Dependency UPGRADES — explicitly forbidden; L10-1 records the actionable path only.
- GHSA pages via web search — npm registry `pnpm view` checks used as the authoritative
  upstream-version source instead (node-forge latest=1.4.0 unmodified since
  2026-03-24; firebase-admin latest=14.5.0).
