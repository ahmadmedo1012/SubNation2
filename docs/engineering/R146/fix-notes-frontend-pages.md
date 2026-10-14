# R146 fix notes — frontend route/page layer (agent 146-FIX-3)

Lane: `frontend/src/pages/**` + its tests, plus the one sanctioned component
exception `frontend/src/components/product/CopyField.tsx` (finding 6's
optional `rowClassName` prop). Findings and numbers follow
`docs/engineering/R146/audit-frontend-pages.md`. Every change below is the
audit's own prescribed fix — no extra features.

Test commands (repo root, all green):
`pnpm --filter @workspace/subnation exec vitest run <paths>`
`tsc -p tsconfig.json --noEmit` (frontend typecheck) — clean.

---

## Finding 1 — legacy numeric PDP URLs: double fetch + skeleton flash

**Changed** (`frontend/src/pages/product.tsx:162-176`, the rewrite effect):
`queryClient.setQueryData(["product-by-slug", productSlug], byIdQuery.data)`
seeded immediately BEFORE `window.history.replaceState`, so when wouter 3.9
turns the rewrite into a location change and the page flips to
`bySlugQuery`, its key already holds the by-id DTO (byte-identical shape per
the page's own comment). The rendered PDP is never replaced by the
`if (isLoading)` route skeleton, and within the app query client's 60 s
staleTime (app/query-client.ts) the seeded entry is fresh — no second fetch
of the same product. `queryClient` joined the effect deps (stable identity).

**Test evidence**: NEW `src/pages/__tests__/product-legacy-slug-seed-r146.test.tsx`
(1 test, mirrors product-legacy-shape's harness + the app's staleTime):
asserts the rewrite landed (`/product/spotify-premium`), the slug key is
seeded with the by-id DTO, `customFetch` (the by-slug rider) was NEVER
called, and the skeleton's `aria-label="جارٍ تحميل الصفحة"` never rendered.
Existing product suites re-run green (see totals below).

**Pins updated**: none — `product-decomposition-r135` pins imports/handler
ownership only, all still hold.

## Finding 2 — stale coupon across PDP→PDP hops between variant-less products

**Changed** (`frontend/src/pages/product.tsx:258-262`): the coupon-void
effect's deps `[…, selectedVariant?.id]` → `[selectedVariant?.id, product?.id]`
— one dep, strictly more voiding (the safe direction); the "couponInput kept
for one-tap re-validate" behavior is unchanged. Fixes product A's validated
`final_amount` riding product B's buy CTA and A's code riding B's order body
when both products have no variants (the recommendations rail's same-route
links keep the page mounted; `selectedVariant?.id` stays null → null).

**Test evidence**: `src/pages/__tests__/product-coupon-variant-void.test.tsx`
extended (+1 test, 4/4 green): renders variant-less product A (50), validates
SAVE10 → CTA 40.00, wouter-navigates to variant-less product B → CTA shows
B's PLAIN 100.00, the −10.00 chip is gone, the input keeps the code and is
re-enabled. The mock's `useGetProduct` became id-aware (A/B fixtures by URL
id); the three pre-existing tests are untouched and green.

## Finding 3 — login↔register tab links drop ?ref= (referred signups lose attribution)

**Changed**:
- `frontend/src/pages/login.tsx:114-125` — reads the raw `?ref=` once
  (mount-once `useMemo`, mirroring `redirectTarget`) and builds ONE
  `registerHref` (`?redirect=` first, `&ref=` appended when present — exactly
  the R123-E4a threading idiom). Both link sites (register TAB at :186-197
  and footer register link at :311-312) now use it.
- `frontend/src/pages/register.tsx:45-56` — the same `loginHref` builder;
  used by the login TAB (:117-118) and the footer login link (:280-281).
  The audit's three builders are these two shared expressions rendered at
  four `<Link>` sites; register's footer link is the same defect one scroll
  below the tab link, so it rides the same builder (leaving it bare would
  keep the exact bug on that path).
- Ref is forwarded RAW (URL-encoded for transport): every auth surface
  (AuthProviders / TelegramLoginButton / WhatsAppPhoneSignIn) reads `?ref=`
  from the live URL at click time — no sanitization invented; register's own
  reader normalizes for display.

**Test evidence**: `src/pages/__tests__/register-return-path.test.tsx`
extended with a 5-test describe (11/11 green): ref alone, redirect+ref
together (both directions), register's two back-links, and the no-ref
regression guard (bare R123-E4a hrefs unchanged). `login-account-intent-r128`
(10/10) and `auth-onboarding-journey-r143` (6/6) re-run green.

## Finding 4 — eight account routes set no document.title (RouteAnnouncer silent)

**Changed** — one `useSeo({ title, description, path, robots: "noindex,follow" })`
block per page (notifications.tsx's exact shape — no `locale`, the ar default
emits ar_LY), rendered as `{seoBlock}` at the top of each page's main return:
- `wallet.tsx:69-80` — «المحفظة — SubNation»
- `orders.tsx:175-186` — «طلباتي — SubNation»
- `order-detail.tsx:101-114` — «تفاصيل الطلب — SubNation» (canonical rides
  the live order URL)
- `loyalty.tsx:75-85` — «الولاء والإحالة — SubNation»
- `referrals.tsx:62-73` — «برنامج الإحالة — SubNation»
- `profile.tsx:91-102` — «حسابي — SubNation»
- `login.tsx:108-118` — «تسجيل الدخول — SubNation»
- `register.tsx:33-44` — «إنشاء حساب جديد — SubNation»

Titles use each page's own header/h1 copy; descriptions are natural Arabic in
the 50–160 band. RouteAnnouncer now sees a title change on every
account-surface hop (it deliberately skips same-title navigations), and the
robots directive the App fallback already stamped arrives from the page block
itself (the belt-and-braces contract pinned by meta-quality-r140). Same
family tradeoff as notifications/cart: the guest/loading early returns don't
mount the block — guests are redirected anyway.

**Test evidence**: NEW `src/pages/__tests__/storefront-account-titles-r146.test.tsx`
(8/8 green), mirroring admin-document-title.test.tsx's behavioral idiom —
renders each real page module (module-boundary mocks per the per-page suites'
union: wallet-return-affordance's orval-hook factory, order-refund-receipt's
useGetOrder, referrals-page's customFetch URL router, login-account-intent's
heavy-auth stubs) and asserts `document.title` + `meta[name=robots]` for all
eight routes. meta-quality-r140 (29/29) re-run green.

## Finding 5 — visibleOrders useMemo never memoizes

**Changed** (`frontend/src/pages/orders.tsx:298-312`): the three status
buckets now come from ONE `useMemo([orders])` (the audit's first option, the
admin/topups.tsx R125-I2 idiom) — the fresh `.filter()` identities per render
were defeating the `visibleOrders` memo deps. Variable names unchanged, so
every call site (chips + visibleOrders) is untouched. Behavior-neutral:
covered by orders-load-more (4/4), orders-filter-url (3/3),
orders-error-state (3/3) and order-refund-receipt's orders suite (5/5).

## Finding 6 — order-detail carries a near-duplicate CopyField

**Changed**:
- `frontend/src/components/product/CopyField.tsx:14-35` — the sanctioned
  exception: optional `rowClassName?: string` prop that REPLACES the row's
  classes wholesale (`rowClassName ?? "flex items-start justify-between
  gap-3 px-4 py-3"`). Default callers (OrderSuccessScreen) keep byte-identical
  DOM; nothing else in the component changed.
- `frontend/src/pages/order-detail.tsx` — the ~60-line page-local CopyField
  (was :44-103) is DELETED; the page imports the shared component and passes
  its exact former row classes via a module-level `RECEIPT_ROW` const
  (verbatim `"group flex items-start justify-between gap-3 px-5 py-3.5
  hover:bg-muted/30 transition-colors"` — the R139 earned-wash rationale
  comment moved with it). Unused imports removed (CopyButton, Eye, EyeOff,
  useState). DOM output byte-identical; page net −28 lines.

**Test evidence** (the audit's prescribed proof — the identical-DOM swap
keeps the render suites green): `order-refund-receipt.test.tsx` 5/5,
`order-decrypt-failed.test.tsx` 6/6 (includes the product-page success
receipt's shared CopyField), `order-detail-not-found.test.tsx` 3/3,
`r137-extracts-a11y-guard.test.ts` 4/4.

**Pins updated** (1, deliberate + tested):
- `semantics-depth-r140.test.tsx` (D-family, order-detail bidi isolations):
  the credential `dir="ltr"` now lives in the shared CopyField, so the pin
  counts the page ∪ `components/product/CopyField.tsx` surface
  (product-decomposition-r135's own union idiom) — threshold and intent
  unchanged, rationale comment in-source. 57/57 green after the update.

---

## Full targeted-test roster (all green)

Directly-touched suites (152 + 4 + 29 tests):
product-legacy-slug-seed-r146 **1** · product-coupon-variant-void **4** ·
register-return-path **11** · storefront-account-titles-r146 **8** ·
semantics-depth-r140 **57** · order-refund-receipt **5** ·
order-decrypt-failed **6** · order-detail-not-found **3** ·
r137-extracts-a11y-guard **4** · login-account-intent-r128 **10** ·
product-decomposition-r135 **9** · product-variants-decomposition-r137 **6**
· product-r117-contracts **4** · product-legacy-shape **1** ·
product-price-honesty **11** · product-cta-mobile-r126 **14** ·
product-seo-availability **5** · product-conversion-path-r145 **7** ·
product-buy-intent-key **6**.

Adjacent suites re-run for the touched pages/surface (source-scan sweeps,
wallet/loyalty/referrals/profile/auth families): a4-f1-nesting-sweep **2** ·
account-surfaces-visual-r139 **29** · auth-onboarding-journey-r143 **6** ·
chunk-architecture-r140 **17** · contrast-hardening-r140 **21** ·
image-discipline-r140 **39** · jsonld-completeness-r140 **33** ·
keyboard-money-paths-r140 **20** · live-regions-r140 **24** ·
loyalty-convert-journey **7** · loyalty-decomposition-r137 **9** ·
loyalty-error-state **5** · loyalty-history **10** ·
loyalty-referrals-shared-cache **2** · money-path-chrome-r139 **28** ·
money-races-r140 **21** · offline-pwa-r140 **26** · orders-error-state **3**
· orders-filter-url **3** · orders-load-more **4** · pages-contracts-r143
**14** · profile-me-error **5** · r139-debt-closure-r140 **19** ·
referrals-page **7** · register-welcome-copy **3** · runtime-perf-r140 **12**
· storefront-r125-sweep **7** · storefront-r128-sweep **5** ·
storefront-browsing-visual-r139 **18** · engagement-surfaces-visual-r139
**27** · meta-quality-r140 **29** · wallet-decomposition-r136 **8** ·
wallet-method-url **(suite)** · wallet-money-gates **(suite)** ·
wallet-return-affordance-r143 **(suite)** · wallet-statement **(suite)** ·
wallet-submit **(suite)** · app/home/admin decomposition suites **(green)**.

Frontend `tsc -p tsconfig.json --noEmit`: clean.

## Net lines (this lane)

Production: **+196 / −91** (net **+105** — finding 6 deletes ~66 lines of
duplicate CopyField from order-detail; the eight finding-4 useSeo blocks +
finding-1/3 logic account for the rest; order-detail alone is net −28).
Tests: **+490 / −5** (net **+485**: two new files 338 lines, three extended).

## Out-of-lane needs

None blocking. Notes for the components lane (no changes requested):
- Finding 3 needs nothing from `AuthProviders.tsx` /
  `TelegramLoginButton.tsx` / `WhatsAppPhoneSignIn.tsx` — they already read
  `?ref=` from the live URL; the pages now guarantee the param survives the
  tab hop.
- Finding 4 needs nothing from `app/routes.tsx` — RouteAnnouncer reads
  `document.title`, which the page blocks now maintain.
- `components/product/CopyField.tsx` grew only the sanctioned optional
  `rowClassName` prop (replacement semantics, default-identical DOM).
