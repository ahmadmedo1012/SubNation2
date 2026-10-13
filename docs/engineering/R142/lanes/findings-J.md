# Lane J — Accessibility / RTL / Localization / Design System (R142)

Task 142-J1 · read-only audit @ a9f5e83 · primary: `frontend/src/index.css`, `frontend/src/components/ui/*`, `frontend/src/hooks/*`, `frontend/DESIGN.md` + cross-cut RTL/a11y/availability review of storefront surfaces.

**Excluded per charter:** finding F1 (GuestHero.tsx:213 aria-label «ويندوز 10 — متوفر الآن» from category-level stock) — its CLASS was audited elsewhere instead (→ J-3, J-7).

**Coverage:** 31/31 inventory files deep-read (0 BLOCKED) + 36 cross-cut files. See `J.coverage.jsonl`.

---

## Findings (ranked)

### J-1 · P2 · Destructive confirm button fails AA — raw `--destructive` instead of `--destructive-surface`
**Where:** `frontend/src/hooks/use-confirm.tsx:132-135` (live: `pages/cart.tsx:127` clear-cart, `pages/profile.tsx:206`, `components/SessionManager.tsx:96`, 10+ admin confirm sites) · second case `frontend/src/components/admin/topups/RejectModal.tsx:94-101`.
**What:** R128 (A1-F2) created `--destructive-surface` (dark `0 80% 52%`) because white ink on the raw `--destructive` channel (`0 80% 58%`) computes **3.99:1 ≈ 4.00:1 — AA fail** (computed this round, see table). `button.tsx:19` migrated its `destructive` variant to the surface token, but the shared confirm dialog never did: `className={state.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}`. twMerge keeps the default variant's `border-primary-border` + `shadow-md shadow-primary/25` under the red fill (verified by running twMerge on the merged class string), so the "destructive" confirm also carries a crimson border + crimson glow shadow. `RejectModal.tsx:95` hand-rolls the same raw class at `h-9` (36px) while its approve twin (useConfirm) enforces `min-h-11` 44px — the money-path floor.
**Case:** dark theme (default), «إفراغ السلة؟» confirm: white 14px semibold text on `hsl(0 80% 58%)` = 4.00:1 < 4.5:1. Every destructive confirmation in the app (the exact dialog class R128-A1-F2 fixed) regresses the fix.
**Minimal fix:** use-confirm.tsx:132 → `cn(buttonVariants({ variant: "destructive" }), "min-h-11")` for the destructive branch (one line; inherits the AA surface + correct border/shadow); RejectModal.tsx:95 → `variant="destructive"` + `min-h-11`. The existing pin `cart-undo-clear.test.tsx:281` (`toContain("bg-destructive")`) still passes against `bg-destructive-surface` — no test churn.
**If skipped:** every destructive money decision renders sub-AA white-on-red in the default theme.

### J-2 · P3 · Button focus ring renders a WHITE offset gap in dark theme + the "ONE focus system" contract is drifted
**Where:** `frontend/src/components/ui/button.tsx:8` (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1` — no offset color) · same class at `frontend/src/components/ProductCard.tsx:772`.
**What:** Tailwind v4's default `--tw-ring-offset-color` is `#fff` (verified in the installed `tailwindcss@4.2.1` dist: `S("--tw-ring-offset-color","#fff")`). `input.tsx:35`, `switch.tsx:12` and `CopilotComposer.tsx:36` all explicitly set `ring-offset-background`; the two Button sites do not — so on the default dark theme every keyboard-focused Button draws its crimson ring separated from the surface by a **1px white halo** (and on a crimson `bg-primary` button: crimson-fill / white-gap / crimson-ring). Additionally, FINAL_UX_SYSTEM.md §2 says "ONE system — the global focus-visible outline … never introduce competing ring styles" and DESIGN.md says "Don't introduce a second focus system" — but the primitives suppress the global outline and hand-roll **five different recipes** (button ring-2/offset-1; input ring-2/offset-1 + `border-primary/45`; switch ring-2/offset-2; ProductCard ring-2/offset-1; `RejectModal.tsx:118` `focus:ring-1 ring-destructive` — a focus- (not focus-visible) destructive-colored 1px ring on a textarea).
**Case:** Tab to any Button (e.g. «اشترِ الآن» on the PDP) in dark mode: visible white sliver between the button edge and the focus ring; the focus indicator itself remains visible (crimson, 3.98:1), so this is a visual-contract defect, not a focus-visibility loss.
**Minimal fix:** add `focus-visible:ring-offset-background` to `button.tsx:8` and `ProductCard.tsx:772` (two classes). The deeper contract reconciliation (one ring recipe vs the global outline) is a design decision for a write round — smallest honest step is the offset color.

### J-3 · P3 · F1-CLASS · SEO meta description claims «متوفر … تسليم فوري» for out-of-stock products
**Where:** `frontend/src/components/product/product-seo.ts:52-56`.
**What:** the description fallback chain is `seo_description || description || \`${product.name} متوفر بالدينار الليبي على SubNation. تسليم فوري بعد الدفع.\``. The hardcoded fallback claims availability + instant delivery for **any** product whose curated fields are empty — including OOS products — while the SAME payload's JSON-LD Offer (line 75, `isAvailable: product.is_available`, the D2-F2/R111 fix) asserts `OutOfStock`.
**Case:** OOS product, empty `seo_description`+`description`: Google snippet / WhatsApp unfurl says «…متوفر…تسليم فوري بعد الدفع» while the page renders «نفد المخزون» and the structured data says OutOfStock — the same brand-availability-from-nothing class as F1, at the crawler surface.
**Minimal fix:** gate the fallback on availability — `product.is_available ? "متوفر بالدينار الليبي…" : "اشترك … بالدينار الليبي على SubNation"` (or drop «متوفر/تسليم فوري» from the static string). One ternary in one file.

### J-4 · P3 · Missing test · `button.tsx` — the app's base primitive has zero a11y behavior tests
**Where:** `frontend/src/components/ui/button.tsx` (census: `input.tsx`, `label.tsx`, `load-more-button.tsx` also untested; Button is the one that matters).
**What:** every other interactive primitive is pinned — switch (`switch-rtl.test.tsx`), app-dialog, fetch-error-card, status-badge, Skeleton family, route-skeleton, sonner, alert-dialog (via `use-confirm.test.tsx`'s role/ESC/focus pins). Button has only two string-content assertions inside admin visual tests. Its `focus-visible:outline-none` + ring substitution (J-2) is exactly the unpinned surface: deleting `focus-visible:ring-2 focus-visible:ring-ring` while keeping `outline-none` makes **every button in the app invisible to keyboard users** with zero failing tests; the same applies to the `min-h-9` tap floor and the variant token composition.
**Minimal fix:** one small test in the `components/__tests__/` idiom — render `<Button>`, assert the class string contains `focus-visible:ring-2`, `focus-visible:ring-ring` and (post-J-2) `focus-visible:ring-offset-background`, plus a destructive-variant assertion that `bg-destructive-surface` beats any later `bg-destructive` override (regression pin for J-1's class).

### J-5 · P4 · Native search-cancel hidden globally with no replacement clear affordance
**Where:** `frontend/src/index.css:988-990` (`input[type="search"]::-webkit-search-cancel-button { @apply hidden; }`) · affected fields: `components/home/CatalogFiltersBar.tsx:84` (storefront), `components/admin/users/UsersToolbar.tsx:56`, `components/admin/topups/TopupsToolbar.tsx:65`.
**What:** the global rule removes WebKit/Blink's one-tap clear from every `type="search"` field for visual consistency, and none of the three fields renders a custom clear button — on iOS/WebKit a user who typed a long query must backspace it character-by-character (the native button was also keyboard-operable).
**Minimal fix:** in CatalogFiltersBar, render an `X` button (`aria-label="مسح البحث"`, `min-h-11 w-11`) positioned at the inline-end when `searchInput !== ""`, clearing + committing; drop the global rule or scope it to fields that carry a replacement.

### J-6 · P4 · Light-theme button boundaries collapse (computed borders clamp to white)
**Where:** `frontend/src/index.css:131-132` (`--opaque-button-border-intensity: 9`, defined in `:root` only) vs `.light` block 282-411 (no override) · consumers `button.tsx:22` (`border-secondary-border`), 259-274 (`--secondary-border`/`--muted-border`/`--accent-border`).
**What:** the computed border tokens are `hsl(from hsl(var(--secondary)) h s calc(l + 9))`. In light mode `--secondary` is `220 14% 93%` → `calc(93% + 9%) = 102%` → **clamped to 100% = pure white**. So a light-theme secondary Button gets a white border on the white card, and its fill (93% L) is ~1.09:1 against the card — no ≥3:1 boundary (WCAG 1.4.11 non-text) identifies the control; the outline variant's `--button-outline` = `rgba(0,0,0,0.1)` ≈ 1.08:1 is the same. Dark mode is fine (15% fill + 24% border). Light theme is user-reachable (Navbar toggle, `lib/theme.ts`).
**Minimal fix:** one line in the `.light` block: `--opaque-button-border-intensity: -9;` (darken in light, mirroring dark's lighten — clamps at 84% → visible `#3d4653`-family edge) — or define light `--secondary-border` explicitly as `var(--border)`.

### J-7 · P4 · F1-CLASS · PDP stock pill stays «متوفر (N)» while the selected variant flips to «نفد»
**Where:** `frontend/src/pages/product.tsx:214-223` (selection) · `frontend/src/components/product/PriceStockPanel.tsx:54-75` (the pill).
**What:** the PDP availability chain is product-level everywhere (pill `product.is_available/stock_count`, CTA gate `product.is_available`, JSON-LD, cart snapshot — internally consistent, and the default/fallback selection is availability-aware: `sortedVariants.find(v => v.is_available)`). But an **explicitly** selected variant is found by id with no availability check — if a refetch flips it OOS while the product still has stock, the duration pill renders disabled + «— نفد» while the stock pill still announces «المنتج متوفر، الكمية N» (aria-live role=status) and the CTA stays «اشترِ الآن». The pre-buy re-quote (R115-I1) aborts the charge, so no wrong money — an on-screen contradiction only.
**Minimal fix:** one predicate in the chosen lookup (`sortedVariants.find(v => v.id === selectedVariantId && v.is_available) ?? sortedVariants.find(v => v.is_available) ?? sortedVariants[0]`) so a stale explicit selection falls back like the initial one.

---

## Token inventory (index.css single-source verification)

| Family | Dark `:root` | Light `.light` | Single-sourced | Notes |
|---|---|---|---|---|
| Surfaces base/card/overlay | 5%/8%/12% | 96%/100%/100% | ✓ | ladder complete both themes |
| background/foreground/card/border/input/ring | ✓ 125-230 | ✓ 354-394 | ✓ | ring == primary both themes |
| primary / primary-text / primary-foreground | 348 80% 48/65/100 | 46/**43**/100 | ✓ | R129-A2 ink split verified 5.25/4.60 |
| secondary/muted/accent + foregrounds | ✓ | ✓ | ✓ | computed borders derive via intensity (J-6) |
| destructive / **destructive-surface** | 58% / **52%** | 48% / 48% | ✓ | surface pair = R128-A1-F2; bypassed at J-1 sites |
| status-success/-warning/-error/-info/-low-stock/-purple | ✓ 162-179 | ✓ 347-352 | ✓ | one status source; toast variants compose the same tokens |
| status-success-surface | 152 65% 30% | 152 60% 28% | ✓ | |
| tier-bronze/silver/gold/platinum | ✓ 224-227 | ✓ 388-391 | ✓ | gold aliases status-warning (cascades) |
| cat-* (9) | ✓ 152-160 | ✓ 320-328 | ✓ | gaming/productivity retired but defined (admin-preview) |
| brand marks (whatsapp + ink) | `@theme` 98-99 | theme-independent | ✓ | documented AA ink pair |
| text scale | `--text-2xs/3xs = 11px` | same | ✓ | floor holds repo-wide; only recharts `fontSize:10` (sanctioned) |
| radii | `--radius .75rem` + sm/md/lg/xl | same | ✓ | DESIGN.md 7-step scale matches |
| shadows | 2xs…2xl 244-252 | ✓ 396-410 incl. 2xl (R116-S1 fix present) | ✓ | |
| fonts | Readex Pro 400/600/700 only | same | ✓ | zero `font-medium`/`font-black` in src |
| z-layers | NOT tokens — documented census (10/30/40/45/50/60/100) | — | ✓ honored | sole undocumented literal: elevation `::after` z-999, scoped inside a forced `z-index:0` stacking context (index.css:1059-1071) — contained, but an invented value |
| quiet-premium vocabulary | `ambient-wash` / `hairline-glow` / `dot-grid` | rides hsl vars | ✓ defined exactly once each | `.text-gradient`/`.cta-glow` confirmed deleted (comments only, index.css:812/905) |
| reduced-motion | global kill-switch 1198-1209 + sonner 1506-1511 | — | ✓ complete | covers keyframes + transitions + scroll-behavior |

**Hardcoded colors in `ui/*`: zero** (grep `#[0-9a-f]{3,8}` → no matches). The only raw literals in index.css are toast shadow neutrals (`hsl(0 0% 100% …)`, documented).

## RTL escape list (physical properties — adjudicated)

**Intentional / correct-in-RTL (no action):**
- `orders.tsx:87-90,539` `border-r-[3px]` status accents — documented decision (physical on both directions, reading-start edge in RTL).
- `category.tsx:305,353,414` / `GuestHero.tsx:96` / `AuthedHero.tsx:32` / `notifications.tsx:337` / `NotificationBell.tsx:639` — `absolute right-0` 1px start-edge accents = the R125-I7 stripe language (start = right in RTL).
- `terms.tsx:26` `border-r` heading rules — same idiom, documented.
- Centering pairs `left-1/2 -translate-x-1/2` / `left-[50%] translate-x-[-50%]` / `left-0 right-0` (alert-dialog, app-dialog, MobileNav:104, product.tsx:713, flash badges) — direction-neutral.
- LTR islands `dir="ltr"` + `text-left` (+ `lang="en"`): order-detail.tsx:74, referrals.tsx:376, profile.tsx:368/420, ReferralBox.tsx:66, ConvertPointsCard.tsx:112, ErrorBoundary `<pre>` — correct for Latin codes/digits (118 `dir="ltr"` islands repo-wide).
- `text-right` on Arabic blocks (orders.tsx:636, order-detail.tsx:457, Footer.tsx:130, CatalogFiltersBar option rows) = inline-start in RTL ✓.
- Search icon `right-3` + `pr-9` (CatalogFiltersBar:82/131), select chevron `left-2` + `pr-8 pl-7` (:178-200) — start/end placement correct for locked-RTL doc.
- `scroll-fade-rtl-start` (GuestHero:206) masks the LEFT 2.5rem = the RTL scroll-forward edge — correct; `scroll-fade-rtl` fades both edges.
- `space-x-2` (alert-dialog:62) — Tailwind v4 emits `margin-inline-start` (verified in 4.2.1 dist) → RTL-safe.
- `switch.tsx:26` thumb `rtl:-translate-x-4` — documented + test-pinned.
- Icon direction contract §5.1 spot-verified: back = `ArrowRight` + `translate-x-0.5` (order-detail:330), forward = `ChevronLeft` + `translate-x-[-2px]` (orders:663), `Send` mirrored at all 5 sites (`-scale-x-100` ×4 + `rtl:-scale-x-100` in CopilotComposer).
- Badge idiom `-left-0.5/-left-2` (Navbar:732, NotificationBell:404, MobileNav:240) — inline-end badge corner, consistent across the three.

**Harmless leftovers (cosmetic, no user impact):** `Skeleton.tsx:194` `text-right` on a text-less div (should be `text-start` by idiom); `RejectModal.tsx:99` `ml-1.5` icon gap (physical, RTL-correct by accident — admin tracked-debt family).

**Scrollbar/overflow:** `scrollbar-none` + thin themed scrollbar; `overflow-x: clip` with `@supports` fallback; shimmer sweep direction-reversed under `[dir="rtl"]` (index.css:696-698) — all correct.

## A11y primitives verification

- **Focus-visible:** global 2px `--ring` outline + offset (index.css:936-942); keyboard-only; contrast 3.98:1 dark / ≥4.82 light vs surfaces — ≥3:1 non-text ✓. Primitive deviations → J-2.
- **Tap floor:** `.touch-target` 44px utility; alert-dialog Action/Cancel `min-h-11` (44px); app-dialog close `h-11 w-11`; fetch-error retries `min-h-11`; VariantSelector pills `min-h-11`; history rows `min-h-11`; ProductCard quick-add 44px on `hover:none`. Button's own sm/default = 32/36px (documented scale; call sites own the 44px storefront standard). Exceptions: RejectModal h-9 money-path (J-1), LoadMoreButton default h-9 (admin family; storefront sites pass min-h-11).
- **sr-only:** 32 usages / 20 files (skip-link, skeletons, toasts via library labels, icon-only buttons).
- **aria correctness:** dialogs (Radix + explicit `aria-modal` in app-dialog:127 / NotificationBell R133), alert-dialog via Radix (pinned), sonner `containerAriaLabel`/`closeButtonAriaLabel` in Arabic, VariantSelector `role=group` + `aria-pressed` (A4-F2 honest no-arrow-key decision), search combobox `aria-expanded/controls/autocomplete=list` (R134), live regions: skeletons `role=status`, errors `role=alert`, stock pill `role=status aria-live=polite`, cart/balance announcements (r140, test-pinned).
- **Keyboard operability:** every ui primitive is a native control or Radix (ESC/focus-trap/scroll-lock); use-confirm focus-return pinned on all close paths; keyboard-visibility + `[@media(max-height:480px)]:hidden` CSS fallback.
- **Reduced motion:** global wildcard kill-switch reaches every keyframe/transition incl. sonner (verified 1198-1209, 1506-1511); `use-on-screen` pauses ambient loops; entrance fill-mode `backwards` so reduced-motion still lands content visible.
- **Landmarks (cross-cut, lane C owns):** complete — skip-link z-100 admin-inclusive, `main#main-content` tabIndex=-1, labeled nav landmarks (desktop/mobile/breadcrumb/footer ×2), header/footer, admin nested-main already fixed (R-140-l).

## Contrast spot-check (26 pairs, computed WCAG relative-luminance + alpha compositing)

| Pair | Ratio | Floor | Verdict |
|---|---|---|---|
| D foreground / background | 18.71 | 4.5 | PASS |
| D foreground / card | 17.75 | 4.5 | PASS |
| D muted-foreground / card | 8.02 | 4.5 | PASS |
| D muted-foreground / background | 8.45 | 4.5 | PASS |
| D primary-text / card | 5.76 | 4.5 | PASS |
| D primary-text / primary/15 tint @card | 5.25 | 4.5 | PASS (claim ≥4.6 ✓) |
| D status-error / error/15 @card | 4.63 | 4.5 | PASS (R129-A2 ✓) |
| D status-error / error/12 @card (badge) | 4.82 | 4.5 | PASS |
| D status-success / success/12 @card | 7.71 | 4.5 | PASS |
| D status-purple / purple/12 @card | 4.80 | 4.5 | PASS (claim 4.80 ✓) |
| D white / **destructive-surface** (52%) | 4.52 | 4.5 | PASS (R128 claim 4.50 ✓) |
| D white / **raw destructive** (58%) | **4.00** | 4.5 | **FAIL → J-1** |
| D white / primary (toast action) | 4.93 | 4.5 | PASS (140-i F1 claim ✓) |
| D ring / background (focus) | 3.98 | 3.0 | PASS |
| D ring / overlay (focus) | 3.44 | 3.0 | PASS |
| D foreground / selection primary/40 @bg | 12.69 | 4.5 | PASS (claim 12.7 ✓) |
| D primary price (30px) / muted/20 @card | 3.69 | 3.0 | PASS (sanctioned large-text) |
| L foreground / background | 16.20 | 4.5 | PASS |
| L foreground / card | 17.81 | 4.5 | PASS |
| L muted-foreground / card | 6.68 | 4.5 | PASS |
| L primary-text / primary/15 @card | 4.60 | 4.5 | PASS (R129-A2 claim ✓) |
| L status-error / error/15 @card | 4.93 | 4.5 | PASS |
| L status-warning / warning/12 @card | 5.12 | 4.5 | PASS |
| L status-success / success/12 @card | 4.96 | 4.5 | PASS |
| L white / primary | 5.29 | 4.5 | PASS (claim 5.29 ✓) |
| L white / destructive-surface | 5.00 | 4.5 | PASS |

25/26 PASS — the r140 sweep's documented values reproduce exactly; the single failure is the J-1 bypass, not a token regression.

## Localization

- **Money:** all user-facing amounts ride `formatCurrency` (en-US grouping + 2 decimals + «د.ل»); no frontend G-6-class residual (seo-builders' plain `toFixed(2)` is schema.org's LD format; `fmtUsd` is the documented admin-only USD *cost* column). Known miss G-6 (`backend/src/routes/loyalty.ts:326`) is lane G's — not re-reported.
- **Dates:** single spine `formatDate`/`formatRelativeTime` pinned to `ar-LY-u-nu-latn` (Latin digits, Arabic months); zero bare `toLocaleDateString` callers.
- **Copy language:** all UI strings Arabic; Latin brand names wrapped `lang="en"` (WhatsApp/Google/Telegram, profile providers); mixed-language drift: none found. Sonner chrome labels localized (J-lane verified).
- **Numbers:** `tabular-nums` body-wide (index.css:457) + Western digits; codes/amounts `dir="ltr"` isolated (118 islands).

## Missing a11y tests (census)

| Primitive | Behavior test |
|---|---|
| button.tsx | **NONE** (string assertions only) → J-4 |
| input.tsx | none (minor) |
| label.tsx | none (trivial) |
| load-more-button.tsx | none (minor) |
| switch.tsx | switch-rtl.test.tsx ✓ |
| alert-dialog (via useConfirm) | use-confirm.test.tsx ✓ |
| app-dialog | app-dialog + dialog-mobile ✓ |
| Skeleton ×3 / route-skeleton | ✓ (3 suites) |
| sonner | toaster suites ✓ |
| status-badge | status-badge-v2 ✓ |
| fetch-error-card | r138 suite ✓ |

## Not checked / out of lane

- Recharts canvas rendering beyond token wiring (chart-theme.ts is index.css's declared co-truth; axis fontSize:10 adjudicated as the sanctioned exception).
- Live runtime probing (all findings verified against source at a9f5e83 + computed values; no browser session in this lane).
- Backend surfaces (G lane owns; the one cross-boundary item — loyalty.ts:326 — already logged as G-6).
- Admin raw-palette debt (~232 hits / 23 files) — tracked debt per FINAL_UX_SYSTEM.md §7; not re-counted (J-1/J-2's admin members are called out only where they hit the money-path AA/focus classes).
