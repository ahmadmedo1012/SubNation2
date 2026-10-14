# R146 fix notes — frontend components lane B (146-FIX-4b)

Agent: ponytail-fix-frontend-components-b. Scope: audit-frontend-components
findings **1 (Navbar half), 2, 5, 6**. Base: the R146 round's working tree
(a prior interrupted run of this same lane had already landed the registry +
ProductCard/CategoryRail/catalog-filters/Navbar folds with no worklog entry;
this run verified their byte-identity, completed the remaining surfaces,
added the two hook test files, and resolved an eager-chunk regression that
the interrupted state carried — see T1 note 4).

---

## T1 — finding 2: THE category registry consolidation

**What changed** (one table: `lib/category-registry.ts`, slug → labels +
lucide icon + accent atoms + tile + PDP gradient, live 7 rows then retired
gaming/productivity):

| Surface | Before | After |
| --- | --- | --- |
| `lib/category-registry.ts` | — (new, 238 lines) | THE table: rows carry `slug, label (categoryLabel), adminLabel, Icon, accent {bg,text,border,gradient,accentLine}, tile, pdpGradient` + `categoryLookup()` helper |
| `components/ProductCard.tsx` | hand-rolled CATEGORY_ACCENT (9×5) + CATEGORY_ICON (9) | `CATEGORY_ACCENT = categoryLookup((row) => row.accent)`, `CATEGORY_ICON = categoryLookup((row) => row.Icon)` — both still exported (R116-S1 flash-sales idiom) |
| `components/home/CategoryRail.tsx` | local CATEGORY_ACCENT (7, `bg-cat-*/12 text-cat-*`) | `categoryLookup((row) => row.tile)` |
| `components/home/catalog-filters.ts` | CATEGORIES = 8 hand-rolled rows | `[{الكل, LayoutGrid}, ...LIVE_CATEGORY_ROWS.map(slug/label/Icon)]` |
| `components/layout/Navbar.tsx` | DRAWER_CATEGORIES = 7 hand-rolled rows | `LIVE_CATEGORY_SLUGS.map((slug) => ({ slug, label: categoryLabel(slug) }))` — utils' eager-safe tuple (see note 4) |
| `components/product/category-presentation.ts` | CATEGORY_GRADIENTS (9) + CATEGORY_INITIAL_COLOR (9) | `categoryLookup((row) => row.pdpGradient)` / `categoryLookup((row) => row.accent.text)` |
| `components/admin/products/products-meta.ts` | CATEGORY_INITIAL_COLOR (9) + CATEGORY_OPTIONS (10) + CATEGORY_FILTERS (10) | `categoryLookup((row) => \`${row.accent.bg} ${row.accent.text}\`)`; both lists map the registry rows (`adminLabel`; «(مؤرشفة)» suffix + head entries stay per-surface) |
| `lib/utils.ts` | — | +`LIVE_CATEGORY_SLUGS` (the 7-slug eager-safe order tuple, beside categoryLabel) |
| `lib/categories.ts` docblock | "re-adding an entry here (plus a cat-* token … and a theme row …) is all it takes" — the lie the audit named | now lists the real edit set (registry row + utils pair + SEO entry + theme row) |

**Design decisions** (the why the code cannot show):

1. **Byte-identity is mechanical, not hoped for.** New
   `lib/__tests__/category-registry.test.ts` (6 tests) pins the derived
   maps against the pre-R146 tables hardcoded from the deleted code: the
   PDP gradients/initial colors, the admin composites (`bg-cat-*/10
   text-cat-*`), and BOTH admin option lists (heads, the two label
   vocabularies, the archived suffixes). Every surface's rendered strings
   are therefore asserted equal to the old ones at the single source of
   truth, in addition to each surface's own pins.
2. **Two label forms, one table.** The surfaces genuinely render two
   vocabularies: chip-brevity (`categoryLabel`: «أدوات ذكاء اصطناعي») and
   the admin selects' form («أدوات الذكاء الاصطناعي» — the only slug where
   they differ; utils' A10-F8c note documents the split). The registry
   carries both (`label` / `adminLabel`) so deriving changes zero rendered
   bytes. `categoryLabel` stays in `lib/utils` as the canonical chip map —
   inverting the flow (registry → utils) would drag the registry's lucide
   icon set into the eager entry chunk through the module every eager
   surface already imports (the R120-B5 eager-sum budget; the registry
   docblock records this).
3. **Per-surface density stays per-surface.** `pages/category.tsx`'s
   CATEGORY_THEME is untouched: its `/15 /70 /25 /30 /55` composites are
   Tailwind literals that must appear in source for the content scan
   (storefront-browsing-visual-r139 counts exactly 7 of two of them), so
   they cannot be computed from token names — they are the audit's "theme
   rows" kept as thin lookups over the `--cat-*` tokens. The registry's
   `tile`/`pdpGradient`/`accent` atoms ARE the moved literals, spelled out
   once per category in the registry for the same scanner reason.
4. **Eager-path correction to the interrupted state.** The interrupted
   run had Navbar import `LIVE_CATEGORY_ROWS` from the registry — which
   would hoist the registry (and its 9 lucide icons, none of which the
   drawer renders: its rows are text links) into the eager entry chunk
   (Navbar ← routes ← App ← main). The R127-L10 discipline (eager warn
   150 KiB, measured 146,702 B at R145) treats that as a real regression.
   Fix: `LIVE_CATEGORY_SLUGS` in lib/utils (17 lines) is the eager-safe
   order twin; Navbar derives slug+label from it; the registry test pins
   the tuple ↔ registry sync so the vocabulary is still one. Verified no
   eager-graph module imports the registry (grep over App/app/*/Navbar/
   ErrorBoundary/not-found/AppSplashScreen: zero hits).
5. **products-meta stays React-free per its pin.** It imports the
   registry (pure data — lucide icon *references* as data, the r136
   catalog-filters precedent; every admin surface importing it already
   loads lucide); the module itself still imports no React/lucide, and
   the r137 decomposition pin (`not.toMatch(/from "react"|from
   "lucide-react"/)`) stays green as written.

**Pins updated** (one-line rationale comments in-source):

- `pages/__tests__/admin-products-decomposition-r137.test.ts` — the
  `CATEGORY_INITIAL_COLOR … = {` literal pin became the
  `= categoryLookup(` derivation pin (OPTIONS/FILTERS literal pins kept —
  their `= [` array literals survive the fold).
- `pages/admin/__tests__/admin-palette-tokens.test.ts` — the
  `"bg-cat-streaming/10 text-cat-streaming"` composite pins became the
  registry's atom pins (`bg:`/`text:` literals) with the registry file
  joined to the surface union — the canonical-family guarantee now
  pinned where the atoms live.
- `lib/categories.ts` + registry docblocks — the honest add-a-category
  edit list (the audit's "lie" fixed).

**Test evidence** (repo root, `pnpm --filter @workspace/subnation exec
vitest run …`):

- New: `src/lib/__tests__/category-registry.test.ts` — **6/6**.
- Registry/admin fold: `admin-products-decomposition-r137` 9/9,
  `admin-palette-tokens` 7/7, `products-error-bulk` 18/18 (label chips
  «بث مباشر»/«موسيقى» still drive the filter), `products-seo-submit` 5/5,
  topups family 23/23 (products-meta consumers), `utils` 24/24.
- PDP fold: `product-decomposition-r135` 9/9, `image-discipline-r140`
  39/39, `product-r117-contracts` + `product-seo-availability` +
  `product-price-honesty` + `product-conversion-path-r145` +
  `semantics-depth-r140` (PDP family) — 123/123 in that batch.
- Storefront fold: `home-decomposition-r136` 8/8,
  `cart-undo-clear` **15/15** (the 7-slug cart-recovery list passes
  untouched), `flash-sales` 8/8 (ProductCard's re-exported maps),
  `category-error-state` 5/5, `storefront-browsing-visual-r139` (its
  category.tsx theme-literal counters untouched) in the B-batch 231/231.
- Navbar: `navbar-desktop-categories` 4/4, `navbar-guest-drawer-a11y`
  4/4, `navbar-authed-drawer` + `navbar-mobile-fit` + `storefront-chrome-
  r120` + `live-regions-r140` + `round-closure-r140` — batch A 93/93.

---

## T2 — finding 1 (Navbar half): trapTabKey local copy deleted

`components/layout/Navbar.tsx`: the byte-identical ~22-line local
`trapTabKey` body is gone; the drawer now imports the shared React-free
`lib/a11y/trap-tab-key.ts` helper (the stale "kept local for bundle
isolation" comment replaced with the real rationale — the helper drags no
admin shell). Made in the same pass as the DRAWER_CATEGORIES edit as
instructed. The shared helper's docblock was updated (the interrupted run
+ the parallel 4a lane folded NotificationBell and admin focus-trap onto
it — the helper itself is byte-stable; its selector/behavior unchanged).

No pins needed updating for Navbar's half (the drawer's Tab-trap behavior
is pinned by `navbar-guest-drawer-a11y` 4/4 — green).

---

## T3 — finding 5: useTelegramWebAppAutoLogin tests (was: zero)

New `src/hooks/__tests__/use-telegram-webapp-auto-login.test.tsx` (109
lines, 3 tests): mocks `@/lib/auth` + `customFetch` and injects
`window.Telegram.WebApp.initData` with `/?ref=wonka`:

1. **Exactly one POST** with the referral code (`referralCode: "WONKA"`,
   uppercased per the redirect-flow contract) and the minted token stored —
   mounted inside `<StrictMode>` so the once-guard is genuinely exercised
   (React dev build double-invokes the effect).
2. **Zero POSTs when a token already exists** (no login churn).
3. **Rejection is a silent no-op** — the POST is attempted once, then no
   setToken, no console.error/warn (spies), nothing thrown; vitest's
   unhandled-rejection surfacing is the backstop.

**Mutation check**: temporarily replacing `if (triedRef.current) return;`
with a no-op fails tests 1 and 3 (the double mint is caught); restored,
3/3 green — the once-guard is pinned, not vacuous.

---

## T4 — finding 6: use-socket order-updated + connection_limited tests

New `src/hooks/__tests__/use-socket-orders-connection.test.tsx` (190
lines, 3 tests; the topup-dedupe harness idiom — fake socket via
`connectSocket` mock, `toast` mock, real QueryClient with an
`invalidateQueries` spy):

1. **The predicate sweep**: emitting `order-updated` issues an
   `invalidateQueries({ predicate })`; the predicate accepts the REAL
   generated keys — `getListOrdersQueryKey()` bare + `{ limit: 4 }`
   variant, and `getGetOrderQueryKey("SNDB2026X")` (the orderCode detail
   key a prefix matcher misses — the 93-C5/F-15 case) — and rejects
   `getGetWalletQueryKey()`.
2. **Toast text**: `تم تحديث حالة طلبك SNDB2026X` + `الحالة الجديدة:
   مكتمل` + the dedupe id when `order_code` is present; the numeric
   fallback `طلبك رقم #42` when absent.
3. **connection_limited**: `عدد الاتصالات مرتفع` with the backend
   message override, the default copy fallback, and the stable
   `socket-connection-limited` id (one toast per occurrence).

**Mutation check**: narrowing the predicate to `first === "/api/orders"`
fails exactly test 1 (the detail key drops out — the documented regression
shape); restored, 3/3 + the existing topup-dedupe suite 3/3.

---

## Lane totals

- Production source: **+347/−238** (net +109): the ~10 hand-rolled tables
  (−232 lines of duplicated vocabulary) folded into the 238-line registry
  (the literals had to live somewhere Tailwind's scanner can see — the
  audit's −80–120 estimate predated that constraint), + the 17-line
  eager-safe slug tuple in utils, + docblock honesty fixes.
- Tests: **+468/−3** — 3 new files (451 lines: registry byte-pin 152,
  telegram auto-login 109, use-socket orders/connection 190) + 2 pin
  updates (17 lines) with rationale comments.
- `tsc -p tsconfig.json --noEmit`: clean. `prettier --check` on all 11
  touched files: clean.
- Not run (per instructions): git commit/push, pnpm install, full suites,
  playwright e2e, production builds — so the eager-path sum is reasoned
  (no eager importer of the registry remains) rather than measured; CI's
  budget build is the backstop.
- Out of lane / untouched: everything 4a owns (NotificationBell,
  focus-trap, intent-envelope family, ApiError readers, ProductSkeleton,
  AskAnswer/CopyButton, useKeyboardShortcuts, SessionManager,
  pages/product.tsx, telegram-callback.tsx) and audit findings 3, 4, 7–11.
