> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r117/backend-r116-regressions.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R117-A1 — Backend audit of R116 changes (47b304e..f10bb9b, `backend/` + `shared/`)

> Read-only audit agent R117-A1. Audited range: `git diff 47b304e..f10bb9b -- backend/ shared/`
> (34 files, +1634/−199; R116 commits ca67360 + merge 7cee846 + fix f10bb9b). All line numbers
> below were re-verified against the current tree at HEAD `f10bb9b` (clean). Money paths
> (checkout.service.ts, refund.service.ts, points/loyalty ledger, wallet debits) are **untouched**
> by this range — verified via `git diff --stat` (not listed). The one money-adjacent service
> change (topup.service.ts) is attribution-only inside the already-guarded status flip.

**Findings by severity: P0: 0 · P1: 0 · P2: 1 · P3: 5** (plus 18 VERIFIED-OK claims below).

---

## FINDINGS

### 1. [P2 — availability, money-adjacent] OTP-start advisory lock holds a shared-pool DB client across the whole external send; at production pool size (8) this can wedge OTP login and starve the app's entire DB layer

**File:** `backend/src/services/whatsapp-otp.service.ts:203-250` (lock), `:211` (`pool.connect()`), `:231` (`startOtpLocked` runs while the client is held), `:259` (cooldown probe goes through the *same* pool via drizzle `db`); `shared/db/src/index.ts:42` (pool max), `backend/src/services/openwa.service.ts:637,989-990` (send = 3 attempts × 8 s timeout + 1.5/4 s backoff).

**Evidence:**
```ts
// whatsapp-otp.service.ts:211 / :231
const client = await pool.connect();
...
return await startOtpLocked(input, phone);   // probe (db.select) + WhatsApp send + insert ALL run here
```
Production pool is **8** (`shared/db/src/index.ts:42` — `DB_POOL_MAX ?? (production ? 8 : 10)`; docs/deployment/FINAL_PRODUCTION_ENV.md pins 8; `connectionTimeoutMillis` = 10 s). The lock is per-*phone*, so concurrent starts for *distinct* phones each hold one of the 8 clients — and then each needs **another** client from the same pool for its own cooldown probe (`startOtpLocked` → `db.select(...)`, line 259). With a slow/downed/sleeping gateway (a documented recurring state — see the `gateway_waking` handling), a single send can occupy its holder for ~30 s+.

**Impact:**
- ≥8 concurrent `/api/auth/whatsapp/start` calls → all 8 clients held → every start then blocks on pool acquisition for its own probe → after 10 s *all in-flight starts fail 500* — OTP login (the primary auth channel for this product) hard-down for the burst, and the app-wide DB pool is pinned meanwhile.
- 2–4 concurrent slow starts already shrink the shared pool for every other request.
- Reachable by one attacker IP within the `whatsappStartAuthLimiter` budget (20/15 min — `app.ts:556-565`), and organically by CGNAT bursts + the frontend's gateway-wake auto-retry.
- The mechanism is **bypassed in the test harness** (`resolveDbPool` returns null — `whatsapp-otp.service.ts:189-201`), so the production lock path has zero test coverage.

**Suggested fix:** take advisory locks on a *dedicated* small pool (e.g. `new pg.Pool({ ...dbPoolConfig, max: 2 })` exported from `@workspace/db` as `lockPool`), or restructure to a transaction-scoped `pg_advisory_xact_lock` — the pattern every other lock site in this repo already uses (`routes/wallet.ts:432`, `services/topup.service.ts:89,263`, `jobs/alertLogger.ts:134`, `lib/boot-migrations.ts:519`), which auto-releases at COMMIT/ROLLBACK and cannot leak or pin the runtime pool. Add a regression test with a mocked 1-client pool asserting release ordering.

---

### 2. [P3 — regression-in-fix + claim mismatch] A7-2 split-era-origin boot warning is DEAD CODE at HEAD: f10bb9b deleted the call while removing the www→non-www redirect

**File:** `backend/src/lib/origins.ts:38-56` (defined, never called anywhere — repo-wide grep returns only the definition); `backend/src/app.ts:27` (import reduced to `getConfiguredOrigins`).

**Evidence:** at `ca67360` and at the merge `7cee846`, `app.ts` line 27 imported and line 48 called `warnLegacySplitOriginEnvAtBoot()`. The `f10bb9b` diff (`git diff 7cee846..f10bb9b -- backend/src/app.ts`) removes **both** the import and the call in the same commit whose message only mentions the redirect removal — collateral damage in the "Cloudflare loop" fix.

**Impact:** `FRONTEND_ORIGINS` / `VERCEL_FRONTEND_ORIGIN` still fold silently into the CORS/CSRF/Socket.IO allowlist (`origins.ts:11-21`) with **no boot signal** — exactly the "operator copies an old env block → silently re-arms the cross-origin cookie class" scenario A7-2 was written to expose. The R116 round report's claim ("origin-truth boot warning") is **false at HEAD**, and render.yaml's new A7-2 comment ("the backend folds it into CORS/CSRF/Socket.IO and warns at boot while it is set") now documents behavior that does not exist.

**Suggested fix:** one-line revert of the collateral — restore the import + module-scope call in `app.ts` (and pin it with a test that imports app.ts with `FRONTEND_ORIGINS` set and asserts one warn).

---

### 3. [P3] Advisory-lock leak on unlock failure: a failed `pg_advisory_unlock` leaves the per-phone lock held on a live pooled session → that phone 429s "cooldown" until process restart

**File:** `backend/src/services/whatsapp-otp.service.ts:232-248`; `shared/db/src/index.ts:63,88` (15 s `statement_timeout` applies to the unlock query too).

**Evidence:**
```ts
} catch (err) {
  // Best-effort: a dead connection drops the lock server-side on close …
  logger.warn(... "released on connection close" ...);
}
client.release();   // ← returns the (possibly still-usable) session to the pool
```
Session-scoped advisory locks are dropped only when the *session* ends. `release()` does **not** end the session — so an unlock failure on a live connection (e.g. statement-timeout abort) leaves `pg_advisory_lock(hashtext('otp-start:'+phone))` held indefinitely on a pooled session that keeps serving other queries. Every later `/start` for that phone returns the lock-busy `cooldown` verdict (429) with no start in flight.

**Impact:** rare trigger, permanent-until-restart effect, per-phone OTP login lockout. **Suggested fix:** on unlock failure call `client.release(true)` (destroy the client so the session closes and the lock drops), or adopt the tx-scoped lock from finding 1 which eliminates the leak class entirely.

---

### 4. [P3] New credentials-reveal endpoint has no volume gate — an orders-scoped admin can sweep every order's credentials at ~600/min with audit rows as the only trace

**File:** `backend/src/routes/admin/orders.ts:210-252`; `backend/src/app.ts:443-459` (getRequestUserId verifies only *user* tokens) + `:461-503` (apiLimiter = 600/min/IP for admin-cookie traffic).

**Evidence:** the route is properly scoped (parent `requireAdmin` + `requirePermission("orders"` at `routes/admin/index.ts:127-131`, inline `requireAdmin` at orders.ts:210) and every reveal writes an awaited `order.credentials_view` audit row (orders.ts:234-237) — but there is no dedicated rate limit or anomaly alert on reveal volume. A compromised orders-scope session iterating ids gets the full credential DB in minutes; nothing fires except a pile of audit rows.

**Context:** strictly better than the pre-R116 list (which bulk-decrypted all rows with zero audit), so this is residual-risk hardening, not a regression. **Suggested fix:** a dedicated limiter on the route (e.g. 30–60/min per admin) and/or an admin alert when `order.credentials_view` rows exceed N/hour.

---

### 5. [P3] Copilot path gate now rejects legitimate query strings containing `//` (defense-in-depth false positive)

**File:** `backend/src/services/copilot/admin-request-tool.ts:257-271` + `:158`.

**Evidence:** A7-4's fix concatenates the query back onto the checked path — `const safePath = \`${safeUrl.pathname}${safeUrl.search}\`` — and feeds it back into `isPathAllowed`, whose `path.includes("//")` traversal detector now scans the **query string** too. Any future GET like `/api/admin/products?next=https://x//y` returns 400 `COPILOT_PATH_BLOCKED`. Current endpoints carry no such queries, so it's latent. **Suggested fix:** apply the `//`/`..` checks to `safeUrl.pathname` only; the prefix checks already normalize via `new URL(...).pathname` (which strips the query).

---

### 6. [P3, cosmetic] Under an ENCRYPTION_KEY mismatch the admin list shows `has_credentials: true` while the reveal returns all-nulls

**File:** `backend/src/routes/admin/orders.ts:173-177` (flag from raw columns) vs `:248-250` (`safeDecrypt` → null on GCM auth failure, `lib/encryption.ts:140-181`).

**Impact:** operator sees the "show credentials" affordance, clicks, gets an empty panel; the throttled safeDecrypt warn is the only signal. **Suggested fix:** when all three safeDecrypt results are null for a `has_credentials:true` order, return `decrypt_failed: true` so the UI can render «تعذّر فك التشفير — راجع ENCRYPTION_KEY» instead of «لا توجد بيانات».

---

## VERIFIED-OK — R116 claims confirmed true at HEAD (with evidence)

1. **Admin orders list no longer decrypts credentials in bulk** — `routes/admin/orders.ts:173-177` returns only `has_credentials: !!(deliveredEmail || deliveredPassword || deliveredExtraDetails)`; the list's `delivered_email/password/extra_details` fields are gone (old shape removed at this exact hunk). The **only** remaining admin-orders decrypt surface is the new per-order route (`orders.ts:248-250`).
2. **New `GET /api/admin/orders/:id/credentials` is auth-scoped, audited, no-store** — parent mount: `protectedRouter.use(requireAdmin)` (`admin/index.ts:39`) + `requirePermission("orders")` (`admin/index.ts:127-131`); inline `requireAdmin` at `orders.ts:210`; digit-exact `intParam` (`lib/http.ts:10-21`) with 400 on non-integer; 404 on unknown id (`orders.ts:228-229`); **awaited** `order.credentials_view` audit row *before* the credentials leave the process (`orders.ts:234-237`; `writeAuditLog` never throws — `lib/audit.ts:92-97`); `Cache-Control: no-store` via the router-level middleware covering every route in the router (`orders.ts:23-26`); refunded orders report `has_credentials:false` because RefundService nulls the columns in the refund tx (pinned by `routes/__tests__/orders-credentials-serialization.test.ts:262-283` and `routes/__tests__/admin-orders-credentials.test.ts`).
3. **Nothing else depended on the removed plaintext** — buyer surfaces untouched and still decrypt for completed orders (`routes/orders.ts:72-74`); wallet summary no longer decrypts (`routes/wallet.ts:146-153` — delivered_* pinned `null` + `has_credentials` flag); frontend admin orders page fetches on demand (`frontend/src/pages/admin/orders.tsx:231`); **zero** frontend references consume `recent_orders` from `/api/wallet` (repo grep) and no other backend surface decrypts order credentials (`safeDecrypt(` grep: orders.ts, admin/orders.ts:248-250, diagnostics booleans, admin/products inventory fields — all pre-existing/legitimate).
4. **Refund bulk path finance-scoped** — `orders.ts:343-353`: `status==="refunded"` requires `hasPermission(actingPerms, PERMISSION_SCOPES.FINANCE)` (403 otherwise); `RefundService.refundOrder` has exactly **one** production caller (this gated route — repo grep), so no alternate refund surface bypasses the gate. Non-refund status guards (terminal refunded / purchase-tx-only completed / no completed demotion) unchanged from base.
5. **Wallet summary `has_credentials` flags, no PII leak** — `wallet.ts:146-153`; projected user read (`wallet.ts:80-88`) keeps balance/loyalty fields only; the topup-create projected identity read (`wallet.ts:661-673`) covers everything `notifyNewTopup` + `derivePrimaryProvider` consume (`lib/user-provider.ts:16-23`); user-facing `formatTopup` does **not** expose `reviewed_by` (`wallet.ts:705-719`).
6. **`/api/auth/me` + `/api/auth/probe` → `Cache-Control: no-store`** — `routes/auth.ts:372` and `:416` (set before the unauthenticated early-returns on /probe, so all paths covered).
7. **Encryption key memoized, correctly** — `lib/encryption.ts:28-35`: failure of `parseKey()` propagates and `memoizedKey` stays `null` (first failure NOT cached — lazy-validation semantics unchanged); boot assertion shares the same `parseKey` (`:13-19`, `:68-89`) so the lockstep can't drift; test seams present (`:43-45`) and used in both test files.
8. **safeDecrypt warn throttled with no behavior drift** — `lib/encryption.ts:126-181`: one warn per 60 s window (env-tunable `SAFE_DECRYPT_WARN_THROTTLE_MS`), suppressed-failure count surfaced on the next warn, credential value never logged (length + format fingerprint only), and the **return-value semantics are unchanged** — GCM auth failure → `null`, legacy plaintext → passthrough, null/empty → null.
9. **OTP start race serialized via advisory lock (implemented as claimed)** — `whatsapp-otp.service.ts:203-250`: `pg_try_advisory_lock(hashtext('otp-start:'+phone))` on a dedicated client spans probe→send→insert; the loser gets the rate-limit verdict (`cooldown`, retryAfterSec 15) which the route maps to 429 + `Retry-After` (`routes/auth-whatsapp.ts:120-144`); `finally` releases the client on every path including throws (caveats in findings 1 & 3).
10. **Public product search LIKE-escaped** — `routes/products.ts:237-242` uses `escapeLikeTerm` (`lib/http.ts:43-45`; backslash is Postgres's default LIKE escape), same helper as the admin search (`orders.ts:115`).
11. **V1-M23 topup `reviewed_by` migration ↔ schema match, guarded against double-apply** — `migrate.ts:1362-1380`: `ALTER TABLE wallet_topups ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(100)` == `shared/db/src/schema/wallet_topups.ts:34-41` (varchar(100), nullable) == test harness DDL `backend/src/test/db.ts:261-262`; written inside the *status-guarded* pending→approved/rejected flip (`topup.service.ts:364-375`, `:630-641` — money logic byte-identical to base); Telegram webhook approvals carry the actor tag (`telegram-webhook.ts:170,175`); admin list surfaces `reviewed_by`/`reviewed_at` (`admin/topups.ts:116-117`) and the audit rows carry it (`:149`, `:186`); the fingerprint fast-path cannot skip it on a new build (composite codeHash+schemaHash marker — `migrate.ts:1390-1418`).
12. **OpenAPI + generated clients match the new routes** — `shared/api-spec/openapi.yaml` adds `/admin/orders/{id}/credentials` (getAdminOrderCredentials), `has_credentials` on admin order rows + wallet recent_orders, `reviewed_by`/`reviewed_at` on the topup schema; regenerated: `shared/api-client-react/src/generated/api.ts:3753` (route builder) + `api.schemas.ts:1111` (`reviewed_by`), `shared/api-zod/src/generated/api.ts:1592`. Ran the repo's own contract gate at HEAD (`node --experimental-strip-types scripts/check-openapi-routes.ts`): **PASS** — "83/83 enforced… in sync".
13. **www→non-www redirect removal (f10bb9b) — no security regression found** — zero remaining `req.hostname` / host-dependent response content in backend (grep; SEO routes use fixed `APP_URL` — `routes/seo.ts:18`), so no host-header cache-poisoning surface introduced; CORS gate + CSRF gate remain exact scheme+host matches on the configured list (`app.ts:335-369`, `:752-766`) and the deployed allowlist covers both hosts (`deploy/env.compose.example:25` — `APP_ORIGINS=https://subnation.ly,https://www.subnation.ly`), so `www.subnation.ly` still passes CORS/CSRF and authenticates normally; cookies are host-only, `SameSite=lax` (`lib/cookie-options.ts:12-20`) — whichever host the browser lands on (Cloudflare 307s apex→www) works self-consistently; helmet/CSP/HSTS untouched in the range. Residual (accepted): apex-issued sessions die once when traffic consolidates on www — a one-time logout, not a security issue.
14. **Money paths sacred & untouched** — `checkout.service.ts`, `refund.service.ts`, loyalty/points ledger, `lib/ledger.ts`, `lib/money.ts` not in the diff; `TopupService.approve/reject` changes are attribution-only inside the already-guarded flip — the double-credit battery (status-guarded UPDATE + rows-affected check + optimistic wallet-balance lock + atomic ledger insert, `topup.service.ts:358-436`) is unchanged.
15. **whatsapp-watch send-failure ratio watch + `whatsapp_channel` AlertType** — coherent: rolling 60-min window, threshold 3, clear-before-await discipline, dedupe key `whatsapp:sendfails:{token}` (`whatsapp-watch.ts:251-325`); `AlertType` union now declares `whatsapp_channel` and the `as unknown as AlertType` casts are gone (`jobs/alertLogger.ts:34`, `whatsapp-watch.ts:132,152`); warm-up self-checks and pre-send session failures also feed the counter (`openwa.service.ts:592-594, 967-977, 1128-1131, 1166-1172`).
16. **requireAdmin change is additive-only** — `middlewares/requireAdmin.ts:99-127`: `username` added to the *existing* PK lookup + materialized as `adminUsername`; 2FA temp-token rejection (`:62-67`), sid session enforcement (`:77-93`), isActive check unchanged — the rest of the 32-line diff is prettier reflow.
17. **Copilot query-string preservation (A7-4) works** — `admin-request-tool.ts:257-271`: `pathname + search` is rebuilt from the URL-normalized form and re-checked against the allowlist (prefix/denylist checks normalize via `new URL(...).pathname`, which strips the query — so the combined re-check can't be smuggled past; see finding 5 for the benign `//` edge).
18. **Idempotency middleware unchanged in range** — replay cache still redacts `delivered_email/password/extra_details` before caching (`middlewares/idempotency.ts:67-85`), still per-admin/per-user keyed, still never caches non-2xx.

---

## NOT-BUGS explicitly checked and cleared

- Route shadowing: `GET /orders/:id/credentials` has no competing `/orders/:...` GET in the admin router (`grep router.(get|post|...)(\s*"/orders` → only `/orders` and `/orders/:id/credentials`).
- `has_credentials` semantics for legacy plaintext rows: non-null columns → `true` (correct; safeDecrypt passes plaintext through on reveal).
- The credentials route works through the copilot loopback with the same permission scope + audit (no privilege escalation surface).
- Bulk-status notifications (A9-1) are sequential `createNotification` calls (max 200/batch, non-fatal by contract) — latency only, no integrity impact.
- `escapeLikeTerm` escapes `\` first, so injected escapes can't be neutralized; values remain bound parameters.

## Summary

The R116 backend overhaul is **substantially as reported**: the credential-on-demand rework, finance scoping, no-store parity, LIKE escaping, memoized key, throttled warn, and V1-M23 are all real and correct at HEAD. The two items that fail re-verification: the **A7-2 boot warning (dead code — deleted by the f10bb9b fix commit)** and the **advisory-lock implementation, which is functionally correct but holds a shared-pool client across a ~30 s external send against a pool of 8** — the only P2. No P0/P1; no money-integrity regression found in the range.
