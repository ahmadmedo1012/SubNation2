# R124-R1 — Independent Adversarial Review (last gate before commit/push/deploy)

**Scope:** entire uncommitted R124 tree @ c736d13 — 81 modified files (+2895/−1723) + 7 untracked (this report's directory, fetch-error-card.tsx, load-more-button.tsx, instrument-replay-lazy.test.ts, sentry-replay.ts, route-chunk-warmup.test.ts, topups-queue-search.test.tsx).
**Method:** read every hunk of the money-path, API-contract, and build-config diffs in full; field-by-field schema diff; independent WCAG math (HSL→sRGB→relative luminance, alpha composited); programmatic sweeps for duplicate imports / debug leftovers / dead classes; targeted `tsc --noEmit` runs (backend **clean**, frontend **clean** — both verified by me, not trusted). No code modified. No full suites re-run (reported green: 908 FE / ~2071 BE / contract 21/21 / lint 0 / build+budget).

---

## VERDICT: **FIX-FIRST** — 2 P1 blockers (both one-decision/one-line fixes), then ship. No P0. Money paths are safe.

---

## Findings

### P1-1 · `?fields=list` silently kills the ProductCard description row on every ≥sm grid (home / category / flash-sales) — a visible content regression the audit's own justification gets wrong

**Evidence:**
- `backend/src/routes/products.ts:473-489` (diff): the list projection omits exactly `description`, `usage_terms`, `variants` when `fields === "list"`.
- `frontend/src/components/ProductCard.tsx:481-485` (unchanged by the diff):
  ```jsx
  {product.description && (
    <p className="hidden sm:block text-muted-foreground text-2xs line-clamp-2 leading-relaxed mb-2.5">
      {product.description}
  ```
  The row **is** rendered by the grid at ≥640px viewports. The schema comment ("omits the fields the grid never renders — variants …, description, usage_terms", openapi.yaml:662-668 / api.schemas.ts `ProductListItem`) is factually wrong for `description`.
- All three grid consumers now send `fields: "list"` (home.tsx:262 `const params = { fields: "list" }`, category.tsx:142, flash-sales.tsx:174) → `product.description` is `undefined` on every tablet/desktop card → the row never renders. `ProductCard`'s local `Product` interface keeps `description?: string | null` (optional), so tsc cannot catch it — and no test pins the row against a list-shaped fixture.
- Admin's grid (admin/products.tsx:1524) still passes a full DTO, so only the **storefront** regresses.

**Impact:** silent loss of the 11px marketing line under each product name on the primary storefront surface at desktop widths (was live on subnation.ly yesterday). Not money-unsafe, but a customer-visible regression shipped as a "projection of fields the grid never renders".

**Minimal fix (pick one, deliberately):**
- (a) *Keep the win, keep the content:* include `description` in the list projection (backend spread + `ProductListItem` property + regen). `description` is the short marketing one-liner (~100-200 chars/product ≈ ~1.5 KB gz for 45 products); the measured 62.6% saving was `variants` — the projection keeps ~85% of its win with `description` restored. Regenerate api-zod/api-client-react and re-run the contract suite.
- (b) *Kill the row deliberately:* delete ProductCard.tsx:481-485 (+ comparator's `description` compare at :664) and record the removal as a design decision in the A2-F3 comment — don't leave it as an accident.
- (c) Truncate server-side (e.g. 80 chars) if the full description's bytes matter. Recommended: (a).

### P1-2 · Production build injects a debug marker into browser code: `;(globalThis.__A2F1_SWAP__=1);`

**Evidence:** `frontend/vite.config.ts:505` (diff hunk, sentryDsnGuardPlugin.transform):
```ts
return { code: code.replace(SWAP_FROM, SWAP_TO + ";(globalThis.__A2F1_SWAP__=1);"), map: null };
```
On every DSN-set production build, `src/lib/sentry-replay.ts` ships with a `globalThis.__A2F1_SWAP__ = 1` side effect appended to its import block. It executes for every replay session winner / first-error session. Harmless functionally, but it is leftover debug scaffolding baked into the money-site's production bundle; it also makes the lazy chunk's module side-effectful and the transform returns `map: null` (a +1-line shift with no sourcemap — Sentry replay frames will mis-symbolicate by one line).

**Minimal fix:** drop the marker — `code.replace(SWAP_FROM, SWAP_TO)` (optionally assert the marker in a debug-only `if (process.env.DEBUG_CHUNK_SWAP)` branch). Everything else about the A2-F1 severance (resolveId mapping, loud `this.error` on shape drift, the source-pin test) is good engineering and stays.

### P2-1 · `chunkGraphDebugPlugin` is registered unconditionally in the production plugins array

**Evidence:** `frontend/vite.config.ts:27-44` + `:534` — `console.log(">>> CHUNK", …)` on every `apply: "build"` run (i.e. every production CI build). Pure debug scaffolding from the A2-F1 investigation. Not shipped to browsers, but it is exactly the "stray" class this round was supposed to sweep, and it will spam every deploy log forever.
**Fix:** delete the plugin + its registration (or gate behind `process.env.DEBUG_CHUNKS`).

### P2-2 · Dead `cta-glow` class left on the product page buy CTA (missed 4th handoff site)

**Evidence:** `frontend/src/pages/product.tsx:1947`:
```jsx
className={`${compact ? "…" : "w-full h-12 text-base"} … press-spring ${!compact ? "cta-glow" : ""}`}
```
`index.css` deleted `.cta-glow` + its keyframes (I3). Wallet ×2 (I1) and onboarding (I4) dropped their usages with rationale comments; product.tsx was named in I1's handoff ("onboarding.tsx:161 + product.tsx:1834 remain in their own lanes") but the catalog lane (C1) never took it. The non-compact buy CTA's glow vanished silently instead of deliberately.
**Fix:** remove ` ${!compact ? "cta-glow" : ""}` (and the ternary) — one line.

### P2-3 · `.text-gradient-animated` in index.css is now consumer-zero dead CSS

**Evidence:** `frontend/src/index.css:752-770` — I3's deletion note says it "joins the deleted static twin once [the live consumers] land". C1's worklog confirms they have landed ("ZERO consumers repo-wide … the definition can be deleted"). Grep confirms: zero usages in `src/` outside the definition itself. Nobody deleted it.
**Fix:** delete the `.text-gradient-animated` block + its comment.

### P2-4 · A3's raw-`text-primary` sweep never reached product.tsx (lane gap) — one genuinely sub-AA link remains

**Evidence:**
- `frontend/src/pages/product.tsx:871-876` — the 404-surface «العودة للكتالوج» link: `className="text-sm text-primary hover:underline …"` — 14px text at ≈3.67:1 dark vs the 4.5:1 AA floor (my math reproduces A3's 3.67-3.76:1). Also `:273` hover:text-primary at text-xs.
- `frontend/src/pages/wallet.tsx:571` — `text-primary/80` on the 12px bold «رمز التحويل» label (I1's own lane file; the sweep only covered the 4 audited sites).
- For precision: the `text-xl`/`text-3xl` **prices** at :1331/:1747/:1863/:1888/:1938 are ≥18.66px bold = WCAG "large text" (3:1 floor) and **pass** at 3.67:1 — not failures. The failing residue is small-text links/labels only.
**Fix:** one-line token swaps to `text-primary-text` at the two product.tsx sites + wallet.tsx:571 (same class of fix the other 20 sites got).

### P2-5 · Lazy replay-attach semantics are pinned only against mocks — verify once in production post-deploy

**Evidence:** `instrument-replay-lazy.test.ts` mocks `@sentry/react` entirely (init/beforeSend/addIntegration/replayIntegration), so the suite pins *our* wiring, not the SDK's actual behavior of `addIntegration(replay)` post-`init()` + `start()/startBuffering()` under `replays*SampleRate: 0` (manual mode). If a future @sentry version changes manual-mode semantics, replays silently stop recording — an observability loss, not a money risk. The `map: null` from P1-2 also degrades replay symbolication by one line.
**Fix (post-deploy action, not code):** one manual canary — `window.__sentryTest('replay-canary')` in a prod tab, confirm the event arrives with a replay (or a 10%-roll session records), per the file's own documented debug surface.

### P2-6 · Audit-trail gap: the round's largest change (API projection + codegen + build surgery) has no worklog entry

**Evidence:** worklog.md ends at R124-C2. There are no entries for I6, I8, or the main-agent F3 wave, yet: fetch-error-card.tsx/load-more-button.tsx docblocks cite "the R124-I8 worklog" (doesn't exist), and the `fields=list` API change, vite.config surgery (minChunkSize, modulepreload, replay severance), SW cap, and route warm-up all landed undocumented. C2 explicitly deferred the FetchErrorCard extraction ("a dedicated round with lane coordination") and it then happened anyway (17 FetchErrorCard + 10 LoadMoreButton call sites) with no record of who/what/verification.
**Fix:** append the missing lane entries (I6/I8/F3) to worklog.md before commit — the repo's own process discipline requires it, and this review had to reverse-engineer intent from code.

### P3-1 · Response-contract suite coverage narrowed on the products list

`ListProductsResponse` is now `ProductListItem[]` (api-zod): the full-view response still passes (structural superset + `variant_count` always shipped — products.ts:473-479; zod strips unknown keys), which is why contract 21/21 is green, but the suite no longer pins `description`/`usage_terms`/`variants` presence on the list endpoint (variants remain pinned on the detail endpoints via `GetProductResponse`). Acceptable trade-off; record it.

### P3-2 · Admin boots pay the home modulepreload they never use

The bundle-budget exemption's "byte-neutral" claim holds for every **non-admin** boot (App.tsx:302-318 leg (a) imports `@/pages/home` at module-eval unconditionally), but `/admin*` boots return early and would never fetch the chunk — yet the injected `<link rel="modulepreload">` (criticalPreloadInject) is unconditional in the HTML. Admin sessions (~small share) pre-fetch ~the home chunk for nothing. Fine to ship; note for the record.

### P3-3 · Topup "pending" terminology now splits by audience (deliberate, defensible)

User surface: «قيد المراجعة» (wallet rows + banner + TopupWaitingModal — verified consistent, one word per screen). Admin queue: «قيد الانتظار» (statusLabel-derived filters + layout context action). A1's "one word for one state" is satisfied *per audience* but not across audiences. Note only.

---

## Challenged and CLEARED (the 10 riskiest hunks, verified with citations)

1. **Coupons schema swap (I7/A9-F1) — NOT weakened.** Field-by-field diff of the OLD hand-rolled (`git show HEAD:backend/src/routes/coupons.ts:33-48`) vs generated base (api-zod api.ts:1261-1281, constants :1249-1259) + `.extend()` route overrides (:53-64):

   | field | OLD | NEW | verdict |
   |---|---|---|---|
   | code | trim, min1, max40 | base min1/max40 + extend trim/min1/max40 | equal |
   | type | enum(pct,fixed) | identical | equal |
   | value | finite, positive, max 10,000 | `.gt(0).max(10000)` | **equal** — NaN dies at `z.number()` type-check; +∞ fails `.max`, −∞ fails `.gt`; dropped `.finite()` is belt-and-braces only |
   | min_order_amount | finite, 0–1M, opt, default(0) | base 0–1M opt + extend identical | equal |
   | max_uses | int, 1–1M, nullish | base identical (not extended) | equal |
   | expires_at | ISO_DATE regex + nullish + parseable-refine | base string/nullish + extend identical | equal |
   | description | trim, max200, nullish | base max200 + extend trim | equal |

   Both are non-strict `z.object` (unknown keys pass, as before). `coupons-schema.test.ts` now imports the REAL exported schema — strictly stronger than the deleted re-declared mirror (kills the drift class). The percentage ≤100 check stays in the handler, as before.

2. **Quick-add `variantId: null` under the projection — server handles it correctly, with an invariant match.** ProductCard:266 sends `variantId: cheapestVariant ? id : null` → local cart line → checkout.tsx:925 `if (it.variantId != null) body.variant_id = it.variantId;` (null = omitted) → `checkout.service.ts:192-210`: null + variants exist → `productVariants[0]` from a query filtered `isActive = true` and ordered by `priceLyd` ASC = **cheapest ACTIVE variant**, which is exactly what the card displays: list `price` = `displayBase = Math.min(...active variants.price)` (products.ts:453-454, `fetchVariantPoolData` filters `isActive` at :135). Old behavior (explicit cheapest id from the projected tree) and new (server picks) charge the same variant unless it changed in between — in which case the server's fresh pick is the safer one. No price mismatch is chargeable. Checkout line-unavailable gate (checkout.tsx:437-438) never fires on null.

3. **App.tsx prefetch key — EXACT match.** home.tsx:262 `params = { fields: "list" }` (unfiltered) → `useListProducts(params, { query: { queryKey: getListProductsQueryKey(params) … } })`; App.tsx:340 `getListProductsQueryKey({ fields: "list" })` → both hash to `["/api/products", {fields:"list"}]` (orval: `[…, params]`). Home-filters test pins it (`toEqual({ fields: "list" })`).

4. **ProductCard with `variants === undefined`** — min-price: `cheapestVariant` null → `priceLYD = product.price` (= MIN active variants, same number); count badge: `variantCount = product.variants?.length ?? product.variant_count ?? 0` and `variant_count` ships in BOTH projections (products.ts:479); quick-add: covered above. Only casualty is P1-1's description row. Memo comparator now compares `variants` by identity (safe under TanStack structural sharing).

5. **No other consumer broke.** `useListProducts` consumers = home/category/flash-sales only (grep); all migrated to `fields:"list"` + `ProductListItem`. Product detail (`useGetProduct`/`useGetProductBySlug`) untouched. Admin rides its own DTO. FE+BE `tsc --noEmit` both exit 0 (I ran them). The `listProducts` return type changed to `ProductListItem[]` — all call sites compile.

6. **Bundle-budget home exemption — honest.** App.tsx:302-318: leg (a) `import("@/pages/home")` fires at module-eval for every non-admin boot, so the HTML `modulepreload` fetches the identical URL the head-start would fetch a few hundred ms later; pre-paint byte total genuinely unchanged (P3-2 admin carve-out noted). The exemption regex `^home-[A-Za-z0-9_-]+\.js$` matches the `path.basename` the gate collects (vite.config.ts:126-143), and the `closeBundle` gate reads the final HTML after `criticalPreloadInject`'s `transformIndexHtml` — the exemption is load-bearing, not dead.

7. **SW cap 160 + existing clients.** `registerType: "autoUpdate"` (vite.config.ts:540) → vite-plugin-pwa sets skipWaiting/clientsClaim → the deploy's new precache manifest (all chunk hashes change under `experimentalMinChunkSize: 2048`) byte-diffs the SW → new SW activates on next visit → the 160-entry `assets-js` policy takes over the same cache name. No stale-cap zombie. `experimentalMinChunkSize` is the correct Rollup-4 option name (verified in the config comment); micro-chunk merging cannot re-eager icons without failing the eager-sum gate.

8. **Sentry replay lazy-load architecture — coherent.** `sentry-replay.ts` is the sole importer of `replayIntegration`; the build-time import swap severs the barrel binding so rrweb tree-shakes out of vendor-sentry; the stub gained `addIntegration` for DSN-less builds; sticky-roll via sessionStorage mirrors SDK sticky semantics; PII masking preserved (`maskAllText`/`blockAllMedia` pinned by test). Costs documented (first error of a non-winner session ships without replay — accepted trade-off). Residual risk = P2-5.

9. **Route-chunk warm-up (App.tsx:380-460)** — `pointerenter` capture delegation is the correct idiom for a non-bubbling event; saveData opt-out, admin skip, absolute-URL skip all present; `warmedRouteChunks` bounded at 5; predicate pinned by a truth-table test (incl. near-miss prefixes like `/products`). Verified `closest("a[href]")` at :430 by octal dump after the diff pipeline displayed a mangled selector — the source is correct.

10. **A11y/contrast claims — my independent math reproduces every number I checked:**
    - `--status-purple` dark 262 83% 66→70%: **4.09→4.80:1** on the /12 StatusBadge tint, **4.93:1** on /10 (CSS comment's numbers exactly); light 6.85:1 untouched.
    - Light `--cat-education` 42 90% 42→28%: **2.50→4.88:1** on the /10 tint (matches the CSS comment to the 0.01).
    - Wallet network chips `border-status-success/75`: **5.04:1** dark / **3.66:1** light vs the /10 chip tint (I1 claimed ≈5.2/≈3.5 — same verdict, ≥3:1 non-text both themes; the A3 report's literal `/45` recomputes sub-3:1, so the deviation was correct).
    - Footer links: `inline-flex min-h-6 items-center` = 24px targets (WCAG 2.5.8) + underline idiom; headings /80→full. Checkout topup link `min-h-11 -my-2 py-2` = 44px hit area with layout compensation. All verified in-source.

11. **Test honesty — all re-pins are equal-or-stronger; nothing gutted.** home-filters: exact-shape assertions *gained* `fields:"list"`; wallet-money-gates: the `/قيد المراجعة/` multi-match was disambiguated to the banner's unique `/قيد المراجعة \(الحد الأقصى 3\)/` (more specific, still pins the cap); topup-waiting-modal-aria: now asserts the support Link href + both 44px buttons + exactly-one إغلاق (stronger than the old 2×إغلاق count); whatsapp-phone-sign-in: 12 role queries re-pointed at the more specific «إرسال الرمز»; coupons-schema: imports the real schema (stronger); new suites (product 404 SEO, route-warmup truth table, replay-lazy, topups-queue-search) are genuine behavioral pins, not smoke.

12. **Concurrent-edit artifacts — swept clean.** Programmatic scan of all 79 modified TS/TSX files: zero duplicate named imports; the only debug leftovers in the entire +2895 diff are the two vite.config.ts items (P1-2/P2-1); I4's ProductCard:607 stray brace is resolved (proper `{/* … */}` block, tsc clean); the I4 stash incident's recovery left no residue (spot-verified wallet/index.css/coupons hunks all present); admin topups money mutations (approve/reject) untouched by the C2 display-layer changes; `SHELL_CATEGORY_META` (app.ts) and `categories.ts` metaTitles are string-identical and parity-tested.

---

## Required before push (summary)

| # | Severity | Item | Effort |
|---|---|---|---|
| 1 | P1 | Decide + fix the description-row regression (restore `description` to the list projection **or** delete the row deliberately) | S (a: regen; b: 5 lines) |
| 2 | P1 | Remove the `(globalThis.__A2F1_SWAP__=1)` production debug marker | 1 line |
| 3 | P2 | Delete/gate `chunkGraphDebugPlugin` | S |
| 4 | P2 | Drop dead `cta-glow` at product.tsx:1947 | 1 line |
| 5 | P2 | Delete consumer-zero `.text-gradient-animated` | S |
| 6 | P2 | Token-swap the 3 residual sub-AA `text-primary` text sites (product.tsx:873, :273-hover, wallet.tsx:571) | 3 lines |
| 7 | P2 | Append missing I6/I8/F3 worklog entries | S |
| 8 | P2 | Post-deploy: one replay canary via `window.__sentryTest` | ops |

Everything else (P3s) can follow. **Money safety: no finding.** Wallet/checkout/coupon/loyalty/referral behavior is byte-identical or provably equivalent — the receipt-field move is a pure JSX relocation (same id/handlers/validation), the coupon schema is equal-or-stricter field-by-field, and the quick-add null-variant path lands on a server rule whose price invariant matches the card's displayed price exactly.
