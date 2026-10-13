# Lane BE2-fix — R142 completion lane (Task 142-BE2-fix)

Base: a9f5e83 + uncommitted R142 Wave-A work (prior BE lane's fixes intact and
untouched). Scope: the 8 remaining ledger items routed to BE2. Zero commits;
zero DB writes; frontend/, shared/, CI untouched (I-5 deferred, see below).

Ponytail discipline: every fix is the smallest complete change at the root
site; no validation, error handling or security posture was weakened.

---

## Fixes landed

### L-1 (P3) — telegram dispatch retry/timeout/body-ok pipeline: zero failing tests → pinned

- **Module:** `backend/src/telegram.ts:391-501` (`dispatchWithDetails` — 5s
  AbortSignal.timeout, HTTP-status AND body-`ok` inspection, one retry on
  transient-only, `retry_after` honoured + clamped to 5s, skip when env unset).
  Observation seam: the exported `diagnosticPing()` (returns
  attempts/outcome/errorMessage).
- **Test (new):** `backend/src/lib/__tests__/telegram-dispatch-retry.test.ts`
  — 7 tests, scriptable-fetch idiom copied from
  `services/__tests__/openwa.service.test.ts` (installFetchMock +
  jsonResponse + fake timers via `advanceTimersByTimeAsync`):
  1. env unset → skip, **zero fetches**;
  2. `200 ok:false` (error_code 400 "message is too long") → **permanent
     failure, exactly 1 fetch** + failure log line — pins the body-ok gate
     (the R98-A6/F5 class);
  3. 500 then 200 → ok on attempt 2 (+ wire-shape pin: bot-token URL,
     chat_id, parse_mode HTML);
  4. 429 `retry_after:99` → retry fires at exactly 5_000ms virtual time
     (asserted 1 call at 4_999ms, 2 at 5_000ms) — pins honour AND clamp;
  5. aborted/network fetch then 200 → ok on attempt 2 (500ms backoff);
  6. 500 twice → failure, attempts 2, error retained;
  7. network failure twice → failure, attempts 2, message retained.
- **Mutation evidence (all restored after each run):**
  - drop `body?.ok` from the ok branch → 1 test RED;
  - remove the `Math.min(retryAfterMs, MAX_RETRY_BACKOFF_MS)` clamp → 1 RED;
  - classify 5xx as non-transient → 2 RED.
- **Verification:** `vitest run src/lib/__tests__/telegram-dispatch-retry.test.ts`
  → **7/7 passed**; included in the final 9-file batch (85/85).
- **Note:** task ownership named "backend/src/lib/telegram.ts" — the module
  actually lives at `backend/src/telegram.ts`; the test file sits at the
  ownership-specified `lib/__tests__/telegram-dispatch*.test.ts` path.

### H-1 (P3) — horizontal-authz regression tests on the 4 money-read surfaces

- **Routes pinned (contracts read first):**
  - `backend/src/routes/orders.ts:386-404` — GET `/api/orders/:orderCode`:
    scoped singleton → foreign orderCode = **404 `ORDER_NOT_FOUND`**;
  - `backend/src/routes/wallet.ts:157-174` — GET `/api/wallet/topups`:
    scoped list → 200 with ONLY the caller's rows;
  - `backend/src/routes/wallet.ts:190-223` — GET `/api/wallet/ledger`: same;
  - `backend/src/routes/loyalty.ts:350-382` — GET `/api/loyalty/ledger`: same.
- **Test (new):** `backend/src/routes/__tests__/money-reads-horizontal-authz.test.ts`
  — 4 tests (pglite harness, cart.test.ts/user-money-history-pagination.test.ts
  template: express mini-app + real fetch + signUserToken cookies). Each test
  seeds users A+B with distinguishable rows and proves BOTH directions:
  B cannot read A's resource (404 / rows absent) AND the owner still can
  (control leg, so the negative is meaningful).
- **Mutation evidence (restored after the run):** dropped the
  `eq(table.userId, userId)` predicates from `orders/:orderCode` and
  `wallet/topups` → **2/4 tests RED** (one per response-shape class:
  singleton-404 and list-isolation; the two ledger tests are the same
  structural class).
- **Verification:** 4/4 passed standalone; 85/85 in the final batch.

### E-2 (P4) — body-parser-recovery raw bodyPreview could ship plaintext passwords

- **File:** `backend/src/lib/body-parser-recovery.ts:102-117` — the warn log's
  `bodyPreview: rawBody.slice(0, 80)` replaced with `bodyLength: rawBody.length`
  (+ why-comment). REDACT_PATHS redacts object fields, never substrings inside
  a string, so routing the preview through it is impossible by design — the
  blank-to-length option is the honest fix (findings-E's own minimal fix).
  Diagnosability kept: path/method/content-type/length.
- **Test (new):** `backend/src/lib/__tests__/body-parser-recovery.test.ts` —
  posts a truncated JSON credential body
  (`{"phone":"…","password":"hunter2-secret",`) → asserts 400 INVALID_DATA +
  `bodyLength > 0` + the serialized log line contains neither
  `hunter2-secret` nor `phone`. Fails the moment any raw-body content
  returns to the warn line.
- **Verification:** 1/1 passed; in the final batch.

### E-3 (P4) — verify-2fa catch-all laundered DB/internal errors into a uniform 401

- **File:** `backend/src/routes/admin/auth.ts:416-437` (+ imports at :5, :11).
  The catch now distinguishes: `err instanceof JsonWebTokenError` (incl.
  TokenExpiredError/NotBeforeError subclasses — the expected jwt.verify
  noise) keeps the uniform 401 envelope; everything else (Postgres blip in
  the admin select / lockout store / createAdminSession) is
  `captureSubsystemException("auth", err, { route: "login/verify-2fa" })` +
  warn log + honest **500 `INTERNAL_ERROR`** envelope. Fail-closed in both
  arms — no session is minted either way.
- **Test (new):** `backend/src/routes/__tests__/admin-verify-2fa-internal-errors.test.ts`
  — 2 tests (mock graph mirrors admin-auth-lockout.test.ts: throwing db
  select = outage):
  1. valid temp token + DB outage → 500 INTERNAL_ERROR + exactly one
     capture (subsystem "auth", route tag, the outage message) + zero
     createAdminSession calls;
  2. invalid temp token ("not-a-jwt") → 401 UNAUTHORIZED, no capture, no
     session — the noise class is NOT regressed.
- **Verification:** 2/2 passed; existing `admin-auth-lockout.test.ts`
  (16 tests, incl. "tampered temp token → 401") re-run GREEN against the
  change.

### E-5 (P4) — GET /api/auth/sessions was the only unbounded user list

- **File:** `backend/src/routes/auth.ts:802-815` — `.limit(200)` appended to
  the device-list query (the sibling clamp idiom: wallet/loyalty lists,
  notifications R128-IMP-5), with a why-comment. A user with >200 LIVE
  30-day sessions has a bug, not a device list.
- **Verification:** `auth-sessions.test.ts` re-run → 10/10 GREEN (no pinned
  behavior changed; page-1 responses byte-identical).

### F-3 (P4) — dead `idx_users_referral_code` boot creator

- **File:** `backend/src/migrate.ts:3287-3291` — the
  `CREATE INDEX IF NOT EXISTS idx_users_referral_code …` line deleted from
  the runMigrations body's missing-indexes block (it created the index every
  full reconcile only for V1-M15 to probe-and-drop it ~950 lines later; the
  chain (0012), the schema TS and the V1-M15 drop stage all already agree the
  object must not exist). Record kept: the V1-M27 frozen-creator note at
  `migrate.ts:1750-1754` now documents the fifth body creator's removal
  (the four FROZEN-stage creators are deliberately untouched, as before).
- **Note:** prettier --write (required on touched files) also wrapped one
  overlong pre-existing `sql.raw(...)` line in `applyR135IndexWaveStage`
  (~:2441) — pure formatting, zero behavior.
- **Verification:** no test executes the body (F-1, deferred lane-wide);
  `migrate-v1m15.test.ts` re-run → 9/9 GREEN (module parses; V1-M15 drop
  stage unaffected). Typecheck covers the syntax.

### G-6 (P4) — the one LYD display missing formatLyd grouping

- **File:** `backend/src/routes/loyalty.ts:329` — convert success message
  `${lydValue.toFixed(2)} د.ل` → `${formatLyd(lydValue)}` (the R128 B8-D3
  en-US grouping canon; `formatLyd` appends «د.ل» itself); import extended at
  `loyalty.ts:9-12`. 150,000 points now renders «1,500.00 د.ل» in the toast
  instead of «1500.00 د.ل»; identical output below 1,000.
- **Verification:** `loyalty.test.ts` + `loyalty-durable-idempotency.test.ts`
  re-run → 36/36 GREEN (no test pins the old message; the frontend journey
  test mocks its own message string — no coupling).

---

## Deferrals

- **I-5 (P4) — available_only empty-state copy claims «لا نتائج» when matches
  exist but all نفد:** the copy lives in the FRONTEND —
  `frontend/src/components/home/ProductsGrid.tsx:147-161` renders
  «لا توجد منتجات تطابق بحثك» + «جرّب تغيير الفلتر أو كلمة البحث» for
  every filtered-empty state, including the `available_only`-emptied one
  (live case: `search=افلام&available_only=true` → 0 rows while 17 streaming
  products match). Grep-verified NO backend site emits this string (no route,
  service, or error-code copy). **For the orchestrator / FE lane** (file is
  outside BE2 ownership): when `availableOnly` is the differentiator, vary
  the hint per findings-I — «قد تكون هناك نتائج مطابقة لكنها نفد المخزون —
  جرّب إلغاء فلتر "متوفر فقط"» — copy-level only, no new queries. The
  availableOnly flag is already a ProductsGrid prop (`ProductsGrid.tsx:27,39`)
  and the existing filtered-empty label split (`:91-96`) is the insertion
  point.

## Final gates

- **Targeted tests (one batch, 9 files):** money-reads-horizontal-authz,
  telegram-dispatch-retry, body-parser-recovery,
  admin-verify-2fa-internal-errors, admin-auth-lockout, auth-sessions,
  loyalty, loyalty-durable-idempotency, migrate-v1m15 →
  **Test Files 9 passed (9), Tests 85 passed (85)**.
- **Backend typecheck:** `tsc -p tsconfig.json --noEmit` → **0 errors**.
- **ESLint** on all 9 touched files → clean (no findings).
- **Prettier --write** applied to all 9 touched files.
- Whole suite deliberately NOT run (per lane rules); no commits; no DB
  touched (pglite only); prior lanes' uncommitted work verified intact.

## Working-tree delta (this lane)

Modified (5): `backend/src/lib/body-parser-recovery.ts`,
`backend/src/routes/admin/auth.ts`, `backend/src/routes/auth.ts`,
`backend/src/migrate.ts`, `backend/src/routes/loyalty.ts`.
New (4): `backend/src/lib/__tests__/telegram-dispatch-retry.test.ts`,
`backend/src/lib/__tests__/body-parser-recovery.test.ts`,
`backend/src/routes/__tests__/money-reads-horizontal-authz.test.ts`,
`backend/src/routes/__tests__/admin-verify-2fa-internal-errors.test.ts`.
