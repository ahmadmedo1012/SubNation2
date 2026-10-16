# R152 — Type-safety unification + lint-debt retirement: closing report

Round base: `6b48169` (R151 close). Method: the repo's standing Ponytail
ruleset (root `AGENTS.md`). The round opened on a working tree carrying
an **interrupted, uncommitted type-safety wave** (the previous session's
context cut off mid-round): 32 modified files, never gated, never
reconciled. This session did not discard it — every hunk was read
line-by-line against the generated types, the three incomplete pieces
were finished, the full gate battery was run, and the wave is landed as
one coherent commit.

Mission context: the whole-product excellence program. The round's
thesis: `any` is a debt instrument — every one of them borrows
compile-time safety against a future refactor. The admin money queue
(the topups page) was carrying a page-level `any` state atom and a
hand-rolled 14-field structural copy of a generated type that had
already drifted.

## 1. The landed work (35 files, +64/−73, zero runtime diff)

### 1.1 The RejectModal type-drift fix (the round's one substantive defect)

The single-reject dialog declared its `topup` prop as a hand-rolled
14-field structural copy of the generated `AdminTopup`. The copy had
drifted: the generated type (orval, from openapi.yaml) carries
`payment_network?: string | null` — the hand-rolled one had silently
dropped the nullability (`payment_network?: string`). Latent, not live:
the dialog renders only `amount` + the user display line, so no null
crash existed today — but the page feeding it held `rejectTarget` in a
bare `any`, so any future field misuse on either side would have
compiled silently. Both ends now ride the shared
`AdminTopupRow` (`AdminTopup & { payment_method?, sender_account? }`
from `topups-queue-meta.ts` — the same type the queue, the toolbar and
the cards already used):

- `RejectModal.tsx`: the 14-field copy replaced by `AdminTopupRow`.
- `pages/admin/topups.tsx`: `rejectTarget` state `any | null` →
  `AdminTopupRow | null`.

One source of truth for the money-queue row, generated end-to-end.

### 1.2 The dead-code sweep (~30 removals across backend + frontend)

Unused imports (`SQL` type + `runMigrations` chains in
`migrate.ts`/`fingerprint.ts`/stages 01–03, `db`/`copilotPreviewsTable`
+ `and, eq` in copilot previews, `sql` in diagnostics, `PRODUCT_FIELD_LIMITS`
in products, `eq` in pricing-cap, `resetTestDb`/`getRedisClient` in
openwa-epoch-memory, `usersTable` in admin-session-revocation, table
imports in refund-reversal-precision, `AppDialogBody` in
CreateCouponDialog, `useAuth` in AdminScopeGate, `useListTopups` × 2);
unused locals (`pid`, `double` × 2, `b`, `worstCaseCouponPct`); unused
helpers (`markerSignal`, the `SeededRule` interface).

### 1.3 The `any` retirement in test helpers and chrome

Response-body `any` types → `Record<string,unknown>` or precise local
interfaces with optional-chained assertions:
`SchedulerBody` (admin-observability), `ProbeBody`
(auth-probe-revocation, with `body.user?.phone` assertions),
admin-adjustment-idempotency, loyalty/wallet-topups durable
idempotency, copilot-error-envelope (`_token`), openwa-epoch-memory
(`_init`), product-card-touch, wallet-money-gates.

### 1.4 The three completions this session added to the interrupted wave

1. `topups-dialogs-chrome-r143.test.tsx` — the fixture now satisfies
   the stricter prop type (carries the generated required fields:
   `user_id`, `payment_method`, `created_at`).
2. `pages/__tests__/admin-topups-decomposition-r137.test.ts` — the
   state-atom spot-pin updated to pin the **improved** declaration
   (`useState<AdminTopupRow | null>`) instead of the retired `any`.
3. `lib/lazy-with-retry.ts` — the workspace's last `no-explicit-any`
   rides a justified disable-line: the generic constraint
   `ComponentType<any>` mirrors `React.lazy`'s own signature in
   @types/react; narrowing it would break valid lazy targets.

### 1.5 Result: lint debt 62 → 15 warnings

0 errors throughout. The 15 survivors are all
`react-hooks/exhaustive-deps` — individually triaged in R151 (each is
the documented deliberate scalar-key / mount-once idiom with an
in-code rationale; churning them is diff noise, not a fix). The
62-warning "documented baseline" is retired; the new baseline is 15.

## 2. The gate battery (all green, run this session on the final tree)

| Gate | Result |
| --- | --- |
| `pnpm lint` | **0 errors / 15 warnings** (was 62 — all removals verified by the linter itself) |
| `pnpm typecheck` (libs + backend + frontend + scripts) | clean |
| Backend vitest (FULL suite, 4 sequential chunks: lib+middlewares / routes / services / jobs+root) | **271 files / 2,507 tests — all passed** |
| Frontend vitest (FULL suite) | **264 files / 2,496 tests — all passed** |
| OpenAPI↔Express route parity | OK — 84 enforced operations |
| ErrorCode sync (openapi.yaml ↔ shared) | OK — 55 codes, both directions |
| Header-param survival | OK — 7/7 |
| Drizzle / orval drift | none (no schema or spec file touched — structurally impossible this round) |
| `impeccable detect frontend/src/` | **0 advisories** |
| Production build | green — eager path **146,665 B gz** (budget 150 KiB) — byte-identical to R151, as expected for a type-level-only round |
| Boot-migration battery (extra, for the migrate/* touches) | 59/59 |

Combined suite total **5,003 tests**. The full frontend battery was run
twice (the first run caught the stale decomposition pin above — fixed
and re-run clean).

## 3. The further-defect sweep (negative results, honestly scoped)

Per the mission's "find what remains open" duty:

- **Hand-rolled generated-type copies** (the 1.1 class, swept across
  `frontend/src`): exactly one other escape-hatch type exists —
  `RiskEventDetail` in `pages/admin/risk-event.tsx` (the detail
  endpoint `/admin/risk/events/:id` is deliberately outside the
  generated client; only the queue list is spec'd). Compared
  field-for-field against the backend route's actual response
  (`routes/admin/risk.ts` detail handler): **accurate, no drift**.
  Recorded as a watch item, not a defect.
- **Remaining `any` audit**: after this round the frontend carries
  zero unwaived `no-explicit-any` warnings; backend sources carry none
  (lint 0-error gate holds for both).
- **Runtime risk of the sweep**: the diff contains no behavior change
  — every hunk is a type annotation, an import, a dead local, or a
  test fixture/pin; the byte-identical eager bundle (146,665 B gz)
  is the machine proof.

What was NOT possible from this session (standing owner-gated items,
unchanged from R151): real-device WhatsApp OTP acceptance matrix,
Coolify gateway re-pin verification, and the live-credential E2E
journeys of `validate:suite` (Firebase/OTP/Redis/Socket/Admin/
Lighthouse/Sentry) — the sandbox ran them and they failed on missing
credentials exactly as documented; no production surface was touched.

## 4. Live-production verification (read-only, post-deploy)

CI on `d253153` completed **success** (all jobs: gitleaks, CVE gate,
lint/typecheck/drift, unit-test matrix, production build + boot smoke,
guest smoke, impeccable). Coolify auto-deployed; verification from this
session after the deploy:

- `GET /api/healthz` → `{"status":"ok"}`.
- Deployed bundle identity rotated: `index-rzt2bEm3.js` (R151) →
  `index-B9PE4dD0.js` — the R152 build is what production serves. The
  stylesheet hash `index-8E6VOJgM.css` is identical to the local build
  (the round's CSS surface is untouched, as expected).
- `www.subnation.ly` → apex redirect intact.
- **Guest E2E suite against production: 52/52 passed** (3.2 min,
  desktop-chromium + mobile-390 projects) — the same live-DOM contract
  family as R151: Arabic catalog + search normalization, product-detail
  money honesty at 1280px, mobile-390 overflow/tap-target checks,
  money-route auth gates, robots/sitemap/noindex-404 shells.

Production was browsed read-only throughout; no account was created,
no mutation was attempted, and no production data was read beyond
public catalog surfaces.

## 5. What remains owner-gated (unchanged from R151)

Real-device WhatsApp OTP acceptance matrix, Coolify gateway re-pin
verification, and the live-credential journeys of `validate:suite`
(Firebase/OTP/Redis/Socket/Admin/Lighthouse/Sentry) — the sandbox ran
them and they failed on missing credentials exactly as documented.

## 6. Round ledger

- 1 commit (this report's companion): the reconciled wave + the three
  completions + this report + the CHANGELOG entry.
- Prior round untouched: R151's `6b48169` remains the parent.
