# A13 — Real-Browser Accessibility + Mobile Sweep (Live Production)

**Agent:** R126-A13 · **Target:** https://subnation.ly (guest-level, read-only) · **Method:** Playwright 1.63 headless Chromium, real page loads at 1280×900 / 390×844 (iPhone UA, isMobile, touch) / 320×640 reflow; computed-style contrast sampler; `reducedMotion: "reduce"` emulation.
**Scratch:** `/home/z/my-project/tmp-a13/` (scripts `1-keyboard.js`, `2-semantics.js`, `3-mobile.js`, `4-motion-contrast.js`, `6/7-verify.js`; logs `log-*.txt`; screenshot `drawer-open.png`).
**Safety:** cart writes verified client-side only (`frontend/src/lib/cart.tsx` → `localStorage["subnation_cart_v2"]`) before any add-to-cart click; no OTP, no submits, no admin attempts.

---

## J1 — Keyboard journey

### `/` tab order (45 stops recorded, `log-keyboard.txt`)
| Stop | Element |
|---|---|
| 1 | Skip link `a[href="#main-content"]` «تخطّى إلى المحتوى الرئيسي» — first focusable, `sr-only focus:not-sr-only focus:fixed`, renders 1264×44 on focus ✅ |
| 2–7 | Logo → الكتالوج → theme toggle (aria-label «تبديل المظهر», 44×44) → دخول → حساب مجاني → cart (aria-label «السلة، فارغة», 44×44) |
| 8–9 | Promo banner link (885×44) + dismiss (aria-label «إغلاق الشريط», 44×44) |
| 10–17 | Category rail: 8 links, each with aria-label («نتفلكس», «شات جي بي تي»…) |
| 18–19 | Hero CTAs «إنشاء حساب مجاني» / «لدي حساب — تسجيل الدخول» |
| 20–30 | Search input (aria-label «البحث في المنتجات») → sort select (aria-label «ترتيب المنتجات») → 9 filter-chip buttons |
| **31** | **First product card** `a.flex.flex-col[href=/product/lifetime-cloud-storage]` |

- **[F1 | P3] 31 tab stops to reach the first product card.** Order is logical and RTL-correct, but pre-content chrome (banner + rail + 9 filter chips) dominates. Fix: make the filter-chip row `role="group"` with collapsed/`aria-expanded` control, or move promo banner below the hero on keyboard/small layouts.
- **Focus indicators: PASS.** Programmatic focus on sampled nav/buttons changes computed outline (`solid 2px`) or ring box-shadow; button classes carry `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`. An earlier crude heuristic flagged 6 elements; the before/after computed-style diff on all 4 reachable flagged elements showed `changed: true` — false positives, no finding.
- Product cards expose rich accessible names: `aria-label="Lifetime Cloud Storage، برامج وتراخيص، تبدأ من 784 د.ل، 6 باقات…"` + `h3` per card. Card add-to-cart icon (stop 32) has aria-label «أضف … إلى السلة».

### Product page `/product/lifetime-cloud-storage`
- Variant selector (500 جيجابايت / 1 تيرابايت / غير محدود) = real `<button>`s 97–125×44 with **`aria-pressed` true/false — correct toggle semantics** ✅. No quantity stepper exists on the product page (quantity = variant choice) → no keyboard trap/semantics issue.
- **Add-to-cart (client-only, verified):** focus **stays on the trigger button** (no focus steal) ✅; toast = sonner `li` inside `section[aria-live="polite"]` with text «أُضيف إلى السلة Lifetime Cloud Storage — 500 جيجابايت» → politely announced ✅; `localStorage.subnation_cart_v2` written, zero network calls.
- **[F4 | P3] Cart badge is not a live region.** Header link name updates «السلة، فارغة» → «السلة، 1 منتج» and badge span shows «1», but neither carries `aria-live`; SR users depend on the toast (which does cover it). Cheap fix: `aria-live="polite"` on the badge, or leave as-is given the toast.
- Product images: main `img[alt="Lifetime Cloud Storage — اشتراك برامج وتراخيص"]`, related-product imgs all have alt ✅. No lightbox/gallery controls exist → nothing to trap.

### Mobile menu drawer (390px, hamburger «القائمة») — **[F2 | P2]**
Evidence (`log-vB.txt`, `log-tB.txt`, `drawer-open.png`):
- Toggle has `aria-expanded` ✅ but starts `false`, opens on Enter; drawer contents: 28 nav links become visible, `body{overflow:hidden}` scroll lock engages.
- **Escape does not dismiss:** after two Esc presses `aria-expanded` stays `true`, `bodyOverflow` stays `hidden`, drawer links remain visible. Only the toggle/X closes it.
- **No focus management:** focus remains on the toggle after open; first Tab lands on the header cart link (verified *not* covered by overlay via `elementFromPoint`), then into drawer links — order works but is header-before-drawer.
- Drawer container has **no `role="dialog"`/`aria-modal`** (fixed-position z≥45 probe found none — rides a transform-based panel).
- Fix sketch: add Esc keydown handler (close + restore focus to toggle), `role="dialog" aria-modal="true" aria-label="القائمة"` on the panel, `initialFocus` on first drawer link, and remove scroll lock on close.

## J2 — Auth surfaces (no OTP, no submits)

- **`/login`:** unique `h1` «تسجيل الدخول إلى SubNation»; skip link present; 10-stop tab order ends at provider buttons (Telegram 334×44); **zero form inputs at rest** (progressive disclosure — phone/OTP appear after provider choice, not testable within guest/no-OTP rules).
- **[F5 | P3] Error-announcement structure is callback-only.** `AuthErrorBanner.tsx` renders *only* for Telegram-callback `?error=` codes; it correctly uses `role="alert"` but with explicit `aria-live="polite"` (downgrades alert's implicit assertive — defensible, note it). At rest the DOM exposes only the generic sr-only `role=status` region + toaster `section[aria-live=polite]` — any future inline OTP-flow errors must wire into an alert region.
- **`/admin/login`:** real `<label for=username|password>` («اسم المستخدم»/«كلمة المرور») ✅, `autocomplete="username"/"current-password"` ✅, `aria-describedby` error wiring in code ✅, tab order: skip-link → username → password → reveal → submit ✅.
  - **[F6 | P3] Password-reveal button 16×16px** (`button.absolute.left-3.top-1/2`, aria-label «إظهار كلمة المرور») — below WCAG 2.5.8's 24×24 floor; give it `min-h-9 min-w-9` + negative margins like AuthErrorBanner's close button already does (see its own B6 comment).
  - **[F7 | P3] Admin inputs `font-size: 14px`** → iOS Safari focus-zoom trigger (admin surface, low impact).
  - Note (P4): page `<title>` stays the generic home title; `لوحة الإدارة` is the h1. Consider a distinct title.

## J3 — SR semantics (DOM audits, 7 pages)

| Page | h1 (unique) | heading skips | imgs (missing alt) | unlabeled controls | landmarks |
|---|---|---|---|---|---|
| `/` | سوق الاشتراكات الرقمية في ليبيا ✅ | none | 45 (0) ✅ | 0 ✅ | header+4nav+main+footer |
| `/category/software` | مفاتيح ورخص برامج أصلية في ليبيا ✅ | none | 7 (0) ✅ | 0 ✅ | header+5nav+main+footer |
| `/flash-sales` | عروض فلاش ✅ | **1→3** | 1 (0) ✅ | 0 ✅ | ok |
| `/cart` (empty & with item) | سلة المشتريات ✅ | **1→3** | 0 ✅ | 0 ✅ | ok |
| `/product/lifetime-cloud-storage` | product name ✅ | none | 5 (0) ✅ | 0 ✅ | ok |
| `/login` | ✅ | none | 0 | 0 | ok |
| `/admin/login` | لوحة الإدارة ✅ | none | 0 | 0 | main only |

- **[F9 | P3] 1→3 heading skips on `/flash-sales` and `/cart`** — the footer's «الفئات»/«المساعدة والدعم» `h3`s directly follow the `h1` on short pages. Fix: make footer column titles `h2` (site-wide) or demote to styled `<p>`.
- Live regions on every page: sr-only `div[role=status][aria-live=polite]` + toaster `section[aria-live=polite]`; product stock badge `role=status` «متوفر (1)» ✅. `lang=ar`, `dir=rtl` everywhere ✅.
- Search input + sort select rely on `aria-label` (no visible `<label>`, acceptable for compact toolbars). Cart page (with item) exposes no coupon/qty inputs pre-checkout for guests — nothing unlabeled to flag.

## J4 — Mobile 390×844

- **Horizontal scroll leaks: NONE.** `documentElement.scrollWidth === 390` (leak 0) on `/`, `/category/software`, `/cart` empty, `/cart` with item, `/product/...`; no offending wide elements.
- **Sticky header:** `header` sticky, 57px tall, z-50, stays at top after 800px scroll on every page ✅.
- **Tap targets:** primary controls uniformly 44×44 (theme, menu, cart, banner close, variants 97–125×44, remove «حذف المنتج X» 44×44 with full aria-label, ATC 242×44). **[F10 | P3] Text links under 24px tall:** breadcrumb/footer links «الرئيسية» 44×16, «البرامج والتراخيص» 95×16, cart item title 258×19, footer chips «الدعم» 28×24 / «العروض» 39×24 (chips pass 2.5.8 AA at 24px; the 16–19px-tall links rely on the spacing exception). Fix: `min-h-6` / `py` padding on those anchors.
- **Input zoom:** no storefront input < 16px ✅ (only admin login at 14px — F7).
- **[F11 | P2] `viewport-fit=cover` with zero `safe-area-inset` usage.** viewport meta = `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`, but no `env(safe-area-inset-*)` rule exists in any stylesheet (scanned all CSSRules on 4 pages). On notched iPhones (esp. PWA standalone) the sticky header / bottom bar can sit under the Dynamic Island / home indicator. Fix: `padding-top: env(safe-area-inset-top)` on the sticky header and `padding-bottom: env(safe-area-inset-bottom)` on fixed bottom bars (or drop `viewport-fit=cover`).

## J5 — Zoom 200% / reflow

- 320px-wide reflow (400%@1280 worst case): `scrollWidth === 320`, leak **0**, no fixed element >50% viewport covering content, on `/`, `/category/software`, `/cart`. 200%@1280 (640px) is bracketed by the 390 mobile pass (0 leaks). **PASS — no 2D scroll, no covering overlays.**

## J6 — Reduced motion

- With `reducedMotion: "reduce"` emulation, **every** animation/transition collapses to `1e-05s` — `tab-slide-in` (0.24s), promo `pulse` (2s gradient sweep), all transform transitions (0.16s). 3 `prefers-reduced-motion` media rules ship in the CSS. **PASS — no non-spinner animation ignores RM.**

## J7 — Contrast (computed styles, alpha-composited backgrounds)

| Page | text nodes checked | failures |
|---|---|---|
| `/` | 437 | 0 ✅ |
| `/product/lifetime-cloud-storage` | 90 | 1 |
| `/login` | 31 | 0 ✅ |
| `/admin/login` | 6 | 0 ✅ |

- **[F12 | P3] Product sale-price badge** `span.text-xs.font-bold.tabular-nums` «784.00 د.ل 980.00 د.ل» — `rgb(220, 24, 64)` on card bg = **3.76:1** vs 4.5:1 required (12px bold is not "large"). Fix: darken to the destructive-foreground token or bump to 14px+ `--price` token ≥4.5:1.
- Placeholders all pass; disabled buttons ride 0.7-alpha (exempt).

---

## Findings register

| ID | Sev | Finding | Where / evidence | Fix sketch |
|---|---|---|---|---|
| F2 | **P2** | Mobile menu drawer: Esc doesn't dismiss, scroll stays locked, no focus move, no dialog semantics | `/` @390, `log-vB/tB.txt` | Esc handler + `role=dialog aria-modal` + focus in/out |
| F11 | **P2** | `viewport-fit=cover` with zero safe-area insets | viewport meta + CSSRules scan, 4 pages | `env(safe-area-inset-*)` padding on header/bottom bars |
| F1 | P3 | 31 tab stops to first product card | `/` tab journey | collapse filter chips behind one control; shorten pre-content rail |
| F4 | P3 | Cart badge count not in a live region (toast covers it) | add-to-cart probe | `aria-live=polite` on badge |
| F5 | P3 | `/login` inline-error path: only Telegram-callback banner exists; `role=alert` downgraded to polite | `AuthErrorBanner.tsx:108-113` | assertive for `tone:error`; add alert region for OTP-flow errors |
| F6 | P3 | Admin password-reveal button 16×16 | `/admin/login` tab dump | `min-h-9 min-w-9` + neg margins |
| F7 | P3 | Admin inputs 14px → iOS focus zoom | `/admin/login` computed styles | `text-base` on inputs |
| F9 | P3 | 1→3 heading skips on `/flash-sales`, `/cart` | heading audits | footer `h3`→`h2` |
| F10 | P3 | Text links 16–19px tall (breadcrumbs, footer, cart item title) | tap-target dump @390 | `min-h-6`/padding on anchors |
| F12 | P3 | Sale-price badge 3.76:1 (12px bold) | product contrast audit | darker token or larger size |

**P0: 0 · P1: 0 · P2: 2 · P3: 8** (+2 P4 notes: admin title; AuthErrorBanner polite nuance).

## Strengths worth preserving
Skip-link-first tab order; every image alt'd; every control labelled (aria-label or `<label>`); unique h1 per page; `aria-pressed` variant toggles; add-to-cart keeps focus + polite toast; zero horizontal-scroll leaks at 390 and 320; 44×44 standard controls; global reduced-motion support; near-perfect computed contrast (437/437 on home).

## Verdict
**SHIP-WORTHY.** No P0/P1 blockers; both P2s are narrow (drawer dismiss behavior at ≤md widths; notch insets for PWA). All fixes are localized component/CSS changes — none require architectural work. Recommended order: F2 → F11 → F12 → F6 → F9/F10.
