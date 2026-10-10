---
version: alpha
name: SubNation
description: >-
  Dual-theme (dark-default) Arabic RTL e-commerce design system. Dark theme is
  the default (:root); light theme rides the .light class. Every value below is
  the computed equivalent of the HSL channel tokens in frontend/src/index.css —
  that file remains the single source of truth; DESIGN.md is the published
  contract for humans and design-aware tooling.
colors:
  # ── dark theme (default) ──
  background: "#0a0c10"
  surface: "#0a0c10"
  surface-card: "#101318"
  surface-overlay: "#181d25"
  foreground: "#f8fafc"
  on-surface: "#a0abba"
  border: "#232a34"
  primary: "#dc1840"
  primary-text: "#ed5e7b"
  on-primary: "#ffffff"
  secondary: "#1f252e"
  on-secondary: "#f8fafc"
  muted: "#1b2028"
  muted-foreground: "#a0abba"
  input: "#212731"
  ring: "#dc1840"
  error: "#ea3e3e"
  on-error: "#ffffff"
  success: "#2dd285"
  warning: "#f6aa28"
  info: "#3491f4"
  low-stock: "#f67a31"
  status-purple: "#a273f2"
  # ── R128 (A1-F2/F3): surface + tier families ──
  destructive-surface: "#e72323"
  status-success-surface: "#1b7e50"
  tier-bronze: "#f7b83b"
  tier-silver: "#acbac3"
  tier-platinum: "#75b0f0"
  # ── category accents (dark) ──
  cat-streaming: "#ad70eb"
  cat-music: "#42d791"
  cat-software: "#6c9ae5"
  cat-vpn: "#4cbcf0"
  cat-ai-tools: "#d87de8"
  cat-seo-tools: "#f0784c"
  cat-education: "#f5c147"
  cat-gaming: "#55a3f6"
  cat-productivity: "#f7b23b"
  # ── light theme overrides (.light) ──
  light-background: "#f3f4f7"
  light-surface-card: "#ffffff"
  light-foreground: "#14181f"
  light-border: "#dadce2"
  light-primary: "#d3173d"
  light-primary-text: "#d3173d"
  light-muted-foreground: "#535c6e"
  light-secondary: "#ebecf0"
  light-error: "#bb1b1b"
  light-success: "#1d724a"
  light-warning: "#885907"
  light-info: "#135eae"
  light-low-stock: "#ad460b"
  light-status-purple: "#5d22c3"
  light-destructive-surface: "#dc1818"
  light-status-success-surface: "#1d724a"
  light-tier-bronze: "#916308"
  light-tier-silver: "#586174"
  light-tier-platinum: "#135eae"
  # ── brand marks (theme-independent) ──
  whatsapp: "#25d366"
  whatsapp-ink: "#054339"
  google-blue: "#4285f4"
  google-green: "#34a853"
  google-yellow: "#fbbc05"
  google-red: "#ea4335"
  telegram: "#2aabee"
  # ── neutrals used by the elevation/shadow stacks ──
  black: "#000000"
  white: "#ffffff"
typography:
  # 11px is the Arabic readability floor (both micro tokens emit 11px);
  # nothing smaller ships. Weights are 400 / 600 / 700 only.
  micro-xs:
    fontFamily: Readex Pro
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: Readex Pro
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.55
  caption-bold:
    fontFamily: Readex Pro
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
  toast-description:
    fontFamily: Readex Pro
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: Readex Pro
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.7
  body-sm-semibold:
    fontFamily: Readex Pro
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.5
  body-sm-bold:
    fontFamily: Readex Pro
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.45
  body-md:
    fontFamily: Readex Pro
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.7
  body-md-bold:
    fontFamily: Readex Pro
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.4
  headline-sm:
    fontFamily: Readex Pro
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.3
  headline-md:
    fontFamily: Readex Pro
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.3
  headline-lg:
    fontFamily: Readex Pro
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.3
  headline-xl:
    fontFamily: Readex Pro
    fontSize: 30px
    fontWeight: 700
    lineHeight: 1.3
  display-sm:
    fontFamily: Readex Pro
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.2
  display-md:
    fontFamily: Readex Pro
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.2
  display-lg:
    fontFamily: Readex Pro
    fontSize: 60px
    fontWeight: 700
    lineHeight: 1.1
  # fluid heroes (clamp, rem bounds)
  fluid-2xl:
    fontFamily: Readex Pro
    fontSize: 2rem
    fontWeight: 700
    lineHeight: 1.3
  fluid-2xl-min:
    fontFamily: Readex Pro
    fontSize: 1.375rem
    fontWeight: 700
    lineHeight: 1.3
  fluid-3xl:
    fontFamily: Readex Pro
    fontSize: 2.9rem
    fontWeight: 700
    lineHeight: 1.25
  # technical / mono
  mono-sm:
    fontFamily: SFMono-Regular
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  mono-md:
    fontFamily: SFMono-Regular
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: 4px
  md: 8px
  lg: 10px
  xl: 12px
  2xl: 16px
  3xl: 24px
  full: 9999px
spacing:
  unit: 4px
  base: 12px
  card-padding: 16px
  section-gap: 24px
  touch-target: 44px
  mobile-nav-height: 60px
---

# SubNation Design System

## Overview

Quiet, coherent, trustworthy, fast — the SubNation look. Arabic-first RTL
e-commerce for the Libyan market (subnation.ly): dark theme by default, an
optional light theme, one brand accent (crimson `#dc1840`), nine category
accent hues, and a dense-but-calm data UI for the admin console. Nothing
decorative moves on its own; every animation answers "why does the user
benefit", and `prefers-reduced-motion` is a global kill-switch. The design
density is deliberately higher than a typical marketing site: money surfaces
(prices, balances, order codes) are always `tabular-nums` with Western digits
and a «د.ل» suffix, isolated with `dir="ltr"` where codes mix with Arabic.

## Colors

Two themes over one token spine. The **dark theme is the default** (`:root`);
the **light theme** applies via a `.light` class and every semantic token has
a light twin (the `light-` prefixed values above). Token authority lives in
`frontend/src/index.css`; the values here are their computed hex equivalents.

- **Primary (#dc1840 dark / #d3173d light):** the single interaction accent —
  primary buttons, links, focus ring, selection. As *text on dark surfaces*,
  always use the lighter `primary-text` twin (#ed5e7b / #d3173d): the surface
  value is for fills, not ink.
- **Status family (success/warning/error/info/low-stock/purple):** one token
  per state, consumed as `bg-<token>/12 text-<token> border-<token>/28` pill
  recipes (StatusBadge). Never hand-roll raw palette hues for status UI.
- **Category accents (9 hues):** per-product-category coding used by product
  cards and category heroes at low alpha tints (10–15%); each has a
  dark-tuned (lighter) and light-tuned (darker) value. gaming and
  productivity are currently retired categories.
- **Brand marks:** WhatsApp (#25d366 + its AA ink #054339), Google four-color
  logo, Telegram (#2aabee) are fixed identity colors — they do not theme.
- **Elevation:** depth comes from a surface ladder
  (base → card → overlay) plus neutral black shadows, never from colored
  glows — the only sanctioned colored light is the primary at 20–40% alpha on
  interactive elements (button/discount-badge glow).

## Typography

One family: **Readex Pro** (self-hosted, Arabic + Latin subsets), with
fallbacks `"Readex Pro", "Inter", sans-serif`. Exactly three weights ship —
400, 600, 700; `font-medium`/`font-black` are banned (they CSS-fallback to
the wrong weights). Line heights are Arabic-safe: 1.3 for headlines (Readex
Pro's tall ascenders clip harakat below that), 1.7 for running text.
Letter-spacing on Arabic script is always 0 — the global stylesheet collapses
all `tracking-*` utilities because tracking severs Arabic letter joins.

The type ramp is intentionally compact and dense: **11 → 12 → 14 → 16 →
18 → 20 → 24 → 30 → 36 → 48 → 60px** plus two fluid clamp steps for heroes
(`text-fluid-2xl` / `text-fluid-3xl`) and a single 13px step used only inside
the toast system's description/action-button chrome. 11px is the absolute
floor (both micro tokens emit it); the micro scale is a padding/icon scale,
not a type scale. Money and codes use the mono stack
(`SFMono-Regular, Menlo, Consolas, "Readex Pro", monospace`).

## Layout

RTL-first (`dir="rtl"` app-wide); logical properties (`ms/me/ps/pe`) for
anything new. A **4px spacing grid** (0.25rem Tailwind unit) with 12px as the
breathing unit; cards pad 16–20px; sections separate by 24px. Storefront
touch targets are ≥44px (`.touch-target`); the admin dialect allows ≥24px
edge buttons but keeps 44px money-path controls. The fixed mobile bottom nav
is 60px (the `--mobile-nav-h` token) and every clearance that must reserve
room for it reads that variable. `max-width: 320px` is the supported floor.

## Elevation & Depth

Tonal first: the surface ladder (#0a0c10 base → #101318 card → #181d25
overlay) does most of the hierarchy work, reinforced by 1px borders at
`--border`. Shadows are neutral black with a two-stop shape language
(shadow-sm … shadow-2xl), tuned per theme (dark shadows are heavier: 40–60%
black; light: 6–14%). Overlays (dialogs, toasts, drawer scrims) sit on a
backdrop blur + translucent surface. Colored shadow is reserved for the
primary accent at low alpha on interactive elements
(`shadow-primary/25–40`).

## Shapes

A seven-step radius scale: **4 / 8 / 10 / 12 / 16 / 24 / 9999px (full)**.
12px is the default card radius (`--radius`); 16px for large cards and
dialogs; `full` for pills, badges, and avatars. The toast system uses 16px
panels with 8–11px inner chips. No sharp corners except data-table cells and
full-bleed media.

## Components

- **Buttons:** primary = filled crimson (gradient `from-primary` →
  `primary/95`), white label, crimson glow `shadow-primary/25`; destructive =
  filled error red, white label; outline/ghost/secondary ride the neutral
  surface tokens. Sizes: 32 (sm) / 36 (default) / 48px (lg, the canonical
  money CTA). Press feedback is the spring scale-down (`press-spring`).
- **StatusBadge:** the single status-pill recipe (`bg-/12`, `text-`,
  `border-/28`), three padding sizes (xs/sm/md) whose *type* stays at 11–12px.
- **ProductCard:** category-tinted media tile (accent at 10–12% alpha),
  12px-above-title rhythm, 16px radius, hover = spring lift 3px + shine sweep
  (desktop only).
- **Toasts (sonner, custom skin):** 16px glass panels, 1px leading accent
  strip in the status token, translucent icon bubble at 14% alpha.

## Do's and Don'ts

- Do use `primary-text` (not `primary`) for crimson text on dark surfaces.
- Do compose status UI from the `--status-*` tokens only — no raw
  `emerald/red/blue/…` Tailwind hues in status maps.
- Don't use font weights other than 400/600/700.
- Don't use letter-spacing on Arabic text (the global sheet collapses it).
- Don't size text below 11px; don't add type steps outside the ramp without
  updating `frontend/src/index.css` and this file together.
- Don't use `transition: height/layout` properties or animate `blur`;
  transforms and opacity only. All motion must be covered by the global
  reduced-motion kill-switch.
- Do keep dark-context surfaces (scrims, footer, mobile nav) on the surface
  ladder so the AA-tuned foreground tokens stay valid.
- Don't introduce a second focus system — the global `:focus-visible`
  2px crimson outline is the only one.
