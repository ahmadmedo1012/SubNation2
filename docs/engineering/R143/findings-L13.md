# L13 — R143 Administration & operator workflows audit (lane R143-L13)

Base: HEAD `528ef39` (tree clean; read-only audit — nothing edited).
Scope: every admin domain in `frontend/src/pages/admin/**` +
`frontend/src/components/admin/**` + the shared operator plumbing
(`lib/admin-session.ts`, `hooks/use-confirm`, `hooks/use-admin-headers`),
cross-checked against `backend/src/routes/admin/**` where contracts matter.
Predecessor: R142 lane D (findings-D.md — D-1/D-2/D-3 landed, D-4/D-6
deferred debt). Load model unchanged: 1–5 operators making money decisions
(topup approvals, refunds, wallet adjustments) on flaky Libyan mobile links.

Verification runs at HEAD (this audit):
`npx vitest run` over settings-telegram-rows + orders-credentials-retry +
orders-bulk-status + users-wallet-confirm + topups-approve-confirm →
**5 files / 32 tests, all green** (25.95 s).

---

## R142 fix verification

| Fix | Status | Evidence at `528ef39` |
|---|---|---|
| **D-1** settings Telegram rows — real 4-field contract | **VERIFIED** | `pages/admin/settings.tsx:161` (`fetchJsonOrNull` now rides `adminFetch`), `:187-193` (shape gate over `telegram_configured`/`platform_name`/`currency`/`maintenance_mode`), `settings-page-meta.ts:26-32` (TelegramSettings mirrors the real contract), `TelegramStatusRows.tsx:17,34,41` — all three rows ride `telegram_configured`. Pinned by `__tests__/settings-telegram-rows.test.tsx` (3 tests, green — includes the null-settings never-fabricates case). Known documented residual: a partial config (token set, chat missing) reads «غير موجود» on both key rows — per-key drilldown is the «اختبار» diagnostic ping. |
| **D-2** orders credentials retry affordance | **VERIFIED** | `pages/admin/orders.tsx:221-246` — the expand effect tracks `prevExpandedRowRef` and deletes the collapsed row's id from `failedCredentialIds` (:232-239), so collapse + re-expand re-fires the audited fetch; the B6-03 retry-spam guard stays armed while the row is open. Toast copy «حاول فتح الطلب مرة أخرى» (:146) is now an honest instruction. Pinned by `__tests__/orders-credentials-retry.test.tsx` (2 tests, green: re-expand re-fires; open-row guard intact). |
| **D-3** adminFetch 20 s timeout wrapper | **VERIFIED** (code; test pin partial — see L13-2) | `lib/admin-session.ts:60-70` (`SHARED_ADMIN_TIMEOUT_MS` = `DEFAULT_REQUEST_TIMEOUT_MS` with a mock-proof 20_000 fallback), `:237-251` — `adminFetch` threads `signal: init?.signal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined)`; `timeoutMs: 0` opt-out consumed once by the copilot SSE (`CopilotPanel.tsx:429`). The client-constant parity (20_000) is pinned by `pages/__tests__/money-races-r140.test.ts:407`; the wrapper's own signal wiring has **no behavioral pin** (L13-2). |

Residual vs the fix's stated intent: D-3's own minimal-fix text said
"then thread `AbortSignal.timeout(20_000)` into the ~8 bare `fetch(` call
sites listed above (or migrate them to adminFetchJson…)". Only the
settings.tsx site (via D-1) was threaded. **9 operations across 10 lines in
6 files remain bare** — the table below.

## Remaining bare-fetch sites (pages/admin/, non-test, at HEAD)

`rg '\bfetch\(' pages/admin/ -g '!**/__tests__/**'` → 10 lines; every one of
them carries its 401 handling (`isAdminUnauthorized` — the R122 discipline
held); the gap is **only the 20 s timeout contract**.

| # | Site | Operation | Money? | In-flight UX during a stall | Timeout today |
|---|---|---|---|---|---|
| 1 | `pages/admin/users.tsx:427` | wallet/points PATCH (`/api/admin/users/:id`) | **YES** | `saving=true` + `dismissable={!saving}` (UserEditDialog.tsx:70) → operator trapped in the money modal | ~300 s browser |
| 2 | `pages/admin/orders.tsx:377` | bulk-status PATCH (incl. bulk refund) | **YES** | `bulkUpdating` arms the BulkActionBar | ~300 s browser |
| 3 | `pages/admin/orders.tsx:134` | credentials GET (on-demand, audited) | no (PII read) | row shows «جارٍ تحميل بيانات التسليم…» | ~300 s browser |
| 4 | `pages/admin/products.tsx:530` | bulk archive DELETE (one-way door) | no | `bulkProcessing` disables the bulk buttons | ~300 s browser |
| 5 | `pages/admin/products.tsx:585` | bulk visibility PATCH | no | `bulkProcessing` | ~300 s browser |
| 6 | `pages/admin/promotions.tsx:214` | flash-sale activate/pause PATCH (activate reprices the WHOLE store) | price-impact | **none** — no busy state at all (L13-7) | ~300 s browser |
| 7 | `pages/admin/system.tsx:91` | observability GETs ×3 (alerts-recent, metrics, scheduler queryFns, 60 s polls) | no | panel freezes silently (poll slot blocked) | none |
| 8 | `pages/admin/system.tsx:116` | `/api/healthz/ready` GET (60 s poll) | no | health tile freezes without error | none |
| 9 | `pages/admin/login.tsx:65` | `/api/admin/probe` GET (session bootstrap) | no | pre-session; silent `return false` | ~300 s browser |
| 10 | `pages/admin/login.tsx:151` | verify-2fa POST | no | `isVerifying` spinner on the submit button | ~300 s browser |

(`components/admin/` non-test: **0** bare fetch sites — all extracts ride
adminFetch/adminFetchJson/generated fetchers. `hooks/`: only doc-comment +
storefront auth surfaces, out of scope.)

---

## Findings

### L13-1 · P3 · D-3 residual: the 10 remaining bare-fetch sites keep a ~300 s worst-case lockup window on the operator's money buttons — the one-fix landed only at the wrapper

- **Evidence:** the table above. The money cases are exactly D-3's original
  concrete case, unchanged: `users.tsx:427` (wallet PATCH — `setSaving(true)`
  at :393 arms `dismissable={!saving}` in `UserEditDialog.tsx:70`, disabled
  buttons at :77/:95) and `orders.tsx:377` (bulk refund — `bulkUpdating`
  arms at :366). The intent keys keep the MONEY safe (a retry replays;
  99-M3), but the documented retry UX stays unreachable in exactly the
  failure mode it exists for — a dead NAT/cold-start link parks the modal
  until the browser's ~300 s TCP timeout or a manual reload.
- **Root cause:** D-3's fix scope was the shared wrapper + the SSE opt-out +
  (via D-1) the one settings site. The 10 call sites the finding itself
  enumerated were never threaded — each kept its hand-rolled
  `fetch` + `isAdminUnauthorized` pair, which preserves the 401 contract but
  not the timeout contract.
- **Proposed fix (per site, mechanical):** swap `fetch(` → `adminFetch(`
  (the Response-untouched wrapper — every one of these sites already parses
  the body by hand, so adminFetch is drop-in) at users.tsx:427,
  orders.tsx:134/:377, products.tsx:530/:585, promotions.tsx:214,
  system.tsx:91/:116 (local `fetchAdminJson` wrapper), login.tsx:65/:151
  (login endpoints are AUTH_EXEMPT so adminFetch is a pure timeout add).
  Zero behavior change on healthy links; the catch blocks' Arabic mapping
  already collapses the abort DOMException via `getErrorMessage`.
- **Test requirement:** one module-level test per converted site class is
  overkill; a single pin on `adminFetch`'s timeout (L13-2) + the existing
  suites re-run green is sufficient. The orders-credentials-retry suite
  already stubs global fetch and would catch shape drift on site #3.
- **Risk if skipped:** every hand-rolled admin mutation and the system
  page's 4 observability polls keep the 300 s stall window (polls: a single
  stalled fetch freezes the panel's updates indefinitely with NO error
  surface — the quietest failure class in the console).

### L13-2 · P3 · D-3's fix has no behavioral test: nothing pins that `adminFetch` actually threads the 20 s timeout signal

- **Evidence:** `lib/__tests__/admin-session.test.ts` (172 lines) covers
  only the 401 handler / dedupe / redirect contract — no test imports or
  exercises `adminFetch`/`adminFetchJson` at all. The wave report's test
  column for D-3 reads "partial-mock-proof SHARED_ADMIN_TIMEOUT_MS guard"
  (`docs/engineering/R142/lanes/IMPL-wave-report.md:18`) — a code-level
  try/catch, not a test. The only 20 s pins in the repo are
  `money-races-r140.test.ts:407` (`expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(20_000)`
  — the client constant) and the customFetch suites — neither touches
  `adminFetch`.
- **Root cause:** the fix landed at the wrapper late in the wave; the pin
  was the fallback-guard comment rather than a behavioral assertion.
- **Concrete case:** a future refactor of `admin-session.ts:243-246` that
  drops `signal:` (or inverts the `??` precedence) ships green through the
  whole 2,325-test frontend suite while silently re-opening the 300 s
  lockup class across all ~34 adminFetch/adminFetchJson consumers.
- **Proposed fix / test requirement:** one module-level suite mirroring
  `custom-fetch-network.test.ts`'s idiom: stub global fetch capturing
  `init.signal`; assert (a) default call carries an aborted-at-20 s signal,
  (b) `timeoutMs: 0` passes `signal: undefined`, (c) a caller-provided
  `init.signal` wins untouched, (d) the 401 → `AdminSessionExpiredError`
  sentinel still fires. ~30 lines, no React.
- **Risk:** regression invisibility on the exact class this round fixed.

### L13-3 · P3 · Copilot SSE: the `timeoutMs: 0` exemption has no read-idle watchdog — a stalled mid-answer stream spins the turn forever

- **Evidence:** `components/admin/copilot/CopilotPanel.tsx:413-430` —
  `runAsk` deliberately opts out of the 20 s bound («the SSE stream …
  legitimately outlives 20 s»); the read loop `:494-516`
  (`while (true) { const { value, done } = await reader.read(); … }`) has
  no per-read deadline; the stream-END-without-final path IS honest
  (`:529-540` — «لم يصل رد من المساعد — انقطع البث قبل اكتمال الإجابة،
  حاول مجدداً»), but a stream that never ends and never delivers a byte
  (dead NAT link mid-answer) matches neither branch. The turn stays
  `loading: true` (patched at :326) with no per-turn cancel affordance —
  `onCancel` at :776 is the preview-execution cancel, not a stream abort;
  the composer is not disabled while a turn loads (:785-791), so the panel
  stays usable, but the stuck turn spins until the browser's ~300 s body
  timeout and then lands in the generic catch.
- **Root cause:** D-3's exemption replaced "always bounded" with "never
  bounded" for this one stream; there is no middle (idle) bound.
- **Proposed fix:** a read-idle watchdog — start an AbortController with a
  no-bytes timer (60–90 s is generous for token streaming), reset it on
  every `reader.read()` resolution, and on fire, abort + patch the turn
  with the same honest retryable error string the no-final path already
  uses. The controller's signal can be threaded as `init.signal` (which the
  `timeoutMs: 0` branch already respects: `init?.signal ?? …`).
- **Test requirement:** unit-test the watchdog with a fake ReadableStream
  that never emits (fake timers): assert the turn patches to the retryable
  error within the idle window.
- **Risk:** operator sees a permanently "thinking" assistant turn after a
  single network hiccup — erodes trust in the one AI surface, with no
  disclosed recovery.

### L13-4 · P3 · The three riskiest admin mutations are still test-unpinned (D lane's missing-test census #1/#3/#4 — debt confirmed live at HEAD)

- **Evidence:**
  1. **admins.tsx (RBAC surface) — zero behavioral page tests.** The only
     suites touching it are source-text assertions
     (`pages/__tests__/admin-admins-decomposition-r137.test.ts` — greps the
     page source for `adminFetch(` substrings). Creating operator accounts,
     editing permission scopes (incl. the super-admin `["all"]` preservation
     at `admins.tsx:315`), and disable/enable (which kills live sessions —
     the confirm says so at :229-231) are unpinned. A regression that sends
     `[]` on create ships green.
  2. **users.tsx 99-M3 intent-key retry semantics.**
     `users-wallet-confirm.test.tsx` pins ONE PATCH-with-key (:223 «confirm
     fires the PATCH once with the amount + Idempotency-Key + note»); no
     test drives failure → re-click asserting the SAME Idempotency-Key
     replays and is kept only on 409 `IDEMPOTENCY_IN_FLIGHT`
     (users.tsx:400-452). That's the frontend half of the wallet
     double-apply guard.
  3. **enrichment.tsx — zero behavioral page tests.** Publish REPLACES live
     catalog content (confirm exists for both paths, enrichment.tsx:296-307,
     incl. the edited-path); nothing pins that the confirm fires before the
     POST or that reject threads the reason.
- **Root cause:** recorded debt from R142 (D's missing-test census), not
  re-attempted.
- **Proposed fix / test requirement:** three small page suites in the
  orders-credentials-retry idiom (module-boundary mocks + stubbed global
  fetch): (a) admins create → assert POST body scopes; disable → assert
  confirm + sessions-killed copy; edit super-admin → assert `["all"]`
  preserved; (b) users wallet failure (500) → re-click → assert SAME key
  header + kept on 409 IN_FLIGHT; (c) enrichment publish → assert the
  confirm dialog precedes the POST; reject → assert reason rides the body.
- **Risk:** the RBAC surface and the money-replay guard are the two places
  where a silent frontend regression is both likely (form refactors) and
  expensive (wrong scopes on new admins; double wallet delta).

### L13-5 · P4 · Topups status tabs: the URL contract is one-way — tab flips never write `?status=` back, so a refresh silently resets the operator's view

- **Evidence:** `pages/admin/topups.tsx:75-78` — the filter is initialized
  from `?status=` (deep-link support, R120-B4 A2-F7: the layout's
  «قيد الانتظار فقط» action links here), but no `syncFilterParams`-style
  write exists anywhere in the file (`rg replaceState` → 0 hits). Contrast:
  orders (`orders.tsx:497-499`), users (`users.tsx:168-177`), tickets
  (`tickets.tsx:254-261`), settings (`settings.tsx:239-244`) all write
  filter state back via `history.replaceState`.
- **Concrete case:** operator on the «الكل» tab (all statuses) hits
  refresh → lands on the default «قيد الانتظار» tab and briefly believes
  the queue shrank. No data is wrong; the tab counts re-derive honestly.
- **Proposed fix:** mirror the tickets.tsx `syncFilterParams` idiom in the
  tab `onSelect` (3 lines + the URL→state effect guard the file already
  documents).
- **Test requirement:** extend `topups-status-tab-query.test.tsx` with a
  tab-flip → `?status=` write assertion + mount honoring it.
- **Risk:** polish — view-state divergence on the money queue only.

### L13-6 · P4 · D-2 residual polish: the failed-credentials inline red line carries no retry instruction — the honest instruction lives only in the transient toast

- **Evidence:** `components/admin/orders/DesktopOrderRow.tsx:164-166` —
  `{order.has_credentials && credsFailed && (<span className="text-destructive">تعذّر تحميل بيانات التسليم</span>)}`.
  The fixed retry path (collapse → re-expand) is disclosed only in the
  6-second toast (`orders.tsx:144-148`); an operator who missed the toast
  sees a bare red line with no affordance and no hint that the row toggle
  retries. The mobile twin mirrors it.
- **Proposed fix:** one line of copy («أغلق الصف وأعد فتحه للمحاولة») or a
  real retry button that deletes the id from `failedCredentialIds` and
  re-fires `ensureOrderCredentials` — the second option D-2's write-up
  named.
- **Test requirement:** whichever lands, extend
  `orders-credentials-retry.test.tsx`.
- **Risk:** none beyond operator confusion on the support/fraud workflow.

### L13-7 · P4 · Flash-sale activate/pause PATCH fires with no busy state — no in-flight feedback, no double-click guard, no pending UI

- **Evidence:** `pages/admin/promotions.tsx:198-244` (`toggleActive`) —
  unlike every sibling mutation on the page (`submitting` for create,
  confirm-gated delete), the PATCH at :214 has no `setBusy`-style state:
  the button stays enabled through the request (double-click re-fires a
  second PATCH — benign today because the body is `{is_active: next}` and
  the server's partial-unique-index guard makes it idempotent-ish, but the
  operator gets zero pending feedback), and on a stalled link nothing at
  all happens until the browser timeout feeds the catch (:237-243). Its own
  sibling `handleDelete` (R125-I3) and `CreatePromotionForm` both carry
  busy states.
- **Proposed fix:** a `togglingId` state in the promotions idiom
  (promotions-meta has the row contract) + disable the row's buttons while
  in flight; rides naturally on the L13-1 adminFetch conversion.
- **Test requirement:** none beyond a source pin if desired; behavior is
  cosmetic.
- **Risk:** polish; mild double-fire on the action that reprices the whole
  store (server-guarded).

### L13-8 · INFO · E-7 cross-reference (lane E's finding, noted per charter — not re-deep-dived): the 207 body's `success` field is statically `false`

- **Evidence:** `backend/src/routes/admin/orders.ts:599-606` — the
  full-success arm returns early (`{ success: true, updated }` at :600);
  the 207 arm then computes `success: failures.length === 0` (:603), which
  is provably always `false` on that path (dead field — lane E's E-7).
- **Operator-surface impact at HEAD: none.** The frontend
  (`orders.tsx:400-418`) parses `updated` + `failed[]` and renders the
  honest «تم تحديث N من M» + per-order Arabic reasons; it never reads
  `success`. The E-7 class (claimed success vs partial failure) does NOT
  exist on this surface — the B5-02 fix (R111) holds end-to-end.
- **Disposition:** belongs to lane E/backend; flagged here only so the
  admin-side reading of the 207 contract is on record.

---

## Deferred-debt status confirmations (unchanged at HEAD, as recorded in the R142 ledger)

- **D-4 (P4, deferred):** products editor ⌘S synthetic submit still
  dispatches a bubbling `submit` event
  (`products.tsx:317` — `dispatchEvent(new Event("submit", …))`, which does
  not run native constraint validation) and `handleSubmit` still sends
  `price: parseFloat(form.price)` with no `Number.isFinite` guard
  (`products.tsx:405`). Server zod still backstops it; only the shortcut
  path leaks a raw 400 toast.
- **D-6 (P4, deferred):** the dashboard's two CSV exports still raw-join
  cells — `chart-csv.ts:37` (`r.join(",")`) and `dashboard.tsx:264`
  (handleExportUsersChart, same join) — outside the shared `csvCell`
  escaper users/security/orders adopted in R128. No live failure case
  (ISO dates / 2-decimal ungrouped money / Arabic month keys; no
  `=/+/-/@`-leading cells today).

## Hunt results — verified clean (evidence, not assurance)

- **Money ops show consequences before commit:** topup single approve
  (amount + user + payment reference, topups.tsx:389-393), reject modal
  with note; bulk/approve-all with live progress + per-item Arabic failure
  reasons in ONE toast + session-expiry break inside try/finally; orders
  bulk refund confirm shows count + TOTAL LYD (orders.tsx:356-364) with
  honest 207 partial parse + skipped-count disclosure (:424-429); wallet
  adjust previews the resulting balance + points' LYD equivalent + negative
  warning (users.tsx:353-391); referral credit previews LYD value
  (referrals.tsx:142-146); pricing recompute is two-step
  (dry-run preview → destructive confirm with counts, pricing.tsx:294-314).
  All money mutations refresh affected queries on success (base-key
  invalidation + stats co-invalidation where the stat moves).
- **Success states are truthful (E-7 class hunted):** topups bulk loops
  announce success ONLY when ≥1 succeeded and failures=0 (topups.tsx:527);
  products `summarizeBulk` counts real outcomes; coupons archive names the
  archive outcome; copilot stream-end-without-final renders an honest
  retryable error (CopilotPanel.tsx:529-540). No claimed-success-over-
  partial-failure surface found besides the noted backend `success` field
  (L13-8), which no UI reads.
- **Settings stale-status rows (D-1 class):** TelegramStatusRows is the
  only integration-status surface in the settings UI and is now
  contract-true + shape-gated. The auth-providers tab's «مُعدَّ» badge
  mirrors the backend's own `hasConfig` computation
  (auth-settings.ts:203 — `fields.some(f => !f.isSecret && !!cfg[f.key])`),
  and the provider toggle rolls back optimistically on failure
  (provider-card.tsx:149-152). **No WhatsApp or Sentry status rows exist
  anywhere in the admin UI** (WhatsApp is a live-state console page;
  Sentry is boot-time SDK infrastructure, never surfaced as a settings
  row) — no other D-1-class stale rows found.
- **Loading/error/empty states:** every list page carries the three-state
  contract (skeleton → FetchErrorCard w/ retry on first-load failure →
  empty state) plus the stale-keep banner on refresh failure
  (orders/topups/users/tickets/referrals/risk/alerts/enrichment/whatsapp/
  coupons/promotions/admins/system/security/dashboard). Sticky-failure
  hunt: D-2 was the only page-lifetime-sticky surface and it is fixed;
  the remaining stall class is the no-timeout fetches (L13-1) and the SSE
  idle gap (L13-3).
- **Filters + pagination:** orders (search/status/days in URL, server-side
  debounced search, client status/date over accumulated pages — honest by
  design), users (tier/sort/filters URL two-way + server search),
  tickets (status/category URL two-way + server-side status),
  topups (server-side status per tab; search client-side with the
  partial-window hint; one-way URL — L13-5), risk (cursor hasMore
  envelope), enrichment (cursor + pending-count window honesty),
  alerts (envelope hasMore). **No unbounded client-side rendering**:
  every accumulating list appends by explicit load-more; server-capped
  full lists are disclosed (coupons 200 / referrals 200 with
  REFERRALS_SERVER_CAP window copy / auth-activity 100 / products 200).
- **Destructive confirms:** every one-way-door write is confirmed with
  named object + consequence (topup approve/reject, bulk refund, wallet
  set/add/subtract, product archive single+bulk, coupon archive, flash
  sale activate + permanent delete, referral credit, enrichment publish
  (both paths), admin disable (sessions-killed), whatsapp session delete,
  pricing recompute, alerts deletes ×3). Reversible toggles (visibility,
  coupon active, ticket close/reopen, whatsapp start/pair, risk labels —
  additive history) deliberately ride without confirm — consistent policy.
- **RBAC dead-ends:** none — the R134 A3-F1 `AdminScopeGate` + `enabled`
  gating pattern verified present on all 16 scope-gated pages; in-page
  money-field gates (canEditMoney/canBulkRefund/canCredit) mirror backend
  finance scopes.
- **Admin console performance:** memoized row components + useMemo chains
  on every keystroke-heavy page (orders/users/topups); 300 ms debounced
  searches in query keys (aborting predecessors); 5-min refetch fallbacks
  behind socket `admin-stats-update` pushes; the r139 design family did
  not regress the state contracts.

## Not checked / limits

- ~160 presentational extracts were verified structurally (symbol
  consumers, props contracts) — same boundary as lane D.
- 62 admin test suites were not all re-run; 5 representative suites
  re-run green at HEAD (32 tests) incl. both R142 pins. Full gate runs
  are the R143 implementation lane's job.
- No production admin login attempted (charter); all operator-journey
  conclusions are code-level. Backend money services (lane G/E territory)
  were read only where the frontend contract required it (bulk-status 207
  shape, settings/auth fields, list caps).
