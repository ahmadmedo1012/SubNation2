# Lane R143-L2 · Storefront design system — root-level audit

Read-only investigation @ HEAD 528ef39. Primary: `frontend/src/index.css`,
`frontend/src/components/ui/*`, `frontend/DESIGN.md`, `docs/ux/FINAL_UX_SYSTEM.md`
+ cross-cut greps over all of `frontend/src` (non-test). Focus: systemic drift,
not per-page polish. Evidence = file:line + quote; counts from repo-wide rg.

---

### L2-1 · P2 · The r138 "two-layer calm elevation" is a 21-site copy-pasted magic string — not a token, and theme-blind

- **Evidence (21 occurrences / 20 files, byte-identical string):**
  `shadow-[0_1px_2px_rgb(0_0_0/0.3),0_10px_28px_-14px_rgb(0_0_0/0.4)]` at
  pages/order-detail.tsx:340 · pages/cart.tsx:39,257,495 · pages/flash-sales.tsx:112 ·
  pages/admin/login.tsx:232 · pages/profile.tsx:293 · pages/admin/dashboard.tsx:421 ·
  components/checkout/CartSummaryAside.tsx:50 · PaymentMethodCard.tsx:37 · CouponCard.tsx:56 ·
  components/wallet/BalanceCard.tsx:64 · components/support/TicketThread.tsx:41 ·
  CreateTicketForm.tsx:39 · components/ProductCard.tsx:369 ·
  components/admin/referrals/ReferralsStats.tsx:34 · admin/orders/BulkActionBar.tsx:52 ·
  admin/dashboard/MetricCard.tsx:66 · admin/products/ProductEditorCard.tsx:48 ·
  admin/pricing/PricingConfigCard.tsx:83. All ride `bg-card border border-border/60` —
  this IS the de-facto "two-layer calm elevation" of the money/summary card family.
- **Root cause:** the r138 family shipped the recipe as a Tailwind arbitrary value; no
  token/utility was added to index.css, whose sanctioned ladder differs
  (index.css:249 `--shadow-md: 0px 4px 14px 0px hsl(0 0% 0% / 0.46), …`). DESIGN.md
  §Elevation pins light-theme shadows at "6–14% black" — the literal renders
  **30%/40% black in `.light`** (user-reachable via the Navbar theme toggle), ~3× the
  documented ceiling. One recipe, zero governance: any future re-tune must edit 21 sites.
- **Proposed fix:** add one utility in index.css (e.g. `--shadow-calm` with a light
  twin, or a `.calm-card-shadow` class) and swap the 21 literals.
- **Test requirement:** extend `components/__tests__/design-system-css.test.ts` +
  the r139 visual suites: pin the class name and assert `not.toContain("0_10px_28px")`
  on the swept files.
- **Risk:** low — pure class swap, no layout change.

### L2-2 · P3 · The R139 "/60 resting edge" sweep missed the auth family, the whole PDP, and the shared route-skeleton (8 live `/55` sites — unpinned)

- **Evidence (live class strings, vs 302 `border-border/60` occurrences/150 files):**
  pages/login.tsx:184 `bg-card border border-border/55 rounded-3xl p-6 shadow-2xl` ·
  pages/register.tsx:112 (same) · pages/onboarding.tsx:119 (same) ·
  pages/product.tsx:665 `max-lg:border-border/55` ·
  components/product/BuyPanelColumn.tsx:73 + ProductMediaSection.tsx:26
  `lg:border-border/55` (the PDP desktop panels) ·
  components/ui/route-skeleton.tsx:239,272,378 (the shared loading primitive mirrors
  the PDP's `/55`). Intent is unambiguous: category.tsx:382 documents
  «R139 (precision): border-border/55 → /60 — the resting card-frame», and the r139
  pin suites actively assert `not.toContain("border-border/55")` for FAQ/PROFILE/
  SESSIONS/admin-catalog/access-ops/pricing (engagement-surfaces-visual-r139.test.ts:283-339,
  admin-catalog-visual-r139.test.ts:115-127, admin-access-ops-visual-r139.test.ts:305-328) —
  the sweep+pin landed everywhere except auth + PDP + route-skeleton.
- **Root cause:** lane-scoped sweep; the PDP trio and auth cards fell between lanes,
  and route-skeleton inherited the drift as "verified parity".
- **Proposed fix:** one class edit ×8; add PRODUCT/LOGIN/REGISTER/ONBOARDING/
  ROUTE_SKELETON to the existing `/55` ban pins.
- **Test requirement:** extend the r139 visual suite's `not.toContain("border-border/55")`
  it-block to the five files.
- **Risk:** none.

### L2-3 · P3 · J-1's 44px money-confirm floor didn't reach its own sibling: BulkConfirmModal still `h-9` + hand-rolled fills

- **Evidence:** components/admin/topups/BulkConfirmModal.tsx:71
  `<Button variant="outline" className="flex-1 h-9 active:scale-[0.97]">` and :78
  `<Button className={\`flex-1 h-9 active:scale-[0.97] shadow-sm ${action === "approve" ?
  "bg-status-success-surface hover:bg-status-success-surface/90 text-white shadow-status-success-surface/20"
  : "bg-destructive-surface … shadow-destructive/20"}\`}>` — the bulk approve/reject
  **money** confirm at 36px. J-1 (R142) raised the twin RejectModal to
  `variant="destructive"` + `min-h-11` (RejectModal.tsx:100-101, "the 44px money-path
  floor the useConfirm twin and BulkConfirmModal already enforce" — the comment's claim
  about BulkConfirmModal is false at HEAD). RejectModal's own footer is now asymmetric:
  cancel `h-9` (:88) vs confirm `min-h-11` (:101) — 36px/44px side by side.
- **Root cause:** J-1 named two sites; the third hand-rolled dialog footer in the same
  topups family was outside the finding's site list, and its in-code comment
  ("BulkConfirmModal already enforce") codified the wrong state.
- **Proposed fix:** BulkConfirmModal → variant composition + `min-h-11` on both
  buttons; align RejectModal cancel to `min-h-11`.
- **Test requirement:** topups-dialogs-a11y.test.tsx — assert `min-h-11` on both
  footer buttons of both modals.
- **Risk:** low.

### L2-4 · P3 · Storefront money-adjacent modal bypasses the Button primitive with the full pre-r138 CTA stack

- **Evidence:** components/LinkConsentModal.tsx:71-73 — raw
  `<button type="button" className="flex-1 h-10 rounded-xl bg-primary hover:bg-primary/90
  text-primary-foreground text-sm font-bold inline-flex items-center justify-center gap-2
  press-spring active:scale-[0.97] shadow-md shadow-primary/22 disabled:opacity-60">`.
  `shadow-primary/22` sits below DESIGN.md's documented interactive-glow range
  («shadow-primary/25–40») and the R139 retire notes ("the r138 family retired
  brand-tinted shadows" — CouponsHeader.tsx:41-45). Every neighboring money CTA carries
  an r138/r139 migration comment (CtaBlock.tsx:159, ConvertPointsCard.tsx:151,
  TransferCodePanel.tsx:129, TopupWaitingModal.tsx:382); this file has none — it was
  never swept. (Focus IS visible — raw button keeps the global :focus-visible outline;
  this is primitive/visual-contract drift, not a11y loss.)
- **Root cause:** primitive convergence swept page CTAs; the consent modal (links
  Telegram/WhatsApp identities to the wallet account) escaped the census.
- **Proposed fix:** swap to `<Button size="lg" className="w-full sm:w-auto">` family.
- **Test requirement:** link-consent-modal.test.tsx — assert the confirm renders the
  shared variant classes (no raw `bg-primary` + `shadow-primary/22`).
- **Risk:** low.

### L2-5 · P3 · Admin hand-rolled textarea/inline-input family: 1px & low-alpha focus rings on money-path note fields (J-2's deferred "fifth recipe", quantified)

- **Evidence (8 live sites):** `focus:ring-1 focus:ring-primary` —
  components/admin/products/InlineStockEdit.tsx:91, ProductEditorCard.tsx:254/335,
  admin/topups/BulkConfirmModal.tsx:116, admin/topups/RejectModal.tsx:124
  (`focus:ring-1 focus:ring-destructive` — the exact site J-2 called out, still
  unfixed); `focus:ring-2 focus:ring-primary/30` — pages/admin/risk-event.tsx:335,
  enrichment.tsx:358; `focus:ring-2 focus:ring-destructive/25` — enrichment.tsx:481.
  All are `focus:` (not `focus-visible:`); the 25–30%-alpha rings composite far below
  the 3:1 indicator floor that drove input.tsx:35 to full-opacity `ring-ring`
  (F3-01). Chrome also forks from the Input primitive: `bg-secondary border-border`
  vs `bg-card/60 border-muted-foreground/75` (input.tsx:23).
- **Root cause:** J-2's R142 fix added `ring-offset-background` only to the 2px ring
  sites; the "one ring recipe" reconciliation was explicitly deferred to a write round.
  The money-path members (topup reject/bulk notes) make it more than cosmetic.
- **Proposed fix:** extract a shared Textarea primitive riding the input.tsx recipe
  (`focus-visible:ring-2 ring-ring ring-offset-1 ring-offset-background
  border-muted-foreground/75 bg-card/60`), or minimum: replace the 8 focus classes.
- **Test requirement:** an a11y-guard assertion (r137-extracts-a11y-guard.test.ts
  idiom) that the two topup modal textareas contain `focus-visible:ring-2` +
  `focus-visible:ring-ring`.
- **Risk:** low.

### L2-6 · P3 · GlobalSearch palette: combobox input + result options suppress the global focus outline with no replacement

- **Evidence:** components/admin/layout/GlobalSearch.tsx:301 —
  `className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground
  text-right"` — no own ring, and the input row container (:279
  `flex items-center gap-3 px-4 py-3.5 border-b border-border`) has no
  `focus-within:ring`; result option buttons at :373/:420/:459 are `outline-none`
  ring-less. The sibling CopilotComposer.tsx:36 got the idiom:
  `focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1
  focus-within:ring-offset-background`. Tab is trapped inside the palette
  (trapTabKey, :265-267), so keyboard focus lands on ring-less tabbables.
- **Root cause:** hand-rolled palette skipped the focus recipe; r140's money-form
  focus contracts pinned money routes, not this surface.
- **Proposed fix:** add the focus-within ring to the input row (one className) and a
  visible active-option treatment for direct focus.
- **Test requirement:** global-search.test.tsx — assert the row carries
  `focus-within:ring-2 focus-within:ring-ring`.
- **Risk:** low.

### L2-7 · P3 · Light-theme washout: `bg-white/10` active-state assumption on the alerts type chips

- **Evidence:** components/admin/alerts/AlertsTypeChips.tsx:71 —
  `className={\`text-3xs px-1 rounded-full font-bold ${filter === s.key ?
  "bg-white/10" : "bg-muted/60"}\`}` — the ACTIVE chip's count badge. In `.light`,
  white/10 over the /10 severity tint ≈ invisible pill (the inactive twin's
  `bg-muted/60` flips correctly). Same assumption family: ProductCard.tsx:461
  `from-white/[0.06]`, ProductMediaSection.tsx:110 `bg-white/5 border-white/10`
  (over-media, tolerable in both themes).
- **Root cause:** dark-default hand-rolled sub-element; the R139 re-tune of this very
  component (:52-61) fixed the chip bodies via tokens but left the count badge.
- **Proposed fix:** `bg-muted/60` (or `bg-foreground/10`) for the active badge.
- **Test requirement:** none beyond visual pin (admin-palette-tokens.test.ts covers
  token usage patterns).
- **Risk:** none.

### L2-8 · P4 · Admin flat-CTA override family (~12 Button sites fork the canonical CTA language)

- **Evidence:** `<Button className="… bg-primary hover:bg-primary/90 active:scale-[0.97]">`
  at admin/users/UserEditDialog.tsx:85 · product-variants/VariantRows.tsx:79,
  VariantFormPanel.tsx:242, VariantsToolbar.tsx:41 · tickets/TicketDetailPane.tsx:244 ·
  coupons/CreateCouponDialog.tsx:65, CouponsHeader.tsx:46 · products/ProductsHeader.tsx:68,
  ProductEditorCard.tsx:365 · admins/EditAdminDialog.tsx:106, AdminsHeader.tsx:25,
  CreateAdminDialog.tsx:127. Some carry an in-code "R139 flatten" rationale
  (CouponsHeader:41-45), most are silent. Under twMerge the base
  `bg-gradient-to-b from-primary to-primary/95` (button.tsx:14) survives, so
  `hover:bg-primary/90` is a dead hover — result ≈ canonical, but the class language
  forks per site. Plus one raw button: settings-page/TelegramDiagnosticPing.tsx:35-38
  (`bg-primary hover:bg-primary/90 … text-white font-bold text-xs` — raw ink, no
  primitive, no focus recipe of its own).
- **Root cause:** no sanctioned `variant="flat"`; per-site overrides accreted.
- **Proposed fix:** add the flat variant to button.tsx (or drop the overrides);
  migrate TelegramDiagnosticPing to `<Button size="sm">`.
- **Test requirement:** button-a11y.test.tsx variant pin extension.
- **Risk:** none (governance/cosmetic).

### L2-9 · P4 · Token-discipline nits on shared surfaces

- Raw `text-white` on primary fills instead of `text-primary-foreground`:
  support/TicketThread.tsx:127,148 (storefront bubbles) + admin/tickets/
  TicketDetailPane.tsx:169,188 (admin mirror). Same computed value today — the token
  is the contract (DESIGN.md "on-primary").
- Well-family edge fork: EmptyState.tsx:85 tile `border-border/35` vs EmptyHero.tsx:178
  tile `border-border/40` vs the documented well register "bg-muted/60 + /40"
  (TransferCodePanel.tsx:71-72); CopyField.tsx:52 `border-border/35
  hover:border-primary/22` — off-scale /22 hover edge.
- NavigationProgress.tsx:87 `shadow-[0_0_8px_hsl(var(--primary)/0.6)]` — a 60%-alpha
  brand glow on a non-interactive element; DESIGN.md sanctions colored light at 5–45%
  "on interactive elements". Transient (500ms) — polish.
- Observation (no action): login.tsx stacks three atmosphere utilities on one route —
  page-level `dot-grid` (:125) + card `ambient-wash` + `hairline-glow` (:197-198);
  register/onboarding/admin-login repeat the family. If "ONE atmosphere moment per
  page" is intended strictly, the auth family is the densest exception; it is at
  least internally consistent.

---

## Clean areas (verified, stated honestly)

- **Calm active pill — converged.** `bg-primary/15 + border-primary/30 +
  text-primary-text` verified at VariantSelector.tsx:111/152 (plan + duration rows),
  MethodTabs.tsx:51 (R139 comment: "joins the PDP VariantSelector trio … the old 2px +
  shadow-sm read as a raised pre-r138 toggle"), admin StatusFilterTabs.tsx:65 (R139
  comment names the family), AlertsTypeChips active = severity tokens. Zero raised
  `border-2`+shadow toggles remain repo-wide (border-2 only on spinners/status rings).
- **Receipt hairlines /20** — present on money summaries (54 uses/29 files, incl.
  CartSummaryAside).
- **tabular-nums — CLEAN, body-wide.** index.css:457 `font-variant-numeric:
  tabular-nums` on `body` — every money number inherits it; the 78 files with explicit
  `tabular-nums` classes are redundant belt-and-suspenders, not a gap. No money
  component can miss it.
- **Raw hex — zero in component styling.** All live literals are sanctioned: brand
  SVG fills (Google/Telegram), MetaTags theme-color constants (94-C3, match both
  theme primaries), chart-theme.ts (declared canvas co-truth).
- **Glass/bg-*/9x — retired.** Only comments document the migration (product.tsx:744,
  admin/layout.tsx:554, Navbar.tsx:769); Navbar.tsx:560's `bg-secondary/60
  hover:bg-secondary/90` is a live calm pill (sanctioned idiom, wrapped in a labeled
  Link — not an a11y issue).
- **Heading scale — disciplined.** Account pages text-xl (wallet.tsx:653,
  loyalty.tsx:328, profile.tsx:263, referrals.tsx:249); cart/checkout/orders
  text-2xl; fluid-3xl on 4 h1s (GuestHero, category, flash-sales, PDP title) — each
  an in-code-documented R139 move; AuthedHero fluid-2xl. Lone outlier:
  order-detail.tsx:398 h1 at `text-base` (receipt-style product name — plausibly
  deliberate, worth a design ruling). Large text-3xl+ only on the sanctioned
  money-stat spans (PriceStockPanel:38 render-pinned, StatsRow:48/118,
  BalanceCard:85) + art stages.
- **PWA manifest — consistent.** manifest.json theme_color `#dc1840` + background
  `#0a0c10` = DESIGN.md dark tokens; MetaTags dual-scheme theme-color matches both
  primaries; full icon set (any+maskable 96/192/512), lang/ar + dir/rtl.
- **aria on interactive controls — strong.** aria-pressed on 34 pill-selector sites;
  EmptyState/EmptyHero `role="status"` + aria-hidden icons; Skeleton sr-only
  «جارٍ التحميل…» labels; Navbar wallet pill aria-label includes the balance.
- **State registers — converged.** FetchErrorCard adopted in 37 files; error-state
  suites exist for orders/category/loyalty/risk/security/whatsapp/referrals/tickets;
  full-page spinners migrated to skeletons (only two small inline sub-region
  loaders remain: CopilotHistoryView.tsx:111, StockoutRiskPanel.tsx:335 — acceptable
  register, not spinners-in-the-void).
- **Stagger classes** — index.css defines `.stagger-1…12` statically, so dynamic
  `stagger-${i}` template strings (referrals.tsx:311, MetricCard.tsx:66) are safe.

## R142 fix verification

- **J-1 (destructive variant AA): VERIFIED.** use-confirm.tsx:143
  `buttonVariants({ variant: "destructive" })` (J-1 comment block :135-142);
  RejectModal.tsx:100-101 `variant="destructive"` + `min-h-11`; button.tsx:18-19
  destructive = `bg-destructive-surface`; repo-wide rg for raw `bg-destructive`
  fills (excluding -surface/-foreground/-border) = **0 matches**. Residual sibling
  gap = L2-3 (BulkConfirmModal tap floor — token correct, floor not).
- **J-2 (ring-offset): VERIFIED.** `focus-visible:ring-offset-background` present at
  button.tsx:8, input.tsx:35, switch.tsx:12, ProductCard.tsx:777,
  CopilotComposer.tsx:36; pinned by button-a11y.test.tsx:45. Remaining recipe drift
  re-quantified as L2-5 (the deferred fifth-recipe family).

## Severity summary

P0: 0 · P1: 0 · **P2: 1** (L2-1) · **P3: 6** (L2-2, L2-3, L2-4, L2-5, L2-6, L2-7) ·
**P4: 2** (L2-8, L2-9)
