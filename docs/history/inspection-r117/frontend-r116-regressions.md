> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r117/frontend-r116-regressions.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R117-A2 — Frontend audit of the R116 overhaul (47b304e..f10bb9b, `frontend/`)

Agent: R117-A2 · READ-ONLY audit (no repo files modified) · 2026-10-05
Scope: `git diff 47b304e..f10bb9b -- frontend/` (65 files, +2925/−1096) — App.tsx, dialog.tsx
deletion, sonner lazy+replay, auth Firebase gating, product desktop split, wallet whole-dinar
topups, checkout/orders/order-detail, admin/orders credentials-on-demand, hooks, index.css
tokens, vite.config, index.html, plus all new test files.

Method: full reads of every touched runtime file at HEAD + old-vs-new structure comparison
(`git show 47b304e:…`), targeted greps for stale references, wouter 3.9.0 / sonner 2.0.7
node_modules source inspection, **full frontend suite run (108 files / 747 tests — ALL PASS)**,
`tsc --noEmit` (clean), and a production `vite build` to verify every chunking/lazy claim.

Severity totals: **P0: 0 · P1: 1 · P2: 2 · P3: 5** (8 findings). Everything else verified OK
(see §VERIFIED-OK).

---

## FINDINGS

### F-1 · P1 — Product page mobile (<lg): buy-panel blocks lost their side gutters (full-bleed inside the card)

**File:** `frontend/src/pages/product.tsx:1015-1017, 1094, 1177-1178, 1185, 1195, 1242, 1250, 1260, 1277, 1292`

The pre-split layout wrapped **all** post-image content in one shared padded container:

```jsx
// 47b304e (old, line ~1077)
<div className="p-5 space-y-4">   {/* title … features … VariantSelector … price …
                                      usage … error … trust … FAQ … coupon … CTA */}
```

The split replaces that container with two sections that dissolve on mobile
(`<section className="max-lg:contents …">` + `<div className="max-lg:contents lg:p-5 …">`).
`display:contents` contributes **no padding below lg**, so compensating `max-lg:px-5` classes
were needed per block. They were added to the START-column blocks only:

- title `max-lg:px-5 max-lg:pt-5` (product.tsx:1096) ✓
- long description `max-lg:px-5` (1116) ✓
- features `max-lg:px-5` (1126) ✓
- FAQ `max-lg:px-5` (1151) ✓

The **END-column (buy panel) blocks got nothing**:

- `order-5` variant selector wrapper — `<div className="order-5">` (1185), no padding
- `order-6` price+stock box (1195) — its `p-4` is *internal*; the tinted rounded-xl box itself
  is full-bleed
- `order-7` usage terms (1242), `order-8` error (1250), `order-9` trust grid (1260),
  `order-11` mobile coupon (1277), `order-12` CTA (1292) — all flush to the card's inner edge

**Impact:** every visitor below `lg` (the dominant Libyan mobile traffic) sees the variant
selector, price box, trust badges and coupon field touching the card borders — rounded
tinted boxes with borders pressed against the card border, 0px gutter. Money-page visual
regression; no functional loss.

**Fix (concrete):** add `max-lg:px-5` to the six END-column wrappers (order-5…order-12), e.g.
`<div className="order-5 max-lg:px-5">`, `className="order-6 max-lg:px-5 flex flex-col …"`,
etc. — mirroring the START-column treatment. Add a class-contract test that greps the rendered
markup for the px-5 gutter on each `order-*` block (same pattern shared-chrome tests use).

---

### F-2 · P2 — "iOS keyboard hide for the sticky buy bar" is dead code: the hook value is never wired

**File:** `frontend/src/pages/product.tsx:391` (hook call) vs `1334-1350` (sticky bar), hook at
`frontend/src/hooks/use-keyboard-visibility.ts:20-42`

The R116 commit message claims "iOS keyboard hide for the sticky buy bar", and the code
comments claim the same:

```tsx
// product.tsx:387-391
// R116-S2 (P2): hide the sticky mobile buy bar while the virtual keyboard
// is open (visualViewport pattern — see hooks/use-keyboard-visibility.ts;
// the paired CSS fallback rides the bar itself). Called before ANY early
// return, per the rules of hooks.
const stickyBarHiddenByKeyboard = useKeyboardVisibility();
```

But `stickyBarHiddenByKeyboard` is **never read again** — grep shows exactly two references
in the file (import line 14 + assignment line 391). The sticky bar (1334-1350) has no
conditional class, and the claimed CSS fallback `[@media(max-height:480px)]:hidden` does not
exist anywhere in product.tsx (grep: zero matches). Net effect: the hook mounts a
visualViewport resize listener whose result is discarded; the fixed buy bar still gets
covered by the iOS keyboard exactly as before R116. **Claim not delivered** (not a behavior
regression — pre-R116 also didn't hide it — but a false report claim + wasted listener).

**Fix:** wire it into the bar:
`className={`sm:hidden z-[45] … ${stickyBarHiddenByKeyboard ? "hidden" : ""} [@media(max-height:480px)]:hidden`}`,
and extend `product-legacy-shape.test.tsx` (or a new wiring test) to pin that the bar's
className reacts to the hook — the existing `use-keyboard-visibility.test.tsx` only pins the
hook in isolation, which is exactly why this gap shipped.

---

### F-3 · P2 — Mobile DOM/reading/Tab order changed at <lg; the "mobile DOM byte-identical via flex order" claim is false

**File:** `frontend/src/pages/product.tsx:1015-1171` (START section incl. FAQ at 1150-1170)
vs `1173-1325` (END section)

With `max-lg:contents` dissolving both sections, visual order on mobile is restored via
flex `order-1…order-12` — but **DOM order is now section-ordered**:

- DOM: image, title, desc, long-desc, features, **FAQ** | variant selector, price, usage,
  error, trust, coupon, CTA
- Visual (<lg): image, title, desc, long-desc, features, variant selector, price, usage,
  error, trust, **FAQ**, coupon, CTA

The FAQ `<details>` block moved from *after the trust grid* (old DOM, 47b304e:1216 — between
trust and coupon) to *right after the features list* in DOM, while visually remaining after
trust via `order-10` (product.tsx:1151).

**Impact (WCAG 1.3.2 Meaningful Sequence / 2.4.3 Focus Order, <lg only):** keyboard/AT users
Tab from the features list straight to the FAQ (visually far below, after trust), then focus
jumps back *up* the page to the variant selector. SR reading order diverges from the visual
layout on the money page. At ≥lg DOM order matches the two-column visual order (no issue).

**Fix options (pick one deliberately):**
1. Move the FAQ element in DOM to the position that matches the mobile visual sequence
   (i.e. into the END section after the trust grid, keeping `order-10` for the ≥lg sticky
   panel — verify the desktop design still reads), or
2. Keep it and change the mobile visual order to match DOM (FAQ after the CTA), or
3. Document the divergence as accepted (two-column layouts at lg already accept column
   reading order).
Also: `product-legacy-shape.test.tsx` renders only — it does **not** pin block order. Add a
test asserting the DOM sequence of the key blocks at the mobile shape, so the next refactor
can't silently reorder it again.

---

### F-4 · P3 — Legacy numeric-ID product URL rewrite now steals focus + re-scrolls mid-read

**Files:** `frontend/src/pages/product.tsx:366-372` (rewrite) × `frontend/src/App.tsx:526-537` (ScrollToTop)

`/product/123` (legacy links) fetches by id then rewrites the URL via
`window.history.replaceState(null, "", "/product/slug")`. wouter 3.9 monkey-patches
`history.replaceState` and dispatches an event (`wouter/src/use-browser-location.js`,
patchKey block) → `usePathname()` changes `/product/123` → `/product/slug` → `ScrollToTop`'s
effect re-fires: `window.scrollTo(0,0)` **plus (new in R116)** `#main-content.focus()`. A user
who scrolled/started reading while the by-id fetch resolved gets snapped to top and their
focus yanked to main. The scroll-jump half is pre-existing; the focus steal is new.

**Fix:** in `ScrollToTop`, skip focus (and arguably the scroll reset) when only the
*same-route* path changed by rewrite — e.g. record the last pathname's route shape
(`/^\/product\//`) and only act when the shape segment changes, or have product.tsx suppress
via a module-level "programmatic rewrite" flag the effect can consume.

---

### F-5 · P3 — RouteAnnouncer can double-announce on cold navigations (old title, then new title)

**File:** `frontend/src/App.tsx:546-609` (`ROUTE_ANNOUNCE_DELAY_MS = 150` + MutationObserver)

On a cold (uncached lazy chunk) navigation the 150 ms timer frequently fires *before* the
destination route's `MetaTags` writes its `<title>` — the announcer reads the **previous**
page's title, then the `MutationObserver` fires again when the real title lands → two polite
utterances back-to-back. Cosmetic SR noise, not silence (pre-R116 there was no announcement
at all), and the wipe-first trick correctly handles same-title hops.

**Fix:** capture `document.title` at navigation start and have both the timer and the
observer skip announcing a value equal to it (only announce titles that *differ* from the
pre-navigation one), or delay the timer to ~400 ms and rely mostly on the observer.

---

### F-6 · P3 — Toast-shim helper normalizer silently drops non-standard sonner options

**File:** `frontend/src/hooks/use-toast.ts:131-146` (`helperInput`)

`helperInput(title, second, variant)` destructures only `description, duration, action, id`
from an object-shaped second argument. Any other sonner option a sonner-idiomatic caller
passes (`onDismiss`, `onAutoClose`, `cancelButton`, `invert`, `unstyled`, `position`,
`closeButton` per-toast, …) is **discarded without error**. Grep confirms no current
callsite passes any of these (only the SW-update `action` and descriptions), so this is
latent, not live. The double-wrap fix itself (object-vs-ReactNode disambiguation via
`isValidElement`/`Array.isArray`) is correct.

**Fix:** forward the remainder — `const { description, duration, action, id, ...rest } = second`
and spread `...rest` into `emit`'s opts (whitelist if strictness is preferred, but then
type it).

---

### F-7 · P3 — useKeyboardVisibility never re-anchors on non-keyboard viewport shrink (rotation) — latent

**File:** `frontend/src/hooks/use-keyboard-visibility.ts:27-36`

The baseline only re-anchors when `vv.height >= baseline`. A >120 px shrink that is *not* a
keyboard (portrait→landscape on a tablet: 1024→768) sets `keyboardVisible=true` permanently —
it can never recover until the viewport exceeds the stale baseline. Currently harmless only
because **no consumer is wired** (see F-2); MobileNav's in-file copy of the same pattern
shares the flaw. The paired `[@media(max-height:480px)]:hidden` CSS fallback masks phone
landscape but not tablets.

**Fix:** also re-anchor on `orientationchange`, or treat a shrink that persists >N seconds
without an `interactive-widget` resize as a re-anchor (or debounce-persist the baseline).

---

### F-8 · P3 — "44px tap-target sweep" is incomplete: product-page coupon validate/clear buttons remain 36px

**File:** `frontend/src/pages/product.tsx:1444-1459` (`h-9 px-3` coupon clear/validate buttons)

The sweep raised filter chips, checkout coupon pair, copy buttons, CTA recipe etc. to
min-h-11/h-11/h-12, but the product page's own `CouponField` secondary buttons kept
`h-9` (36 px) — under the 44 px floor the report claims was swept. Pre-existing classes
retained (not a regression), but the claim overstates coverage on the very page R116
overhauled.

**Fix:** `h-9` → `min-h-11` on both buttons (and match the input's height), or accept and
amend the claim.

---

## VERIFIED-OK (with evidence)

1. **dialog.tsx deletion — clean.** Only consumer was TopupWaitingModal
   (`git grep 47b304e`: TopupWaitingModal + 2 test files). Migrated to shared
   `AppDialog` (TopupWaitingModal.tsx:12) which is Radix-based: ESC/overlay/pointer guards
   (app-dialog.tsx:120-124), `aria-modal` (127), focus trap + scroll lock from Radix
   primitives, 44 px close with `aria-label="إغلاق"` (170-179), `dismissable` mutation guard.
   Zero remaining imports of `components/ui/dialog` (grep: only comment mentions). Old
   dialog tests folded into `topup-waiting-modal-aria.test.tsx` / rewritten
   `dialog-mobile.test.tsx` — both pass.
2. **sonner lazy + replay bridge — works and can't duplicate.** Built entry
   (index-D3kUydO3.js, 27.07 KB gz) contains **no sonner runtime** (only the dynamic-import
   map); sonner core rides lazy chunk index-DTMLXFjJ.js (9.5 KB gz) pulled by
   sonner-C-z4WBkh.js / use-toast-BIfj6YlO.js / admin-session-BczyWrXi.js (each ~0.5-0.7 KB
   gz wrappers). The bridge (sonner.tsx:46-66) filters dismiss-shaped entries
   (`!"title" in active`), spreads the stored payload whole, and **preserves ids** — sonner
   upserts rather than stacks, so replays update instead of duplicating;
   `toaster-lazy-replay.test.tsx` pins no-duplication, variant/type, and action-button
   retention. `IdleToaster` mounts outside AuthGate (boot-window toasts render during the
   splash) but inside ThemeProvider (App.tsx:833-840) with cancel/cleanup on unmount
   (App.tsx:785-797) — pinned by `idle-toaster-gating.test.tsx`.
3. **Toast-shim double-wrap fix — correct.** `helperInput` (use-toast.ts:131-146) treats a
   non-element, non-array object as the sonner opts bag and anything else as the legacy
   positional description; ReactNode elements (`isValidElement`) and arrays are never
   mistaken for bags. Severity durations (8 s destructive/warning) retained
   (use-toast.ts:76-81). No caller uses `toast.loading`/`toast.promise`/external `dismiss`
   (grep) — the shim's API surface covers all 30 `useToast()` callers.
4. **auth.tsx Firebase gating — no login regression, no flicker.** `isFirebaseBackedUser`
   (auth.tsx:123-140) accepts `firebase*` providers and linked `firebase.com`/`google.com`
   identities only; WhatsApp/Telegram/guest boots never arm the refresher (pinned by
   `auth-firebase-gating.test.tsx`: guest/WhatsApp/Telegram never call
   `setupFirebaseTokenRefresh`; Google arms once after the 2 s deferral). The Google *button*
   path imports firebase/auth on click, and the refresher was boot-armed only even pre-R116,
   so the "mid-session sign-in arms on next reload" note is parity, not a regression.
   `installedRef` prevents double-arming across the verdict flip (484-488). Rotation uses
   `setTokenSilently` — no `/me` invalidation flicker (218-220). Admin guard unaffected:
   `setAdminToken` removes every admin-scoped query incl. the new `["admin","session","guard"]`
   key (258-274 + App.tsx:377-385).
5. **Boot probes timeout.** 10 s `AbortSignal.timeout` on both probes with a safe degrade to
   unbounded on old engines (auth.tsx:82-99); `Promise.allSettled(...).finally` guarantees
   `initializing=false` even on abort rejection (462-464) — pinned by the A5-2 tests.
6. **Admin session guard (A5-3).** `/admin/login` stays public (App.tsx:704, registered
   before the catch-alls); the guard's session check is TanStack-owned (staleTime 5 min,
   `retry:false`), renders the admin skeleton instead of the old blank div, and 401/403 →
   `setAdminToken(null)` + navigate (App.tsx:406-446). requireAdmin reads the `admin_token`
   cookie before the bearer (backend/src/middlewares/requireAdmin.ts:33-35), so the sentinel
   header is harmless. Relative `/api/admin/session` is bridged in split deployments by
   `installApiFetchBridge()` (main.tsx:57, api-config.ts).
7. **admin-session dynamic import (A5-12).** user-session.ts no longer statically imports
   admin-session or the toast shim; the first admin-URL 401 defers through a cached ref
   (user-session.ts:160-174). The shared client's `UnauthorizedHandler` returns **void**
   (custom-fetch.ts:35) — the `return false` on the deferred path is unobservable, and
   admin-session's own 15 s dedupe (admin-session.ts:59) absorbs the queued burst. Build
   confirms admin-session is a separate async chunk, absent from the entry modulepreloads.
8. **wallet whole-dinar topups — honest and consistent.** Min 1 LYD with matching copy
   (wallet.tsx:976-979); blur + submit both `Math.round` to whole dinars (986, 1355-1366,
   1626-1636); `transferCode` uses the same `Math.round` (transfer-code.ts:45-49) so the
   dialed USSD amount always equals the submitted amount (old `Math.floor` mismatch closed);
   submit-time normalization **rotates the Idempotency-Key** under the post-normalization
   fingerprint (987-996) so a fractional intent can never be replayed; presets all ≥1.
   `wallet-money-gates.test.tsx` pins 0.009/0.01 rejections, 1.6→2 / 1.4→1 snaps, and blur
   rounding; `transfer-code.test.ts` pins round-vs-floor. Backend accepts `>0` (routes/
   wallet.ts:278) — client stricter, copy honest.
9. **Wallet live socket updates.** Page-scoped `useSocket(me?.id)` riding the shared `/me`
   key (wallet.tsx:660-674); `topup-updated` invalidates `getListTopups`+`getGetWallet`
   (use-socket.ts:99-122) so the waiting modal auto-transits in-page even after dismissal;
   waiting-modal poll is foreground-only (TopupWaitingModal.tsx:98,
   `refetchIntervalInBackground:false`) preserving the R104 sleep economics.
10. **Waiting-modal 10 s close.** `canDismiss = status!=="waiting" || timedOut || elapsed>=10`
    (TopupWaitingModal.tsx:125-126); ESC/backdrop/close all gated via AppDialog's
    `dismissable` (app-dialog.tsx:77-82,170-179); countdown is a cosmetic timer decoupled
    from the 30-min SLA copy (263-272). Pinned by `topup-waiting-modal-aria.test.tsx`
    ("locks close actions for the first ~10 s").
11. **checkout balance via shared cache.** Duplicate `/api/auth/me` fetch removed; balance
    now observes the seeded `useGetMe` key; unknown/failed balance renders `—` + warning,
    never a fabricated 0 / false "insufficient" verdict (checkout.tsx:507-527). Coupon
     per-line math is pre-existing (98-F2) and untouched; hydration guard unchanged.
12. **variant_label chips.** orders.tsx:383-391 and order-detail.tsx:314-321 render the chip
    null-safely (legacy pre-variant orders show nothing); backend serves `variant_label`
    (backend/src/routes/orders.ts:65) and the field is in the generated schema
    (api.schemas.ts:423,562).
13. **admin/orders credentials-on-demand (B6-03).** List rows carry `has_credentials` only;
    plaintext comes from audited `GET /orders/:id/credentials` (backend routes/admin/
    orders.ts:210) fetched once per order id with cache + failed-set + in-flight guards
    (admin/orders.tsx:223-253, 306-316); desktop row, mobile card, and loading/failure
    states all handled (1245-1262, 1405-1436); `orders-row-expansion-a11y.test.tsx` updated
    to the fetch boundary.
14. **index.css.** Light `--shadow-2xl` defined (index.css:330-338) completing the light
    step-down (the dark value was leaking under white dialogs); light `--status-error/info/
    low-stock` darkened to AA with measured ratios documented (277-296); dead
    `--popover-*`/`--sidebar-*` families deleted with **zero** remaining `var(--popover|
    --sidebar)` / `bg-popover` / `bg-sidebar`-class references (grep clean);
    `statusColor()` removed from utils.ts and all 8 render sites (orders, order-detail,
    wallet ×2, home, admin/topups, admin/dashboard, admin/orders) migrated to
    `StatusBadge`+`STATUS_TONE` — `status-tokens.test.tsx` + full suite green.
15. **vite.config.** `manualChunks` untouched in this range (only the font-preload regex
    gained arabic-600, A5-10). Build output verified: exactly the 4 LCP woff2 faces
    preloaded; entry modulepreloads are only vendor-react/icons/utils/router/query — no
    sonner/admin-session/firebase eager. Code-splitting assumptions intact (lazyWithRetry
    routes all resolve to per-page chunks; build clean, PWA precache generated).
16. **index.html.** Static og:image:width/height + twitter:card baseline (46-52) with
    MetaTags runtime upserts of the same tags (MetaTags.tsx:157-173); no-JS copy changed to
    the neutral «يتطلب الموقع تشغيل JavaScript» (149) — honest (JS-less ≠ offline),
    `main.tsx:41` still removes the node on every successful boot;
    `pwa-offline-shell.test.ts` updated and passing.
17. **Suite / toolchain.** `vitest run`: **108 files, 747 tests, 0 failed** (matches the R116
    report's own baseline). `tsc --noEmit`: clean. `vite build`: clean. All 9 claimed new
    test files exist and pin the claimed behaviors (idle-toaster-gating, route-change-focus,
    toaster-lazy-replay, use-keyboard-visibility, auth-firebase-gating, transfer-code,
    product-legacy-shape, wallet-statement, pwa-offline-shell) — with the coverage gaps
    called out in F-2/F-3 (hook tested in isolation; no DOM-order pin).
18. **Misc sweep verified.** Orders filter chips min-h-11 + «مُسترد / فشل» info tone with
    `Undo2` (orders.tsx:261-272); checkout coupon pair h-11 (1259-1272); order-detail copy
    min-h-11 with -my-3 rhythm (322-329); admin nav badge contrast (layout.tsx:157-166);
    topup reviewer attribution `reviewed_by/reviewed_at` (admin/topups.tsx:1130-1139);
    formatDate unification (risk/security pages); FlashSaleBanner exhaustive-deps fix
    (ends_at primitive, FlashSaleBanner.tsx:121-154); ProductCard on shared Button +
    exported CATEGORY_ACCENT/ICON reused by flash-sales (convergence); `text-white` →
    `text-primary-foreground`/`text-destructive-foreground` token cleanups (tokens exist,
    index.css:62,188,318); checkmark glyphs dropped from toasts (Arabic copy ledger).

---

## CLAIMS vs REALITY (R116 report)

| Claim | Verdict |
|---|---|
| Product page desktop 2-column split | ✅ real (lg grid + sticky panel), but see F-1 (mobile padding) & F-3 (DOM order) |
| Mobile DOM byte-identical via flex order | ❌ **false** — visual order yes, DOM/reading/Tab order changed (F-3) |
| Whole-dinar topups + USSD match | ✅ verified end-to-end (form, blur, submit, transferCode, tests) |
| variant_label chips in orders | ✅ |
| Wallet live socket updates | ✅ |
| Waiting-modal close at 10 s | ✅ |
| 44px tap-target sweep | ⚠️ mostly true; product coupon buttons still 36 px (F-8) |
| Route-change focus management | ✅ works (tests), with edge cases F-4/F-5 |
| --shadow-2xl light fix / light status tokens AA / statusColor retired / dead tokens | ✅ all verified (grep + measured comments + suite) |
| sonner lazy + replay bridge (entry −8.7 KB gz) | ✅ lazy verified in build; entry is 27.07 KB gz with no sonner; replay id-safe |
| admin-session dynamic import | ✅ (deferred first admin-401 is return-value-invisible + deduped) |
| Firebase init gated | ✅ (guests/WhatsApp/Telegram never arm; tests pin) |
| toast-shim double-wrap fix | ✅ (minor latent drop of exotic sonner opts, F-6) |
| keyboard visibility hook | ⚠️ hook exists + tested, but **not wired to the sticky bar** (F-2) |
| dialog.tsx deleted (consolidated) | ✅ consolidated into ui/app-dialog, zero stale imports |

## NEXT ACTIONS (priority order)

1. **F-1** — ship the `max-lg:px-5` padding fix for the six buy-panel blocks (small, purely
   additive classes; biggest visible win for the mobile majority).
2. **F-2** — wire `stickyBarHiddenByKeyboard` into the sticky bar + add the wiring test.
3. **F-3** — decide DOM-order strategy for the FAQ block + add a mobile DOM-order contract
   test.
4. F-4/F-5 — ScrollToTop same-route-rewrite suppression; announcer old-title skip.
5. F-6/F-7/F-8 — opt-forward in `helperInput`, orientation re-anchor, coupon button min-h-11.
