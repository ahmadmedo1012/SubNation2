# R188 — Round Close: The Rotated-Lenses Perfection Round (6-squad audit + 8-squad fix wave)

**Date:** 2026-10-26 · **Round:** R188 · **Starting SHA:** `173e6406` (the R187 ship record — CI run 40160448862 green on it; the owner pushed nothing after R187) · **Baseline:** clean working tree on `main`, CHANGELOG newest entry R187 · **Production:** `https://subnation.ly` live and healthy — **the R187 rotation COMPLETED** (verified at round start: the entry rotated to `index-BDL0hpyk.js` and carries the R187 loyalty socket-resync marker `queryKey:[`loyalty"]`; the R187 ship's only pending item is closed-green).

**Scope (owner's directive — استمر في التحسين والتنظيم والتطوير والترقية والتنظيف):** run as **14 agent invocations + the central desk** — 6 read-only audit squads on ROTATED lenses (each round rotates so the same ground is never re-swept with the same rake) → central triage (all 7 P2 claims independently re-verified with byte checks before dispatch) → 8 fix squads on disjoint file scopes (2 hit agent deadlines after completing their edits — the central desk verified their trees byte-wise, mutation-spot-checked their pins, and re-ran every touched suite, per the R187 precedent).

---

## 1. The round design — the rotated lenses

- **Wave 1 — the audit (6 parallel Explore squads, read-only):**
  - **A (the seeds squad):** every named deferral/skip from R185/R186/R187 re-examined for actionability — verdicts with evidence, not rediscovery.
  - **B (runtime correctness):** React hook/effect/query mechanics — dependency-array lies, cleanup, re-entry guards, shared-gate accounting.
  - **C (backend data-integrity):** transaction boundaries, idempotency races, numeric coercion, constraint-violation paths, lost-update windows on the charge-authority columns.
  - **D (Arabic copy linguistics — the NEW lens, never run before):** the first full linguistic pass — orthography, plural-form correctness, numerals, RTL punctuation, terminology consistency, verb-form drift, across storefront + admin + backend messages.
  - **E (suite reliability):** flakiness vectors — wall-clock bounds, fake-timer/env/module-state leaks, order dependence, CI-vs-local drift.
  - **F (config/toolchain/CI parity):** gates that exist locally but not in CI (and vice versa), manifest coherence, size registers vs reality, env-template reconciliation both directions.
- **Result: 39 verified findings — 7×P2, 32×P3, 0×P0/P1.** All 7 P2 claims byte-verified by the central desk before dispatch (all held — including the C-F1 transaction-boundary proof read at both service call sites).
- **Wave 2 — the fix (8 squads on disjoint scopes + central-desk finishes):** 1 (backend services — the C-F1 in-tx law), 2 (backend routes — C-F2..C-F7), 3 (backend copy/jobs — the Arabic pluralization + localization), 4 (storefront copy + analytics), 5 (admin copy — the frozen-count long tail), 6 (runtime guards), 7 (test hygiene), 8 (CI/config parity). Squads 2 and 5 hit agent deadlines AFTER completing their edits; the desk verified their trees, spot-checked mutations, and re-ran all touched suites.
- **A workspace-reset round again:** the repo re-cloned (the prior sandbox was recycled; the study-guide preview page and worklog survived), pnpm 10.17.0 re-provisioned, baseline lint/typecheck green before Wave 1.

## 2. The seven P2s (each verified pre-dispatch, fixed, pinned)

| # | Finding | The defect | The fix |
|---|---|---|---|
| C-F1 | referral_events INSERT outside the user-creation tx | Both the Telegram and Firebase signup paths ran the referral-event insert as a separate autocommit write AFTER the user-creation transaction — a transient failure left a half-referral with NO self-heal (users.referred_by set, the event row never landing; the retry takes the existing-user path which never re-reaches the insert) — the referrer's +50 award silently never pays while the referee's welcome bonus still does | The insert moved INSIDE each creation tx (the WhatsApp twin's in-tx idiom, verbatim); a forced event-insert failure now rolls back the whole signup — pinned per-channel with zero-surviving-rows atomicity legs (`referral-event-in-tx-r188.test.ts`, 4 tests, mutation-verified) |
| D-F1 | «أصدقاءك» misspelling ×5 sites | The dangling-hamza form rendered on the referrals hero, both loyalty descriptions and two sub-headers — the SAME pages spell it correctly elsewhere (pinned correct by the referrals suite) | All 5 sites → «أصدقائك» + the storefront-copy-r188 source-scan pin (wrong-form absence + the 5 fixed strings byte-exact) |
| D-F2 | frozen «N وحدة» in low-stock alerts | LOW_STOCK_THRESHOLD=3 means the low branch fires only for stock ∈ {1,2,3} — EVERY reachable value rendered ungrammatically, on both the admin drawer alert and the operator Telegram card | `backend/src/lib/arabic-count.ts` (the backend twin of the frontend formatCount machinery): `arabicCountPhrase` + shared `LOW_STOCK_UNIT_FORMS` so the drawer and the card can never drift; pinned 1/2/3 + zero-guard in `stock-notify-gate`, `orphan-inventory-report`, and the new `telegram-count-forms-r188` |
| D-F3 | the frozen-count JSX long tail (17 sites) | The R187 sweep covered the pricing/referrals/alerts/tickets/system families but structurally missed JSX-text sites: dashboard tiles, MobileUserCard, both BulkActionBars, OrdersStatsPanel, ProductCard, CouponsTable, products.tsx, the InventoryUploadDialog's six — «2 طلب اليوم» / «رفع 3 عنصر» rendered wrong on every count | All 17 converted to `formatCount` with per-family forms constants (ORDER_COUNT_FORMS reused; the compound families defined beside their consumers per the house pattern); the four pinning tests asserting the OLD wrong forms updated in the same change; the new `admin-count-forms-r188` suite (14 tests) + mutation spot-checks |
| D-F5 | the bulk-confirm pronoun agreement | «3 طلبات سيتم معالجته» — the resumptive ـه is masculine singular against a plural antecedent, in a MONEY-action confirm | Restructured agreement-proof: «سيتم معالجة ${formatCount(...)}» (the verbal noun governs the counted noun — correct for every count); the `topups-approve-all` pin updated; mutation-verified RED→GREEN |
| E-F1 | the 100 ms wall-clock pin | `rate-limit-store.test.ts:83` budgeted 100 ms on a real-timer path while its siblings budget 2,000 — its ONLY failure mode is a CI event-loop/GC stall (a red CI with zero code regression) | Aligned to the sibling `2_000` + why-comment (the express-rate-limit MemoryStore schedules its own timers — clock-watching is the honest form here) |
| F-F1 | the CI `code` filter omitted the gate-defining files | A push touching ONLY `eslint.config.mjs`, `.npmrc`, or `.dockerignore` skipped checks/tests/build entirely — the file that DEFINES the lint gate was never itself gated | All three added to the filter (with the why-comment) |

## 3. The 32 P3s (grouped)

- **Backend routes (C-F2..C-F7):** the wallet-adjustment post-commit re-read now degrades non-fatally (the R187-G-F5 idiom — a committed adjustment can no longer 500 on a cosmetic re-read); the bulk-refund loop's raw rethrow no longer skips the notification batch + audit row for refunds already committed (try/finally flush with honest partial lists); the pricing recompute binds the read price and guards the UPDATE (`AND v.price_lyd = s.old_price` — an operator's mid-flight override survives instead of being silently clobbered); the variant create/patch + display-price refresh commit in ONE transaction (the R125-I6 class); the cart double-tap 23505 loser converges to the designed bump-quantity outcome; the variant-dupe 23505 loser answers the probe's byte-identical 409 envelope.
- **Runtime guards (B-F1..B-F4):** the checkout requote gate became a flight counter (the first-finishing flight no longer unlocks the CTA while a second is still reconciling — the 98-F2 class); the R148-D1/R94-A1 re-entry guard family completed on its last three members (the variants dialog ⌘S/double-Enter, the admin ticket reply, the admin-account create/edit dialogs).
- **Arabic copy (D-F4, D-F6..D-F14 + the desk's checkout leg):** the diagnostics counts pluralized (اتصال/خطأ/ساعة families); «جاري»→«جارٍ» ×3 + a doc comment; «كود»→«رمز» فريد; the onboarding profile-page pointer aligned with the nav's «حسابي»; «عند الجاهزية»→the R127 standard wording; the Telegram coupon card's «مرة»/«ساعة» pluralization; «lypay»→«LyPay»; the flash-sale watcher's raw ISO timestamp localized like its coupon twin (ar-LY, Africa/Tripoli); «30 يوم»→«30 يوماً» ×2; and the checkout coupon-maxed alert joined the shared TIMES_USED_FORMS (the desk finished the leg R188-3 flagged).
- **Test hygiene (E-F2..E-F5):** the backend (and scripts) vitest configs pin `testTimeout: 10_000` (the R187 CI-timeout lesson generalized — the 5 s default that burned CI round 1 is gone); the whatsapp-readiness doMock now doUnmocks (the sibling idiom); the api-config env-unstub moved to afterEach (one red test can no longer redden its worker's later files — demonstrated with a temporary throw + probe); the 9-file openwa/whatsapp family's env mutations now save/restore through ONE shared `backend/src/test/env-guard.ts` helper (the health-summary-wedge idiom factored once; the afterAll baseline pin demonstrably fails when the guard is disabled).
- **Config/CI (F-F2..F-F8):** the two dead gitleaks allowlist entries (copilot test path deleted R181) removed; **the prettier format gate landed in CI** (after a repo-wide reformat — see §5); the stale "thresholds land in R137" comment rewritten to the standing report-only design; the round-art corpora (7.3 MB) excluded from the Docker build context; env.example reconciled (NEON_API_KEY annotated operator-CLI; IMPORT_SEO_APPLY + WORKER_TIER_ID documented); `backend/vitest.config.ts` + `shared/api-spec/orval.config.ts` entered the typecheck umbrella (a new api-spec tsconfig + typecheck script; **the root typecheck chain is now ×5**); the two stale version comments re-stamped.
- **The seeds verdicts (A):** ShelfRail's missing `select_item` FIXED (the A-F3 shape verbatim + the shelf-rail-analytics-r188 pin — the mobile fold's first product imagery was GA4-blind); F-F5 (OpenWA 200-with-error-body) KEEPS its deferral with NEW in-tree evidence (the R98 gateway source inspection + R149/R150 REST-unchanged records prove send-text failures ride non-2xx statuses; the 200 success-body shape is documented nowhere — the one owner-side curl remains the named unlock); the scheduleIdle consolidation REFUSED with reason (three deliberately-distinct documented timeout semantics; merging churns three source-pinned suites for zero defect); the other seven examined-not-filed items re-verified as non-defects.

## 4. The consciously-skipped items (named, per the ponytail discipline)

- **F-F5 (OpenWA 200-with-error-body):** the standing deferral, now evidence-backed (see §3's seeds verdicts) — the owner-side curl documenting the 200 success-body shape is the named unlock.
- **E-F5's cross-fork vector:** vitest 5's default per-file fork isolation contains the env-tail leak; the guard closes the within-file/failure-path/retry/`isolate:false` vectors and pins the baseline (recorded honestly in the squad's report).
- **B-F2/B-F3/B-F4 pins are source-pins** (the R187 D-F8/D-F11 idiom for the one-line-guard class) — behavioral double-submit legs would need full dialog harnesses the house deemed unnecessary for this class; the endpoints' missing Idempotency-Keys named as the server-side complement (out of scope this round).
- **eslint's `**/*.config.*` ignore** still excludes the two config files from LINT (the fix landed typecheck-only, per the squad's prescribed scope) — the runtime backstops (suite-load failure / orval drift gate) hold.
- **The ShelfRail impression event:** deliberately not added (the A-F3 precedent adds select_item only; an impression would be an unfiled new feature).

## 5. Gates (all green, on the round's final tree)

| Gate | Result |
|---|---|
| `pnpm run lint` | **0 errors / 0 warnings** |
| `pnpm run typecheck` | **clean ×5** (libs + backend + frontend + scripts + **api-spec — new in the chain**) |
| Backend suite | **310 test files / 2,760 tests** (was 306/2,739 — +4 files/+21 tests; run in 7 foreground directory chunks per the standing sandbox constraint) |
| Frontend suite | **320 / 2,913** (was 317/2,889 — +3 files/+24 tests; 4 chunks) |
| Scripts suite | **8 / 74** (unchanged) |
| **Combined** | **5,747** (was 5,702 — **+45, every one a named finding's pin or an extended-suite leg**) |
| OpenAPI ↔ Express parity | **79 enforced implemented ops in sync** |
| ErrorCode sync | **26 codes**, both directions |
| Header-param survival | **9/9** |
| Drizzle drift | **clean** (`generate` → no diff) |
| Orval drift | **consistent** (codegen → no diff) |
| Production build | **green — eager 149,032 B gz** (+3 B vs R187; the 150/160 KiB gates hold), **165 emitted JS chunks** (+1) |
| R181 residue regression | **clean** — the enrichment chunk's single documented `COPILOT_API_KEY` env-name keep; zero calculator bytes |
| Size registers | hold — `checkout.service.ts` compacted back to 999 wc (comment-only hygiene) after the desk's 3-line fix pushed it to 1003 against the 1,000-line ceiling; alerting 1083 = its register max; admin/auth ≤ 1026 |
| **Prettier format gate** | **repo-wide green + a NEW CI step** — the R188 reformat brought 57 drifted files to zero (44 pre-existing at HEAD + the round's own new files), and `prettier --check .` now rides the checks job between lint and typecheck |

## 6. The harness lessons recorded this round

1. **The prettier-reformat pin break (the R187 CI law materialized locally):** the repo-wide reformat wrapped the coupons footer's count line (`·{" "}` idiom) and broke R188-5's own byte-matched pin — the pin was reworked to whitespace-normalized matching IN THE SAME ROUND the format gate landed. Rule reaffirmed and now CI-enforced: pins that byte-match source must anchor format-independently.
2. **The size-gate boundary:** a 3-line fix to a file sitting at its 999/1000 ceiling pushed it over — the compaction (comment-only, zero behavior) rode the same round. Rule: check the size registers BEFORE editing a near-ceiling file, not after the gate reddens.

## 7. Errata for the record (the no-history-rewrite rule)

- None this round: every commit-message claim below is diff-verified before push (the R187-K standing lens applied at ship time).

## 8. Ship record — repo-side CLOSED GREEN, the rotation LIVE

**Push:** `173e6406..3bc58721` fast-forward (three conventional commits: `e8427f23` fix(detail,r188) the code harvest · `12a7af18` chore(format,r188) the 43-file formatting-only reformat · `3bc58721` docs(r188) the round ledger) — **no force-push; remote HEAD re-verified equal to the local HEAD after the push.** A mid-ship restructure, honestly recorded: the first attempt's format commit accidentally carried the new round-close.md (git's untracked-directory collapse put `docs/engineering/R188/` in the residue list) — caught by the commit-message-vs-diff sweep BEFORE the push, both local commits rebuilt cleanly (nothing was pushed in the bad shape; the remote only ever saw the clean fast-forward).

**CI run `40264361117` on `3bc58721` — completed success** (~15 min; all executed jobs green: the gitleaks, path-filter, CVE, scripts/frontend/backend unit suites, the production build, and the lint/typecheck/drift job now carrying **the new prettier format gate**; e2e = the standing by-design push-skip).

**Docker: run `40265438164` dispatched per the sequencing law (push → CI green → dispatch) — completed success** (the GHCR `main-amd64` + `sha-3bc58721-amd64` tags landed).

**The Coolify rotation: LIVE within ~90 s of the image landing** — the production entry rotated `index-BDL0hpyk.js` → `index-CchymUxt.js` (the R187 watcher-lag did not recur; healthz 200 through the cutover).

**Read-only production probes (all green on the serving tree):** `/api/healthz` **200**; `/api/catalog/stats` → 45 products, purchasable floor **980**, no flash sale (the R182 contract intact); the five admin-family **401 gates** (session, metrics, enrichment/status, topups, orders); the live entry's residue sweep — **zero** copilot/calculator bytes, the GA4 `push(arguments)` marker ×1; **the R188 discriminators live**: the new home chunk (`home-BwYdjVhF.js`) carries the ShelfRail `home-shelf` select_item list-id, and the topups chunk (`topups-CyEdiX2k.js`) carries «سيتم معالجة» (D-F5) + «جارٍ ${done}/${total}» (D-F6) with the old broken forms **byte-gone**; a fresh browser session (agent-browser): the homepage + the PDP (`/product/lifetime-cloud-storage`) render with **zero page errors and zero console entries**, the Product-LD carries the honest schema, screenshots captured (`/tmp/r188-live-home.png`, `/tmp/r188-live-pdp.png`).

## 9. Definition-of-done scorecard

- [x] 6-squad audit on rotated lenses (incl. the NEW Arabic-linguistics lens and the seeds squad that closed the prior rounds' deferral ledger) — 39 findings, all triaged, all 7 P2s byte-verified pre-dispatch
- [x] 7/7 P2s fixed + pinned + mutation-verified
- [x] 32/32 P3s fixed or consciously-skipped-with-reason (the skips named in §4)
- [x] +45 tests; combined suite 5,702 → **5,747**; every squad's pins mutation-verified (the two deadline-dead squads' pins desk-spot-checked)
- [x] All gates green on the final tree (lint 0/0 · typecheck ×5 · three suites · parity/error-codes/headers 9/9 · drizzle + orval drift · build 149,032 B · residue clean · size registers · **the new prettier format gate**)
- [x] The R187 rotation-pending item verified CLOSED at round start (production serving the R187 tree)
- [x] The owner's study guide re-stamped (R188 chip · 5,747 tests · 149,032 B) + copied to the sandbox preview
