# R181 — Round Close: The Permanent Feature-Removal Round

**Date:** 2026-10-21 · **Round:** R181 · **Starting SHA:** `10b3e0ee98959a27e675b0794bb14b79c504763c` (R180's tree) · **Baseline:** clean working tree on `origin/main`, CHANGELOG newest entry R179, R180 shipped feat-only (its docs commit never landed — the R180 toolchain round closed through its own commit message).

**Scope (owner's directive):** permanently delete the AI Admin Copilot and the admin profit/margin calculator — deleted, not disabled, not feature-flagged, not preserved as fallback — then continue with a substantial improvement round across the remaining application. This report is the evidence trail.

---

## 1. The Copilot removal — every surface

### Frontend (the panel the owner saw)

| Surface | Disposition |
|---|---|
| `frontend/src/components/admin/copilot/` — CopilotPanel (857 L), CopilotTrigger, CopilotComposer, CopilotHeader, TurnView, AskAnswer, PreviewCard, ConversationSidebar, CopilotHistoryView, ProgressTraceLine, DirectExecutionBadge, ChangeDiff, SuggestionRow, EmptyState, MarkdownLite + the 5 React-free modules (copilot-types/intent/markdown/persistence) | **Deleted** (20 files) |
| The admin-layout mount (`pages/admin/layout.tsx` lines 7–16 lazy import + the trailing `<Suspense fallback={null}><CopilotPanel /></Suspense>`) | **Removed** — no empty container, no phantom suspense boundary, no dead `lazyWithRetry`/`Suspense` imports (both verified sole-usage before dropping) |
| The `Ctrl/Cmd+J`-class launcher affordances, scrim/dialog states | Gone with the components (the trigger owned its own keyboard binding inside the deleted tree) |
| Copilot-only tests: copilot-persistence, copilot-decomposition-r137, copilot-trace-line-r129, copilot-copy, copilot-sse-watchdog-r143 | **Deleted** (5 files) |
| 12 shared suites' `vi.mock("@/components/admin/copilot/CopilotPanel")` blocks + copilot file-list entries (admin-layout ×4, global-search, dashboard ×2, no-native-confirm, r137-extracts, admin-financial-growth, topups, custom-fetch-network URL) | **Surgically removed** — every shared suite re-ran green |
| Dangling component references in shared code comments (GlobalSearch, CopyButton, StockoutRiskPanel, button-a11y, copy-button, storefront-contracts, admin-session SSE) | **Re-worded** — zero references to deleted components remain in live code |

### Backend and API contracts

| Surface | Disposition |
|---|---|
| `backend/src/routes/admin/copilot/` — ask, draft, history, previews, settings (+ the router index) | **Deleted** (6 files) — mount removed from `routes/admin/index.ts`; parity gate re-based 87 → 79 ops |
| `backend/src/services/copilot/` — executor, preview-store, audit (the dual-writer), validator, anomalies, phase-flags, system-prompt, admin-direct, admin-request-tool, tools/{read,draft,operational} | **Deleted** (11 files) |
| `backend/src/lib/copilot/` — ids, rate-limit, secret-scan (+ secret-scan test) | **Deleted** (4 files) |
| `backend/src/middlewares/requireCopilotPermission.ts` + `requireCopilotPhase.ts` | **Deleted** |
| `backend/src/jobs/copilot-reaper.ts` + its boot-one-shot entry + cron roster comments | **Deleted / de-wired** — the boot chain is now the 16-entry roster (tests re-pinned: 10 cron / 4 opportunistic / 2 boot-only) |
| 27 `COPILOT_*` error codes | **Removed** from `shared/error-codes`, the frontend Arabic map, and the openapi ErrorCode enum — all three stay in sync (26 codes, gate green; the sync-gate sanity floors re-based 40 → 20 with documented rationale) |
| OpenAPI: the 7 `/admin/copilot/*` paths, the `CopilotRateLimitResponse` schema, the `copilot` tag, the 13-schema `Copilot*` family (285 lines) | **Deleted** — YAML parses clean (91 paths / 107 schemas); orval regenerated both client targets (`api-client-react` + `api-zod`): zero copilot symbols survive |
| Copilot-exclusive route tests (error-envelope, history-contract, refusal-audit) + the test-DB fixture tables + web-scheduler mocks | **Deleted / cleaned** |
| `specs/010-ai-admin-copilot/` (11 files) | **Deleted** — active spec, retired with the feature |

### Database — the permanent part

- **migrate.ts:** the copilot `CREATE TABLE IF NOT EXISTS` block (previews/actions/action_items, ~80 lines) is **deleted from the live reconciler** — future boots can never recreate the tables. The `updated_at` write-clock columns on `inventory`/`admin_users` and the `products` trigram index **stay** (shared infrastructure: general write-clocks + the live ILIKE product search).
- **V1-M36** (`migrate/stages/04-copilot-removal-r181.ts`, wired into the orchestrator after V1-M35 + the family barrel): probe-gated with the V1-M15/M30 zero-DDL-steady-state idiom. Drops `copilot_action_items` → `copilot_actions` → `copilot_previews` in strict dependency order — **no `DROP … CASCADE` anywhere** (each DROP lands with zero dependents; a partial application fails loud instead of guessing). Deletes the `copilot.phases` `system_settings` row by exact key. Deletes only **positively identified** copilot audit rows — `action LIKE 'copilot.%'` (the dual-writer's `copilot.${actionClass}` stamp) and/or `target_type = 'copilot_action'` — patterns no other audit writer emits; money/admin/security audit history is provably untouched (test-pinned).
- **Drizzle chain 0027** (`0027_spooky_korg.sql`): generated, then hand-hardened per the 0026 convention — drizzle-kit's emitted `CASCADE` drops replaced with the dependency-ordered `IF EXISTS` plain drops + the full provenance header. Snapshot + journal committed; the CI regen-and-diff gate verified clean ("No schema changes").
- **Schema TS:** the three `copilot_*.ts` files deleted; `schema/index.ts` exports removed; the boot-body census pin re-based 41 → 38 tables (both sides of the census moved together).
- **Both installation paths tested:** fresh (chain-apply suite: 38 tables / 29 CHECKs / 35 FKs / 128 indexes, plus three absence pins for the retired tables; boot-body suite: fresh `runMigrations()` asserts the tables are provably absent) and upgrade (the new `migrate-v1m36` suite: 5 tests — the drop of populated tables, audit-only-copilot-rows with the three surviving sibling rows asserted by name, settings-only-copilot-key with the sibling key surviving, idempotent re-run, fresh-install no-op). Repeated boots send zero DDL once converged.

### The LLM transport — the deliberate survivor

`services/copilot/llm-client.ts` + `provider-config.ts` are **shared with the Arabic catalog-enrichment feature** (012 — a live, separate feature importing `copilotChat`/`copilotLlmAvailable`/`getCopilotProvider`). They were **relocated to `backend/src/services/llm/`** with a neutral public surface (`llmChat`, `llmAvailable`, `getLlmProvider`, `hasLlmProvider`, `LlmChatResult`, `LlmEvent`) and the F7 budget test moved along (all 3 tests green). The `COPILOT_PROVIDER`/`COPILOT_API_KEY`/`COPILOT_MODEL`/`COPILOT_BASE_URL` env names **stay verbatim** — production Coolify secrets carry them under those names; renaming would silently break enrichment at the next deploy (operator-only boundary per `.hermes.md`). Every template/matrix/runbook now documents them as the enrichment LLM config with the verbatim-name rationale.

---

## 2. The calculator removal — with the real pricing system preserved

### Deleted (the simulator)

- `CalculatorInputsCard.tsx` (product/variant pickers, custom sandbox, coupon code, referred-buyer toggle), `CalculatorOutputsCard.tsx` (risk badge + WHY, waterfall, MarginRow tiers, worst-case, guardrails, warnings), `MarginRow.tsx`, `pricing-risk.ts` (RISK_STATE maps + riskExplanation).
- The calculate machinery in `pages/admin/pricing.tsx`: the `useAdminPricingCalculate` loop, the `calcSeqRef` race guard, the 300 ms debounce, all 8 calculator state atoms, the products-list query + picker wiring.
- `POST /api/admin/pricing/calculate`: `routes/admin/pricing-calculator.ts` deleted + unmounted; the OpenAPI path deleted; the generated `adminPricingCalculate` operation gone from both clients after regen.
- `CalculatorResponse`/`RiskState` contracts trimmed out of `pricing-types.ts` (only `RecomputeDryRun` remains).
- The calculator-exclusive tests (backend `pricing-calculator.test.ts`; the console suite's 4 calculator describes) and the r139 visual pins' calculator sections.
- Nav terminology: `حاسبة الأسعار` → **`إعدادات التسعير`** (nav-sections label + page title + `SlidersHorizontal` icon + the page subtitle now states the actual rule).

### Preserved (the real pricing system — verified working)

- `backend/src/lib/pricing.ts` (the single discount stack: flash sale → coupon → cap) and `lib/pricing-config.ts` (rate/markup/cap storage + TTL cache) — untouched code, comment residue swept.
- `GET/PUT /api/admin/pricing/config` + `POST /api/admin/pricing/recompute` (+ its `dry_run` preview) — route, permission gate (`inventory`), and the generated client hooks all live.
- `PricingConfigCard` (the writable rule card) + `RecomputePreviewCard` (the dry-run preview — it belongs to the REAL catalog price-recomputation workflow, retained per the reference analysis) + the two-step destructive confirm.
- Checkout pricing, coupon validation, sale discounts, wallet/order totals, loyalty/referral economics, the R167 tier-price anomaly validator — all untouched (their suites re-ran green: money, checkout, orders, refunds, topups).
- The `products` trigram index + `pg_trgm` extension (live ILIKE search), `cost_price` fields (the variant pricing rule + finance/reporting consumers — OpenAPI description re-worded to the live consumers and clients regenerated).

### Regression assertions (the mission's §3)

- **pricing-console.test.tsx** gained the R181 block: the settings title renders, the config card renders, and **no** simulator affordance exists (no «إعادة الحساب», no product picker, no coupon/referred inputs, no risk/worst-case/guardrails text) + **zero** `/api/admin/pricing/calculate` fetches ever fire.
- **admin-pricing-decomposition-r137.test.ts** re-pinned with 8 retirement assertions (the retired imports/handlers/state atoms may not silently return; `pricing-types` may not re-export the calculator contracts).
- **migrate-boot-body / chain-apply** absence pins for the three tables.
- The recompute + cap-config describes re-ran green (zero-write dry run, preview-armed destructive confirm, 10–95 bounds) — the operational pricing flow is provably intact.

---

## 3. The improvement round (the 7-improve lane's findings, applied)

1. **Live-contract fix:** the `cost_price` OpenAPI description named the retired calculator as the field's consumer (and propagated into both generated clients) — re-worded to the pricing rule + finance reads, orval regenerated.
2. **9 dangling consumer-list/comment corrections** in shared code that presented the calculator as a live consumer: `lib/pricing.ts` (×3), `lib/pricing-config.ts` (×2), `catalog.service.ts` (×2), `lib/loyalty-policy.ts` (×1), `schema/products.ts` (×1) — every one now names only live consumers.
3. **llm-client doc honesty:** the `history`/`onEvent` parameter docs referenced the removed SSE route — re-worded as transport-API surface with the retirement noted.
4. **Golden-matrix P6 title:** "calculator economics equal checkout economics" → the surviving truth (one pipeline; the golden model and checkout share `computePricing`).
5. **V1-M36 test strengthened:** the primary drop test now seeds real data and asserts 4 audit rows + the phases row exist BEFORE the drop (the drops destroy real rows, not empty tables).
6. **Boot-one-shot honesty:** the 17-entry chain comment + failure-capture test re-pinned to the true 16-entry roster.
7. **Dead-export verification:** `services/llm/`'s tool-loop types and `adminFetch`'s `timeoutMs` opt have zero production callers post-removal — kept deliberately as the transport API / documented D-3 escape hatch (each carries a one-line note); no other dead exports found (the improvement-scan lane checked every removal-exposed symbol).
8. **Docs reconciliation:** PRICING_ECONOMICS.md rewritten to the live engine (the simulator sections removed, the real rules kept verbatim); LOYALTY_ECONOMICS.md's two calculator-as-live claims re-worded; the architecture diagram, runbook §14, env matrices, operator actions, and both surviving specs (011/012) reconciled — every remaining `copilot` hit in active docs is either a dated historical record, a deliberate retirement note, or the kept env-var name.

---

## 4. Repository-wide residue search (the mission's §3 evidence)

`grep -rni "copilot"` across backend/frontend/shared/scripts/specs/config/deploy — every remaining hit classifies as exactly one of: **(a)** immutable historical evidence (CHANGELOG pre-R181 entries, docs/engineering/**, docs/history/**, the drizzle chain's pre-0027 files + snapshots, dated round records), **(b)** deliberate R181 retirement/provenance notes (the V1-M36 stage, the absence pins, the sync-gate floor rationale, the nav label note), or **(c)** the kept `COPILOT_*` env contract (documented as the enrichment LLM config). Zero active implementation remnants. Same sweep for `adminPricingCalculate` / `useAdminPricingCalculate` / `CalculatorInputsCard` / `CalculatorOutputsCard` / `/api/admin/pricing/calculate`: zero hits outside retirement notes and immutable history.

---

## 5. Gates (all green, on the round's tree)

| Gate | Result |
|---|---|
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm typecheck` (libs + backend + frontend + scripts) | green ×4 |
| Backend suite | **286 files / 2,642 tests — all passed** (clean solo run; one earlier parallel run lost a single file to a worker-fork OOM under 3-suites-at-once contention — the file passes standalone 66/66, re-verified in the clean run) |
| Frontend suite | **295 files / 2,719 tests — all passed** |
| Scripts suite | **6 files / 59 tests — all passed** |
| Combined | **5,420 tests** (baseline R180: 2,707 + 2,788 + 59 = 5,554; the −134 delta is exactly the removed features' exclusive tests, itemized above) |
| OpenAPI↔Express route parity | 79 implemented ops in sync (was 87: −7 copilot ops, −1 calculate op) |
| ErrorCode sync | 26 codes, both directions |
| Header-param survival | 7/7 |
| Drizzle migration drift | clean ("No schema changes, nothing to migrate") |
| `pnpm audit --prod` | zero known vulnerabilities |
| Production build | green — eager path **148,116 B gz** (150 KiB warn gate holds; 455 B under R180's 148,571 — the copilot chunk's weight left with it) |
| gitleaks | not installed in this sandbox — CI's secret-scan job runs it (the repo's own full-history sweeps are documented in docs/history/inspection-r127); manual sweep of the diff found zero secrets |

**Environmental deferrals (not regressions):** the Phase-7 live-E2E checks (firebase/otp/redis/socket/admin/mobile/lighthouse/sentry) that fail in this sandbox for want of live infra — the same set as pre-R180/R179, documented each round.

---

## 6. Ship record

- **Starting SHA:** `10b3e0ee98959a27e675b0794bb14b79c504763c`
- **Commits:** `fc7a3142` (`feat(removal,r181)`, 195 files, +6,455 / −19,559) + `8634b03c` (`fix(security,r181)` — the gitleaks false-positive close-out: the v1m36 sibling fixture key renamed to the plain-word form + the historical SHA on the R163/R168 commit-scoped allowlist). Final SHA: **`8634b03c`** on `origin/main`, no force-push, no unrelated work overwritten (the tree was clean at start).
- **CI on `8634b03c`:** all executed jobs green — secret-scan (gitleaks) success, lint/typecheck/drift success, backend + frontend + scripts unit suites success, production build success (the e2e + CVE jobs are environment-gated skips, their standing state).
- **One mid-round CI event, closed:** the first push (`fc7a3142`) failed the gitleaks gate — the `generic-api-key` entropy heuristic misread the new migration test's synthetic settings-row name `'v1m36.sibling'` (a fixture string, never a credential; the plain-word literals in the same commit all passed). Closed with the repo's established R163/R168 procedure (rename at HEAD + commit-scoped history allowlist); the re-run on `8634b03c` is fully green.
- **Deployment — VERIFIED, the rotation landed after the queued Coolify build window:** both deploy triggers fired and were accepted — the push-to-deploy webhook deliveries for both commits returned 200 OK from the Coolify host, and the sequenced `docker.yml` dispatch pushed the `main` + `sha-8634b03` GHCR tags (the R171 deploy law followed: push → CI green → image). The rotation landed ~95 minutes after the push (the healthcheck-gated rolling update kept the old release serving — healthz 200 throughout — while the new build sat in the Coolify queue; the entry bundle flipped `index-CJQXRrCr.js` → **`index-DeBiZuj7.js`** under continuous probing).
- **Production verification (read-only, no financial mutations):** healthz 200; the storefront `/` + `/api/products` (45 products, prices intact) + `/api/products/by-slug/{slug}` + `/api/flash-sale` all 200 with real data; the LIVE entry bundle + the admin layout chunk + the pricing page chunk (`pricing-CIvbItH5.js`) all carry **zero** copilot references and **zero** `/api/admin/pricing/calculate` references, while `/api/admin/pricing/recompute` and «**إعدادات التسعير**» ARE live in the pricing chunk (the real pricing system, shipped); `/api/admin/pricing/config` answers 401 without an admin session (the inventory-scope guard intact — the route exists and is protected); the retired admin endpoints answer the router-root requireAdmin 401 for anonymous probes (auth fires before route matching — the unauthenticated probe cannot distinguish, but the serving build provably contains no such routes); a slug passed to the numeric `/api/products/{id}` route answers the proper 400 INVALID_DATA (validation intact). An authenticated admin-session render was not probed (no admin credentials in scope and creating one would be a production write) — the local render suites + the bundle-content verification stand in for it.

## 7. Blockers

**None remaining.** The one mid-session observation — the ~95-minute Coolify queue delay before the rotation landed — resolved itself under continuous probing; the push-to-deploy chain (webhook 200 OK → queued build → healthcheck-gated switch) behaved as documented once the build ran. The process-level notes: gitleaks runs in CI only (its verdict on `8634b03c` is success), and the authenticated admin-page render is covered by the local suites rather than a live browser session (read-only production rule + no credentials in scope).
