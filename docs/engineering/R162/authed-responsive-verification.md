# R162-E — Authenticated rendered PDP verification (hermetic)

Task ID: R162-E · Lane E (retry) · 2026-10-17
Spec: `frontend/e2e/authed-pdp-r162.spec.ts` · Result: **33/33 passed**
(11 tests × 3 projects: `desktop-chromium`, `mobile-390`, `tablet-768`)
Run: `cd frontend && E2E_ENABLED=1 E2E_BASE_URL=https://subnation.ly pnpm exec playwright test e2e/authed-pdp-r162.spec.ts` — 2.6 m, zero retries consumed.

## 1. The gap this closes

R161-G fixed the 640–1023.98 px sticky-bar CSS scopes (guest sticky bar + authed
fixed bar), but the **authenticated** bar's *rendered* geometry in the
640–767 px band could never be live-verified: R161-F's audit was guest-only
(production logins/OTP/orders are prohibited), so the authed bar rode a
**code-level suspicion only** (R161-F-AUDIT: "the authed fixed bar rides the
same <640px-only offset — at 640-767 it would render fixed with bottom:auto,
likely stranded mid-content; needs an authed-session verification").

R162-E closes it without a login: the **real production JS bundle** at
https://subnation.ly renders the PDP in a real browser, while every `/api/**`
request is intercepted and answered from seeded JSON. Zero production writes.

## 2. Methodology — hermetic route interception

- One catch-all: `await page.route("**/api/**", …)` (spec `installHermeticApi`).
  Every request is **fulfilled locally** — nothing reaches the network by
  construction. The handler records `seen` (every API call) and `writes`
  (every non-GET attempt + its body) as in-test evidence.
- **Session** (the exact boot contract, `frontend/src/lib/auth.tsx:392-426`):
  `GET /api/auth/probe` → `{ authenticated: true, user, linked_identities: [] }`
  flips `token` to the `COOKIE_AUTH_SENTINEL` and pre-seeds the
  `getGetMeQueryKey` cache — the PDP renders its authed branch with no
  login, no OTP, no cookie. `GET /api/auth/me` returns the same user.
  The seeded user is `auth_provider: "whatsapp_phone"` so
  `isFirebaseBackedUser()` stays false — no Firebase SDK is armed for the
  fake identity.
- **Product**: `GET /api/products/by-slug/r162-hermetic-pdp` → a seeded product
  (category `streaming`, `price_from: true`, 6 variants across 3 plans:
  sale-price + regular, one sold-out duration, one fully sold-out plan).
  `GET /api/products/9001` (the buy path's live re-quote,
  `product.tsx:295`) serves the same document so the re-quote passes its
  price-consistency gate.
- **Everything else**: recommendations/notifications/wallet/orders/flash-sale →
  benign empty JSON; unlisted GETs → `{}`.
- **Non-GET safety**: every POST/PUT/PATCH/DELETE is answered
  `503 {error: "اختبار R162: تم اعتراض الطلب داخل المتصفح — لم يصل إلى الشبكة
  ولم يُنشأ أي طلب"}` — never a success. The app's own error mapper
  (`getErrorMessage` prefers the server's Arabic sentence) surfaces the
  interception message **verbatim in the UI**, which is what T4 asserts.
- **Service worker neutering**: `sw.js` + `workbox-*.js` fetches are aborted
  and `navigator.serviceWorker.register` is stubbed — workbox runtime-caches
  `GET /api/products*` from inside the SW context, and SW-context fetches
  bypass `page.route`. Without this the by-slug seed could race the SW's own
  network hit.
- **Sentry**: the build's `VITE_SENTRY_DSN` is empty — no external beacons
  exist to leak past the catch-all.
- Assertions are roles/text/aria-state (`getByRole`/`toBeVisible`/`aria-pressed`),
  sibling-spec conventions (`product-detail`/`soldout-pdp`/`pdp-band`); the bar
  container is addressed by its pin hook class `.mobile-sticky-above-nav` —
  the exact selector the R161-G fix targets (asserted unique before use).

### Precise limitations — what only a real operator login could prove

1. **The real cookie/session layer**: httpOnly `auth_token` issuance/expiry,
   the 401-mid-session re-probe, cookie rotation on re-login. Hermetic runs
   never touch a real session.
2. **Real wallet/order server behavior**: the M-suite money path (per-unit
   atomicity, Idempotency-Key replay, 409 `IDEMPOTENCY_IN_FLIGHT`) is *never
   exercised* — the buy POST is answered 503 by design. T4 pins the client's
   honest behavior *around* a failing order, which is the safe maximum.
3. **`env(safe-area-inset-bottom)` > 0**: headless Chromium resolves it to 0;
   real notched iOS devices add the inset. The CSS calc structure is verified
   (`index.css:1224/1240`), the inset arithmetic above 0 is not.
4. **The virtual-keyboard branch**: `stickyBarHiddenByKeyboard`
   (`product.tsx:731`, the `useKeyboardVisibility` hook) never fires in a
   headless desktop; only the CSS `[@media(max-height:480px)]:hidden` twin is
   implicitly inert-verified.
5. **Real backend cache headers** (`/api/auth/me` `Cache-Control: private,
   max-age=30`) and hydration-timing races against real latency — the seeded
   responses are instant.
6. **Authed-adjacent surfaces fed by real payloads**: notifications badge,
   wallet page numbers, orders history are seeded empty/constant; their
   real-data rendering is out of scope (and needs a real login).
7. **PWA/offline behaviors** — the SW is deliberately neutered.

## 3. Per-width evidence (the R161 gap band bolded)

Measured on the rendered production bundle (authed branch), scrolled to the
very bottom (one-off instrumented run, desktop-chromium; the passing T1
asserts the same invariants in all 3 projects):

| Viewport | Bar position | computed `bottom` | Bar box (y, h) | MobileNav (y, h) | Verdict |
|---|---|---|---|---|---|
| 390×844 | `fixed` | `60px` | 711, 73 → edge 784 | 784, 60 | docks **exactly** on nav top (784=784), fully in viewport |
| **640×960** | `fixed` | **`60px`** | **827, 73 → edge 900** | **900, 60** | **the R161 suspicion band: NO stranding, NO overlap — bar's bottom edge = nav's top edge (900=900), fully in viewport through deep scroll (mid-page 60% + bottom)** |
| 768×1024 | `fixed` | `0px` (safe-area floor) | 951, 73 → edge 1024 | not rendered (display:none) | docked at the exact viewport floor — the R161-G no-nav scope |
| 1024×768 | (bar hidden) | — | display:none | not rendered | desktop buy panel takes over («اشترِ الآن — 25.00 د.ل» visible) |
| 1280×800 | (bar hidden) | — | display:none | not rendered | same as 1024 |

T1 also asserts, per width <1024: exactly one `.mobile-sticky-above-nav`
element; the authed copy renders («رصيد كافٍ» + compact «اشترِ» CTA, **no**
guest «سجّل دخولك للشراء» CTA); `dir=rtl`; zero horizontal overflow; the
scrollable height is meaningfully deep (>300 px) so the deep-scroll pin is
not a no-op. At ≥1024: the bar is hidden, the desktop panel CTA is visible,
and the mobile nav is gone.

Screenshots (download/): `r162-e-bar-{390,640,768,1024,1280}.png`,
`r162-e-focus-640.png`, `r162-e-variant-640.png`, `r162-e-buy-error-640.png`,
`r162-e-addtocart-390.png`, `r162-e-shortfall-640.png`,
`r162-e-theme-light-{640,390}.png`.

## 4. Test inventory (11 tests, each × 3 projects = 33)

1. **Geometry ×5** (390/640/768/1024/1280) — the table above; viewport set
   inline via `page.setViewportSize`, so every project exercises every width
   (incl. the 640 band under `mobile-390`'s device emulation).
2. **Keyboard focus** (640×960) — the compact «اشترِ» CTA is reachable by
   Tab (≤120 presses, genuine Tab key presses) and shows the sanctioned
   Button-family ring-2 indicator: a NEW `0px 0px 0px 3px
   rgb(220, 24, 64)` box-shadow layer at `:focus-visible` (DESIGN.md's
   codified second treatment) — asserted against the resting shadow.
3. **Variant selector semantics** (640×960) — default = cheapest *available*
   variant at its sale price (aria-pressed, price in bar + panel + strike);
   plan switch selects that plan's cheapest available option; sold-out
   duration pill is disabled with honest «— نفد» in its accessible name
   (VariantSelector.tsx:140), the fully sold-out plan pill likewise; the buy
   CTA stays enabled on an available selection; a regular (no-sale) variant
   shows its own price with no fabricated strike.
4. **Buy click safety** (640×960) — click «اشترِ» → the live re-quote GET
   is served from the seed → exactly ONE `POST /api/orders` **through the
   interceptor** (asserted: exactly 1, body `{product_id: 9001,
   variant_id: 101}`); the UI renders its real pending state (disabled +
   «جارٍ المعالجة…», observed page-side at 50 ms sampling because Node-side
   protocol reads queue behind the held route), then the 503 lands, the
   alert shows the interception message verbatim, and the CTA re-arms
   («اشترِ», enabled). No navigation off the PDP; no receipt screen.
5. **Add-to-cart** (390×844) — local-only by design: toast «أُضيف إلى السلة»,
   `subnation_cart_v2` in localStorage carries `productId:9001`, and **zero**
   `/api/cart` or `/api/orders` attempts; bar geometry unaffected.
6. **Insolvent branch** (640×960, wallet 10 < 25) — «تحتاج 15.00 د.ل
   إضافية», the buy CTA is *replaced* by the top-up affordance (no dead buy
   promise), «شحن» → `/wallet?return=%2Fproduct%2F…` (the R94-A1 #7
   wallet-return contract); the wallet page renders under hermetic data.
7. **RTL + both themes** (640→390) — dark default (`:root`, no `.light`
   class), toggled to light through the app's own header control («تبديل
   المظهر (داكن/فاتح)»); the bar stays `fixed`, `bottom:60px`, zero
   overflow in both themes; the persisted light theme survives a fresh boot
   at 390.

## 5. Defects found

**App code: NONE.** The R161-F-AUDIT code-level suspicion for the authed bar
in 640–767 px is **refuted as fixed** by rendered evidence: the R161-G scope
split (`frontend/src/index.css:1216-1246` — `.mobile-sticky-above-nav`
`bottom: calc(var(--mobile-nav-h) + env())` ≤767.98 px, safe-area floor
768–1023.98 px) pins the authed fixed bar (`product.tsx:743-744`) correctly
across the whole band; the `html:has` scroll-padding twins
(`index.css:475-486`) and `.mobile-product-pad-auth` (`index.css:1254-1258`)
carry the same split.

**Spec-side defect found and fixed (this lane's own file, inherited from the
first R162-E attempt that ran out of time before verification):** the
page-side CTA-state recorder in the buy test sampled
`document.querySelector(".mobile-sticky-above-nav button")`'s *unscoped*
predecessor, which matched the **desktop panel's** buy button
(«اشترِ الآن — 25.00 د.ل», hidden at 640 but present in the DOM) — the
recorder logged that button's transitions and the "CTA must re-arm"
assertion failed 3-for-3 (deterministic, retry-proof) in the first attempt's
run (trace: states
`[{اشترِ الآن — 25.00 د.ل},{جارٍ المعالجة…},{اشترِ الآن — 25.00 د.ل}]`).
The recorder is now scoped to the bar under test
(`authed-pdp-r162.spec.ts:505-521`) and samples the compact «اشترِ» CTA.
This was a test bug, not an app defect — the app's pending→error→re-arm
behavior was correct all along (the end-state assertions on the real
locator passed even in the failing run).

## 6. Operator action

**None required for the sticky-bar geometry.** The authed fixed bar is
verified rendered-correct at every width; no app-code change is needed and
none was made (this lane touched only the new spec + this report).

**Remaining gap (acceptable, documented):** what a real operator login would
still add — the true session lifecycle (cookie expiry/refresh), the real
wallet/order server path (money invariants are backend-tested elsewhere and
deliberately never exercised here), non-zero iOS safe-area insets, and the
virtual-keyboard bar-hide branch. If the operator ever performs a manual
authed pass on a real device, the one thing worth eyeballing beyond this
suite is the notched-iPhone bottom inset (env() > 0) in the 640–767 band —
the calc structure is verified, the inset value is not observable headless.
