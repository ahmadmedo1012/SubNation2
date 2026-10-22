# R183 — Round Close: The Precision & Truth Round (the deeper, more comprehensive, more exact pass)

**Date:** 2026-10-22 · **Round:** R183 · **Starting SHA:** `72e287b7bd7a00a573480cbd262fe657a7ee5345` (R182's ship record, verified = origin/main HEAD at round start) · **Baseline:** clean working tree on `main`, CHANGELOG newest entry R182, R183 confirmed as the next unused round number.

**Scope (owner's directive — الجولة التالية الأشمل والأعمق والأدق):** the deeper, more comprehensive, more precise round. Operationalized as four evidence-driven lanes, each sourced from a fresh four-agent read-only exploration of the FULL codebase at the round's baseline: **(A)** the money-contract truth pass (FINAL_MONEY_INVARIANTS' first full audit since R134 — 16/17 invariants verified in-substance, every drifted citation re-anchored, and ONE materially FALSE statement corrected); **(B)** the guard-surface sweep (the nine admin families the R134 RBAC matrix never pinned); **(C)** the latent frontend scope-gate class (the R182 defect family's remaining members) + the 401-expiry scope-state reset; **(D)** the money behavioral pins (four documented-but-untested contracts, two of which proved to be REAL latent defects when tested); plus **(E)** the docs-truth debt (the R172–R182 reconciliation gap in source-of-truth, the round index's four-way staleness, and two missing CHANGELOG entries).

---

## 1. Lane A — the money-contract truth pass (the sixth full money audit)

`docs/FINAL_MONEY_INVARIANTS.md` had not been re-anchored since R134 (2026-10-12); the code had moved under it twice:

- **M3 was FALSE as documented** — the doc still said mobile_transfer topups REQUIRE a payment reference; R154 (`490597ce`) retired that branch months ago and replaced it with the duplicate-RISK review signal (the `duplicateRiskIds` probe at `topup-create.service.ts:367-372` → the «⚠ خطر تكرار محتمل» admin note + the Telegram card's ⚠ line — signal, never a rejection). The row now states the retirement truthfully, cites the real enforcement sites, and the pinning test file's own header comment (which still described the retired requirement, contradicting its own test bodies at `:101/:114`) was rewritten to match.
- **M2/M12/M15 citation drift** — the enforcement sites moved in R158 (`wallet.ts` → `topup-create.service.ts`) and the R144-B2 migrate decomposition (`migrate.ts` monolith → `migrate/stages/*`); M15 also cited drizzle `0020` for the schema guards (they live in `0019` — `0020_hot_mojo.sql` is the V1-M31 retention-index bundle), and the suite-index header said 74 routes-test files (85 at audit). All re-anchored at `72e287b7`, re-stamped R183.
- **M15's pinning-test mislabel** — `checkout-invariant-order.test.ts` pins the R122 no-order rule, NOT the schema guards; the M15 row now cites the actual pinning suites (the migrate families + `schema-parity.test.ts`).
- Line-anchor drift on M1/M4/M5/M6/M8/M16 (post-R134/R165 growth) and grown suite counts re-measured. **Substance verdict: 16 of 17 invariants implemented AND pinned — many stronger than documented (M5's middleware suite 14→22, M16's telegram battery 12→20); the one drift was M3's statement, now corrected.** §3's journal range (0000…0013 → 0000…0027) and §5's one-command proof line re-measured too.

## 2. Lane B — the guard-surface sweep (the nine unpinned admin families)

The R134 A5-F1 sweep pinned the RBAC composition LAW but left nine families with NO scope-gate pin of their own — each verified only through 200-shape tests mounting the router bare with all-scope tokens, so a mount-order or gate-scope regression in exactly these families would have passed every existing test:

| Family | Gate | The R183 pin (`admin-guard-surface-r183.test.ts`, 5 tests) |
|---|---|---|
| pricing (`GET /pricing/config`) | inventory | 401 → 403 orders-only → **200 inventory-reached** |
| alerts REST (`GET /alerts/new`) | support | 401 → 403 → 200 + the empty-feed shape (the socket twin was pinned; the REST twin never was) |
| settings root (`GET /settings`) | settings | 401 → 403 → 200 |
| settings/auth (`GET /admin/settings/auth`) | settings (root-router mount, `routes/index.ts:59`) | mirrored mount (exact middleware chain, exact order) → 401 → 403 → 200 |
| observability (`GET /observability/summary`) | settings | 401 → 403 → 200 |
| diagnostics (`GET /diagnostics`) | settings | 401 → 403 → 200 |
| auth-stats (`GET /auth-stats/summary`) | admins | 403 wrong-scope → 200 reached |
| `/admins` mount negative (`GET /admins`) | admins | the mount-gate 403 (admins-rbac-subset only ever exercised admins-scope actors) → 200 |
| coupons admin (`GET /api/coupons/admin`) | route-level admin+finance | mirrored `routes/index.ts:54` mount → 401 → 403 → 200 |

The suite mounts the REAL `adminRouter` plus the two mirrored root-router mounts; the `auth_activity` table is provisioned per-file (the openapi-response-contracts convention) so the right-scope assertions prove the handler is REACHED, not just that the gate fires.

## 3. Lane C — the latent frontend scope gates + the 401-expiry scope reset

**The latent 403-burst class (the R182 defect family, closed at the source):** three queries whose ONLY scope gate was the parent page's early return — correct today, but any future ungated mount would fire a guaranteed-403 poll (the dashboard's R182 shape):

1. `StockoutRiskPanel` (`/api/admin/forecast/at-risk`, 5-min refetch) — self-gated `enabled: !!adminToken && canView` (inventory);
2. `TierPriceAuditPanel` (products.tsx local, `/api/admin/products/tier-price-sweep`) — same arm;
3. `enrichment.tsx`'s two queries — `enabled: canView` → `!!adminToken && canView` (the house idiom every sibling uses).

With the arms in place, the repo-wide sweep finds NO admin query left on `canView` alone — the idiom is uniform. The panels' disabled-query render chains verified: null-render stays the hide idiom (TanStack v5: disabled → `isLoading` false, `data` undefined).

**The 401-expiry scope-state reset (`auth.tsx`)** — a real stale-state window: every "admin session ends" route cleared the token, query cache, alert cursor, and socket, but NOT `adminPermissions` (only `adminLogout` cleared them explicitly) — so a scope-gated page re-rendering during the redirect window still believed it held its scopes. `setAdminToken(null)` now resets the permissions at the choke point; the login path is unaffected (token is set FIRST, permissions immediately after — batched into one render), the probe path correctly bypasses (a probe starts a session), and `adminLogout`'s explicit clear becomes idempotent redundancy. **Pinned behaviorally** (the exact login order exercised, `granted` before → `denied` + empty after).

Also fixed: the `products.tsx` comment drift (the block comment claimed StockoutRiskPanel "self-hides when the user lacks the inventory scope" — the panel performed no scope check itself before R183).

## 4. Lane D — the money behavioral pins (two of the four proved REAL)

Four contracts that existed only as comments or frozen-docblock decisions, each now pinned:

1. **The bulk-refund 207 partial envelope** (`admin-bulk-status-guard` +2): a MIXED batch (one refundable + one refunded + one pending) → 207 `{success:false, updated:1, failed:[{orderId, code:"ALREADY_REFUNDED"},{orderId, code:"NOT_REFUNDABLE"}]}` with per-order DB ground truth and exactly ONE wallet_ledger row (the failures moved no money); the all-success batch keeps the legacy 200 shape (no 207 regression).
2. **`PROVIDER_UNAVAILABLE` — a REAL latent gap closed** (`checkout-provider-unavailable-r183`, 3 tests): the FulfillmentFailureReason member had NO mapping anywhere — a future async provider's structured refusal would have escaped as a RAW 500 on the money endpoint (the exact hole PRODUCT_STALE/VARIANT_STALE closed for their own markers). Now: the service catch maps the marker → the retryable CONCURRENCY_ERROR envelope with `code:"PROVIDER_UNAVAILABLE"` (the F4 house rule — no new CheckoutFailureReason member), the route sub-branch answers 409 with the honest provider-outage copy, and the pins prove the full rollback ground truth (balance/order/ledger/inventory untouched) + the live ManualProvider path unperturbed.
3. **The cross-subject durable-key collision** (`admin-adjustment-idempotency` +2): admin N and user N share the `u{id}:` namespace (the frozen on-disk contract, documented in `scopeIdempotencyKey`'s docblock but never tested). Pinned both levels: the route pre-check classifies the collision (409, wallet untouched, the user's original claim intact) and the in-tx backstop (the pre-check race window) rolls the adjustment back with the classified 409.
4. **The buyer-notification best-effort — a REAL latent hazard closed** (`orders-idempotency-route` +1): the "createNotification never fails the 201" contract rested ENTIRELY on the helper's internal catch — the route's bare `await` had no local guard, so a future refactor of the helper's internals would surface POST-COMMIT 500s to buyers whose money already moved. The test PROVED the hazard (pre-fix, a rejecting notification → 500); the fix adds the route-level backstop (try/catch + warn log), and the pin asserts the 201 + the durable money state (balance debited, order + ledger rows present) despite the notification failure.

**Recorded decisions (not changes):** `createApprovedTopup` stays exported (the future automated-gateway path, unit-covered — wiring or de-exporting is a product decision, not a precision fix); the checkout notification count stays one test (the contract is the 201, not the copy).

## 5. Lane E — the docs-truth debt (the R172–R182 reconciliation gap)

- **CHANGELOG:** the R177 entry was missing entirely (the round shipped fully documented — its docs commit `a0f54bf7` just never wrote the ledger entry) and R180 was missing entirely (feat-only ship). Both recorded retroactively, marked as such, content faithful to their real commits (`bdca0a74`, `10b3e0ee`) — including R180's honest self-criticism (four "one-round-each" majors in one round, contradicting R179's standing discipline).
- **Round index** (`docs/engineering/README.md`): wrong in four ways, all fixed — the folder count (36→**38**), the four missing rows (R177/R178/R179/R180), the stale status header (R173), and the stale R182 row (now the shipped-green state with the ship record SHA).
- **source-of-truth:** ZERO reconciliation entries existed for R172–R182 (last was #17/R171) while three of its own entries had been superseded or reversed. Entries **#18–#25** now record: the R172 majors (supersedes #15(c)) + the three standing laws (never `pnpm up` a catalog dep; test the command's own exit code; the redis-6 async-init contract); the R173 audit floor (supersedes #15(d)); the art contract's final two-family shape + the version-sync law; R177's money-display honesty; **the R179 prom-client rename EXECUTED (REVERSES #15(b))**; the R180 toolchain (the second #15(c) supersession + the codeSplitting priority ladder); the R181 removal semantics (the `COPILOT_*` env names are the enrichment LLM config — renaming breaks enrichment at the next boot; 38-table steady state; parity 87→79; error codes 50→26; «إعدادات التسعير»); and the R182 live contracts (enrichment/status, the purchasable floor, the CI-skip semantics refinement, the PAT pattern's in-session resolution). The header status line and the Orders-and-money row (M1–M14 → M1–M17) re-synced.
- **docs/README.md:** the ENGINEERING bucket row (111/79md/22 folders → **132/96md/38 folders**) and the FINAL_MONEY_INVARIANTS row (re-stamped to the R183 sixth audit).

## 6. The independent review

A dedicated read-only reviewer (opus-tier) re-audited the complete combined diff against the real sources. **Verdict: no blockers, ship-able.** Both flagged concerns about the production changes were DISPROVEN with citations: the login-order concern for the auth reset (`establishAdminSession` sets the token first — non-null → no clear — and both statements batch into one render) and the TanStack v5 disabled-query render concern (both panels' null-render chains verified against the actual derived-state semantics). Findings applied:

- **F1 (should-fix):** the TierPriceAuditPanel source pin was a tautology (the page-level idiom satisfied a bare `toContain`) — now a **count-2 pin** (page gate + panel self-gate; deleting the panel's arm fails it).
- **F2/F3 (should-fix):** FINAL_MONEY_INVARIANTS' re-measured counts were stale-on-arrival for the round they document — now stamped post-diff (routes dir 86 files, `orders-idempotency-route` 8, `admin-adjustment-idempotency` 7 with the R183 deltas named).
- **F5 (nit):** `providers/types.ts`'s "rides the EXISTING CheckoutFailureReason members" comment now records the PROVIDER_UNAVAILABLE exception and its F4-rule rationale.
- **F4 (observation, logged for a future round):** the admin-session teardown predicate removes `admin`/`/api/admin*`/`admin-alerts*` query roots but not the literal `admin-risk-*`/`admin-enrichment-*`/`admin-forecast-at-risk`/`admin-observability-*`/`admin-diagnostics` roots — a shared-machine admin switch can flash one refetch round-trip of the previous admin's cached rows. Pre-existing, out of this round's diff, harm REDUCED by the R183 self-gates (token-less sessions stop refetching).

## 7. Gates (all green, on the round's tree)

| Gate | Result |
|---|---|
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm typecheck` (libs + backend + frontend + scripts) | green ×4 |
| Backend suite | **290 files / 2,667 tests — all passed** (6 chunks: lib+middlewares 57/741 · services 62/426 · routes 108/927 · jobs 41/306 · src-root 17/249 · workspace-root 5/18 — the last run per-file: the five worker-topology files interfere when run in one vitest process; individually 18/18 green, a runner-interaction artifact recorded here honestly) |
| Frontend suite | **297 files / 2,739 tests — all passed** |
| Scripts suite | 6 files / 59 tests — all passed |
| Combined | **5,465 tests** (R182: 5,445; delta +20 = backend +13 [guard-surface 5 + provider-unavailable 3 + bulk-refund 2 + cross-subject 2 + notification 1] + frontend +7 [panels 6 + auth scope-reset 1] — every one itemized; no suite silently omitted) |
| OpenAPI↔Express route parity | 79 implemented ops in sync |
| ErrorCode sync | 26 codes, both directions |
| Header-param survival | 7/7 |
| Drizzle migration drift | clean ("No schema changes, nothing to migrate" — no schema work this round) |
| Orval generated-code drift | clean (no contract-file changes this round) |
| Production build | green — eager path **148,157 B gz** (R182: 148,149; +8 B — the 150 KiB warn gate holds) |

**Environmental deferrals (not regressions, the standing set):** the live-E2E checks requiring real infra and Playwright's pinned browser revision — the same pre-R181 set, documented each round; the e2e/CVE CI jobs remain the standing by-design skips (e2e = dispatch/schedule-only; CVE = deps-only).

## 8. Ship record — CLOSED GREEN

- **Starting SHA:** `72e287b7bd7a00a573480cbd262fe657a7ee5345` · **Final SHA on `origin/main`:** `457009e861436a1a06532b794c5ac7dd676ffdc7` (rebased clean onto the owner's concurrently-merged PR #11 `c45ffa4e` — the SEO indexability lane, zero file overlap; fast-forward push `c45ffa4e..457009e8`, no force-push; remote HEAD re-verified equal to local).
- **Commits:** `f0c25816` (`fix(precision,r183)`, 15 files +970/−20) + `457009e8` (`docs(truth,r183)`, 6 files +207/−36).
- **CI on `457009e8`** (run `39804710408`): **all-executed jobs green** — secret scanning (gitleaks), path filter, lint/typecheck/drift gates, unit tests (scripts/frontend/backend), production build. The two skips are the standing by-design gates (e2e = dispatch/schedule-only; CVE = deps-only — no dependency changes).
- **Combined-tree verification** (post-rebase, pre-push): lint clean · typecheck clean · the backend src-root chunk (which contains PR #11's modified `spa-shell-rewrite.test.ts`) 17 files / **250 tests green** (249 + PR #11's +1) · the R183 guard/provider suites re-green · production build green (eager 148,157 B gz unchanged).
- **Coolify rotation:** live within ~15 minutes of the push — the deployed entry rotated `index-Al2AYZxc.js` → **`index-B9PaBJn_.js`**.
- **Read-only production probes — ALL GREEN:**
  - `healthz` → `200 {"status":"ok"}`.
  - **PR #11's new surface live** (the deploy discriminator for the owner's concurrently-merged lane): `GET /product/62` → **301 → `/product/lifetime-cloud-storage`** (the numeric-PDP redirect) — the new backend build confirmed.
  - The homepage renders the honest caption — «1 منتج متاح الآن» + «تبدأ الأسعار من 980.00 د.ل» — byte-consistent with the live catalog.
  - `/api/catalog/stats` → `45 products · 1 available · 4 units · lowest_price 980` — the purchasable floor intact post-rotation.
  - **The R183-guarded families' live 401 gates**: `/api/admin/enrichment/status`, `/api/admin/pricing/config`, `/api/admin/settings`, `/api/admin/observability/summary`, `/api/coupons/admin` — all 401 unauthenticated (fail-closed base verified live).
  - Fresh browser session (homepage + the purchasable PDP + a category page): **zero page errors, zero console output, zero failed network requests**; real Arabic titles everywhere.
  - **R181 residue regression on the NEW bundle:** the full transitive chunk sweep (171 chunks / 2,660,863 B, all real JS, zero 404s) — zero calculator tokens; the single `copilot` string remains the documented verbatim `COPILOT_API_KEY` env keep in the enrichment diagnostic.
- **No production data, secrets, DNS, or Coolify configuration was touched** (the operator-only boundary held; all probes strictly read-only).

## 9. Definition-of-done scorecard

1. The money contract of record: **re-audited end-to-end for the first time since R134 — one materially false statement corrected, all citations re-anchored, nothing overclaimed** (§1).
2. The admin guard surface: **every family now carries a 401/403/200 pin — the R134 matrix's nine blind spots closed** (§2).
3. The R182 scope-gate defect class: **closed at the source (self-gating) + the 401-expiry scope-state reset — no admin query left on the incomplete idiom** (§3).
4. Money behavioral contracts: **four pinned, two REAL latent defects proven and fixed by their own tests** (§4).
5. The docs truth debt: **the R172–R182 gap reconciled (8 source-of-truth entries incl. one reversal + two supersessions recorded), two missing CHANGELOG entries, the four-way index fix** (§5).
6. Independent review: **no blockers; the disproven-concern records + 3 findings applied** (§6).
7. Full gates: **all green, counts reconciled exactly** (§7).
8. This ledger reflects actual evidence: the round's claims cite files, tests, and probe outputs.
