# R124-A3 — Visual design audit (storefront design system per craft-floor)

Repo: `SubNation2` @ `c736d13` (main). Scope: `frontend/src/index.css` (full), `components/ui/*`, `components/ProductCard.tsx`, `components/layout/*`, styling skim of `pages/{home,product,cart,checkout,wallet}.tsx` (+ adjacent storefront pages where a REFUSE rule demanded a look: `support.tsx`, `order-detail.tsx`, `login/onboarding/register.tsx`, `NotificationBell.tsx`).

Checklist = `skills/impeccable-repo/skill/reference/craft-floor.md` (+ `typeset.md`, `layout.md`). All contrast values below are **computed** (WCAG relative luminance, alpha composited over the actual surface), not quoted from comments. READ-ONLY audit — no code changed.

Theme model: dark = default (`:root`), light = opt-in via `.light` (index.css:112/244). Both themes audited.

---

## Findings

### 1. [P1] Light-theme category accents fail AA on their own badge tints (2 of 7 fail even 3:1)
**Evidence:** ProductCard.tsx:455–463 renders the category badge as `text-cat-X` on `bg-cat-X/10` at `text-3xs` (= 11px, index.css:103) over the white light card. Computed (token on its own /10 tint over `--card` light = white):
- `--cat-education` `42 90% 42%` → **2.50:1** (fails even the 3:1 large-text floor)
- `--cat-music` `152 60% 38%` → 3.15:1 · `--cat-seo-tools` `16 85% 46%` → 3.78:1 · `--cat-vpn` `199 80% 38%` → 4.03:1 · `--cat-ai-tools` `291 60% 48%` → 4.48:1 — all under 4.5:1 for 11px text
- Pass: streaming 5.59:1, software 4.99:1. Dark theme passes everywhere (4.97–9.29:1).

The `.light` block comment (index.css:261–262) claims "saturated mid-tones that keep readable contrast on white surfaces" — true for the large icon glyphs, never measured for the 11px badge text. Same class of miss the repo already fixed once for `--status-*` (R116-S1 comment, index.css:282–289: error/info/low-stock were darkened after measuring 3.52–4.46:1).
**Fix:** apply the R116-S1 method to the five failing light `--cat-*` values (target ≥4.5:1 on their /10 tint), same as `--status-*` got. **Effort: S.**

### 2. [P2] Browser surfaces half-themed: no `::selection`, no `caret-color`
**Evidence:** zero matches for `::selection|caret-color` in `frontend/src` (grep). The suite themes scrollbars (index.css:926–948, 4px webkit + `scrollbar-width: thin` FF), focus rings (`:focus-visible` 2px solid `--ring`, index.css:856–859), and tabular numerals globally (`font-variant-numeric: tabular-nums`, index.css:385) — but text selection paints the platform default blue and the caret is untouched. Craft-floor: "Text selection, the caret… theme them from the palette. This is the cheapest signal that a page was built rather than assembled, and the one models skip most reliably."
**Fix:** 3 lines in `@layer base`: `::selection { background: hsl(var(--primary)/0.4); }` (verify ≥3:1 against both themes' bg) + `caret-color: hsl(var(--primary-text))` on inputs. **Effort: S.**

### 3. [P2] `muted-foreground/80` secondary labels fail AA in light mode
**Evidence:** computed `--muted-foreground` light (`220 14% 38%`) at 80% alpha = **4.15:1** on the white card, **3.92:1** on `--background` — under 4.5:1 for the 11px `text-3xs font-bold` role it's used for: Footer section headings «الفئات»/«المساعدة والدعم» (Footer.tsx:49,72 — sits over the footer's `to-card/40` gradient, the worst zone) and the Navbar drawer label «الفئات» (Navbar.tsx:355, on `bg-card/98`). Dark passes (5.53–5.68:1).
**Fix:** drop the `/80` — the full token measures 6.72:1 (card) / 6.11:1 (bg); if a softer tier is wanted, mint a `--muted-foreground-strong` measured per theme. **Effort: S.**

### 4. [P2] FlashSaleBanner alpha-tinted text below AA in both themes
**Evidence:** FlashSaleBanner.tsx:199–201 non-urgent label `text-primary-text/80` («عرض محدود», `text-2xs` = 11px bold) → **4.22:1** dark / **3.87:1** light vs the banner surface. Countdown unit labels `text-3xs … opacity-70` inside the `bg-card/60` chips (FlashSaleBanner.tsx:256) → **3.10:1** light (4.48:1 dark). These are functional copy (sale label + time units), not decoration.
**Fix:** full-opacity `text-primary-text` for the label (6.05:1 dark / 4.82:1 light) and `text-muted-foreground` (no opacity) for units. **Effort: S.**

### 5. [P2] `--status-purple` below AA as badge text in the default dark theme
**Evidence:** computed `262 83% 66%` on its `/12` StatusBadge tint over the dark card = **4.09:1** — under 4.5:1 for the 11px bold badge role (StatusBadge `purple` variant, status-badge.tsx:36; consumed by NotificationBell's purple TYPE_CONFIG, B6-P1-4). Every other dark status token measures 4.63–7.72:1. Light passes (6.86:1).
**Fix:** raise lightness to the `cat-ai-tools` family (291 70% 70% measures 6.17:1 on its tint) — i.e. `262 83% 70%`-ish, re-measure. **Effort: S.**

### 6. [P2] `cta-glow` — a pulsing zero-offset colored halo — still ships on 4 money-path CTAs
**Evidence:** index.css:805–826: `.cta-glow::after { box-shadow: 0 0 0 6px hsl(var(--primary)/0.32); animation: cta-glow 2.8s infinite }` — a zero-offset, zero-blur colored ring. Craft-floor: "shadows carry an offset and a soft blur. A zero-offset colored halo is decoration." Live consumers: onboarding.tsx:161, wallet.tsx:1653, wallet.tsx:1816, product.tsx:1834 (desktop buy CTA). The R116-S1 CTA recipe (home.tsx:803–807) already claims "the pulsing cta-glow halo are gone" — true on home, false on these four.
**Fix:** delete the class at the 4 call sites (the button's gradient + `press-spring` already carry the affordance), then remove the utility + keyframes. **Effort: S.**

### 7. [P2] Gradient text on hero headings (REFUSE list) + dead `.text-gradient` twin
**Evidence:** craft-floor bans gradient text outright ("Emphasis comes from weight or size"). `.text-gradient-animated` (index.css:744–754) is applied to the guest hero h1's second line «في ليبيا» (home.tsx:694), the authed hero h1 «اشترِ اشتراكك المفضل اليوم» (home.tsx:486), and onboarding's welcome line (onboarding.tsx:127). The non-animated `.text-gradient` (index.css:736–741) has **zero consumers** — dead utility.
**Fix:** solid `text-primary-text` on the accent line (weight/size already carry the hierarchy); delete both utilities. **Effort: S.**

### 8. [P2] Raw `text-primary` (surface token) used as text — 3.67–3.76:1 in dark, sub-AA on hover links
**Evidence:** the system's own rule (button.tsx:25–28): raw `text-primary` "is the surface color and lands ~3.9:1" — `--primary-text` exists for text. Violations, computed in dark: product page price `text-3xl font-bold text-primary` on the `bg-muted/20` price box (product.tsx:1236) = **3.67:1** (passes only as large text); sticky-bar compact price `text-xl text-primary` (product.tsx:1825) = 3.76:1; `hover:text-primary` on **12px bold** links (product.tsx:262, order-detail.tsx:82 — coupon-copy / repeat-order hovers) = 3.76:1 — an AA fail on the hover state of small text. cart.tsx:149/246 `text-primary` icons pass the 3:1 non-text floor.
**Fix:** swap the two price sites + the two hover sites to `text-primary-text` (6.05:1 dark / 4.82:1 light). **Effort: S.**

### 9. [P2] Wallet payment-network chips ride raw Tailwind hues with sub-3:1 borders
**Evidence:** wallet.tsx:201–211 — `border-green-500/45` / `border-blue-500/45` on the network selector chips measure **2.55:1 / 1.96:1** vs the dark card (computed) — under WCAG 1.4.11's 3:1 for the visible boundary of a tappable control. R94-A1 #5 fixed the *text* of these chips (`text-status-success/info`) but left `border`/`bg`/`activeBg` on raw `green-500`/`blue-500`. This is also the last raw-hue pair on the storefront money path (the rest of the page-family rides tokens).
**Fix:** tokenize borders (`border-status-success/45` / `border-status-info/45`) or reuse Input's measured `border-muted-foreground/75` recipe (input.tsx:11–23). **Effort: S.**

### 10. [P3] Elevation declared twice — ghost-card shape on the big surfaces
**Evidence:** codex: "Declare elevation once, border or shadow. A 1px border under a wide soft shadow is the ghost card." Authed hero (border-`border/40` + `shadow-lg`, home.tsx:475), guest hero (border/40 + `shadow-xl`, home.tsx:645), AppDialog (border + `shadow-2xl`, app-dialog.tsx:134), AlertDialog (border + `shadow-lg`, alert-dialog.tsx:43), login/register/onboarding cards (border/55 + `shadow-2xl`, login.tsx:135, register.tsx:99, onboarding.tsx:119), notification popover (border/60 + `shadow-2xl` + `shadow-black/35`, NotificationBell.tsx:492). The 40–60% alpha borders are near-invisible under the wide shadow — exactly the ghost-card pairing. ProductCard's resting `border-border/70` + `shadow-sm` (small) is the defensible version.
**Fix:** on hero/dialog/auth surfaces pick one: full-strength border with the small shadow, or the big shadow with no border. **Effort: M.**

### 11. [P3] Over-round radii on cards (`rounded-3xl` = 24px)
**Evidence:** codex floor: "Card radii stay at 12–16px; pills are for small controls." The system core is right (`--radius` 12px, ProductCard `rounded-2xl` 16px) but: guest hero (home.tsx:645), both catalog empty/error states (home.tsx:1169,1185), the three auth cards (login.tsx:135, register.tsx:99, onboarding.tsx:119) and the form-skeleton shell (route-skeleton.tsx:333) all use `rounded-3xl` (24px).
**Fix:** `rounded-2xl` on those six sites. **Effort: S.**

### 12. [P3] Colored side stripes >1px on cards/callouts/list rows
**Evidence:** refuse rule: "A colored `border-left` or `border-right` above 1px on cards, list items, callouts, or alerts." Three members of one motif: toast accent strip `width: 3px` + glow at `inset-inline-start` (index.css:1175–1184); hero inline-start gradient stripes `w-[2px]` / `w-[2.5px]` (home.tsx:478, home.tsx:650); unread-marker `w-0.5` (2px) `right-0` on notification rows (NotificationBell.tsx:561). All deliberately RTL-correct (inline-start/physical-right) — the direction is right, the width is over the line.
**Fix:** either 1px, or fold the accent into the border color (`border-s-2`-style is the same refuse; use `border-inline-start` tint on an existing 1px border). **Effort: S** (3 files).

### 13. [P3] Kicker/eyebrow above the hero headings
**Evidence:** craft-floor: "A kicker or eyebrow above a heading… This one is a ban, not a default." Guest hero: «ليبيا #1» pill + muted tagline «سوق الاشتراكات الرقمية» directly above the h1 (home.tsx:667–676; the tagline is already hidden below sm — only the pill shows there). Authed hero: «مرحباً بك مجدداً» above the h1 (home.tsx:483–488).
**Fix:** let the h1 speak — delete the tagline spans; the #1 claim can live as a badge away from the heading or go. **Effort: S.**

### 14. [P3] REFUSE templates: icon+heading+text card grid closing the page; big-number/small-label stat chips
**Evidence:** the homepage closes with a 3-up grid of identical icon+title+description tiles (TrustCard, home.tsx:1253–1272) — the "same-size cards of icon plus heading plus text" scaffold (not the page *structure*, but the pattern); the desktop guest hero's side column is three big-number/small-label accent chips (home.tsx:839–890) — the "hero-metric template". Both are the exact shapes the refuse list calls lazy defaults.
**Fix:** trust band → one inline strip (icon + short claim in a row); stats → a single line of three inline figures, or drop (they duplicate the catalog header's count). **Effort: M.**

### 15. [P3] Unicode glyph / emoji standing in for the icon system
**Evidence:** refuse rule: "Unicode glyphs or emoji standing in for an icon system." support.tsx category picker uses emoji as icons (💳📦⚙️👤💬, support.tsx:29–33,159) — the page otherwise uses lucide; product.tsx:1828 uses a literal `✓` glyph («رصيد كافٍ ✓») while a CheckCircle import sits in the same file; cart.tsx:246 + product.tsx:1119–1123 still use first-letter *text* glyphs as the no-image fallback — ProductCard deliberately replaced exactly this with `CATEGORY_ICON` and documents why ("carried no category cue", ProductCard.tsx:150–166). Bonus: the cart fallback measures **1.66:1** (`text-primary/50` on the thumb tile).
**Fix:** lucide icons for support + the ✓; reuse the exported `CATEGORY_ICON` idiom on cart/product fallbacks. **Effort: M.**

### 16. [P3] Motion: broad vocabulary, magic-number durations, entrance on every mount
**Evidence:** 15 named keyframe utilities (index.css:432–604) + `card-spring`/`press-spring`/`cta-glow`/`shine-trigger`. Entrance animation runs on every card (`float-in` + `stagger-1..12`, ProductCard.tsx:313) and every page (`page-in`) — and re-plays on every catalog filter change (cards re-mount per query key). Transition durations drift off the 150/200/300 steps: `duration-180/220/250/280` across 8 files (home.tsx:492,1076,1090; ProductCard.tsx:314,611; wallet.tsx:1357; category.tsx:391,400; product.tsx:262; order-detail.tsx:82; support.tsx:811). Positives that hold: easings are exponential-out family (`cubic-bezier(0.22,1,0.36,1)` / overshoot springs), hover effects are disabled on touch (`@media (max-width:767px)`, index.css:1067–1079), and `prefers-reduced-motion` gets a global kill-switch that lands entrances at their final frame (index.css:1096–1107) — exemplary.
**Fix:** pin a 3-step duration scale (150/250/400) as tokens; drop the per-card float-in on filter re-mounts (keep it for the first paint only, e.g. key the stagger on the session, not the query). **Effort: M.**

### 17. [P3] Badge size scale collapsed — two "sizes" at the same 11px
**Evidence:** `--text-2xs: 11px; --text-3xs: 11px` (index.css:102–103, deliberate per R120-B1's Arabic readability floor). StatusBadge `xs` vs `sm` (status-badge.tsx:39–40) now differ only in padding (px-1.5 vs px-2) and icon size (2.5 vs 3) — typeset: "adjacent sizes too close to carry different jobs." The two-step micro scale is fictional while both tokens emit 11px.
**Fix:** either restore a visible step (11px vs 12px on the *less* dense variant) or collapse the variants honestly (document that xs/sm = padding scale, not type scale). **Effort: S.**

### 18. [P3] Sold-out card dimming leaves an active link at 2.36:1 (light theme)
**Evidence:** ProductCard.tsx:317 `opacity-45 saturate-[0.3]` — computed effective title contrast on the dimmed card: 3.45:1 dark / **2.36:1** light. R120-B1 (A3-F10/A4-F4) deliberately made sold-out cards *navigable* again («no longer dead taps… the card now navigates to the product page»), which puts the content in the "active UI" regime where 1.4.3 applies rather than the inactive-component exemption.
**Fix:** in light mode use a tint (desaturate + light `bg-muted/30` veil) instead of opacity-45, or raise the floor to ~0.55 and verify ≥3:1. **Effort: S.**

### 19. [P3] Mixed physical/logical RTL conventions (renders correctly today; portability + consistency debt)
**Evidence:** document dir is locked to `rtl` (index.html:2), so physical `right-*` ≈ inline-start everywhere and the app renders correctly — including deliberate physical badge corners (`top-2.5 left-2.5`/`right-2.5`, ProductCard.tsx:193,334) and the Switch's `rtl:` thumb flip (switch.tsx:26). But the conventions are mixed: logical where authored late (toast strip `inset-inline-start`, index.css:1179; `padding-inline-start`, index.css:1147; `sm:text-start`, alert-dialog.tsx:53; `pe-12`, ProductCard.tsx:477) vs physical elsewhere (`pr-9`+`right-3` search icon, home.tsx:973,1003; `text-right` vs `sm:text-start`, home.tsx:880 vs alert-dialog.tsx:53; `mr-auto` wallet.tsx:433; `mr-11` NotificationBell.tsx:609; redundant physical icon margins `ml-1.5/ml-2` inside `gap-2` buttons, product.tsx:1026,1787,1836). Icon mirroring itself is correct and consistent: forward = ChevronLeft/ArrowLeft (Navbar.tsx:394, FlashSaleBanner.tsx:225), back = ArrowRight with rightward hover slide (product.tsx:1054, order-detail.tsx:293) — right call for RTL.
**Fix:** no visual bug — adopt `ms-/me-/ps-/pe-/start-/end-` for new shared-component work; drop the redundant `ml-*` icon margins. **Effort: M** (incremental).

### 20. [P3] Spacing rhythm: heading space-above ≈ space-below; long-form measure uncapped
**Evidence:** craft-floor: "more space above a heading than below it." Home's cadence is near-uniform (result row `mb-2.5` → h2 `mb-3` → grid, home.tsx:1105,1151; hero `mb-4` → filter bar `mb-4`, home.tsx:645,969) — no deliberate above/below asymmetry anywhere in the audited pages. Positive: the spacing system itself is clean (4-unit `--spacing: 0.25rem`, index.css:217; gaps/space-y throughout — almost no magic spacing numbers; mobile clearance utilities read documented tokens, index.css:1018–1064). Measure: hero prose `max-w-md` (448px ≈ 65–75 Arabic chars ✓, home.tsx:697) but the product page's long-form description renders full-column with no cap (product.tsx:1172; at `lg` the START column gives ~524px at 14px → over-measure for long Arabic paragraphs).
**Fix:** add `max-w-prose`-style cap (or `max-w-[60ch]`) to `description_long`; introduce one documented above>below heading rhythm on section h2s. **Effort: S.**

---

## Verified good (computed/evidence-backed — the floor holds here)

- **Contrast, core pairs (both themes):** body 18.71:1/16.18:1; secondary `--muted-foreground` 8.00–8.41:1 dark / 6.11–6.72:1 light; `--primary-text` links 6.05/4.82:1; white-on-primary buttons 4.94/5.30:1; placeholders 8.18/6.49:1 (on the input's card/60 fill); ProductCard title `foreground/85` 12.91/11.26:1; نفد badge `white/70` on `black/75` 9.84:1; alert/warning/info/error notice text on /8–/10 tints 4.73–8.37:1 both themes; dark status badges 4.63–7.72:1; dark cat badges 4.97–9.29:1; toast title/desc on the glass surface 16.36/7.36:1.
- **Contrast governance is institutionalized:** Input's resting border measured to ≥3:1 per theme with the math in comments (input.tsx:11–35); focus ring contrast documented (3.96/4.82–5.30:1); light `--status-*` values carry their measured ratios (index.css:273–295); a test pins the design-system invariants (`design-system-css.test.ts`).
- **Arabic typography:** body line-height 1.7 + headings 1.3 with documented Arabic rationale (index.css:386–418); the tracking guard collapses ALL ±tracking utilities to 0 to protect cursive joins (index.css:907–923, and the toast's -0.005em was removed for the same reason); `dir="auto"` on user-Latin titles (ProductCard.tsx:450); Readex Pro self-hosted, per-subset (arabic+latin) 400/600/700 exactly matching the weight vocabulary (index.css:18–23), with a test banning unloaded weights (font-medium/font-black) and sub-11px arbitraries.
- **Browser surfaces (the themed half):** scrollbars styled in both engines + hover gradient (index.css:926–948); keyboard-only focus ring theming with `:focus:not(:focus-visible)` suppression (index.css:853–859); global `tabular-nums` + explicit `tabular-nums` on every money figure audited; `color-scheme` per theme so UA widgets follow (index.css:116,245); tap-highlight/cursor affordances pinned by test.
- **States:** the 5-state floor (hover/disabled/loading/error/empty) is met across every audited surface — route-shaped skeletons (route-skeleton.tsx), honest error-vs-empty splits with Arabic recovery copy (home.tsx:1165–1219, order-detail.tsx, wallet statement card), disabled CTAs with 44px floors and confirm guards (alert-dialog.tsx:95–118), undo toasts on destructive cart actions (cart.tsx:82–92).
- **Color system coherence:** semantic `--status-*` tokens with theme-tuned values are the single source (StatusBadge + STATUS_TONE + banners + toast accents all compose from them; the old `statusColor()` and raw `-400` hues are retired on the storefront — remaining raw hues are wallet network chips (#9) and admin pages, out of storefront scope); category accents tokenized with a documented tint-composition pattern; WhatsApp is a deliberate fixed brand pair with an AA ink companion (index.css:86–91).
- **Depth (except #6):** the shadow scale carries y-offset + soft blur in every step, both themes, with the light 2xl step-down bug already fixed (index.css:324–338); toast shadows are offset+blur; no hard-offset (zero-blur) shadows anywhere.
- **Dark/light architecture:** `.light` overrides are complete for every consumed token family (surfaces, cat accents, status, borders, shadows — the dead `dark:` variant trap is documented and removed, index.css:27–31).

## Priority counts
**P0: 0 · P1: 1 · P2: 8 · P3: 11 — 20 findings.**
Every P1/P2 fix is token-level (S effort, no layout changes); the P3s are coherence/polish. No finding touches money logic, inventory/catalog behavior, or WhatsApp pairing.
