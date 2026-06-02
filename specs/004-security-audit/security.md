# SubNation Security Assessment

**Audit baseline**: branch `004-security-audit` @ `1711081c4cbd1bddddf4408479e365aaccb3c23e` (short: `1711081`)
**Audit window**: 2026-06-02 (single-day audit)
**Auditor**: Claude (Opus 4.7) on behalf of repo owner
**Severity scale**: see `research.md` §2 — Critical / High / Medium / Low.
**Classification scale**: per claim — proven / likely / hypothesis (see `research.md` §1 D-10).
**Distribution**: internal only — product owner, engineering, authorized reviewers. This document describes attack paths and is not for external publication.

---

## 1. Executive Summary

**Overall posture: acceptable-with-caveats.** SubNation's defense-in-depth is unusually strong for a platform of its size — the Constitution is being honored in code, not just in document form. Customer auth (Google + Telegram + WhatsApp OTP), admin auth (argon2id + TOTP + lockout + live `isActive`), the purchase transaction (atomic, optimistically locked, ledger-backed), the rate-limit topology, and the frontend XSS posture (zero `dangerouslySetInnerHTML`, sentinel-pattern auth state) are all in good shape. The audit found **zero** Critical, High, or Medium findings on the customer-facing authentication surface beyond two specific, fixable issues; **zero** findings on the customer frontend; and **zero** findings on the purchase critical path.

What is _not_ in good shape is **the admin-side wallet path**. Two endpoints — admin user-wallet adjustment (`PATCH /api/admin/users/:id`) and admin order-refund (`PATCH /api/admin/orders/bulk-status`) — mutate balances **without writing ledger entries and without transaction wrapping**. They violate Constitution Principle I, which is non-negotiable. A compromised or careless admin can move money in ways the audit trail cannot reconstruct. This is the single most important issue in the assessment.

**Top three risks** (urgent):

1. **F-004** (Critical) — admin wallet adjustment endpoint mutates `walletBalance` without a ledger entry and without a transaction. Any adjustment is invisible to the append-only ledger; double-clicks and network retries double-credit because there is no idempotency key.
2. **F-005** (Critical) — admin "refund" status flag on an order updates `orders.status` only. The user's wallet is **not** credited and no ledger entry is written. A refunded order looks refunded in the order list but the customer never gets their funds back, and there is no audit trail to reconstruct what happened.
3. **F-001** (High) — admin JWT signing key is derived from the customer JWT key by string concatenation (`SESSION_SECRET + "_admin"`). A leak of `SESSION_SECRET` instantly compromises admin tokens. Constitution Principle II requires admin sessions to use a _separate_ secret; the spirit is broken even though both fields exist.

**What is safe enough today**: customer auth flows, the customer purchase path, the frontend, the rate-limit pyramid, the secret-fail-fast posture, and the supply-chain hygiene (gitleaks + lint-staged + CI gates). Telegram replay protection, WhatsApp OTP rate limiting, Firebase phone-provider rejection, and admin lockout are all proven correct in the committed code.

**What is most urgent**: F-004, F-005, F-001 — the admin-side wallet/auth issues. They share a common shape: surface-level features that quietly skip the durable invariants the rest of the codebase enforces. The fixes are scoped (wrap in transactions, add ledger entries, separate the admin secret env var) and reversible.

**What this audit did NOT do**: no code changes, no migrations, no infrastructure changes, no secret rotation, no probes against any environment. Every state-changing concern below is grounded in committed source at the pinned commit, not in live behavior. Race-condition findings are explicitly classified as `hypothesis` because reproducing them would mutate the append-only ledger.

---

## 2. Threat Model

### Threat actors

- **Unauthenticated internet user** — `realismFloor: commodity`. Goals: discover unauthenticated state-changing endpoints, brute-force admin login, find leaked secrets via gitleaks miss, reach internal diagnostics. Capabilities: any HTTP request.
- **Authenticated low-privilege buyer (`User`)** — `realismFloor: commodity`. Goals: gain free credentials, drain another user's balance, escalate to admin, replay successful checkouts. Capabilities: signed httpOnly session cookie; can call any user-facing API at the Constitution-defined rate limits.
- **Targeted attacker (post-OAuth-compromise)** — `realismFloor: targeted`. Goals: impersonate a victim using a single compromised provider identity; pivot via account linking; observe URL/referrer leakage of session tokens. Capabilities: control of a Google / Telegram / WhatsApp identity that may match a SubNation user's contact info.
- **Malicious or careless admin** — `realismFloor: targeted`. Goals: move balances without trail, refund without crediting, double-credit a friend. Capabilities: full admin permissions limited only by RBAC scope.
- **Compromised external-provider tenant** — `realismFloor: targeted`. Goals: forge auth callbacks; replay verified payloads. Capabilities: control of the OpenWA host, Telegram bot account, or Firebase project credentials.

### Highest-value assets

1. **Wallet balance + ledger consistency invariant** — Constitution Principle I; the audit's primary focus.
2. **Admin session token** — gates every elevated operation; live-revocable via `isActive` flag.
3. **`SESSION_SECRET`** — boot-validated to ≥ 32 chars; signs both customer JWTs and (via concatenation, see F-001) admin JWTs.
4. **`ENCRYPTION_KEY`** — AES-256-GCM key for inventory `account_password` at rest.
5. **OAuth tokens / OTP secrets** — Firebase ID tokens, Telegram bot token, OpenWA tokens, WhatsApp OTP HMAC keys.
6. **Order / inventory atomicity** — concurrent purchases must not oversell or overdraft.

### Attack surfaces in scope

The 47 surfaces enumerated in `research.md` §3, grouped: Auth (Google / Telegram / OpenWA / sessions / JWT / linking / admin), Authz (admin / user / order / wallet / product / IDOR), Wallet (top-up / atomicity / ledger / coupon / purchase / refund / replay), API (validation / params / route guards / CSRF / CORS / redirects / URLs / webhooks / callbacks), Infra (Render / Neon / Redis / Cloudflare / env / secrets / logs / rate limits / health), Frontend (auth state / rendering / images / links / XSS / data exposure / admin separation), Supply Chain (deps / build / debug / obsolete / logs / pre-commit).

### Trust boundaries

- **Browser ↔ App (origin)** — Helmet/CSP, CORS allow-list, CSRF Origin/Referer (in production), httpOnly cookie. Currently the strongest layer.
- **Cloudflare edge ↔ App origin** — `trust proxy: 1` + `cloudflareClientIp` middleware reads `CF-Connecting-IP`. Audit cannot verify the assumption that every request reaches the origin via Cloudflare (CG-04). If that assumption is wrong, rate limits are ineffective.
- **App ↔ Neon (Postgres)** — `sslmode=require`, pooled connections. Audit cannot verify the IP allow-list (CG-05).
- **App ↔ Redis** — used for rate-limit, leader-lock, socket adapter. Production fail-closed on connection error.
- **App ↔ Telegram bot platform** — HMAC-verified payloads with freshness window (30 min widget, 24 h Mini App) + Redis single-use replay protection.
- **App ↔ Firebase** — ID-token verified via Admin SDK (note: `checkRevoked` parameter currently silently ignored — F-002).
- **App ↔ OpenWA host** — OTP HMAC-bound to `(phone, purpose)`; OpenWA host's internal config opaque to this audit.
- **App ↔ Render / Cloudflare / Sentry / Neon dashboards** — out of repo scope; tracked as CG-04 / CG-05 / CG-06 / CG-07.

---

## 3. Findings

### F-001 — Admin JWT signing key derived from customer secret

**Severity**: High
**Subsystem**: AUTH-5 / AUTH-8
**Affected assets**: admin session token, `SESSION_SECRET`
**Crosses trust boundary**: browser ↔ app
**Exploitability**: Chained
**Urgency**: urgent
**CVE / CWE**: CWE-330 (use of insufficiently random values, applied semantically)

#### Impact

A leak of `SESSION_SECRET` — already gated as a Critical-class secret — instantly produces the admin signing key. There is no extra step between "customer secret leaked" and "attacker can sign valid admin tokens." Constitution Principle II calls for admin sessions to use a separate secret; the implementation has the _cookie name_ separate but the _secret material_ is not.

#### Claims

- **[proven]** `ADMIN_JWT_SECRET = JWT_SECRET + "_admin"` is direct string concatenation (no KDF, no separate env var). Evidence: EN-001.
- **[proven]** Admin tokens are signed and verified with `ADMIN_JWT_SECRET`; a leak of `JWT_SECRET` (= `SESSION_SECRET`) yields the admin key. Evidence: EN-001 (lines 50, 55, 65 of `lib/jwt.ts`).
- **[likely]** No alternative independent admin-key path exists in code; the boot validation in `lib/jwt.ts:13` only enforces `SESSION_SECRET ≥ 32 chars` — not a separate admin secret. Evidence: EN-001, EN-004. _Why not promoted_: a separate path could exist behind a feature flag the audit did not see; the code at the pinned commit suggests not.

#### Reproduction

1. Open `backend/src/lib/jwt.ts:22` at commit `1711081`. Confirm: `export const ADMIN_JWT_SECRET: string = JWT_SECRET + "_admin";`
2. Open `backend/src/lib/env.ts` and confirm there is no separate `ADMIN_JWT_SECRET` or `ADMIN_SESSION_SECRET` environment variable read.
3. Confirm at `backend/src/lib/jwt.ts:50, 55, 65` that admin sign / verify use this derived value.

#### Recommendation

**Direction**: introduce `ADMIN_JWT_SECRET` (or `ADMIN_SESSION_SECRET`) as a separate environment variable, validate ≥ 32 chars at boot independently from `SESSION_SECRET`, fail-fast in production if missing or weak. Update `lib/jwt.ts` to read the new var with no fallback to derivation.
**Size**: quick-win
**Reversibility**: reversible-with-care (existing admin sessions become unverifiable on rotation; plan a brief admin-logout window)
**Dependencies**: env-var addition in Render dashboard (`sync: false`); operations runbook entry for the rotation; `config/env.example` update.

#### Notes

The string-concat pattern was likely chosen for "simplicity in development" — it makes spinning up local environments easy. The fix is one line of code plus one operations step.

---

### F-002 — `verifyFirebaseIdToken` silently ignores `checkRevoked`

**Severity**: High
**Subsystem**: AUTH-1
**Affected assets**: Firebase customer session
**Crosses trust boundary**: app ↔ Firebase
**Exploitability**: Chained
**Urgency**: urgent
**CVE / CWE**: CWE-613 (insufficient session expiration) + CWE-440 (expected behavior violation)

#### Impact

Two callers in `routes/auth.ts:359` and `:457` pass `checkRevoked = true` in good faith expecting Firebase to enforce token revocation. The function silently substitutes `false`, so revoked Firebase ID tokens (e.g., user clicked "sign out from all devices" in a Firebase-aware admin tool, or Firebase Console revoked the user) remain valid for up to one hour. This is the gap between _expected_ and _actual_ behavior — the source-comment claims "always pass false for compatibility" but the function still _accepts_ and _logs_ the parameter, producing a false sense of safety in code review.

#### Claims

- **[proven]** Function signature is `verifyFirebaseIdToken(idToken: string, checkRevoked = false)`; line 160 calls `auth.verifyIdToken(idToken, false)` with the literal `false`, not the parameter. Evidence: EN-002.
- **[proven]** Two routes call with `true`, expecting enforcement. Evidence: EN-002 (`routes/auth.ts:359, :457`).
- **[likely]** No alternative revocation path exists in the SubNation backend (e.g., a session-id allow-list in Redis that admins can clear). Evidence: searched `backend/src/lib/session.ts` and admin routes; no explicit per-user invalidation found.

#### Reproduction

1. Open `backend/src/services/firebase-auth.service.ts:85` at commit `1711081`; observe the parameter declaration.
2. Open `:160`; observe `auth.verifyIdToken(idToken, false)` — literal `false`.
3. Open `:167` to confirm the parameter is logged but discarded.
4. Open `routes/auth.ts:359` and `:457`; observe `verifyFirebaseIdToken(id_token, true)` callers.

#### Recommendation

**Direction**: forward the `checkRevoked` parameter to the underlying SDK call: `auth.verifyIdToken(idToken, checkRevoked)`. If the original "compatibility" concern (extra round-trip causing 401s) is real, instead make `checkRevoked = false` the default at the _call sites_ (be explicit) rather than silently dropping the caller's intent. Add a brief test: `expect(mockedAdmin.verifyIdToken).toHaveBeenCalledWith(token, true)` for the routes that pass `true`.
**Size**: quick-win
**Reversibility**: fully-reversible
**Dependencies**: none.

---

### F-003 — Account linking auto-completes on single-candidate match without explicit consent

**Severity**: Medium
**Subsystem**: AUTH-7
**Affected assets**: customer account integrity
**Crosses trust boundary**: app ↔ Google / Telegram / WhatsApp
**Exploitability**: Chained
**Urgency**: can-wait
**CVE / CWE**: CWE-441 (unintended proxy or intermediary)

#### Impact

A targeted attacker who controls one provider identity (e.g., a Telegram username matching a victim's expected handle, or an email-verified Google account whose email matches the victim's profile) can be silently linked into the victim's existing SubNation account. Once linked, the attacker can sign in as the victim. This is a social-engineering surface, not a remote attack — but it bypasses the customer's awareness.

#### Claims

- **[proven]** When `findLinkCandidates` returns exactly one user, the backend silently links the new provider identity to that account without requesting confirmation. Evidence: EN-003.
- **[likely]** No frontend confirmation step is invoked before this auto-link; the audit did not deep-read the frontend OAuth-completion flow (CG-08), but the backend would have to _receive_ a confirmation token to gate the link, and no such token is required by the route signature. Evidence: EN-003 + audit's read of `routes/auth.ts` and `auth-settings.ts`. _Why not promoted_: CG-08 is open; a frontend-only confirmation that depends on no backend input would close this finding.

#### Reproduction or Hypothesis (mixed)

- **Reproduction (proven part)**: open `backend/src/services/firebase-auth.service.ts:311-335`; observe single-match auto-link without consent token.
- **Hypothesis (likely part)**: `whatWouldConfirm` = a frontend-flow read-through showing no confirmation gate; `whyNotRun` = audit scoped to backend evidence; `confirmationCost` = cheap.

#### Recommendation

**Direction**: when `findLinkCandidates` would link, return 409 with a short-lived link token; require the user to re-submit with the token (and ideally re-authenticate via the original provider) before the link is committed. Audit-log the consented link.
**Size**: structural
**Reversibility**: reversible-with-care (two-step UX may surprise existing flows)
**Dependencies**: matched frontend update; UX writing for the confirmation modal.
**Justification (for size > quick-win)**: a one-line backend reject is not enough — the user-facing flow must change to surface the consent step. That involves frontend, backend, audit log, and a brief operations-runbook entry. Smaller scopes (e.g., disable linking entirely) regress the use case the feature was added for.

---

### F-004 — Admin wallet adjustment endpoint bypasses ledger and transaction

**Severity**: Critical
**Subsystem**: WALLET-3 / WALLET-6
**Affected assets**: wallet balance, ledger consistency invariant
**Crosses trust boundary**: browser ↔ app (admin)
**Exploitability**: Direct (any admin with `users` permission scope)
**Urgency**: urgent
**CVE / CWE**: CWE-471 (modification of assumed-immutable data) + CWE-359 (audit trail integrity)

#### Impact

`PATCH /api/admin/users/:id` accepts `wallet_adjustment` or `wallet_balance` and mutates `users.walletBalance` directly. There is no `db.transaction()` wrapper. There is no `insertLedgerEntry()` call. The append-only ledger does not record the change. Reconstruction of any user's balance from the ledger will diverge from the actual balance. Constitution Principle I is **non-negotiable** and this endpoint violates it.

A careless admin double-click or a network-retry of the PATCH double-credits without idempotency (see also F-008). A malicious admin can quietly move balance and the ledger has no record.

#### Claims

- **[proven]** Endpoint accepts `wallet_adjustment` / `wallet_balance` in the request body. Evidence: EN-006 (`backend/src/routes/admin/users.ts:73-84`).
- **[proven]** The mutation writes `users.walletBalance` directly without `db.transaction()`. Evidence: EN-006 (line ~80, ~97-101).
- **[proven]** No `insertLedgerEntry()` call exists in this file; `git grep insertLedgerEntry backend/src/routes/admin/users.ts` returns zero. Evidence: EN-006.
- **[proven]** The ledger schema _does_ support `type = "adjustment"` (`shared/db/src/schema/wallet_ledger.ts:17`), so the omission is the route's, not a schema limitation. Evidence: EN-006.
- **[proven]** `writeAuditLog` is called (line ~103) but records only the _fields changed_, not the amount or before/after balances. Evidence: EN-006.

#### Reproduction

1. Open `backend/src/routes/admin/users.ts:66-114` at commit `1711081`. Read the handler end-to-end.
2. Confirm the absence of `db.transaction(` in the file.
3. Confirm the absence of `insertLedgerEntry(` in the file.
4. Open `backend/src/services/checkout.service.ts:103-180` for the _correct_ pattern that this endpoint should follow.

The audit did **not** execute the endpoint against any environment (FR-041). The shape of the gap is fully evident from read-only inspection.

#### Recommendation

**Direction**: rewrite the wallet-adjustment branch of `PATCH /api/admin/users/:id` to mirror the topup-approval pattern: wrap in `db.transaction()`; read the user's current balance inside the tx; write `walletBalance` with `WHERE walletBalance = $expected` (optimistic lock); call `insertLedgerEntry({ type: "adjustment", balanceBefore, balanceAfter, referenceType: "admin_adjustment", referenceId: <admin-action id> })`; require a non-empty `note` field for compliance; require an `Idempotency-Key` header (see F-008).
**Size**: structural
**Reversibility**: fully-reversible
**Dependencies**: shape of the audit-log payload (add `amount`, `balanceBefore`, `balanceAfter`); admin UI re-tests.
**Justification**: a "simpler" fix (just add the ledger write outside the transaction) does not solve concurrency, does not solve idempotency, and does not match the rest of the codebase's discipline. A scoped refactor that produces one correct shape across all admin balance mutations is the smaller cost than fragmenting "kind of correct" patterns.

---

### F-005 — Admin order-refund endpoint does not credit wallet or write ledger

**Severity**: Critical
**Subsystem**: WALLET-3 / WALLET-6
**Affected assets**: wallet balance, ledger consistency invariant, customer trust
**Crosses trust boundary**: browser ↔ app (admin)
**Exploitability**: Direct
**Urgency**: urgent
**CVE / CWE**: CWE-471 + CWE-359

#### Impact

`PATCH /api/admin/orders/bulk-status` allows the admin to set `status = "refunded"` on one or more orders. The endpoint updates `orders.status` only. The user's `walletBalance` is **not** restored. No `wallet_ledger` entry of type `refund` is written. The order shows "refunded" in the order list, but the customer never receives their funds back, and there is no audit trail explaining the gap. The audit considers this the highest-impact finding for _customer trust_: a user who sees "refunded" expects their balance back, and the system silently fails them.

The `orders` schema even has `walletBalanceBefore` / `walletBalanceAfter` columns intended for exactly this pattern; the endpoint ignores them.

#### Claims

- **[proven]** `ORDER_STATUS_VALUES` (`backend/src/routes/orders.ts:71`) includes `"refunded"`. Evidence: EN-007.
- **[proven]** Bulk-status handler updates `orders.status` only; no `users` table update; no `insertLedgerEntry`. Evidence: EN-007 (`backend/src/routes/admin/orders.ts:73-108`, lines 81-84).
- **[proven]** `orders` schema carries `walletBalanceBefore` / `walletBalanceAfter` (`shared/db/src/schema/orders.ts`), demonstrating the original design intent that refunds reverse them. Evidence: EN-007.

#### Reproduction

1. Open `backend/src/routes/admin/orders.ts:73-108` at commit `1711081`.
2. Search the file for `walletBalance`, `insertLedgerEntry`, `db.transaction` — none present.
3. Open `shared/db/src/schema/orders.ts` and observe the `walletBalanceBefore` / `walletBalanceAfter` columns.

The audit did not run a refund (FR-041). The shape is fully evident.

#### Recommendation

**Direction**: introduce a `RefundService` parallel to `TopupService`. For each order being marked `refunded`, atomically: re-read the order's `walletBalanceBefore` / `walletBalanceAfter`, compute the refund amount, debit no inventory (it stays consumed), credit the user's wallet via `users.walletBalance` UPDATE with optimistic lock, write a `wallet_ledger` entry of type `refund` referencing the order, and only then transition `orders.status` to `refunded`. Reject if the order is already `refunded` (idempotency by status). Audit-log the action.
**Size**: structural
**Reversibility**: fully-reversible
**Dependencies**: schema migration NOT required (columns already exist); admin UI may want a confirm-and-summarize step before bulk-refund (UX; not blocking).
**Justification**: the endpoint shape today implies refunds are a status-flag toggle. The fix changes that semantically — refunds become full transactions. This is "structural" because the calling admin UI may also expose stale assumptions (e.g., "I refunded these 5 orders, why did one fail?"). A quick patch that just adds a single ledger entry without idempotency would re-create F-008 in the refund domain.

---

### F-006 — Coupon `maxUses` race: validation outside transaction; increment not guarded

**Severity**: High
**Subsystem**: WALLET-4
**Affected assets**: coupon revenue policy, ledger consistency invariant
**Crosses trust boundary**: browser ↔ app (customer)
**Exploitability**: Chained (requires concurrent purchases of the same coupon)
**Urgency**: urgent
**CVE / CWE**: CWE-362 (TOCTOU)

#### Impact

Two concurrent purchases of a coupon with `maxUses = 1` and current `usedCount = 0` both read `usedCount = 0` (validation passes for both), then both enter their checkout transactions and both increment, ending at `usedCount = 2`. Both purchases succeed. Revenue policy is violated quietly; an attacker who knows the coupon is bounded can exploit this with two browser tabs at scale.

#### Claims

- **[proven]** Validation read at `backend/src/lib/pricing.ts:159` is non-transactional (`resolveCoupon()` runs outside the checkout `db.transaction`). Evidence: EN-008.
- **[proven]** The checkout's coupon-increment UPDATE (`backend/src/services/checkout.service.ts:126-131`) uses atomic SQL but lacks `WHERE usedCount < maxUses` (i.e., it does not re-validate inside the lock). Evidence: EN-008.
- **[likely]** Reproduction would mutate the coupon ledger in real environments; therefore classified as `hypothesis` for the race itself per FR-021 / D-10 (the _gap_ is proven; the _race outcome_ requires concurrency to confirm).

#### Hypothesis

- **What would confirm**: two concurrent checkouts in a staging environment with a `maxUses = 1` test coupon; observe final `usedCount = 2`.
- **Why this audit did not run it**: would mutate the coupon ledger and the order/wallet state; FR-041 forbids state-changing probes.
- **Confirmation cost**: cheap (10 minutes in staging once there is a clean test fixture).

#### Recommendation

**Direction**: move coupon validation _inside_ the checkout transaction. Either (a) `SELECT ... FOR UPDATE` on the coupon row at the start of the tx and re-validate `usedCount < maxUses` before incrementing, OR (b) make the increment atomic-with-check: `UPDATE coupons SET usedCount = usedCount + 1 WHERE id = $id AND usedCount < maxUses`; check `rowsAffected = 1`, else throw. Approach (b) is the cheapest and reverses cleanly.
**Size**: quick-win
**Reversibility**: fully-reversible
**Dependencies**: none.

---

### F-007 — Topup approval lacks optimistic lock on wallet balance

**Severity**: High
**Subsystem**: WALLET-1 / WALLET-2
**Affected assets**: wallet balance, ledger consistency invariant
**Crosses trust boundary**: browser ↔ app (admin)
**Exploitability**: Chained (requires concurrent operations against the same user balance)
**Urgency**: urgent
**CVE / CWE**: CWE-362 (TOCTOU) on a financial primitive

#### Impact

When an admin approves a top-up, the UPDATE at `topup.service.ts:106-110` uses `WHERE id = $topupId AND status = 'pending'`. The status guard prevents the _same topup_ from being approved twice (idempotent for one resource). But it does **not** guard the user's wallet balance against concurrent mutations: a second concurrent topup approval, or a concurrent purchase, can produce a lost-update where one topup's credit silently disappears. Sum-of-ledger-entries will diverge from actual balance.

The same codebase shows the _correct_ pattern at `checkout.service.ts:122` (`WHERE walletBalance = $expected`). The divergence is what makes this a finding rather than a hypothetical.

#### Claims

- **[proven]** The UPDATE at `topup.service.ts:106-110` lacks a `walletBalance = $expected` guard. Evidence: EN-009.
- **[proven]** The same codebase implements the correct pattern in checkout. Evidence: EN-011.
- **[likely]** Reproduction would mutate the ledger; classified `hypothesis` for the race outcome.

#### Hypothesis

- **What would confirm**: in staging, fire two topup approvals concurrently for the same user with starting balance 100 and amounts 50 and 50. Expected with optimistic lock: balance → 200, two ledger entries. Without it: balance → 150 (one update overwrites), still two ledger entries → ledger sum (200) ≠ balance (150).
- **Why this audit did not run it**: FR-041; would mutate ledger.
- **Confirmation cost**: cheap.

#### Recommendation

**Direction**: add `eq(usersTable.walletBalance, balanceBefore)` to the UPDATE's WHERE clause inside the topup-approval transaction. Validate `rowsAffected = 1`; throw `CONCURRENCY_ERROR` and let the admin UI retry on failure. Mirror the `checkout.service.ts:122` pattern exactly.
**Size**: quick-win
**Reversibility**: fully-reversible
**Dependencies**: none.

---

### F-008 — Admin wallet adjustment lacks idempotency key

**Severity**: High
**Subsystem**: WALLET-7 / WALLET-6
**Affected assets**: wallet balance, ledger consistency invariant
**Crosses trust boundary**: browser ↔ app (admin)
**Exploitability**: Direct (admin double-click or network retry)
**Urgency**: urgent

#### Impact

Companion to F-004. A retried PATCH (network duplicate, admin double-click, browser back-button-with-resubmit) re-applies the adjustment. Combined with F-004 (no ledger entry), the second adjustment is invisible to audit. "Funds appear from thin air; balance increases without visible cause" is the failure mode.

#### Claims

- **[proven]** No `Idempotency-Key` header is read or required by `PATCH /api/admin/users/:id`. Evidence: EN-010.
- **[proven]** No request-deduplication cache exists at the route layer. Evidence: search `backend/src/lib/` for "idempotency" returns no admin-side mechanism.
- **[likely]** Network retries are realistic on the admin tier (Render's free-tier latency, mobile admin interfaces during bulk-approval).

#### Reproduction

Static: open `backend/src/routes/admin/users.ts:66-114`; observe no `req.headers["idempotency-key"]` read; observe no dedup cache; observe the audit-log call records only the request, not a unique mutation receipt.

Live reproduction not run (would mutate ledger; FR-041).

#### Recommendation

**Direction**: bundle with F-004's structural fix. The transactional rewrite of the adjustment endpoint should require an `Idempotency-Key` header on every state-changing admin endpoint, store `(idempotency_key, response_summary)` in Redis with a 24-hour TTL, and short-circuit duplicate requests with the cached response. Apply the same pattern to F-005's refund endpoint.
**Size**: structural
**Reversibility**: fully-reversible
**Dependencies**: agreed `Idempotency-Key` middleware shape; admin UI must generate and send the key (UUID v4 per logical action).
**Justification**: F-004 + F-005 + F-008 share one mechanism (admin-side mutation hygiene). Implementing them as one bundled change is cheaper and produces a consistent admin API contract; implementing them piecemeal lets the next admin endpoint regress.

---

### F-009 — CSRF Origin/Referer check disabled outside production

**Severity**: Medium
**Subsystem**: API-4
**Affected assets**: dev-environment integrity, accidental sensitive operations during local testing
**Crosses trust boundary**: browser ↔ app
**Exploitability**: Chained (requires attacker to lure a developer with a running local instance)
**Urgency**: can-wait
**CVE / CWE**: CWE-352 (CSRF) — production-only; this finding is the dev gap.

#### Impact

Outside `NODE_ENV === "production"`, the Origin/Referer check is bypassed entirely. A developer running a local dev server with realistic credentials, who then visits a hostile origin in the same browser, can be tricked into issuing a state-changing request to their dev server. In production the protection works correctly; the finding is the dev-environment hygiene gap. Constitution wording is "CSRF check on all state-changing requests via Origin/Referer" — without "in production."

#### Claims

- **[proven]** The middleware body is gated by `if (process.env.NODE_ENV === "production" && csrfAllowedOrigins.length > 0)`. Evidence: EN-012 (`backend/src/app.ts:472`).
- **[proven]** No alternative dev-mode origin allow-list exists. Evidence: searched the same middleware for an `else` branch; none.

#### Reproduction

1. Set `NODE_ENV` to anything other than `"production"` (e.g., development).
2. From a browser tab on a different origin, submit a form to a state-changing dev-server endpoint.
3. Observe the request is processed (no 403).

Live reproduction not run on this audit (the audit is not running probes), but the gate is plain in source.

#### Recommendation

**Direction**: remove the `NODE_ENV` guard. Always run the Origin/Referer check. In dev, default `csrfAllowedOrigins` to `["http://localhost:5173", "http://127.0.0.1:5173"]` (matches `FRONTEND_PORT` default) and any explicit `CSRF_ALLOWED_ORIGINS` env-var value. The current dev experience does not benefit from disabling the check; it benefits from a permissive but explicit allow-list.
**Size**: quick-win
**Reversibility**: fully-reversible
**Dependencies**: minor `config/env.example` doc update.

---

### F-010 — JWT exposed in redirect URL query string (Telegram callback path)

**Severity**: Low
**Subsystem**: API-7
**Affected assets**: customer session token
**Crosses trust boundary**: browser ↔ app
**Exploitability**: Theoretical (requires later access to browser history / referrer logs / proxy logs)
**Urgency**: can-wait
**CVE / CWE**: CWE-598 (sensitive info in URL)

#### Impact

After Telegram-redirect verification, the server's redirect target is `/auth/callback?token=<JWT>`. The token appears in browser history, in the `Referer` header on the next outbound navigation, and in any HTTP-access logs along the path. The same response also sets the httpOnly cookie, so the query-string copy is _redundant_. The JWT lifetime is 30 days. A device that is compromised at any point in those 30 days has the token in browser history.

This is Low because (a) the cookie is the primary transport, (b) the query string is not the only way an attacker would steal the token, (c) a fully exploited compromise is more impactful than a referrer leak. But it is a real, simple finding.

#### Claims

- **[proven]** `res.redirect(/auth/callback?token=${encodeURIComponent(result.token)})` at `backend/src/routes/auth-settings.ts:858`. Evidence: EN-013.
- **[proven]** The httpOnly cookie is also set on the same response (the Firebase path at `routes/auth.ts:404-410` already does this; the Telegram path inherits the same response shape). Evidence: EN-013 + same file context.

#### Reproduction

1. Trigger the Telegram redirect flow; observe in DevTools that `/auth/callback?token=...` is visited and the cookie is set on the same response.
2. Navigate from `/auth/callback` to any external link; observe the `Referer` header carrying the token.

Live reproduction is browser-side and read-only; this audit did not run it but the path is unambiguous in source.

#### Recommendation

**Direction**: drop `?token=` from the redirect URL. Rely on the httpOnly cookie alone for session establishment; the frontend at `/auth/callback` can read its own status by hitting `/api/auth/probe`. If the frontend has a current dependency on reading the token from the query string, replace it with a cookie-driven `useAuth` hook.
**Size**: quick-win
**Reversibility**: fully-reversible
**Dependencies**: minor frontend-side check that the token query param is not still being read.

---

### F-011 — Dockerfile runtime stage runs as root

**Severity**: Medium
**Subsystem**: SUP-2
**Affected assets**: container blast radius
**Crosses trust boundary**: app ↔ container runtime
**Exploitability**: Chained (requires a separate RCE in the application)
**Urgency**: can-wait

#### Impact

The Node process runs as UID 0 inside the container. Any code-execution vulnerability in the app (a future dep CVE, an unchecked eval, etc.) becomes container-root code execution. Render's managed environment limits the blast radius (no host access), but defense-in-depth says "do not run as root" regardless. This is best-practice deviation rather than a current exploit path.

#### Claims

- **[proven]** No `USER` directive in any stage of the Dockerfile; no `addgroup`/`adduser` step. Evidence: EN-014.

#### Reproduction

1. Open the Dockerfile at commit `1711081`.
2. Search for `USER`, `addgroup`, `adduser` — none present.
3. (Optional, runtime check: `docker inspect <image> | grep User` would print empty / `root`.)

#### Recommendation

**Direction**: in the runtime stage, `RUN addgroup -S node && adduser -S node -G node`, then `USER node` before `CMD`. Verify file permissions on `/app` are readable by the `node` user. The `node:22-alpine` base image already provides a `node` user; consider just `USER node` after confirming the build artifacts are owned readably.
**Size**: quick-win
**Reversibility**: fully-reversible
**Dependencies**: verify the build/runtime artifact paths are readable by a non-root user.

---

### F-012 — Logger and Sentry redaction not unit-tested end-to-end

**Severity**: Low
**Subsystem**: INFRA-7
**Affected assets**: defense-in-depth on log / Sentry surface
**Crosses trust boundary**: app ↔ Sentry
**Exploitability**: Theoretical (requires a future regression that bypasses redaction)
**Urgency**: can-wait

#### Impact

The Pino redact configuration (`lib/logger.ts`) and Sentry `beforeSend` deep-sanitizer (`lib/sentry.ts`) together cover ~57 sensitive field names plus regex for JWT-shaped strings. Implementation is structurally strong. There is no test that constructs a payload with `account_password`, `accountPassword`, a JWT-shaped `Authorization` header, etc., flushes it through both layers, and asserts the redacted output. A future regression — adding a new field name, changing the path syntax, swapping Pino versions — would silently bypass redaction without a CI signal.

#### Claims

- **[proven]** Redaction config exists and is structurally correct. Evidence: EN-015.
- **[proven]** No corresponding test exists in `backend/src/lib/__tests__/` for either layer with a malicious-payload input. Evidence: searched; the existing tests cover other modules.

#### Recommendation

**Direction**: add an integration-shaped test that constructs an HTTP request body containing every field in the `SENSITIVE_FIELD_NAMES` set (e.g., `account_password`, `accountPassword`, `current_password`, `auth_token`, `id_token`, `Authorization: Bearer eyJ...`), pushes it through a fake transport, and asserts the captured log line and the captured Sentry event do not contain the literal sensitive values. Bonus: include a JWT-shaped string under an "innocent" key name (`description: "eyJ..."`) to exercise the JWT regex.
**Size**: quick-win
**Reversibility**: fully-reversible
**Dependencies**: none.

---

## 4. Risk Ranking (summary)

The full five-input ranking lives in `priorities.md`. This compact view is for at-a-glance reference.

| ID    | Title                                                     | Severity | Urgency  | Partition  |
| ----- | --------------------------------------------------------- | -------- | -------- | ---------- |
| F-004 | Admin wallet adjustment bypasses ledger and transaction   | Critical | urgent   | structural |
| F-005 | Admin order-refund does not credit wallet or write ledger | Critical | urgent   | structural |
| F-001 | Admin JWT signing key derived from customer secret        | High     | urgent   | quick-win  |
| F-002 | `verifyFirebaseIdToken` silently ignores `checkRevoked`   | High     | urgent   | quick-win  |
| F-006 | Coupon `maxUses` race                                     | High     | urgent   | quick-win  |
| F-007 | Topup approval lacks optimistic lock on wallet balance    | High     | urgent   | quick-win  |
| F-008 | Admin wallet adjustment lacks idempotency key             | High     | urgent   | structural |
| F-003 | Account linking auto-completes without explicit consent   | Medium   | can-wait | structural |
| F-009 | CSRF check disabled outside production                    | Medium   | can-wait | quick-win  |
| F-011 | Dockerfile runtime stage runs as root                     | Medium   | can-wait | quick-win  |
| F-010 | JWT in redirect URL query string                          | Low      | can-wait | quick-win  |
| F-012 | Logger / Sentry redaction not unit-tested                 | Low      | can-wait | quick-win  |

---

## 5. Quick Wins vs. Structural Work

### 5.1 Quick wins (small, low-risk, reversible)

- **F-001** — separate `ADMIN_JWT_SECRET` env var (one line of code + Render dashboard step).
- **F-002** — forward the `checkRevoked` parameter (one-line fix, plus a regression test).
- **F-006** — add `WHERE usedCount < maxUses` to the coupon-increment UPDATE (one line).
- **F-007** — add `WHERE walletBalance = $expected` to the topup-approval UPDATE (one line; mirrors the existing checkout pattern).
- **F-009** — remove the `NODE_ENV` guard from the CSRF middleware; ship a permissive default allow-list for dev (handful of lines).

### 5.2 Structural hardening

- **F-004 + F-005 + F-008** — one bundled change. Build a small `RefundService` and `AdjustmentService`; wrap both in transactions; require ledger entries; require `Idempotency-Key` headers; share the dedup cache. The reason a quick win is insufficient is that fragmenting these three findings produces three subtly different patterns at three admin endpoints and lets the next admin endpoint regress; one consistent admin-mutation contract is the smaller cost.
- **F-003** — return 409 with a link token; require explicit re-submission to confirm. Quick-win (a one-line backend reject) is insufficient because the user-facing flow itself must change to surface the consent step.

Items not appearing in §5.1 or §5.2 are low priority and live in `priorities.md` §5 (Deferred Items) — they are the Low-severity findings (F-010, F-012, F-011) that should ship after the urgent and structural work.

---

## 6. Explicit Non-Issues

Each entry below names a surface that was inspected, that may have looked risky on first reading, and that the audit determined to be acceptable. Future audits revisiting these surfaces should not re-litigate them unless something changes.

### Non-issue: AUTH-3 — WhatsApp OTP via OpenWA

The OTP is 6 digits (CSPRNG via `randomInt`), 5-minute TTL, max 5 attempts, 60-second resend cooldown, hourly limit. The OTP is HMAC-bound to `(phone, purpose)` so a leaked hash for one purpose cannot validate against another. **Evidence**: EN-005-style ENs in the AUTH evidence pass; `backend/src/lib/whatsapp-otp.ts:29-76`.

### Non-issue: AUTH-4 — Session cookie handling

`auth_token` is httpOnly, signed, secure-in-production, `SameSite=lax`, with a 30-day `maxAge`. Frontend uses a `__cookie_session__` sentinel pattern and stores no real JWT client-side. **Evidence**: EN-022.

### Non-issue: AUTH-8 — Admin auth (argon2id, TOTP, lockout, `_admin` cookie)

Argon2id with OWASP 2024 parameters (64 MiB memory, 3 iterations, 1 parallelism). `needsRehash()` provides automatic migration. TOTP via `otplib` with `verifySync` (constant-time). 5-attempt lockout with exponential backoff (15 → 30 → 60 → 120 → 240 minutes). Live `isActive` enforcement on every admin request, not only at login. **Evidence**: EN-017 + the AUTHZ evidence pass. (Note: F-001 is about the _secret_ the admin cookie is signed with, which is a different concern from the cookie + 2FA + lockout layer above, all of which are correct.)

### Non-issue: AUTHZ-1 through AUTHZ-6 — Authorization layering

`requireAdmin` + `requirePermission(scope)` are layered on every admin sub-router. Every state-changing user route extracts `userId` from the JWT, never from `req.body`. No `req.body.userId` privilege-escalation pattern was found in any audited route. Last-admin-with-`admins`-scope guards prevent self-de-elevation. Self-edit prevention on `PATCH /api/admin/admins/:id` redirects to `/profile`. Audit log coverage is comprehensive across admin actions.

### Non-issue: WALLET-5 — Purchase flow atomicity

The customer purchase path is the _correct_ pattern that the rest of this audit references. `db.transaction()` wraps inventory claim + balance debit (with optimistic lock `WHERE walletBalance = $expected`) + coupon increment + order insert + ledger entry. Test at `backend/src/services/__tests__/checkout.test.ts:126-149` asserts atomicity by triggering rollback. Concurrency test at `:152-168` asserts exactly one of two concurrent purchases wins. **Evidence**: EN-011.

### Non-issue: API-1, API-2, API-3, API-5, API-6, API-8, API-9 — API surface

Zod `safeParse` is used systematically on state-changing route inputs. Query-parameter handling uses bounds where the value is consumed (`stats.ts:57`); Drizzle parameterizes all DB queries; no SQL-injection vector. Auth/admin guards are layered correctly. CORS uses an explicit `APP_ORIGINS` allow-list with `credentials: true` requiring exact-match origin; dev fallback gated. No open redirects (every `res.redirect` resolves a relative path; `encodeURIComponent` correctly used). No webhooks defined yet (the `/api/webhook/*` skip-list in CSRF middleware is defensive). External-provider callbacks: Telegram HMAC + freshness + Redis replay; Firebase via Admin SDK (with F-002 caveat); WhatsApp OTP HMAC-bound to `(phone, purpose)`.

### Non-issue: INFRA-3, INFRA-5, INFRA-6, INFRA-8, INFRA-9 — Infrastructure (in-repo)

Redis fail-closed in production on connection error; in-memory dev fallback. `config/env.example` carries placeholder strings only. `SESSION_SECRET ≥ 32` and `ENCRYPTION_KEY` 64 hex are validated fail-fast at boot (`lib/jwt.ts:13`, `lib/encryption.ts:7-12`). AES-256-GCM uses random 12-byte IV per encryption with auth tag included and validated. Multi-tier rate limits (600/min IP, 1200/min user, 10/15min auth) mounted in correct order with skip predicates by user state. `/api/healthz` returns minimal `{"status": "ok"}`; deeper diagnostics are admin-gated.

### Non-issue: FE-1 through FE-8 — Frontend security

Zero `dangerouslySetInnerHTML` in the entire frontend. No markdown-to-HTML rendering. Every `<img src=>` originates from server-controlled URLs. Every `target="_blank"` carries `rel="noopener noreferrer"`. No `eval` / `Function` / `innerHTML` / `document.write` with user input. localStorage holds only theme/UX preferences; zero JWT/admin-token/refresh-token client-side. Admin pages are lazy-loaded into a separate chunk; admin-side socket join requires server-side cookie verification. Sentry Replay uses `maskAllText: true` and `blockAllMedia: true`.

### Non-issue: SUP-3, SUP-4, SUP-5, SUP-6 — Supply chain hygiene (with CG-01 / CG-02)

No debug routes mounted. Phone-auth provider rejected with 403 (Constitution Principle II compliance proven at `routes/auth.ts:361-379`). 11 `console.*` calls total, all in error-fallback or boot-diagnostic paths. `.gitleaks.toml` extends defaults plus 6 custom rules; CI sequences `secret-scan` before `quality`. Manual top-15 dep sample shows no critical CVE. (Two coverage gaps remain: CG-01 for full automated CVE scanning and CG-02 for explicit gitleaks rules on `SESSION_SECRET` / `ENCRYPTION_KEY`.)

---
