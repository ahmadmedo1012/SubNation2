# R146 — the ponytail round: closing report

Round base: `4dca48c` (R145 close) → audit-docs commit `ae531a7` → this
round's code. Method: [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
v5.2.0 (MIT) — installed as the repo's standing ruleset at the repo
root `AGENTS.md` (provenance header included) — applied with maximum
parallel agents: six READ-ONLY audit lanes → six fix lanes → one
whole-diff review pass.

## The ledger (23/23 should-fix closed, 17/18 nice, 3/3 review)

| Lane | Audit findings | Closed | Report | Fix notes |
| --- | --- | --- | --- | --- |
| Backend API surface | 3 should + 2 nice | 5/5 | audit-backend-api.md | fix-notes-backend-api.md |
| Backend services / money | 4 should + 1 nice | 5/5 | audit-backend-services.md | fix-notes-backend-services.md |
| Frontend pages | 4 should + 2 nice | 6/6 | audit-frontend-pages.md | fix-notes-frontend-pages.md |
| Frontend components/hooks/lib | 6 should + 5 nice | 10/11¹ | audit-frontend-components.md | fix-notes-frontend-components-a.md + -b.md |
| Shared packages + migrations | 3 should + 2 nice | 5/5 | audit-shared-migrate.md | fix-notes-shared-migrate.md |
| Workspace / CI / deploy | 3 should + 6 nice | 9/9² | audit-workspace-config.md | fix-notes-workspace-config.md |
| Whole-diff review | 2 should + 1 nice | 3/3 | review-r146.md | (fixed in-round, this file's addendum) |

¹ Finding 10 (EmptyState twins merge) deliberately SKIPPED — a recorded
decision with separate test pins; the audit itself says leave the
documented twins alone.
² Finding 9 (.hermes.md "ain]") was a byte-proven false positive — a
display-pipeline artifact of this environment's shell output; the file
was already correct and is left byte-identical (documented so it is
never re-reported).

## Gates (all green, this exact tree)

- lint: **0 errors / 62 warnings** (= the R145 baseline)
- typecheck: clean (libs + backend + frontend + scripts)
- backend: **2,518 tests / 275 files** (R145: 2,510 — net +8)
- frontend: **2,475 tests / 262 files** (R145: 2,446 — net +29)
- contract gates: OpenAPI routes ✅ · error codes ✅ · header params ✅
- production build: green (PWA regenerated; eager path
  **146,690 B gz — −12 B vs R145's 146,702** under the 150 KiB gate)
- orval regenerated after the spec edit — diff exactly one property
  (`UserSession.lastActive`) across spec + both generated clients

## The review pass and its fixes

`ponytail-review` over the whole diff returned **"fix 1 and 2 first"**
(0 must / 2 should / 1 nice) — all three fixed in-round:

1. The risk-config pub/sub duplicate now carries an `error` listener
   before connect (an un-listened node-redis duplicate turned the
   first socket error into an uncaughtException → process exit) and is
   retired best-effort on connect timeout. Test fake updated; suite
   green.
2. `isUniqueViolation` consolidated into `lib/pg-errors.ts` (was
   byte-identical copies in firebase-auth + telegram-auth services).
3. The copilot refusal string's scope vocabulary derives from the live
   tool catalogs (byte-identical output today, grows with new tools —
   the pinned refusal tests pass unchanged).

## Lean totals

~−300 duplicated production lines across the five consolidation
families (intent envelope ×4→1, category registry ×~10→1, ApiError
readers ×3+→1, trapTabKey ×4→1, CopyField ×2→1) plus the dead-code
deletions (requireCopilotPermission −44, legacyBodyHash arm −15,
ProductSkeleton, unreachable throw, dead `zod` dep, dead config
lines) — all at byte-identical rendered output, pinned by tests that
hardcode the pre-R146 values. Inherited instead: ~1,000 lines of new
tests and gates (refusal audit, double-submit races ×2, Redis
bounded, coupon interleave, column census, encryption two-colon,
category-registry byte-pin, telegram auto-login, socket orders leg,
account titles, legacy-slug seed, ref forwarding).

## Honest limits (the ponytail reply's closing lines)

- Not checked in-round: Playwright e2e against production (the CI
  push run + the weekly dispatched heartbeat own that surface), and
  the live Redis/worker topology paths (production runs
  `REDIS_URL` unset + single-instance; the fixed paths are armed for
  the documented migration).
- One shared envelope/reader now fronts all four money guards — a
  regression there would hit all flows at once; that is exactly why
  their behavioral pins ran unmodified and green.
- The category registry is +109 net lines (not the audit's −80..−120
  estimate) because Tailwind's content scanner requires the class
  literals in source — the honest constraint, documented in the
  registry docblock.

## Release chain (verified end-to-end)

- Commits: `4dca48c` (R145 base) → `ae531a7` (audit docs + ruleset) →
  `f860d2f` (the implementation) → `b0fa941` (CI follow-up:
  `package-manager-cache: false` on the audit job — setup-node v5
  defaults it to true and the post-job save failed hard on the now-absent
  store path; the first run's CVE scans themselves passed).
- CI push run 38617200416 on `b0fa941`: **success** (gitleaks, backend
  units, frontend units, lint/typecheck/drift, build; CVE + e2e correctly
  path-filtered off a CI-only diff).
- Coolify push-to-deploy: production serves `index-Bde77MWH.js` which
  embeds the release identity **`f860d2f`**.
- Live smoke (production): 14 public routes HTTP 200 (/, login, register,
  category/streaming, flash-sales, cart, wallet, orders, loyalty,
  referrals, profile, support, status, terms) + `/api/healthz` 200 +
  `/api/auth/providers` returning the live Telegram provider shape.
  Browser-verified: homepage boots with ZERO page errors (15 category
  links, Arabic RTL rendering); `/wallet` guest-redirects to login whose
  `document.title` is properly set («تسجيل الدخول — SubNation») — the
  R146 account-titles fix working live. Desktop + 390px mobile
  screenshots archived at `/home/z/my-project/download/r146/`.
- Dispatched full CI run 38619076866 on `b0fa941`: **8/8 success
  INCLUDING e2e** — the live guest e2e suite ran green against the
  deployed R146 release, and the CVE job proved its cache fix (success,
  "No known vulnerabilities found" at high and critical).
