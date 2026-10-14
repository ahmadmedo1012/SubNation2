# R143 · Wave D implementation report — storefront design system + mobile quality

Scope owner: `frontend/src/components/**` + `frontend/src/components/ui/**` (the ui home —
no `src/ui/` exists) + `frontend/src/index.css` + their test files. HEAD base 528ef39.
All visual changes CLASS-ONLY: aria/handlers/queries/copy byte-identical (r139 discipline).
Verification at bottom. **Not committed** (per charter).

Concurrent-lane note (honest): `components/` also carries in-flight changes I did NOT
make and left untouched — `AuthProviders.tsx` + `WhatsAppPhoneSignIn.tsx` (L1-1
onboarding journey) and `checkout/coupon-quote.ts` (L5-1/L5-2 coupon preflight). Every
file listed below as "changed" is wave-D work.

---

## 1. L2-1 (P2) — the two-layer calm elevation is now a theme-aware token

**index.css** (follows the existing ladder structure/naming):
- `:root` — `--shadow-calm: 0px 1px 2px hsl(0 0% 0% / 0.3), 0px 10px 28px -14px hsl(0 0% 0% / 0.4)`
  (dark byte-identical to the r138 literal) + WHY-comment.
- `.light` — `--shadow-calm: … / 0.07), … / 0.13)` — contact line rides the 2xs/xs alpha
  weight, ambient the xl footprint; both inside DESIGN.md §Elevation's 6–14% light
  ceiling (the literal rendered 30%/40% black, ~3× over); geometry byte-mirrors dark.
- `@layer utilities` — `.shadow-calm { box-shadow: var(--shadow-calm); }` (hand-written,
  unpurgeable, one-line re-tune point).

**Components swept (12 sites — the full components-side census):**
`checkout/CartSummaryAside.tsx` · `checkout/PaymentMethodCard.tsx` · `checkout/CouponCard.tsx`
· `wallet/BalanceCard.tsx` · `support/TicketThread.tsx` · `support/CreateTicketForm.tsx`
· `ProductCard.tsx` · `admin/referrals/ReferralsStats.tsx` · `admin/orders/BulkActionBar.tsx`
· `admin/dashboard/MetricCard.tsx` · `admin/products/ProductEditorCard.tsx`
· `admin/pricing/PricingConfigCard.tsx` — each `shadow-[0_1px_2px_rgb(0_0_0/0.3),…]`
→ `shadow-calm` + R143 WHY-comment. rg-verified: zero arbitrary-literal occurrences
remain anywhere under `components/**` (comments stripped).

**Pins re-anchored/added:** `design-system-css.test.ts` — new describe pins the exact
dark token, a regex ceiling-bounded `.light` twin, the var-reading utility, the 12-file
sweep + a whole-components-tree ban on the literal; `product-card-r120-regressions.test.tsx`
(resting shadow pin → `shadow-calm` + `not.toContain("0_10px_28px")`); the components-asserting
pins inside the r139 suites → `shadow-calm` + literal ban: `money-path-chrome-r139`
(SUMMARY_CODE/CartSummaryAside), `account-surfaces-visual-r139` (BALANCE),
`admin-shell-dashboard-r139` (MetricCard tile), `engagement-surfaces-visual-r139`
(THREAD + CREATE_FORM), `admin-catalog-visual-r139` (editor/ProductEditorCard),
`admin-financial-growth-visual-r139` (configCard/PricingConfigCard + refStats/ReferralsStats).

**Residual:** pages-side sites → hand-off list §11.

## 2. L2-2 (part) — /55 → /60 resting edge, components side

`components/ui/route-skeleton.tsx` ×3 (PDP section pair `lg:border-border/55` + FormShell
auth card) · `product/BuyPanelColumn.tsx:73` · `product/ProductMediaSection.tsx:26` — all
→ the family `/60`, each with an R143 WHY-comment; route-skeleton's "verified parity"
comment updated so the mirror states the new truth.
**Pins:** `route-skeleton-card.test.tsx` — new describe: whole-file `/55` ban +
`≥3× border-border/60` + exact-string mirror pins for the PDP pair.

## 3. L2-3 — BulkConfirmModal money-confirm floor + RejectModal footer symmetry

`admin/topups/BulkConfirmModal.tsx` — both footer buttons `h-9` → `min-h-11` (44px floor);
reject branch → `variant="destructive"` (the J-1 AA `--destructive-surface` pair); approve
branch keeps the sanctioned `bg-status-success-surface` composition (button.tsx ships no
success variant); `active:scale` dropped (Button base press-spring owns it); handlers/
labels/disabled wiring byte-identical.
`admin/topups/RejectModal.tsx` — cancel `h-9` → `min-h-11` (the J-1 asymmetry); the
falsely-claiming J-1 comment corrected in place ("false at HEAD; the bulk twin still rode
h-9 until the R143 L2-3 fix landed in its own file").
**Pins:** NEW `topups-dialogs-chrome-r143.test.tsx` — renders both modals: min-h-11 +
no-`h-9` on every footer button × both actions, destructive variant tokens, approve
composition, note-field focus idiom, and handler behavior (cancel / ⌘+Enter→note) —
intent preserved, floor strengthened.

## 4. L2-5 — admin textarea/inline-input family focus rings (components side)

5 live sites fixed to the input.tsx idiom (`focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background`):
`admin/products/InlineStockEdit.tsx` · `admin/products/ProductEditorCard.tsx` ×2
(category select + SEO textarea) · `admin/topups/BulkConfirmModal.tsx` ·
`admin/topups/RejectModal.tsx` (the exact J-2 callout). `ring-ring` replaces
`ring-destructive` (ONE focus system). No `md:text-sm` existed on any of these five
(no zoom-guard needed — text-sm is unconditional there, admin-side).
**Pins:** `storefront-contracts-r143.test.ts` (idiom tokens present, `focus:ring-1` +
`ring-destructive` banned, ×2 count on ProductEditorCard) + the render-level assertions
in `topups-dialogs-chrome-r143.test.tsx`.
**Residual:** pages-side sites → §11. (WhatsAppPhoneSignIn's two `focus:ring-2
focus:ring-ring` fields were never in the census — full-opacity 2px, above the floor;
left alone.)

## 5. L2-6 — GlobalSearch palette focus treatment

`admin/layout/GlobalSearch.tsx` — combobox input row gains the CopilotComposer idiom
(`focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1
focus-within:ring-offset-background`); all three outline-none option buttons (orders /
users / products rows) gain `focus-visible:` ring for DIRECT keyboard focus (Tab is
trapped via trapTabKey); the arrow-key `bg-primary/15` calm-active fill stays untouched
(selected-state vocabulary — the two devices never co-render).
**Pins:** `storefront-contracts-r143.test.ts` (row idiom + 3× option-ring count + the
calm-active fill count).

## 6. L2-4 — LinkConsentModal canonical CTA

`components/LinkConsentModal.tsx` — both raw pre-r138 buttons → shared `Button`
(cancel: `variant="outline"`, confirm: default variant with the canonical gradient +
`shadow-primary/25` glow) + `min-h-11` both (money-adjacent floor); the off-range
`shadow-primary/22` + flat `bg-primary` hand-roll retired; labels («إلغاء» / «تأكيد
الربط» / «جارٍ الربط…»), onClick/disabled wiring byte-identical.
**Pins:** `link-consent-modal.test.tsx` — new describe: from-primary/to-primary/95 +
shadow-primary/25 + min-h-11 + shared focus recipe present; `shadow-primary/22`, bare
`bg-primary`, `h-10` banned.

## 7. L3-2 (part) — dir="auto" on components-side truncation sites

`home/RecentOrdersStrip.tsx` · `product/RecommendationsSection.tsx` ·
`product/ProductBreadcrumbNav.tsx` — `dir="auto"` + `text-right` (the ProductCard F-1
recipe: Latin names truncate from the correct end; the RTL visual edge re-anchored;
Arabic names resolve rtl — zero change).
**Pins:** `storefront-contracts-r143.test.ts` (per-site: the element rendering
product_name/r.name/product.name carries all three of dir="auto" + truncate + text-right).

## 8. L3-4 — iPad focus-zoom guard on components-side fields

`product/CouponField.tsx:67` · `home/CatalogFiltersBar.tsx:190` ·
`support/CreateTicketForm.tsx:160` — bare `md:text-sm` →
`[@media(min-width:48rem)_and_(pointer:fine)]:text-sm` (input.tsx:43 idiom). NOTE: the
task brief believed CreateTicketForm was pages-side — it lives at
`src/components/support/CreateTicketForm.tsx`, so all three findings sites are
components-owned and all three are fixed.
**Pins:** `storefront-contracts-r143.test.ts` (guard present + bare `md:text-sm`
banned on all three files).

## 9. L3-1 — tabular-nums truth (comments only)

`index.css` body block — WHY-comment states the fontTools-proven truth (no `tnum` GSUB
feature; 400-face digit advances 500–620/1000UPM = 12% spread → the declaration is
inert; kept as future-proofing; money columns align via flex edge-alignment, not digit
widths). `wallet/LedgerEntryRow.tsx:100` — the "tabular-nums aligns the column of
amounts" claim corrected to the same truth. The 202 `tabular-nums` class usages are
untouched (no churn).
**Pins:** `design-system-css.test.ts` — pins the index.css truth comment so a future
audit cannot re-assert "tabular-nums — CLEAN" as a mechanism.
**Pages-side misleading comments:** grep-verified NONE exist (the findings' only code
comment was LedgerEntryRow — components-side, fixed).

## 10. L2-7 — light-theme bg-white/10 washout

`admin/alerts/AlertsTypeChips.tsx:71` — ACTIVE count badge `bg-white/10` →
`bg-foreground/10` (theme-aware; distinct from the inactive twin's `bg-muted/60`;
chip-body severity tuple + aria-pressed untouched).
**Pins:** `storefront-contracts-r143.test.ts` (`bg-white/10` banned; the new ternary
pinned; aria-pressed spot-check).
**Reviewed, no action (findings' own "tolerable" scope):** `ProductCard.tsx:466`
`from-white/[0.06]` and `ProductMediaSection.tsx:113` `bg-white/5 border-white/10` —
over-media tints, legible in both themes.

---

## 11. PAGES-SIDE HAND-OFF LIST (for the pages agent — NOT edited by wave D)

**L2-1 · shadow literal → `shadow-calm` (token exists in index.css; class swap only):**
- `pages/order-detail.tsx:340` · `pages/cart.tsx:39,257,495` · `pages/flash-sales.tsx:112`
  · `pages/admin/login.tsx:232` · `pages/profile.tsx:293` · `pages/admin/dashboard.tsx:421`
- Pins still asserting the old literal (re-anchor to `shadow-calm` + `not.toContain("0_10px_28px")`
  when sweeping): `storefront-browsing-visual-r139.test.ts:120` (flash) ·
  `admin-shell-dashboard-r139.test.ts:117` (dashboard skeleton tile) and `:201` (admin
  login) · `money-path-chrome-r139.test.ts:393,396` (cart rows/summary) ·
  `engagement-surfaces-visual-r139.test.ts:358` (profile identity card) ·
  `account-surfaces-visual-r139.test.ts:278` (order-detail header).
  NOTE: these same five suite files already carry my components-side re-anchors —
  only their pages-file assertions remain old.

**L2-2 · border-border/55 → /60:**
- `pages/login.tsx:184` · `pages/register.tsx:112` · `pages/onboarding.tsx:119` ·
  `pages/product.tsx:665` (`max-lg:border-border/55`)
- Suggested pin extension: the existing r139 `not.toContain("border-border/55")` ban
  it-blocks for LOGIN/REGISTER/ONBOARDING/PRODUCT.

**L2-5 · focus rings → input.tsx idiom:**
- `pages/admin/risk-event.tsx:335` (`focus:ring-2 focus:ring-primary/30`) ·
  `pages/admin/enrichment.tsx:358` (`focus:ring-2 focus:ring-primary/30`) ·
  `pages/admin/enrichment.tsx:481` (`focus:ring-2 focus:ring-destructive/25`)
  → `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
  focus-visible:ring-offset-background` (mirror `storefront-contracts-r143.test.ts`).

**L3-2 · dir="auto" + text-right on truncate sites:**
- `pages/orders.tsx:590` · `pages/flash-sales.tsx:204` · `pages/profile.tsx:351`

**L3-1 · misleading comments:** none found in pages (grep-verified multi-line) — no action.

**L3-4 · zoom guard:** no pages-side stragglers (all three findings sites were
components-owned; fixed in §8).

---

## 12. Verification

- `pnpm vitest run src/components/__tests__` → **44 files / 430 tests, all green**
  (includes the 2 NEW suites + 4 extended/re-anchored suites).
- Full frontend suite `pnpm --filter @workspace/subnation run test:run` →
  **251 files / 2,385 tests: 2,384 passed, 1 failed** (baseline was 2,325; concurrent
  lanes added suites). The single failure is NOT wave-D:
  `pages/__tests__/admin-orders-decomposition-r137.test.ts:108` asserts
  `fetch(\`/api/admin/orders/${orderId}/credentials\`…\` in `pages/admin/orders.tsx` —
  the pages agent's in-flight `fetch` → `adminFetch` refactor (their diff line) broke
  their own untouched pin. Zero wave-D files involved.
- `pnpm run typecheck` (frontend project): **zero errors in components/** or index.css**;
  the only 3 errors are in `src/lib/__tests__/admin-session.test.ts` — the lib lane's
  in-flight file (their added `afterEach`/AbortSignal lines), not wave-D. The full
  workspace typecheck additionally fails earlier in backend (backend lane's new test
  files) — same story.
- Byte-identity audit: every changed file is className/`dir`/comment-only; rendered
  copy, aria attributes, handlers, ids, queries untouched (render-level tests in
  `topups-dialogs-chrome-r143.test.tsx` re-prove handler wiring byte-identically).

## 13. Files changed by wave D

28 source (1 css + 27 components) + 12 test files (6 in components/__tests__ — 2 new,
4 extended; 6 r139 visual suites re-anchored where they pin components-owned surfaces)
= **40 files**. Concurrent-lane files inside components/ (AuthProviders,
WhatsAppPhoneSignIn, coupon-quote.ts) are NOT wave-D and were left untouched.

## 14. Residuals / honest notes

- L2-8 (flat-CTA override family) + L2-9 (text-white/token nits) were outside wave-D's
  mandate — untouched, still tracked in findings-L2.
- L3-1: took the findings' "minimal, honest first step" (comment truth + pin), not the
  digit-grid route — ledger rows keep their current rendering.
- `.light` shadow-calm is 7%/13% black (inside the 6–14% ceiling); dark rendering is
  byte-identical to the r138 literal, so no dark-theme visual pin needed re-anchoring
  beyond the class-name swap.
- Do-not-commit respected; tree left uncommitted.
