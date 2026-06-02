# SubNation Security Audit — Remediation Priorities

**Linked assessment**: [`security.md`](./security.md) (same audit, same pinned commit `1711081`).
**Generated**: 2026-06-02

---

## 1. Ranking Method

Findings are ranked using five inputs (per spec FR-051 / `data-model.md` §6):

- **severity** — Critical / High / Medium / Low (canonical scale in `research.md` §2)
- **likelihood** — `near-certain` / `probable` / `possible` / `remote`
- **blast radius** — `cross-tenant` / `tenant-wide` / `multi-user` / `single-user`
- **ease of exploitation** — `trivial` / `easy` / `moderate` / `hard`
- **business impact** — `existential` / `severe` / `material` / `minor`

**Ordering rule**: primary by severity (Critical > High > Medium > Low), then by businessImpact (existential → minor), then by easeOfExploitation (trivial → hard). The full vector is shown for each finding so the rank is auditable, not just stated.

**Contested-severity resolution rule** (per `research.md` §2): when a finding is contested between criteria (e.g., low likelihood × catastrophic blast radius vs. high likelihood × moderate impact), the severity tier resolves toward the **largest possible loss**, not the most likely outcome. Critical is reserved for things that _can_ happen, not things that _will_ happen on average.

**Authoritative entity definitions**: see [`data-model.md` §6 Risk Score](./data-model.md) for the full enumeration of each input.

---

## 2. Ranked Table (every finding)

Severity column matches `security.md` §3 exactly per FR-052 / VR-RS-02.

| Rank | ID    | Title                                                     | Severity | Likelihood | Blast Radius | Ease     | Business Impact | Partition  | Urgency  |
| ---- | ----- | --------------------------------------------------------- | -------- | ---------- | ------------ | -------- | --------------- | ---------- | -------- |
| 1    | F-004 | Admin wallet adjustment bypasses ledger and transaction   | Critical | probable   | tenant-wide  | trivial  | severe          | structural | urgent   |
| 2    | F-005 | Admin order-refund does not credit wallet or write ledger | Critical | probable   | multi-user   | trivial  | severe          | structural | urgent   |
| 3    | F-001 | Admin JWT signing key derived from customer secret        | High     | possible   | tenant-wide  | easy     | severe          | quick-win  | urgent   |
| 4    | F-007 | Topup approval lacks optimistic lock on wallet balance    | High     | possible   | multi-user   | moderate | material        | quick-win  | urgent   |
| 5    | F-006 | Coupon `maxUses` race                                     | High     | possible   | multi-user   | moderate | material        | quick-win  | urgent   |
| 6    | F-008 | Admin wallet adjustment lacks idempotency key             | High     | probable   | single-user  | trivial  | material        | structural | urgent   |
| 7    | F-002 | `verifyFirebaseIdToken` silently ignores `checkRevoked`   | High     | possible   | single-user  | hard     | material        | quick-win  | urgent   |
| 8    | F-003 | Account linking auto-completes without explicit consent   | Medium   | possible   | single-user  | moderate | material        | structural | can-wait |
| 9    | F-009 | CSRF check disabled outside production                    | Medium   | remote     | single-user  | moderate | minor           | quick-win  | can-wait |
| 10   | F-011 | Dockerfile runtime stage runs as root                     | Medium   | remote     | tenant-wide  | hard     | material        | quick-win  | can-wait |
| 11   | F-010 | JWT in redirect URL query string                          | Low      | remote     | single-user  | hard     | minor           | quick-win  | can-wait |
| 12   | F-012 | Logger / Sentry redaction not unit-tested                 | Low      | remote     | tenant-wide  | hard     | minor           | quick-win  | can-wait |

**Read of the table**: rows 1–7 are urgent. Rows 1–2 are the audit's headline (Constitution Principle I violations). Rows 3–7 are the High-severity items, four of which are quick wins. Rows 8–12 are can-wait — none are dismissable, but none should block the urgent-tier work.

---

## 3. Quick Wins (small, reversible, low-risk)

Quick-win partition criteria: small change in a single file, fully reversible or reversible-with-care, no new dependencies, no migration. The planner can fill a one-week sprint from these alone.

### Q-01 — F-001 — Admin JWT signing key derived from customer secret

**Severity**: High
**Effort estimate**: small
**Recommendation**: introduce `ADMIN_JWT_SECRET` (or `ADMIN_SESSION_SECRET`) as a separate environment variable. Validate ≥ 32 chars at boot independently. Update `backend/src/lib/jwt.ts` to read it directly with no fallback to derivation. Update `config/env.example` and Render dashboard (`sync: false`).
**Reversibility**: reversible-with-care
**Dependencies**: existing admin sessions become unverifiable on rotation — schedule a brief admin-logout window in the operations runbook.
**Why this is a quick win, not structural**: one line of code change, one env-var addition, one runbook entry. The deployment sequencing is the only non-trivial part.

### Q-02 — F-002 — `verifyFirebaseIdToken` silently ignores `checkRevoked`

**Severity**: High
**Effort estimate**: small
**Recommendation**: at `backend/src/services/firebase-auth.service.ts:160`, change `auth.verifyIdToken(idToken, false)` to `auth.verifyIdToken(idToken, checkRevoked)` so the parameter is honored. If the original "compatibility" concern (extra round-trip 401s) is real, make `checkRevoked = false` explicit at the call sites instead of silently dropping it. Add a regression test asserting the SDK is called with the caller's argument.
**Reversibility**: fully-reversible
**Dependencies**: none
**Why this is a quick win, not structural**: a one-line behavior change plus one test. No flow restructuring.

### Q-03 — F-006 — Coupon `maxUses` race

**Severity**: High
**Effort estimate**: small
**Recommendation**: at the coupon-increment UPDATE in `backend/src/services/checkout.service.ts:126-131`, add `WHERE usedCount < maxUses` to the SQL. Check `rowsAffected = 1`; if 0, throw `COUPON_EXHAUSTED` and the checkout transaction rolls back. The non-transactional read in `lib/pricing.ts:159` becomes an early UX-friendly check; the atomic UPDATE is the authoritative gate.
**Reversibility**: fully-reversible
**Dependencies**: none
**Why this is a quick win, not structural**: a single SQL clause. No service decomposition needed.

### Q-04 — F-007 — Topup approval lacks optimistic lock on wallet balance

**Severity**: High
**Effort estimate**: small
**Recommendation**: add `eq(usersTable.walletBalance, balanceBefore)` to the UPDATE's WHERE clause inside the topup-approval transaction at `backend/src/services/topup.service.ts:106-110`. Validate `rowsAffected = 1`; throw `CONCURRENCY_ERROR` and let the admin UI retry on failure. Mirrors the existing `checkout.service.ts:122` pattern — the codebase already knows how.
**Reversibility**: fully-reversible
**Dependencies**: none
**Why this is a quick win, not structural**: copy the existing pattern from the same codebase. No new abstraction.

### Q-05 — F-009 — CSRF check disabled outside production

**Severity**: Medium
**Effort estimate**: small
**Recommendation**: at `backend/src/app.ts:472`, remove the `process.env.NODE_ENV === "production"` guard. Always run the Origin/Referer check. Default `csrfAllowedOrigins` in dev to `["http://localhost:5173", "http://127.0.0.1:5173"]` and any explicit `CSRF_ALLOWED_ORIGINS` value. Update `config/env.example` documentation.
**Reversibility**: fully-reversible
**Dependencies**: minor `config/env.example` doc update.
**Why this is a quick win, not structural**: a guard removal plus a default. The dev experience is preserved by the permissive allow-list.

### Q-06 — F-011 — Dockerfile runtime stage runs as root

**Severity**: Medium
**Effort estimate**: small
**Recommendation**: in the runtime stage of `Dockerfile`, add `USER node` before `CMD` (the `node:22-alpine` base already provides the `node` user). Verify build artifacts in `/app` are readable. If permission errors surface, add `RUN chown -R node:node /app` after the COPY step.
**Reversibility**: fully-reversible
**Dependencies**: a single Render redeploy with the updated image; smoke-test that the app boots as the `node` user.
**Why this is a quick win, not structural**: one Dockerfile directive. Render handles the rest.

### Q-07 — F-010 — JWT in redirect URL query string (Telegram callback)

**Severity**: Low
**Effort estimate**: small
**Recommendation**: at `backend/src/routes/auth-settings.ts:858`, drop `?token=...` from the redirect target. Rely on the httpOnly cookie alone (already set on the same response). Verify the frontend `/auth/callback` page does not depend on the query-string copy; if it does, replace with a `useAuth` hook that reads from `/api/auth/probe`.
**Reversibility**: fully-reversible
**Dependencies**: minor frontend audit of `/auth/callback`.
**Why this is a quick win, not structural**: removing a redundant secondary transport. The primary transport (cookie) is unchanged.

### Q-08 — F-012 — Logger / Sentry redaction not unit-tested

**Severity**: Low
**Effort estimate**: small-medium
**Recommendation**: add an integration-shaped test under `backend/src/lib/__tests__/redaction.test.ts` that constructs an HTTP request body containing every field in `SENSITIVE_FIELD_NAMES` plus a JWT-shaped string under an "innocent" key, pushes it through a fake Pino transport AND through the Sentry `beforeSend`, and asserts neither captured artifact contains the sensitive values. Bonus: snapshot the test fixture so future field additions trip the snapshot.
**Reversibility**: fully-reversible
**Dependencies**: none
**Why this is a quick win, not structural**: tests, not refactor. The implementation is already correct; this proves it stays correct.

---

## 4. Structural Hardening

Structural-hardening partition criteria: requires a coordinated multi-file change, possibly an architectural shape (new service / new middleware), or a UX flow update. Cannot be reduced to a single quick edit. Each entry must justify why a quick win is insufficient.

### S-01 — F-004 + F-005 + F-008 — Bundled admin-mutation hygiene

**Severity**: Critical (the bundle's worst rank — F-004 and F-005 are both Critical)
**Effort estimate**: medium-large
**Recommendation**: build two narrow services parallel to `TopupService`:

1. **`AdjustmentService`** — handles admin wallet-adjustment requests. Wraps `db.transaction()`; reads current balance inside the tx; writes `walletBalance` with `WHERE walletBalance = $expected` (optimistic lock); writes a `wallet_ledger` entry of type `adjustment` with `referenceType = "admin_adjustment"`, `referenceId = <admin-action id>`, full `balanceBefore` / `balanceAfter` capture; requires a non-empty `note` field; requires an `Idempotency-Key` header (see middleware below).
2. **`RefundService`** — handles admin order refunds. For each order: re-read `walletBalanceBefore` / `walletBalanceAfter` from the order row, compute the refund amount, credit the user with optimistic lock, write a `wallet_ledger` entry of type `refund` referencing the order, then transition `orders.status` to `refunded`. Reject if already refunded (status-as-idempotency).
3. **Idempotency middleware** — reads `Idempotency-Key` header on every state-changing admin endpoint (start with adjustment, refund, topup-approval; expand later). Stores `(idempotency_key, response_summary)` in Redis with a 24-hour TTL. Short-circuits duplicate requests with the cached response. Returns 409 if the same key is seen with a different request body (different intent).
4. **Admin UI** — generates a UUID v4 per logical action and sends it as the `Idempotency-Key` header. Bulk operations send one key per logical bulk (not per item) so a partial-failure retry produces consistent state.
5. **Audit log enrichment** — admin-mutation log entries record `amount`, `balanceBefore`, `balanceAfter` (not just "fields changed").

**Reversibility**: fully-reversible
**Dependencies**: shape of the audit-log payload (additive); admin UI must generate and pass `Idempotency-Key`; smoke-test on a staging-like data set; one operations-runbook entry on the new admin contract.
**Why a quick win is insufficient**: F-004, F-005, and F-008 are three faces of the same gap — admin endpoints that mutate balances without the durable invariants the rest of the codebase enforces. Patching them piecemeal (e.g., "just add a ledger entry to F-004") (a) fragments the admin API contract into three subtly different shapes, (b) lets the next admin endpoint regress, (c) does not solve idempotency without coordinated middleware. One bundled, contract-establishing change is the smaller cost.
**Justification for size > quick-win**: the work crosses four files (`admin/users.ts`, `admin/orders.ts`, new service files, new middleware) plus the admin UI. No subset is independently shippable as Critical-fix-quality without the others.

### S-02 — F-003 — Account linking confirmation flow

**Severity**: Medium
**Effort estimate**: medium
**Recommendation**: when `findLinkCandidates` would result in linking, the backend returns 409 with a short-lived link token (Redis-backed, 5-minute TTL) instead of silently linking. The frontend presents a confirmation modal naming the existing account ("link this Telegram identity to your account `user@example.com`?"); on confirmation, the frontend re-submits the link request with the token. The backend verifies the token and commits the link; audit-logs it as a consented action.
**Reversibility**: reversible-with-care
**Dependencies**: matched frontend update (modal copy); audit-log shape addition; UX sign-off on the modal language (Arabic-first per Constitution).
**Why a quick win is insufficient**: a one-line backend reject regresses the feature for all users. The fix is the _flow_, not the _condition_. The condition is correct (two providers can match the same human); the flow needs explicit consent.
**Justification for size > quick-win**: frontend + backend + audit log + UX writing. None is independently shippable without the others — partial work would either break the UX or leave the security gap open.

---

## 5. Deferred Items

Deferred-items partition criteria: severity does not justify imminent work, OR remediation is blocked on a coverage-gap closure (`CG-NN`) outside this audit's reach. Each entry names the deferral reason and the trigger that would un-defer it.

This audit produced **no deferred items**. Every Low-severity finding (F-010, F-012) was small enough to land in §3 Quick Wins; every Medium-severity finding (F-003, F-009, F-011) was small enough to ship in the same sprint as the urgent work. If any of the §3 / §4 items are de-prioritized below this section's bar, they should be re-classified deferred with a triggering condition recorded here.

For coverage gaps (CG-01 through CG-08), see [`research.md`](./research.md) §6. Closing each gap is a future, separately-authorized task — not a remediation, but an audit follow-up.

---

## 6. Cross-Document Consistency Check

Mechanical checklist signed off before publish. Closes C-03 / VR-RS-01 / VR-RS-02 / VR-RS-03.

- [x] Every F-NNN in `security.md` §3 appears in this file's §2 table exactly once. (F-001 through F-012, 12 findings, 12 rows.)
- [x] Severity in §2 == severity in `security.md` §3 for every F-NNN.
- [x] No `urgent` finding lands in §5 Deferred. (Section 5 is empty.)
- [x] No `deferred` finding lands in §3 Quick Wins. (No findings classified deferred.)
- [x] Every §4 Structural entry has a non-empty "Why a quick win is insufficient" line.
- [x] Every `large`-size recommendation has a Justification. (S-01 is sized medium-large with Justification; S-02 is sized medium with Justification per the contract requirement for size > quick-win.)
- [x] `research.md` §3 coverage matrix references match the F-NNN IDs here exactly.
- [x] `security.md` §4 Risk Ranking summary reflects this file's §2 ordering. (Ordering is identical in the first 12 rows; severity / urgency / partition columns match.)
