# FINAL UX SYSTEM — SubNation's design language (R115)

> The token-level contract for every screen. Code truth: `frontend/src/index.css`
> (Tailwind v4 CSS-first, single source) + `frontend/src/lib/chart-theme.ts`.

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
  banned); micro-type tokens `--text-2xs` (11px) / `--text-3xs` (10px) — no sub-10px
  text anywhere; money is always `tabular-nums` + Western digits + «د.ل» suffix;
  codes/amounts isolate with `dir="ltr"`.
- **Focus**: ONE system — the global focus-visible outline (no forced border-radius
  side effect). Never introduce competing ring styles.
- **Motion**: `press-spring` (press feedback), one-shot entrances (`page-in`, `float-in`,
  `slide-up`), skeletons shimmer, loaders spin. Decorative infinite loops pause
  off-screen (`use-on-screen` hook on every blob-drift site); the dead CSS (~90 lines of
  glow/glass/sweep effects) is deleted. Heavy GPU filters (animated blur) are banned.
- **z-index scale**: nav 10 / sticky 30 / overlay 45 / modal 50 / popover 60 / toast
  100. Inline zIndex values must not exceed the modal layer.

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

## 6. Admin dialect

Same tokens; density allowed (44px targets are the STOREFRONT standard; admin edge
buttons ≥24px AA); risk states are SAFE/WATCH/THIN/LOSS **with the reason text** —
never bare red/green; destructive bulk actions (recompute) require a dry-run preview
step; tier is displayed read-only (derived), points edits require a reason note.

## 7. Tracked debt (explicit, not silent)

Admin raw-palette remnants (system.tsx family, orange KPI border) · admin focus traps
for search/drawer · per-row refund button · IA regroup (Users/Referrals under
«الكتالوج») · sticky-thead inside overflow wrappers · `.card-enter` (0 consumers, kept).
