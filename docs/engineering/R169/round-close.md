# R169 — Round close: the comprehensive health round (dependency modernization, CVE sweep, lint-zero, e2e restoration, rollback-image restoration)

> **Round card.** Start `dfefa418` (R168 docs close) → code head
> `587a98d7` on `origin/main` (3 commits: `45922e2b` the dependency
> sweep, `5bc6655e` the lint-zero lane, `587a98d7` the tsx-unification
> fix for a CI-only typecheck break the sweep introduced) → this docs
> commit. Date: 2026-10-19. Scope per the owner directive: «جولة ضخمة من
> الفحص والتشخيص والتحسين والتطوير والترقية الشاملة» — a full
> inspection/diagnosis/improvement/upgrade pass, implementation-first,
> evidence in the commits.

## 1. The diagnostic phase (what the sweep found — and what it ruled out)

Environment recovery first: the reset wiped the pnpm shims and left a stale
`node_modules` (the `scripts` workspace was missing its vitest → local
typecheck failed while CI stayed green). `corepack` shims + a
`--frozen-lockfile` reinstall restored a truthful local baseline. From
there the full diagnostic pass:

- **Production**: healthz 200; the R168 docs push had triggered Coolify's
  per-push rebuild — production now labels release `dfefa41` (runtime
  identical to `c27b7ae5`, the release string is the only diff; entry
  bundle byte-size matches the local build exactly: 122,425).
- **Dependency census**: `pnpm outdated -r` across all five manifests —
  every available bump classified safe-patch/minor vs major-deferred (the
  table in §4). One production dependency flagged **deprecated**:
  `prom-client` 15.1.3 → investigated and **deliberately NOT migrated**
  (see §4: the deprecation notice points at `@prometheus-io/client`,
  which is a *different project* — prometheus/client_js at 0.16.1 with a
  different API — not a rename; a 30-file rewrite of the metrics spine
  for zero functional gain, while `pnpm audit --prod` is clean, fails the
  lazy-senior test).
- **CVE audit**: prod audit **clean** (0 advisories — the CI gate held).
  The full audit (with dev chains) carried **32 advisories, 19 high**.
  Every chain mapped to its owner: `vite-plugin-pwa>workbox>ajv>fast-uri`
  (7 highs), the eslint `@babel` chain (`@babel/core` + 2× `browserslist`
  + `baseline-browser-mapping`), `@sentry/vite-plugin>unplugin>chokidar`
  (`picomatch` 2.3.1 + `braces`), vitest chains (`source-map-js`,
  `fflate`), `pino-pretty>fast-copy`, and six `@lhci/cli` chains (local
  tooling that **never runs on CI** — verified by grep of every workflow).
- **Lint**: 0 errors / **16 warnings** across 11 files (react-hooks
  exhaustive-deps family + one dead test import).
- **Suites**: baseline re-measured green end-to-end — backend 288
  files/2,677, frontend 297 files/2,762 (chunked runs; the 2-CPU workspace
  cannot run either suite in one pass).
- **e2e**: BROKEN locally — `@playwright/test` 1.63.0 requires chromium
  rev **1243**; only 1200 was installed (the prior session's unresolved
  item, wiped again by the reset).
- **Docker/rollback**: `docker.yml` red badge = run #4 (Oct 6, the
  pre-R127-L4 arm64 leg) — the current file is amd64-only and healthy.
  The REAL finding: **no per-commit GHCR image published since Oct 6** —
  the emergency-rollback runbook's `sha-<short>` tags have no image for
  any R163+ head, including current production.
- **Docs truth**: R168's deferred table claimed the `features[]` admin
  write surface was missing — **stale**: R163 shipped it (backend
  `routes/admin/products.ts` L324-331 + the form's features textarea).
  Errata applied to the R168 report (bracketed, per the house rule).

## 2. What shipped

### L1 — the dependency-modernization sweep (`45922e2b`)

Every safe in-range bump, one coherent commit, the lockfile regenerated
once (single-writer discipline — parallel lanes would have contended on
`pnpm-lock.yaml`):

- **Direct bumps**: `esbuild` 0.27.7 → **0.28.2** (GHSA-g7r4-m6w7-qqqr,
  the low arbitrary-file-read — the workspace override and the backend
  pin move together), `socket.io`/`socket.io-client` 4.8.4, `argon2`
  0.45.1 (the `Options` → `HashOptions` type rename; hash/verify/
  needsRehash roundtrip functionally verified), `drizzle-orm` 0.45.4 +
  `drizzle-kit` 0.31.11, `tailwindcss` + `@tailwindcss/vite` 4.3.3,
  `@tanstack/react-query` 5.104.4, the radix set (dialog 1.3.1, slot
  1.5.0, switch 1.4.1, alert-dialog 1.2.1, label 2.1.17), `sonner`
  2.0.8, `@fontsource/readex-pro` 5.3.0, `@testing-library` dom 10.4.2 +
  react 16.3.3, `@tailwindcss/typography` 0.5.20, `@types/pg` 8.23.1,
  `prettier` 3.9.10, `typescript-eslint` 8.71.2.
- **Ten scoped override floors** in `pnpm-workspace.yaml` (the house's
  single-override-home rule), each the minimal patched release and each
  verified by the gate that exercises its chain: `fast-uri` 3.1.8,
  `source-map-js` 1.2.2, `fflate` 0.8.3, `fast-copy` 4.1.0, `lodash`
  4.18.1, `@babel/core` 7.29.6, `browserslist` 4.28.7,
  `baseline-browser-mapping` 2.11.0, `picomatch@^2.3.1` → 2.3.2 (scoped —
  the 4.x resolution elsewhere is current), `postcss-selector-parser`
  7.1.6.
- **caniuse-lite data refresh** (8 months stale; the build nag is gone;
  zero target-browser changes).
- **Result**: full audit **32 → 10** advisories, prod stays **clean**.
  The remaining ten are the documented-accept floor: six `@lhci/cli`
  local-tooling chains (`tmp` 0.0.x, `uuid` 8, `basic-ftp` 5 — no
  in-range patch or a breaking major — plus `extract-zip`, `sprintf-js`
  with no patched release at all) and `braces` under the Sentry watch
  chain (no patched release; a chokidar-4 workaround would be
  unverifiable here — watch-mode only).

### L2 — the lint-zero lane (`5bc6655e`)

**16 warnings → 0**, with the fixes honest rather than cosmetic:

- **Ten real fixes**: the two stale-ref focus races (Navbar + admin
  layout drawers — the cleanup now captures the ref value inside the
  effect, the exact race the rule warns about), `support.tsx`'s `headers`
  memoized on token (the object literal rebuilt every render,
  destabilizing every downstream callback — `fetchTickets`/`openTicket`
  now keep identity per token), the admins/promotions loaders wrapped in
  `useCallback` so their mount effects key on them honestly (no refetch
  loops: `canView`/`headers`/`toast` are all stable), the coupons
  `fetchCoupons` deps completed, whatsapp's `loadSessions` gains
  `canView`, and auth-callback's one-shot redirect joins `navigate` in
  deps (the house convention — wouter's navigate is stable).
- **Six documented intentional omissions** (`eslint-disable-next-line`
  with the why, per the R157 house style): MetaTags' per-render `apply`
  closure (its dep list IS its closure contents), useWhatsAppOtp's
  one-shot auto-submit keying, auth.tsx's once-per-lifetime boot probe,
  and the two tickets/support scroll keyings on (id, reply-count) — the
  documented R120 semantics.
- **Four stale source-scan pins updated** with in-line `[R169]`
  rationale (the R137/R167 decomposition tests pinned literal code
  shapes; the pinned *intent* — page-owned handlers, header-owned focus
  — is unchanged).
- One dead import removed (the orders-order-group test's `notifyNewOrder`
  — the `vi.mock` is self-contained).

### L3 — the e2e restoration + the rollback-image restoration

- **chromium 1243 installed** (the prior session's blocker, closed) and
  the **entire e2e suite re-run against production: 141/141 green** —
  analytics 6, seo 21, mobile-390 21, home/category/search-arabic 24,
  product-detail/cart-gate/auth-gates/api-contracts 27,
  login-page/pdp-band/soldout-pdp 9, cart-drain 3, authed-pdp 30. Every
  spec file, all three viewport projects.
- **`docker.yml` dispatched on the round head** → the first GHCR
  per-commit images since Oct 6, restoring the emergency-rollback
  runbook's `sha-<short>` pull path for the R169 head (verification in
  §3.4).

## 3. The verification record

### 3.1 Local gates (the pre-push truth)

| Gate | Result |
|---|---|
| lint | **0 errors / 0 warnings** (was 0/16) |
| typecheck | clean ×4 (libs, backend, frontend, scripts) |
| backend suite | **288 files / 2,677 green** (chunked: routes+root+mw 126/1,197, services 66/455, lib+jobs 96/1,025) |
| frontend suite | **297 files / 2,762 green** (pages 194/1,775, rest 103/987) |
| vite build | green — eager **147,632 B gz** (+447 vs R168's CI record; radix minors + the dep refresh — inside the 150 KiB warn / 160 fail budget) |
| parity gates | openapi **87 enforced ops** / error-codes **50** / header-params **7/7** |
| drift gates | drizzle: "No schema changes, nothing to migrate"; orval codegen: zero diff |
| audit | prod **clean**; full 32 → **10** (all documented-accept, §2 L1) |

### 3.2 CI (the post-push truth — including one caught-and-fixed break)

The first push (`5bc6655e`) FAILED CI run **#543** on the
`Lint, typecheck, and drift gates` job — a genuine catch, recorded
here for the method: the tailwind 4.3.3 bump had re-resolved the
FRONTEND importer's vite 7.3.7 peer combo to `tsx@4.23.15` (pnpm picks
latest for an un-provided optional peer) while the backend/scripts side
kept the catalog's `tsx@4.21.0` → **two vite instances in one tree** →
`vite.config.ts`'s plugin arrays mixed `Plugin` types from both (TS2769
at the sentry spread + the sourcemap guard). Locally masked by the
two-pass install order; CI's clean install exposed it. The fix
(`587a98d7`): `tsx` pinned to 4.21.0 in the override home — one tsx =
one vite peer combo = one vite instance (the react-pin discipline).
Verified the CI way before pushing: `node_modules` wiped + a
from-scratch `--frozen-lockfile` install → exactly ONE vite dir and
ONE tsx dir in `.pnpm`, typecheck clean, build green, smoke chunk
green. Run **#544 on `587a98d7`** carries the round's badge (secret-
scan, CVE prod audit, build all green on the first push and re-verified
here).

### 3.3 e2e vs production

141/141 green (§2 L3) — the same production that serves real traffic,
read-only probes throughout, no money path touched.

### 3.4 The GHCR rollback image

`docker.yml` dispatched on the final head post-push: the workflow builds
`linux/amd64`, tags `sha-<short>-amd64` + the version/branch family,
and the imagetools merge publishes the canonical tags. Verified: the
package shows the new `sha-…` tag for the round head — the runbook's
`docker pull ghcr.io/ahmadmedo1012/subnation2:sha-<short>` works again
for the first time since Oct 6. (Exact tag listing recorded in the round
worklog at dispatch time.)

## 4. Deferred, with rationale (documented, not lost)

| Item | Rationale |
|---|---|
| `prom-client` → `@prometheus-io/client` | The deprecation notice is misleading: the target is prometheus/client_js (0.16.1, different API), NOT a rename. A 30-file rewrite of the production metrics spine for zero functional gain, while prod-audit is clean — the textbook lazy-senior refusal. Revisit only if the maintainer publishes a true in-place successor or a CVE lands. |
| Major upgrades: zod 4, vite 8, vitest 5, redis 6, pino 10 / pino-http 11, rate-limit-redis 6, recharts 3, web-vitals 6, vite-plugin-pwa 2, lucide-react 1, TypeScript 7, pnpm 12, @sentry/vite-plugin 11 | Each is a one-way door on a production money system (zod 4 = the whole API validation layer; vitest 5 = the test infra; TS 7 = the compiler rewrite). None carries a CVE for us (prod audit clean). Do them as dedicated rounds with their own harness, not as passengers in a broad sweep. |
| The 10 remaining dev-chain advisories | All §2-L1-documented: no patched release exists (extract-zip, sprintf-js, braces) or the only patch is a breaking major on local-only tooling (@lhci/cli chains that never run on CI). |
| `@playwright/test` 1.63 → 1.64 | Chromium 1243 just landed; a bump likely drags another browser revision for zero test-value. Rides the next natural refresh. |

## 5. Owner actions — only the truly unavoidable

1. **The 24 catalog mechanical corrections** — unchanged from R168 §5,
   with one **good-news errata**: the `features[]` surface EXISTS (R163
   shipped it; the R168 deferred row was stale and now carries the
   bracketed correction). All 24 apply-paths are clean; the R162
   document's «(c)» column + per-finding «(i)» paths stand as written.
2. **The 12 R162 business decisions** — the decision table stands.
3. **Deploy note**: Coolify's per-push webhook rebuilt production on
   both code commits (runtime = `5bc6655e` + this docs-only close;
   behavior verified by the 141 e2e greens against the rebuilt
   production).
4. Nothing else — IndexNow (R168 §2.3) and GA4 (R168 §2.2) carry over
   unchanged.
