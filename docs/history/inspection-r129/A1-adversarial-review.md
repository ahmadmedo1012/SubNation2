> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r129/A1-adversarial-review.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R129-A1 — Adversarial Review of the R128 Appearance Wave (5 commits, 124 files)

- **Reviewer:** R129-A1 (adversarial lane — READ-ONLY; zero source/test/config mutations)
- **Tree:** `main @ 76017f4` (the pushed R128 tip); commits reviewed: `ee294aa` → `4edfbe2` → `8a21f09` → `eb50024` → `76017f4`
- **Inputs:** worklog tail (round-128-close, r128-push, B2/B7/IMP-1/L2/IMP-6 entries), CHANGELOG R128 entry, the R127-R1 precedent (adversarial style + §6 test-honesty lens), and the tasking's 10 named interaction risks.
- **Method:** `git show` per commit hunk-by-hunk (all 124 files enumerated; every code file read at HEAD for final state), targeted cross-commit dependency checks (`git show <sha>:<file>`), systematic greps for the palette/fill-mode/formatLyd/og-dims invariants, hand-computed WCAG contrast for the new tokens, a scripted DESIGN.md ↔ index.css hex equivalence audit, and a false-green read of all 8 new frontend test files + `spa-static-assets-404.test.ts`. Icon/og pixel dimensions verified by decoding PNG IHDR / JPEG SOF headers directly.

## Verdict at a glance

| Grade | Count | Items |
|---|---|---|
| **P0** (must-fix-before-next-deploy) | **0** | — |
| **P1** (fix this round) | **1** | F1 — B-11 "cart stock honesty" is dead code; the round record ships a user-facing claim that does not exist |
| **P2** | **1** | F2 — commit `4edfbe2` is individually un-buildable (consumes `eb50024`'s `money.ts` exports) + message/diff drift across the wave's backend hunks |
| **P3** | **2** | F3 (MetaTags stale 1280×720 doc block), F4 (DESIGN.md `tier-silver` hex transposition) |
| **P4** | **2** | F5 (bell/page read-state coherence is eventual-only), F6 (palette-guard failure message prints char count, not line number) |

**SHIP** — the pushed tip is behaviorally sound (no money-path, security, or runtime regression found; every probe area beyond the findings verified clean). The P1 is a *truth* violation, not a runtime hazard: production behavior is byte-identical to R127 on the stock axis. It must be closed inside R129 (wire the feature or correct the three claims), and F2 should shape how future waves are sliced into commits. Details below.

---

## 1. Per-commit findings

### 1.1 `ee294aa` fix(ux,r128): storefront craft (37 files, +2,440/−111)

Reviewed every hunk: `index.css` (tokens + fill-mode + shimmer RTL + card-spring comment move), `App.tsx` (alias + notifications route), `lib/cart.tsx` (stock snapshot lib), `lib/utils.ts` (tierColor), `ProductCard.tsx`, `product.tsx` (404 convergence, PDP anchors, gap-3, compact-bar truncation, lucide Check), `cart.tsx`, `checkout.tsx`, `login.tsx` (account intent), `support.tsx` (25 s poll + deep-link hold), `notifications.tsx` (new page), the layout chrome (Navbar/MobileNav/NotificationBell/Footer), `button.tsx`, `fetch-error-card.tsx`, the tier-token migration in `loyalty.tsx`/`wallet.tsx`/`profile.tsx` (beyond the "leading-tight only" scope — good), and the 6 new/extended test files.

**Everything verified sound except the headline item — see F1.** The rest:

- **Bidi anchoring** (`ProductCard.tsx:489-503`, `product.tsx:1293-1305`): `text-right` + `dir="auto"` coexist correctly — Arabic names resolve `start`=right anyway, Latin names get pinned to the RTL reading edge without losing isolation. The three `dir="auto"` truncation sites (`cart.tsx:277-286`, `checkout.tsx:1424-1431`, `NotificationBell.tsx:625-633`) are the correct minimal set.
- **Product-404 convergence** (`product.tsx:868-928`): the new branch rides the not-found recipe (real h1, lg buttons, min-h-11 quick links). Nice interlock found while probing: a guest tapping `/wallet` from the quick-links band now lands on `/login?redirect=/wallet` → the new account-intent banner — the two lanes compose.
- **Gate-intent banners** (`login.tsx:41-78,175-212`): verified in probe §3.9 below — same `sanitizeInternalPath` as the success path; fixed-map lookup (no injection surface); `/order/*` + query-carrying redirects handled.
- **`/products` alias** (`App.tsx:565-581,927-929`): verified in probe §3.5 — no route conflict, no render loop, backend 200-shell contract untouched.
- **Motion** (`index.css:720-743,795-801,875,885`): verified in probe §3.1 — no surviving animation needed forwards-fill; the two intentional `both` users are test-pinned with rationale.
- **Cart stock lib internals** (`lib/cart.tsx:97-216,349-486`): the *lib* is well-built — parse guard (`:272` `normalizeStockCount(i.stockCount)`), stock-less re-add preserves the snapshot (`:367-378`), `capRaise` never silently shrinks a reconciled-down line (`:202-204`), key-present `reconcileLine` semantics (`:468-475`), 99-cap byte-identical when snapshot unknown. **But it has no production callers — F1.**
- **Support poll** (`support.tsx:161-172,259-315`): silent refresh path correctly avoids the openTicket side effects; functional `setSelectedTicket` drops late responses; `document.hidden` gate; scalar deps keep the 25 s cadence stable across re-renders. The `listError` deep-link hold (`:436-442`) is a genuine honesty fix.
- **Notifications page** (`notifications.tsx:126-208`): id-dedup across pages, envelope `total` honesty, optimistic mark-read with exact rollback, guest redirect per the orders idiom. (See F5 for the cross-surface nit.)
- **Badge a11y craft** (`MobileNav.tsx:180-216`, `Navbar.tsx:411-430`): the live region rides the *stable wrapper* while the badge span key-remounts for num-pop — the correct structure (a keyed remount would kill live-region announcements); the reasoning is documented in-code.

### 1.2 `4edfbe2` feat(admin,r128): admin palette unification (40 files, +1,502/−482)

- **The palette migration is genuinely complete.** My independent grep (including conditional strings, template literals, map values — the exact shapes a line-grep can miss) across `pages/admin/**` + `components/admin/**` returns **0 raw-hue hits**; `system.tsx`'s conditional `errorRate`/`p95` strings, `topups.tsx`'s network map, and the D1 severity maps were all migrated, alphas preserved. The negative guard (`admin-palette-tokens.test.ts:63-95`) is live, self-tested against synthetic offenders, and vacuous-proof (`:70` file-count sanity). The documented non-admin exceptions (`lib/admin/user-display.ts` D8 brand hues, storefront `wallet.tsx:209-218` network chips) are real and correctly out of scope.
- **New tokens verified in both themes** (`index.css:205-221` in `:root`/dark, `:373-383` in `.light`, exposure `:64-70,87` in `@theme inline`). Contrast hand-computed: `--status-success-surface` white-ink 5.05:1 dark / 5.90:1 light; `--tier-bronze` 10.5:1 dark / 5.23:1 light on card; silver/platinum/gold all ≥ AA both themes (`--tier-gold` aliases `--status-warning` 38 92% 56% / 38 90% 28%).
- **The migration was deliberately placed in the storefront commit's `index.css`** — `ee294aa` carries the tokens + storefront consumers, so `ee294aa` is self-consistent. **`4edfbe2` is not self-consistent — see F2.**
- `topups.tsx` StatusBadge swaps, `referrals.tsx` tier medals, `products.tsx` `--cat-*` map, h1 unification (19 surfaces, pinned by `admin-h1-unification.test.ts` with a 15-file scan sanity check), `CopilotPanel` ProgressTraceLine (probe §3.4 clean), `lib/csv.ts` + formula-injection tests (`=`,`+`,`-`,`@`,tab,CR all neutralized) — all reviewed, all sound.

### 1.3 `8a21f09` feat(brand,r128): one-mark brand suite (14 files)

- **Every dimension claim re-verified from the actual bytes**: PNG IHDR decodes — `pwa-192x192-maskable` 192×192, `pwa-512x512-maskable` 512×512, `apple-touch-icon` 180×180, `favicon-32x32` 32×32; JPEG SOF — `opengraph.jpg` 1200×630. `manifest.json` icons (any 96/192/512 + maskable 192/512) ↔ IHDR agree; `background_color` `#0a0a0a`→`#0a0c10` (the token) closed the 1-hex-off nit L2 had flagged as deferred.
- `index.html`: og dims 1200/630 ✓, favicon-32 link ✓, apple-touch → dedicated 180 ✓, offline reveal 2.5 s→6 s with an honest comment explaining why a `navigator.onLine` conditional isn't possible under the CSP src-less-script gate ✓ (pinned by `pwa-offline-shell.test.ts`).
- `MetaTags.tsx` constants updated ✓ — but the interface doc block wasn't (F3).

### 1.4 `eb50024` fix(pwa+backend,r128): PWA + cross-surface truth (20 files, +845/−72)

- **`workbox.sourcemap: false`** + root-sweep guard (`vite.config.ts:589-620`) — the guard still *fails the build* (`process.exit(1)`) when maps appear without `SENTRY_AUTH_TOKEN`; warn-only on the Sentry path. Correct.
- **Denylist extension** (`vite.config.ts:1037-1043`): the anchored regex `^\/(?:sw\.js|registerSW\.js|workbox-[^/]+\.js|manifest\.json|init\.js)$` denies only exact root-static files; the test pins both the regex source and its admit/deny behavior. No route space is lost.
- **`/assets` 404 guard** (`app.ts:1724-1735`) — verified in probe §3.6, including the `redirect:false` interplay (`app.ts:1544-1553`) that stops express.static's directory 301 from owning the bare `/assets` probe. The pinning test (`spa-static-assets-404.test.ts`) runs the real app composition with a physical stub dist — real-file-served, miss-404, bare-404, and non-assets-shell-still-200 all asserted. No false-green.
- **`formatLyd`/`formatLydNumber`** (`money.ts:37-61`) + adoption — verified in probe §3.7: 12 call sites, no double-format, no suffix duplication; `shareDisplayPrice`'s fallback semantic change (raw `listPrice` string → formatted `base`) is the intended canon change and is test-pinned both directions.
- **`roundLyd` at the 5 boundaries** — confirmed exactly 5 sites (`checkout.service.ts:275`, `topup.service.ts:146,423`, `refund.service.ts:179`, `loyalty.ts:148`); identical on today's 2 dp operands (the comments say so honestly).
- **notifications `?page=`** (`notifications.ts:17-84`): opt-in envelope; `queryString(req,"page")===""` degenerates to the bell's plain-array shape (verified `queryString` fallback semantics in `http.ts:23-31`); `?page=` / `?page=abc` / `?page=0` all clamp to page 1 via `pageParam`; `id-DESC` tiebreaker; honest `hasMore`. Bell stays paramless ✓; page requests `?page=N&limit=20` ✓ (limit ≤ MAX_PAGE_LIMIT 100).
- **Telegram refactor** (wallet.ts −83 / telegram.ts +40): the bespoke approval card was replaced by `notifyNewTopup` carrying the same `topup_app:`/`topup_rej:` callback_data contract the webhook keys on (`telegram-webhook.ts:15`); `escapeHtml` on phone + `paymentReference`; env-gating preserved inside `dispatch` (`telegram.ts:396-403`); auto-rejected rows send no card (`initialStatus === "pending"` gate). The "one card per pending topup" claim is true.
- **Copilot 403/401 copy, rate-limit «مجدداً», `checkout.service` PRODUCT_STALE/VARIANT_STALE copy** — pure string changes, tests updated in the same wave (`copilot-error-envelope.test.ts`, checkout idempotency suites green per round record).
- **ci.yml**: e2e job gains `schedule` — documented as requiring the operator-side `E2E_BASE_URL` repo variable (unset → loud localhost failure by design). Honest.
- `cart-gate.spec.ts` B5-1 hardening verified: `buy.or(soldOut)` must be visible — the evaporating `if (canBuy)` skip is gone; only the *post-click* flow stays conditional (correct — a sold-out product legitimately has no cart step).

### 1.5 `76017f4` docs(r128): round record + truth batch (67 files)

- **Test-count restamps verified exact**: `find` counts at HEAD = **176** frontend test files / **241** backend test files — matches README/CHANGELOG restamps.
- Claim-vs-reality sweep of the R128 bullets: palette 227→0 ✓ (independently re-censused), h1 unification ✓, fill-mode ✓, brand dims ✓ (byte-verified), PWA leaks ✓ (code + guards present), share-card SEO ✓, formatLyd ✓, roundLyd ✓, notifications pagination ✓, support poll ✓, e2e hardening ✓, weekly heartbeat ✓ (needs operator variable — flagged honestly in the entry itself), offline reveal ✓.
- **One bullet is false — the cart-stock bullet (F1)**, and it propagated to `docs/README.md:48` ("cart-stock honesty") and the `ee294aa` commit message.
- R127 ledger correction (OpenAPI 52→63) is a no-retro-edit convention note — consistent.

---

## 2. Findings (graded)

### F1 [P1] — B-11 "cart stock honesty": the lib shipped, the feature didn't. The round record claims UX that does not exist anywhere a user can see.

**The claim** (three surfaces): `ee294aa` commit message — "cart carries a stock snapshot (captured at add, refreshed by re-quote) with honest per-line verdicts + the client-side checkout block (14-test pin)"; `CHANGELOG.md:133-137` — "the cart line carries a stock snapshot (captured at add, refreshed by re-quote), the honest per-line verdicts («نفد المخزون» / «متبقٍ N فقط») + the client-side checkout block — **a sold-out product no longer looks buyable until charge time**"; `docs/README.md:48`; plus the test header `cart-stock-snapshot.test.tsx:4-10`.

**The reality** — every link in the chain is missing:

1. **No add-site passes `stockCount`.** `ProductCard.tsx:264-278` and `product.tsx:696-710` build the `addItem` payload field-by-field and omit `stockCount` — despite both DTOs carrying `stock_count` (`ProductCard.tsx:38`; the fix specs R124-A1 §99 and R125-A7 §116 both explicitly named these two sites as where to capture it). Result: every line's snapshot is `undefined → null = "unknown"` forever.
2. **The re-quote never refreshes stock.** `checkout.tsx:650-658` calls `reconcileLine` with price fields only (no `stockCount` key — the key-present path at `lib/cart.tsx:468-475` is never exercised in production), and only when the *price* changed. `quoteLineFromProduct` (`checkout.tsx:431-451`) has no stock arm at all — a stock-0 line prices normally and survives.
3. **Nothing renders the verdicts; nothing blocks checkout.** `lineStockNotice` / `cartHasBlockingStock` / `lineStockBlocksCheckout` are consumed **only** by `frontend/src/lib/__tests__/cart-stock-snapshot.test.tsx` (grep across `frontend/src`). No «نفد المخزون»/«متبقٍ N فقط» string exists in `cart.tsx` or `checkout.tsx`; no CTA rides `cartHasBlockingStock`. The only sold-out surfaces remain the pre-existing PDP/card chips — exactly as in R127.
4. **The 14-test pin is green but proves the wrong thing**: it pins the *lib's* state machine via a self-contained harness (`cart-stock-snapshot.test.tsx:63-130` — its own buttons feed `addItem`/`reconcileLine`), never the ProductCard/PDP/cart-page/checkout wiring. Feature-level false green — the class R127-R1 §6 exists to catch, and this one slipped through because the test file itself *looks* exhaustive.

**Severity rationale:** not a regression — with no caller passing stock, `stockAwareCeiling` returns `MAX_LINE_QUANTITY` (`lib/cart.tsx:191-194`) so the 99-cap and the entire money path are byte-identical to R127; the server's in-tx OUT_OF_STOCK 409 remains the only stock truth, as before. But this repo's core discipline is claim-vs-reality truth (every round runs a truth batch), and the round record + CHANGELOG + docs index now assert a shipped behavior that isn't there — the exact "canon contradiction" class this review hunts. The round-close parent's "verified in-tree: cart-stock snapshot" (`worklog round-128-close`) verified the *lib landed*, not the wiring.

**Fix (either, this round):** (a) wire it — pass `stockCount: cheapestVariant ? … : product.stock_count` at both add sites (the field is 2 lines each), render `lineStockNotice` on the cart line, gate the cart/checkout CTAs on `!cartHasBlockingStock(items)`, and pass the fresh stock through the re-quote patch; the lib + tests are already built for exactly this; **or** (b) walk the claims back in CHANGELOG/docs/README (mark B-11 "lib landed, wiring open — R129") and re-scope the test header. (a) is recommended — it closes a real UX debt three audits have now requested (R124-A1, R125-A7, R128-B1 item 6).

### F2 [P2] — Commit `4edfbe2` cannot build: it consumes `eb50024`'s `money.ts` exports. Plus message/diff drift across the wave's backend hunks.

**The breakage:** `4edfbe2:backend/src/app.ts:21` does `import { formatLydNumber } from "./lib/money"` and calls it at `:1075` (`shareDisplayPrice`) — but at `4edfbe2`, `backend/src/lib/money.ts` contains only `roundLyd`/`roundLydString` (verified: `git show 4edfbe2:backend/src/lib/money.ts` has no `formatLyd*`). The functions are added **one commit later** in `eb50024` (`money.ts:37-61`). So `git bisect` landing on `4edfbe2` gets `TS2305: Module has no exported member 'formatLydNumber'` on the backend build/typecheck — a broken tree mid-money-path. (The five commits were created 47 s apart — one working tree sliced by theme while the tree was built by lane; the dependency inverted.)

**The drift:** `eb50024`'s message claims "B2-F2: /assets/* misses 404 … (guard in the fallback + redirect:false on the assets mount)" and "B8-D1: the share card renders the operator's curated seo_title/seo_description" — but **both code changes live in `4edfbe2`'s `app.ts`** (`:1544-1553` redirect:false, `:1724-1735` the 404 guard, `:1674-1689` the SEO card); `eb50024` carries only the pinning *test* (`spa-static-assets-404.test.ts`, `share-card-bot-split.test.ts`). Likewise `4edfbe2`'s message ("feat(admin…") never mentions that it rewrote `app.ts`/`wallet.ts`/`checkout.service.ts` backend money-path hunks at all. Anyone doing git-history archaeology on the /assets guard or the share-card change (a practice this repo explicitly runs — "git-history security archaeology" was an R127 dimension) will be pointed at the wrong commit.

**Impact:** today's tip is fine (gates ran on the merged tree — honestly documented in the round record); the damage is bisectability and attribution. **Fix:** nothing to change in history (no retro-edit convention; rewriting pushed commits is worse). The take-forward: slice waves by *build dependency* (or per-lane `git add` before cross-lane files settle), and when a hunk's owning lane differs from the commit's theme, say so in the message. Optionally note F2 in the R129 round record so a future bisector isn't confused.

### F3 [P3] — `MetaTags.tsx` interface doc block still declares /opengraph.jpg as 1280×720.

`frontend/src/components/seo/MetaTags.tsx:8` ("real /opengraph.jpg is 1280×720"), `:10-14` ("defaults to the REAL /opengraph.jpg (1280×720)… instead of inheriting the default 1280×720"), `:131`, `:170` — while the constants were correctly updated to 1200×630 at `:57-60` and the R128 comment sits directly above them. The A7-F6 "declare the real dims" principle is implemented; the doc block contradicts it 5 lines up. One-paragraph doc fix; a future reader of `SeoInput.imageWidth` will mis-derive the default.

### F4 [P3] — `DESIGN.md` dark `tier-silver` hex is transposed: `#acbac3` vs the computed `#acb6c3`.

Scripted equivalence audit of DESIGN.md against `index.css` (all 37 dark entries + 13 light `light-*` overrides): **exactly one mismatch** — `DESIGN.md:39` `tier-silver: "#acbac3"`; `hsl(215 16% 72%)` computes to `#acb6c3` (G channel 0xBA vs 0xB6). Every other entry (tier-bronze/platinum, destructive-surface, status-success-surface, success/warning/info/purple/error, the light overrides incl. `light-tier-silver: "#586174"`) is byte-exact. DESIGN.md is the *published contract* and the `.impeccable` token feed — a wrong published hex is the "computed equivalent" claim quietly broken. One-character-class fix.

### F5 [P4] — Notifications page ↔ bell read-state coherence is eventual-only.

The page's optimistic `readOverlay` (`notifications.tsx:146-188`) and the bell's unread state live in separate stores; after «تحديد الكل كمقروء» on the page, the Navbar bell badge stays stale until its next poll (its 60 s fallback cadence), and vice versa. No correctness issue (server is the truth; both surfaces reconcile on their next fetch) — a small cross-surface UX incoherence introduced by the new page. Optional: share a query key or invalidate the bell on page mutations.

### F6 [P4] — `admin-palette-tokens.test.ts:77` offender message prints the line's *character count*, not its line number.

`offenders.push(\`${m[0]} → ${f.split("src/")[1]}:${line.length}\`)` — `line.length` is chars; anyone triaging a future violation gets a misleading "line number". Use the loop index. Cosmetic, failure-path only.

---

## 3. The 10 interaction-risk probes (tasking-mandated) — verdicts + evidence

1. **Fill-mode both→backwards** — **CLEAN.** All five entrance keyframes end at the natural cascade state (`page-in`/`float-in`/`slide-up` `index.css:505-536` → opacity 1 + identity transform; `fade-in` `:649-656`; `reveal-up` `:599-608`), so releasing the fill is visually identical at rest. Surviving fills are intentional and pinned: `success-ring` keeps `forwards` because its end state (opacity 0, `:553-561`) is *not* natural — dropping it would snap the ring back visible; `.num-pop` (`:874-876`) and `.tab-slide-in` (`:885`) keep `both` with in-code + in-test rationale (end states are identity; neither co-hosts a transform spring — verified: the only `-translate-x-1/2` + `tab-slide-in` element is `MobileNav.tsx:174`, and Tailwind 4.2.1's translate utility uses the standalone `translate` property, which composes with, rather than being overridden by, a filled `transform`). No `opacity-0`+entrance-class combo exists anywhere (grep); no `animate-[…]` arbitrary utilities; no inline `animation:` in components. The reduced-motion block (`:1127-1137`) still kills hover transforms independently. The resurrected hover lift is real: `.card-spring:hover`/`:active` (`:846-851`) were previously dead under the filled `transform`.
2. **Palette migration completeness** — **CLEAN** (evidence in §1.2): independent grep incl. conditional/template strings → 0 hits; guard is live, self-tested, file-count-sanity'd; tokens exist in `:root` + `.light` + `@theme inline`; contrast hand-computed AA+ for the boldest usages (§1.2). Documented exceptions verified real. (See F6 for the one cosmetic test nit.)
3. **Cart stock snapshot** — **F1** (feature dead code). The sub-probes that *could* have been findings all passed: no storage version bump needed (optional field + `normalizeStockCount` parse guard `lib/cart.tsx:272` makes pre-B-11 lines read "unknown", never a fake verdict); stock-less re-add preserves (`:367-378`); `capRaise`/99-cap interaction byte-identical when unknown (`:191-204`); and because nothing is wired, there is **no risk of over-blocking checkout** against the server's OUT_OF_STOCK 409 (the advisory-only design intent holds trivially — the server remains the only stock authority, unchanged).
4. **CopilotPanel ProgressTraceLine** — **CLEAN.** `turn.progress` has exactly one renderer (`CopilotPanel.tsx:1286`); the strings are built client-side in `progressFor` (`:735-749`), cleared on finalize/error (`:805,816`), and never persisted past the turn. Emoji literals are byte-identical between producer map and icon map (surrogate-pair-safe: `startsWith` + `.length` operate on the same code-unit sequence); no copy button or other surface renders the raw lines.
5. **`/products` alias** — **CLEAN.** wouter `Route path="/products"` is exact-match, no conflict with `/product/:slug` (`App.tsx:927` vs `:932`); `navigate` is stable in wouter v3 so the `[navigate]` effect runs once and the component unmounts on redirect (no loop — verified no other `/products` route/mount exists); renders `null` → no scroll artifacts; backend keeps serving the 200 shell (the `/assets` guard doesn't touch it, `resolveSpaShellMeta` handles it as an SPA route) so R126-L6's no-301 test stands; home's canonical owns the URL family (`replace` keeps back-stack clean). Not in NOINDEX_ROUTES — correct (it never renders content).
6. **`/assets` 404 guard** — **CLEAN.** The guard (`app.ts:1732`) matches `/assets` exactly or `/assets/` prefix — `/assets-manifest.json` (or `/assetsfoo`) does **not** match and keeps getting the SPA shell; `healthz` and `/sw.js` are explicit routes registered before the fallbacks (`app.ts:1577+` region), as are the root static mount (`manifest.json`, `/products/` art with their 30 d cache headers `app.ts:1603-1609`) and the bot share-card middleware (matches only `/product/*` `:1632`). `redirect:false` closes express.static's directory 301 on bare `/assets` (`:1548-1553`); the guard answers 404 text/plain. HEAD requests de-body automatically. Test composition verified real (stub dist with a physical file, `redirect:"manual"`).
7. **formatLyd adoption** — **CLEAN (12 call sites, no double-format).** Producers: `telegram.ts:190,223,236,261` (cards), `topup.service.ts:607,622,684` (bell titles), `app.ts:1075` (`formatLydNumber` → `buildShareDescription` which appends the single «…السعر X د.ل» suffix `app.ts:1089` — no suffix duplication), + `money.test.ts`. The wallet card path routes through `telegram.ts` once (the bespoke card was deleted, not wrapped). The one semantic change — `shareDisplayPrice`'s non-flash fallback returning `formatLydNumber(base)` instead of the raw `listPrice` string — is the intended canon (test-pinned `share-card-bot-split.test.ts:435-453`, incl. the negative `not.toContain("السعر 1380.00")`).
8. **og 1200×630 agreement** — **CLEAN.** `index.html:54-55` (1200/630) ↔ `MetaTags.tsx:59-60` (constants) ↔ `seo-money-pages-r120.test.tsx:162-163` (re-pinned) ↔ actual JPEG SOF 1200×630 (byte-verified). Backend `spa-shell-rewrite.test.ts` uses its own `n`-stub fixture (unaffected, correct). `seo-builders.ts` structured-data logo rides `/subnation-logo.png` (1200×800 — unchanged dimension family). Residual 1280×720 mentions in the tree are history comments only — except the *live doc block* in MetaTags (F3).
9. **Gate-intent banners** — **CLEAN.** `login.tsx:76-78` calls the same exported `sanitizeInternalPath` (`utils.ts:105-115`) the success path uses (`login.tsx` imports it since R123-E4a): slash-prefixed, no `//`, same-origin resolution, null otherwise. Encoded payloads: `?redirect=%2F%2Fevil.com` → `URLSearchParams` decodes once → `//evil.com` → null; double-encoding `%252F` decodes to `%2F…` → not slash-prefixed → null; backslash forms fail `startsWith("/")` or normalize inside the same origin. Banner content is a fixed-map lookup (`ACCOUNT_SURFACES`) — worst case a *wrong static headline*, never injected text; XSS-impossible by construction. Gate redirect values verified to match the map keys at all five gates (`wallet.tsx:950`, `orders.tsx:287`, `loyalty.tsx:258`, `referrals.tsx:73`, `order-detail.tsx:197`); `/support` deliberately stays generic (pinned).
10. **The new tests themselves** — **no false greens found beyond F1's feature-level over-claim.** Read in full: `cart-stock-snapshot` (honest at lib level; over-claims scope — folded into F1), `login-account-intent-r128` (real renders, positive+negative, open-redirect arm), `notifications-page` (paged envelope, dedup, error≠empty, optimistic flips — all behavioral), `support-thread-poll` (25 s cadence, draft preservation, hidden-tab gate, closed-ticket disarm, late-response drop), `storefront-r128-sweep` (comment-stripping source scans, both-direction pins), `admin-h1-unification` (scan-sanity + positive pin), `admin-palette-tokens` (§1.2), `admin-layout-shell-a11y` (focus management, aria-current, drawer trap — behavioral), `csv.test` (formula-injection matrix), `spa-static-assets-404` (§1.4). No vacuous assertions, no wrong-element queries, no mock tautologies; the two source-scan suites (sweep + palette) self-protect against vacuousness (synthetic-offender self-tests + file-count sanity).

---

## 4. Cross-lane interaction hunting (beyond the 10 probes) — nothing broke

- **Palette tokens (ee294aa) × admin consumers (4edfbe2)**: tokens landed *before* consumers in commit order — the storefront tier usages in `loyalty/wallet/profile` (ee294aa) are covered by the same commit's `index.css`. Verified `ee294aa` is self-consistent.
- **Fill-mode (ee294aa) × num-pop key-remount (ee294aa) × aria-live (ee294aa/eb50024 claim)**: the live-region-on-stable-wrapper structure survives the remounting badge — the lanes' designs interlock rather than conflict (documented in-code at both sites).
- **`/products` alias (ee294aa) × backend shell (4edfbe2's app.ts)**: no interaction — the guard only owns `/assets*`; `/products` keeps the shell.
- **formatLyd (eb50024) × telegram refactor (4edfbe2)**: the *only* cross-commit breakage (F2) — flagged.
- **notifications pagination (eb50024) × bell (unchanged) × new page (ee294aa)**: the opt-in envelope keeps the bell's paramless contract; page limit (20) ≤ server max (100). (F5 is the cosmetic seam.)
- **offline reveal 6 s (8a21f09) × SW denylist (eb50024)**: orthogonal (reveal is pre-SW HTML; denylist is post-SW navigations).
- **A4 leading floor (ee294aa) × admin h1 unification (4edfbe2)**: both drop `leading-tight`/`tracking-tight`; the base `h1–h4 { line-height: 1.3 }` floor (`index.css:438-447` region) is now the sole owner everywhere — the two lanes converge on the same doctrine.

## 5. Final verdict — **SHIP** (with an R129-mandatory P1 close)

**Why SHIP and not HOLD:** the pushed tip `76017f4` introduces **zero runtime regressions** across every axis I attacked — money paths (roundLyd/formatLyd verified equivalent-or-better; telegram refactor contract-preserving), security (assets 404 guard correctly scoped; sanitize parity; no new injection surface; sourcemaps now guarded at build), PWA (denylist precise, maps killed), a11y (live regions correctly structured, AA math holds on every new token), and behavior (the one "new behavior" that was claimed and is missing changes *nothing* versus R127 — the sold-out discovery still happens at charge time, exactly as before the wave). HOLDING a deploy over a truthful-but-unshipped UX claim would trade a working deploy for documentation purity.

**But the P1 is non-negotiable for R129:** the round's own standard ("every P2 closed, high-value P3/P4 set") and this repo's truth discipline mean CHANGELOG/docs asserting a shipped feature that is 100 % dead code cannot stand past this round. Close it by wiring (recommended — the lib + tests are ready, the wiring is ~4 small edits) or by correcting the three claim surfaces.

**Next actions (ordered):**
1. **(P1, this round)** Wire or walk back B-11 — `ProductCard.tsx:264` + `product.tsx:696` pass `stockCount`; `cart.tsx` line renders `lineStockNotice`; cart/checkout CTA gates on `cartHasBlockingStock`; re-quote patch carries stock (then add one feature-level test rendering the cart page with a stock-0 line).
2. **(P2, process)** Record F2 in the R129 round record (bisect note for `4edfbe2`); adopt dependency-ordered commit slicing for future multi-lane waves.
3. **(P3)** Fix `MetaTags.tsx:8-14,131,170` doc block; fix `DESIGN.md:39` `tier-silver` → `#acb6c3`.
4. **(P4, optional)** Shared read-state invalidation for bell↔notifications page; `line.length` → line number in the palette guard's offender message.
5. Operator item (pre-existing, restated): set `E2E_BASE_URL` for the weekly e2e heartbeat introduced by `eb50024`.

— R129-A1, 2026-10-10. Zero source/test/config files modified; only this report written.
