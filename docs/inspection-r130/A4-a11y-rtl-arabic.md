# R130-A4 — Mobile / RTL / A11y / Arabic-UI source audit

**Method:** all contrast figures computed at current source via WCAG
relative luminance with sRGB-space alpha compositing — calibrated against
three published R128/R129 figures to ±0.04. R129's census grep never covered
`text-foreground/NN` or files outside the R128 delta — those seams are what
this pass swept. D = dark / L = light. Counts: P3 ×1 · P4 ×9 · P0/P1/P2 ×0.

## Findings

### A4-F1 [P3 · VERIFIED] Provider-settings secret reveal sat on the wrong physical side — FIXED R130
`provider-card.tsx:254,262`: input `dir="ltr"` + `text-left` + `pr-9` (36px
reserved on the RIGHT) but the eye button was `absolute left-2.5` — exactly
where LTR text starts; a revealed key's first characters rendered under the
icon. **FIXED R130**: `left-2.5` → `right-2.5` (one class; the pr-9
reservation now owns the button side).

### A4-F2 [P4 · VERIFIED] Light-theme sub-opacity ink residue at 7 sites — 3 highest-value FIXED R130
All computed on card: `risk.tsx:313` chip-count opacity-70 = **3.33 L** (the
R129-A2F7 held-open tail — **FIXED R130**, full ink); worst pair failing BOTH
themes: `whatsapp.tsx:378` `muted-foreground/60` 12px = **2.71 L / 3.63 D**
(**FIXED R130**) and `admin/layout.tsx:1342` ⌘K kbd opacity-60 = **2.71 L /
3.63 D** (**FIXED R130**). Remaining accepted P4s (light-only, ≥11px
non-essential or aria-covered): `referrals.tsx:190` status-success/70 11px
(3.18 L), `pricing.tsx:293` opacity-75 (3.71 L), `pricing.tsx:1146,1183`
opacity-80 (4.14 L), `order-detail.tsx:581` muted-foreground/75 11px (3.71 L).

### A4-F3 [P4 · VERIFIED, accepted] Crash-screen error dump `status-error/75` = 3.84 L / 3.40 D
`ErrorBoundary.tsx:128` — the bold headline above carries the state; the /8
tile eats the alpha budget. Smallest fix when touched: drop the /75.

### A4-F4 [P4 · VERIFIED, accepted] Destructive-tint tails in the two upload/variants dialogs
`InventoryUploadDialog.tsx:445` `/70` mono 11px (3.42 L / 2.80 D);
`ProductVariantsDialog.tsx:777` trash `/60` (2.88 L / 2.35 D at rest, hover
restores; button properly aria-labeled).

### A4-F5 [P4 · VERIFIED, accepted] Decorative icon-hygiene stragglers
`home.tsx:569` WifiOff `/60` (2.67 D) + `not-found.tsx:30` Compass
`primary/40` (1.97 L) — both sit beside bold Arabic text; hygiene only
(aria-hidden + drop the /60 when touched).

### A4-F6 [P4 · VERIFIED-OPEN inherited] Admin password-reveal is still a 16×16px target (R126-F6 never landed)
`admin/login.tsx:235` — the repo's own 44px idiom exists 40 lines away
(AuthErrorBanner's `-my-2.5 h-11 w-11`).

### A4-F7 [P4 · VERIFIED] NotificationBell panel: no focus restore + uncontained dialog
Close (X, Esc, outside-click) never returns focus to the bell; `role="dialog"`
without aria-modal/Tab containment (Tab walks behind the overlay). The admin
shell does both correctly (`admin/layout.tsx:388-390,555-558`) — mirror it.

### A4-F8 [P4 · VERIFIED] Form-label association tail (admin)
`provider-card.tsx:237-242` visible `<label>` with no htmlFor + inputs
without id/aria-label (placeholder-only names for every provider field incl.
secrets); same on 4 admin textareas + the search-palette input
(role="combobox" without a name). Storefront is clean.

### A4-F9 [P4 · VERIFIED census] Physical-direction classes: 166 line-hits across 45 files, all RTL-correct today except A4-F1
Icon-gaps, start-anchored accents, search-input pairings, timeline indents,
corner badges, `dir="ltr"` digit inputs — every placement resolves correctly
in the RTL-only app. Zero diff-added physical classes in R130's own edits
(the 10-site batch rode logical properties). Latent fragility only.

### A4-F10 [P4 · VERIFIED, accepted] Hover-state ink dips below AA
`home.tsx:597` `hover:text-primary-text/75` (3.84 L / 3.82 D) + `:759` /80
(4.16/4.21) — resting passes, hover crosses 4.5. XS fix: hover to full ink.

## Lanes swept clean (no finding)
Reduced motion (14 keyframes, global guard intact), numerals (all Intl
locale-pinned), toasts (dir/labels/safe-area/aria-live), icon-only buttons
(0 unnamed across all 133 files — extends R129's 50-file scan), 360px
(overflow-x-auto guards, no new fixed min-widths), keyboard-open/sticky
(useKeyboardVisibility + resizes-content + scroll-padding), touch targets
(PDP chips + CTAs ≥44px).

## Verified-closed register
R129-A2 F1/F2/F3/F4/F5/F13/F14/F15, R128-A4 F1/F2/F3, R126-A13
F1/F2/F4/F9/F11/F12, R125 B-7 skip link, and the parent's R130 closes
(fetch-error tints, «— نفد» pills, cart aria-describedby) verified in situ.
