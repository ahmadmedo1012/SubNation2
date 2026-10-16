# R151 — Customer-journey parity + operational visibility + independent close-out verification: closing report

Round base: `11546f8` (R150 close). Method: the repo's standing Ponytail
ruleset (root `AGENTS.md`). Four implementation commits landed
2026-10-15 by the working agent; this session (2026-10-16) reconciled
them, landed one further design-token fix, ran the round's first FULL
local gate battery, and executed the live-production E2E verification.

Mission context: the whole-product excellence program. The round's four
commits closed seven verified defects across the three customer-facing
surfaces (backend auth/wallet parity, admin operational honesty,
storefront journey polish). This close-out session swept for further
open P0/P1s across the tree and found none — the audit trails are
recorded below with the negative results stated as tested.

## 1. The landed work (reconciled — 4 commits, 20 files, +948/−152)

### 1.1 `6c57a42` — backend auth/wallet parity

- WhatsApp `findOrCreate` catches the identity-race 23505 duplicate-key
  rejection instead of surfacing it as a login failure (regression test:
  `whatsapp-findcreate-race.test.ts`, 171 lines).
- Wallet `sender_phone` normalization (the display/transfer parity twin
  of the auth fix). Gates at land time: targeted backend suites
  1,301/1,301; money invariants untouched (M1–M17 audit in the commit).

### 1.2 `0de77fe` — admin operational visibility

- Orders bulk-status: the all-skipped verdict now toasts destructive with
  the mapped Arabic reason instead of a green "تم تحديث حالة 0 طلب"
  (regression test in `orders-bulk-status.test.tsx`).
- Tickets `handleReply`/`handleStatus`: post-mutation detail refresh is
  now silent (`refreshSelectedSilently`) — a refresh blip after a
  committed reply no longer toasts «خطأ» and no longer invites the
  duplicate-reply resubmit (regression tests in
  `tickets-refetch-isolation.test.tsx`).

### 1.3 `ef0c3e6` — storefront customer-journey polish

- Checkout `skippedByOtherTab` navigate now rides the same
  `abandonedRef` guard as the success path (no post-unmount yank).
- Order-detail: the support CTA now renders for `refunded` orders too,
  and the bottom support link carries the `?ref=` deep-link param.
- Tap targets below the 44px floor: CartSummaryAside empty-cart CTA
  `size="lg"`; OrderErrorBanner recovery link `min-h-11 -my-2 py-2`.

### 1.4 `77cb3a3` — test hygiene

- The boot one-shot fake-timer chain drain fix
  (`web-scheduler-single-instance.test.ts`) — the deterministic-clock
  pattern the R132 load-flaky class established, applied to the one
  straggler.

## 2. This session's additions (the R151 close-out commit)

### 2.1 Design-token integrity — the off-scale toast icon radius

`impeccable detect frontend/src/` flagged exactly one advisory across
the whole frontend: the premium-toast icon bubble's
`border-radius: 11px` (index.css, introduced by the original
`e683338` toast styling — an eyeballed value, off the DESIGN.md rounded
scale {4, 8, 10, 12, 16, 24}). Fixed to the on-scale `10px`, matching
the toast action button's radius in the same component family. Gate
re-run: **0 advisories** (was 1). The eager-path build shrank 23 B
(146,688 → 146,665 B gz).

### 2.2 The full independent gate battery (first complete local run of the round)

The four landing commits ran targeted suites; CI was the only full-battery
runner. This session ran everything locally, fresh, against the merged
tree plus the radius fix:

| Gate | Result |
| --- | --- |
| `pnpm lint` | 0 errors / 62 warnings (the documented baseline — unchanged) |
| `pnpm typecheck` | clean across all workspaces |
| Backend vitest (FULL suite, chunked lib/routes/services/jobs) | **271 files / 2,507 tests — all passed** |
| Frontend vitest (FULL suite) | **264 files / 2,496 tests — all passed** |
| OpenAPI↔Express route parity | OK — 84 enforced operations |
| ErrorCode sync (openapi.yaml ↔ shared) | OK — 55 codes, both directions |
| Header-param survival | OK — 7/7 |
| Drizzle migration drift (regenerate + `git diff`) | none |
| Orval drift (codegen + `git diff`) | none |
| `impeccable detect frontend/src/` | **0 advisories** |
| Production build | green — eager path **146,665 B gz** (budget 150 KiB) |
| Boot smoke (entry module + stylesheet + registerSW outside comments) | OK |

Combined suite total **5,003 tests** — above the ~4,900 floor, no
silently-skipped suite (the chunked backend run covers exactly the 271
files `find` reports).

### 2.3 Live-production verification (read-only)

The CI dispatch path (`E2E_BASE_URL=https://subnation.ly`,
`E2E_ENABLED=1`) executed locally against production:

- **Guest E2E suite: 52/52 passed** (3.5 min, desktop-chromium +
  mobile-390 projects) — home grid + zero console errors, category
  chip navigation, product-detail money honesty at 1280px, the R122
  Arabic-search DOM contract (نتفليكس / نتفلكس شهر / موسيقى),
  robots + sitemap + the noindex 404 shell, guest money-route gates
  (/wallet, /orders, /cart → login redirects), mobile-390 overflow and
  44px tap-target checks.
- `GET /api/healthz` → `{"status":"ok"}`.
- `www.subnation.ly` → **301** apex redirect, path preserved (the
  documented post-R124 state).
- Live bundle identity: `index-rzt2bEm3.js` (the deployed release serves
  the R151 storefront — the E2E behaviors above confirm the deployed
  tree, not just the repo).

Production was browsed read-only throughout; no account was created, no
mutation was attempted, and no production data was read beyond public
catalog surfaces.

## 3. The further-defect sweep (negative results, honestly scoped)

Per the mission's "find what remains open" duty, this session swept the
tree for live defects beyond the landed four commits:

- **Raw-color audit**: zero raw hex / off-token color classes in any
  `.tsx` (only one inert `style` comment matched). The semantic-token
  discipline holds across both themes.
- **Theme parity audit**: all six `:root` tokens without a `.light`
  override (`--primary-border` & siblings) are derived via CSS relative
  color syntax from base tokens that DO flip — correctly theme-adaptive,
  not defects.
- **Icon-button accessibility**: every `size="icon"` control carries an
  Arabic `aria-label` (TicketThread, SessionsSectionHeader,
  CopilotComposer, TicketDetailPane).
- **React-hooks warning triage** (the 62-warning baseline): the
  production-code warnings (support.tsx, tickets.tsx, risk-related
  pages, auth-callback, promotions, whatsapp, layout) were read
  individually — each is the documented deliberate scalar-key /
  mount-once idiom with an in-code rationale comment. No stale-closure
  bug found; churning them would be diff noise, not a fix.
- **Coverage gap check**: `auth-callback.tsx` and `telegram-callback.tsx`
  are the only pages without a direct unit-test file; both were read in
  full — the cookie-path bounce, the auth_error redirect, and the 12 s
  hang-escape are correct, and both surfaces are exercised by the live
  E2E login/auth-gate specs.
- **Page recency**: every storefront and admin page was last touched
  within the R133–R151 window (the tree is under active whole-product
  maintenance; no abandoned surface found).

No reproducible P0/P1 defect remains in scope from this vantage. What
was NOT possible from this session: admin-console authenticated browsing
(no credentials by design), real-device WhatsApp OTP acceptance (the
standing R150 owner matrix), and Coolify deployment-state inspection
(owner-gated) — all remain owner actions per the standing runbooks.

## 4. Gates at push

All gates in §2.2 ran green on the exact tree being pushed (the four
landed commits + the radius fix + this report). The push is the round's
first; CI (secret scan, lint, typecheck, parity/drift, both suites,
production build) runs the full battery on it, and the Coolify webhook
deploys it per the standing push-to-deploy contract.

## 5. Deliverables

- `docs/engineering/R151/round-close.md` (this report).
- The CHANGELOG R151 entry (the round's ledger record, reconciling the
  four landed commits + this session's close-out).
- The one-line design-token fix (`frontend/src/index.css`).
