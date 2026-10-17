# R158 — The organization & precision round

Date: 2026-10-17. Status: gated locally, committed; push pending the
operator re-providing the GitHub PAT (the sandbox environment reset wiped
`~/.git-credentials` and `/home/z/.gh-token`). Execution model: three
read-only audit lanes (R158-A/B/C) → five parallel implementation lanes
under ponytail discipline → coordinator completion of the lanes the
dispatch timeouts siloed → one combined verified tree.

## Method

1. **Audit (3 read-only Explore agents)**: the admin panel (never
   audited in 40+ rounds), the backend's organization/robustness, and
   the frontend architecture + the R157 deferred-ledger feasibility.
   Every finding carried file:line evidence + an exact fix.
2. **Implementation (5 lanes, disjoint file sets)**: IMPL-A (admin
   frontend), IMPL-B (backend structural, the money-handler
   extraction), IMPL-C (backend mechanical), IMPL-D (frontend misc +
   design docs), IMPL-E (frontend hook extractions). Three dispatch
   responses were lost to adapter timeouts but their work landed on
   disk — the coordinator verified those lanes directly via targeted
   greps and the full gate battery rather than trusting reports.
3. **One combined tree verified**: all gates on the final state.

## What shipped

### Admin panel (lane A + coordinator completion)

The 22-page console had never had a dedicated visual audit; the residue
clustered exactly where the R139/R157 sweeps never reached. Closed:
the settings-page lane's last raw `bg-primary`+`text-white` button (now
the canonical Button); the money-action triggers below the console's own
44px confirm-dialog floor (`h-9`→`min-h-11` on topup approve/reject,
bulk actions, the wallet-PATCH submit); the WhatsApp pair-code copy
re-implementation (untracked 1,800ms timer and all) → the shared
CopyButton; the variants-table hand-rolled spinner → TableSkeleton; six
flat-fill Button overrides retired (admins ×3, ticket send, editor,
products header — `buttonVariants` owns the fill again); the two-reds
drift (`text-destructive` → the `text-status-error` family on the three
error surfaces); the 2FA-setup bare OTP `<input>` → the shared Input;
the sidebar Shield `text-white` → `text-primary-foreground`; the
promotions create-form's toast-only validation → the coupons inline
`role="alert"` idiom; AT roles on the four credential async states; and
the full physical-RTL sweep — **zero** `mr-/ml-/pr-/pl-` classes remain
in admin code outside the two documented Latin-justified pins
(~110 sites converted across the lane + the coordinator's 29-site tail
sweep).

### Backend structure (lane B + coordinator split)

- **The 542-line inline money handler retired**: `POST /api/wallet/
  topups` now delegates to `TopupService.createPendingTopup` behind a
  `CheckoutResult`-style typed union — the same delegation every
  sibling money path already used. The extraction is behavior-
  preserving: the `wallet-topups*` suites stayed green **unmodified**
  (the stated acceptance). The service file the pipeline landed in then
  crossed the R143 1,000-line no-monolith gate, so the creation pipeline
  moved once more into `services/topup-create.service.ts` (640 lines,
  verbatim) with `topup.service.ts` (802) keeping the `TopupService`
  facade — zero importer changes.
- **The OIDC route happy-path test gap closed**: the R156 production
  surface (query → service → `Set-Cookie: auth_token` → 302) now has
  route-level cases where before only cookie-NULL assertions existed.
- **The payment-network 3-site manual sync** became one map
  (`lib/payment-networks.ts`); the 400 message keeps byte-identity by
  explicit decision (composing from the labels would change user-facing
  copy on a money path).
- **The idempotency-reuse 409 envelope** (5 copy-pasted sites) became
  one factory; raw ErrorCode string literals → typed members.

### Backend hygiene (lane C + coordinator completion)

`notifyAdminStats()` replaced the 15× socket-notify idiom;
`admin/products.ts` registered in the growth-banned tripwire (982
lines, 18 under the ceiling); the ticket-intent limiters moved to their
documented single home AND joined the family's draft-8 standard-header
contract; `readEnvNumber()` gives the nine numeric env-tunables their
missing boot signal (set-but-malformed now warns; per-site predicates
keep numeric semantics byte-identical — the one strictness change, the
`parseInt` partial-parse hazard, is documented); the four default-export
routers joined the layer's named-export convention; the app.ts shim
re-verified (the audit's "9 dead re-exports" were alive via dynamic
imports — only the 2 truly dead removed).

**One audit finding rebutted with evidence (C8, fake timers)**: on
reading, all five remaining real-timer waits are I/O-settling or
event-loop barriers — a fire-and-forget DELETE landing, an
unhandledRejection surfacing window inside a real-elapsed-time suite, a
bounded poll loop for fire-and-forget audit rows. Converting any of them
to fake timers would break the test or change nothing; they are
documented here as deliberate instead.

### Frontend architecture (lanes D + E)

- **The R157 ledger**: the closed-ticket inline create CTA wired
  (required `onNewTicket` prop, stateless extract preserved, one-tap
  create from the closed notice); the `ui/filter-tabs` primitive landed
  (the canonical pill classes + counts + tones + 44px floor) with the
  non-admin conversions (terms, customer orders) and its 8-case suite —
  the 5 admin twins convert next round by design; the tooltip primitive
  refused **with the numbers** (~3 KB budget headroom vs 5–8 KiB gz,
  touch-first audience, aria-label+title idiom already AT-complete —
  now documented in DESIGN.md); the motion-duration scale documented
  (150 state / 200 surfaces / 300 spatial / 500 ambient + the 280ms
  card-lift exception) and the 8 drift sites normalized to it.
- **Three extractions with decomposition pins**: `useCheckoutRequote`
  (checkout.tsx 974 → 842, the r136 pin re-pinned with hook-ownership
  rationale), `useWhatsAppOtp` (881 → 500 + a 7-test pin),
  `useNotifications` (825 → 635 + an 8-test pin — the R157 bell
  contracts all held).
- onboarding.tsx got its missing `useSeo` (the one page without);
  support-meta's STATUS_CONFIG now derives from `statusLabel`.

## Gates (the combined tree)

- Backend **278 files / 2,573 tests green** (4 sequential chunks);
  frontend **277 files / 2,583 green** — **5,156 combined**.
- Lint 0 errors / 15 warnings (baseline held); typecheck clean (both
  packages); `impeccable detect` clean.
- Route parity 86 ops; error-code sync 55; header params 7/7; drizzle
  drift none.
- Production build green — eager **146,625 B gz** (budget 150 KiB;
  +32 B vs R157).

## Deferred (with rationale)

| Item | Why deferred |
| --- | --- |
| Orders-table sort affordance | needs a backend `sort` param on the frozen list contract |
| `admin/products.ts` service extraction | the growth-banned tripwire registers it now; extraction is its own round |
| 57× test-factory consolidation | adopt-on-touch policy; churn without behavior value this round |
| FilterTabs admin-site conversions | the primitive + non-admin conversions landed; admin re-pins are a clean next round |
| 123× auth-mock consolidation | touches every test file incl. the ones this round re-pinned; zero user value |
| Test-placement migration (central flats) | cosmetic; incremental on touch |
| `<TimeAgo>` primitive | the 4-site `title={formatDate}` twin idiom works and is cheap |
