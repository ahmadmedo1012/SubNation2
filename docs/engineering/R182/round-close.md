# R182 — Round Close: Whole-Product Reliability, Functional Completeness & Production-Verified Engineering

**Date:** 2026-10-22 · **Round:** R182 · **Starting SHA:** `feaf8e514f620f7cdb29ff92430905e1952290ee` (R181's ship-record docs tree) · **Baseline:** clean working tree on `origin/main`, CHANGELOG newest entry R181, R182 confirmed as the next unused round number.

**Scope (owner's directive):** take SubNation from the completed R181 feature-removal release to a genuinely dependable, polished, maintainable production application — with **production browser/runtime integrity** (§2), **catalog truth** (§3), and the **enrichment screen's operational truth** (§4) as the named priorities, followed by whole-surface verification (§5–§10), the full gate battery (§11), and ship + live verification (§12). This report is the evidence trail.

---

## 1. §2 — Production browser/runtime integrity: investigated, classified honestly, no risky change

**The reported symptom:** Firecrawl reported `Failed to fetch dynamically imported module` on `/product/cpanel`, `/product/netflix-premium`, and `/category/streaming`; some related fingerprinted JS URLs returned HTTP 200 when fetched directly; an independent Browser Use audit had found no chunk-load failures on its eight sampled routes.

**The investigation (all on the live 2026-10-22 release, entry `index-DaooghGG.js`):**

1. **Asset-set consistency:** the entry bundle + all 166 unique lazy chunks it references (the full `page-registry` surface via `lazyWithRetry`) + the preload-gate + fonts + CSS were fetched — **every one returns 200**; the HTML carries `no-cache, no-store, must-revalidate` while hashed assets carry `public, max-age=31536000, immutable` (the correct split).
2. **Two independent FRESH browser contexts** (agent-browser, clean storage, SW never registered): homepage + the three flagged routes + SPA navigation between them + a sold-out PDP — **zero page errors, zero console errors, zero failed network requests**; every route renders its real Arabic title and content.
3. **The stale-deploy recovery machinery is complete and tested:** every route chunk rides `lazyWithRetry` (one-shot reload per pathname per session on chunk-load errors, pattern-matched across Vite/Webpack/Safari variants, bubbles to the ErrorBoundary if the reload doesn't recover — behaviorally pinned by `chunk-architecture-r140.test.ts`); the SW is autoUpdate (`skipWaiting` + `clientsClaim`) with a `controllerchange` toast; the SW's JS route is CacheFirst (old chunks stay usable) while the navigation route serves the app shell from the network side (`no-store` HTML ⇒ new entry references new chunks ⇒ cache miss ⇒ network 200).

**The classification:** the failure is **NOT reproducible** on the current release in clean browsers after repeated independent checks. The most plausible cause is a **deploy-race window** (HTML fetched before the Coolify release rotation, chunks after — old chunk URLs 404 once the new release owns the asset directory; the R181 record documents a ~95-minute queue window with the old release serving while the new build sat queued) or a crawler-rendering artifact. Per the mission's explicit instruction — *"record the contradictory evidence and classify it honestly rather than introducing risky production changes just to make Firecrawl output look clean"* — no production change was introduced for this report. The contradictory evidence is recorded here; the release gate ("all tested core routes load the current app and their route-specific module successfully") is verified green.

## 2. §3 — Catalog truth: the fabricated starting price is gone

**The confirmed live defect (2026-10-22):** the homepage hero advertised «تبدأ الأسعار من 59.80 د.ل» while the ONLY purchasable product (`lifetime-cloud-storage`) started at **980 LYD** — 59.80 was the availability-blind catalog minimum (`min(products.price)` over ALL active products, a sold-out product's price). Category cards were verified TRUTHFUL (the `software` category does have the one available product; every other category correctly shows counts without availability badges); product cards were already honest (R130 A7-F1's `displayBaseFromVariants`).

**The fix (backend + frontend + contract):**

- `getProductStatsHandler` (routes/products.ts): `lowest_price` is now the **purchasable floor** — the same population `available_products` counts (active, non-archived, deliverable unsold stock), priced per product at the cheapest **BUYABLE variant** under the two-pool claim semantics via the existing `fetchVariantPoolData` (byte-equivalent to the card/PDT projection), falling back to the row price when no active variants exist; **null when nothing is purchasable**; an ACTIVE flash sale's discount is applied (`computeFlashSalePrice` — the same arithmetic the sale badges ride, the independent-review catch that keeps the hero from overstating the floor during a sale). The in-process 60 s stats cache and the admin-CRUD generation bump ride unchanged.
- `GuestHero.tsx`: purchasable products + finite floor → the count + «تبدأ الأسعار من X د.ل» line (unchanged idiom); **zero purchasable → the truthful «لا توجد منتجات متاحة للشراء حالياً»** with a muted dot (never a fabricated price, never a success-colored dot); a defensive missing-floor-with-stock case renders the count alone.
- OpenAPI `CatalogStats.lowest_price` description rewritten to the live semantics; both orval client targets regenerated.
- **Pinned by:** `product-stats-purchasable-floor-r182.test.ts` (7 backend behavioral tests: the exact live 59.80-vs-980 defect, null-when-empty, two-pool 599.8-vs-79.8, generic-pool floor, no-variant row price, five-field shape, flash-sale discount) + `home-secondary-widgets.test.tsx` (+2: the honest zero line, the defensive branch).

**Trust-claims review (§3 tail):** the storefront's claims were checked against the implementation — «تسليم فوري بعد الدفع» is the designed post-payment credential-delivery behavior; no invented SLAs, refund guarantees, addresses, or payment methods were found or added. The «متاح الآن» category badge and the «1 منتج متاح الآن» count are truthful against live data.

## 3. §4 — The enrichment screen: operational truth shipped, not just better copy

**The confirmed defect (Lane-A read-only analysis):** the review queue's empty state conflated **five distinct backend states** (queue-clear / runner-disabled / **no-worker-tier** / LLM-unconfigured / last-run-failed) into ONE hard-coded hint — «اضبط ENRICHMENT_RUNNER_ENABLED=true على عامل الخادم» — whose prescribed action **cannot succeed in the current deployment**: no worker tier exists (`COOLIFY_FINAL_SETUP.md:130`), and the `WORKER_TIER` gate fires FIRST (`enrichment-runner.ts:22`). The backend exposed **zero** readiness/diagnostic surface; the runner's failures were invisible to every admin surface (`enrichment_runs` had no reader; `latestSuccessful()` was dead code).

**The fix (a real diagnostic contract, modeled on the forecast router's `pipeline_state`):**

- **Backend:** `run-store.latestRun()` (the most recent run of ANY outcome — in_flight/success/failure — ordered by `started_at`) + **`GET /api/admin/enrichment/status`** under the same `requireAdmin` + `inventory` mount: `worker_tier` / `runner_enabled` / `llm_configured` (the non-throwing `llmAvailable()` probe) / `daily_token_cap` (the effective cap the runner would apply) / `last_run {outcome, started_at, completed_at, drafts_generated, failure_reason}`. No secret ever crosses the contract.
- **Frontend:** the page's empty state now derives its diagnosis from the status contract **in the runner's own gate order** (WORKER_TIER → RUNNER_ENABLED → cap ≤ 0 → LLM → failed-last-run → genuinely-clear — the branch ORDER was an independent-review catch and is behaviorally pinned); the header gains a last-run summary line (any outcome, `formatCount` Arabic plurals); mutation errors route through `getErrorMessage` (the R148 errcopy fix this page's query path already had).
- **Contracts:** the parity allowlist's enrichment family gains the status op (same `admin-gap` category — the family's main-spec gap is the repo's standing F-09/F-10 policy decision, not R182's to flip); the enrichment family's OWN contract file (`specs/012-.../contracts/openapi.enrichment.yaml`) gains the full `EnrichmentStatusResponse` + `EnrichmentLastRun` schemas.
- **Pinned by:** `admin-enrichment-status-r182.test.ts` (5 backend behavioral tests: 401 gate, default-env booleans + null last_run, gate-expression parity, newest-run-of-any-outcome with failure_reason, in_flight with null completed_at) + `admin-enrichment-truth-r182.test.tsx` (11 pins: 7 behavioral diagnosis-priority renders — including the cap-outranks-LLM order — + 4 source pins including the retired hard-coded hint and the getErrorMessage routing).
- **Verified preserved:** the runner NEVER publishes (publish stays the explicit, transactional, audit-logged admin action — re-verified this round); the `COPILOT_*` env names stay verbatim (the R181 operator boundary); the manual `tsx src/jobs/enrichment-runner.ts` escape hatch respects the same gates.

**The honest operator-facing result:** with the current deployment (no worker tier), the panel will now say exactly that — the gate order's first blocker, with the smallest real action named (provision a worker tier per the deployment docs, or run the batch manually via the documented command) — instead of an enable-flag instruction that could never work.

## 4. §6 — Admin dashboard: the route inventory + the one real correctness gap closed

**The inventory (Lane-B read-only analysis):** 20 admin page components (19 guarded routes + login), every nav entry maps to a live route, nav-scope ↔ backend-scope parity is test-pinned, the 401 session machinery is coherent (global toast + cache purge + soft redirect + `?redirect` guard), every family carries the loading/error/empty triad, destructive actions confirm with context, money mutations carry idempotency keys. The post-R181 `/admin/pricing` shape verified correct: «إعدادات التسعير» + `PricingConfigCard` + `RecomputePreviewCard`, **zero calculator remnants** in active code (the retirement pins are negative assertions by design).

**The defects closed this round:**

1. **settings.tsx (moderate):** the mount effect fired the settings-scoped fetch pair (`/api/admin/settings` + `/api/admin/settings/auth`) for EVERY authenticated admin — a synchronized 403 pair on every visit for scope-less admins (the R134 A3-F1 "403 burst" class fixed on 14 other pages; this page's tabs hid but the mount fetch never got the gate). Fixed: the effect gates on `canManageSettings`, `setLoading(false)` otherwise.
2. **dashboard.tsx (minor):** the recent-orders query ran with `enabled: !!adminToken` alone while `/api/admin/orders` is orders-scoped — a guaranteed-403 error card with a never-succeeding retry, re-firing every 5 min. Fixed: `enabled` gates on the orders scope + `RecentOrdersStream` renders the scope-note banner (the KPI tiles' `!canSeeMoney` idiom) instead of the outage card for scope-less admins.
3. **layout.tsx (minor):** the top-bar refresh icon-only button gained its `aria-label` twin (the R125 A6-B-11 house convention).
4. **whatsapp.tsx (minor):** the pair-code phone input gained a client-side international-format guard (`^\+?\d{6,15}$`, matching the field's own placeholder contract) with an Arabic destructive toast — the server stays the trust boundary.

## 5. §5/§8/§10 — Storefront, SEO, performance: verified, seven residual a11y defects closed

**SEO (§8, live probes):** sitemap 56 URLs; robots.txt deliberate (auth surfaces crawlable-but-noindex); single canonical per route; complete og sets; **JSON-LD Product with truthful availability** (InStock @ 980.00 for the purchasable product, OutOfStock for the flagged sold-out ones — structured data agrees with the API); unknown products/categories 404. **No code-owned SEO defect found.** GSC/BWT access remains owner-only (the standing record) — noted as the exact remaining access blocker for query-level data.

**Storefront a11y (§5/§10, Lane-C read-only audit — "one of the most a11y-hardened storefronts audited"; 7 residual defects, none blocking a transaction, all closed):**

| # | Surface | The defect | The fix |
|---|---|---|---|
| D1 | PDP `CouponField` (money path) | placeholder-only name; error block never tied to the field (the checkout twin got this fix in R124) | `aria-label` + `aria-invalid` + `aria-describedby → #pdp-coupon-error` |
| D2 | loyalty `ConvertPointsCard` (money action) | placeholder-only name (had invalid/describedby already) | `aria-label="عدد النقاط للتحويل"` |
| D3 | `NotificationBell` trigger | dynamic aria-label but no `title` (the R161 icon-only twin contract) | computed once, applied to both |
| D4 | 3× close/quick-add buttons | missing `title` twins (panel close, support close, ProductCard's disabled sold-out quick-add) | added |
| D5 | wallet `MethodTabs` | two aria-pressed buttons in a bare div — no group semantics on the topup money path | `role="group" aria-label="طريقة الدفع"` (the filter-tabs/VariantSelector idiom) |
| D6 | cart quantity `<span>` | non-conforming `aria-label` on non-interactive content (the Navbar announcer already covers changes) | removed |
| D7 | search suggestions listbox | the «عرض كل النتائج» ACTION row exposed as `role="option"` (options promise selectability) | moved OUTSIDE the listbox (the history panel's own precedent), keeping id/highlight/Enter integration; the r161 suite re-pinned to the new shape |

**Performance (§10):** eager path **148,149 B gz** (150 KiB warn gate holds; +33 B over R181's 148,116); no budget regression introduced.

## 6. The independent review (§11's reviewer requirement)

A dedicated read-only reviewer re-audited the complete combined diff against the runner/service sources. Verdict: **no blockers**; four should-fix findings, ALL applied this round:
1. the diagnosis gate-order contradiction (cap must outrank LLM — the runner's real order) — fixed + behaviorally pinned;
2. no behavioral test could catch an ordering regression — the 7-case render suite added;
3. the new contract language overclaimed vs flash-sale blindness — the floor now applies the active sale's discount + test + contract text;
4. «N مسودة» pluralization — `formatCount` forms.
Plus nits applied (bidi-consistent bare `formatDate`, the cap copy naming "صفر أو أقل", the six-way branch count in docs). Nits deliberately NOT taken: `aria-owns` on the search combobox (the activedescendant+controls pattern is the repo's established shape across both panels; a tree re-parenting is not a regression fix), the OpenAPI-3.1 `nullable:` keyword in the enrichment spec file (pre-existing local convention, doc-only, nothing codegen'd from it), and the two-query race between the stats COUNT and the floor (bounded by the 60 s cache, handled harmlessly by the hero's defensive branch).

## 7. Gates (all green, on the round's tree)

| Gate | Result |
|---|---|
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm typecheck` (libs + backend + frontend + scripts) | green ×4 |
| Backend suite | **288 files / 2,654 tests — all passed** (6 sequential chunks: lib+middlewares 57/741 · services 62/426 · routes 106/914 · jobs 41/306 · src-root 17/249 · workspace-root tests 5/18) |
| Frontend suite | **296 files / 2,732 tests — all passed** |
| Scripts suite | **6 files / 59 tests — all passed** |
| Combined | **5,445 tests** (R181: 5,420; delta +25 = backend +12, frontend +13 — every one itemized above; no suite silently omitted) |
| OpenAPI↔Express route parity | 79 implemented ops in sync (the +1 enrichment status op rides the family's standing admin-gap allowlist entry) |
| ErrorCode sync | 26 codes, both directions |
| Header-param survival | 7/7 |
| Drizzle migration drift | clean ("No schema changes, nothing to migrate") — no schema work this round, both install paths unaffected |
| Generated-client drift | clean (orval regenerated twice — description updates only; `pnpm --filter @workspace/api-spec codegen` + typecheck:libs green) |
| `pnpm audit --prod` | zero known vulnerabilities |
| Production build | green — eager path **148,149 B gz** (warn gate holds); PWA generated |
| gitleaks | not installed in this sandbox (standing state) — CI's secret-scan job runs it; manual sweep of this round's diff found zero secrets (no credential-shaped literal introduced) |

**Environmental deferrals (not regressions, the standing set):** the live-E2E checks requiring real infra (firebase/otp/redis/socket/admin-session/mobile/lighthouse/sentry) and Playwright's pinned browser revision — the same pre-R181 set, documented each round; the e2e/CVE CI jobs remain environment-gated skips (their standing state, honestly counted as skips, not passes).

## 8. Ship record — CLOSED GREEN (the PAT landed; push, CI, rotation, and probes all verified)

- **Starting SHA:** `feaf8e514f620f7cdb29ff92430905e1952290ee` · **Final SHA on `origin/main`:** `eb46c8f640376c8af404326194350352ce29d6b3` (fast-forward `feaf8e51..eb46c8f6`, no force-push; remote HEAD re-verified equal to local HEAD after the push).
- **The unblock:** the owner re-provisioned the GitHub PAT in-session (the workspace-reset pattern's standing answer — source-of-truth #14d/#16f). The staged sequence then executed exactly as documented.
- **CI on `eb46c8f6`** (run `39776018581`): **7/7 executed jobs green** — secret scanning (gitleaks), path filter, lint/typecheck/drift gates, unit tests (scripts), unit tests (frontend), unit tests (backend), production build (API + Vite SPA). The two skips are the standing by-design gates, not failures: `e2e` runs only on `workflow_dispatch`/`schedule`; `CVE scanning` is deps-only-filtered and this push changed no dependency files.
- **Coolify rotation:** live within ~12 minutes of the push (the documented queue-delay did not recur). One transient `healthz` **504 (32.8 s)** was observed at the cutover moment — the new backend container starting — followed by 12 consecutive `200`s. Deployed entry: `index-Al2AYZxc.js`.
- **Read-only production probes — ALL GREEN** (fresh browser context; zero page errors, zero console output, zero failed network requests across the whole run):
  - `healthz` → `200 {"status":"ok"}`.
  - Homepage renders the honest caption — **«1 منتج متاح الآن» + «تبدأ الأسعار من 980.00 د.ل»** — byte-consistent with the live catalog.
  - `/api/catalog/stats` → `total_products 45 · available_products 1 · total_units 4 · lowest_price 980 · has_flash_sale false` — **the purchasable floor is LIVE** (the pre-R182 build answered the availability-blind 59.80 sold-out minimum).
  - `/api/admin/enrichment/status` unauthenticated → **401** — the R182 endpoint is mounted and guarded (the pre-R182 backend would answer 404).
  - The three Firecrawl-flagged routes (`/product/cpanel`, `/product/netflix-premium`, `/category/streaming`) render their real Arabic titles with zero errors; SPA client-side navigation into a sold-out PDP (`/product/shudder`) loads its lazy chunk cleanly with the honest «نفد» variant states.
  - **R181 residue regression:** the full production JS surface was transitive-fetched (entry + **171 chunks, 2,660,682 B, all real JS, zero 404s**) and scanned — zero copilot feature references, zero calculator tokens (`adminPricingCalculate`, `CalculatorInputsCard`, `CalculatorOutputsCard`, `pricing/calculate`, `admin/copilot`, `copilot_previews/actions`). The single case-insensitive `copilot` string in the whole bundle is the **documented verbatim `COPILOT_API_KEY` env name** inside the enrichment diagnostic message (the R181 recorded keep — production Coolify secrets carry it under that name).
- **No production data, secrets, DNS, or Coolify configuration was touched** (the operator-only boundary held throughout; production probes this round were strictly read-only).

## 9. Definition-of-done scorecard

1. Runtime/data-truth problems: **fixed or precisely classified with root cause + evidence** (the Firecrawl finding classified with contradictory evidence recorded — §1).
2. Public storefront + authorized admin families covered by an actual test inventory: **yes** (Lane-B's 20-page route inventory + Lane-C's 21-page storefront audit + the suites).
3. Core journeys' loading/success/empty/disabled/error states: **verified present**; the two scope-blind 403 surfaces fixed.
4. Financial/catalog/security boundaries: **unchanged and re-verified** (no money-path code touched; the pricing/checkout/coupon invariants untouched; the stats surface is display-only — checkout remains the price authority).
5. The enrichment queue: **demonstrably explains its exact operational state** (the status contract + the gate-ordered diagnosis) — honestly naming the no-worker-tier reality instead of pretending a flag suffices.
6. SEO output/structured data/hydration consistency: **verified consistent** (§5).
7. Full required checks genuinely executed: **yes, itemized in §7** (skips named, not counted as passes).
8. Independent review + fixes: **done** (§6).
9. Push + CI + deployment observation: **DONE AND GREEN — the ship record §8 carries the evidence** (push fast-forward verified, 7/7 CI jobs green, rotation observed, all probes green, R181 residue regression clean).
10. This ledger reflects actual evidence: the round's claims above cite files, tests, and probe outputs.
