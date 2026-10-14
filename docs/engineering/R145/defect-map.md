# R145 — Baseline Defect Map

Base: `a109357` (local == origin/main, working tree clean). Production live
(200, 0.8s), release identity `defd303` confirmed by R144's closing evidence.

Method: real browser capture (Playwright 1.57, Chromium) of
https://subnation.ly at desktop 1440×900 + mobile 390×844 (locale ar,
TZ Africa/Tripoli), 81 screenshots across 12 routes + scroll positions;
VLM design critique (z-ai vision, glm-5v) of the key frames; zoomed-crop
verification of currency/stats claims. Evidence lives in
`/home/z/my-project/download/r145/baseline/`.

Verified non-issues (checked, not defects): product images all load
(45×450px webp, the earlier "netfail" list = aborted lazy-loads);
currency is «د.ل» (VLM misread as ر.س in one pass — crop-verified);
no console errors on any captured route; RTL nav direction correct.

## P0 — first impression / journey blockage

| # | Route × viewport | Evidence | User impact | Correction | Acceptance test |
|---|------------------|----------|-------------|------------|-----------------|
| D1 | `/` desktop+mobile, first viewport | home-desktop-top.png / home-mobile-top.png + VLM: "three competing focal points", "hero card is a black hole", stats read as "debugging info", CTA "positioned too low" | The most-visited screen fails to say what/why/how in one glance; mobile fold burned ~50% on prose before a single product | Recompose guest hero: one focal h1, one accent role, product-forward plane, compact mobile fold (h1 + sub + CTA + shelf rail visible) | Squint test on new screenshot: primary/secondary/groups nameable in order; ≥1 product image + CTA visible in 390×844 first viewport |
| D2 | `/` all viewports, scrolled | home-desktop-scroll1-3 + VLM: "wall of cards… scrolling feels like you haven't moved", "zero visual breathing room", "Windows license and Spotify carry equal weight" | No merchandising hierarchy: 45 identical cards, flat rhythm, catalog fatigue; no anchor | Section grammar: category discovery rail → featured shelf (in-stock, larger) → catalog grid with real section rhythm; more space above section h2 than below | Screenshot diff at 35/70/100%: distinct section identities; VLM re-critique no longer flags "wall of cards" |
| D3 | `/product/:slug` desktop+mobile | product-shudder-*.png + VLM: "terms box sits between price and CTA — pattern interrupt", sticky bar "translucent bleeding… ghost/outline buy button — conversion killer" | Conversion path blocked exactly where intent peaks | PDP: price → variant → CTA adjacency restored (terms below CTA, collapsible); mobile sticky bar solid bg + border-top + solid buy button | Screenshot: CTA immediately follows price block; sticky bar opaque with visible separation at scroll |

## P1 — coherence & comprehension

| # | Route × viewport | Evidence | Impact | Correction | Acceptance |
|---|------------------|----------|--------|------------|------------|
| D4 | catalog cards, all | VLM: price "bolder/larger than product name — inverted hierarchy"; «تبدأ من» repeated every card; badge competes with title; colored price = "dashboard alert" | Scanning suffers: eye lands on price-colored numbers, not products | Title-first card hierarchy; price in neutral ink (tabular-nums kept); qualifier + badge discipline | Zoomed card crop: title is the loudest text after image; one accent max per card |
| D5 | `/` mobile fold | home-mobile-top: hero + stats strip consume the fold before first card | Mobile shoppers (majority) see no product to tap | Compact fold: fold budget audited after hero recompose (D1) | First product card top edge ≤ ~640px from top at 390×844 |
| D6 | `/flash-sales` mobile | flash-sales-mobile-top + VLM: empty state "reads as system error… conversion killer" | Promised urgency → broken-feed perception | Honest "no active sales now" composition with next-action (browse catalog) | Screenshot: state clearly editorial (calendar/return hint), not error-shaped |
| D7 | `/login` desktop | login-desktop-top + VLM: "input fields zero visual weight… eye jumps to social buttons" | Primary path (Telegram is the real primary here — verify) under-weighted | Rebalance form/surface weights; honest provider ordering by `enabled` truth | VLM pass: hierarchy reads form-first; disabled providers not shown as available |
| D8 | `/cart` (empty) desktop | cart-desktop-top + VLM: "dead end… forces journey restart" | High-intent moment wasted | Active empty state: category shortcuts (honest, data-driven) | Screenshot: ≥3 tappable category links present |

## P2 — craft details

| # | Route × viewport | Evidence | Impact | Correction |
|---|------------------|----------|--------|------------|
| D9 | PDP mobile | VLM: breadcrumb contrast "too light"; body 14-15px light weight | Readability strain | Contrast + weight pass within existing tokens (11px floor stands; raise PDP body to 16px per B3-family precedent where it's the reading column) |
| D10 | admin `/admin/login` | admin-login-desktop-top | First admin touchpoint is a different visual family | Fold admin login into the same type/space system (lane E) |

## Mission-required additions (from the R145 brief, not defects)

- Motion (`motion/react`) integration: scroll-triggered section reveals,
  hero plane parallax, layout transitions — gated, reduced-motion safe,
  measured against the eager-path budget (150 KiB warn / 160 KiB hard).
- Scroll Craft methodology on the homepage: page grammar, feeling curve,
  one signature move ("the lit shelf"), dimensional hero planes,
  mobile-specific composition, scroll-state verification.
- Design-system coherence across storefront + account + admin; no new
  framework, no competing animation libraries, dead CSS removed.

## Standing constraints honored

FINAL_UX_SYSTEM.md (quiet premium; 400/600/700 only; 11px floor; ONE
focus system; z-scale; lucide stroke-2 RTL contract; money =
formatCurrency + tabular-nums + «د.ل»), money invariants untouched,
admin dialect (density, ≥24px edge targets), PERFORMANCE.md budgets,
.hermes.md gates. Arabic copy changes only where explicitly authorized
by the recomposition (hero sub-line stays keyword-honest for SEO).

---

## FINAL DISPOSITIONS (close of round — every item resolved with evidence)

| # | Defect | Disposition | Evidence |
|---|--------|-------------|----------|
| D1 | Hero chaos / black hole / orphaned stats | **CLOSED** — the lit shelf recomposition (h1 + value line + CTA + shelf + stats caption); before/after VLM: desktop hero 9/10 "massive improvement", mobile 8-9/10 | download/r145/{baseline,after}/ + live/ screenshots |
| D2 | Wall of cards / no section identity | **CLOSED** — CategoryRail + visible catalog section header + rhythm gaps + the close (how-it-works + trust); VLM comparative: dedicated discovery section confirmed | live VLM check item 3 |
| D3 | PDP terms-between-price-and-CTA; sticky bar ghost | **CLOSED** — terms → quiet disclosure below CTA (order-13); sticky bar verified solid/separated/solid-CTA against an in-stock product (sold-out branch stays honest-outline by design) | product-instock-mobile-sticky.png + VLM 4-point pass |
| D4 | Card hierarchy inversion | **CLOSED** — title full-ink, price text-base; pin suite updated with rationale | product-card-r120-regressions 16/16 |
| D5 | Mobile fold waste | **CLOSED** — shelf (product imagery) at 405px on live 390×844 (was ~915px before any product) | fold-geometry.json + live smoke |
| D6 | Flash-sales empty reads as error | **CLOSED** — editorial honest state; lane 145-D; flash-sales tests re-pinned | VLM: "editorial, not error" |
| D7 | Login input weight / dead providers | **CLOSED** — bg-input surface + renderableProviders gate (dead Google row hidden); truth-table pins | auth-providers-hardening + VLM 3/3 |
| D8 | Empty cart dead end | **CLOSED** — 7 honest category shortcuts at 44px; pins added | cart-undo-clear 21/21 + VLM 2/2 |
| D9 | PDP readability | **CLOSED** — 16px reading column, breadcrumb contrast step | lane 145-C |
| D10 | Admin login family break | **CLOSED** — emblem glow retired, tint pair aligned; 130/130 admin suites | lane 145-E |

## Release evidence

- Base `a109357` → final `bb7bd52` (one commit: feat(visual,r145))
- CI push run `38581513116` success; dispatched run `38582764033` **8/8
  success incl. e2e** (live guest suite against the deployed release)
- Live release identity: `index-B-XOmDEf.js` embeds `"bb7bd52"`
- Live smoke: 14/14 routes, 0 page errors, no horizontal overflow
  (contain:layout verified in production), shelf at 405px
- Eager path: **146,702 B gz (−148 vs the 146,850 baseline)** under the
  150 KiB warn / 160 KiB hard gate; vendor-motion 30.49 KB gz
  lazy-gated, fetched on first route load
- Motion 14.2.0 (LazyMotion + m + domAnimation, reducedMotion="user");
  no other animation library; tw-animate-css untouched
