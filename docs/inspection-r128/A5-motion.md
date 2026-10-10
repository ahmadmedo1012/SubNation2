# R128-A5 — Motion, Transitions & Micro-Interactions (المظهر: the feel layer)

**Agent:** R128-A5 (read-only auditor) · **Repo:** main @ 7d469d5 (clean tree; this report + worklog are the only writes)
**Scope:** the WHOLE motion system as craft — `frontend/src/index.css` motion layer, every Tailwind transition/animate utility in `frontend/src`, Radix data-state choreography, decorative loops, skeleton shimmer, reduced-motion safety — plus 4 live Playwright probes on https://subnation.ly guest pages (evidence: `/home/z/my-project/tmp-a5/` — `probe-log.json`, `card-hovered.png`, `toast.png`, `skeleton.png`, `drawer-open.png`).
**Prior coverage read first (not re-reported):** R127-B3 impeccable (bounce-easing + layout-transition waivers — re-judged systemically in §6), R126-A13 J6 (reduced-motion PASS — extended in A5-4), R126-A9, R125-A6 B-18/B-19, R125-A7.

---

## 1. Motion inventory (full census, source @ 7d469d5, tests excluded)

### 1a. Keyframes — `index.css` 14 hand-written + 3 library families

| Keyframe | Line | Class | Duration | Easing | Class | Consumers (non-test) | Category |
|---|---|---|---|---|---|---|---|
| `shimmer` | :461 | `.skeleton-shimmer::after` | 1.6s infinite | linear (default) | 174 | loading |
| `page-in` | :470 | `.page-in` | 0.3s | `0.22,1,0.36,1` | 17 | entrance |
| `float-in` | :481 | `.float-in` | 0.34s | **spring** `0.34,1.35,0.64,1` | 73 | entrance |
| `slide-up` | :492 | `.slide-up` | 0.24s | `0.22,1,0.36,1` | 4 | entrance |
| `shake` | :503 | `.shake` | 0.4s | `0.36,.07,.19,.97` | 3 (product, wallet×2) | feedback (error) |
| `success-ring` | :518 | `.success-ring` | 0.8s forwards | ease-out | 1 (order success) | feedback |
| `badge-pulse` | :529 | `.badge-pulse` | 2s infinite | ease-in-out | 4 (bell×2, alerts, dashboard) | decorative (attention) |
| `shine` | :540 | `.group:hover .shine-trigger` | 0.7s | ease-out | 1 (ProductCard) | decorative (hover) |
| `blob-drift` | :550 | `.blob-drift` / `-slow` | 9s / 13s infinite | ease-in-out | 10 (5 pages, `use-on-screen`-paused) | decorative (ambient) |
| `reveal-up` | :564 | `.reveal-up` | 0.42s | `0.22,1,0.36,1` | 26 | entrance |
| `num-pop` | :576 | `.num-pop` | 0.42s | **spring** `0.34,1.6,0.64,1` | 1 (wallet balance) | feedback (emphasis) |
| `tab-slide-in` | :589 | `.tab-slide-in` | 0.24s | **spring** `0.34,1.4,0.64,1` | 3 (Navbar underline, MobileNav pill+bar) | feedback (indicator) |
| `pulse-dot` | :601 | `.pulse-dot` | 1.6s infinite | ease-in-out | 3 (support, order-detail, wallet) | feedback (pending) |
| `fade-in` | :614 | `.fade-in` | 0.22s | ease-out | 0 standalone (only via components) | entrance |
| `enter`/`exit` | tw-animate-css | `animate-in`/`animate-out` + fade/zoom/slide modifiers, **fill: none** | 100–200ms | ease (default) | 15 in / 4 out (app-dialog, alert-dialog + 7 hand-rolled portals) | entrance/exit (overlay) |
| `spin` / `pulse` | Tailwind built-in | `animate-spin` / `animate-pulse` | 1s / 2s infinite | linear / ease | 65 / 11 | loading / attention |

### 1b. Transition utilities — 392 occurrences across 73 files

| Family | Count | Notes |
|---|---|---|
| `transition-colors` | 177 | hover text/bg/border feedback — the workhorse |
| `transition-all` | 135 | over-broad; 2 sites actually animate layout props (A5-5) |
| `transition-transform` | 40 | image zooms, chevron rotations, slide-ups |
| `transition-opacity` | 16 | row-action reveals (admin alerts), toast close |
| `duration-*` explicit | 150×51, 200×18, 300×7, 500×5, 100×3, 250/350/400×2, plus odd values 180 (product.tsx:271), 220 (ProductCard.tsx:681), 280 (ProductCard.tsx:323 — **dead**, overridden by `.card-spring`'s own transition, see §3) |
| index.css hardcoded | 160, 180, 200, 220, 240, 260, 280, 300, 340, 420, 500, 700, 800, 1000ms + toast 100/150/180ms | ~17 distinct durations live in the system |

### 1c. Interaction-state classes

`.card-spring` ×9 (hover lift + active press on cards) · `.press-spring` ×90 (button active scale 0.91, mobile 0.97) · `.input-premium` (focus ring 0.18s) · `hover-elevate`/`active-elevate-2` (pseudo-element tint overlays, on Button by default) · `stagger-1..12` ×68 (all call sites cap at 8 = 0.32s max delay — no first-impression-staggering chains) · `active:scale-*` ×61 (the second press dialect, see A5-8).

### 1d. Library choreography

**sonner** toasts: one global Toaster (top-center, `dir=rtl`, 4s, visibleToasts 3, closeButton, safe-area offset) — JS-driven enter (transform/opacity/height 0.4s, live-verified: opacity 0.92 at 350ms mid-enter) + swipe-dismiss; premium skin in index.css:1145-1404. **No framer-motion anywhere** (0 imports) — the system is 100% CSS keyframes/transitions, which is coherent and cheap.

---

## 2. System coherence verdict

**The vocabulary exists and is genuinely used** — this is not an ad-hoc sprinkle: two sanctioned easing families cover every hand-written class (`spring` = cubic-bezier(0.34, 1.35–1.6, 0.64, 1) ×5 classes; `easeOutQuint-ish` = cubic-bezier(0.22, 1, 0.36, 1) ×4 classes), identical actions DO animate identically in the Radix family (all AppDialogs: bottom-sheet→zoom card, in AND out, 200ms; all toasts: one choreography), and the canon's "every animation answers why" largely holds (each class above maps to a why).

**The incoherences** (all P4, fixed by the token spec in §7): (a) three easing vocabularies coexist in practice — the 2 sanctioned families + Tailwind's default `cubic-bezier(0.4,0,0.2,1)` which actually carries the majority of the 392 transition utilities (live-verified: nav link, card image); (b) ~17 distinct durations; (c) two press-feedback dialects (A5-8); (d) the PDP hero image zooms at 500ms `ease-out` while every card image zooms at 300ms `ease-out` — same action, different speed (product.tsx:1187 vs ProductCard.tsx:421); (e) dead declarations: `duration-280 ease-out` on the ProductCard root is fully overridden by `.card-spring`'s later-in-cascade shorthand (live-verified: computed = `transform, box-shadow, border-color / 0.26s, 0.26s, 0.2s / spring, ease, ease`).

---

## 3. Findings (P0–P4)

### A5-1 [P2 · confidence 5] `animation-fill-mode: both` on entrance classes permanently pins `transform` — the sanctioned `card-spring` hover lift and `press-spring` press are DEAD on every element that also has an entrance class

- **Live-verified (probe2/3):** hovering a real home product card (`:hover` confirmed via `matches(':hover')`): computed transform stays `matrix(1,0,0,1,0,0)` across 8×45ms samples and settled — **the `-3px` lift never fires**. The resting transform is `matrix(...)` (not `none`) — the tell-tale of a filled animation. Border-color + shadow hover halves still fire (live-verified), so cards feel ~half-alive rather than dead — which is exactly why no visual audit caught it.
- **Mechanism:** `.float-in { animation: float-in 0.34s … both }` (index.css:685-687) fills **forwards forever**; per CSS cascade, an animation's filled values beat normal author declarations, so `.card-spring:hover { transform: translateY(-3px) scale(1.01) }` (index.css:790) and `:active` (index.css:793) can never win. tw-animate-css is innocent (its `enter` uses fill `none` — verified in dist) — the bug is only in the hand-written entrance classes.
- **Blast radius (grep-verified same-element combos):**
  - `ProductCard.tsx:321-327` — root has `float-in` + `card-spring`: **every product card on home / category / search / recommendations rails (45 on home)** — hover lift + active press dead;
  - `flash-sales.tsx:101-103` — flash card root: same;
  - `admin/dashboard.tsx:768` — stat cards `float-in stagger-*` + `card-spring`: admin hover lift dead;
  - `home.tsx:792` — category filter chips `press-spring` + `float-in`: live-verified `:active` transform stays identity mid-press — the press feedback on the homepage's primary filter row is dead.
- **Fix (S, one line ×4 classes):** change `both` → `backwards` on `.float-in/.page-in/.slide-up/.reveal-up/.fade-in` (index.css:683, 686, 689, 692, 749). `backwards` keeps the stagger-delay pre-state (opacity:0, no flash-in), and since every one of these keyframes **ends at the element's natural cascade state**, releasing the fill at end is visually identical at rest — while resurrecting hover/active transforms. Reduced-motion kill-switch unaffected (0.01ms animations complete instantly either way). Pin with a computed-style regression test (`expect(getComputedStyle(card).transform).toBe('none')` at rest + `matrix(...)` under `:hover` in a real browser or `:hover` rule-match check).
- **NEW** — no prior round detected it (R127-B3 saw the *curves*, not the cascade; visual screenshot audits see border/shadow halves).

### A5-2 [P3 · confidence 5] Hand-rolled portals animate in but vanish instantly — entrance/exit asymmetry on 5 overlay surfaces

- **Live-verified:** guest drawer (Navbar) opens with `float-in` 0.34s + scroll-locks (`body overflow: hidden` confirmed) — on close it **unmounts in ≤53ms** (measured), i.e. zero exit choreography. Same conditional-mount pattern: admin mobile drawer (`layout.tsx:1252-1268`, `animate-in slide-in-from-right-4` in, instant out), NotificationBell panel (`NotificationBell.tsx:381,508` — `animate-in fade-in zoom-in-95` in, instant out), Copilot drawer (`CopilotPanel.tsx:942-946`), admin orders status dropdown (`orders.tsx:1321`). Their backdrops disappear with them.
- **Contrast:** the Radix family is symmetric (`app-dialog.tsx:140-146`, `alert-dialog.tsx:19` — `data-[state=closed]:animate-out …` with Radix holding the node through the exit) — so the app's own canonical overlays DO exit properly; these 5 are the outliers. Layout.tsx:1251 already documents "full Radix Drawer migration is a documented follow-up".
- **Fix (M):** migrate the drawer/panel/dropdown sites to Radix Dialog/Popover (gets exit + the existing focus/scroll-lock hardening for free), or add a 150–200ms `animate-out` closing state before unmount. Priority order: guest drawer + bell panel (storefront), then admin trio.

### A5-3 [P3 · confidence 4] Cart quantity stepper has no active/press feedback and the count micro-moment is missing — the money path's most-touched control

- `cart.tsx:330-351`: minus/plus/trash buttons carry only `hover:bg-secondary/70 transition-colors` — no `press-spring`, no `active:scale` (the app's own 90-site press vocabulary). The qty digit (`:344-346`) re-renders as bare text — `num-pop` (the sanctioned emphasis animation, index.css:818) exists but is used exactly once in the whole app (wallet balance, wallet.tsx:1246).
- The add-to-cart micro-moment is otherwise real: card CTA press-spring (live-verified 0.937 mid-press) + toast (live-verified 400ms sonner enter, 4s life, gone by 5s) — but the cart badge (Navbar + MobileNav) just swaps the number with no pop, so the "it worked" confirmation rests entirely on the toast.
- **Fix (S):** `press-spring` on the stepper buttons; `num-pop` (keyed on quantity) on the digit and on cart badge count changes — this is the R96-era press-spring intent extended to its two missing sites.

### A5-4 [P4 · confidence 5] Reduced-motion kill-switch is complete and live-verified — but it also freezes all 65 spinners (documented tradeoff, worth a policy decision)

- **Live-verified (probe1 §reduced-motion):** under `reducedMotion: 'reduce'`, card / injected `skeleton-shimmer`, `press-spring`, `float-in`, `badge-pulse`, `animate-spin`, `tab-slide-in` ALL collapse to `1e-05s` + `iteration-count: 1` — the global switch (index.css:1099-1110) + the toast block (:1399-1404) hold. Extends R126-A13 J6's PASS to every class, including tw-animate.
- Consequence: every `Loader2 animate-spin` in-flight state (checkout coupon check, topup waiting modal, button busy swaps) renders as a **static upright icon** under RM. WCAG 2.3.3 concerns interaction-triggered motion — loading spinners are activity signals, not interaction motion, and most systems (GitHub Primer among them) keep small looping loaders running under RM. Options: exempt `animate-spin` from the kill-switch (`.animate-spin { animation-duration: revert-layer !important }` style escape, or drop the `*` to `*:not(.animate-spin)`) — or accept and document. The current kill-switch comment ("Infinite loops … are pinned to a single iteration so nothing keeps moving") shows this is deliberate; I judge the *looping tiny spinner* exemption safe for vestibular users and better for state honesty, but it's a policy call, not a defect.

### A5-5 [P4 · confidence 4] Two layout-property animations survive (the width side of the impeccable layout-transition rule)

- `admin/layout.tsx:1244` — sidebar collapse `transition-all duration-200` between `w-52`↔`w-[52px]`: animates **width** (layout+paint per frame; 200ms, one-off, admin-only — cheap in practice).
- `loyalty.tsx:518-521` — tier progress bar `transition-all duration-700` on `style={{ width: % }}`: animates **width**; `transform: scaleX` with `origin-right` (RTL reading origin, same idiom as NavigationProgress.tsx:87) is the composited form.
- R127-B3 waived sonner's `height` transition as third-party and correctly counted 0 `height` matches in `frontend/src` — **width** transitions were outside that count. Both are low-jank in situ; fix opportunistically (the loyalty bar is the more visible one at 700ms).

### A5-6 [P4 · confidence 4] Skeleton shimmer sweep is not mirrored for RTL — it travels left→right while the app reads right→left

- `index.css:461-468` (`translateX(-100%) → +100%`) + `:634-648` (90deg gradient). Live-verified mid-flight: `::after` tx −60.7px on a 64px element (−95%, moving toward 0 → +100%) = physically rightward. In an RTL UI the conventional sweep (Material mirrors it explicitly) is right→left.
- Impact is genuinely small — the gradient is symmetric (transparent→muted→primary→muted→transparent), so only the band's travel direction betrays it — but the fix is one line and directionally consistent with the app's own RTL-motion care (NavigationProgress `origin-right`, switch thumb `rtl:` flip):
  ```css
  [dir="rtl"] .skeleton-shimmer::after { animation-direction: reverse; }
  ```
- Shimmer **quality** otherwise verified good: 1.6s cadence, 8% alpha tint (subtle, on-brand — not the invisible/noisy failure modes), shape fidelity post-R127 radii unification held (route-skeleton.tsx mirrors page archetypes at `rounded-2xl`/`rounded-3xl` per the B13-F3 notes; role=status + aria-live everywhere).

### A5-7 [P4 · confidence 5] Duration scale is scattered (~17 values) and one declaration is dead — adopt the motion-token spec (§7)

- Measured set: 100/150/180/200/220/250/280/300/350/400/420/500/700/800/1000ms (utilities + index.css). The 150/200/300 core is right for feedback/entrance; the long tail (180, 220, 250, 280, 350, 420) is drift, and `ProductCard.tsx:323`'s `duration-280 ease-out` is fully dead (overridden by `.card-spring`'s shorthand, live-verified) — delete it or it will mislead the next reader (it misled the card author into thinking the card rides 280ms).
- PDP hero zoom 500ms (product.tsx:1187) vs card image zoom 300ms (ProductCard.tsx:421) — same interaction class, different tempo; 500ms is also past the >400ms feedback-delay bar (defensible for a large inspection zoom, but then cards should match or intentionally not).

### A5-8 [P4 · confidence 4] Two press-feedback dialects and five active-scale magnitudes; several elements declare both

- `press-spring` (0.16s spring, scale 0.91 / 0.97 mobile) ×90 vs `active:scale-*` via `transition-all` ×61 with magnitudes 0.90/0.95/0.97/0.98/0.99/0.995 (bell, CopyButton, AuthProviders, Telegram, loyalty, cart, orders rows). `TelegramLoginButton.tsx:166` and `AuthProviders.tsx:192` declare **both** (`active:scale-[0.97] … press-spring`) — press-spring's transform wins the cascade, so the `active:scale` is dead weight there. Consolidate on `press-spring` for controls and one shared `active:scale` token for rows/links; the mobile 0.97 vs desktop 0.91 split in index.css:1079-1081 is good craft to keep.

### A5-9 [P4 · confidence 3] Instant content reveals next to animated chevrons (FAQ + admin row expansion)

- `support.tsx:941-953` — `<details>` FAQ: chevron rotates (`group-open:-rotate-90 transition-transform`) but the answer appears with zero height transition. Same pattern on admin orders row expansion (`orders.tsx:341/488` chevron `rotate-180` 150ms, rows expand instantly). Instant reveal is a defensible anti-jank choice; the rotating chevron just promises motion the container doesn't deliver. If ever unified: tw-animate-css ships `accordion-down/up` (Radix `--radix-accordion-content-height`) — already in the dependency, unused.

---

## 4. Coverage gaps — the dead-feel sweep (storefront + admin sample)

Sampled: ProductCard (all 5 interactive children), Navbar (nav links, theme toggle, wallet chip, cart), MobileNav (tabs, badge), cart page (rows, stepper, CTAs), product CTA family, orders rows/chips, Footer links, support chips/FAQ/ticket rows, admin (users/orders/alerts/tickets/settings/dashboard rows, toolbar buttons, tabs, hamburger). **Verdict: dead-feel is LOW** — the app is transition-rich (392 utilities, 393 custom-class consumers) and the true dead spots are: the transform halves killed by A5-1 (the biggest "clicks feel dead" class — bug-induced, not missing), the cart stepper active feedback (A5-3), and CopyButton's instant icon swap (state change announces via label text + aria-live, so acceptable). Rows/tabs/chips/nav/buttons everywhere else carry hover + active + focus-visible (ring live-verified: 2px solid `rgb(220,24,64)`, offset 2px on «الكتالوج» after 3 tabs).

## 5. Over-motion sweep (the opposite sin)

**Verdict: not over-motioned.** (a) No layout-property jank beyond A5-5's two cheap sites; (b) decorative loops are small, low-alpha, and `use-on-screen`-paused (live: home blob `blob-drift` 9s `running` in-viewport; hook armed on all 5 blob pages); (c) `shine` is hover-only AND disabled ≤767px (index.css:1075-1077); (d) stagger caps at 8 (0.32s + 0.34s = ≤0.66s worst-case entrance, no impression-slowing chains); (e) the only >400ms feedback is the PDP hero zoom (A5-7) and semantic progress bars (loyalty 700ms, order steps 500/700ms — state transitions, not feedback delays — fine); (f) `blob-drift`'s `will-change: transform` + blur-2xl layers are the heaviest GPU residents and they're already viewport-gated; animated blur stays banned (canon §2 upheld — 0 matches).

## 6. R127-B3 waiver judgement (bounce-easing ×5, systemically)

**Sanction UPHELD, with the irony noted.** The 5 sites (float-in 1.35 / card-spring 1.4 / press-spring 1.5 / num-pop 1.6 / tab-slide-in 1.4) form one coherent family — same control points, overshoot 1.35–1.6 (mild), all one-shot, each with a why (entrance affordance / hover lift / press confirmation / number emphasis / indicator reveal). They are NOT the "AI-tell bounce" the rule hunts (multi-bounce elastic on everything). The systemic judgment: the easing vocabulary was never the motion system's weakness — **the cascade was** (A5-1: the sanctioned spring was authored correctly and then silently defeated by a fill-mode side effect on its highest-traffic consumer). Keep the waivers + the inline `impeccable-disable-line` comments; add the A5-1 regression test so the *effect* of the sanctioned curves is what's protected, not just their literals.

## 7. Proposed motion-token spec (CSS vars, drop into index.css `@theme` + utility rewrites)

```css
@theme {
  /* durations — 5-step scale; every hand-written class + duration-* migrates here */
  --duration-tap:    100ms;  /* micro: chevron, scrollbar, toast button */
  --duration-fast:   150ms;  /* feedback: Button, chips, tabs, hover colors */
  --duration-normal: 240ms;  /* entrances: slide-up, tab-slide-in; card border */
  --duration-spring: 300ms;  /* card lift/zoom, page-in */
  --duration-lore:   500ms;  /* semantic progress only (tier bar, steps, nav bar) */
  /* easings — the two sanctioned families, named */
  --ease-out-soft:   cubic-bezier(0.22, 1, 0.36, 1);   /* entrances, no overshoot */
  --ease-spring:     cubic-bezier(0.34, 1.4, 0.64, 1); /* press/lift/emphasis (one overshoot) */
}
```
Migration is mostly `s/var` in index.css's 15 classes + swapping ad-hoc `duration-180/220/280/…` to the nearest step; `press-spring` stays the single press dialect (A5-8); the token names give the impeccable inline waivers something canonical to cite.

## 8. Verified-OK (live probe evidence in /home/z/my-project/tmp-a5/)

1. **Reduced-motion kill-switch** — global + toast blocks both live-verified across 7 probed classes (A5-4 nuance aside). WCAG-2.3.3-safe.
2. **Toast system** — one Toaster, RTL dir, 4s, enter 400ms live-sampled, exit collapse, replay-on-lazy-mount, safe-area offsets, Arabic labels. Coherent everywhere by construction.
3. **AppDialog/AlertDialog** — entrance+exit symmetry, mobile bottom-sheet → ≥sm zoom card (the R127 radii hold), duration-200, dismissable-guard, focus-capture scroll.
4. **NavigationProgress** — RTL `origin-right` (bar grows from the reading origin), 80ms show threshold (no flash on cached chunks), 600ms cap, transform-only.
5. **Skeletons** — shape fidelity to page archetypes (route-skeleton mirrors every geometry incl. the R123 CLS work), staggered 40ms delays, role=status + aria-live, RTL-relevant: mask fades (`scroll-fade-rtl`) are direction-correct.
6. **MobileNav/Navbar indicators** — `tab-slide-in` spring on active pill + underline, `aria-current`, icon weight/size shift 200ms; header scrolled-state snap (no transition) is the right call for scroll-driven state.
7. **Admin rows/toolbars** — `hover:bg-muted/20 transition-colors` rows, `active:scale-90` row actions, sticky-thead, live-region announcements on list swaps.
8. **Button** — press-spring + hover-elevate + focus ring + 150ms, one source of truth (cva).
9. **Decorative restraint** — shine hover-only + mobile-off; blobs paused off-screen; dead glow/glass CSS stays deleted; no animated blur anywhere.

**P0: 0 · P1: 0 · P2: 1 (A5-1) · P3: 2 (A5-2, A5-3) · P4: 6 (A5-4 … A5-9)**
