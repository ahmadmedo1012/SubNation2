# R146 fix notes — backend API surface (agent 146-FIX-1)

Implements findings 1–5 of `docs/engineering/R146/audit-backend-api.md`
(ponytail ruleset per repo-root AGENTS.md: smallest complete change, the
403 envelopes stay byte-identical, every risky fix leaves a pin).
All commands run from the repo root against the combined in-flight tree
(four other fix lanes were mid-work; my lane's files are listed below).

## Finding 1 — Google logins left no auth_activity trace

- **Changed** (`backend/src/routes/auth.ts`):
  - `POST /api/auth/firebase/session` now computes `clientInfo =
    getClientInfo(req)` at the top of the handler (line ~530) and:
  - success path (~582–593): one `await logAuthActivity({ userId,
    result.user.id, identifier: result.user.phone ||
    \`firebase_${decoded.uid}\`, action: result.isNewUser ? "register" :
    "login", success: true, provider: "firebase", ...clientInfo })` —
    the exact `/firebase/refresh` twin shape (auth.ts:693-area);
  - `FirebaseAuthError` catch (~668–678): failure row mirroring the twin —
    `identifier: "firebase_session_error"`, `action: "login"`,
    `success: false`, `failureReason: "firebase_error"`,
    `provider: "firebase"`. The `LinkConsentRequiredError` arm and the
    generic 500 arm are untouched (audit scope: the FirebaseAuthError
    catch only).
- **Test evidence:** `pnpm --filter @workspace/api-server exec vitest run
  src/routes/__tests__/auth-firebase-session.test.ts src/routes/__tests__/auth-firebase-refresh.test.ts src/routes/__tests__/auth-sessions.test.ts`
  → **3 files / 24 tests passed** (session suite extended with the
  refresh-twin idiom: auth_activity DDL + per-test TRUNCATE + register-row,
  login-row, and failure-row assertions).
- **Pins added** (`auth-firebase-session.test.ts`): new-user mint →
  exactly one `action:"register"` row (identifier = phone, provider
  "firebase"); re-login → second row `action:"login"`; invalid token →
  one `firebase_session_error` failure row with `failureReason:
  "firebase_error"`.
- **Fixture caller fixed:** `auth-firebase-verify-timeout.test.ts` (route
  leg hits the FirebaseAuthError catch) got the same auth_activity DDL in
  `beforeAll` — without it the new insert would 500 the 503 pin.
  `pnpm --filter @workspace/api-server exec vitest run src/routes/__tests__/auth-firebase-verify-timeout.test.ts`
  → **2 tests passed**.

## Finding 2 — dead requireCopilotPermission + missing refusal audit trail

- **Changed:**
  - `backend/src/middlewares/requireCopilotPermission.ts` — **deleted the
    factory** (~44 lines incl. its now-unused imports: db,
    copilotActionsTable, logger, express types). Only `hasScope` survives
    (real call sites: `routes/admin/copilot/settings.ts`). File keeps its
    name + a 6-line why-comment pointing at the inline refusal rows.
  - `backend/src/routes/admin/copilot/ask.ts` (~178–190): the
    `tools.length === 0` 403 now first `await recordNonExecute({…,
    actionClass: "refusal", riskTier: "low", outcome: "refused",
    failureReason: "out_of_scope: missing scope inventory|admins|users",
    correlationId })` — the shared non-execute audit helper draft.ts
    already uses (never throws: try/catch + warn inside). New import of
    `recordNonExecute` from `services/copilot/audit`.
  - `backend/src/routes/admin/copilot/draft.ts` (~86–98): same for the
    `drafts.length === 0` 403 (`failureReason: "out_of_scope: missing
    scope inventory"` — every draft tool requires that one scope).
    `recordNonExecute` was already imported there.
  - 403 response bodies are **byte-identical** (nothing in the
    `res.status(403).json(...)` calls changed).
- **Test evidence:** new suite
  `backend/src/routes/__tests__/copilot-refusal-audit.test.ts` +
  `pnpm --filter @workspace/api-server exec vitest run src/routes/__tests__/copilot-refusal-audit.test.ts src/routes/__tests__/copilot-error-envelope.test.ts`
  → **2 files / 11 tests passed** (4 new + the 7 byte-pin envelope cases).
- **Pins added:** out-of-scope `["support"]` admin → ask 403 + exactly one
  refused row (adminId, intent_text, action_class "refusal", risk_tier
  "low", failure_reason) with the envelope asserted on RAW text; draft 403
  twin; empty-intent 400 control writes NO row.

## Finding 3 — unbounded x-correlation-id → varchar(64) 500s

- **Changed:** `ask.ts` (~158–163) and `draft.ts` (~72–77) — the
  extraction is now `((req.headers["x-correlation-id"] as string |
  undefined) ?? \`cp-${Date.now()}-${adminReq.adminId}\`).slice(0, 64)`
  with a one-line why-comment (unbounded header feeds varchar(64)
  columns). `requireCopilotPermission.ts` (the third extraction point) is
  deleted per finding 2, so only the two routes needed the bound.
- **Test evidence:** covered inside the new refusal suite — a 100-char
  `x-correlation-id` on the draft 403 path lands in
  `copilot_actions.correlation_id` as exactly 64 chars (SQLSTATE 22001
  would 500 before the fix). Part of the 11 tests above.

## Finding 4 — sessions lastActive was always the login time (backend half)

- **Changed:** `backend/src/routes/auth.ts` GET /api/auth/sessions
  (~851–857) — dropped the `lastActive: r.createdAt?.toISOString() ?? …`
  field from the response mapping (one why-comment in its place).
  Frontend NOT touched (other lane).
- **Test evidence:** `pnpm --filter @workspace/api-server exec vitest run
  src/routes/__tests__/auth-sessions.test.ts` → **10 tests passed**.
- **Pin updated:** `auth-sessions.test.ts` (~266–278) — `lastActive`
  removed from the shape matchObject and
  `expect(sessions[0]).not.toHaveProperty("lastActive")` added, with the
  one-line rationale comment (repo convention).

## Finding 5 — expired R122 legacy-hash transition window

- **Changed:** `backend/src/middlewares/idempotency.ts` — deleted the
  `legacyBodyHash` helper + its 16-line doc comment (was lines 129–145),
  the `createHash` import (no other user), and the `|| cached.hash !==
  legacyBodyHash(req.body)` arm: the replay check is now the plain
  canonical-hash comparison `cached.hash !== reqHash` (~269–273), with a
  why-comment noting the 24 h Redis TTL expired the last pre-R122 claim.
  The primary canonical-hash replay check is otherwise untouched.
- **Test evidence:** `pnpm --filter @workspace/api-server exec vitest run
  src/middlewares/__tests__/idempotency.test.ts` → **22 tests passed**
  (was 24).
- **Pins removed (deliberate):** the two R122 transition-window cases
  ("legacy hash still replays" + "not a bypass: different body 409s")
  plus the test file's `createHash` import — the arm they pinned is the
  deleted code. A rationale comment sits where they were (~932–935).
  The different-body 409 guard itself is still pinned by "a genuinely
  different body still 409s".

## Regression sweep (files touching changed code)

- `pnpm --filter @workspace/api-server exec vitest run src/routes/__tests__/auth-firebase-verify-timeout.test.ts src/routes/__tests__/auth-probe-revocation.test.ts src/routes/__tests__/auth-unlink.test.ts src/routes/__tests__/admin-no-store-stragglers.test.ts src/__tests__/csrf-gate.test.ts`
  → **5 files / 51 tests passed.**
- `pnpm --filter @workspace/api-server exec vitest run src/routes/__tests__/orders-idempotency-route.test.ts src/routes/__tests__/wallet-topups-idempotency.test.ts src/routes/__tests__/admin-adjustment-idempotency.test.ts src/routes/__tests__/cross-intent-durable-idempotency.test.ts src/routes/__tests__/loyalty-durable-idempotency.test.ts src/routes/__tests__/wallet-topups-durable-idempotency.test.ts src/routes/__tests__/copilot-history-contract.test.ts`
  → **7 files / 34 tests passed.**
- `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit`
  → clean (includes the shrunken middleware + both copilot routes).

## Net lines (this lane only)

Production code **−5** net (requireCopilotPermission −44, idempotency −18,
auth.ts +26, ask.ts +16, draft.ts +15). Tests +221 net (209-line new
refusal suite + extended firebase-session coverage − deleted legacy
cases). No new dependencies, no new abstractions (recordNonExecute reused).

## Out-of-lane needs

1. **Frontend pages lane:** `frontend/src/components/SessionManager.tsx`
   — the «آخر نشاط: …» label (line ~184) and the `lastActive: string`
   field on its local Session interface (line ~14) now render
   `undefined`; the label should be dropped (it duplicated
   `created_at` two rows up). Fixtures in
   `frontend/src/components/__tests__/session-manager-confirm.test.tsx`
   and `session-manager-error-states.test.tsx` still set `lastActive`.
2. **Shared/migrate lane:** `shared/api-spec/openapi.yaml` —
   `UserSession.lastActive` (~line 6054) is now never emitted; remove it
   and regenerate the orval clients (`shared/api-zod`,
   `shared/api-client-react`). Nothing breaks meanwhile: the generated
   zod marks it `optional()`.
3. **Backend services lane:** `backend/src/services/copilot/tools/read.ts`
   (~line 660) — stale doc comment "route also enforces
   requireCopilotPermission at the gate" now references deleted code.
4. **Spec owner (shared lane):** `specs/010-ai-admin-copilot/tasks.md`
   T027/T146 still describe the middleware file as the refusal-audit
   mechanism; the contract (refused row BEFORE the 403) is now honored
   inline in ask.ts/draft.ts.
