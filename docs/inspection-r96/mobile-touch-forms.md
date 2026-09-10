# R96-A2 — Mobile Touch, Forms & Interaction Audit (Storefront)

- **Agent:** R96-A2 (diagnostic, research-only — no source modified)
- **Date:** 2026-09-08 (Round 96 mobile focus)
- **Scope:** every file on the audit list, read fully: `ui/button.tsx`, `ui/input.tsx`, `ui/dialog.tsx`, `ui/app-dialog.tsx`, `ui/switch.tsx`, `ui/alert-dialog.tsx`, `ui/label.tsx`, `ui/sonner.tsx`, `CopyButton.tsx`, `ProductCard.tsx`, `TopupWaitingModal.tsx`, `LinkConsentModal.tsx`, `WhatsAppPhoneSignIn.tsx`, `TelegramLoginButton.tsx`, `NavigationProgress.tsx`, `pages/login.tsx`, `register.tsx`, `checkout.tsx`, `cart.tsx`, `wallet.tsx`, `support.tsx`, `order-detail.tsx`, `profile.tsx`, `onboarding.tsx`, `layout/MobileNav.tsx`, `layout/Navbar.tsx`, `layout/NotificationBell.tsx`, `hooks/use-confirm.tsx`, `hooks/use-toast.ts`, `lib/cart.tsx`, `lib/utils.ts (copyToClipboard)`, `index.css` (touch/press/toast blocks), `index.html`, `App.tsx`, + spot-checks of `pages/product.tsx`, `pages/orders.tsx`, `pages/home.tsx`, `pages/admin/orders.tsx`, `pages/admin/tickets.tsx`, `components/AuthProviders.tsx`, `components/SessionManager.tsx`.
- **Device baseline:** 360×800 CSS px Android (48dp Material floor) and 390×844 iPhone (44px HIG floor), RTL Arabic, virtual keyboard open scenarios included.

## Summary table

| Severity | Count | One-line characterization |
|---|---|---|
| **P0** (blocks task completion on phone) | **0** | No true phone-blocker found; the money funnels are guarded |
| **P1** (frustration / money-risk) | **7** | 26px cart steppers with silent line-delete; unconfirmed cart wipe; silent credential-copy failure; ~28px credential buttons; unselectable+truncated password; non-decimal numeric keyboard on the top-up amount; double-tap add-to-cart |
| **P2** (polish with real mobile cost) | **12** | Hover-only toast-close & copy icons; keyboard/visualViewport gaps; sub-44 shared Button & AlertDialog sizes; checkout CTA ergonomics; micro-controls in support/wallet/profile/WhatsApp flows; 24px unlink-account button without confirm; admin 28px row actions |
| **P3** (nits) | **7** | No enterKeyHint anywhere; 36–38px chips; missing maxLength; missing press feedback on notification rows; no stepper hold-acceleration; toast overlapping Navbar; no haptics |
| **Total** | **26** | |

### Verified strengths (so fixes don't regress them)
- `index.css:385-393` — `touch-action: manipulation` on button/a/[role=button]/input/select/textarea (kills 300ms double-tap-zoom delay); `index.css:994-999` — `-webkit-tap-highlight-color: transparent`.
- `index.css:360-361` — `overscroll-behavior-y: contain` on body blocks pull-to-refresh while a checkout/topup form is filled (checklist #11 ✅).
- `index.css:866-872 + 1220-1222` — `press-spring` with a mobile-tuned `scale(0.97)`; `index.css:985-992` — keyboard-only `:focus-visible` ring; `1240-1251` — global reduced-motion kill-switch.
- `index.css:1135-1138` — `.touch-target {min-height/width: 44px}` utility, actually used on Navbar/bell/dialog close buttons.
- `ui/dialog.tsx:49` + `ui/app-dialog.tsx:133-142` — dialog close buttons are 44×44 (`h-11 w-11 touch-target`) with `aria-label="إغلاق"` + sr-only text; RTL-aware corner placement.
- `ui/app-dialog.tsx` — bottom-sheet on mobile, scrolling body, `max-h-[85vh]`, and `dismissable={!loading}` guarded ESC/backdrop/close (money-flow dismissal protection, checklist #8 ✅); `TopupWaitingModal.tsx:137-142` — same guard while a topup is pending.
- Double-submit protection verified on: checkout (`submitting` disables CTA, checkout.tsx:250-254/747-762), wallet topup (`submitting || topupMutation.isPending`, wallet.tsx:997-1003/1120-1128), product buy (`isPending`, product.tsx:1236-1239), support create/reply (`if (submitting/sending) return` guards that also cover the Enter-key bypass, support.tsx:241-283), WhatsApp OTP (`autoSubmittedFor` once-guard + disabled buttons, WhatsAppPhoneSignIn.tsx:201-208), Telegram redirect (disabled while loading), `useConfirm` double-tap resolver guard (use-confirm.tsx:60-65). Cart is localStorage-only so rapid stepper taps fire no API calls (lib/cart.tsx).
- `WhatsAppPhoneSignIn.tsx:311-350` — OTP input has `inputMode="numeric"`, `autoComplete="one-time-code"`, smart paste (digits extracted from the whole WhatsApp message), clipboard-paste button (44px), single-field with functional 6-digit cap.
- `MobileNav.tsx:31,53` — 60px tab strip, 5 columns ≥ 60px wide each on a 360px screen; `press-spring` + `select-none`; safe-area padding; clearance system (`--mobile-nav-h`) guarded by `mobile-nav-clearance.test.tsx`.
- Radix primitives give every dialog focus trap + body scroll-lock + focus return (checklist #8 ✅); `.pb-safe`/`pt-safe`/`mobile-sticky-*` handle notches (index.css:1147-1208).

---

## P1 — Frustration / money-risk

### P1-1. Cart quantity steppers & row-delete are ~26×26px, and the minus-at-qty-1 silently deletes the line
- **Evidence:** `frontend/src/pages/cart.tsx:214-225` (minus/X button: `className="p-1.5 hover:bg-secondary/70 …"` containing `<X|Minus className="w-3.5 h-3.5">` → 14px icon + 12px padding = **26×26 hit box**), `cart.tsx:229-236` (plus, same), `cart.tsx:238-245` (row trash, same). Route logic `cart.tsx:59-68`: `if (qty < 1) { removeItem(productId); return; }` — no toast, no undo.
- **Mobile scenario:** On a 360px phone the stepper cluster (minus/qty/plus/trash) fits in ~130px with **zero gap padding between the 26px buttons**. The user rapid-taps "+" twice; the second tap lands on the trash (4px away) → the whole line disappears with **no feedback and no undo**. Same for minus at qty=1 — it morphs into delete (correct affordance switch, but a 26px target and a silent destructive result).
- **Fix direction:** Raise all four controls to `min-h-11 min-w-11` (`touch-target`), add ≥8px spacing between stepper and trash (or move delete behind a long-press/swipe), show a toast with "تراجع" undo for line removal, and debounce/confirm the qty→0 transition with the existing `useConfirm()`.

### P1-2. «إفراغ السلة» — destructive, unconfirmed, 32px target, no undo
- **Evidence:** `frontend/src/pages/cart.tsx:126-134` — `<Button variant="ghost" size="sm">` → `button.tsx:32` `sm: "min-h-8 …"` = **32px height**; `handleClear` (cart.tsx:74-90) clears localStorage immediately and only fires the server DELETE as fire-and-forget.
- **Mobile scenario:** The button sits at the top of the cart (thumb-reachable, good) but one mis-tap wipes every line; the toast "تم إفراغ السلة" arrives post-mortem. The house standard for destructive actions is `useConfirm()` (SessionManager.tsx:35, every admin page per `no-native-confirm.test.ts`) — the storefront's most destructive cart action skips it.
- **Fix direction:** `const { confirm, ConfirmDialog } = useConfirm()` → `destructive: true` confirm before `clear()`; bump the button to default size + `min-h-11`.

### P1-3. Credential copy fails silently on the exact screen the user paid for
- **Evidence:** `frontend/src/pages/order-detail.tsx:45-50` — `const ok = await copyToClipboard(value); if (!ok) return;` (no failure state, label stays «نسخ»); identical pattern `frontend/src/pages/product.tsx:101-106`. Contrast: the shared `components/CopyButton.tsx:43-64` explicitly renders «تعذّر النسخ» on failure and was created precisely to de-duplicate this lifecycle ("the old button silently kept the نسخ label — the user had no idea the copy never happened").
- **Mobile scenario:** `copyToClipboard` (lib/utils.ts:261-284) returns `false` on insecure context, permission denial, or `execCommand` rejection (common in Android WebViews / Telegram in-app browser — a primary Libyan traffic source). The user taps «نسخ» on their delivered Netflix password, nothing is on the clipboard, the button gives zero signal, and the manual long-press fallback is blocked by P1-5 below.
- **Fix direction:** Replace both local CopyField/CredentialRow implementations with the shared `CopyButton` (size="md"), which already carries the failed branch + timer hygiene.

### P1-4. Credential copy/reveal buttons are the smallest controls on the delivery screen (~28px)
- **Evidence:** `frontend/src/pages/order-detail.tsx:72-76` (reveal: `px-2.5 py-1.5 rounded-xl text-xs` + `w-3 h-3` icon ≈ 28×30px) and `order-detail.tsx:78-88` (copy, same); `frontend/src/pages/product.tsx:112-120, 122-145` (identical pair).
- **Mobile scenario:** The «بيانات الحساب» card is the entire point of the post-purchase page; its only actions are 28px pills while the page's decorative buttons («تصفح المزيد») are 44px. Mis-taps hit the neighboring row's identical pill (email copy vs password reveal are visually twins).
- **Fix direction:** `min-h-11` on both pills (CopyButton already does `min-h-11`, see CopyButton.tsx:76) and visually separate reveal from copy (reveal as a full-row toggle on the label side).

### P1-5. Password value is trapped inside a `<button>` (unselectable on iOS) and visually truncated at 160px
- **Evidence:** `frontend/src/pages/product.tsx:122-135` — the credential VALUE renders as `<span className="max-w-[160px] truncate">` **inside the copy `<button>`**. iOS Safari treats button content as non-selectable (long-press shows a callout, not text selection); `select-none` isn't even needed. order-detail.tsx:60-66 keeps the value in a selectable `<div>` (correct) but has no truncation guard for very long passwords either (break-all handles wrap).
- **Mobile scenario:** A 20-char password is clipped visually ("Netflixxxxxxxxx…") — the user cannot read it, and on iOS cannot long-press-select it either. Combined with P1-3 (silent copy failure), there is **no working fallback path** to retrieve the paid credential on the success screen.
- **Fix direction:** Move the value into a non-button `select-text` element (as order-detail does), drop `max-w-[160px] truncate` for `break-all`, and keep the copy affordance as a sibling ≥44px button.

### P1-6. Wallet top-up amount: `type="number"` without `inputMode="decimal"` (and no enterKeyHint / autoComplete=off)
- **Evidence:** `frontend/src/pages/wallet.tsx:851-872` (mobile-transfer amount) and `wallet.tsx:1059-1076` (LyPay amount) — both `<Input type="number" …>` with no `inputMode`, no `enterKeyHint`, no `autoComplete="off"`. Grep across `frontend/src` confirms **zero** `enterKeyHint` occurrences project-wide.
- **Mobile scenario:** On Arabic-locale iOS, `type="number"` opens a keypad with **no decimal separator** (and Arabic-Indic digits) — the user literally cannot type "1.5". The form's own semantics (`step="0.5"`, `onBlur` rounding to 0.5, min 0.01) prove fractional amounts are expected. Browser autocomplete may also inject junk into the money field.
- **Fix direction:** `type="text" inputMode="decimal" autoComplete="off" enterKeyHint="done"` + keep the digit-sanitizing onChange (already exists for phones — mirror it for the amount).

### P1-7. Add-to-cart double-tap adds two units (no disable, no dedupe window)
- **Evidence:** `frontend/src/components/ProductCard.tsx:159-174` — `handleAddToCart` calls `addItem(...)` synchronously per tap; the button (ProductCard.tsx:359-366) has `active:scale-[0.98]` feedback but **no in-flight/just-added disable**; `lib/cart.tsx:71-95` `addItem` happily increments to qty=2. Same for the product page's secondary «أضف للسلة» (product.tsx:1250-1258) — note the *primary buy* path IS guarded (`disabled={isPending}`, product.tsx:1238).
- **Mobile scenario:** Low-end Android + 300ms of feedback latency = the classic accidental double-tap. The cart badge jumps to 2 and, on the product→checkout funnel, the user is charged twice unless they notice the summary line. (Not a server double-charge — the per-unit Idempotency-Key only guards the *submit*, not the quantity.)
- **Fix direction:** Brief 400-600ms re-entry lock in `handleAddToCart` (ref timestamp) or swap the button into a "✓ في السلة" disabled state for ~1s — the toast already confirms the first add.

---

## P2 — Real mobile cost (polish class)

### P2-1. Sonner toast close button: invisible on touch (hover-only reveal) and 22×22px
- **Evidence:** `frontend/src/index.css:1368-1388` — `[data-close-button] { opacity: 0; … width: 22px; height: 22px }`, revealed only by `.premium-toast:hover` / `:focus-within`. Touch has no hover; screen-reader focus works but sighted touch users see nothing.
- **Scenario:** An error toast (8s duration) covers the top of the checkout; the user wants it gone now — the X is invisible and, even found, is half the 44px floor. Swipe-to-dismiss exists (sonner `dir="rtl"` handles direction) but is undiscoverable.
- **Fix:** `@media (hover: none) { …[data-close-button] { opacity: 1; width:28px; height:28px; } }` + enlarge padding hit area.

### P2-2. No virtual-keyboard strategy: viewport meta lacks `interactive-widget`, zero `visualViewport` handling
- **Evidence:** `frontend/index.html:7-9` — `content="width=device-width, initial-scale=1, viewport-fit=cover"` (no `interactive-widget=resizes-content`); repo-wide grep for `visualViewport|keyboardWillShow|interactive-widget` → **no matches**.
- **Scenario:** Android default (`resizes-visual`): page content doesn't reflow when the keyboard opens — the focused wallet amount field can sit under the keyboard with only the browser's scroll-into-view fighting the `page-in` layout; Radix body scroll-lock while a dialog is open makes `scrollIntoView` a no-op, so a focused input inside an `AppDialog` (admin coupon/user forms use it) can be permanently keyboard-obscured. iOS: fixed bottom elements (MobileNav, product sticky buy bar) exhibit the notorious jump-above-keyboard behavior with no compensation.
- **Fix:** Add `interactive-widget=resizes-content` to the viewport meta (cheapest, helps Android immediately); in `AppDialog`, add a focus listener that `scrollIntoView({block:'center'})` the focused field inside the body region.

### P2-3. MobileNav stays fixed while the keyboard is open (iOS overlap class)
- **Evidence:** `frontend/src/components/layout/MobileNav.tsx:41` — `fixed bottom-0 left-0 right-0 z-50`, no keyboard-aware hide.
- **Scenario:** Typing a support reply / wallet amount on iOS: the 60px nav (plus its blur layer) rides above the keyboard and eats vertical space next to the caret; on some iOS versions it visually covers the focused input's row.
- **Fix:** A tiny `visualViewport` resize hook (offset > 120px → `hidden`) or CSS `@media (max-height: 480px) { …md:hidden }` style gate on small landscape/keyboard heights.

### P2-4. Shared Button + AlertDialog action sizes are below the 44/48 floor on mobile
- **Evidence:** `frontend/src/components/ui/button.tsx:31-34` — `default: min-h-9` (36px), `sm: min-h-8` (32px), `icon: h-9 w-9` (36px). `ui/alert-dialog.tsx:87` (`AlertDialogAction` → `buttonVariants()` default = 36px) and `:97` (Cancel, 36px + `mt-2`): **every `useConfirm()` money/destructive confirm renders 36px buttons**. Consumers below the floor: cart clear (32px, cart.tsx:126), checkout coupon apply/remove (36px, checkout.tsx:576-596), checkout empty-state browse (32px, checkout.tsx:637), support header buttons (347: `w-9 h-9`=36px; 397: `p-2`+w-4=32px; 554: `w-10 h-10`=40px), admin bulk chips `h-7` (28px, admin/orders.tsx:706-751), admin tickets send `h-10 w-10` (40px, tickets.tsx:658-671).
- **Scenario:** The confirm dialog for a destructive wallet adjustment has smaller buttons than the decorative ones elsewhere; repeated mis-taps on «تأكيد»/«إلغاء» pairs (adjacent in the `flex-col-reverse` mobile footer).
- **Fix:** Mobile media bump inside `buttonVariants` (e.g. base `min-h-11` under a `max-md:` variant), or per-instance `className="h-11"` on dialog footers; raise `sm`/`icon` to 44px gradually (they're already used with `touch-target` overrides in Navbar — codify that).

### P2-5. Checkout money-CTA ergonomics: no sticky thumb-zone CTA, no double-confirm for the wallet debit
- **Evidence:** `frontend/src/pages/checkout.tsx:747-762` — the «تأكيد الطلب» button lives in the normal-flow summary card (below payment method + coupon cards); on a 5+ item cart it's under the fold; nothing sticky (compare product.tsx:843-886 which has a dedicated `sm:hidden` sticky buy bar). Single tap = wallet charge (no `useConfirm`), while far less consequential actions (admin coupon activation) do confirm.
- **Scenario:** User on a bus taps «تأكيد الطلب» mid-scroll-read; must scroll past the fold to even find the button, and one tap commits the money with no confirmation step on a small screen.
- **Fix:** Optional `sm:hidden` sticky summary+CTA above MobileNav mirroring the product page; optionally a one-time `useConfirm` when total > a threshold (or first-ever purchase) — do NOT add friction to repeat buyers.

### P2-6. Support page micro-controls: 36px back, 32px close-form, 40px send + Enter-submits-single-line reply
- **Evidence:** `frontend/src/pages/support.tsx:344-350` (back `w-9 h-9`), `:391-400` (close `p-2`+`w-4`), `:550-564` (send `w-10 h-10`); reply input `:536-549` is a single-line `<Input>` where Enter submits (no `enterKeyHint="send"`, no textarea).
- **Scenario:** Ticket thread is the post-sale lifeline; the send button at 40px next to a 40px input invites mis-taps, and users composing a longer reply can't insert line breaks — Enter fires the (guarded) submit mid-sentence.
- **Fix:** `w-11 h-11` on send/back/close; `enterKeyHint="send"`; consider a 2-row auto-growing textarea like the admin ticket reply.

### P2-7. Wallet form chips: saved-phone chips ~26px, amount presets ~36px
- **Evidence:** `frontend/src/pages/wallet.tsx:907-919` — saved sender phones: `px-2.5 py-1 … text-xs` ≈ 26px; presets `:836-849` / `:1044-1057` — `min-w-[52px] py-2` ≈ 36px.
- **Scenario:** Selecting the previously-used phone (a money-verification field!) requires hitting a 26px chip; on the 6-preset row the tap lands between chips, doing nothing.
- **Fix:** `min-h-11` on both chip families (wrap is already `flex-wrap`).

### P2-8. Profile «فصل» unlink-provider: 24px destructive icon button, no confirmation
- **Evidence:** `frontend/src/pages/profile.tsx:361-372` — `className="… p-1"` with `<Unlink className="w-4 h-4">` → **24×24** target, adjacent to the «نشط» badge; `handleUnlinkProvider` (profile.tsx:118-141) fires immediately, no `useConfirm`.
- **Scenario:** Unlinking the last provider can lock the account out of its only sign-in method — a destructive account-security action behind a 24px unlabeled-icon tap next to another tappable-looking element.
- **Fix:** `useConfirm({ destructive: true })` + `h-11 w-11 touch-target` + visible text label («فصل»).

### P2-9. WhatsApp OTP flow micro-links + autoFocus keyboard jump on the centered 100dvh login
- **Evidence:** `frontend/src/components/WhatsAppPhoneSignIn.tsx:298-306` and `:364-372` — «تراجع»/«تغيير الرقم»: `text-xs … gap-1` with `w-3 h-3` icon ≈ 18px tall targets. `:335` — `autoFocus` on the OTP input; `pages/login.tsx:78` — `min-h-[100dvh] flex items-center justify-center` centered card.
- **Scenario:** Step transition to «code» auto-focuses → keyboard opens instantly → on small phones (SE-class 667px) the centered card + 3 provider buttons push the OTP row toward the keyboard edge; the tiny «تغيير الرقم» escape link is the only way back to fix a wrong phone number and it's an 18px tap.
- **Fix:** `min-h-11 py-2` on the reset links; keep autoFocus (it's correct OTP UX) but add `enterKeyHint="done"` and rely on P2-2's `resizes-content` to reflow.

### P2-10. Order-code copy affordance is hover-only
- **Evidence:** `frontend/src/pages/order-detail.tsx:291` — `<Copy className="w-2.5 h-2.5 opacity-0 group-hover/code:opacity-100 …">` inside the tappable order-code button (order-detail.tsx:285-292).
- **Scenario:** The whole code is the button (tap = copy, with toast feedback — good), but the icon that *signals* copyability never appears on touch, so users never learn the code is tappable and long-press to select instead (works — the span is selectable).
- **Fix:** `opacity-60 md:opacity-0 md:group-hover/code:opacity-100` (always faintly visible on touch), or drop the hover pattern entirely.

### P2-11. Admin-on-phone row actions at 28px
- **Evidence:** `frontend/src/pages/admin/orders.tsx:706-751` — bulk/status chips `h-7 text-xs` (28px); `admin/orders.tsx:522-524` documents the search clear button at ~28px with a comment acknowledging the audit floor; `admin/tickets.tsx:658-671` — icon send `h-10 w-10` (40px).
- **Scenario:** Approving a topup / advancing an order status from a phone at night — the money-adjacent admin actions are the smallest tap targets in the app.
- **Fix:** `h-9`→`min-h-11` on action chips; the admin is desktop-first so this can trail the storefront fixes.

### P2-12. Checkout error-banner dismiss «X» ≈ 22px
- **Evidence:** `frontend/src/pages/checkout.tsx:736-743` — `className="shrink-0 p-1 -m-1 rounded-md hover:bg-status-error/10"` + `w-3.5 h-3.5` icon.
- **Scenario:** The persistent money-error banner (correctly persistent per its comment) can only be dismissed via a 22px X tucked inside the red text block — adjacent to the «راجع طلباتك» link, so a missed tap navigates away mid-recovery.
- **Fix:** `h-11 w-11 -m-2 p-2` + `aria-label` (already present) + keep negative margin trick.

---

## P3 — Nits

### P3-1. No `enterKeyHint` project-wide; checkout coupon input lacks `autoComplete="off"`
- Grep: 0 occurrences of `enterKeyHint`. `checkout.tsx:556-575` coupon Input (dir=ltr, font-mono) will happily autofill from Safari's saved coupons/emails on iOS. Add `autoComplete="off" enterKeyHint="send"` (Enter already applies the coupon, checkout.tsx:565-570 — good desktop/mobile keyboard affordance otherwise).

### P3-2. Category/filter chips at 36–38px
- `home.tsx:686-700` (`min-h-[38px]`), `home.tsx:306/321` (category pills `py-2.5` ≈ 40px), `orders.tsx:212-241` filter chips, `support.tsx:591` (`min-h-[36px]` category pills). Cosmetic-adjacent controls — one notch below the floor; raise when touching these files.

### P3-3. Support form fields lack `maxLength`
- `support.tsx:606-612` (title Input) and `:617-625` (message textarea) — no client-side caps; backend enforces, but a phone user typing a long message gets a server round-trip error instead of a live cap. Add `maxLength` mirroring the API contract (e.g. title 120 / message 2000, per backend validation).

### P3-4. Notification rows lack press feedback
- `NotificationBell.tsx:473-512` — row button has `hover:opacity-85` only (no `active:` state); every other list row in the app (tickets, orders, cards) has an active scale. Add `active:scale-[0.99]` for tactile parity.

### P3-5. Cart steppers have no press-and-hold acceleration
- `cart.tsx:214-236` — 99 units means up to 98 taps. Once P1-1 enlarges the targets, add pointer-hold repeat (or a tap→inline number entry) for quantities > 5.

### P3-6. Toast stack overlaps the sticky Navbar visually
- `ui/sonner.tsx:37-41` — `position="top-center" offset="20px"` with the Navbar being `sticky h-14` + FlashSaleBanner below it: the first toast lands over the nav/logo area rather than under it. Compute offset from nav height (56 + banner) or use `--mobile-nav-h`-style CSS var for top offset.

### P3-7. No haptic confirmation on money actions
- No `navigator.vibrate` usage anywhere. Optional: 10ms success haptic on order confirmed / topup approved (Android-only API, safe no-op on iOS).

---

## Checklist coverage map (auditor's 12 items → findings)

| # | Checklist item | Status |
|---|---|---|
| 1 | Tap target sizes | P1-1, P1-4, P2-4, P2-6, P2-7, P2-8, P2-11, P2-12, P3-2 (MobileNav, Navbar, dialog close, CopyButton, notification actions = compliant) |
| 2 | Hover-only affordances | P2-1 (toast X), P2-10 (order-code copy icon); ProductCard desktop hover-CTA is properly `hidden md:block` + focus-within; no Radix Tooltip in storefront (only Recharts in admin dashboard); alerts.tsx:658 uses the correct `opacity-100 sm:opacity-0` touch-safe pattern |
| 3 | Touch ergonomics / destructive spacing | P1-2, P2-5 (checkout CTA placement), P1-1 (trash adjacent to plus), P2-8 (unlink) |
| 4 | Double-tap zoom & gestures | ✅ `touch-action: manipulation` (index.css:392), ✅ tap-highlight (index.css:998), ✅ overscroll contain (index.css:361), ✅ button `select-none` (button.tsx:8) with credential text kept selectable (order-detail) — EXCEPT product.tsx value-in-button (P1-5) |
| 5 | Form mobile UX | P1-6 (amount keyboard), P2-9 (OTP micro-links), P3-1 (enterKeyHint/autoComplete), P3-3 (maxLength); ✅ OTP: inputMode+one-time-code+smart paste+single field; ✅ wallet phone: type=tel+live validation adjacent to field; ✅ labels: wallet/support use Label+htmlFor; ⚠️ checkout coupon & wallet amount are placeholder-only+aria-label (borderline, has visible section heading) |
| 6 | Virtual keyboard | P2-2, P2-3 (no visualViewport / interactive-widget / scrollIntoView-in-dialog) |
| 7 | Press feedback & focus rings | ✅ press-spring + card-spring + mobile-tuned scale (index.css:866-872, 1211-1223); ✅ :focus-visible ring (index.css:985-992); P3-4 (notification rows) |
| 8 | Dialogs on touch | ✅ AppDialog guarded dismiss + focus trap + scroll lock (app-dialog.tsx:77-82, docblock); ✅ TopupWaitingModal ESC/backdrop guard (TopupWaitingModal.tsx:137-142); plain `dialog.tsx` close = 44px RTL-correct |
| 9 | Toasts | ✅ top-center (no MobileNav clash), 4s/8s severity durations, dir=rtl (swipe honored), rich premium styling; P2-1 (close button), P3-6 (overlap) |
| 10 | Long-press / clipboard | P1-3 (silent failure), P1-5 (unselectable value), ✅ CopyButton has failure feedback + is used on profile/order code (toast feedback); admin CopilotPanel uses shared CopyButton; order-detail/product use LOCAL reimplementations (root cause of P1-3) |
| 11 | Pull-to-refresh | ✅ `overscroll-behavior-y: contain` on body (index.css:360-361) — checkout/topup forms survive the pull gesture |
| 12 | Race conditions in taps | ✅ all money submits guarded (see Strengths); P1-7 (add-to-cart double-tap); ✅ cart steppers local-only (no API race); ✅ support Enter-bypass guarded (support.tsx:246, 281) |

## Recommended fix order (for the fixing agent)
1. **P1-3 + P1-4 + P1-5 as one commit** — swap order-detail/product credential rows onto the shared `CopyButton` (size="md"), value in a selectable non-truncated div. Smallest diff, highest user value.
2. **P1-1 + P1-2** — cart stepper 44px + spacing + `useConfirm` on clear + undo toast.
3. **P1-6** — two-line change on the two amount Inputs (`inputMode="decimal" enterKeyHint="done" autoComplete="off"`).
4. **P1-7** — re-entry lock in `handleAddToCart` (ProductCard + product page).
5. **P2-2** — viewport meta `interactive-widget=resizes-content` + AppDialog focus-scrollIntoView.
6. Remaining P2s in file-touch order; P3s opportunistically.
