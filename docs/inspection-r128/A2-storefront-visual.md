# R128-A2 — Storefront Real-Browser Visual Walkthrough (المظهر flagship, RETRY)

- **Repo:** `/home/z/my-project/repos/SubNation2` @ `7d469d5` (main; live https://subnation.ly, guest view)
- **Lane:** real-browser visual craft — spacing rhythm, alignment grid, hierarchy, imagery treatment, component polish, typography in practice (truncation/bidi/muted contrast), micro-interaction affordances, RTL mirroring.
- **Method:** Playwright 1.63 (repo's bundled chromium — same launch idiom as `frontend/e2e`) pointed at production. ONE browser, one context per viewport: mobile **390×844** (isMobile+touch, DPR1, locale ar-LY) full pass; **1440×900** spot-check (home/product/cart). Per route: full-page JPEG ≤80KB (auto quality step-down; desktop home fell back to above-the-fold at the size cap) + in-page probe (scrollWidth overflow, elements beyond viewport, sub-40px targets, <11px text, edge-touching text, DPR-aware image upscale, h1 metrics, dir/physical-class census) + **6 VLM (vision) passes** on viewport-band crops for craft judgment, with every VLM claim re-verified against DOM/computed styles before filing (triage table in §5 — most VLM claims were hallucinations and were dismissed with measurements).
- **Known-items exclusion (not re-reported):** the full R127-B13 §8 table — product-card title clipping (B3-K1), micro-text density (B3-K2), R127-B4 perf set, R127-B5 PWA set, R127-B6 socket set, auth-card REFUSE tail (B-12), toaster safe-area (F-1), home inline recovery <44px (F-2), skeleton radius (F-3), cart stock cap (B-11), 99-cap toast (A9-m1), search-heading dir=auto (A9-m2), a11y tail (R126-A13 F1/F4/F5/F9/F10/F11), catalog 1/45 (OPS-2), R96 qty steppers, A6 empty-state-scale P4.
- **Safety:** guest only; no orders/logins/OTP. One client-side add-to-cart probe (documented acceptable — no server order) via the guest compact add button.
- **Artifacts:** 35 screenshots in `docs/inspection-r128/screenshots-a2/` (all <80KB; `m-*` mobile full-page, `seg-*` mobile viewport bands, `d-*` desktop). Probe JSON in `/home/z/r128-a2/out/`.

---

## 1. Verdict up front

**Ship-worthy. Zero P0/P1/P2.** Layout integrity is exceptional: **0 horizontal-overflow elements and scrollWidth = viewport on all 20 mobile page-states and all 3 desktop spot-checks** — including a 9128px-tall home, the 2-up product grid, and Latin-named products in RTL. The 11px type floor, image alt/upscale discipline, and grid gap consistency (uniform 12px card grids) all verify clean. The fresh craft defects found are two P3s (a systematic **bidi alignment** gap on Latin product titles — measured, root-caused — and a **below-standard product-404 page** sitting next to an exemplary generic 404) plus two P4s.

## 2. Per-page verdict table

| # | Route (390×844 unless d=1440×900) | scrollH | Overflow / tinyText / edgeText | Verdict | Shot |
|---|---|---|---|---|---|
| 1 | `/` home | 9128 | 0 / 0 / 0 | PASS + F-1 visible in grid | m-home.jpg, seg-home-*.jpg |
| 1d | `/` home (d) | 5505 | 0 / 0 / 0 | PASS (shot = fold, size cap) | d-home-fold.jpg |
| 2 | `/products` | 1260 | 0 / 0 / 0 | **Route absent → styled 404** (F-3) | m-products.jpg |
| 3 | `/category/software` | 3238 | 0 / 0 / 0 | PASS — chips/count/grid rhythm good | m-cat-software.jpg, seg-cat-* |
| 4 | `/product/lifetime-cloud-storage` | 2716 | 0 / 0 / 0 | PASS + F-1 on h1 (41px void) | m-pdp-cloud.jpg, seg-pdp-* |
| 4d | PDP (d) | 2179 | 0 / 0 / 0 | PASS — sticky buy-box, 2-col balance OK | d-pdp-cloud.jpg |
| 5 | `/cart` guest empty | 1012 | 0 / 0 / 0 | PASS — honest empty state + login CTA | m-cart.jpg |
| 6 | `/cart` guest +1 item (client cart) | 1064 | 0 / 0 / 0 | PASS — row `items-center`, image centered, no upscale | m-cart-item.jpg |
| 6d | `/cart` (d) | 900 | 0 / 0 / 0 | PASS | d-cart.jpg |
| 7 | `/login` (+empty-submit probe) | 901 | 0 / 0 / 0 | PASS — empty submit is a safe no-op (no error state to audit) | m-login-error.jpg |
| 8 | `/register` | 901 | 0 / 0 / 0 | PASS — card geometry mirrors login (same 901px) | m-register.jpg |
| 9 | `/flash-sales` | 1106 | 0 / 0 / 0 | PASS — honest «no active sales» empty state (OPS-1) | m-flash.jpg |
| 10 | `/support` | 1668 | 0 / 0 / 0 | PASS — FAQ + public; guest login-CTA card | m-support.jpg |
| 11 | `/status` | 844 | 0 / 0 / 0 | PASS — fits one screen, h-11 refresh (B-5 closed) | m-status.jpg |
| 12 | `/terms` | 2433 | 0 / 0 / 0 | PASS — 65ch measure column (B-13 closed) | m-terms.jpg |
| 13-17 | gates `/wallet` `/orders` `/loyalty` `/referrals` `/checkout` | all 901 | 0 / 0 / 0 | PASS redirect (no gate flash) + F-4 (context-free gate) | m-gate-*.jpg |
| 18 | `/product/nonexistent` | 844 | 0 / 0 / 0 | **F-2** — craft below generic 404 | m-notfound.jpg |
| 19 | `/notifications` | 1260 | 0 / 0 / 0 | 404 as designed (A9-F2 known — page deferred) | m-notifications.jpg |

## 3. Findings

### F-1. [P3] Latin product titles anchor LEFT — systematic void on the RTL reading edge (bidi alignment)
**Route/viewport:** every product grid card with a Latin name + PDP h1 · 390×844 (measured; also visible at 1440).
**Evidence (DOM range-vs-box measurement, live):**
- Card `h3[dir=auto]` (`components/ProductCard.tsx:491`): «cPanel» **gapRight 97px**, «Windows 8» **66px**, «Lifetime Cloud Storage» **38px**, «Grammarly Pro» **37px**, «WinRAR Lifetime» **21px** — the text hugs its box's LEFT edge (`textL == boxL`), leaving a dead zone on the right where every Arabic title (measured gapRight 0) begins.
- PDP `h1[dir=auto]` (`pages/product.tsx:1247`): text 275px wide in a 316px box, **gapRight 41px** — the page's largest element floats 41px off the right reading line while the breadcrumb/labels above it anchor right (VLM independently flagged it).
**Root cause (getComputedStyle):** `dir="auto"` resolves pure-Latin content to `direction: ltr` → `text-align: start` computes to **left**. The R116-S2 fix (dir=auto to stop bidi scrambling — comment at product.tsx:1243-1246) is correct for isolation but nothing pins the ALIGNMENT to the page's RTL anchor; the h3 is `flex-auto` so its box fills the row and the void shows.
**Why it matters:** most of the catalog is Latin brand names (Netflix, Spotify, cPanel…), so the majority of grid cards break the right-edge reading line against their Arabic neighbors — the exact "bidi on Latin names" craft surface this lane hunts. Mixed-card grids visibly alternate title anchors.
**Fix (S):** keep `dir="auto"`, add `text-right` (physical) on `ProductCard.tsx:491` h3 + `product.tsx:1247` h1 — two classes. (Home search heading, home.tsx:1173, already sits in a centered context; check on adoption.) **Confidence: 5** (measured live).

### F-2. [P3] Product-404 branch renders far below the generic 404's craft bar
**Route/viewport:** `/product/nonexistent` (any bad slug) · 390×844.
**Evidence:** the early-return branch (`pages/product.tsx:866-883`) uses a `<p className="font-bold">` («المنتج غير موجود» — **no heading element**) + a **14px underline text-link** recovery CTA («العودة للكتالوج», `text-sm text-primary-text hover:underline mt-2` — measured sub-44px recovery family, new instance of the B13 F-2 class) + a 40%-opacity muted icon tile, with `py-20` pushing the cluster high (VLM: "massive void before footer"). The generic 404 (`pages/not-found.tsx:43-67`) — the one users hit on `/products` and `/notifications` — is exemplary: real `h1`, muted copy, **two `size="lg"` Buttons** (primary + secondary RTL-correct ArrowRight), quick links.
**Why it matters:** the product branch is the HIGHER-traffic 404 (delisted products, dead share links) yet ships the lower-craft version; heading structure is also inconsistent between the two 404s (a11y craft).
**Fix (S-M):** converge the branch on the not-found recipe (h-level title + `min-h-11`/`lg` Button CTA + optional «بدائل» cross-sell link), or lift just the CTA + swap `p`→heading. **Confidence: 5.**

### F-3. [P4] `/products` is a dead conventional route
**Route/viewport:** `/products` · any. **Evidence:** router has no entry (`App.tsx:900-919` — home IS the catalog); live GET → HTTP 200 shell then styled 404 (m-products.jpg); sitemap.xml (live fetch, 52 URLs) honestly omits it; no `"/products"` href in `frontend/src`. Graceful, but the canonical e-commerce URL guesses into a 404 while `/flash-sales`-style catalog routes exist. **Fix (S):** alias `/products` → home (scroll-to-grid) or a client redirect. **Confidence: 5.**

### F-4. [P4] Guest gates land on a context-free login
**Route/viewport:** `/wallet` `/orders` `/loyalty` `/referrals` `/checkout` → login redirect · 390×844 (all measured H=901, no protected-content flash — good).
**Evidence:** login's intent system models only `"buy" | "generic"` (`pages/login.tsx:36,142`); a gated wallet/orders/loyalty/referrals visitor gets the generic value-chip banner («تسوّق فوري / محفظة آمنة / +50 نقطة») with no line saying WHY they're here — while the buy-intent variant («سجّل دخولك لإكمال شراء «X»») proves the pattern. The redirect param itself is preserved (B13 verified for checkout). **Fix (S):** add an `"account"` intent variant keyed off `redirect` («سجّل دخولك للوصول إلى محفظتك / طلباتك…»). **Confidence: 4.**

**Counts: P0 0 · P1 0 · P2 0 · P3 2 · P4 2.**

## 4. Top polish opportunities (evidence-backed, ordered)

1. **`text-right` on dir=auto titles** (F-1) — the single highest-leverage 2-class change in the storefront.
2. **Unify the product-404 on the not-found recipe** (F-2) — one branch rewrite.
3. **Gate intent banner** (F-4) — one variant of an existing component.
4. **PDP variant-cluster rhythm:** variant pill grids measure `gap-2` (8px, «المدة»/usage grids) while every card grid is `gap-3` (12px) — the selector reads tighter than the page's own rhythm; `gap-2.5/3` would harmonize (VLM flagged "cramped", computed styles confirm the 8px delta).
5. **Desktop PDP buy-box column** reads sparse below the CTA cluster (sticky `lg:top-24` by design); a compact trust/delivery row under the CTA would balance the two-column composition (VLM-flagged; sticky already implemented, so this is enrichment not structure).
6. **`/products` alias** (F-3) — parity for guessed URLs.
7. **MobileNav active state** carries three concurrent cues (pill `bg-primary/12` + 2.5px accent bar + bold label) — the pill at 12% is nearly invisible on dark; 15-18% would make the hover-scale cue land (pure judgment; geometry verified symmetric/centered, no defect).
8. **Cart summary footer**: primary CTA + secondary link stack is functional; adopting the `size="lg"` CTA idiom from the 404/login surfaces would give the money screen the same bottom-weight polish.

## 5. VLM-claim triage (why most were NOT filed — measurement discipline)

| VLM claim | Disposition |
|---|---|
| Grid row-gap ≠ column-gap (home + PDP recs) | **Dismissed** — computed `gap: 12px` both axes on every card grid (probe). |
| MobileNav active pill misaligned with icon | **Dismissed** — pill `inset-x-2 inset-y-[6px]` symmetric + `flex items-center justify-center` (MobileNav.tsx:160-166); geometry centered. |
| Price «تبدأ من» same weight/size as number | **Dismissed** — label `text-3xs`(11px) semibold muted vs price 18px/700 (ProductCard.tsx:537-543; measured). |
| Login error message "raw red string" | **Dismissed** — empty submit is a no-op (DOM diff probe: zero added nodes, no toast); no such element exists; callback errors use the toned `AuthErrorBanner`. |
| Footer links center-aligned / broken RTL flow | **Dismissed** — footer category links measured right-anchored (cx 345/280 of 390); only the mobile copyright row centers (`text-center sm:text-right`, deliberate). |
| Hero chevron misaligned; cart thumb off-center | **Dismissed** — `flex items-center` rows (home.tsx:596-607, cart.tsx:25). |
| Muted text contrast fails | **Dismissed** — A1's computed token math: 8.00:1 dark / 6.72:1 light; nothing sub-AA found on the probed surfaces. |
| Status page "missing uptime bar" / flash-sales "barren" | **Not filed** — status fits one screen by design (B13 §B-5); flash-sales empty state = known A6 empty-state-scale P4. |
| Stepper touch targets | **Known** (R96 exclusion). |
| **Latin title left-aligned (PDP + grid)** | **FILED as F-1** — the one VLM claim that survived measurement. |

## 6. Verified-OK (this round's evidence)

1. **Zero horizontal overflow** on all 20 mobile page-states + 3 desktop spot-checks (scrollWidth probe) — RTL grid discipline holds at 390 and 1440, including Latin names, 45-product grid, 9128px home.
2. **11px type floor respected**: 0 sub-11px text nodes on every page probed (`--text-3xs: 11px` token).
3. **0 edge-touching text** anywhere — gutters uniform.
4. **Imagery**: 51 `<img>` probed across pages — 0 upscaled beyond 1.15× (DPR-aware), 0 missing alt; cart thumb centered, no blur.
5. **Guest client-side add-to-cart** (A9-4 surface) works end-to-end; cart item row renders clean (items-center, no overflow).
6. **Gates redirect without protected-content flash** — all five land on the same 901px login shell; redirect preserved (checkout per B13).
7. **Grid rhythm**: all card grids uniform 12px gaps; card title line-height constant 19.25px; per-row stretch keeps card bottoms aligned.
8. **404 shell integrity**: both 404s render within the app shell (navbar/footer/nav) — no broken chrome; generic 404 craft is exemplary (lg Buttons, RTL-correct ArrowRight).
9. **Auth card geometry**: login/register identical height (901px) — the twin surfaces are visually locked.
10. **No physical `ml-/mr-` drift** found in probed page DOM beyond the known A6 pagination-chevron P4 (census in probe JSON).

## 7. Next actions

1. **One S-commit:** `text-right` ×2 (F-1) + product-404 CTA/heading lift (F-2 core) — highest visual ROI.
2. F-3 `/products` alias + F-4 gate-intent variant (one small component extension).
3. Fold the PDP variant-grid gap + MobileNav pill strength into the next design-pass commit alongside B13 §9.1's ~10-line batch.

---
*Agent R128-A2 · incremental report completed in 3 batches (batch 1 pages 1-7 written first, per retry protocol). Screenshots: 35 files, all <80KB. Worklog: Task ID R128-A2.*
