> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r134/A2-storefront-ux.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R134-A2 — Storefront UX + Arabic Copy Audit (source-level, fresh eyes)

**SHA audited:** `5d5227c` (R133, deployed). **Mandate:** read-only; every
finding carries file:line evidence. **Method:** full reads of home, category,
product, cart, checkout, wallet, order-detail, orders, referrals, flash-sales,
support, login, register + the shared surfaces (ProductCard, Navbar,
MobileNav, route-skeleton, FetchErrorCard, TopupWaitingModal, lib/utils,
lib/cart, lib/categories) against the R130-A2/R130-A4 fixed-registers and the
exclusion list. Backend DTOs (products.ts) read where a frontend state's
honesty depends on the server's derivation (is_available/stock_count/labels).

**Verdict up front:** the storefront is in exceptional shape after the
R118–R133 wave — the money journey (buy-intent keys, per-unit checkout keys,
per-line coupon math, stock-block CTAs, partial-failure receipts), the
honest-state discipline (empty ≠ error ≠ 404 on every data surface), the
guest gates with return paths, and the a11y/RTL idiom set are all verified
present and consistent. This fresh-eyes pass found **zero P0/P1/P2** — the
residue is consistency and polish: **2 × P3, 7 × P4**. The two P3s are both
*one-concept-one-word* drifts the 120-commit wave never consolidated.

Counts: P0 0 · P1 0 · P2 0 · P3 2 · P4 7.

---

## Findings

### A2-F1 [P3 · VERIFIED] Two parallel hand-rolled category-label tables drift from the canonical maps — the same category renders under 2–3 names on one screen
Three label sources coexist:
- **canonical chip-brevity map** `lib/utils.ts:148-165` `categoryLabel()`:
  «برامج وتراخيص», «شبكات VPN», «أدوات ذكاء اصطناعي», «تعليم ومكتبات»
  (ai-tools was explicitly unified here in R124/A10-F8c *because* it feeds
  Product-LD + breadcrumbs);
- **canonical page map** `lib/categories.ts` CATEGORY_META `.label`:
  «البرامج والتراخيص», «شبكات VPN», «أدوات الذكاء الاصطناعي», «التعليم والمكتبات»;
- **two hand-rolled chip tables** that never got the memo:
  `pages/home.tsx:55-64` CATEGORIES («برامج» :59, «VPN وشبكات» :60,
  «تعليم» :63) and `components/layout/Navbar.tsx:34-42` DRAWER_CATEGORIES
  («برامج» :37, «VPN وشبكات» :38, «ذكاء اصطناعي» :39, «تعليم» :41 — the
  mobile guest drawer AND the R132 desktop «الأقسام» dropdown both render
  this table, Navbar.tsx:335).

User-visible contradiction on the highest-traffic page: tap the chip
«VPN وشبكات» → the visible result h2 directly below it renders
`categoryLabel(category)` (home.tsx:1165) = **«شبكات VPN»** — word order
flipped inside one viewport; the product cards in between carry the badge
«شبكات VPN» (ProductCard.tsx:545), and the landing page
hero/breadcrumb say «شبكات VPN» again (category.tsx:268,296). Same
three-way split for software («برامج» → «برامج وتراخيص» → «البرامج
والتراخيص») and education («تعليم» → «تعليم ومكتبات» → «التعليم
والمكتبات»). ai-tools has a *fourth* variant in the Navbar only («ذكاء
اصطناعي», missing «أدوات») — the exact drift A10-F8c killed in utils.
**Fix (S):** delete both inline tables and derive from one source — export a
`CHIP_LABELS: Record<slug,string>` from `lib/categories.ts` (or reuse
`categoryLabel()` directly) in home.tsx + Navbar.tsx; the seven values are
already test-pinned territory (navbar-desktop-categories.test,
home-filters-url.test). One source, three consumers, zero drift.

### A2-F2 [P3 · VERIFIED] Loyalty-points count agreement: frozen «نقطة» after every count on the wallet money card + loyalty ledger
`pages/wallet.tsx:1258-1264` renders the balance-card points cluster as
`{wallet.loyalty_points ?? 0}` + a static `<span>نقطة</span>` — a frozen
singular. Arabic count agreement: 2 → «نقطتان», 3–10 → **«نقاط»**, 11+ →
«نقطة». With the live earn rate of **1 point per 1 LYD** (loyalty.tsx:406
«نقطة لكل 1 د.ل مدفوع»), a first purchase of any sub-10-dinar product
yields a 2–10 point balance → the wallet card reads e.g. **«7 نقطة»**
(wrong; must be «7 نقاط»). Same frozen form on the loyalty ledger row deltas
`pages/loyalty.tsx:907-910` («+7 نقطة» for a 7-point purchase credit; a
refund reversal likewise lands in 2–10). The repo already established the
correct idiom for this exact noun: `loyalty.tsx:690-701` routes the
conversion hint through `formatCount` with `{one: نقطة, two: نقطتان, few:
نقاط, many/other: نقطة}` — only these two sites were left behind (the
R122/R123 sweeps covered طلب/منتج/باقة/عرض families; نقاط on the *wallet*
card escaped). Verified-correct siblings: `referrals.tsx:498` `+{points_earned}
نقطة` (always the fixed 50 → 11–99 singular, correct),
`loyalty.tsx:284/381/394/580` (fixed policy constants ≥ 11, correct).
**Fix (XS):** swap the static span for
`formatCount(points, {one:"نقطة", two:"نقطتان", few:"نقاط", many:"نقطة",
other:"نقطة"})` at wallet.tsx:1263 (render number+word together) and
loyalty.tsx:910; add a wallet test in the wallet-statement.test family.

### A2-F3 [P4 · VERIFIED] Home search-history dropdown ships no disclosure/combobox semantics
`pages/home.tsx:990-1055`: the catalog search input carries
`aria-label="البحث في المنتجات"` (:995) but the history popup appears with
no `aria-expanded`/`aria-controls`, no `role="listbox"`/`option`, no
`aria-autocomplete`; the popup's heading «عمليات البحث السابقة» (:1034) is
a bare span. Keyboard behavior is genuinely good (the relatedTarget blur
guard :1010-1019 keeps focus in the control; the row buttons are min-h-11),
but a screen reader gets no announcement that a list opened. The repo's own
disclosure idiom (aria-expanded + aria-controls) exists 30 lines away in the
same app at `support.tsx:522-523` and `Navbar.tsx:312-314`. **Fix (S):**
`aria-expanded={showSearchHistory}` + `aria-controls="search-history"` +
`aria-autocomplete="list"` on the Input, `id` + `role="listbox"` on the
dropdown, `role="option"` (or aria-label) on the row buttons; pin with a
focus/announcement test.

### A2-F4 [P4 · VERIFIED] ProductCard mid-range stock pill renders a bare, unexplained numeral
`components/ProductCard.tsx:620-633`: for an available product with
`stock_count` 4–99 (and ≤1 variant), the price-row pill renders just the
number — «17» — with no noun, sitting beside the price it could be mistaken
for quantifying. Its siblings are all self-describing: variant products get
«N باقات» (:599-605), 1–3 stock gets «متبقٍ N» (:617), and the card's
composed aria-label (:324-348) includes price, variants, and low-stock —
but NOT this number: sighted users see an unlabeled count while SR users
get no stock signal at all in the link name (the aria-label only speaks
stock on the نفد/low-stock branches — silence = available, no count).
**Fix (XS):** cheapest honest option —
add the count to `ariaLabelParts` («الكمية ${n}») so the pill gains an
accessible meaning; optionally prefix the visible pill with a 2xs «كمية»
label.

### A2-F5 [P4 · VERIFIED] Low-stock badge is the only member of the «متبقٍ» family missing «فقط»
`ProductCard.tsx:617` visible label: «متبقٍ 2». Its own aria-label (:612)
says «مخزون منخفض، متبقٍ 2 فقط»; the quick-add ceiling toast (:313) says
«متبقٍ 2 فقط»; the cart's lineStockNotice (`lib/cart.tsx:178,180` — the
documented "single definition of «متبقٍ N فقط»") says «متبقٍ 2 فقط — عدّل
الكمية». The grid badge is the lone shortened form. **Fix (XS):** append
«فقط» to the badge text (2 glyphs; the pill has room — «متبقٍ 2 فقط»).

### A2-F6 [P4 · VERIFIED] Home's default sr-only grid heading overclaims availability
`pages/home.tsx:1163`: with no filter active the (sr-only) h2 label is
«**الاشتراكات المتاحة**» — but the default grid lists ALL products
(45 live, 1 available; the R120-B1 re-order deliberately fronts the
available ones but still renders the 44 نفد cards below). The
availableOnly branch already says «المنتجات المتوفّرة فقط» (:1167) and the
category branch says the category name — only the default label asserts
availability the grid doesn't guarantee. SR users hear an availability
promise; crawlers read an h2 that mislabels a full catalog. **Fix (XS):**
default label → «كل الاشتراكات» (or «الكتالوج»), leaving the two
filter-active labels as-is.

### A2-F7 [P4 · VERIFIED] Latin gloss «(Top-up)» in the support FAQ — a term no UI surface renders
`pages/support.tsx:67`: «…عبر طلبات الشحن **(Top-up)** ضمن صفحة
المحفظة…». The UI everywhere says «طلب شحن»/«شحن المحفظة»/«إرسال طلب
الشحن» — the English parenthetical is the only Latin gloss in storefront
prose (brand/industry vocabulary like VPN, SEO, LyPay, IBAN aside, which are
the product's own terms). Likely a deliberate translator gloss, but it
names the concept with a word the user will never see on screen.
**Fix (XS):** drop the parenthetical, or gloss with the UI's own word:
«طلبات الشحن داخل صفحة المحفظة».

### A2-F8 [P4 · VERIFIED] PDP pre-buy re-quote fail-opens on a definitive 404
`pages/product.tsx:503-536`: the live re-quote before the single-buy charge
checks the price and aborts honestly on a mismatch (:515-531), but its
catch (:533-536) fail-opens for EVERY fetch failure — including a **404**,
which since R110-F is definitive (deactivated/archived products 404 on both
detail routes, backend products.ts:727,801). So a shopper holding an open
PDP when the operator delists the product taps «اشترِ الآن» → the re-quote
404 is swallowed → `createOrder` runs → guaranteed 400/404 error banner.
Honest outcome (the banner shows the server's Arabic message; zero money
moves), but the page already owns a better state: a 404 refetch flips the
page into the real «المنتج غير موجود» branch (:880-948). The cart path
already distinguishes this exact case (checkout.tsx:635-645 drops
404/410-archived lines with a notice). **Fix (S):** in the re-quote catch,
branch on `ApiError.status === 404` → refetch + toast «هذا المنتج لم يعد
متوفراً» + return (mirroring the price-change abort), network failures keep
the fail-open contract.

### A2-F9 [P4 · VERIFIED] Two residual copy-convention nits
- `pages/home.tsx:854` guest secondary CTA «لدي حساب — **تسجيل الدخول**»
  uses the noun form while the app-standard CTA family is the imperative
  «سجّل دخولك…» (R115-I1 canon: PDP compact :1909, cart :504, login banners
  :195-196). The PDP's non-compact CTA deliberately keeps the noun form
  («تسجيل الدخول للشراء», product.tsx:1909) — home's is the only
  context-free one.
- `pages/checkout.tsx:1220` «رصيدك**:** …» vs `pages/cart.tsx:442`
  «رصيدك …» — the same datum chip, one colon apart (the checkout summary
  rows avoid colons; the cart chip does too).
**Fix (XS):** «لدي حساب — سجّل دخولك» and drop the checkout colon — or
document the exception; both are 1-glyph edits.

---

## Verified-good register (fresh-eyes re-derivation, not inherited)

- **Money journey end-to-end:** buy-intent idempotency keys with TTL +
  fingerprint + terminal-only deletion (product.tsx:159-229, checkout.tsx:
  152-261), pre-buy re-quote with cent-exact compare (product.tsx:478-536),
  per-unit checkout keys line-scoped since r103 (checkout.tsx:165-175),
  per-line unit-price coupon pre-flight (98-F2, checkout.tsx:345-415),
  mount-time live re-quote with dropped-line + price-change notices
  (checkout.tsx:609-709), stock-block CTA at cart AND checkout with the
  reason wired via aria-describedby (cart.tsx:461-481) / in-label
  (checkout.tsx:1605-1610), partial-failure receipt naming what was charged
  (checkout.tsx:1116-1147), post-charge no-store /me + wallet + orders +
  catalog invalidations on both buy paths.
- **Credentials delivery:** order-detail + PDP receipt both mask passwords
  behind a 44px reveal (order-detail.tsx:67-95, product.tsx:231-286),
  CopyButton failure announces itself, decrypt_failed honest card with
  support link on both surfaces (order-detail.tsx:483-514, product.tsx:
  1071-1106), dir="ltr" isolation on every credential/coupon/code run.
- **Empty/loading/error discipline:** every audited data surface (home grid
  + stats + recent orders, category grid, PDP + recommendations, cart,
  checkout, wallet balance/topups/ledger, orders list + filter buckets,
  referrals, flash-sales, support threads, loyalty) renders skeleton →
  FetchErrorCard/branch-specific error → honest empty as three DISTINCT
  states; outage-as-empty and empty-as-outage both absent. The sold-out
  presentation is present at every layer: card (نفد corner chip + muted CTA
  bar + disabled quick-add), PDP (chip + variant pills «— نفد» + disabled
  CTA + بدائل recovery), cart (per-line verdict + block), checkout
  (block + label).
- **Guest vs authed:** buy-intent + wallet-return + order/wallet/orders/
  referrals/loyalty redirects all preserve the return path through
  login/register (sanitizeInternalPath everywhere); guest add-to-cart
  works and the cart funnels through `/login?redirect=/checkout`; guests
  get RouteSkeletons (never a zeroed frame) on guarded pages.
- **Count agreement:** formatCount with full Arabic paradigms at 20+ sites
  (منتج/طلب/باقة/عرض/حركة/مفتوحة families) — the two نقطة stragglers are
  A2-F2; «متوفر (N)» can never render 0 (backend `is_available:
  stockCount > 0`, products.ts:308).
- **RTL/bidi:** dir="auto + text-right" anchor idiom on Latin names
  (card h3, PDP h1, cart/checkout line titles), dir="ltr" on every
  code/amount/phone run, bidi-safe 99+/×/− renderings, forward=left
  chevron rule consistent, arrow icons correctly unmirrored.
- **A11y idioms:** 44px floors verified on every money-path control
  (steppers, reveals, retries, coupon pair, filter chips, sticky-bar CTAs);
  aria-modal panels (AppDialog/TopupWaitingModal, R133 bell), focus traps +
  focus return on both drawers + dropdown; role=status/alert on every
  state flip; heading hierarchy fixed everywhere R116-S2/R120-B2 touched.

## Exclusion-list compliance
Cloudflare/TTFB/inventory/bell-read-state/A5-F4/L2-F8/L4-F9/L2-F4 — not
re-reported. The A4 accepted residues (F3/F4/F5/F10 + light-theme tails)
were re-encountered but not re-reported per mandate; one *family census*
note: unlabeled decorative icons (home/category chip icons, page-header
glyphs) remain the known A4-F5 hygiene class (~30 sites, all beside bold
Arabic text). No new defect from the accepted families was promoted to a
finding; A2-F3 (combobox semantics) is a *different* family (disclosure
semantics, not icon hygiene/contrast).
