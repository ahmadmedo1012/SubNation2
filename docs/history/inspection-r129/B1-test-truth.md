> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r129/B1-test-truth.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R129-B1 — Test-Truth Audit of R128's 9 New Test Files (vacuity hunt · mutation spot-checks · coverage-hole map)

**Repo:** SubNation2 @ `76017f4` (main) · **Agent:** R129-B1 (read-only; only this file + worklog append; scratch in `/tmp/r129b1/`)
**Priors read first (not re-reported):** `docs/history/inspection-r128/B5-test-quality.md` (graded the R122–R127 wave A−; its findings table is the baseline discipline this audit measures against — esp. its "brittle pin carries its measured why" and self-testing-scan norms).
**Scope:** the 9 test files added by `7d469d5..76017f4` (`git diff --diff-filter=A`), read in full against the source each claims to pin. 57 tests total, **all 9 files re-run green at HEAD** (frontend: 5 files/39 + 3 files/14; backend: 4) — runs listed in §4.

---

## 1. Per-file verdict table

| # | File (tests) | Verdict | Why |
|---|---|---|---|
| 1 | `frontend/src/pages/__tests__/login-account-intent-r128.test.tsx` (9) | **STRONG PIN** | Every headline byte-matches `login.tsx:46-49`; the `/order/` deep-link arm (`login.tsx:59`), the non-account regression guard (`/support` keeps chips), and the open-redirect guard (`//evil.com` → `sanitizeInternalPath` → null, `utils.ts:107`) are all presence+absence pairs. Mutations §4.1 all caught. |
| 2 | `frontend/src/pages/__tests__/storefront-r128-sweep.test.ts` (5) | **STRONG PIN** (scope-limited) | The 4 bans/anchors all fire under physical mutation (§4.2), comments stripped before scan (the R128 fix-notes legitimately quote `leading-tight` — verified neutralized), and the glob is dynamic (`readdirSync`) so a NEW top-level page can't escape. Limits: headings in `src/components/**` and non-`leading-tight` tight leadings are out of scope; the `grid grid-cols-2 gap-3` pin is satisfied by either of 2 sites (`product.tsx:2116`/`2297`). |
| 3 | `frontend/src/lib/__tests__/cart-stock-snapshot.test.tsx` (12) | **PARTIAL — lib pinned 100%, feature UNWIRED (B1-1, P1)** | The 12 tests are rigorous lib pins (every branch of `cart.tsx`'s snapshot logic verified against source, §2.3) — but the R128 *behavior* they claim to pin does not exist in the app: **no production caller passes `stockCount`** (`ProductCard.tsx:264-278`, `product.tsx:696-710` — both have `product.stock_count` in scope and drop it), checkout's re-quote is price-only (`checkout.tsx:650-658`), and `lineStockNotice`/`cartHasBlockingStock` have **zero non-test importers**. Deep dive §5. |
| 4 | `frontend/src/pages/__tests__/notifications-page.test.tsx` (7) | **STRONG PIN** | Real QueryClient + network-boundary mock only; pins exact URL (`?page=1&limit=20`, `notifications.tsx:94-95`), true-total badge math + honest-end drop (`:236-241`, `:119`), cross-page dedup (`:126-137`), error≠empty, optimistic mark-read/read-all, deep-link nav. Dedup-mutation caught (§4.4). |
| 5 | `frontend/src/pages/__tests__/support-thread-poll.test.tsx` (5) | **STRONG PIN** | Cadence, SILENT refresh (draft survival pins that it doesn't ride `openTicket`'s `setReplyText("")`), `document.hidden` gate (`support.tsx:311`), closed-ticket disarm (`:300-303`), and the late-response functional-set (`:284`). Interval: lengthening caught, shortening passes (harmless direction — §4.5). |
| 6 | `frontend/src/lib/__tests__/csv.test.ts` (6) | **STRONG PIN** | Byte-exact expected strings incl. the apostrophe-BEFORE-quoting order (test 5) and the interior-literal guard (test 6); **wired**: `security.tsx:367,401` + `users.tsx:823` call the shared `csvCell` (`lib/csv.ts:33-39`). |
| 7 | `frontend/src/pages/admin/__tests__/admin-palette-tokens.test.ts` (7) | **STRONG PIN** | The negative guard self-tests its own regex in both directions (`:83-95` — the exact anti-vacuity discipline), sanity-counts the tree (`:70`), globs RECURSIVELY (settings/ covered, `:39-52`), and bans all 22 Tailwind hue families × 14 prefixes. Mutation caught (§4.6). Escapes: bracket-variant classes, `ring-offset-<hue>` (§3). |
| 8 | `frontend/src/pages/admin/__tests__/admin-h1-unification.test.ts` (2) | **PARTIAL PIN** | Catches size regressions on plain-form h1s (mutation caught, multi-line caught — the `[^>]*` spans newlines); **escapes**: expression `className={'…'}`, className-less h1s (skipped by the `:38` `continue`), and the whole `settings/` subdirectory (top-level-only glob, `:26-28`). No escape exploited at HEAD (all 20 pages carry plain-form `text-xl font-bold` h1s). |
| 9 | `backend/src/__tests__/spa-static-assets-404.test.ts` (4) | **STRONG PIN** | Real app composition (dynamic `import("../app")` + real DB + physical stub dist with a REAL asset file so the mount is reachable); pins no-shadow (real file 200 + exact bytes), 404 text/plain + body + not-the-shell, bare `/assets` (which also pins the `redirect:false` mount option, `app.ts:1546`), and the scope guard (non-assets keep the SPA 200). Re-run green 4/4. |

**Distribution: 7 STRONG · 2 PARTIAL · 0 pure THEATER** — but file #3 is theater *at the feature level* (the tests are honest; the behavior they certify is absent). Zero assertion-level vacuity found in any of the 57 (no `toBeDefined`-only, no conditional bodies, no `.skip`, no multiple-match-first-query abuse; every source-scan carries a sanity count or regex self-test).

---

## 2. Vacuity hunt (assertion level) — clean

Mechanical + read-every-line pass over all 9 files:

- **Always-true matchers: 0.** The only `toBeTruthy`-adjacent pattern is `spa-static-assets-404`'s `ManualResponse` shape (its own interface, always populated — no assertions on it).
- **Conditional test bodies: 0.** (The R128-B5 carry-overs B5-1/B5-2 were e2e files, untouched here; B5-1 was hardened per the R128 record — out of the 9.)
- **`.skip`/`.only`/`.todo`: 0** across the 9.
- **getByText on static copy that would pass on any render:** checked every string — each is either branch-conditional copy (the account headlines only render in the account branch) or paired with a negative twin (`queryByText(...)).not.toBeInTheDocument()`), so a wrong-branch render fails.
- **Query ambiguity:** `notifications-page` mark-read uses `findAllByRole` with a length assert (`:170-171`) before clicking — explicit, not first-match-lucky. The login test's `getByText("ثوانٍ معدودة بدون كلمة مرور")` renders exactly once in the account branch (buy branch unreachable under these paths).
- **Shared-oracle nuance (P4, B1-12):** the notifications badge assertions build the expected string with the SAME `formatCount` the page uses (`notifications-page.test.tsx:111-118` vs `notifications.tsx:237-241`) — the page's `NOTIFICATION_COUNT_FORMS` map is duplicated in the test, so divergence fails, but a bug introduced identically on both sides would pass. Structural pin, not a copy pin — acceptable, noted.
- **Source-scan self-liveness:** #7 self-tests its regex (`:83-95`, true positives + token negatives); #2 and #8 sanity-count the tree (`#8` at `:32`; #2 relies on the glob being dynamic — verified live, it scans 22 files).

## 3. Source-scan verification (#2, #7, #8) — regexes + globs

Physical checks in `/tmp/r129b1/regex-mutations.mjs` + `/tmp/r129b1/full-pipeline-mutations.mjs` (real repo file contents, the tests' own `stripComments`/regex logic, mutated COPIES in memory — repo tree untouched):

**True positives (all CAUGHT):** plain/variant/quoted/map-value raw hues (`hover:bg-red-500/10`, `dark:`, `sm:`/`md:`/`2xl:`, `shadow-emerald-500/20`); `<h1 … leading-tight>` incl. mid-classlist, multiline opening tags, and expression `className={'leading-tight'}`; ✓ glyph; `dir="auto"` removal; h1 → `text-2xl` regression (incl. multiline className — the `:38` skip only skips tags with NO `className="` anywhere).

**Regex holes (documented escapes):**
- `RAW_PALETTE_RE` misses **bracket/arbitrary variants** — `[&_p]:text-red-400`, `data-[state=open]:bg-red-500` — and `ring-offset-emerald-500` (prefix list has `ring` but not `ring-offset`). None used in the admin tree today; all standard variants (`dark:`, `group-hover:`, responsive) are caught.
- The leading-tight ban misses `leading-none` / `leading-[1.1]` (same visual failure class, different token) and any heading rendered from `src/components/**` (the glob is top-level `src/pages` only — 22 files today; a NEW top-level page is auto-included, a new subdirectory page would not be).
- `admin-h1-unification` misses the `settings/` subdirectory entirely (glob `:26-28`) — 3 files there today, no h1s, so unexploited.

**Glob coverage answers (the task's "would a new page escape?" question):** #2/#8 = top-level only (new nested storefront/admin page escapes; none exist); #7 = fully recursive over `pages/admin` + `components/admin` incl. `settings/`, `__tests__` + dotfiles excluded (correct — negative guards legitimately quote banned literals).

## 4. Mutation spot-check log (the core)

Seven physical/reasoned checks (physical = real content, test's own logic, mutated copy; repo tree never touched):

| # | Mutation | Result |
|---|---|---|
| 4.1a | login: drop the `path.startsWith("/order/")` clause (`login.tsx:59`) | **CAUGHT** — `/order/1042` row expects the orders headline; generic chips would render instead. |
| 4.1b | login: make the banner fire for ANY redirect (drop the 4-surface map) | **CAUGHT** — the `/support` regression test (`:85-91`) asserts the account banner does NOT sprout. |
| 4.1c | login: remove `sanitizeInternalPath` from `readLoginIntent` (`:79`) | NOT caught — **behaviorally equivalent** (the closed map alone rejects `//evil.com`); the test pins the observable contract (generic chips), which holds either way. Honest limitation, not a hole in the pin. |
| 4.2a | sweep: re-add `leading-tight` to orders.tsx's h1 (real content, comment-strip applied) | **CAUGHT** (`/tmp/r129b1/full-pipeline-mutations.mjs` MUTATION 1; fix-note comments verified neutralized). |
| 4.2b | sweep: replace `<Check …/>` with `✓` on the balance line (product.tsx:2030) | **CAUGHT twice** — `not.toContain("✓")` AND the positive `<Check ` pin both fail. Renaming to `<CheckIcon` also caught (positive pin). |
| 4.2c | sweep: remove `dir="auto"` from checkout's it.name div (`:1429`) | **CAUGHT** (`toMatch` fails). |
| 4.3 | cart: `stockCount: null` on stock-less re-add (clobber) / `Math.min(qty, ceiling)` instead of `capRaise` (silent shrink) / accept string stock | **CAUGHT** — tests 2 (`2|7|ok`), 10 (`5|2|insufficient` stays 5), 3 (`1|null|unknown`) respectively. Every lib branch I attacked had a failing test. The lib is genuinely pinned. |
| 4.4 | notifications: ignore `hasMore` in `getNextPageParam` / drop the dedup `seen` set | **CAUGHT** — load-more stays visible at the honest end (test 2 asserts it hides); badge would read 23 ≠ 22 (`getByText(formatCount(22))` fails). |
| 4.5 | support: interval 25s → 30s | **CAUGHT** — `advanceTimersByTimeAsync(25_000)` fires 0 ticks → fetch-count assertions fail. (25s → 20s PASSES — shorter intervals are user-harmless freshness; noted as B1-6, P4.) |
| 4.5b | support: poll resolves via `setSelectedTicket(d)` instead of the functional set (`:284`) | **CAUGHT** — test 5's backed-out-list assertions fail. |
| 4.6 | admin palette: emerald-700 approve button back (`bg-status-success-surface` → `bg-emerald-700`) | **CAUGHT** by the negative guard; note the flagship `toContain` pin is satisfied by EITHER of 2 occurrences (`topups.tsx:328,537`) — the negative guard is the load-bearing pin, and it holds. |
| 4.7 | spa-assets: delete the `/assets` 404 guard (`app.ts:1732-1735`) / 404 every unknown path | **CAUGHT** — tests 2+3 fail (soft-200 shows itself via `redirect:"manual"` + body check); test 4 fails on the over-broad variant. |

**Suite runs at HEAD (evidence the pins are live, not skipped):** storefront-r128-sweep + admin-palette + admin-h1 → 14/14 (2.2s); cart-stock + login-intent + notifications + support-poll + csv → 39/39 (6.1s); spa-static-assets-404 → 4/4 (5.5s, real app + pglite).

## 5. Deep dive — B1-1 (P1): the B-11 "stock-honest cart" is unwired dead code at HEAD

The round's flagship money-UX claim (CHANGELOG.md:133-137, commit `ee294aa`): *"the cart line carries a stock snapshot (captured at add, refreshed by re-quote), the honest per-line verdicts («نفد المخزون» / «متبقٍ N فقط») + the client-side checkout block — a sold-out product no longer looks buyable until charge time. Pinned by cart-stock-snapshot.test.tsx."*

Source truth at HEAD — **all four halves of the claim are absent from the app**:

1. **No capture site.** The only `addItem` callers are `ProductCard.tsx:264-278`, `product.tsx:696-710`, and the undo-restore spread (`cart.tsx:88`). None passes `stockCount` — even though both catalog surfaces have `product.stock_count` in scope (`ProductCard.tsx:38`, `product.tsx:1402,1414`). A fresh add stores `stockCount: null` forever (`cart.tsx:391`).
2. **No refresh site.** Checkout's mount-time re-quote calls `reconcileLine` with price-only fields (`checkout.tsx:650-658`); `quoteLineFromProduct` (`:431-451`) prices and never reads stock — a sold-out ACTIVE product is priced and kept, not flagged or dropped.
3. **No render site.** `lineStockNotice`/`lineStockStatus` have zero non-test importers (repo grep: only `lib/cart.tsx` + the test). The cart page renders no «نفد المخزون»/«متبقٍ N فقط» line (`pages/cart.tsx` grep: no matches).
4. **No checkout block.** `cartHasBlockingStock` is imported nowhere; the checkout CTA gates on `!canSubmit` (`checkout.tsx:1524`) with no stock term; the cart page's checkout Link (`cart.tsx:421`) is ungated.

The 12 tests hand-feed `stockCount: 7` through a test-only harness and pin the lib's semantics perfectly — which is exactly why nobody noticed: **green suite, inert feature, false record.** The pre-R128 UX (sold-out looks buyable until the server's in-tx 409) is still the live behavior; the server backstop (M-invariants) still protects the money, so there is no monetary regression — but the round's claimed user-facing honesty fix does not exist, and its "14-test pin" (actually 12 — B1-9) certifies a library, not the behavior.

**Fix (S/M):** wire it — `stockCount: product.stock_count` at both add sites; extend the checkout re-quote's `reconcileLine` call to carry `stockCount` from the live row; render `lineStockNotice` in the cart line; gate the checkout CTAs on `cartHasBlockingStock` — then add ONE integration test (render the real cart page / checkout CTA with a sold-out line). Until then, correct the CHANGELOG claim (per the no-retro-edit convention: a ledger note).

## 6. Coverage-hole map — R128 behavior → pinning test → verdict

From the CHANGELOG R128 entry, every behavioral change mapped:

| R128 behavior | Pinning test | Verdict |
|---|---|---|
| A2-F1 card h3 + PDP h1 `text-right` | `product-card-r120-regressions` (+15, render `dir=auto` + `text-right`) · `product-cta-mobile-r126` (+38, h1 render pin) | **PINNED** |
| A2-F1 cart line `dir="auto"` | `cart-undo-clear` (+17, `toHaveAttribute("dir","auto")` render pin) | **PINNED** |
| A2-F1 checkout line `dir="auto"` | `storefront-r128-sweep` (source pin, `:71`) | **PINNED** (mutation-verified) |
| A2-F1 **bell-message `dir="auto"`** (`NotificationBell.tsx:632`) — none | **HOLE (P4)** — notifications-page also doesn't assert `dir` on its message line (`notifications.tsx:338`) |
| A2-F2 product-404 convergence | `product-seo-availability` (pre-existing R124 404 branch render pin) | **PARTIAL** (branch pinned; the recipe convergence itself not byte-pinned) |
| A2-F4 gate-intent banners + open-redirect guard | `login-account-intent-r128` (9) | **PINNED** |
| A2-F3 **`/products` alias → home** (`App.tsx:574-580`, route `:929`) — none | **HOLE (P3, B1-2)** — `route-chunk-warmup.test.ts:50` pins only the unrelated warmup-null; deleting the Route or breaking the redirect keeps every suite green |
| A4-F1/F3 leading-tight removal | `storefront-r128-sweep` test 1 | **PINNED** (mutation-verified) |
| A4-F2 `muted-foreground/70→/85` ink pair | none | **HOLE (P4, B1-7)** — no test references `/85` |
| A5-1 fill-mode `both→backwards` + blur-in | `design-system-css` (+64, `it.each(ENTRANCE_CLASSES)` → `backwards`) | **PINNED** |
| A5-3 press-spring on cart steppers/trash | `cart-undo-clear` (+17, `press-spring` className pin) | **PINNED** |
| A5-3 num-pop on cart/unread badges (key-remount) | `design-system-css:219+` · `storefront-chrome-r120:383-385` (remount + live-region interaction) | **PINNED** |
| A6 P4-4 ✓→Check, storefront (product balance line) | `storefront-r128-sweep` test 3 · `product-cta-mobile-r126` (render pin, page-level ✓ ban) | **PINNED** (double) |
| A6 P4-4 ✓→Check, **admin sites** (`account-tab.tsx:264`, `alerts.tsx:648`) | none | **HOLE (P4, B1-8)** |
| A6 P4-4 **CopilotPanel ProgressTraceLine icon swap** (`CopilotPanel.tsx:349-396`) | none | **HOLE (P3, B1-3)** — `copilot-copy.test.tsx` covers clipboard only; reverting to raw-string render stays green |
| B-11/B13 §3 cart stock snapshot + verdicts + checkout block | `cart-stock-snapshot` (12) — **lib only** | **UNWIRED FEATURE (P1, B1-1)** — see §5 |
| B1 item 7 support 25s poll-while-open | `support-thread-poll` (5) | **PINNED** (in_progress arm untested — P4) |
| B1 item 8 /notifications page + backend `?page=` | `notifications-page` (7) + backend `notifications.test.ts` (+141) | **PINNED** |
| A1-F1 palette migration (227→0) | `admin-palette-tokens` (7) | **PINNED** (mutation-verified; bracket-variant escapes P3) |
| A3 h1 unification (19 surfaces) | `admin-h1-unification` (2) | **PINNED, partial escapes** (B1-4) |
| A3 formatCount stragglers / skeleton lengths | (wave's smaller pins — not in the 9; not audited) | not verified |
| B3-F2 CSV formula-injection guard | `csv.test` (6) + pre-existing `users-csv-export` | **PINNED + WIRED** |
| B8-D1 share-card curated seo fields | `share-card-bot-split` (+82) | **PINNED** |
| B8-D2 folded Telegram approval card | `wallet-topups-telegram-card` (rewritten — strengthened) | **PINNED** |
| B8-D3 formatLyd canon | `money.test.ts:98-103` (+ call site pinned via the card text) | **PINNED + WIRED** (telegram ×4, wallet, topup.service, app.ts) |
| B2-F2 /assets 404 (+ `redirect:false` mount) | `spa-static-assets-404` (4) | **PINNED** |
| B5-F1 SW sourcemap + root sweep | `pwa-offline-shell:107-131` | **PINNED** |
| B5-F3 SW navigation-fallback denylist | `pwa-offline-shell:134-144` | **PINNED** |
| B5-F4 offline-reveal 2.5s→6s | `pwa-offline-shell:71-83` (exact `6s` + `not 2.5s`) | **PINNED** |
| B1 item 9 cart badge `aria-live` + footer h2 | `storefront-chrome-r120` (+58) | **PINNED** (incl. the stable-wrapper-vs-remounted-badge nuance) |
| B1 item 9 text-link 24px floors | none found | **HOLE (P4)** — unverified/unpinned |
| B4-F5 roundLyd idiom at 5 backend boundaries | roundLyd itself pinned (money tests); the idiom-at-call-sites not separately pinned | **PARTIAL** |
| B5-1 e2e cart-gate hardened / B5-3 weekly heartbeat / B5-5 include widened | e2e file (not in the 9) · `ci.yml:189` (`schedule`) · `vitest.config.ts:54` | **VERIFIED in infra** |

## 7. Modified test files — assertion-weakening check (0 found)

Seven spot-checks of the R128 commits' test hunks (`ee294aa`/`4edfbe2`/`eb50024`/`8a21f09`):

| File | Change class | Verdict |
|---|---|---|
| `wallet-topups-telegram-card.test.ts` (108±) | B8-D2 fold | **STRENGTHENED** — `toHaveLength(1)` on TOTAL sendMessages (was card-filtered), exact `المبلغ: <b>25.56 د.ل</b>`, network-name mapping, `رمز التحويل` + `not.toContain("المرجع")`. One soft spot: the auto-reject arm's 150ms real absence window (B5-7 class, B1-11). |
| `copilot-error-envelope.test.ts` (7±) | B14-13 copy | **LOCKSTEP** — same byte-exact `toBe`, new code-map wording. |
| `admin-layout-pill-search-scope.test.tsx` (33±) | palette + B5-4 | **LOCKSTEP + determinism** — `bg-emerald-400` → `bg-status-success` (same `toContain` strength); 600ms real sleep → fake-timer window. |
| `dashboard-chart-race.test.tsx` (42±) | B5-4 | **UNCHANGED assertions** — real sleeps → `settleWindow`; no matcher edits. |
| `utils.test.ts` (13±) | A1-F3 | **LOCKSTEP** — tierColor → `--tier-*` tokens, same `toBe`. |
| `seo-money-pages-r120.test.tsx` (5±) | og dims | **LOCKSTEP** — 1280×720 → 1200×630, same `toBe`. |
| `db-statement-timeout.test.ts` (87±) | refactor | **RESTORED + ADDED** — the removed `not.toThrow` assertions re-appear; 4 new tests (lockPool, success-silent). |

Pure additions (removed-lines scan: zero/minimal): `money.test.ts`, `pwa-offline-shell.test.ts`, backend `notifications.test.ts`. **No lane loosened an assertion to pass its change.**

## 8. Findings P0–P4

| ID | Sev | Finding | Fix (S/M) |
|---|---|---|---|
| B1-1 | **P1** | B-11 stock-honest cart is unwired dead code: no `stockCount` at either add site, price-only re-quote, verdicts never rendered, CTAs ungated — while CHANGELOG:133-137 + commit msg claim the user-facing behavior and cite the (lib-only) suite as its pin. The 12 green tests mask it. | S: wire the 4 halves (§5) + one integration test; ledger-note the record until wired |
| B1-2 | **P3** | `/products` alias redirect (A2-F3) has no pin — `App.tsx:574-580` can be deleted silently | S: render `/products` → assert `navigate("/")` + replace |
| B1-3 | **P3** | CopilotPanel ProgressTraceLine icon swap (A6 P4-4) has no pin — the render layer can revert to raw strings | S: render ProgressTraceLine against the 3 arms (✓/✗/emoji/plain) |
| B1-4 | **P3** | admin-h1-unification escapes: expression `className`, className-less h1s, `settings/` subdir | S: track line index + drop the `continue`; recurse the glob |
| B1-5 | **P3** | RAW_PALETTE_RE misses bracket variants (`[&_p]:`, `data-[state=open]:`) + `ring-offset-<hue>` | S: extend the variant prefix pattern |
| B1-6 | **P4** | support poll: `in_progress` liveness arm untested; interval-shortening (25→20s) passes (lengthening caught) | S: add an in_progress row; accept the asymmetry (shorter = fresher) |
| B1-7 | **P4** | `muted-foreground/85` AA ink pair unpinned | S: one design-system-css pin |
| B1-8 | **P4** | Unpinned render details: bell-message `dir="auto"` (NotificationBell:632, notifications.tsx:338), admin ✓→Check sites (account-tab:264, alerts:648), text-link 24px floors | S each |
| B1-9 | **P4** | Count nit: "14-test pin" (commit msg, CHANGELOG) vs the file's **12** tests | S: correct at next record touch |
| B1-10 | **P4** | admin-palette offender message prints `line.length` (char count) as if a line number (`admin-palette-tokens.test.ts:77`) | S: `${i + 1}` |
| B1-11 | **P4** | telegram-card auto-reject arm: 150ms real absence window (B5-7 class) | S: poll-until-stable-two-reads |
| B1-12 | **P4** | notifications badge shared-oracle (`formatCount` on both sides) | accept / literal-copy one canonical case |

## 9. Grade

**The 9 files as tests: A−.** Zero assertion-level vacuity in 57 tests; the source-scans follow the strongest pattern in the repo (self-tested regexes, sanity-counted globs, comment-stripping with a measured why); behavior files pin through real providers/real app composition with only the network boundary stubbed; 12/12 physical mutation checks caught; no lane weakened a modified suite. This holds the R128-B5 bar.

**R128 test-truth overall: B+.** The deduction is B1-1: the wave's flagship money-UX behavior is claimed shipped, cited as "pinned", and is in fact absent — the exact green-vacuously class this lane exists to catch, hiding one layer above the assertions (the suite is honest; the feature isn't there). Two P3 render behaviors (alias redirect, copilot icons) also shipped unpinned. Nothing found approaches P0 (no money-path regression — the server 409 backstop still owns the charge).

**Method note:** static-first (all 9 files + their sources read in full; greps cited at file:line), 3 physical mutation scripts in `/tmp/r129b1/` (regex-level + full-pipeline with real contents, mutated copies only), 9 suite runs green at HEAD (2 vitest invocations FE + 1 BE), 7 modified-file weakening spot-checks via `git show` hunks. Zero repo modifications (this file + worklog only), zero git mutations.
