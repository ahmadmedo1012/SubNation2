> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r111/f3-accessibility.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R111-F3 — WCAG 2.2 AA Accessibility Depth Audit

> Agent: R111-F3 · READ-ONLY · Base: SubNation2 `2a80f1e` (r110 docs HEAD)
> Scope: dimensions r96-A6 did NOT cover — keyboard journeys, route-change focus,
> live regions, WCAG 2.2 specifics (2.4.11 / 2.5.8 / 3.3.7 / 3.3.8), form error
> binding, admin table semantics, theme-token contrast. Method: grep-first +
> code-trace of 4 journeys. Contrast ratios computed with a WCAG relative-luminance
> script over the theme tokens in `frontend/src/index.css`.

## Verdict

**FAILS WCAG 2.2 AA** — 8 P2 failures (no P0/P1). The storefront money journeys
(cart→checkout→submit, wallet topup + waiting modal, WhatsApp OTP login) are
**keyboard-complete** — every control is a real button/input, Radix dialogs trap +
return focus, and the OTP flow is exemplary on 3.3.8. The failures concentrate in:
(a) focus-indicator contrast on every text field (1.4.11, both themes), (b) admin
keyboard access (mouse-only row expansion, hand-rolled money dialogs, nameless
checkbox buttons), (c) light-theme status-token contrast, (d) SPA route transitions
that are silent and focus-less, (e) sticky/fixed bars with no scroll-padding
(2.4.11).

## r96-A6 fix verification (brief — all held)

| r96 fix | Status | Evidence |
|---|---|---|
| Letter-spacing guard (positive side) | ✅ held | index.css:1069-1085 — all five `tracking-*` utilities collapse to 0 globally |
| Wallet form labels | ✅ held | wallet.tsx:318-321 (StepDot `<Label htmlFor>`), 468-471 (PaymentReferenceField label), 1244-1247 (sender phone `aria-invalid` + `aria-describedby="topup-sender-phone-error"`, pinned in `__tests__/wallet-submit.test.tsx:256-273`) |
| TopupWaitingModal aria-live | ✅ held | TopupWaitingModal.tsx:213-217 (countdown `aria-live=polite atomic`), 272 (approved `role=status`), 339 (rejected `role=alert`) |
| Light contrast (partial) | ⚠️ partial | primary-text 5.30:1 ✓, muted-fg 6.72:1 ✓, but status tokens still fail — see F3-06 |

---

## Journey traces

### (a) Product → add-to-cart → cart → checkout → submit
Tab order follows DOM = visual order (RTL-correct). ProductCard CTA is a real
`<button>` sibling of the details `<Link>` (ProductCard.tsx:459-499); the desktop
hover-reveal CTA also opens on `group-focus-within` (489). Plan picker is a proper
`role="radiogroup"` + `role="radio"` + `aria-checked` + `aria-disabled`
(product.tsx:1731-1750). Stock state carries `role=status` + `aria-live`
(product.tsx:1033-1051), wallet pre-check uses `aria-busy` (1508-1509). Cart
steppers are 44px with per-state `aria-label`s incl. the qty→delete swap
(cart.tsx:270-304). Checkout's only input (coupon) is labelled (1224), Enter
applies (1217-1222), and every money failure renders a persistent `role="alert"`
banner (1165, 1177, 1304, 1413) with a labelled 44px dismiss (1448-1458); success
toasts «تم تأكيد الطلب» (1081) then navigates to the order. **No keyboard traps.**
Gaps found on this path: F3-01 (input focus ring), F3-06 (light-theme banner text),
F3-09 (coupon error not bound to field), F3-14 (checking button goes nameless),
F3-07 (post-submit route focus).

### (b) Wallet topup + waiting modal
Steps labelled via StepDot `<Label htmlFor>`; presets 44px (wallet.tsx:1096-1098);
reference code display is a persistent `aria-live=polite` wrapper (401-411);
sender phone fully bound (1244-1247). Modal = Radix `Dialog` (focus trap + return),
countdown announced, approved/rejected asserted live (see verification table).
Gaps: F3-04 (dialog has no accessible name), F3-10 (≤30s dismiss lock), F3-11
(balance behind the modal is not a live region).

### (c) WhatsApp login phone → code
Pristine→phone→code is a DOM-ordered flow; OTP input `autoComplete="one-time-code"`
+ smart onPaste digit extraction (564-575) + a clipboard paste button with
`aria-label` (587-596) + Arabic-Indic digit conversion (368-370) — **3.3.8
(Accessible Authentication) is exemplary**. Errors: single funnel into one
`role="alert"` (693-700); settling state `role="status"` (661-692). autoFocus on
the OTP field (582) is appropriate for the step. Gaps: F3-12 (both inputs kill the
outline and substitute a 1.70:1 border tint), phone Enter does not send
(enterKeyHint="done" but no keydown), phone input lacks `aria-describedby` for the
091-094 prefix hint.

### (d) Admin refund dialog
Bulk refund = select rows → confirm. The confirm is the shared `useConfirm()`
AlertDialog — Radix focus trap, Title/Description wired, destructive styling
(use-confirm.tsx:80-111; orders.tsx:267-272 shows total LYD). **But the journey
into it is broken for keyboard users:** row selection buttons are nameless/stateless
(F3-08), row expansion is mouse-only (F3-02), and the sibling topups money queue
uses hand-rolled dialogs with no trap (F3-03).

---

## Findings

### P2 — AA failures

**F3-01 · 1.4.11 (+2.4.13-adjacent) · All text inputs: focus ring below 3:1 in both themes**
`components/ui/input.tsx:21` — `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60`.
The shared Input replaces the solid global ring (index.css:1015-1018, which clears
3:1 at 3.76-3.96:1) with a 60%-alpha primary ring: **2.03:1 (dark)**, **2.92:1
(light)**. Every form field in the app (topup amount, sender phone, coupon, admin
filters) inherits it. Scenario: keyboard user tabs through the topup form on the
dark theme — the ring is barely distinguishable from the field border.
Fix: `focus-visible:ring-ring` (full opacity) or keep the outline instead of
`outline-none`; the 60%-alpha aesthetic fails non-text contrast.

**F3-02 · 2.1.1 · Admin orders: row expansion is mouse-only**
`pages/admin/orders.tsx:1013-1074` — five `<td onClick={…setExpandedRow…}>` cells
plus the chevron cell (1065-1074); no `tabIndex`, no `role`, no keydown. Scenario:
keyboard operator cannot open any order row → delivered credentials / coupon
details are unreachable without a mouse. The refund journey's context (what is in
these orders) is invisible. Fix: move the toggle to a real `<button>` in the
chevron cell (`aria-expanded` on the row), drop the td click handlers.

**F3-03 · 4.1.2 + 2.4.3 · Admin topups: money dialogs are hand-rolled overlays (no trap, no semantics)**
`pages/admin/topups.tsx:154-233` (reject modal) and `:255+` (bulk confirm) — plain
`fixed` divs: no `role="dialog"`/`aria-modal`, no focus trap (Tab walks out of the
"modal" into the page behind), no focus return, ESC only handled from inside the
textarea (197-202). These are the two money-action dialogs in the topup approval
queue — exactly the class the shared `AppDialog` (app-dialog.tsx:7-33) was built to
retire. Fix: migrate both to `AppDialog` (or `useConfirm` for the bulk case).

**F3-04 · 4.1.2 · TopupWaitingModal: dialog has no accessible name**
`components/TopupWaitingModal.tsx:132` uses `DialogContent` (dialog.tsx) whose
bodies are plain `<h2>`s (222, 277, 343) — no `DialogTitle`, so Radix sets no
`aria-labelledby`; screen readers announce an unnamed "dialog" (plus the Radix dev
warning). Only remaining consumer of the legacy shell (verified: sole
`<DialogContent>` usage in src). Fix: render `<DialogTitle className="sr-only">`
per state (waiting/approved/rejected text already exists as the h2 — swap the tag).

**F3-05 · 2.4.11 · Fixed MobileNav / product sticky bar can obscure the focused element**
`components/layout/MobileNav.tsx:72` (`fixed bottom-0 … z-50`, 60px) +
`pages/product.tsx:1180` (`fixed … mobile-sticky-above-nav`). `mobile-nav-safe-pad`
reserves space at page END (B6-P1-7) but there is **no `scroll-padding-bottom` /
`scroll-margin`** anywhere (grep: zero matches) — a focused link/button scrolled
into view at the viewport bottom is fully covered by the nav/sticky bar. WCAG 2.2
new SC. Fix: `html { scroll-padding-bottom: calc(var(--mobile-nav-h) + 16px) }`
(and an extra offset for the product sticky bar route).

**F3-06 · 1.4.3 · Light theme: status-warning/success text fails AA on its own banners**
`index.css:304-308` light tokens: `--status-warning: 38 90% 45%` = **2.67:1 on
white, 2.44:1 on its 10% tint**; `--status-success: 152 60% 38%` = 3.52:1 / 3.23:1
(tint). Consumers are small bold text: checkout insufficient-balance + dropped-line
banners (`text-status-warning text-xs` checkout.tsx:1166, 1305), coupon-applied
notice (1265), TopupWaitingModal added-amount (283-284 — despite the 96-F6 comment
claiming the fix, the token itself still computes <4.5 on light). Dark theme passes
at 5.2-9.5:1. Fix: darken the light-mode tokens (warning ≈ `38 90% 30%`,
success ≈ `152 60% 30%`) or use dedicated foreground tokens for text-on-tint.

**F3-07 · 2.4.3 (SPA) · No route-change focus management or page announcement**
`App.tsx:425` scrolls to top on navigation but never moves focus; when the focused
nav link unmounts, focus silently falls to `<body>`. Every route transition is
unannounced to screen-reader users (only `document.title` changes, MetaTags.tsx:102).
Scenario: checkout success navigates to `/orders/:code` — the SR user hears the
toast, then nothing; their reading position/context is lost. Fix: on location
change, focus `#main-content` (it already exists, App.tsx:486 — give it
`tabindex="-1"`) and/or mount a polite route announcer keyed off the title.

**F3-08 · 1.1.1 + 4.1.2 · Admin orders: select-all / row-select are nameless icon buttons with no state**
`pages/admin/orders.tsx:938-947` (header) and `:999-1011` (rows) — `<button>`
wrapping only `CheckSquare`/`Square` lucide icons: no `aria-label`, no
`aria-pressed`/`aria-checked`. The selection state — the input to the bulk-refund
money action — is conveyed purely visually. Screen reader announces "button".
Fix: `aria-label` (e.g. «تحديد الطلب #CODE») + `aria-pressed`, or a real
`<input type="checkbox">`.

### P3 — Moderate

**F3-09 · 3.3.1 / 4.1.2 · Coupon + topup-amount errors announced but not bound**
checkout.tsx:1205-1234 — coupon errors render as a standalone `role="alert"` (1258)
but the field gets no `aria-invalid`/`aria-describedby`; same for the topup amount
field (wallet.tsx:1114; the submit-error banners `id="wallet-error"`/-2 at 1298/1451
are not referenced). Sender phone IS bound — parity gap only. Fix: bind like the
sender phone (r96 recipe).

**F3-10 · 2.1.2 · TopupWaitingModal dismiss lock (bounded)**
TopupWaitingModal.tsx:137-142 — ESC + outside-click blocked until the 30s cosmetic
timer elapses while Radix traps Tab. Intentional anti-loss guard and time-bounded,
but during the window there is no keyboard exit. Fix (optional): allow ESC once
`timedOut`, or add an immediate "minimize" escape that keeps polling.

**F3-11 · 4.1.3 · Silent async updates after the modal path**
`hooks/use-socket.ts:97-103` — `topup-updated` only invalidates queries; the wallet
balance figure (wallet.tsx:834 area) has no live region. If the user closed the
waiting modal via «إغلاق والمتابعة» (timedOut path), the balance change on the page
behind is visual-only. Order updates are fine (toast at use-socket.ts:21). Fix:
`aria-live="polite"` on the balance value (or a toast on approved topup when no
modal is open).

**F3-12 · 1.4.11 / 2.4.7 · WhatsApp phone + OTP inputs: 1.70:1 focus indicator**
WhatsAppPhoneSignIn.tsx:502, 581 — `outline-none focus:border-primary/50` (blended
1.70:1 vs the 1.15:1 resting border on dark card). These are raw inputs that skip
the shared `Input`. Also: Enter does not submit the phone step; the prefix hint
(538) is not `aria-describedby`-bound. Fix: use the shared `Input` or replicate
its ring (see F3-01 fix).

**F3-13 · 2.4.11 · Admin sticky `<thead>` can cover focused cells**
orders.tsx:933 (`sticky top-0 z-10 … backdrop-blur`) — tabbing through expanded
rows can scroll the focused button under the sticky header. Same scroll-padding
class of fix as F3-05 (`scroll-padding-top` for the admin table region).

**F3-14 · 4.1.2 · Coupon "تحقق" button loses its name while checking**
checkout.tsx:1253 — during `couponChecking` the label is replaced by a spinner-only
`<Loader2/>`; the accessible name becomes empty. Fix: keep «تحقق» text beside the
spinner or add `aria-label`.

---

## WCAG 2.2 specific checks

| SC | Check | Result |
|---|---|---|
| 2.4.11 focus-not-obscured (min) | MobileNav over focused content | **FAIL** — F3-05 (no scroll-padding) |
| 2.4.11 | Admin sticky thead | FAIL (minor) — F3-13 |
| 2.5.8 target size (min ≥24px) | Icon buttons sweep (`h-6/w-6/h-7…` grep) | **PASS** — matches are decorative divs; interactive targets ride the r96 44px floor (cart steppers, dialog close, CopyButton, coupon clear, paste button, MobileNav grid 60px). Smallest real controls are `Button size="sm"` = 32px ✓ |
| 3.3.7 redundant entry | Checkout re-entry | **PASS** — checkout collects nothing previously entered (coupon only); wallet remembers sender phones (saved-phones dropdown, wallet.tsx:1178) |
| 3.3.8 accessible auth (no cognitive test) | OTP paste | **PASS+** — `autoComplete="one-time-code"`, smart paste extracting digits from the whole message incl. Arabic-Indic, clipboard button (WhatsAppPhoneSignIn.tsx:561-596) |
| 2.4.7 focus visible | Global ring | PASS at the token level (3.76-3.96:1 dark, 4.82-5.30:1 light) — but see F3-01/F3-12 overrides on inputs |

## Admin tables — semantics

Real `<table>` + `<th scope="col">` (r96 #15) in **orders, risk, users**. All other
admin pages (topups, coupons, products, tickets, referrals, alerts…) render card/row
`<div>`s — acceptable as lists, but none use `role="table"`; the topups money queue
should be first in line for real table semantics (or `role="list"` rows) since it
is the approval surface. The hand-rolled modal issue (F3-03) lives in the same file.

## Contrast token audit (computed, WCAG relative luminance)

Dark theme (default) — **all pass**: fg/card 17.79 · muted-fg/card 8.00 ·
primary-text/card 5.75 · white-on-primary 4.94 · ring 3.76-3.96 · status tokens
5.2-9.5 · whatsapp-ink-on-green 7.84.
Light theme — passes: fg/bg 16.18 · muted-fg/white 6.72 · primary-text 5.30 ·
white-on-primary 5.30 · ring 4.82-5.30 · error 4.81 · info 4.46.
Light theme — **fails**: warning 2.67 (2.44 on tint) · success 3.52 (3.23) ·
low-stock 3.52 (borderline non-text only) — F3-06.
Focus indicators — global ring pass; **input ring 2.03 (dark) / 2.92 (light) fail**
(F3-01); WhatsApp inputs 1.70 fail (F3-12). Disabled controls 2.09-2.18 — exempt
under 1.4.3 (inactive components), noted for the r112+ polish queue.

## Top-3 keyboard blockers (fix first)

1. **F3-02** — admin orders row expansion is mouse-only (2.1.1): delivered
   credentials unreachable by keyboard in the money queue.
2. **F3-03** — admin topups reject/bulk dialogs have no focus trap/return/semantics
   (2.4.3/4.1.2): keyboard focus escapes behind the money modal; ESC unreliable.
3. **F3-01 (+F3-12)** — every text field's focus indicator is below 3:1
   (1.4.11, 1.70-2.92:1): keyboard users cannot reliably see focus in any form,
   storefront or admin.

## Verified-good (do not re-audit)

Skip link (App.tsx:468-474, V2-H1) + `#main-content` · global keyboard-only focus
ring with mouse-click suppression (index.css:1007-1019) · letter-spacing guard ·
RTL-aware 44px dialog close (dialog.tsx:56-63) · AppDialog (focus trap, aria-modal,
Title/Description, guarded dismiss, keyboard-obscuring scroll mitigation
app-dialog.tsx:84-108) · useConfirm AlertDialog wiring · Sonner toaster (RTL, app
theme, top-center clear of bottom nav) · h1 on every route (login/register sr-only) ·
per-route document.title · Navbar/MobileNav aria-labels + aria-current · cart
steppers with labels incl. qty→delete semantics · CopyButton live state ·
NotificationBell (role=dialog, aria-haspopup/expanded, Esc, panel focus,
NotificationBell.tsx:312-470) · plan-picker radiogroup · aria-busy wallet probe ·
role=alert on all checkout money failures · OTP paste/auth excellence (3.3.8) ·
no `dangerouslySetInnerHTML` · no `tracking-*` on Arabic (guarded).

## Fix-queue sketch (for the R111 fix fleet)

Wave A: F3-01, F3-02, F3-03, F3-08 (money-path keyboard + indicators).
Wave B: F3-04, F3-05, F3-06, F3-07 (dialog name, scroll-padding, light tokens, route focus).
Wave C: F3-09-F3-14 (bindings, live regions, minor indicators/labels).
