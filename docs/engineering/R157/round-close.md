# R157 — The visual & experience excellence round

Date: 2026-10-17. Status: shipped. Execution model: three parallel audit
lanes (Explore agents R157-A/B/C) → three implementation lanes (two
full-stack subagents R157-IMPL-B/C + the coordinator) under ponytail
discipline, one combined verified tree.

## Method

1. **Audit (3 read-only agents, evidence-based)**: guest storefront
   (R157-A), customer account/money journey (R157-B), design system
   (R157-C). Every finding carried file:line evidence + an exact fix.
   The audits confirmed the previously-fixed rounds (R128/R138/R143/
   R145/R153 visual contracts) held — no regressions re-flagged.
2. **Implementation (3 lanes on disjoint file sets)**: design-system
   consistency, account/money UX, storefront/auth/notifications. 37
   findings closed; 1 honestly deferred (the closed-ticket inline CTA —
   requires a cross-file `onNewTicket` prop through pages/support.tsx;
   an inert fallback was refused as repeating the exact inert-button
   class the round was fixing); 1 skipped with rationale (a third
   footer support pill — the footer already carries two /support links).
3. **One combined tree verified**: all gates on the final state.

## Highlights per lane

**Design system (C)**: the 12 theme-blind `hover:shadow-black/NN`
overrides retired (`.light` hover weight halves into the documented
6–14% ceiling at the most-perceptible moment); the new
`ui/select.tsx` primitive (native select in the Input recipe) with 5
hand-rolled selects converted; topup-meta raw hues → status tokens;
alert-dialog chrome unified with AppDialog; the light-mode-invisible
media tile retinted; a `success` Button cva variant replacing the two
hand-rolled approve buttons; ink-token swaps; the hand-rolled profile
spinner → Loader2; flash-sales grid rhythm aligned.

**Account & money (B)**: topup rows derive the payment channel from
`payment_method` (lypay rows finally say «LyPay»); rejected rows
surface `admin_note`; `delivered_extra_details` rides the shared
CopyButton (the license-key copy moment); the receipt shows
«سُلّمت …» when `delivered_at` exists; the installment dial CTA hit
the 44px money-action floor; multi-installment copy pluralized;
persistent 1–10,000 LYD bounds hints; preset chips carry «د.ل»; the
support composer became an auto-growing textarea (Enter=send).

**Storefront / auth / notifications (A, coordinator)**: login/register
provider skeletons (the auth card stopped popping taller twice after
paint); the CheckoutCta insufficient-balance branch with
aria-describedby linkage to the payment alert; the AuthErrorBanner
close-button RTL fix (physical `-mr-1.5` pulled the X into the text;
logical `-me-1.5`); the PDP 640–1024px band gets exactly one sticky
buy affordance (bar `lg:hidden` + panel CTA `hidden lg:block` — the
band previously had NEITHER); both auth callbacks set document titles
+ `role=status/alert` (stale RouteAnnouncer + AT-silent loading);
CategoryRail examples anchored to the RTL reading edge;
`formatCurrency` NaN renders the honest «— د.ل» instead of a
fabricated «0.00 د.ل»; the notifications page row click mirrors the
bell contract (mark-read always — link-less rows were inert); the bell
footer count became a «عرض الكل» link to /notifications and the panel
closes on page scroll (panel-internal scrolls excluded).

## Tests

3 new suites (select primitive 5, topup rows 8, ticket composer 3) +
18 intentional contract re-pins, each with in-line R157 rationale (the
bell footer-link focus order, the sticky-bar `lg:hidden` chrome family
×4, the admin bubble ink, the formatCurrency em-dash, the engagement
surfaces).

## Gates (the combined tree)

- Frontend **274 files / 2,555 tests green** (+3 files, +18 tests vs
  R156); backend **277 files / 2,558 green** (4 sequential chunks;
  backend untouched this round, re-verified) — **5,113 combined**.
- Lint 0 errors / 15 warnings (baseline held), typecheck clean.
- Route parity 86 ops, error-code sync 55, header params 7/7.
- Production build green — eager **146,593 B gz** (−137 B vs R156;
  budget 150 KiB).

## Follow-ups (deferred with rationale)

- The closed-ticket inline create CTA (needs the `onNewTicket` prop
  wiring through pages/support.tsx — a small dedicated change).
- A shared `FilterTabs` primitive for the 5 bespoke tab/chip filter
  implementations (P3 — component-extraction sweep, not a defect).
- Tooltip primitive for icon-only controls (P3 — 110 native `title=`
  attrs work today).
- Motion-duration scale documentation (DESIGN.md pins properties but
  no durations).
