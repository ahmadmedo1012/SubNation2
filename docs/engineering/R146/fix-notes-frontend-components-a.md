# R146 fix notes — frontend components / hooks / lib helpers (lane 4a)

Agent: 146-FIX-4a (ponytail-fix-frontend-components-a). Audit base: the
findings in `docs/engineering/R146/audit-frontend-components.md`.

Scope guard: Navbar.tsx / lib/utils.ts / lib/categories* / ProductCard.tsx /
CategoryRail.tsx / category-presentation.ts / products-meta.ts /
catalog-filters.ts / pages/category.tsx / the two Telegram+socket hooks were
NOT touched (parallel lane 146-FIX-4b owns them). The pages lane's already
landed edits (product.tsx F1/F2, CopyField rowClassName, SEO blocks, …) were
read and preserved.

Commands (repo root, per the ponytail targeted-test rule):
`pnpm --filter @workspace/subnation exec vitest run <paths>` · typecheck
`pnpm --filter @workspace/subnation exec tsc -p tsconfig.json --noEmit` (exit 0)
· `pnpm exec prettier --check <lane files>` (clean after one --write pass, see
below). No git commit/push, no pnpm install, no full suites, no e2e.

---

## T1 (audit F1) — trapTabKey: NotificationBell + admin focus-trap folded onto the shared helper

- `components/layout/NotificationBell.tsx`: local 22-line `trapTabKey` body
  deleted (~:42 old); `import { trapTabKey } from "@/lib/a11y/trap-tab-key"`
  added; the R133 docblock now points at the shared helper. The panel's
  `onKeyDown` wiring and `aria-modal` contract untouched.
- `components/admin/layout/focus-trap.ts`: local body deleted; the module is
  now a one-line verbatim re-export
  (`export { trapTabKey } from "@/lib/a11y/trap-tab-key";`) so its two
  consumers (pages/admin/layout.tsx drawer, GlobalSearch ⌘K palette) keep
  their import path.
- `lib/a11y/trap-tab-key.ts`: docblock note only (the fold is recorded; the
  selector body is unchanged — byte-identical to every former copy, verified
  byte-level with `od -c` after the shell display mangled `[h` in `a[href]`).
- Navbar's copy belongs to lane 4b (already folded in the shared tree when
  this lane ran; not touched here).
- **Pins updated (1):** `pages/__tests__/admin-layout-decomposition-r137.test.ts`
  — `expect(focusTrap).toContain("export function trapTabKey(")` → the
  re-export form, with the one-line rationale comment (local body was
  byte-identical; the React-free guarantee still holds). The Navbar pins are
  4b's.
- **Test evidence:** notification-bell-panel 8/8 (includes the behavioral
  Tab wrap / Shift+Tab wrap / focus-return dialog-contract tests — they now
  exercise the shared helper through the component), notification-bell-markread
  3/3, admin-layout-decomposition-r137 10/10, admin-shell-dashboard-r139
  22/22 (drawer `trapTabKey(drawerRef.current, e)` source pin), global-search
  7/7, status-tokens 7/7 (TYPE_CONFIG import path).

## T2 (audit F3) — one intent-key envelope, four thin modules

- NEW `lib/intent-envelope.ts` (74 lines incl. docblock):
  `loadIntentKey(storage, slot, ttlMs, fingerprint)` / `persistIntentKey(storage,
  slot, fingerprint, key)` / `clearIntentKey(storage, slot)` over the `{k,t,f}`
  shape. Every guard from every former copy preserved verbatim:
  JSON.parse-failure → treated as absent (pre-envelope raw keys mint fresh),
  `k` string check, `t` number/NaN check, TTL check, fingerprint check,
  try/catch on every access (private-mode/quota degrades, never throws on the
  money path).
- `components/checkout/checkout-unit-key.ts` (−54/+30): keeps
  `CHECKOUT_KEY_PREFIX` / `CHECKOUT_KEY_TTL_MS` / `checkoutUnitKeyId` (the
  line-scoped AUD103-2-F1 slot) + the docblock rationale; the three functions
  delegate. Same names exported: `loadCheckoutUnitKey` /
  `persistCheckoutUnitKey` / `clearCheckoutUnitKey`.
- `components/product/buy-intent-key.ts` (−41/+12): keeps `BUY_KEY_PREFIX` /
  `BUY_KEY_TTL_MS` / `buyIntentKeyId`; delegates under the same names.
- `components/wallet/topup-intent-key.ts` (−29/+11): keeps
  `TOPUP_KEY_SLOT` / `TOPUP_KEY_TTL_MS` / `topupIntentFingerprint`; delegates;
  **deliberately does NOT import `clearIntentKey`** — topup stays
  rotation-only (96-F6 reset points own every rotation), documented in the
  module header.
- `components/loyalty/loyalty-convert-key.ts` (−32/+12): keeps
  `CONVERT_KEY` / `CONVERT_KEY_TTL_MS`; delegates under the same names.
- `lib/idempotency.ts`: +4 docblock lines pointing the R-140-o flow map at the
  shared envelope.
- **Pins updated: none.** The mandated page-level pins pass UNCHANGED:
  checkout-idempotency-keys 10/10, product-buy-intent-key 6/6,
  loyalty-convert-journey 7/7, money-races-r140 21/21 (imports all four
  modules by name — the {k,t,f} parse/TTL/fingerprint behavior is asserted
  against real localStorage/sessionStorage), wallet-decomposition-r136 8/8
  (TTL + slot source pins), plus checkout-decomposition-r136 7/7,
  product-decomposition-r135 9/9, loyalty-decomposition-r137 9/9, and the
  behavior suites wallet-submit / wallet-money-gates / loyalty-error-state
  31/31.

## T3 (audit F4) — one ApiError reader

- `components/checkout/checkout-errors.ts`: grew THE reader —
  `export function readApiError(error): { status?: number; data?: Record<string, unknown> } | null`
  (duck-type `err instanceof Error && err.name === "ApiError"`; `status` kept
  only when typeof number; `data` kept only when a non-null object — matching
  the old per-site `!data || typeof data !== "object"` arms exactly).
  `isHttpApiError` / `apiErrorData` keep their names and now delegate to it
  (checkout.tsx and loyalty.tsx call sites unchanged).
- `components/checkout/coupon-quote.ts` (:129-153 old): the inline duck-type +
  `.status`/`.data` casts replaced by `readApiError(err)`; the 4xx≠429 +
  parsed-Arabic-`error` verdict logic is byte-identical (`api.status !==
  undefined` ⟺ the old `typeof status === "number"`; `NaN` falls to the same
  transient arm).
- `components/WhatsAppPhoneSignIn.tsx` (:228-240 old): `apiErrorEnvelope` is
  now a thin typed wrapper over `readApiError(err)?.data ?? null` — the
  duck-type copy is gone, the wider local return type stays local.
- `pages/product.tsx` (:335, :428 current): the 404 re-quote arm and the
  definitive-clear (`!== IDEMPOTENCY_IN_FLIGHT`) arm read through
  `readApiError`; the pages lane's F1/F2 edits around them untouched.
- `pages/telegram-callback.tsx` (:216 current): ApiError half via the reader;
  `ResponseParseError` keeps its own name check (the class carries NO `.data`
  — verified in shared/api-client-react/src/custom-fetch.ts:267 — so `reason`
  falls to "server_error" exactly as before).
- **Pins updated: none** — coupon verdict + cart-shrink semantics pinned
  unchanged: checkout-coupon-perline 9/9 (verdict arms incl. the 20 s
  abort-budget fail-open), checkout-idempotency-keys 10/10,
  money-races-r140 21/21, checkout family (balance-reseed / hydration-guard /
  pricing-reconcile / variant-drain) 22/22, whatsapp-phone-sign-in 45/45,
  product family green (conversion-path-r145 7, cta-mobile-r126, legacy-shape,
  price-honesty, r117-contracts, seo-availability, variants-decomposition,
  alias-r129, coupon-variant-void 4, legacy-slug-seed-r146 1).

## T4 (audit F7) — dead duplicate shape check deleted

- `components/AuthProviders.tsx`: the unreachable second
  `if (!Array.isArray(d?.providers)) throw` (old :286) removed — the first
  check on `!d || !Array.isArray(d.providers)` already covers it. −1 line.
- **Test evidence:** auth-providers-hardening 4/4 (in group-3 run),
  use-public-auth-providers 13/13, auth-onboarding-journey-r143 5/5,
  register-return-path 11/11, app-decomposition-r137 16/16.

## T5 (audit F8) — ProductSkeleton pass-through deleted

- `components/home/primitives.tsx`: the 3-line alias + its import deleted;
  OrderStatusIcon untouched. `components/home/ProductsGrid.tsx`: imports
  `ProductCardShell` from `@/components/ui/route-skeleton` (route-skeleton's
  own shells' idiom) — the loading grid renders the identical element.
- **Pin updated (1):** `pages/__tests__/home-decomposition-r136.test.ts` —
  the deletion guard now pins ProductsGrid → route-skeleton instead of →
  primitives for the skeleton, one-line rationale in-source.
- **Test evidence:** home-decomposition-r136 8/8, route-skeleton-card 17/17,
  skeleton-primitives 29/29, design-system-css 31/31.

## T6 (audit F9) — AskAnswer's copy lifecycle folded onto CopyButton

- `components/CopyButton.tsx`: new `iconOnly` + `className` props — an
  icon-only rendering with NO visible label where the accessible name rides
  the full-sentence forms («نسخ» / «تم النسخ» / «تعذّر النسخ») via
  aria-label, `type="button"` + `aria-live="polite"` retained, and the
  caller's classes carry the surface positioning. Icons in this mode are the
  AskAnswer trio (Copy / Check `text-status-success` / X `text-status-error`).
  The shared lifecycle (tracked + cleared reset timer, 1.5 s / 2 s windows,
  `copyToClipboard` routing) is unchanged for the ten labeled consumers.
- `components/admin/copilot/AskAnswer.tsx` (−39/+18): local
  `copied`/`copyFailed` state + two bare `setTimeout`s deleted; the overlay
  button is `<CopyButton text={answer} iconOnly className="absolute top-1.5
  left-1.5 …" />` — byte-identical classes and icon output, timers now
  tracked (A3 P3-10 reaches the last untracked copy surface).
- **Pin updated (1):** `pages/__tests__/copilot-decomposition-r137.test.ts` —
  the "AskAnswer owns ONLY its card-local copy feedback" pin now asserts the
  shared CopyButton (iconOnly) is used and no local state island can return,
  rationale in-source; behavior stays pinned in copilot-copy +
  copy-button.
- **Tests added:** `components/__tests__/copy-button.test.tsx` +2 cases
  (icon-only: caller classes + full-sentence aria-names through copied and
  failed, no visible label; unmount leaves no pending reset timer).
- **Test evidence:** copilot-copy 3/3 (B6-P2-2 regression — routes through
  `copyToClipboard`, failure surfaces), copy-button 11/11, copilot-decomposition
  11/11, admin-financial-growth-visual-r139's AskAnswer pins unaffected
  (bubble classes / tool-name span / no shadow-sm — in the group-1 run 27/27).

## T7 (audit F11) — useKeyboardShortcuts trimmed to its real surface

- `hooks/useKeyboardShortcuts.ts`: `KeyboardShortcut` is now `key` + `handler`
  (+ the existing `enabled` param on the hook). `description` (zero readers)
  and `ctrlKey`/`shiftKey`/`altKey`/`metaKey` (never set by the single
  caller, carriers of the unspecified-modifier matcher quirk) deleted with
  the matcher's modifier arms.
- `pages/admin/topups.tsx`: the `description: "إغلاق النافذة"` field dropped
  from the one Escape registration. −1 line.
- **Pins updated: none** (no test read the interface). **Test evidence:**
  topups-dialogs-a11y (fires real Escape keyDowns through the trimmed hook)
  and admin-topups-decomposition-r137 10/10 — both green in group 3.

## T8 (backend carry-over) — SessionManager drops lastActive

- `components/layout/SessionManager.tsx`: `lastActive` removed from the
  `Session` interface (:14 old) and the «آخر نشاط: {formatDateShort(…)}»
  stamp (:184 old) deleted with its now-unused `formatDateShort` import; the
  row shows device + current chip — exactly what GET /api/auth/sessions now
  returns (the field was always createdAt, a lie as a "last activity" label).
- Fixtures: `session-manager-confirm.test.tsx` and
  `session-manager-error-states.test.tsx` each drop the `lastActive` field
  from their session rows (−1 line each) — no assertions weakened.
- **Test evidence:** session-manager-confirm 4/4, session-manager-error-states
  8/8, engagement-surfaces-visual-r139 27/27 (SessionManager pins: logout-all
  register, current-session tint, «الحالي» chip — all unaffected),
  session-activity-manager 15/15, profile/storefront suites that mock
  SessionManager green in group 3.

---

## Combined roster (all green)

notification-bell-panel 8 · notification-bell-markread 3 ·
admin-layout-decomposition-r137 10 · admin-shell-dashboard-r139 22 ·
global-search 7 · status-tokens 7 · home-decomposition-r136 8 ·
route-skeleton-card 17 · skeleton-primitives 29 · design-system-css 31 ·
session-manager-confirm 4 · session-manager-error-states 8 ·
session-activity-manager 15 · engagement-surfaces-visual-r139 27 ·
checkout-idempotency-keys 10 · product-buy-intent-key 6 ·
loyalty-convert-journey 7 · money-races-r140 21 · wallet-decomposition 8 ·
checkout-decomposition 7 · product-decomposition 9 · loyalty-decomposition 9 ·
checkout-coupon-perline 9 · whatsapp-phone-sign-in 45 · copilot-copy 3 ·
copy-button 11 · copilot-decomposition 11 · product family (conversion-path
7, cta-mobile, legacy-shape, price-honesty, r117-contracts,
seo-availability, variants-decomposition 6, alias 3, coupon-variant-void,
legacy-slug-seed 1) · checkout family (balance-reseed, hydration-guard,
pricing-reconcile, variant-drain) · wallet-submit / wallet-money-gates /
loyalty-error-state 31 · auth-providers-hardening + use-public-auth-providers
+ auth-onboarding-journey + register-return-path + app-decomposition 16 ·
topups-dialogs-a11y + admin-topups-decomposition 10 · meta-quality-r140 ·
money-path-chrome-r139 28 · semantics-depth-r140 — **≈660 assertions across
~45 suites, 0 failures**, then re-verified after the prettier pass (124/124
re-run on the touched money/copy suites). `tsc -p tsconfig.json --noEmit`
exit 0. `prettier --check` clean on every lane file (5 files drifted by the
edits — all clean at HEAD — fixed with one `--write`; the write only
re-wrapped the new code).

## Net lines (this lane's files only)

- production source: **+289 / −337** (18 modified files + the new 74-line
  `lib/intent-envelope.ts`) → **net −48**; the duplicated bodies removed
  (four envelope copies, two trap bodies, three duck-type reads, the dead
  throw, the alias, the modifier arms, the lastActive stamp) total −337,
  funded back by the shared envelope (+74), `readApiError` (+28), the
  CopyButton icon-only branch (~+35) and the mandated why/rationale
  docblocks.
- tests: **+74 / −24** → net +50 (new icon-only CopyButton pins + the three
  pin updates with rationale).
- The T3/T7 hunks inside pages/product.tsx, pages/telegram-callback.tsx and
  pages/admin/topups.tsx ride the pages lane's files (accounted there):
  readApiError import + two replaced blocks, the telegram-callback reader
  swap, the description-field deletion.

## Pins updated (4, all with one-line in-source rationale)

1. `admin-layout-decomposition-r137.test.ts` — focus-trap re-export form (T1).
2. `home-decomposition-r136.test.ts` — ProductsGrid → route-skeleton guard (T5).
3. `copilot-decomposition-r137.test.ts` — AskAnswer values-only / shared
   CopyButton (T6).
4. `copy-button.test.tsx` — header note + new icon-only describe (T6, additive).
No assertion was weakened to get green; every money-path pin
(checkout-idempotency-keys, product-buy-intent-key, loyalty-convert-journey,
money-races-r140, wallet-decomposition, checkout-coupon-perline) ran
UNMODIFIED.

## Not done / out of lane

- Audit findings 2 (category registry), 5 and 6 (the two hook test gaps) —
  4b's lane (registry + hook tests); the Navbar half of finding 1 likewise.
- Finding 10 (EmptyState twins) — recorded decision, left alone per the audit.
- `pnpm install` / lockfile refresh, git commit/push — orchestrator-owned.
