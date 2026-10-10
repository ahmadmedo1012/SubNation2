# FINAL UX SYSTEM — SubNation's design language (R115)

> The token-level contract for every screen. Code truth: `frontend/src/index.css`
> (Tailwind v4 CSS-first, single source) + `frontend/src/lib/chart-theme.ts`.
> Status: CURRENT @ 2026-10-10 (R128) — type floor, z-index scale, icon
> contract, and cross-surface conventions re-verified against code this round
> (R128-A1/A6/B8); the debt ledger below reflects what actually remains.

## 1. What "premium SubNation" means here

Quiet, coherent, trustworthy, fast. NOT flashy, gradient-heavy, animation-rich, or
generic-dashboard-looking. Every animation answers "why does the user benefit?";
`prefers-reduced-motion` is a global kill-switch (verified complete).

## 2. Tokens (index.css — the only source)

- **Theme**: dark default (`:root`) + `.light` overrides; `color-scheme` declared per
  theme; theme-aware toasts; charts read CSS vars via chart-theme.ts (zero hardcoded hex
  in recharts surfaces).
- **Status colors**: `--status-success/warning/error/info/purple` — the ONE status
  source; toast variants compose `var(--status-*)`; admin severity maps must migrate to
  these (remaining raw-palette uses are tracked debt).
- **Type scale**: loaded weights ONLY (400/600/700 — `font-medium`/`font-black` are
  banned); micro-type tokens `--text-2xs` (11px) / `--text-3xs` (11px) — **11px is
  the Arabic readability floor; no sub-11px text anywhere** (R120-B1 raised 3xs
  10→11px; the one sanctioned exception is recharts' canvas `fontSize: 10` axis
  ticks, invisible to the CSS ramp); money is always `tabular-nums` + Western
  digits + «د.ل» suffix; codes/amounts isolate with `dir="ltr"`.
- **Focus**: ONE system — the global focus-visible outline (no forced border-radius
  side effect). Never introduce competing ring styles.
- **Motion**: `press-spring` (press feedback), one-shot entrances (`page-in`, `float-in`,
  `slide-up`), skeletons shimmer, loaders spin. Decorative infinite loops pause
  off-screen (`use-on-screen` hook on every blob-drift site); the dead CSS (~90 lines of
  glow/glass/sweep effects) is deleted. Heavy GPU filters (animated blur) are banned.
- **z-index scale** (code truth, R128 census): 10 local stacking · 30 sticky
  bars + dropdowns · 40 scrims · 45 mobile sticky buy-bar · 50 the nav/modal
  family (Navbar, MobileNav, dialogs, drawers, bell panel — DOM order breaks
  ties inside the family) · 60 mobile-admin nav overlay · 100 top-of-stack
  (skip-link, NavigationProgress); toasts ride sonner's library default above
  everything. Inline zIndex must map to these documented layers, never invent
  new ones.

## 3. States — every important route

LOADING (skeletons shaped like the content, not spinners-in-the-void) · EMPTY (with
guidance, ≠ outage) · ERROR + RETRY (error card, ≠ empty) · STALE (keepPreviousData on
filter changes; checkout/product re-quote on money paths) · PENDING/DISABLED (money
buttons show WHAT is happening + unit progress) · money errors PERSIST (inline, never
toast-only). Outage must never render as the same screen as "no results".

## 4. Money-path UX contracts (pinned by tests)

- Displayed price == charged price: PDP re-quotes before single-buy (abort + honest
  toast on drift, fail-open on fetch error); checkout re-quotes on mount (98-F2).
- Old price strikes use the SELECTED VARIANT's base (never product-min).
- Refunds read as refunds (info-blue + amount receipt + points-reversal disclosure),
  never as failures.
- The wallet page shows the STATEMENT (every LYD movement) and the loyalty page the
  POINTS HISTORY — balances are explainable in the UI, not just in the DB.
- Welcome/referral promises match policy B exactly («عند اعتماد أول شحن») — the UI
  never promises money the backend does not deliver.
- Business constants come from the API (points_rate, tier_thresholds, referral_cost) —
  the frontend hardcodes NO monetary constant.

## 5. RTL + Arabic

`dir=rtl` app-wide; logical properties (ms/me/ps/pe) for anything new; Arabic copy uses
the app-standard forms (سجّل دخولك للشراء; … ellipsis glyph; consistent منتج/خدمة
terminology); Western digits everywhere; formatCurrency/formatCount are the only
formatters.

### 5.1 Iconography — the RTL direction contract (test-pinned)

RTL-always; the rule that audits keep re-checking, written down once:

- **Back points RIGHT** (`ArrowRight` for back CTAs; `ChevronLeft rotate-180`
  where a chevron is needed) — with hover motion matching (`translate-x-0.5`).
- **Forward points LEFT** (`ArrowLeft`, unrotated `ChevronLeft`) — «عرض الكل»
  links, pagination «التالية», KPI go-tos.
- **Breadcrumb separators are forward = unrotated `ChevronLeft`** (the R124-A1-F6
  decision change, pinned by `terms-legal-page.test.tsx`); they point toward the
  current page, not back up the trail.
- Accordions/dropdowns = `ChevronDown` rotators (never sideways arrows);
  `Send` icons mirror (`-scale-x-100`); `ExternalLink` is direction-neutral.
- **Size tiers** (de-facto scale, 2→12): 2–2.5 micro-badges · 3 inline-with-text ·
  3.5 dense admin buttons · 4 standard (`Button`'s `[&_svg]:size-4` default) ·
  4.5 card headings · 5 page headers · 7–10 empty-state/hero art · 12 splash.
- **Stroke-width**: lucide default 2 everywhere EXCEPT five sanctioned override
  families — sonner toast icons (2.4, prominence), MobileNav tabs (2.5 active /
  1.8 idle, weight-as-active-state), category-fallback art (1.6),
  TopupWaitingModal progress arcs (6), dashboard/system chart glyphs (1.5).
  A sixth override needs a reason comment in its family's style.

## 6. Admin dialect

Same tokens; density allowed (44px targets are the STOREFRONT standard; admin edge
buttons ≥24px AA); risk states are SAFE/WATCH/THIN/LOSS **with the reason text** —
never bare red/green; destructive bulk actions (recompute) require a dry-run preview
step; tier is displayed read-only (derived), points edits require a reason note.

## 7. Tracked debt (explicit, not silent)

Admin raw-palette remnants (~232 hits / 23 files, the light-theme AA gap —
quantified R128-A1 §2/F1, tracked there) · admin focus traps for search/drawer.

## 8. Cross-surface conventions (web · Telegram · WhatsApp · share cards)

The same message rendered on different surfaces keeps one voice but adapts
its chrome — the implicit policies, now written down (R128-B8):

- **Emoji density is channel-adaptive**: storefront = lucide icons, no emoji
  in UI copy; Telegram operator cards = rich emoji headers (💰✅❌🛒…);
  WhatsApp OTP = deliberately bare (code isolation — nothing competes with
  the 6 digits); web→WhatsApp referral shares adopt the WA idiom (🎬).
- **Brand-tail separator by context**: browser/SEO titles use
  «… | SubNation»; conversational and share-card surfaces use
  «… — SubNation».
- **Pending vocabulary**: the Telegram approval card and operator surfaces
  say «بانتظار الموافقة»; the wallet's own top-up rows say «قيد المراجعة»
  (documented at `wallet.tsx`); the generic statusLabel «قيد الانتظار» is
  for everything else.
- **Money format is one idiom everywhere**: en-US grouping + two decimals +
  Western digits + «د.ل» («1,380.00 د.ل») — the web's `formatCurrency` and
  (since R128) the backend's `formatLyd`/`formatLydNumber`
  (`backend/src/lib/money.ts`) render identically on every surface.
- **Registers split by audience**: customer surfaces are formal-polite MSA;
  Telegram operator cards are telegraphic field-lists — same vocabulary,
  different density.
