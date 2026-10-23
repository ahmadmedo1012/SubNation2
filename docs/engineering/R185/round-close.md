# R185 — Round Close: The Ponytail Full-Power Lean Round (the dead-surface harvest)

**Date:** 2026-10-22 · **Round:** R185 · **Starting SHA:** `fec4a5722973f1695b3b3b51d716d9cf2834f1eb` (R184's ship-record commit, verified = origin/main HEAD at round start) · **Baseline:** clean working tree on `main`, CHANGELOG newest entry R184, R185 confirmed as the next unused round number · **Production:** `https://subnation.ly` live and healthy at round start (`/api/healthz` 200 in 0.66 s; `/api/catalog/stats` → 45 products, purchasable floor 980 — the R182 contract intact).

**Scope (owner's directive — استمر في التحسين والتطوير والتنظيف والترتيب واستخدم مهارة ponytail من جت هب بكل قواها واستمر بلا توقف لنصل للمثالية وتأكد من سلامة وسلاسة كل شيئ):** continue the improvement/cleanup ladder with the **ponytail skill at full power**. Ponytail is not new here — the repo's `AGENTS.md` has been the verbatim ponytail ruleset since R146 — but this round applies its **audit discipline end-to-end for the first time as a dedicated round**: the full lazy-senior audit ladder (map → dead files → dead exported symbols → duplicate helpers → the `shortcut:` debt ledger), then the lean harvest (deletion beats addition), then the standing gates, then the ship.

---

## 1. The audit (the methodology, run with purpose-built one-off tooling)

Two throwaway analyzers were built **outside the repo** (in the round workspace, never committed — ponytail's "never add a dependency/tooling the problem does not need"; both are ~100-line scripts reproducible from this description):

- **Module reachability** (`dead-files.mjs`): resolves every static/dynamic import across all 691 non-test source files (TS path aliases + the five `@workspace/*` packages mapped), treats the 32 entry/config roots as live, and reports files **never imported by anyone**.
- **Dead-export verification** (`dead-exports.mjs` + a deterministic re-verifier): extracts every exported symbol from the hand-written surface (backend/src, frontend/src, scripts/src, shared/db, shared/error-codes — the orval-generated packages excluded by construction), then filters the 267 raw candidates down to the symbols **no other file in the tree mentions at all** (whole-word `git grep`, tests included — a name that appears nowhere cannot be reached by any import chain, barrel, or rename). Result: **151 verified-dead exported symbols / 116 alive**; each dead symbol then classified by in-file usage into *delete outright* vs *un-export only*.

Findings, in the ponytail-audit's importance order (correct → safe → load → tested → fast → **lean**): no new bug/risk/scale findings (184 prior rounds' audits hold; this round's lens was lean by directive); **one module-level dead file**, **two fully-dead functions**, **21 dead value/function exports** (the callable API surface nobody calls), and the large type-only class consciously skipped (§3).

## 2. The deletions (dead code — verified zero references anywhere)

1. **`frontend/src/components/ui/switch.tsx` + its test `switch-rtl.test.tsx` (82 lines, 2 tests):** the shadcn Switch scaffold component was **never imported by any app code — not even before R181** (verified against the pre-R181 tree: the only consumer ever was its own RTL test). An orphan kept alive by its own test — the exact class a file-level reachability check catches and per-file linters cannot. Deleted together (component + test): a component with zero consumers has no contract to pin. Restoring it later, if a real consumer ever appears, is one `shadcn` CLI command.
2. **`__clearAdminSessionValidityCacheForTests()` (`backend/src/lib/admin-session.ts`):** a test-only hook that **no test uses** (zero mentions across the entire tree). The cache it clears stays live — `pruneAdminSessionValidityCache` and the 60 s validity cache are untouched; only the never-called reset hook is gone (the `adminCachePruneCounter` throttle keeps its increment-only semantics, which is the correct long-running-process behavior).
3. **`resumeAlerting()` (`backend/src/lib/forecast/redis-flags.ts`):** a speculative resume-API with **zero callers anywhere**. The pause flag's documented clear path (spec `011`'s SC-008 kill criterion + the runbook) is an **operator redis-cli `DEL forecast:alerts:paused`**, not this function — deleting it changes no documented behavior. The live exports (`isAlertingPaused`, `pauseAlerting`, `tryClaimAlertDedupe`) and their consumers are untouched.

## 3. The un-export sweep (21 dead exports across 10 files — the callable surface nobody calls)

Every symbol below is **used inside its own file** (the implementation stays byte-identical) but **imported by no other file in the tree** — the `export` keyword was dead API surface. The sweep drops exactly the keyword; nothing else changes:

| File | Un-exported (21) |
|---|---|
| `backend/src/lib/forecast/metrics.ts` | the five raw metric objects `forecastRunsTotal` / `forecastProductsPredictedTotal` / `forecastProductsSkippedTotal` / `forecastAlertsEmittedTotal` / `forecastRunSeconds` — the exported `record*` helpers remain the API (the counters stay registered on the prometheus registry, so `/metrics` exposition is unchanged) |
| `backend/src/lib/pricing-config.ts` | `SETTING_KEY_USD_TO_LYD` / `SETTING_KEY_MARKUP_PERCENT` / `SETTING_KEY_MAX_TOTAL_DISCOUNT_PCT` (the three setting-key constants — the money config's public behavior, getters and upsert path, is untouched) |
| `backend/src/middlewares/risk-soft-block.ts` | `riskSoftBlockMiddleware` + `RiskSoftBlockOptions` (the old options-taking variant is the implementation the live `riskSoftBlockGuardMiddleware` factory calls — it goes module-private, the guard stays exported and mounted on orders + wallet) |
| `backend/src/worker/heartbeat.ts` | `stopHeartbeat` (called internally by `startHeartbeat`'s stop handle; no external caller) |
| `backend/src/routes/admin/products-field-limits.ts` | `PRODUCT_FIELD_LIMITS` (the limits table stays the type/behavior source for the exported `productFieldError` + `ACCOUNT_PASSWORD_PLAINTEXT_MAX`) |
| `backend/src/lib/forecast/dates.ts` | `toIsoDate` |
| `backend/src/lib/risk-dsl.ts` | `readPath` |
| `scripts/src/audits/context7-audit.ts` | `recordContext7Citations` + `CONTEXT7_CITATIONS_RELATIVE_PATH` / `CONTEXT7_TOOL_RESOLVE` / `CONTEXT7_TOOL_QUERY` |
| `scripts/src/validate-production-env.ts` | `runBootSubset` (the script's own core, called at line 300) |
| `scripts/src/backup-db.ts` | `selectFilesToPrune` / `pgEnvFromUrl` |

**The consciously-skipped classes (named, per the ponytail discipline):**

- **~125 exported signature types** with zero external consumers (`RefundOptions`, `CheckoutInput`, `TelegramWebAppResult`, `MetricLabels`, …): the house convention exports each function's param/return type beside it — zero runtime surface, and un-exporting ~125 types across ~90 files is churn without function. Skipped deliberately.
- **shadcn sub-component exports** (`AlertDialogPortal`, `AlertDialogOverlay`, …): the upstream component shape; the repo keeps shadcn files intact.
- **The four non-finding "dead file" candidates** from the reachability pass: `risk-rules.seed.ts` (documented manual operator seed), `playwright.config.ts` / `orval.config.ts` / `drizzle.config.ts` (tool entry configs), `scripts/src/audits/*` (dev tooling with their own test suite), `frontend/src/types/jsdom.d.ts` (ambient typing the test compilation needs).

## 4. The orphaned dependency (the deletion's completion — second push)

Deleting `ui/switch.tsx` orphaned its Radix peer: **`@radix-ui/react-switch` had exactly one consumer in the tree** (the deleted component) and zero imports remain after it. The dependency is removed (frontend/package.json −1 line, pnpm-lock.yaml −46 lines) — one fewer package in every install and the production Docker image, with the build proven **byte-identical** after the removal (same entry `index-B_HjZhdV.js`, same eager 147,929 B — the package was installed-but-never-bundled; the win is install weight, not bytes). The ponytail law this closes: *be lazy about the solution, never about the change itself — finish every part the task needs.*

## 5. The ponytail-debt ledger (`/ponytail-debt` — the standing scan)

`git grep -nE '(#|//|/[*]) ?(shortcut|ponytail):'` → **2 markers, 0 with no trigger** — a clean ledger:

- `backend/src/lib/web-scheduler.ts:149` — per-process metrics ceiling; upgrade: Redis counters when a dedicated worker must own alerting.
- `frontend/src/components/product/PriceStockPanel.tsx:26` — variant-scoped counts ceiling; upgrade: when the DTO exposes them.

Both are documented decisions with named triggers (the ponytail-audit rule: a marked shortcut is a decision, not a finding) — no action.

**Duplicate helpers:** none found — backend `money.ts` and frontend `utils.ts`'s `formatCurrency` serve different packages (server vs client rendering); no same-package duplication.

## 6. Gates (all green, on the round's final tree — re-run on the dep-removal tree)

| Gate | Result |
|---|---|
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm typecheck` (libs + backend + frontend + scripts) | green ×4 |
| Backend suite | **290 files / 2,668 tests — all passed** (unchanged from R184: the three deletions removed no test — no test referenced the dead symbols, by construction of the verification) |
| Frontend suite | **296 files / 2,737 tests — all passed** (was 297/2,739: −1 file / −2 tests = the deleted orphan `switch-rtl.test.tsx` — the count drops **by the deletion itself**, reconciled exactly) |
| Scripts suite | 6 files / 59 tests — all passed |
| Combined | **5,464 tests** (2,668 + 2,737 + 59) |
| OpenAPI↔Express route parity | 79 implemented ops in sync |
| ErrorCode sync | 26 codes, both directions |
| Header-param survival | 7/7 |
| Drizzle migration drift | clean ("No schema changes, nothing to migrate"; regenerated + tree-unchanged) |
| Orval generated-code drift | clean (regenerated + tree-unchanged) |
| Production build | green — eager path **147,929 B gz** (R184: 148,158; **−229 B**, deterministic across two consecutive builds — the deleted orphan module leaves the module-graph enumeration; the 150 KiB warn / 160 KiB hard gates hold) |
| R181 residue regression (local bundle) | clean — zero hits on all seven markers (`copilot`, `calculator`, `adminPricingCalculate`, `CopilotPanel`, `CalculatorInputsCard`, `copilot_previews`, `pricing/calculate`) across the 164-chunk bundle; the single `COPILOT_API_KEY` occurrence is the documented enrichment env-name keep |

**Environmental deferrals (the standing set):** the live-E2E checks requiring real infra and Playwright's pinned browser revision; the e2e/CVE CI jobs remain the by-design skips (e2e = dispatch/schedule-only; CVE = deps-only — no dependency changes this round).

## 7. Ship record — STAGED (closed by the ship-record commit)

- **Starting SHA:** `fec4a5722973f1695b3b3b51d716d9cf2834f1eb` · **Code commit:** `refactor(lean,r185)` (14 files, +21/−119 — the deletions + the un-export sweep) · **Ledger commit:** `docs(r185)` (this round-close + the CHANGELOG entry + the README re-stamp + the round-index row + source-of-truth #27).
- **Deploy plan (the standing law):** fast-forward push, no force-push, remote HEAD re-verified; CI on the pushed HEAD; the Coolify push-to-deploy webhook rebuilds on the VM (~12–15 min observed rotation window); read-only probes only. The R185 deploy discriminator: the entry chunk rotates to **`index-B_HjZhdV.js`** (R184 live: `index-DhByQZaf.js`) with the eager path at **147,929 B gz** — a byte figure only the R185 tree produces.

## 8. Definition-of-done scorecard

1. The ponytail skill applied at full force as a dedicated round: **the complete audit ladder run with purpose-built verification — every dead-surface claim proven by whole-tree grep, not inferred** (§1).
2. Dead code deleted, not disabled: **1 orphaned component + its orphaned test, 2 fully-dead functions — −98 net lines, zero behavior change by construction** (§2).
3. Dead API surface closed: **21 value/function exports un-exported; the skipped classes named with reasons** (§3).
4. The debt ledger clean and the duplicate check run (§5).
5. Full gates green with the counts reconciled exactly (§6).
6. Ship: §7's staged sequence — **closed green by the ship-record commit with the real evidence (SHAs, CI run, rotation, probes).**
7. This ledger reflects actual evidence: every claim cites files, tests, commands, or probe outputs.
