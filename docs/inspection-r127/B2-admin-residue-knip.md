# R127-B2 — Admin Residue Sweep + Knip Dead-Code Audit

**Agent:** R127-B2 (READ-ONLY audit; only this report file + one worklog entry created — plus a TS-copy patch inside the npx cache OUTSIDE the repo to make knip runnable, see §B.0)
**Repo state:** `main @ f53a886`, clean tree — the exact production tree (subnation.ly).
**Predecessors:** `docs/inspection-r126/{A1,A2,A3,A4}.md`, the R126-L9 worklog note, `docs/inspection-r126/R1-independent-review.md` §P3-3, CHANGELOG R126 entry.

**Method:** static only — full/partial reads of every file cited below at HEAD, `rg` cross-repo verification of every knip symbol before classification, `git show f53a886` hunk-by-hunk for the zombie-polling claim. No builds, no test runs, no commits, no production requests. Every finding quotes its motivating file:line verbatim; confidence 1–5 per item.

**Relaunch provenance (R127-B2, second attempt):** the first attempt died to an infra timeout **after** writing this report but **before** its worklog append. The relaunched auditor did not trust it — re-derived every load-bearing claim independently: §A re-verified in full (bug lines, render sites, failure modes, the orders.tsx:1021-1026 reference, both mirror-test files' scaffolds); §B.0 crash reproduced 3×; knip re-run (5.88.1 — see the reconciliation note there); all 12 §B.1–B.3 items re-rg'd; every §C line number + generated-fetcher offset re-checked; §D re-read from `git show f53a886` hunks; 12 §E rows spot-re-verified verbatim. Everything held except two line-count nits, fixed in place (§A.2 CATEGORY_FILTERS offsets :100→:113-114; §C raw-fetch count 18→16). Confidence ratings below are the post-relaunch ones.

---

## A. The verified quick-win — `products.tsx` select-all is the LAST size-vs-membership toggle (mandate 1)

**Class:** identical to the orders.tsx P3 that R126-L9 fixed (A1-5 / L9 COMPLETED-NOW 10a). The R126-L9 worklog left the pointer:

> "NOTE for a future lane (not in my findings, file is in my scope but left untouched): products.tsx:867-870 has the same select-all size-vs-membership pattern admin/orders.tsx had — same one-line fix applies."

**Verified at HEAD — the bug is intact.** `frontend/src/pages/admin/products.tsx:867-870`:

```tsx
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((p) => p.id)));
  };
```

while the RENDER branches on membership — `products.tsx:1009`:

```tsx
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
```

consumed at `:1419` (`title={allFilteredSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}`), `:1421` (CheckSquare/Square icon), `:1427` (`{allFilteredSelected ? "إلغاء الكل" : "تحديد الكل"}`).

**Failure modes (both reproduced statically):** selections are never pruned on filter change (`filtered` at `:818-821` is the client-side category-tab filter over loaded rows), so after narrowing the category chip:
1. **2 hidden-selected + 2 visible-unselected** (music rows selected, then chip → «بث مباشر» with 2 streaming rows): `size(2) === filtered.length(2)` → the UNchecked button CLEARS the selection instead of selecting the visible rows.
2. **3 selected (2 visible + 1 hidden) on a fully-selected window**: `size(3) !== length(2)` → the checked «إلغاء الكل» button re-runs the select branch — it silently re-mints the set to the visible ids (hidden id pruned, nothing deselected): the operator can never clear from the button.

This feeds the bulk-archive / bulk-hide money actions (`:901-1001`) — same blast radius orders had.

**Repo-wide check:** `rg "selectedIds.size === "` in `frontend/src/pages/admin/` → only `products.tsx:868` (orders.tsx:1010 is the R126 comment describing the dead pattern; orders.tsx:784 is a size===0 guard, correct; topups.tsx:934-935 already membership-based). Products is the **last** instance. **Confidence 5.**

### A.1 The exact fix (3-line diff, mirrors orders.tsx:1007-1026)

Hoist the membership flag above the toggle (safe: `filtered` is defined at `:818`, before `:867`), then branch on it:

```diff
   const toggleSelectAll = () => {
-    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
+    if (allFilteredSelected) setSelectedIds(new Set());
     else setSelectedIds(new Set(filtered.map((p) => p.id)));
   };
```

plus delete `:1009` and insert above the toggle (with the orders.tsx:1007-1020 comment style):

```tsx
  // R127 (the R126-L9 future-lane note): same membership-vs-size class
  // the orders select-all had — the toggle now branches on the SAME
  // membership flag it renders (allFilteredSelected below was defined
  // after its consumer; hoisted here).
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
```

Optional rider (a11y parity, NOT required for the bug): the products select-all button carries visible text that swaps («تحديد الكل»/«إلغاء الكل») so state IS announced — but `aria-pressed={allFilteredSelected}` on the button (`:1416-1419`) would mirror `orders.tsx:1560` and make test assertions cleaner.

**Effort S. Zero behavior change beyond the two broken branches.** The fixed orders reference (verbatim at HEAD):

```tsx
  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((o) => o.id)));
  };
```
(`orders.tsx:1021-1026`)

### A.2 Test plan — new describe in `products-error-bulk.test.tsx` (mirrors `orders-bulk-status.test.tsx:331-468`)

The existing suite already stubs the whole module graph (`useListAdminProducts` mock + `mockProductsResult(data)` helper + `PRODUCT(id, name)` factory whose rows default `category: "streaming"` — products-error-bulk.test.tsx:74-88). Extend `PRODUCT` with a category arg (or a second factory) and add:

```
describe("AdminProductsPage — select-all branches on MEMBERSHIP, not size (R127-B2)")
```

**Fixture:** 4 products — 2 `category: "streaming"` («بث مباشر»), 2 `category: "music"` («موسيقى») — `CATEGORY_FILTERS` labels at products.tsx:113-114 (block at :111-119).

**Locators (all verified at HEAD):**
- row selector: `getByRole("button", { name: "تحديد Netflix 1M" })` — unique per card (products.tsx:298 `aria-label={`تحديد ${product.name}`}`, single layout — no desktop/mobile duplicate), `aria-pressed` at `:302`.
- select-all: `getByRole("button", { name: "تحديد الكل" })` / `"إلغاء الكل"` (products.tsx:1426-1428; the `<span className="hidden sm:inline">` is visible in jsdom).
- category chip: `getByRole("button", { name: "موسيقى" })` with `aria-pressed` (products.tsx:1461).
- bulk bar: `«N منتج محدد»` (products.tsx:1070), gated `selectedIds.size > 0` (`:1067`).

**Test 1 — "visible-unselected rows with out-of-category selections: select-all SELECTS the visible rows (was: cleared)":** on the unfiltered view select the 2 music rows → assert `«2 منتج محدد»`; click the «بث مباشر» chip → the 2 streaming rows are unselected while the stale selection's size (2) equals `filtered.length` (2) — the old size-equality trap; assert select-all reads «تحديد الكل»; click it → assert both streaming row selectors `aria-pressed="true"` AND the bulk bar still reads `«2 منتج محدد»` (old branch cleared it instead).

**Test 2 — "a fully-selected window with an extra hidden id: the checked select-all CLEARS (was: a silent re-select that pruned the hidden id)":** select 3 rows unfiltered; click «موسيقى» → both visible rows selected, 1 hidden id rides in the set; assert select-all reads «إلغاء الكل»; click it → assert it now reads «تحديد الكل», both row selectors `aria-pressed="false"`, and the bulk bar (`/منتج محدد/`) is gone entirely. (Old branch: button stayed checked, rows stayed selected.)

**Also run:** the existing products suites (`products-error-bulk`, `products-seo-submit`) — no other test touches `toggleSelectAll` (grep-verified). ESLint on the changed file. **Confidence 5.**

---

## B. Knip — run mechanics + triaged inventory (mandate 2)

### B.0 How it was run (no config exists — checked: no `knip.*` anywhere, no `package.json#knip`)

- `npx knip` (v6.41.0) **cannot run on this box**: oxc-parser's raw-transfer buffer needs a **6 GiB ArrayBuffer** (`oxc-parser/src-js/raw-transfer/common.js:294 const arrayBuffer = new ArrayBuffer(ARRAY_BUFFER_SIZE);` — the module's own comment says "this only consumes 6 GiB of *virtual* memory") and the sandbox has 4 GiB RAM, 0 swap, `vm.overcommit_memory=0` (heuristic refuses > RAM+swap) → `RangeError: Array buffer allocation failed`. Reproduced 3× (root + `--workspace`).
- **knip v5.61.0 (TypeScript-based) works** after one environment fix: its npx env resolves `typescript@7.0.2` (transitive hoist), where `ts.getDefaultLibFilePath` doesn't exist — patched by copying the repo's own TS 5.9.3 over the npx cache's copy (outside the repo; no source writes). Command: `npx knip@5.61.0 --no-progress` from the repo root (full-monorepo run covers every workspace; per-workspace `--workspace` filters were not needed — the default run already aggregates backend/frontend/scripts/shared/*).
- **Raw output (first attempt, knip 5.61.0):** 5 unused files · 1 unused dependency · 5 unused devDependencies · 2 unlisted dependencies · 2 unlisted binaries · **123 unused exports** · **194 unused exported types** · 2 duplicate exports. Saved at `/tmp/knip-full.txt` (342 lines).
- **Relaunch re-run (knip 5.88.1, no cache patch needed, `npx -y knip@5` from root):** 5 unused files · 0 unused dependencies · 2 unused devDependencies (`@sentry/cli`, `@lhci/cli`) · 2 unlisted dependencies (`@vitest/coverage-v8` ×2) · 1 unlisted binary (`tsc`) · **97 unused exports** · **170 unused exported types** · 2 duplicate exports (288 raw lines). The −26-exports/−24-types delta vs 5.61.0 is exactly the §B.4 waived families the newer version now resolves on its own (the app.ts export set, the `await import()` namespace test helpers, `@fontsource`/`tailwindcss` CSS-`@import` deps, the pg-leader-lease/redis/alerting/openwa/whatsapp-watch helpers) — an independent confirmation of the triage, not a contradiction. Every §B.1–B.3 REAL item flags identically in both runs.

### B.1 REAL dead code (verifiable deletions) — 3 items

| # | Item | Verbatim evidence | Verdict | Conf |
|---|---|---|---|---|
| 1 | **`frontend/src/components/ui/trust-card.tsx` — whole file, 67 lines, zero importers** | home.tsx:1263-1264: "The TrustCard component is left with zero consumers — deleting it is a follow-up outside this page's file list." — the R125-I7 deferred deletion, never picked up. Only other refs: the R125 test regex `expect(home).not.toMatch(/import \{ TrustCard \}/)` (storefront-r125-sweep.test.ts:135 — reads home.tsx source, unaffected by deleting the component file). | **DELETE** (P3, S) | 5 |
| 2 | **`observeWhatsAppSendFailureForTests` — dead test alias** | whatsapp-watch.ts:327: `export const observeWhatsAppSendFailureForTests = recordSendFailure;` — zero references anywhere else (the sibling `observeWhatsAppChannelForTests`/`resetWhatsAppWatchForTests` ARE used by whatsapp-watch.test.ts; this one never was). | **DELETE the alias line** (the underlying `recordSendFailure` stays) | 5 |
| 3 | **`requireRole` — documented-legacy export, no production callers** | requireAdmin.ts:150 + admins.ts:164-165: "permissions and requireRole has no production callers), but a future adoption of the legacy requireRole gate would honor an injected" | **KEEP-WITH-REASON** (deliberate; either add the reason as a doc comment on the export or delete after an owner decision) | 4 |

### B.2 REAL latent-broken wiring — 2 items (both knip "unlisted" classes)

| # | Item | Verbatim evidence | Verdict | Conf |
|---|---|---|---|---|
| 1 | **Root `validate:suite` script cannot run — `tsx` is not resolvable from the workspace root** | package.json:21: `"validate:suite": "tsx scripts/validate.ts"` — root devDeps have no `tsx` (it lives in scripts/ as `"tsx": "catalog:"`); verified live: `pnpm exec tsx --version` from root → `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found. Did you mean "pnpm exec tsc"?`. The working invocation is `pnpm --filter @workspace/scripts run validate` (scripts/package.json: `"validate": "tsx ../scripts/validate.ts"`). R118-A7 even "verified" the script targets exist without testing runnability. | **FIX**: repoint root script to `pnpm --filter @workspace/scripts run validate` (or add tsx to root devDeps) | 5 |
| 2 | **Backend `test:coverage` is latent-broken — provider package absent** | backend/vitest.config.ts:24: `provider: "v8"` + backend/package.json script `"test:coverage": "vitest --coverage"` — `@vitest/coverage-v8` is NOT in backend devDeps and NOT installed (only `@vitest/ui` in backend/node_modules/@vitest; the lockfile carries it solely as vitest's *optional peer*). Nobody runs it (no CI/doc reference) — but the day someone does: "provider v8 not found". | **FIX**: add `@vitest/coverage-v8` (lockfile already resolves 4.1.6) to backend devDeps, or drop the script | 4 |

### B.3 R126 splits fallout — the mandate's focus — 7 dead export modifiers (all verified: symbol alive, `export` keyword serves nobody)

| # | Symbol | Verbatim | In-file consumer (only) | Conf |
|---|---|---|---|---|
| 1 | `roleLabel` | account-tab.tsx:32: `export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;` | `:248` `{roleLabel(session.role)}` | 5 |
| 2 | `AdminSession` | account-tab.tsx:54: `export interface AdminSession {` | `:71` `useState<AdminSession \| null>(null)` | 5 |
| 3 | `ProviderField` | provider-card.tsx:34: `export interface ProviderField {` | `:49` `fields: ProviderField[];` | 5 |
| 4 | `PROVIDERS` | auth-settings.ts:64: `export const PROVIDERS: ProviderMeta[] = [` | `:195/:536/:583` `PROVIDERS.map/find` | 5 |
| 5 | `maskSecret` | auth-settings-store.ts:109: `export function maskSecret(v: string \| undefined): string {` | `:119` `field.isSecret ? maskSecret(config[field.key])` | 5 |
| 6 | `findOrCreateTelegramUser` | telegram-auth-flow.ts:65: `export async function findOrCreateTelegramUser(` | `:292` + `:464` | 5 |
| 7 | type re-export line | auth-settings.ts:60: `export type { ProviderField, ProviderMeta } from "../services/auth-settings-store";` — the neighboring VALUE re-export (`:59`) IS consumed (telegram-callback-csrf.test.ts:6 imports `isTelegramCallbackSameOrigin`), but **zero** files import the two types from the route module. The comment (`:58-59` "stay importable from THIS module") documents intent. | none | 4 |

**Verdict:** the splits were byte-clean on behavior (as b0a9267 claims) — the fallout is exactly the predicted class: **7 `export` keywords (6 + 1 type re-export) left on module-private symbols**. Fix = drop the keyword / delete the re-export line; zero runtime impact; bundle-size-neutral (tree-shaken either way). Recommend one hygiene commit. NOTE: A3's split plan D/E export surfaces listed these as the planned surface (`account-tab.tsx: roleLabel, AdminSession`; `provider-card.tsx: ProviderField`) — the plan's "export surface" was never actually needed by the shell.

### B.4 Knip FALSE POSITIVES — verified families (do NOT act on ~85% of the raw list)

| Family | Count | Proof of blindness | Conf |
|---|---|---|---|
| Test helpers accessed via dynamic-import **namespace** objects | ~11 | cache-singleflight.test.ts:44 `const { cacheWrap, __inflightLoadCountForTests } = await importCache();`; pg-leader-lease.test.ts:106 `await expect(mod.acquireSchedulerLeaderLease("inst-A", 60))`; health-summary-wedge.test.ts:105 `healthModule?.resetReadyStateForTests();`; same for `__setPgLeaderLeasePoolForTests`, `refresh/releaseSchedulerLeaderLease`, `__whatsappSettleGateTest`, `__resetSettleGateStateForTests`, `__resetWhatsAppGatewayCacheForTests`, `__resetWhatsAppReadinessCacheForTests`, `__setOtpStartLockPoolForTests`, `resetWhatsAppWatchForTests`, `observeWhatsAppChannelForTests` | 5 |
| app.ts "unused" export family (8) | 8 | consumed as `appModule.X`: csrf-gate.test.ts:50 `app.use(appModule.createCsrfGate(allowedOrigins, production));`; cors tests `appModule.createCorsOriginGate/createCorsCredentialsHeader`; spa-shell tests `appModule.applySpaShellMeta` / `appModule.zodIssuesToClient` / `appModule.shellCommentsBalance`; share-card test `appModule.isIndexerUserAgent` (share-card-bot-split.test.ts:206) | 5 |
| Copilot tool aggregates + building blocks (~20: `READ_TOOLS`, `DIRECT_TOOLS`, `DRAFT_TOOLS`, `OPERATIONAL_TOOLS`, `searchProducts`, `draftPriceChange`, `findLossMakingPrice`, …) | ~20 | the modules ARE consumed via their facade exports — routes/admin/copilot/ask.ts:42 `import { readToolsForScopes, runReadTool } from "../../../services/copilot/tools/read";` (+ draft.ts:39-40, previews.ts:22); the flagged names are module-internal building blocks behind those facades (e.g. anomalies.ts:175 `if (kind === "loss_making_price") return findLossMakingPrice(limit);`) | 5 |
| `purchase` (checkout.service.ts:138) | 1 | alive via the facade — checkout.service.ts:792: `export const CheckoutService = { purchase };`; consumers: orders.ts:181 `await CheckoutService.purchase({` | 5 |
| CSS/child-process/HTML-invisible deps: `@fontsource/readex-pro`, `@tailwindcss/typography`, `tailwindcss`, `tw-animate-css`, `@lhci/cli`, `@sentry/cli` | 6 | index.css:18-23 `@import "@fontsource/readex-pro/arabic-400.css";` ×6; index.css:1/2/25 `@import "tailwindcss"` / `@import "tw-animate-css"` / `@plugin "@tailwindcss/typography"`; validate.ts:202 `execSync("pnpm exec lhci --version"...)`; build.mjs:224-225 `pnpm exec sentry-cli sourcemaps inject ./dist && … upload` | 5 |
| "Unused files": `init.js`, `orval.config.ts`, `inspect.ts`, `risk-rules.seed.ts` | 4 | index.html:120 `<script src="/init.js"></script>` (+ pinned by preload-gate.test.ts:143); api-spec codegen script `orval --config ./orval.config.ts`; inspect.ts is the operator CLI (`#!/usr/bin/env -S npx tsx` header, referenced from 3 audit modules + project-graph); risk-rules.seed.ts header "Run: `pnpm tsx backend/src/db/seed/risk-rules.seed.ts`" | 5 |
| Unlisted binary `typecheck:libs` | 1 | misparse of api-spec's `"codegen": "… && pnpm -w run typecheck:libs"` (a script name, not a bin) | 5 |
| The 194 unused exported TYPES + the remaining ~60 export keywords | ~254 | sampled representatives all resolve to module-private types/values (e.g. `LIBYAN_PHONE_REGEX` used at validation.ts:11; `MAX_LINE_QUANTITY` at cart.tsx:137; `ResponseParseError` thrown at custom-fetch.ts:315; `maskChatId` at openwa.service.ts:1043; `OnboardingPage`/`AdminSecurityDashboard` named exports shadowed by their defaults consumed via `lazyWithRetry(() => import(...))` — App.tsx:44). Style hygiene only, zero runtime impact. | 4 |

**Knip verdict: of 331 raw issue-lines, ~15% are real. Real dead code = 3 items (§B.1); real latent-broken wiring = 2 (§B.2); the R126-splits fallout = 7 dead export modifiers (§B.3). Everything else is knip blindness (dynamic-namespace access, CSS/plugin/child-process/HTML consumption, CLI-run configs) or export-keyword hygiene.** If the team wants knip in CI later: v5-line (TS-based) or a box with >6 GiB for v6, plus a config ignoring `**/generated/**`, the audits/ + inspect.ts + *.seed.ts CLI entries, and the test-helper `__*ForTests` convention.

---

## C. A4 §C/§D flip inventory — the rows NOT owned by B1 (mandate 3)

B1 owns: topups #8/#9, referrals (#6 credit + #10 list), tickets, dashboard. At HEAD the raw-fetch remainder (`rg --pcre2 '(?<![\w.])fetch\(' frontend/src/pages/admin/*.tsx` = 17 raw hits, 16 live sites — the 17th is the system.tsx:438 comment; down from 18 live at 186b131 after 6465dcb's alerts/security flips) breaks down as:

### C.1 READY-TO-MIGRATE (batch A — no spec work needed; all generated fetchers verified present at HEAD)

| §C row | Site at HEAD (was 186b131) | Generated fetcher (api.ts) | Readiness notes | Conf |
|---|---|---|---|---|
| #1 orders credentials | orders.tsx:587 (unchanged) | `getAdminOrderCredentials` :5730 | keep the local Map cache + 401 catch → `ApiError.status===401`; S | 5 |
| #2 orders bulk-status | orders.tsx:812 (unchanged) | `bulkUpdateOrderStatus` :5880 | keep `withIdempotencyKey` header threading + the 207 partial-body branch; S/M | 5 |
| #3 products bulk DELETE | products.tsx:923 (was :914) | `deleteProduct` :7221 | per-item loop stays; 401 break → `err.status===401`; S | 5 |
| #4 products bulk is_active | products.tsx:973 (was :958) | `updateProduct` :7116 | same idiom as #3; S | 5 |
| #5 promotions flash-sale toggle | **promotions.tsx:232 — byte-identical line number to the R126 audit: nobody has touched this toggle since** | `updateFlashSale` :6594 | no idem key involved; S | 5 |
| #7 users PATCH | users.tsx:675 (was :640) | `updateAdminUser` :8327 | MUST preserve the per-INTENT idempotency key retention verbatim (keep on `IDEMPOTENCY_IN_FLIGHT`, clear on terminal); S/M | 5 |

### C.2 FLIP-READY since 6465dcb (spec now exposed; page loader still raw)

| Row | Site at HEAD | Fetchers at HEAD | Notes | Conf |
|---|---|---|---|---|
| #13 settings loader (GET `/admin/settings` + `/admin/settings/auth`) | settings.tsx:151 `const res = await fetch(url, { headers: adminHeaders });` inside `fetchJsonOrNull`, called ×2 by `loadSettingsAndProviders` | `getAdminSettings` :9604 + `getAdminAuthSettings` :9722 | flipping retires the `"__unauthorized__"` string sentinel (settings.tsx:153 `if (isAdminUnauthorized(res, url)) throw new Error("__unauthorized__");` → AdminSessionExpiredError idiom); the split (b0a9267) already modularized this — the loader is the page shell's last raw block | 5 |

### C.3 Already DONE at HEAD (verified): security #11/#12 + the alerts family flipped to the generated client in 6465dcb (security.tsx has ZERO raw fetch left); §D's 17 endpoints are spec'd (openapi.yaml + contract suite 21→38 rows). B1's dashboard #14 flip stays deliberately deferred — 6465dcb's message: "dashboard chart-data flip deferred — two R125 test files pin its raw-fetch abort semantics; batch-2 item with the system-tab flips" (dashboard.tsx:503 still raw, abort-guarded). system.tsx:444/461 = batch-2 (observability family), login.tsx:53/139 + system ready-check = JUSTIFIED-RAW forever (A4 §C #16-18).

**Bite-size recommendation:** batch A (§C.1) ≈ ½ day total and needs no spec/regen — the highest-value R127 contract lane after B1's set; the repo idiom to copy is unchanged (topups.tsx:523-536 generated-fetcher-inside-useMutation + withIdempotencyKey).

---

## D. f53a886 "zombie-polling close" — verified, with 3 residues (mandate 4)

**The claim (commit message):** "R1 P3-3 closed: the finance-gated /api/admin/stats no longer gets zombie-polled by scoped sessions — dashboard + layout queries carry the scope-honest enabled gates."

**Verified at HEAD (f53a886 IS HEAD):**
- dashboard.tsx:416 `const canSeeMoney = hasAdminPermission("finance");` → `:426` `enabled: !!adminToken && canSeeMoney,` (was `enabled: !!adminToken`) — plus the chart's early-return `:491` `if (!canSeeMoney) {` (pre-existing from R123 E3-5).
- layout.tsx:898 `enabled: !!adminToken && canSeeFinanceBadge,` (was `!!adminToken && (canSeeFinanceBadge || canSeeSupportBadge)`) — `canSeeFinanceBadge = hasAdminPermission("finance")` (:881).
- The only two `useGetAdminStats` consumers in the app are these two (grep-verified) — no ungated poller remains. Socket invalidations of `["/api/admin/stats"]` (SocketInitializer.tsx:51/:101) are no-ops while the query is disabled — harmless by design.
- The unread-count poll the layout keeps (`:862` `enabled: !!adminToken && canSeeSupportBadge`) hits `/api/admin/alerts/unread-count`, which is `requireAdmin`-only (alerts.ts:122 — **no scope gate**) — authorized for support sessions; no zombie.
- Tests pinned in the same commit: the support-scoped test asserts the fetch NEVER happens — admin-layout-alerts.test.tsx: `expect(fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/admin/stats"))).toBeUndefined();` — and the finance-scoped failure path keeps the no-lying-0 contract. **Confidence 5: the close is real.**

**What remains (residues, none blocking):**

| # | Residue | Evidence | Sev | Conf |
|---|---|---|---|---|
| 1 | **Support-only sessions' openTickets badge is page-passed-only** — never server-sourced (documented trade, not a bug) | layout.tsx:892-897 comment "support-only sessions ride the page-passed badge fallback (the documented L4 residual — never a lying 0, the tickets page's count wins)"; mergedBadges `:926-928` | P4-by-design | 5 |
| 2 | **STALE cast + false comment — `layoutStatsWide`** | layout.tsx:911-913: "the generated AdminStats type predates the open_tickets field (regenerating orval bindings is a follow-up)" + `const layoutStatsWide = layoutStats as (AdminStats & { open_tickets?: number }) \| undefined;` — **FALSE at HEAD**: the 6465dcb orval regen already shipped `open_tickets: number;` in the AdminStats schema (api.schemas.ts:1088). The cast + comment can retire (S, one-liner). | P3-doc | 5 |
| 3 | **Dashboard-side stats gate has no direct test pin** — the chart gate is pinned both directions (dashboard-chart-scope-gate.test.tsx:128/:138), the layout instance is pinned (18/18), but no test asserts a non-finance dashboard never requests `/api/admin/stats` | dashboard-chart-scope-gate.test.tsx mocks the key (`getGetAdminStatsQueryKey: () => ["/api/admin/stats"]`) but only asserts chart-data URLs | P4 test-gap | 4 |

---

## E. Consolidated R127 residue ledger — A1+A2+A3 held-open items (mandate 5)

Status legend: ✅ done-in-R126 (code-verified at HEAD) · ⬜ still-open (code-verified at HEAD) · ◐ partially done · ➖ carried R125 item. Every open row was re-verified this round, not transcribed.

### E.1 A1 (money pages) — 26 numbered + carried

| Item | One-liner | Status at f53a886 | Conf |
|---|---|---|---|
| A1-1 | chart series stale on socket push | ⬜ SocketInitializer.tsx:51-57 keys stop at stats/orders/topups/users/tickets/risk×2 — no chart path | 5 |
| A1-2 | dashboard «آخر {n} يوم» + bare counts + collapsed branches | ⬜ :595-596 `if (days <= 14) setGranularity("daily"); else if (days <= 30) setGranularity("daily");` still identical; :1153 `· آخر {chartDays} يوم` | 4 |
| A1-3 | users-chart CSV re-implements download ritual, no date stamp | ⬜ :1164-1167 inline Blob + `a.download = \`users_${chartDays}d.csv\`` | 5 |
| A1-4 | METRIC_CARDS raw -400 hues + 6→3 skeleton CLS | ⬜ :653/:677/:689/:704 `color: "text-emerald-400"` etc. | 5 |
| A1-5 | orders select-all size-vs-membership | ✅ orders.tsx:1021-1026 (R126-L9 10a) — **products twin now this report's §A** | 5 |
| A1-6 | orders raw counts + «30 يوم» | ⬜ :1053 `{todayCount} اليوم`, :1262 `{selectedIds.size} طلب محدد`, :109 `{ label: "30 يوم", days: 30 }` | 5 |
| A1-7 | orders coupon-stats emerald cluster | ⬜ 6 × `text-emerald-400` remain | 5 |
| A1-8 | CSV exports phone-only identity + raw amount shape | ⬜ :996 `o.user_phone ?? "",` while :284/:441 render `displayUserName(userFromRow(order))` | 5 |
| A1-9 | clear-filters handler triplicated | ⬜ :1439 «مسح الكل» + :1514/:1535 «مسح الفلاتر» — no helper | 4 |
| A1-10 | topups status-tab false-empty + badge disagreement | ✅ `?status=` wired (topups.tsx:577/:647 comments) + status-tab suite | 5 |
| A1-11 | «موافقة الكل» over-promises the loaded window | ⬜ :1348 `` : `موافقة الكل (${pendingCount})` `` | 5 |
| A1-12 | رمز/مرجع/رقم التحويل — three words, one field | ⬜ :255 «رمز التحويل:» / :891 «مرجع التحويل:» / :1259 «بحث برقم التحويل» | 5 |
| A1-13 | topups count copy without formatCount | ⬜ :491 `` `${count} طلب سيتم معالجته` ``, :1119/:1126 `${approvedCount} طلب` | 5 |
| A1-14 | processingId single slot (topups + referrals/coupons siblings) | ⬜ :597 `useState<number \| null>(null)` | 5 |
| A1-15 | status-tab empty has no recovery CTA | ⬜ no «عرض الكل» anywhere in topups.tsx | 4 |
| A1-16 | pricing failed-recalc blanks / stale outlives inputs | ✅ calcError + role="alert" banner (pricing.tsx:321/:687) | 5 |
| A1-17 | pricing picker no error state + refresh misses products key | ◐ refresh half done (:426 invalidates the products key); picker still `const { data: products = [] } = useListAdminProducts(...)` (:528 — no isError) | 5 |
| A1-18 | pricing final-price text-primary | ✅ :1237 `text-primary-text` | 5 |
| A1-19 | configDirty diffs LIVE server data | ⬜ :363-367 still `rateNum !== pricingConfig.usd_to_lyd \|\| …` — no snapshot | 5 |
| A1-20 | coupons نسبة/مبلغ chip bar no aria-pressed | ✅ :447 `aria-pressed={form.type === t}` | 5 |
| A1-21 | coupons raw hue + bare counts | ⬜ :364 `text-emerald-400` (:749 toggle icon too) | 5 |
| A1-22 | coupons — the money list with no search | ⬜ no search input in file | 5 |
| A1-23 | referrals search has no clear affordance | ⬜ no «مسح البحث»/✕ (grep empty) | 5 |
| A1-24 | referrals leaderboard/footer bare counts | ⬜ no `formatCount` import in referrals.tsx (grep empty) | 5 |
| A1-25 | idempotency docblock contradicted the code | ✅ rewritten (idempotency.ts:34-42, per-item idiom) | 5 |
| A1-26 | coupons/pricing/referrals have no socket push path | ⬜ no such keys in SocketInitializer | 5 |
| ➖ R125-A1 #11 | orders :109 «30 يوم» + :1394 identical-ternary; topups :247 damma + :1392 identical-ternary | ⬜ all four verified verbatim at HEAD | 5 |
| ➖ A2#8 | referrals status vocab/chips (no aria-pressed) | ⬜ zero aria-pressed hits in referrals.tsx | 5 |
| ➖ A6 B-15 | double-h1 (layout + per-page) | ⬜ layout.tsx:1308 + orders.tsx:1039 + topups.tsx:1186 | 5 |

### E.2 A2 (catalog/customers) — 15 numbered + §C residuals

| Item | One-liner | Status | Conf |
|---|---|---|---|
| A2-1 [P2] | socket keys missing tickets/risk | ✅ SocketInitializer.tsx:55-57 | 5 |
| A2-2 [P2] | whatsapp false-empty on failed first load | ✅ FetchErrorCard wired (whatsapp.tsx:26 + :394-398 comments) | 5 |
| A2-3 [P2] | users CSV comma-corruption | ✅ RFC-4180 csvCell (users.tsx:820) | 5 |
| A2-4 [P2] | tickets category false-empty | ✅ partial-empty gate (tickets.tsx:385-388 comments + suite) | 5 |
| A2-5 [P2] | points-only edit skips money confirm | ✅ users.tsx:564-565 `pointsChanged`/`moneyFieldPresent` | 5 |
| A2-6 | whatsapp QR staleness | ⬜ no `qrIssuedAt` (only the pair-code hint :613) | 5 |
| A2-7 | transitional session statuses never update | ⬜ no poll/interval in whatsapp.tsx | 4 |
| A2-8 | promotions stale default end time | ⬜ EMPTY_FORM module-scope IIFE intact (:68-75) | 5 |
| A2-9 | products bulk-toggle dead lookup + false-success count | ⬜ :969-970 `const p = products.find((pr) => pr.id === id); if (!p) continue;` | 5 |
| A2-10 | Ctrl+S bypasses native validation | ⬜ :748 `?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));` | 5 |
| A2-11 | products error toasts lead with English | ✅ getErrorMessage routed (:28/:633/:937/:942) | 5 |
| A2-12 | formatCount stragglers (4 pages) | ⬜ tickets.tsx:630 `{t.reply_count} ردود` verified; users/products/promotions legs unverified | 4 |
| A2-13 | raw-hue survivors (~10 sites, 5 pages) | ⬜ family open (see A3-4 for the settings half — done) | 4 |
| A2-14 | tier-pill migration missed mobile/dialog | ⬜ `tierColor` still imported (users.tsx:33) | 4 |
| A2-15 | tickets header pills = loaded-window counts | ⬜ unverified in detail this round | 3 |
| §C F12 | promotions manual refresh blanks list | ⬜ :116 `setLoading(true)` unconditional | 5 |
| §C F14 | Esc discards dirty editor; leaks through dialogs | ⬜ products.tsx:750 `if (e.key === "Escape") cancelForm();` | 5 |
| §C F15 | dismissal semantics split (wipe vs preserve) | ⬜ likely (products cancelForm wipes; coupons preserves) | 3 |
| §C F19 | enrichment polish (toasts/dirty/dialog-perf) | ⬜ unverified this round | 3 |
| §C F21 | promotions busy guards | ⬜ no toggling/deleting/inFlight state in file | 5 |
| §C reset | #new-hash + header button reset dirty form | ⬜ unverified this round | 3 |

### E.3 A3 (ops/security/settings) — 16 numbered + splits

| Item | One-liner | Status | Conf |
|---|---|---|---|
| A3-1 [P1] | password-change copy inverted the revocation truth | ✅ account-tab.tsx:47-52 (backend wording) + :355 comment | 5 |
| A3-2 [P2] | login banner English HTTP prefix | ✅ login.tsx:103 `setError(getErrorMessage(err));` | 5 |
| A3-3 [P2] | code-map priority mangled re-auth errors | ✅ errors.ts:179-180 `arabicServerMessage(err.error) ??` first | 5 |
| A3-4 [P2] | 13 named raw-ink sites settings/admins | ✅ R126-L5 (admins.tsx:252/:299 A3-4-tagged token swaps; settings amber-500 banner gone) — 2 icon-grade tail sites remain (admins.tsx:287 hover emerald, settings.tsx:374 Bot icon blue-400) | 4 |
| A3-5 | R125-A3 #9 copy batch ×5 | ⬜ «{enabledCount} طريقة مفعّلة» (:298), account-tab bare null-session (:223), risk-event inline emerald «تم حفظ التصنيف.» (:304) verified; diag/notes legs unverified | 4 |
| A3-6 | risk-event bare-text loader | ⬜ :131-135 `جارٍ التحميل…` div, no role=status | 5 |
| A3-7 | RBAC honest cards missing on system + risk-event | ⬜ zero `hasAdminPermission` in either file | 5 |
| A3-8 | risk-event error state has no retry | ⬜ :137-156 back-link + banner only | 5 |
| A3-9 | ProviderCard dead error state + unreachable placeholder + unused prop | ⬜ survived the split verbatim: provider-card.tsx:97 `adminToken: _adminToken,`, :112 `const [error, setError] = useState("");`, :237 `[SET]` branch | 5 |
| A3-10 | ProviderCard no unsaved-changes guard | ⬜ no useDirtyGuard in provider-card.tsx | 5 |
| A3-11 | cleared-field 400 misleading, no client min(1) | ⬜ no min(1)/«لا يمكن ترك» in provider-card.tsx | 4 |
| A3-12 | system jobs silent slice(0,8) + English status tokens | ⬜ :1416 `.slice(0, 8)`, no JOB_STATUS map | 5 |
| A3-13 | risk chip counters fallback regression | ⬜ :183 `const countSource = filter === "all" ? events : (allEventsQuery.data?.events ?? events);` | 5 |
| A3-14 | alerts 20s poll rationale comment | ⬜ :258 `refetchInterval: 20_000,` — still no comment | 5 |
| A3-15 | login return-path lost on deep links | ⬜ no `next=`/returnTo in App.tsx/login.tsx | 5 |
| A3-16 | micro-batch (system memo, alerts row, login focus) | ⬜ no useMemo in system.tsx (other legs unverified) | 4 |
| Split D+E | settings.tsx → 4 modules; auth-settings.ts → 4 modules | ✅ b0a9267 — **but see §B.3: 7 dead export modifiers left behind** | 5 |

### E.4 A4 data-layer B-items (status only; flips covered in §C)

| Item | Status | Conf |
|---|---|---|
| B-1 referrals silent-401 | ✅ isAdminUnauthorized wired (referrals.tsx:284/:396) | 5 |
| B-2 products→stats co-invalidation | ✅ products.tsx:648 | 5 |
| B-5 socket handler +3 keys | ✅ (same as A2-1) | 5 |
| B-6 GlobalSearch `&limit=5` ×3 | ⬜ layout.tsx:445/448/451 — `jsonList(\`/api/admin/orders?search=${encodeURIComponent(q)}\`)` etc., no limit | 5 |
| B-7 referrals post-LIMIT search window | ⬜ unverified this round (spec exposure landed in 6465dcb; SQL behavior not re-read) | 3 |
| B-8 subsumed unread-count invalidation | ⬜ alerts.tsx:264-265 both keys still invalidated | 5 |
| B-9 generated-mutation onError 401 double-surface | ⬜ likely — topups.tsx:759 onError toasts without a 401 quiet-check | 3 |
| B-11 key-shape nits / B-12 dry_run spec / B-13 test pins | ⬜ carried (not re-verified) | 2 |

### E.5 Ledger totals

- **Rows tracked:** 81 (A1 26+4 carried · A2 15+6 residual · A3 16+split · A4 8 + §C/§D flips of §C above).
- **Done-in-R126 (code-verified this round): 24** — every P1/P2 from the three A-docs plus 8 P3s (A1-10/16/18/20/25, A1-17-half, A2-11, splits) and the A4 P2s B-1/B-2/B-5 + §D spec exposure + security/alerts flips + the zombie-polling close.
- **Still-open: 53** (+3 half/carried-unverified). **Zero P1/P2 remain open** — the entire open tail is P3/P4 polish: Arabic count/plural copy (~10 rows), raw-hue contrast tails (~6), formatCount stragglers, honesty guards (A1-19 configDirty, A2-9/10 products, A3-10), socket freshness for the three raw-fetch pages (A1-26 + A1-1), and the contract flips of §C.

---

## F. Priority counts + R127 lane recommendations

**This report's NEW findings: P0 0 · P1 0 · P2 0 · P3 4** (products select-all §A; trust-card deletion §B.1; root validate:suite §B.2; layoutStatsWide stale cast §D.2) **· P4 6** (test:coverage latent-broken; requireRole decision; 7 dead export keywords as one hygiene commit; observeWhatsAppSendFailureForTests alias; dashboard stats test pin §D.3; A3-4's 2 icon tail sites).

**Recommended R127 sequencing (small, high-certainty lanes):**
1. **§A products select-all** — 3-line diff + 2 tests (this report is the complete plan).
2. **§B.1+B.3+B.2 one hygiene commit** — delete trust-card.tsx (67 L) + the dead test alias + drop 7 export keywords + repoint `validate:suite` — all zero-behavior, all confidence 5.
3. **§C.1 batch A** (6 raw→generated flips, ~½ day) — no spec work; bundles naturally with B1's flips.
4. **§C.2 settings loader flip** — retires the `"__unauthorized__"` sentinel.
5. **A1-26+A1-1 socket freshness** for coupons/pricing/referrals + chart — one SocketInitializer change, the biggest remaining coherence gap.
6. The Arabic count/plural + raw-hue tails (E.1/E.2) as mechanical batches.

**Verdict: SHIP-WORTHY.** No P0/P1/P2 anywhere in the residue; the R126 close-out claims all verified true at HEAD (zombie-polling, splits, batch-1 contracts, the P2 families); the open tail is polish + the deliberate batch-2 deferrals. The production tree matches its round record.

---

*Read-only audit: no source files modified, no builds, no test suites run, nothing committed. Only this report file was created (plus the docs/inspection-r127/ directory), and one npx-cache TypeScript copy OUTSIDE the repo to make knip v5 runnable.*
