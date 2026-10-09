# R127-B11 — Security Archaeology + Perimeter Audit

- **Agent:** R127-B11 (security archaeology auditor — read-only; only writes: this report + one worklog append)
- **Repo:** `SubNation2` @ `main` = `f53a886` (= production, public GitHub repo `ahmadmedo1012/SubNation2`)
- **Scope:** git-history secrets archaeology (full 274-commit history + dangling objects), Telegram webhook perimeter, AI copilot trust boundary, OWASP A01–A10 perimeter sweep, live security-header audit, PII/data-classification pass (incl. Sentry pre-activation review).
- **Non-goals:** R126-A7 held-open items are NOT re-reported — they are listed in §8 with their current status (three of A7's own findings were **closed** by R126-L4 between A7's HEAD `186b131` and production `f53a886`; verified below).
- **Verdict:** **HISTORY CLEAN** — zero leaked credentials in any of 274 commits, 340 unreachable objects, or the stash. Perimeter holds. 1×P2 (Telegram webhook money path un-audited), 3×P3, 2×P4. No P0/P1.

---

## 1. Git history secrets archaeology — VERDICT: CLEAN

Method: full-history content grep, chunked across all 274 commits (`git rev-list --all | xargs git grep`), filename archaeology (`--diff-filter=A`), dangling-object scan, stash scan, current-tree sweep. Patterns: `ghp_`, `github_pat_`, `gho_`, `ghs_`, `glpat-`, `xoxb-`, `xoxp-`, `sk-[A-Za-z0-9]{20,}`, `sk-proj-`, `sk-ant-`, `AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z_-]{30,}`, `-----BEGIN (RSA|EC|OPENSSH|PGP)? PRIVATE`, Telegram bot-token shape (`\d{8,10}:AA…`), DB URLs with embedded passwords (`postgres://user:pass@`, `mysql://`, `mongodb://`, `redis://:`), Slack webhook service URLs, Sentry DSNs.

### 1.1 Results — every hit accounted for (zero real credentials)

| Hit | Location | Assessment |
|---|---|---|
| Synthetic PAT/AWS/OpenAI tokens | `backend/src/lib/copilot/__tests__/secret-scan.test.ts:36,47,89` (present since `b5e956e` 2026-06-04) | **Test fixtures for the copilot secret-scanner itself** — e.g. `sk-ant-api03-abc123def456ghi789`, an `AKIA…` dummy. Not credentials. |
| Fake Telegram bot tokens | `telegram-auth.test.ts:12`, `telegram-referral-gate.test.ts:39`, `auth-providers-cache.test.ts:54` — `"1234567890:AAH-test-bot-token-not-real-do-not-reuse"` | Self-labeled synthetic. |
| Fake DB URLs / bot token in redaction tests | `alerting.service.test.ts:29,43,84` — `postgresql://user:p4ss@…`, `admin:leakedpw@…`, `123456789:AAFakeTokenValue…` | Fixtures proving `redactSensitive` works. |
| Fake PEM placeholder | `routes/auth-settings.ts:126` — `placeholder: "-----BEGIN PRIVATE KEY-----\n…"` (private-key format hint in the provider-settings UI form) | Format hint, no key material. Same string in `redaction.test.ts:74`. |
| Firebase web API key | `.gitleaks.toml:288` — `AIzaSyDoQhcUbqwr0E6qws5vj2vwBNyDEq1EMsQ` | **Public by design** — the client-side Firebase API key that ships in the SPA bundle to every visitor; gated by Authorized Domains + reCAPTCHA, not secrecy (comment cites firebase.google.com/docs/projects/api-keys). Deliberately allowlisted with a rotation note. Only `AIza…` key in the entire repo/tree. |
| Canonical test ENCRYPTION_KEY | `.gitleaks.toml:278-282` — `00112233445566778899aabbccddeeff…` (×2) | Documented throwaway for `backend/src/test/env.ts` (classic sequence hex, obviously-not-random, allowlisted with justification). |
| Placeholder connection strings | `config/env.example:21`, `deploy/env.compose.example:16,78`, `docs/deployment/COOLIFY_FINAL_SETUP.md:108,168`, `README.md:178` | All `USER:PASSWORD@HOST` / `<your-local-password>` placeholders. |

### 1.2 Structural archaeology

- **`.env` files:** never committed. Only `.env.example` templates ever entered history (`frontend/.env.example` added `b5e956e`; current `config/env.example` + `frontend/.env.example` are 100% placeholders — inspected line-by-line). `.gitignore` has carried the `/.env`, `/.env.*`, `!/.env.example` block since `b5e956e`.
- **Key/cert files:** zero `*.pem|*.key|*.p12|*.pfx|*.jks|*.crt|*.der` ever added (`git log --all --diff-filter=A --name-only` — empty).
- **Dangling objects:** `git fsck --unreachable` → 340 objects (stash artifacts from local work: "index on main"/"WIP on main"). Every blob grepped for the credential patterns → **0 hits**.
- **Stash (`stash@{0}` on 186b131):** source-doc diff, 0 credential-pattern hits.
- **`.git/config` never committed** (untracked by construction); **nothing PAT-ish lives in tracked files at HEAD or in any commit** — `git grep` for `https://<token>@github`, `@github.com/<40char>` URL shapes across all 274 commits → empty.
- **CI gate:** `.github/workflows/ci.yml` runs gitleaks-action pinned to 8.27.2 with the repo's extended config (Sentry DSN/token, Discord webhook, custom rules), config validated by a TOML-parse step. The default ruleset (GitHub PATs, cloud keys) is inherited via `[extend] useDefault = true`.

### 1.3 Operational note — PAT in the remote URL (see B11-F4, P3)

`git remote -v` on the local clone shows the origin URL carries an embedded GitHub token (`https://[REDACTED:github_token]@github.com/ahmadmedo1012/SubNation2.git`). This lives **only in `.git/config`** (local workstation artifact), never in tracked content — but the practice puts a write-capable PAT in plaintext on every machine that clones this way (see §7 finding B11-F4).

**History verdict: CLEAN — no rotation action required from repo history.**

---

## 2. Telegram webhook perimeter

Files: `backend/src/routes/telegram-webhook.ts`, `backend/src/lib/telegram-gateway.ts`, `backend/src/lib/telegram-callback.ts`, `backend/src/app.ts`.

| Control | Evidence | Verdict |
|---|---|---|
| **Signature verification** | `telegram-webhook.ts:207-218` — `x-telegram-bot-api-secret-token` compared to `TELEGRAM_WEBHOOK_SECRET` via `timingSafeEqual` (`timingSafeEqualStrings` :34-39, length-checked then constant-time). Fail-closed: **503** when the secret is unset (:209-213), **403** on mismatch (:215-217). | ✓ Present |
| **Live probe** | `POST /api/webhook/telegram` without the secret header (with hostile Origin) → **403** — the signature gate rejects before any handler logic; the CSRF exemption does not open an unauthenticated surface. | ✓ Verified live |
| **Actor authorization** | Money callbacks gated by `TELEGRAM_ADMIN_IDS` numeric allowlist (:119-133); non-allowlisted tappers get an Arabic "no permission" toast + `logger.warn` with fromId. | ✓ |
| **Callback parsing** | `parseTopupCallback` :102-111 — strict regex `^topup_(app\|rej):\d+$`, positive-integer bound. | ✓ |
| **State re-check** | Still-pending check before mutating (:142-161); `TopupService.approve/reject` re-check inside the tx (topup.service.ts:218-219, 634). | ✓ |
| **Rate limiting** | Mounted under `/api` → `app.use("/api", apiLimiter)` (app.ts:926) — 600/min/IP for unauthenticated traffic (webhook updates are unauthenticated). No dedicated limiter; sufficient for Telegram's delivery volume. | ✓ (generic) |
| **CSRF skip scope** | `skipPaths = ["/api/cwv", "/api/webhook"]` (app.ts:784) — narrow, documented (:751-755), and the webhook skip is compensated by the signature gate. | ✓ |
| **Mount scope** | `routes/index.ts:36` — `router.use("/webhook", telegramWebhookRouter)`; single POST `/telegram` route; no other route in the file. | ✓ |
| **Outbound calls** | All via `telegram-gateway.ts` `apiCall` (10 s AbortController, never throws) or the timeout-guarded `/start` reply (`replyWithStartIds` :75-99, F2 fix). Outbound message text interpolation: chat/from IDs are numeric; `actorTag` is `@username` (Telegram usernames are `[A-Za-z0-9_]` — HTML-inert) or `tg:<id>`. | ✓ |
| **Bot token source** | `getBotToken()` reads `TELEGRAM_BOT_TOKEN` env only (telegram-gateway.ts:69-71). | ✓ |

### 2.1 R126 split integrity — `lib/telegram-callback.ts` survived byte-intact

The split commit is **`b0a9267`** ("chore(types,r126): … splits", L9/A3 plan E). Programmatic diff of the pre-split `auth-settings.ts` (`b0a9267^`) vs the extracted `lib/telegram-callback.ts`:

- `isTelegramCallbackSameOrigin` (the CSRF/origin predicate, :42-75): **identical modulo comments/whitespace** — same sec-fetch-site-first logic, same exact-origin URL-parse comparison (protocol+host, never prefix), same fail-closed fallthrough.
- `telegramCallbackAllowedOrigins` (:18-39): body identical (only the `export` keyword added).
- `TELEGRAM_CALLBACK_CSRF_ERROR = "csrf_blocked"`: same literal, now exported (lib:15; was auth-settings.ts:1028 pre-split).
- The route still calls the same shape: `auth-settings.ts:486` `isTelegramCallbackSameOrigin(req.headers, telegramCallbackAllowedOrigins())` → redirect `/login?error=csrf_blocked` (:496); re-export at :59 keeps test imports resolving; pinning suite `telegram-callback-csrf.test.ts` (11 predicate cases incl. `evil.com` suffix and empty-header fail-closed) still green per the split commit (207/207 tests).

**Split verdict: CSRF/origin logic preserved byte-intact; no behavioral drift.**

### 2.2 NEW finding — money path with no audit row (B11-F1, P2)

The webhook calls `TopupService.approve/reject` **directly** (telegram-webhook.ts:166-176), bypassing the admin route. The admin-UI path writes an `audit_logs` row for the same operation (`admin/topups.ts:159` `topup.approve`, `:196` `topup.reject`) — but `writeAuditLog` appears **zero** times in `telegram-webhook.ts` and in `topup.service.ts`. A Telegram-tapped approval **credits a customer wallet with no audit_logs row**: attribution exists only as the `reviewed_by` column on the topup row (`topup.service.ts:378`, A4-04's actor tag) and an app-logger line (:204). Every other money mutation in the admin surface is audited (A7 matrix §2.5); this is the one wallet-credit path that is not.

---

## 3. AI copilot trust boundary (CSO Phase 7)

Files: `routes/admin/copilot/ask.ts`, `draft.ts`, `services/copilot/{admin-request-tool,admin-direct,llm-client,provider-config,system-prompt}.ts`, `frontend/src/components/admin/copilot/CopilotPanel.tsx`.

### 3.1 Output rendering — no HTML sink exists

- `dangerouslySetInnerHTML` / `innerHTML` / `insertAdjacentHTML` / `document.write`: **0 hits in `frontend/src`** (repo-wide rg; only doc references + one test that *reads* `container.innerHTML` to assert rendering).
- Copilot answers render through **`MarkdownLite`** (CopilotPanel.tsx:1582-1639) + **`InlineMd`** (:1641-1679): a hand-rolled tokenizer mapping `\`\`code\`\``, `**bold**`, `*italic*` and block shapes (fences, lists, paragraphs) to React elements (`<pre>/<code>/<strong>/<em>/<ul>/<ol>/<p>`) — **all values render as React children, auto-escaped**. No markdown-to-HTML library, no link rendering, no deps.
- **Verdict: copilot output (and any LLM-injected HTML) cannot execute or inject — it can only style text.**

### 3.2 Input side / prompt-injection surface

- Admin's own `intent_text` (≤4000 chars, ask.ts:131-140) and sanitized history (≤12 msgs, ≤8000 chars, ≤4000/msg — `sanitizeHistory` :118-137) flow to the model. That is the feature (operator asks questions); first-party injection is self-inflicted by design.
- **Second-order injection** (poisoned DB content — ticket text, product names — riding tool results into the context) is the real threat. Mitigations verified at HEAD:
  - Tool catalog is **scope-filtered per admin** (ask.ts:163-179); `runReadTool` re-checks `requiredScope` at execution.
  - **Wallet/balance/refund ops are never directly executable** — system prompt hands off to `/admin/topups` (ask.ts:17-19).
  - Direct-execute tools (`update_product`/`update_stock`) are **super-admin-only** at BOTH catalog and dispatch (`directToolsForScopes` admin-direct.ts: returns `[]` without `"all"`; ask.ts:274 `isSuperAdmin &&` guard).
  - Non-super-admin mutations must go through `/draft` → `/previews/:id/confirm` — a **human-clicked**, owner-scoped (`getOwnedPreview`, preview-store.ts:82-90) preview flow with double-confirm for high-risk (A7 matrix #96-100).
  - `admin_request` path allowlist: `/api/admin/` prefix only; **blocked**: `/api/admin/auth/*`, `/api/admin/copilot/*` (no self-recursion), `/api/admin/admins*`, `/api/admin/settings*` (SEC-92-03 — model cannot mint admins or rewire auth). Traversal defenses: URL-normalize → reject `..`/`//` → re-check prefix against normalized + percent-decoded + re-normalized forms (admin-request-tool.ts:143-215) — `%2F` smuggling is covered.
  - **SSRF: none.** The only fetch is loopback `http://127.0.0.1:${port}` + the allowlisted path (:322-370); all other backend fetch targets are fixed hosts (api.telegram.org, env-configured OpenWA/Discord/generic-webhook/LLM provider URLs — operator config, never request input).
  - Output-side `scanForSecrets` on text + tool traces (ask.ts:338-380): refusal + `copilot_actions` audit row on match; refusal counter in Prometheus.
  - `admin_request` mutations: first call returns **428 preview**; only a repeat with `confirm:true` executes (:282-309).

### 3.3 NEW nuance — the 428 confirm gate is model-cooperative (B11-F3, P3)

`confirm: true` is supplied **by the LLM** in its second tool call — there is no cryptographic/human token in the loop (the code comment concedes this: *"a silent execution now requires the model to make a second, explicitly-flagged call … observable in the tool_uses trace and counter to its instructions"*, admin-request-tool.ts:276-281). A successful second-order injection can therefore call twice in one turn — and the documented endpoint list includes `POST /api/admin/topups/{id}/approve` (a wallet-credit money mutation). Compensating controls (super-admin-only tool, observable trace, system-prompt prohibition, downstream route still audits + validates) keep this below P2, but the `/draft` flow proves the codebase already knows how to do human-attested confirms.

**Copilot trust-boundary verdict: output = inert text (React-escaped); input = scope-fenced + preview-gated; residual = model-side confirm on the super-admin universal tool (P3).**

---

## 4. OWASP A01–A10 perimeter sweep

### 4.1 A01 Broken Access Control — pattern universal; A7's three gaps closed since

A7's 116-route RBAC matrix was taken at `186b131`. Verified at production HEAD `f53a886`: the post-A7 commits strengthened exactly the surfaces A7 flagged — 

| A7 finding | Status at f53a886 | Evidence |
|---|---|---|
| A7-F1 stats no scope | **CLOSED** | `admin/stats.ts:63,83` + `:182,189` — `requireAdmin` + `requirePermission("finance")` on both stats routes; 270-line regression suite `stats-rbac-scope.test.ts` added |
| A7-F3 auth 401 no-store | **CLOSED** | `requireAdmin.ts:45` stamps `Cache-Control: no-store` at entry (all rejection paths inherit); `admin/auth.ts:101-103` router-level no-store. **Live-verified**: `GET /api/admin/session` → `401` + `cache-control: no-store` |
| A7-F4 ticket writes un-audited | **CLOSED** | `tickets.ts:275` (`ticket.reply`), `:322` (`ticket.status_update`) both `writeAuditLog`; `tickets-audit.test.ts` added |
| A7-F2 / F5 / F6 / F7 / F8 / F9 | still open (P3/P4) — see §8 | verified unchanged at HEAD + live |

No new admin routes since A7 without authz (diff 186b131→f53a886 on `routes/admin/*` = stats-emit socket notifications, scope gates, audit rows, no-store, OG-image meta rewrites). A7's mount-chain verdict (zero routes missing authz; money gates precede every write) therefore carries to production HEAD.

### 4.2 A03 Injection — sql`` audit re-run at HEAD

- All `sql\`\`` template interpolations in non-test code are either **bound parameters** (`${value}` under drizzle's parameterizing template — e.g. `alertLogger.ts:134` `hashtextextended(${opts.dedupeKey}, 0)`, migrate.ts fingerprint reads) or **table/column references** (`lockout.ts:153-155`, `forecast-retention.ts:101`).
- All 12 `sql.raw(...)` call sites use **in-file code constants**: retention jobs pass literal table names + literal WHERE clauses (`risk-retention.ts:84-98` `"risk_events"`, hardcoded interval SQL; same shape in enrichment/copilot/forecast reapers); `reencrypt-v1-credentials.ts:187-423` interpolates `spec.table`/`spec.column` from a compile-time literal list (:97-101, `TargetTable`/`TargetColumn` unions); `test/db.ts:554` constant TABLES.
- **Zero user input reaches any `sql.raw` or string-concatenated SQL.** ILIKE paths use `escapeLikeTerm` (users.ts:50, R116 A6-9 intact).
- New post-A7 HTML sink audited: `app.ts` OG-image meta rewriting (`rewriteMetaTag` :1291-1305, `rewriteCanonical`, `removeMetaTag`) interpolates DB `imageUrl` into the SPA shell — **all through `escapeHtmlAttr()`** (both rewriters). New code follows the escape discipline.

### 4.3 A05/A07 SSRF + misconfig

- Backend fetch inventory (non-test): `api.telegram.org` (×4 sites), `DISCORD_WEBHOOK_URL`/`GENERIC_ALERT_WEBHOOK_URL` env (alerting.service.ts:798,822 — operator env, not request input; outbound payloads pass `redactSensitive`), `WHATSAPP_OTP_BASE_URL` env (openwa.service.ts:98,651), `COPILOT_BASE_URL` env (provider-config.ts:75 — operator-configured LLM provider, fixed fallback hosts openrouter/nvidia), loopback admin_request. **No request-controlled URL is fetched anywhere.**
- CORS: exact-origin allow-list, fail-closed boot assertion in production (app.ts:122-133) — unchanged from A7 §6 (live 403 on hostile Origin).

### 4.4 A04/A07 auth/OTP rate limits (re-verified at HEAD)

`app.ts:882-927`: authLimiter 10/15min/IP on `/api/auth/firebase/{session,refresh}`, `/api/admin/login` (prefix covers verify-2fa), `/api/auth/telegram` (covers POST + webapp + GET callback), `/api/auth/whatsapp/verify`; whatsappStartAuthLimiter 20/15min/IP on `/api/auth/whatsapp/start`; couponValidateLimiter 10/min; apiLimiter 600/min/IP + userLimiter 1200/min/user; DB lockouts (`lib/lockout.ts` exponential) on admin login/2FA/password-change paths. No un-limited session-mint or OTP endpoint found. The single-prefix mounts (R98-F3 double-count fix) remain.

### 4.5 File uploads

None. No `multer`/`formidable`/`busboy` middleware anywhere in backend/src; product imagery is a bounded `image_url` string field (A7 §7 confirmed at HEAD). The only `fs.writeFile` sites are offline audit tooling (`lib/audits/neon-audit.ts:137`, `ruflo-audit.ts:438`) with basename validation rejecting `/`, `..`, absolute paths (neon-audit.ts:131-134) — not request handlers.

---

## 5. Live security-header audit (2026-10-09, `curl -sI`, guest-level)

Probed `https://subnation.ly/` and `https://subnation.ly/api/healthz` — compared against `backend/src/app.ts` helmet config (:171-288):

| Header | Live (both endpoints) | Config | Match |
|---|---|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self' https://apis.google.com … googletagmanager.com; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' …firebase/sentry/GA… https://subnation.ly https://www.subnation.ly; worker-src 'self' blob:; frame-src 'self' …google/recaptcha; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'` | app.ts:174-258 directives; `base-uri`/`form-action`/`frame-ancestors`/`object-src` arrive via helmet v8 CSP defaults | ✓ |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | :262-270 | ✓ |
| X-Content-Type-Options | `nosniff` | :286 | ✓ |
| X-Frame-Options | `SAMEORIGIN` | :287 | ✓ |
| Referrer-Policy | `strict-origin-when-cross-origin` | :288 | ✓ |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), usb=(), payment=(self), midi=(), accelerometer=()` | :164-169 | ✓ |
| COOP | `same-origin-allow-popups` | :284 (Firebase popup compat) | ✓ |
| COEP | absent (disabled) | :277 documented (Firebase CDN lacks CORP) | ✓ by design |
| CORP / Origin-Agent-Cluster | `same-origin` / `?1` | helmet defaults | ✓ |
| X-DNS-Prefetch-Control / X-Download-Options / X-Permitted-Cross-Domain-Policies / X-XSS-Protection | `off` / `noopen` / `none` / `0` | helmet defaults | ✓ |
| Cache-Control | root `no-cache, no-store, must-revalidate`; healthz `public, max-age=5` | SPA-shell + healthz contracts | ✓ |

**Header verdict: live ↔ config 1:1; the full OWASP-recommended set is present.** The only relaxations are the two documented ones — `script-src-attr 'unsafe-inline'` (A7-F2, held open, Firebase popup constraint) and `style-src 'unsafe-inline'` (Tailwind-inherent, accepted) — plus COEP-off (documented Firebase compatibility). No new gaps vs A7's snapshot. Shell `last-modified: Fri, 09 Oct 2026 14:17:44` = fresh f53a886 deploy.

---

## 6. Data classification / PII pass (CSO Phase 11) + Sentry pre-activation

### 6.1 Application logs (pino)

- `REDACT_PATHS` (logger.ts:74-177, exported + test-pinned): passwords/hashes, every token transport (`token`, `id_token`, `access_token`, `refresh_token`, `auth_token`, `admin_token`, `session_token`), OTP/TOTP, card data, `ssn`/`national_id`, secrets/keys, `initData`/`init_data`, `temp_token`, `link_consent_token` — plus nested `body.*`/`req.body.*` paths, fetch/axios `err.*.headers.authorization` chains, and one-seep `*.id_token`-style wildcards. Comprehensive for credentials.
- **Auth/OTP log payloads carry no PII**: auth-whatsapp start/verify log only error messages (:185-190, :284-289); telegram-auth-flow logs `userId` + reason only (:210-235, :345-352, :507-515); brute-force telemetry goes to the DB (`auth_activity` — ipAddress/userAgent, RA+admins-gated per A7 #60-62), which is the appropriate surface.
- **Phones never reach logs**: zero `logger.*({… phone…})` call sites repo-wide (rg). Where phone is surfaced, it's pre-masked: `maskPhone` (`account-link-consent.ts:443` — `9••••••78`) in firebase-auth.service.ts:413; `phone_masked` in loyalty referrals API (loyalty.ts:357-363).
- Admin audit rows: `user.update` logs field NAMES + wallet/loyalty VALUES (money, users.ts:389-399) — no PII; auth-provider PATCH logs keys only (auth-settings.ts:1262-1266 per A7 §5, intact); credential-reveal audit precedes decrypt (orders.ts:338-378, intact).
- `console.log` in backend non-test code: seed scripts + one sentry.ts boot notice — no PII.

### 6.2 Sentry — pre-activation review (DSNs currently UNSET: backend logs "NOT initialized", frontend refuses to boot without `VITE_SENTRY_DSN` — env-only, no hardcoded fallback, instrument.ts:59-73)

What WOULD leak when activated:

| Surface | Current state | Pre-activation gap |
|---|---|---|
| **Backend `beforeSend`** (lib/sentry.ts:340-392) | `deepSanitize` walks request.data/extra/contexts: sensitive-field denylist (passwords, tokens, OTP/code, cookies, authorization, secrets, ssn/national_id/card/cvv/sender_account, provider blobs) + JWT-shape heuristic on any string + depth cap 6 | **`phone` is NOT in `SENSITIVE_FIELD_NAMES`** (nor `initData`/`temp_token`/`link_consent_token`, which ARE in the pino list). An exception on the WhatsApp-OTP path carrying a `phone` field would ship the raw number to Sentry. → **B11-F2 (P3): add the 4 names before any DSN is set** |
| **Frontend `init`** (instrument.ts:142-203) | `sendDefaultPii: true` — deliberate, documented ("include IPs / request headers so on-call has enough context"); `enableLogs: true` ships FE logger lines | IP + header collection on a phone-auth e-commerce product → IP↔phone correlation becomes possible inside Sentry. Register as an explicit, revisitable decision (Libya data-protection posture). → B11-F4-note (P4) |
| **Session Replay** (sentry-replay.ts:27-47) | `maskAllText: true` + `blockAllMedia: true`, lazy-attached, 10% session roll | ✓ no replay PII |
| **User binding** | No `setUser`/`withScope(user)` anywhere in FE — no PII binding by default | ✓ |

---

## 7. Findings (P0–P3 + register notes)

| ID | Sev | Title | Evidence (verbatim) | Confidence | Fix directive |
|---|---|---|---|---|---|
| **B11-F1** | **P2** | Telegram-webhook topup approve/reject — wallet-credit money mutation with **no `audit_logs` row** (audit-trail asymmetry vs the admin-UI path) | `telegram-webhook.ts:166-176`: `await import("../services/topup.service").then((m) => m.TopupService.approve(topupId, …, actorTag));` — `writeAuditLog` count in `telegram-webhook.ts` = **0**, in `topup.service.ts` = **0**; vs `admin/topups.ts:159` `void writeAuditLog(req, "topup.approve", "topup", id, {…})`. Attribution survives only as `reviewedBy` on the row (topup.service.ts:378) + a logger line (:204) | HIGH (code-verified) | Write an audit row in the webhook's success path (same action classes `topup.approve`/`topup.reject`, actor = `tg:{id}`/`@username`, source = "telegram_webhook") — either directly in the route or via a writeAuditLog variant that accepts a synthetic req; extend `tickets-audit`-style pinning test |
| **B11-F2** | **P3** | Sentry BE sanitizer denylist misses `phone` (+ `initData`, `temp_token`, `link_consent_token`) — raw phone numbers would ship to a third party the moment `SENTRY_DSN` is set | lib/sentry.ts:58-97 `SENSITIVE_FIELD_NAMES` — no `phone` entry (pino's `REDACT_PATHS` carries the telegram/token names but sentry.ts never got the phone class) | HIGH | One-array-element fix: add `"phone"`, `"initdata"`/`"init_data"`, `"temp_token"`, `"link_consent_token"` to `SENSITIVE_FIELD_NAMES` before activating any DSN; extend the redaction test |
| **B11-F3** | **P3** | Copilot `admin_request` 428 confirm gate is **model-cooperative** — `confirm:true` is LLM-supplied, not human-attested; a second-order prompt injection can pass it with two calls in one turn (incl. `POST /api/admin/topups/{id}/approve` in the documented endpoint list) | admin-request-tool.ts:276-281: *"a silent execution now requires the model to make a second, explicitly-flagged call after having been told to surface the preview — observable in the tool_uses trace and counter to its instructions"*; the confirm boolean is `input.confirm !== true` (:288) from the tool call itself | HIGH on mechanism / MEDIUM on exploitability (super-admin-only + observable + downstream route still validates+audits) | Make the confirm a human round-trip: mint a one-time preview token handed to the admin UI (as `/draft` previews already do), require the admin's explicit `/confirm` click to release it; until then, consider excluding `/topups/*/approve|reject` from admin_request's documented endpoint list |
| **B11-F4** | **P3** | Write-capable GitHub PAT embedded in the git remote URL — plaintext in `.git/config` (+ shell history + process args) on every machine cloned this way; one paste away from a public-repo leak | `git remote -v` → `https://[REDACTED:github_token]@github.com/ahmadmedo1012/SubNation2.git` (fetch + push); NOT in tracked files/history (verified §1.2) | HIGH (config-verified; class risk) | Switch origin to SSH or `gh auth setup-git` (credential helper); rotate the PAT if it has ever been pasted anywhere; never embed tokens in remote URLs for a PUBLIC repo |
| B11-F5 | P4 | Frontend Sentry `sendDefaultPii: true` + `enableLogs` — IP/header/FE-log collection on a phone-auth product once `VITE_SENTRY_DSN` activates (documented deliberate choice — register it) | instrument.ts:146-149: `// Per the user's directive … include IPs / request headers` / `sendDefaultPii: true` | HIGH | Record in the data-classification register; revisit at DSN activation (IP↔phone correlation); Replay masking already correct |
| B11-F6 | P4 | Committed public Firebase web API key — acceptable, but the gitleaks-allowlist rotation note is the only thing keeping it honest | .gitleaks.toml:283-288: *"Embedded in the client SPA bundle … If this key is rotated, replace the literal below with the new value."* | HIGH | No action; keep the allowlist comment in sync on rotation |

**Counts: P0 = 0 · P1 = 0 · P2 = 1 · P3 = 3 · P4 = 2.**

---

## 8. Known-items pointer table (R126-A7 held-open list — current status at f53a886, NOT re-reported)

| A7 item | Sev then | Status now | Note |
|---|---|---|---|
| A7-F1 stats no permission scope | P2 | **CLOSED at f53a886** | `requirePermission("finance")` on both stats routes + regression suite (§4.1) |
| A7-F2 CSP `script-src-attr 'unsafe-inline'` | P3 | open (unchanged) | live-confirmed present; Firebase-popup constraint documented at app.ts:225-226; staged removal test still recommended |
| A7-F3 admin-auth 401 no-store | P3 | **CLOSED at f53a886** | requireAdmin.ts:45 entry-stamp + router no-store; live-verified `401` + `no-store` |
| A7-F4 ticket writes un-audited | P3 | **CLOSED at f53a886** | `ticket.reply`/`ticket.status_update` audit rows + test suite |
| A7-F5 `/api/metrics` any-scope admin | P4 | open (unchanged) | metrics.ts:34-70 — token or any active admin (revocation-parity enforced) |
| A7-F6 admins.ts mount-only auth | P4 | open (unchanged) | still no own `router.use(requireAdmin)`; parent mount verified intact |
| A7-F7 copilot rate-limit fails open | P4 | open (unchanged) | rate-limit.ts:110 `failing open` — verified still present |
| A7-F8 Cloudflare `ratelimit-policy pk=:` disclosure | P4 | open (edge-level) | unchanged; out of repo control |
| A7-F9 security.txt soft-200 | P4 | open (unchanged) | live-probed: `/.well-known/security.txt` → 200 `text/html` |

---

## 9. Recommended next actions (priority order)

1. **B11-F1 (P2):** add the audit row to the Telegram webhook approve/reject success path — this is the last un-audited wallet-credit mutation.
2. **B11-F2 (P3):** extend `SENSITIVE_FIELD_NAMES` with `phone`/`initData`/`temp_token`/`link_consent_token` **before** any Sentry DSN goes live (it's a pre-activation one-liner; after activation it's an incident).
3. **B11-F4 (P3):** move the origin remote off the embedded PAT (SSH or credential helper) + rotate.
4. **B11-F3 (P3):** harden the admin_request confirm gate to a human-attested token (or at minimum pull topup approve/reject out of its documented endpoint list).
5. Carry A7-F2/F5/F6/F7/F9 per A7 §10 (unchanged).

---

*Report generated by audit agent R127-B11. All file:line references verified at `f53a886` (2026-10-09). Live probes: guest-level only (`curl -I` / single hostile-Origin POST, rejected 403 by the webhook signature gate), ≤4 requests total, nothing mutating.*
