# R177 — The final customer-experience perfection round — 2026-10-20

**Scope:** the owner's directive — «الآن قم بجولة أخيرة من التحسين والتطوير والتنظيم والتطهير الكامل الشامل وركز على أدق التفاصيل بالأخص ما يظهر للعميل يعني وتجربة المستخدم وكل التفاصيل» — a final comprehensive sweep whose lens is the **finest customer-visible details**, not architecture. Two deep read-only audits (customer-surface UX + money/copy hygiene) plus a live read-only browser sweep of production (home/catalog/PDP at mobile and 800px, guest cart/checkout/wallet/support) surfaced **12 verified findings, all closed this round**: 1 × P1, 1 × P2, 10 × P3/low. The audits' coverage verdict on the rest: effectively ship-quality — the residual risk clustered in **twin-component drift** (fixes that landed in one copy of a duplicated surface but never its sibling), which is exactly where all four polish findings sat.

## The P1 — the PDP fabricated money when /auth/me failed once

`useGetMe` runs with `retry: false`. One transient 5xx (or a mid-session 401) leaves `user === undefined`, and the PDP computed `canAfford = !!(user && …)` → `false` → **the insufficient branch**: «رصيدك الحالي 0.00 د.ل» + «تحتاج إضافة X د.ل» — a fabricated zero balance pushing a **solvent** buyer into the topup funnel, on the primary conversion surface. Checkout already had the correct contract (checkout.tsx excludes `balanceError` from `insufficient`); home had it (`userError` excluded). The PDP never got it.

**Fix:** `isError: userError` destructured in product.tsx; `canAfford` rides `userError` on BOTH CtaBlock surfaces (the sticky bar + the desktop panel through BuyPanelColumn); the compact sub-line swaps its unverifiable «رصيد كافٍ» claim for the guest branch's neutral «الدفع من رصيد المحفظة» line; the server re-checks at order time and surfaces INSUFFICIENT_FUNDS honestly. Pinned by three new cta-block tests (the fabrication-class regression: zero «رصيدك الحالي» / «تحتاج إضافة» / «0.00 د.ل» copy under userError, the neutral-line swap, and the control).

## The P2 — the 640–1024px coupon desert

The PDP had **no coupon surface at all** in the sm–lg band (landscape phones / small tablets): the scrollable coupon block died at `sm:hidden` while the desktop panel CtaBlock (with its own CouponField) only mounts `hidden lg:block` — and the `<lg` sticky bar's `CtaBlock compact` never renders the field. The exact class of gap R157 closed for the **buy** affordance («the band between sm and lg had NEITHER affordance») was still open for the **coupon** affordance. One class: `sm:hidden` → `lg:hidden`. The R157 law now reads: exactly one coupon affordance at every width — this block `<lg`, the panel `≥lg`, no duplication. Pinned by the new coupon-band suite.

## The twin-drift class (P3s)

- **PDP CouponField, the R160 twins it never received:** the validate button's spinner swap emptied its accessible name mid-request (`sr-only` «جارٍ التحقق…» twin added — checkout's CouponCard got it in R160), and the clear button lacked the `title` twin beside its aria-label.
- **ShelfRail's missing `slug ?? id` fallback:** every sibling surface carries it (ProductCard, CatalogFiltersBar, RecommendationsSection, seo-builders, cart); a legacy slug-less row linked to `/product/null` from the hero's first fold.
- **The last bare text escape hatch:** the unknown-category recovery Link joins its siblings on the 44px tap floor (`min-h-11` — not-found, ProductsGrid and ProductOutageCard all cite the rule).

## Money-formatting honesty, completed

- `formatCurrency(-0)` → **«0.00 د.ل»** (Intl preserves −0's sign; `===` does not — the branch re-reads it as plain zero). Unreachable today (2dp operands everywhere); guards future delta/rounding call sites.
- The backend twin `formatLydNumber` gains the frontend's non-finite guard → **«—»**, never «NaN د.ل» on the Telegram/bell/WhatsApp channels. Both pinned.
- **Twelve `?? 0` display coercions retired** across the customer surfaces (CtaBlock ×2, both navbar wallet chips, AuthedHero, profile, BalanceCard ×2 incl. the sr-only live region, order-detail, OrderTerminalCard, OrderSuccessScreen, checkout's `formatBalance`): an absent amount now reads the honest **«— د.ل»** everywhere — the exact contract `formatCurrency` was built for in R157, which these coercions pre-empted. Arithmetic guards (comparison deltas, sum math, admin stats surfaces) deliberately untouched.

## One datum, one visual language

The loyalty tier thresholds rode hand-rolled strings — the same screen rendered «المستوى الذهبي (2000 د.ل إنفاق)» while StatsRow beside it said «2,000.00 د.ل». `HowToEarnCard` now rides `formatCurrency` (thousand-grouped, same formatter as every other money surface).

## The guest-surface referral policy, de-hardcoded

`WELCOME_BONUS_LYD = 5.0` / `POINTS_PER_REFERRAL = 50` duplicated backend's loyalty-policy.ts in three guest surfaces (register's welcome card, login's value chip, the support FAQ answer). They now read **one frontend module** — `lib/referral-policy.ts` (the loyalty-tiers.ts fallback precedent; the loyalty PAGE keeps reading the same policy from the /loyalty payload per R115). A policy change now re-renders all three surfaces from one address per side.

## Smallest closes

- `VariantSelector`'s monthly-equivalent sub-line guards `perMonth > 0` at render — a sub-cent per-month value could floor to «≈ 0.00 د.ل شهريًا».
- The stale round-93 coordination note in utils.ts (the coupons.tsx `localDateTimeToUtcIso` swap it demanded happened long ago, pinned by the r137 suite) deleted.

## Gates (all green, on the round's tree)

lint 0/0 · typecheck ×3 · **backend 2,689 tests / 289 files** (4 sequential chunks on the 2-CPU box; baseline 2,677/288 + 11 from the merged SEO lane + 1 new) · **frontend 2,775 / 299** (4 chunks; +9 new: coupon-band/a11y ×4, cta-block ×3, utils −0 pin, +1 seo-lane) · scripts 6/59 (exact) · OpenAPI parity 87 / 50 / 7 (green) · drizzle + orval drift zero · production build green — **eager 149,112 B gz** (+62 B vs R176, budget 150 KiB holds) · 8 intentional re-pins with in-line R177 rationale (loyalty tier rows ×4 with grouping commas, account-surfaces ×2, live-regions, order-detail decomposition, storefront min-h-11 3→4, support-faq «5.00 د.ل»).

## Ship record (the sequencing law)

- Commit `bdca0a74` pushed to `main`; CI run **39466501082 — conclusion: success on every executed job** (path filter cost gate, gitleaks, lint/typecheck/drift, scripts, frontend, backend, production build; e2e + CVE scan path-filter-skipped for the round's file set — the cost gate's designed behavior).
- Production redeployed by Coolify's push-to-deploy webhook; read-only verification: `healthz` **200**, entry bundle rotated `index-CIpQDjlB.js` → **`index-DLRV0hYa.js`** (R177 live), and the support FAQ renders the new **«مكافأة ترحيب 5.00 د.ل»** on a fresh load (an in-flight tab that loaded mid-rotation correctly landed in the ErrorBoundary's «إعادة التحميل» recovery — the designed mid-deploy behavior, clean on reload).
- The authed-only surfaces (the 640–1024px coupon block, the /me-error CtaBlock branches) are pinned at the unit level; live login-gated verification stays operator-account-gated, same as every round.

## Standing items (unchanged)

1. Embronic API integration remains deferred by owner order — untouched this round; when it lands, the real-source product art stays the display contract (R176).
2. VLM adjudication of the r176 art stays deferred with the z-ai quota window.
