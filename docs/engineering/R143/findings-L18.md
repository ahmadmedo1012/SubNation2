# L18 — Documentation & source-of-truth integrity audit (R143, retry)

HEAD `528ef39` · read-only audit · lane scope: IMPL-wave-report claim table, test-count claims, docs front-door links, CHANGELOG/SHA integrity, `.hermes.md`, root README. All quotes are verbatim; all evidence commands re-runnable.

---

## IMPL-wave-report claim verification

Source: `docs/engineering/R142/lanes/IMPL-wave-report.md` (the "Implemented" table, lines 12–49, and the header verification block, lines 5–8).

| # | Finding | Claimed test/evidence | Exists? | Code spot-check | Verdict |
|---|---|---|---|---|---|
| 1 | G-1 P2 loyalty convert → generated client (20 s) | loyalty-error-state + loyalty-convert-journey | both exist | `frontend/src/pages/loyalty.tsx:11` imports `convertPoints` from `@workspace/api-client-react`; in-code comment documents customFetch's 20 s budget | **VERIFIED** |
| 2 | J-1/D-5 destructive confirms | "existing pins survive" | n/a | not spot-checked (time-boxed) | skipped |
| 3 | N-1 CI header-param gate | gate runs in CI drift job | — | `scripts/check-openapi-header-params.ts` exists; `.github/workflows/ci.yml:367–376` runs it | **VERIFIED** |
| 4 | N-4/D-1 settings rows | `settings-telegram-rows.test.tsx (NEW)` | YES | — | **VERIFIED** |
| 5 | D-3 adminFetch 20 s timeout, SSE opt-out `timeoutMs:0` | SHARED_ADMIN_TIMEOUT_MS guard | — | `frontend/src/lib/admin-session.ts:62–68` `SHARED_ADMIN_TIMEOUT_MS = 20_000`; `:242–245` opt-out; `CopilotPanel.tsx:429` `{ timeoutMs: 0 }` | **VERIFIED** |
| 6 | C-1 P3 "PDP coupon + **support** → generated client" | product-coupon-variant-void | exists | PDP half true (`product.tsx` uses orval-generated types); **support half FALSE** — see L18-2 | **DISPUTED** |
| 7 | G-2 wallet per-intent key | money-races-r140 pin re-anchored | `frontend/src/pages/__tests__/money-races-r140.test.ts` exists, imports `topup-intent-key`, has wallet-intent-key test | `wallet.tsx:156–213` rotation-sync design comments | **VERIFIED** |
| 8 | G-3 checkout late-remove guard | checkout-pricing-reconcile G-3 regression (NEW) | YES | `checkout.tsx:226` `removeIfStillSameIntent`; test at `checkout-pricing-reconcile.test.ts:264` "G-3 (R142): a 404 landing after remove-then-re-ADD…" | **VERIFIED** |
| 9 | F1/I-4/J-3 truthful availability | `product-seo-availability.test.tsx (NEW)` | YES | — | **VERIFIED** |
| 10 | I-1/I-2 Arabic search + duration | arabic-search + products-arabic-search suites | both exist (3 arabic-search hits) | not deep-read | **VERIFIED (file level)** |
| 11 | I-3 search edge-cache headers removed | "header pin" | — | `backend/src/routes/products.ts:69–75` `Cache-Control: no-store` on search, `I-3 (R142, B6-02)` comment | **VERIFIED** |
| 12 | E-1 copilot single-use | `executor-single-use.test.ts (NEW, mutation-verified)` | YES | `backend/src/services/copilot/executor.ts:18` "stamp consumed_at INSIDE the tx with an isNull(consumed_at)" | **VERIFIED** |
| 13 | B-2/M-1 budget gates comment-stripped | `bundle-budget-gate.test.ts (NEW)` | YES | — | **VERIFIED** |
| 14 | M-2 push-time boot smoke in CI | sabotage demonstration | — | `ci.yml:529–557` "Boot smoke — the built shell must be bootable" | **VERIFIED** |
| 15 | L-1 telegram dispatch retry | `telegram-dispatch-retry.test.ts`, 7 tests | YES | exactly **7** `it(`/`test(` blocks — matches "7 tests" | **VERIFIED** |
| 16 | L-2 hung-run floor + visible skip log | **"opportunistic suite"** | **NO — see L18-1** | source fix real (`opportunistic.ts:66` `HUNG_RUN_FLOOR_MS = 10 * 60_000`, `:93` visible skip log) but **zero test files** reference `opportunistic`/`HUNG_RUN_FLOOR` | **DISPUTED** |
| 17 | H-1 4 cross-user money-read tests | `money-reads-horizontal-authz.test.ts (NEW)` | YES | exactly **4** `it(` blocks; `eq(userId)` scoping narrative at `:24–26` | **VERIFIED** |
| 18 | E-2 bodyParser recovery | `body-parser-recovery.test.ts (NEW)` | YES | — | **VERIFIED** |
| 19 | E-3 verify-2fa honest 500 | `admin-verify-2fa-internal-errors.test.ts (NEW)` | YES | — | **VERIFIED** |
| 20 | E-5 /api/auth/sessions LIMIT | "sessions suite" | `routes/__tests__/auth-sessions.test.ts` exists | `routes/auth.ts:794` + `.limit(200)` at `:814` with `E-5 (R142)` comment | **VERIFIED** |
| 21 | H-4 dead `?token=` branch | button-a11y (NEW) + code | `button-a11y.test.tsx` YES | `auth-callback.ts:17–21` "H-4 (R142): the legacy `?token=` branch is DELETED" | **VERIFIED** |
| 22 | D-2 credentials retry affordance | `orders-credentials-retry.test.tsx (NEW)` | YES | — | **VERIFIED** |

**Named "(NEW)" test files: 10/10 exist.** The only fabricated test reference is L-2's unnamed "opportunistic suite" — corroborating the sibling R143 lane's report.

## Test count verification

Claim (`IMPL-wave-report.md:5–8`): "backend 260 files / 2,458 tests · frontend 247 files / 2,325 tests". CHANGELOG R142 (`CHANGELOG.md:1827`): "Suite growth: backend 2,390 → 2,458, frontend 2,306 → 2,325".

| Metric | Claimed | Actual (measured) | Verdict |
|---|---|---|---|
| Backend test **files** | 260 | **260** = 256 × `*.test.ts` in `backend/src` + 4 in `backend/tests` (`rg --files backend \| rg '\.test\.tsx?$'`) | **MATCH** |
| Frontend test **files** | 247 | **247** × `*.test.{ts,tsx}` in `frontend/src` | **MATCH** |
| Backend test **cases** | 2,458 | static `it(`/`test(` occurrences = 2,232 + 46 `it.each` tables (each expands to N cases) | **plausible, not statically confirmable** — needs `vitest run` for exact |
| Frontend test **cases** | 2,325 | static occurrences = 2,119 + 14 `it.each` tables → needs ~15 rows/table average to reach 2,325 | **plausible but weakly supported** — 206-case gap over 14 tables is high; needs a vitest run to confirm |

File counts are exact matches — the counts were not wholesale fabricated. Case counts could not be confirmed without running the suites (out of time-box scope).

---

### L18-1 · P2 · IMPL-wave-report cites a regression suite that does not exist (L-2)
- **Doc claim** — `docs/engineering/R142/lanes/IMPL-wave-report.md:34`: `| L-2 P3 | hung-run floor (10 min) + visible skip log | lib/opportunistic.ts | opportunistic suite |`
- **Reality** — the only file matching `opportunistic` in the whole tree is the source file `backend/src/lib/opportunistic.ts`. `rg -l "opportunistic|HUNG_RUN_FLOOR" backend` (excluding the source) returns only production consumers (`alerting.service.ts`, `whatsapp-otp.service.ts`, `boot-one-shots.ts`, `worker.ts`, `copilot-reaper.ts`) — **no test file anywhere imports or pins it**. The code fix itself is real (`HUNG_RUN_FLOOR_MS = 10 * 60_000` at `opportunistic.ts:66`; visible skip log at `:93`), but the claimed "opportunistic suite" is fabricated. Corroborates the sibling R143 lane's finding.
- **Proposed correction** — either add the regression test (floor re-arm + visible skip) or amend the report's Test cell to "no regression pin (fix verified by inspection)". The header line "All fixes verified" (line 5) inherits this doubt.

### L18-2 · P2 · IMPL-wave-report C-1 claims "support pages → generated client"; support.tsx still uses raw fetch
- **Doc claim** — `IMPL-wave-report.md:19`: `| C-1 P3 | PDP coupon + support → generated client + guarded parse | pages/product.tsx, support pages | product-coupon-variant-void (mock re-anchored) |`
- **Reality** — `frontend/src/pages/support.tsx` still performs raw `fetch()` at **5 call sites** (lines 71, 92, 135, 202, 235 — e.g. `:71` `fetch("/api/support/tickets", { headers })`). No generated-client import exists for the support endpoints. Only the PDP half of the claim is true (`product.tsx:69/443/567` reference the orval-generated client/types). Corroborates the sibling R143 lane's finding.
- **Proposed correction** — narrow the claim to "PDP coupon → generated client" and record the support-page conversion as not done (or finish the conversion).

### L18-3 · P3 · CHANGELOG "newest first" contract broken: the R142 entry is the last section in the file
- **Doc claim** — `CHANGELOG.md:3`: "One entry per repair round, **newest first**." · `docs/README.md:217`: "`CHANGELOG.md` (round ledger; **newest entry at top**; …)"
- **Reality** — `rg -n "^## " CHANGELOG.md`: R141 at line 13, R140 at 67, … R134 at 915, "Pre-R116 compact summary" at 1795, and **R142 (2026-10-14, the newest round) at line 1806 of 1838** — appended *after* the pre-R116 historical summary, at the very bottom. An operator reading the head sees R141 as the latest round.
- **Proposed correction** — move the R142 entry to the top of `CHANGELOG.md` (and align its header style: `## Round R142 — …`, matching `## Round R141 —`).

### L18-4 · P3 · .hermes.md test-count guidance is two rounds stale
- **Doc claim** — `.hermes.md:41–44`: "The combined suites run ~3,600+ tests (**R133: backend 2,305 + frontend 1,270**; the number grows every round) — a combined total far below ~3,000 … means a suite silently did not run."
- **Reality** — R142's own records claim backend 2,458 + frontend 2,325 ≈ 4,783 (file counts independently verified at 260/247). The R133 baseline and the ~3,000 tripwire are ~1,200 tests behind; a partially-run suite could now pass the stale threshold.
- **Proposed correction** — restamp with R142 numbers and raise the tripwire (e.g., "combined far below ~4,000").

### L18-5 · P3 · .hermes.md points to a nonexistent operator-boundary doc
- **Doc claim** — `.hermes.md:69`: "account-level deletion (`docs/deployment/FINAL_OPERATOR_INPUTS.md`)."
- **Reality** — `docs/deployment/FINAL_OPERATOR_INPUTS.md` does not exist; a whole-tree search for `*operator-inputs*` returns nothing. The doc is also absent from the docs/README deployment table (which lists 10 deployment files). Agents following the "you do not touch — report and stop" rule are pointed at a dead path for the account-deletion boundary.
- **Proposed correction** — point at the real owner (likely `OPERATIONS_RUNBOOK.md` §14 pending actions or `docs/operations/OPERATOR_ACTIONS_R118.md`) or restore/create the referenced doc.

### L18-6 · P4 · .hermes.md money-invariant range lags the law doc
- **Doc claim** — `.hermes.md:51`: "**Money invariants M1–M14** (`docs/FINAL_MONEY_INVARIANTS.md`) are law."
- **Reality** — `docs/FINAL_MONEY_INVARIANTS.md:5`: "M1–M17 re-walked at `5d5227c`…" with rows through M16+ (R134 re-anchor, suite index 43→45 per `docs/README.md:301`). The guidance file names M1–M14.
- **Proposed correction** — update to M1–M17 (and cite the suite index).

### L18-7 · P4 · Root README "approximate at R142" counts are pre-R142 numbers
- **Doc claim** — `README.md:160–164`: "Current suite (**approximate at R142** …): **frontend ≈244 test files / ≈2,310 tests** · **backend ≈872 suites / ≈2,390 tests** (255 test files…)"
- **Reality** — measured: frontend **247** test files, backend **260** test files; R142's centrally-verified end-of-round counts (CHANGELOG R142:1827) are frontend 2,325 / backend 2,458. The README kept the pre-R142 figures (2,310/2,390, 244/255) under an "at R142" stamp — i.e., the A-6 "README counts" fix (IMPL-wave-report.md:45) restamped the label but not the numbers.
- **Proposed correction** — restamp to frontend ≈247 files / ≈2,325 tests; backend ≈872 suites / ≈2,458 tests (260 files).

### L18-8 · P4 · CHANGELOG R142 says "9 new regression suites"; the wave report lists 10–11 NEW test files
- **Doc claim** — `CHANGELOG.md:1826–1828`: "and **9 new regression suites** (mutation-verified where risk demanded)."
- **Reality** — `IMPL-wave-report.md` names **10** brand-new test files (settings-telegram-rows, product-seo-availability, executor-single-use, bundle-budget-gate, telegram-dispatch-retry, money-reads-horizontal-authz, body-parser-recovery, admin-verify-2fa-internal-errors, orders-credentials-retry, button-a11y — all verified to exist) plus the "checkout-pricing-reconcile G-3 regression (NEW)" case.
- **Proposed correction** — reconcile the count (10 files + 1 new case) in one of the two records.

### L18-9 · P4 · CHANGELOG R142 entry carries no landing SHAs despite the "CHANGELOG SHAs" fix claim
- **Doc claim** — `IMPL-wave-report.md:45`: `A-3/A-5/… | CHANGELOG SHAs, env.example ×6, … | docs + scripts | doc/script edits` (ledger `findings-ledger.md:74`: "Fixed this round …: A-3 (CHANGELOG SHAs)").
- **Reality** — `rg "a9f5e83|2df0a62|528ef39" CHANGELOG.md`: only `a9f5e83` (line 65, R141 entry — matches `git log`). The R142 entry (line 1806) references **neither** `2df0a62` nor `528ef39` (the round's landing commits per `git log --oneline -5`), and the entry sits at the bottom of the file (L18-3) where readers won't find it.
- **Proposed correction** — add the R142 landing SHAs to the R142 entry when moving it to the top.

---

## docs/README.md front-door link check — CLEAN
All **62** backtick-referenced doc paths in `docs/README.md` resolve to existing files (operations/, architecture/, deployment/, project-state/, project-graph/, docs/history/, repo-root companions). Initial "dead" hits were path-resolution artifacts and intentional prose mentions of deleted/moved files (`.specify/feature.json` — recorded as deleted R135; `PLATFORM.md`/`PROJECT_OVERVIEW.md` — recorded as moved to history). The 4-bucket arithmetic also checks out: 36 md + 13 mmd + 1 json = **50 CURRENT files** as claimed (`docs/README.md:256,328`).

## Root README spot-check — stack description accurate
`README.md:107–125` (React 19/Vite/Tailwind/wouter/TanStack Query; Express 5/TS/Socket.IO; Postgres-Neon via Drizzle; orval-generated Zod; Docker+Coolify on Contabo, Neon external) matches the repo shape. Only the count staleness (L18-7) disputed.
