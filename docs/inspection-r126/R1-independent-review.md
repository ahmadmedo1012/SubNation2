# R126 — Independent Adversarial Review (R1)

> Reviewer: R126-R1 (independent adversarial pass, pre-push)
> Scope: `186b131..HEAD` — 9 commits, 157 files, +16,456/−3,586.
> Method: per-commit + per-concern hostile read; byte-diff forensics on money/auth
> hunks; spot-checks against real handlers and the real built `dist/`; 3 targeted
> vitest runs (29 tests); zero source modifications.
> Verdict: **SHIP** — 0 P0 / 0 P1 / 0 P2; 5 P3 (4 docs/process, 1 cosmetic-code),
> all with one-line remediations. Required-before-push list is docs-only.

---

## 0. Verification performed (evidence base)

- Full `git log`/`git diff` per commit; every money-adjacent hunk read in full
  (topups, users CSV/wallet/points, products+variants emits, wallet routes,
  topup.service, orders, stats).
- Byte-identity forensics on both splits: 8/8 spot-checked functions extracted
  by brace-matching from `b0a9267^` and compared to the split modules
  (identical modulo the added `export` keyword).
- OpenAPI truth: 6 endpoint shapes read out of `shared/api-spec/openapi.yaml`
  (parsed) and diffed against the live handler code (alerts list, tickets
  thread, settings, auth-stats/summary, referrals, chart-data).
- Built-artifact verification: `frontend/dist/` exists, built 2026-10-09
  12:53:50 — **after** the last commit `b0a9267` (12:37:16), i.e. a genuine
  HEAD-state build. Verified from it: emitted gate asset, gate tag placement,
  0 inline scripts, fonts preload/canonical/PWA/pointer:fine CSS. This made a
  fresh `vite build` unnecessary (budget preserved).
- Targeted vitest (3 of 3 allowed): `preload-gate.test.ts` 19/19 ·
  `topups-status-tab-query.test.tsx` 4/4 · `stats-rbac-scope.test.ts` 6/6.
- Sentry option claim verified against the installed
  `@sentry/bundler-plugin-core@4.9.1` type definitions
  (`sourcemaps.filesToDeleteAfterUpload` exists at options-mapping.d.ts:20;
  `deleteSourcemapsAfterUpload` exists nowhere in the package).
- Working tree clean (`git status` empty); no untracked strays.

**Tooling note for future reviewers:** several terminal renders of this repo's
diffs show `aref=` / `const ethod,` — a display artifact that eats `a[h` / `[m`
sequences near RTL text. Raw-byte (`od -c`) checks confirmed the actual sources
contain `a[href]…` and `const [method…`. No file is corrupted; don't re-report it.

---

## 1. Findings

### P3-1 — README/ONBOARDING test-file counts claim "verified at HEAD" but are the round-BASE counts
- `README.md:152-154`: "file counts verified at HEAD, R126 … frontend **148**
  test files … backend **231** test files (227 under `backend/src/**` + 4 under
  `backend/tests/`)".
- `docs/ONBOARDING.md:83-84` repeats "backend suite (231 files)" /
  "frontend suite (148 files)".
- Reality (counted with `git ls-tree -r --name-only` / `git ls-files`):
  - At `186b131` (round base): frontend 148, backend/src 227 (+4 = 231) — the
    README numbers are exactly the BASE counts.
  - At HEAD: **frontend 159**, **backend/src 230** (+4 = **234**). The round's
    own post-restamp commits (`7b729ea`, `b0a9267`) added 11 FE + 3 BE test
    files after `0d8980d` restamped the README.
- Impact: docs-truth only — ironic in a round whose theme is honesty, but no
  functional effect. The A12 report's numbers were correct at its audit time;
  the restamp froze them.
- Fix: one-line restamp (frontend 159 / backend 234, or "≈", or date-stamp the
  count) in README.md + docs/ONBOARDING.md.

### P3-2 — CHANGELOG.md has no R126 entry (repo convention: one per round)
- `CHANGELOG.md:10` — latest entry is R125. The repo's own front-door docs
  (`docs/ONBOARDING.md:21-22`) call CHANGELOG "round ledger"; R123/R124/R125 each
  have a dedicated round-record commit. R126's 13 inspection reports are
  committed but the ledger entry is absent.
- Impact: process/docs only. R125's record also landed as a separate trailing
  `docs(r125)` commit, so this is a missing follow-up rather than a broken
  claim.
- Fix: add the R126 entry (the commit messages are already written to
  changelog-grade prose).

### P3-3 — Scoped (non-finance) admins now poll a 403-ing endpoint forever
- `backend/src/routes/admin/stats.ts:96-116` gates `/stats` +
  `/chart-data` behind `requirePermission("finance")` (correct).
- But the frontend `enabled` gates were not aligned:
  - `frontend/src/pages/admin/dashboard.tsx:418-430` — stats query
    `enabled: !!adminToken` (no scope check).
  - `frontend/src/pages/admin/layout.tsx:889-894` — layout stats query
    `enabled: !!adminToken && (canSeeFinanceBadge || canSeeSupportBadge)` — a
    support-only admin (badge=true, finance=false) keeps firing the query.
- Consequence for a support-only session: both queries 403 on mount and every
  5 min (`refetchInterval: 300_000`). Degradation is graceful and silent (data
  undefined → empty tile grid, badges fall back to page-passed counts — the
  documented trade in stats.ts's comment), no toast, no crash, no redirect.
- Mitigations: the sole operator account holds `["all"]` (per commit message;
  `hasPermission` treats `all` as wildcard — permissions.ts:43-49), so the
  production dashboard is unaffected. This is a zombie-request/noise issue, not
  an availability or info-leak issue (403 leaks nothing).
- Fix (optional, one line each): narrow `enabled` to the finance scope (layout
  can key the stats query on `canSeeFinanceBadge` alone; the support badge's
  `open_tickets` already falls back to page-passed counts per the accepted
  trade).

### P3-4 — `.hermes.md:15-22` now asserts "CI runs green on every push"
- Not verifiable from this sandbox (no network; no in-repo CI run logs). The
  claim replaces the old false "CI is billing-disabled" line — directionally
  truthful if the repo is public, and the stale `develop` branch-filter leftover
  is now documented honestly as inert. Flagging only so the operator ties the
  claim to a green run link in a future docs pass.
- No code impact.

### P3-5 (observation, no action required) — `?ticket=` deep link not stripped after consumption
- `frontend/src/pages/support.tsx:358-377`: the consumed-once ref prevents
  re-opening within a session, but the URL param persists — a refresh re-opens
  the thread. This matches the "continuation contract" framing (`/orders/:code`
  idiom), so it is arguably intended; noting for completeness.

**No P0/P1/P2 findings.** Specifically: no money-path regression, no auth
regression, no CSP/boot regression, no test-weakening, no split corruption, no
contract lies, no concurrent-lane debris.

---

## 2. Challenged-and-cleared table (the round's claims vs what I proved)

| # | Claim (commit) | Attack mounted | Verdict |
|---|---|---|---|
| 1 | External CSP-clean preload gate + build-time inline-script gate (a505e3c) | Read `PRELOAD_GATE_SOURCE`/`injectPreloadGate`/`buildPreloadGateTag` + the bundle-budget gate regex; verified the HEAD-built `dist/`: asset `assets/preload-gate-UNflcRlC.js` emitted, sha256(source) base64url[:8] = `UNflcRlC` (content-addressed correctly), `data-home-chunk="/assets/home-CUBquM7i.js"` and that chunk exists, tag first child of `<head>` before charset/CSS, exactly 4 `<script>` tags in the built shell — all with `src` (0 inline). Regex analysis: `/<script\b(?![^>]*[\s"']src[\s]*=)[^>]*>/i` after comment-stripping catches src-less opening tags (incl. importmap/module), is case-insensitive, tolerates `src =`, and fails safe (over-flags `data-src`-style attributes rather than missing real ones). Backend serves `/assets/*` immutable 1y (app.ts:1490-1497); helmet script-src `'self'`, no `unsafe-inline` in prod (app.ts:175-192). Fonts preload ×4, canonical, PWA registerSW, modulepreloads all intact in the built head. 19/19 unit tests green. | **CLEARED** — and the emitted artifact is genuinely better than the R125 inline gate it replaces |
| 2 | Password-change honesty + errors.ts priority + no redirect loop (e8088fd) | Read account-tab.tsx:159-205: success surfaces `res.message` (backend's own wording), `setAdminToken(null)` + deliberate `navigate("/admin/login")`. `setAdminToken(null)` (auth.tsx:237-277) also removes all `/api/admin` query caches + alert cursor — no zombie stale session; both the settings shell guard and the tab navigate to the same login route (no loop); dirty-guard disarmed by field resets before nav. errors.ts: new `arabicServerMessage` priority keeps the 96-F7 leak guard (Arabic-script regex) and the code-map as fallback; lockout minute-count test kept; wallet «رمز التحويل» verified (routes/wallet.ts). | **CLEARED** |
| 3 | Telegram netLabel allowlist + Arabic copy sweep (501e40c) | `PAYMENT_NETWORK_LABELS` covers libyana/madar/lypay/sadad; unknown → line omitted (no more false «ليبيانا» for LyPay). Only call site (wallet.ts:691) always passes a string (`?? ""`); `input.network` is non-optional `string` — no `.trim()` NPE. Duplicate-reference 409 keeps the machine code on `.code`, Arabic on `.message` (test updated equivalently). All other hunks copy-only. | **CLEARED** |
| 4 | stats RBAC finance-scope + no-store + audit rows + 8 emit sites + FILTER fold (e0fd793) | `requirePermission("finance")` on both `/stats` and `/chart-data`; `hasPermission` wildcard `all` (permissions.ts:48) → operator unaffected; scoped admins degrade gracefully (P3-3 notes the zombie polling). 401 no-store at BOTH producers: requireAdmin stamps at entry (all branches) + auth router `router.use`; straggler suite covers bare-mount middleware, garbage-token 401, inline login 401. Products emits counted: exactly 8 (products.ts: create/update/archive/set-count[only surplus>0]/inventory-upload = 5; product-variants.ts: create/update/delete = 3), all post-write fire-and-forget with `.catch` logging, `emitToAdmins` null-safe (socket.ts:1129-1134). 14-test emit suite pins them. FILTER fold: predicates mirror the old queries exactly (same fields, same predicates); stats-rbac-scope suite re-pins values against seeded fixtures — 6/6 green. Ticket reply/status audit rows added (orders idiom, no message body copied). | **CLEARED** (frontend zombie-poll residue → P3-3) |
| 5 | topups `?status=` per-tab (70489a2) | Backend route supports `?status=` with pg-enum validation + 400 on fake values (routes/admin/topups.ts:57-73, round-94 A5-03) — the param is real, not decorative. Query-key `["/api/admin/topups","load-more",{status,limit}]` still prefix-matched by `getListAdminTopupsQueryKey()` (returns `["/api/admin/topups"]`, generated api.ts:6016-6018) → approve/reject/bulk/socket invalidations cover every tab. Bulk-approve idempotency untouched (per-iteration `generateIdempotencyKey()`, re-click guard); approveAll filters loaded pending rows and its button hides when `pendingCount===0` (other tabs show no pending rows — no phantom bulk). Sidebar badge = layout server stats with page-prop fallback (layout.tsx:915) — parity preserved. 4/4 tests green. | **CLEARED** |
| 6 | users CSV RFC-4180 + points-confirm (70489a2) | `csvCell` (users.tsx:150-164) quotes every cell, doubles embedded quotes — commas/د.ل/newlines stay cell-local; no column-shift or injection vector via quoting. Points-confirm: gate widened to `walletValue !== null \|\| pointsChanged` (users.tsx:601) with LYD-equivalent sentence (100:1) + clamped preview; cancel path tested; PATCH body only carries `loyalty_points` when changed. The old "loyalty-only skips confirm" pin was replaced by a STRONGER contract (confirm + cancel + clamp tests) — intentional behavior change, not a weakening. | **CLEARED** |
| 7 | socket invalidation keys, whatsapp, referrals 401, products co-invalidation, bulk toasts, select-all, pricing stale-keep (70489a2) | Socket key-set 4→7 (stats/orders/topups/users + tickets + 2 risk keys) — matches the real query keys (tickets.tsx:191 `["/api/admin/tickets","load-more",…]`, risk.tsx:110/144/176); resync handler got the same 7; tests assert 7 then 14 calls (stronger). referrals list joins `isAdminUnauthorized` guard. whatsapp first-load → FetchErrorCard + retry (no false empty). products invalidate() co-invalidates `["/api/admin/stats"]`. Bulk failure reasons route through `getErrorMessage` (message-less 502 bodies collapse to Arabic generic instead of bare "HTTP 502"). select-all branches on membership (same flag it renders). pricing keeps last good result behind a `role="alert"` stale banner. | **CLEARED** |
| 8 | storefront: mobile CTA + sold-out precedence + URL mirrors + redirects + og:image + sitemap (7b729ea) | `onAddToCart={handleAddToCart}` wired into the compact bar; handler is null-guarded + 500 ms double-tap-guarded + variant-aware (selectedVariant price rides the line), and call sites gate on `product.is_available`; cart add is a local write (no server POST) — no money movement. `!product.is_available` branch now precedes `!token`. URL mirrors whitelist values (`ORDER_FILTER_VALUES`/`METHOD_VALUES`), replaceState only, unknown params preserved, `?method=` seed outranks stored prefs without clobbering. `/products` 301 hop: `redirect:false` (app.ts:1500-1512) — end state identical, one RTT less, pinned by spa-static-products-redirect.test.ts. og:image absolutized from `row.imageUrl` with og:image:width/height stripped (omitted beats wrong). Sitemap lastmod per-entity + divergence pin test. | **CLEARED** |
| 9 | OpenAPI batch-1: 17 endpoints + 38-row suite + orvel regen (6465dcb) | 17 new paths present (alerts ×7, tickets ×4, settings, settings/auth, chart-data, auth-stats/summary, auth-activity, referrals). Shapes diffed against handlers: alerts envelope `{alerts,unreadCount,total,page,limit,hasMore}` = alerts.ts:139-150; tickets thread WITHOUT `has_unread_admin` (list rows carry it, tickets.ts:149 — the corrected shorthand is real); settings 4 fixed fields = settings.ts:17-22; auth-stats summary `{total,success,failure,last24h}` = security.ts:91-108; referrals `{stats,top_referrers,list}` = referrals.ts:104-110. Contract suite = 38 `it(` rows. Orval regen consistent in BOTH clients (react fetchers + zod schemas; api-zod uses orval's per-output naming — not stale). alerts.tsx/security.tsx flips keep the same query keys + invalidations. | **CLEARED** |
| 10 | Splits byte-identical + no broken imports (b0a9267) | 8/8 functions (tabAllowed, ProviderIcon, ProviderCard, ROLE_LABELS, roleLabel, TwoFactorSetup, AccountTab, TABS) byte-identical vs `b0a9267^` modulo the `export` keyword — the vs-186b131 diffs I saw first are the round's own intermediate commits (auth-honesty, ink tokens), which the split faithfully carried. Backend re-exports (`isTelegramCallbackSameOrigin`, `ProviderField/ProviderMeta`) keep old-path test imports resolving (telegram-callback-csrf.test.ts:6 imports `../auth-settings`). No circular imports (services → lib only; route → services). Splits test files untouched. | **CLEARED** |
| 11 | test-inclusion widening + race retirement + sentry option + script timeouts (b0a9267) | tsconfig diffs real (frontend: e2e/configs included, 3 test excludes GONE; backend: tests/ + rootDir). `filesToDeleteAfterUpload` verified present in installed `@sentry/bundler-plugin-core@4.9.1` types; `deleteSourcemapsAfterUpload` absent — the fix is real, not option-swapping theater. `AbortSignal.timeout` present at scripts/validate.ts:335,384 + backup-db.ts:370 (size-aware deadline). Race conversions keep the race: the 700 ms stale-response delay is a fake-timer setTimeout, `advance(800)` resolves it AFTER the fresh render, and the STALE-not-in-document assertion survives; findBy→gety is strictly stronger. search-arabic.spec.ts rewritten far stricter (API ground truth first, URL mirror pin, main-scoped selectors, real empty-state asserts — the old spec's mangled selectors + swallowed timeouts are gone). | **CLEARED** |
| 12 | LICENSE/SECURITY/CONTRIBUTING/README truth (0d8980d) | LICENSE = standard MIT, © 2026 SubNation (year sane). SECURITY.md/CONTRIBUTING.md/templates present. CI badge + .hermes.md truth-ups coherent. 13 inspection reports committed. One truth claim fails the recount (P3-1); CHANGELOG entry missing (P3-2). | **CLEARED with P3-1/P3-2** |
| 13 | Guest drawer a11y / safe-area / pointer:fine inputs (0d8980d) | Focus-trap selector verified byte-level (`a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])` — the `aref` rendering is a terminal artifact); Esc handler + focus move-in/return + role=dialog/aria-modal present; drawer tests new. The Tailwind arbitrary variant `[@media(min-width:48rem)_and_(pointer:fine)]:text-sm` **verified compiled into the built CSS** (dist index-BQKsKwhD.css) — not a silent no-op class. | **CLEARED** |

---

## 3. Test-honesty forensics (Attack F detail)

- `git diff 186b131..HEAD` test-scope greps: **zero** added `test.skip`/`it.skip`/
  `describe.skip`/`.only(`/`xit(`/`.todo(`. The only `test.skip(` lines are the
  pre-existing opt-in `E2E_ENABLED` guards (present at 186b131, verified).
- Assertion ledger: 24 removed `expect(` lines vs 408 added. Every removal
  individually inspected:
  - `toHaveBeenCalledTimes(4)/(8)` → `(7)/(14)` — key-set grew (stronger).
  - alerts DELETE url/method asserts → generated-fetcher call asserts
    (`deleteAdminAlert` with id 7) — equivalent strength on the new surface.
  - `findByText` → `getByText` after deterministic advance — stronger
    (fails synchronously if absent).
  - «loyalty-only save does not open the money confirm» → replaced by the new
    stronger confirm+cancel+clamp contract (intentional behavior change).
  - `DUPLICATE_PAYMENT_REFERENCE` in message → Arabic prefix in message, enum
    still asserted on `.code` (machine-readable preserved).
  - seo `ld.url` asserts updated to the per-entity lastmod/og:image world.
- The e2e search spec went from a spec that could false-pass (swallowed nav
  timeouts, pass-any-link disjunction, invalid selectors) to API-ground-truth +
  URL-mirror + scoped-DOM pins. Strictest spec in the suite.

---

## 4. Required before push (all docs, all one-liners)

1. **README.md:152-154 + docs/ONBOARDING.md:83-84** — restamp the test-file
   counts to the true HEAD numbers (frontend 159 / backend 234, or date-scoped
   wording). The current "verified at HEAD, R126" claim is false.
2. **CHANGELOG.md** — add the R126 round entry (repo convention: one per
   round; the material already exists in the commit messages).

Optional (may ride the next round): P3-3's `enabled`-gate alignment for scoped
admins; P3-4's CI-green evidence link; nothing else.

---

## 5. Residual risks accepted with eyes open

- **Scoped-admin dashboard goes dark-by-design**: a non-finance admin now gets
  an empty tile grid on `/admin` (stats 403, chart never fetched) — the
  documented trade, honest, but the UX has no "you lack the finance scope"
  explainer. Single-operator deployment makes this theoretical today.
- **Tab counts on inactive topups tabs are now hidden** (count=null) rather
  than shown from a partial window — honest, but operators who used the
  inactive-tab numbers lose them; the sidebar badge carries global truth.
- **Full-suite green is asserted by the round's commits, not re-proven here**
  (sandbox budget: 3 vitest runs, all green; every file I opened was
  consistent). The 2 live e2e claims (home.spec console-clean) follow
  mechanically from the CSP-clean external gate verified in `dist/`.

**Bottom line:** the round's nine claims are all true as stated except the two
docs counts. The money paths are byte-checked and safe; the auth surface got
strictly tighter; the boot bug that shipped in R125 is dead and gated against
recurrence; nothing was weakened to get there. Ship it.
