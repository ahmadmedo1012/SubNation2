# Lane D findings — R142 admin interface & operator workflows

Task ID: 142-D1 · read-only audit · HEAD `a9f5e83` (production-live SHA, tree clean
except `docs/engineering/`).
Scope: `frontend/src/pages/admin/**` + `frontend/src/components/admin/**` (279
inventory files, ~47.7k lines incl. co-located tests) + 6 cross-cut files
(use-confirm, admin-session, routes.tsx admin subtree, backend
routes/admin/settings.ts, use-admin-headers, use-dirty-guard). Nothing was edited.

Load assumed: a small operator team (1–5 concurrent admins) making money
decisions (topup approvals, refunds, wallet adjustments, catalog pricing) on
flaky Libyan mobile links — the surface where a stalled spinner or a lying
empty state costs real money.

---

## Admin route / permission map (code truth, not docs)

Frontend truth sources: `app/routes.tsx:268-286` (route table),
`components/admin/layout/nav-sections.ts:32-102` (nav scopes), per-page
`hasAdminPermission(...)` gates. Parity is pinned by
`admin-layout-nav-scope.test.tsx`.

| Route | Page scope gate (code line) | Nav scope | Extra in-page scope gates | Verdict |
|---|---|---|---|---|
| /admin (dashboard) | none (route-guard only) | — (always visible) | `canSeeMoney=finance` gates stats/chart queries + money tiles (dashboard.tsx:81,91,148,381) | ✅ matches backend finance-gating of /admin/stats |
| /admin/topups | finance (topups.tsx:64) | finance | queries `enabled: !!adminToken && canView` (:185) | ✅ |
| /admin/orders | orders (orders.tsx:66) | orders | `canBulkRefund=finance` hides refund option (:539) — mirrors the backend 403 on PATCH refunded | ✅ pinned by orders-bulk-status.test.tsx:274 |
| /admin/products | inventory (products.tsx:66) | inventory | — | ✅ |
| /admin/products/enrichment | inventory (enrichment.tsx:101) | inventory | query `enabled: canView` (:124) | ✅ |
| /admin/pricing | inventory (pricing.tsx:89) | inventory | — | ✅ |
| /admin/users | users (users.tsx:66) | users | `canEditMoney=finance` disables wallet/points fields (:551) — mirrors backend finance gate on PATCH | ✅ |
| /admin/referrals | users (referrals.tsx:65) | users | `canCredit=finance` disables credit button (:202) — mirrors backend | ✅ pinned by referrals-finance-gate.test.tsx |
| /admin/coupons | finance (coupons.tsx:51) | finance | — | ✅ (nav comment documents the R120-B4 fix: was inventory) |
| /admin/promotions | inventory (promotions.tsx:63) | inventory | — | ✅ |
| /admin/tickets | support (tickets.tsx:87) | support | — | ✅ |
| /admin/alerts | support (alerts.tsx:91) | support | — | ✅ |
| /admin/admins | admins (admins.tsx:52) | admins | — | ✅ |
| /admin/risk | users (risk.tsx:64) | users | queries `enabled: … && canViewRisk` | ✅ |
| /admin/risk/events/:id | users (risk-event.tsx:103) | (deep-link only) | query `enabled` triple-gated (:109) | ✅ |
| /admin/security | admins (security.tsx:88) | admins | three queries scope-gated | ✅ |
| /admin/system | settings (system.tsx:76) | settings | six queries scope-gated | ✅ |
| /admin/whatsapp | settings (whatsapp.tsx:68) | settings | loadSessions guard | ✅ |
| /admin/settings | per-tab `tabAllowed` (settings.tsx:97, meta:14-16) | — (always visible) | auth+integrations tabs settings-only; account/notifications/security self-service | ✅ |

Deep-link honesty: every scope-gated page renders the shared `AdminScopeGate`
banner («هذه الصفحة تتطلب صلاحية …») AFTER all hooks, with queries
`enabled:false` — no 403-burst, no outage-dressed-as-403 (R134 A3-F1 wave,
verified present on all 16 gated pages). Layout chrome is equally scoped:
alerts badge + 5-min alert poll are support-gated (layout.tsx:74,304), the
stats badge is finance-gated (:151,168), ⌘K GlobalSearch renders only with
orders/users/inventory (:241-242, GlobalSearch.tsx:97-100). **No page calls an
endpoint its operator role can't hit** — the R120-B4/R122/R134 waves closed
every 403 dead-end this audit hunted for.

## Operator-journey state-quality table (money + catalog paths)

| Journey | Destructive confirm | Idempotency-Key | Failure feedback | Empty/loading honesty | Verdict |
|---|---|---|---|---|---|
| Topup single approve | ✅ useConfirm with amount+user+ref (topups.tsx:389-393) | ✅ per-click key, survives RQ retry (:400-404) | ✅ envelope-parsed Arabic toast | ✅ FetchErrorCard vs false-empty split (:750-784); load-more; partial-window search hint | ✅ best-in-repo |
| Topup single reject | ✅ RejectModal + optional note, guarded dismiss | ✅ per-click (:413-417) | ✅ | ✅ | ✅ |
| Topup bulk + approve-all | ✅ BulkConfirmModal w/ live «جاري done/total» | ✅ per-iteration keys (F-008, :487, :590) | ✅ per-item Arabic reasons in ONE toast; session-expiry break + try/finally | ✅ busy guard kills double-loop (B5-01) | ✅ |
| Order bulk status / bulk refund | ✅ confirm names count + TOTAL LYD (orders.tsx:325-341) | ✅ per-click key (:356) | ✅ 207 partial parse + REFUND_FAILURE_LABELS (:377-395) | ✅ stale-keep banner + error card | ✅ (raw fetch → D-3) |
| Order credentials on demand | n/a (read) | n/a | ⚠️ toast says retry, code makes retry impossible | ⚠️ failed branch = bare red line, no affordance | **D-2** |
| Wallet / points adjustment | ✅ confirm previews resulting balance + LYD points equivalent (users.tsx:353-391) | ✅ intent-key survives retries, kept only on 409 IN_FLIGHT (99-M3, :400-452) | ✅ backend-Arabic-first describeSaveError | ✅ | ✅ (raw fetch → D-3) |
| Product create/edit/archive | ✅ archive = one-way-door honest copy (products.tsx:295-307, 507-517) | n/a (server-guarded) | ✅ | ✅ dirty guard, SEO-touched flags, capped-window hint | ✅ (⌘S validation gap → D-4) |
| Bulk archive / visibility | ✅ archive confirms; toggle is reversible | n/a | ✅ summarizeBulk counts real outcomes | ✅ | ✅ (raw fetch → D-3) |
| Inventory upload | n/a (additive) | n/a | ✅ sticky-fail disclosed (A3-F3) | ✅ dedup preview vs DB | ✅ |
| Variants CRUD | ✅ delete confirm + 409 wording preserved | n/a | ✅ describeError | ✅ | ✅ |
| Pricing rule save + catalog recompute | ✅ two-step: dry-run preview → destructive confirm with counts (pricing.tsx:294-314) | n/a | ✅ | ✅ stale-keep on calc error | ✅ |
| Coupon create/toggle/archive | ✅ archive = honest «يتوقف قبوله فوراً… يمكن استعادته» (coupons.tsx:239-246) | n/a | ✅ | ✅ | ✅ |
| Flash-sale activate/pause/delete | ✅ activate confirms (reprices whole store); delete = «حذف نهائي» honest verb split | n/a | ✅ 409 titles | ✅ | ✅ (raw fetch → D-3) |
| Referral credit | ✅ confirm with LYD equivalent (referrals.tsx:142-146) | ✅ per-click key | ✅ | ✅ | ✅ |
| Enrichment publish/reject | ✅ publish confirm names product + field, edited-path too | n/a | ✅ inline + reject dialog | ✅ cursor pagination + pending-count honesty | ✅ |
| Admin account CRUD + scopes | ✅ disable/enable confirm names sessions-killed (admins.tsx:224-234) | n/a | ✅ | ✅ | ✅ but **zero tests** (missing-test #1) |
| WhatsApp session mgmt | ✅ delete confirm (whatsapp.tsx:277-282) | n/a | ✅ toast + stale-keep banner | ✅ pair-code staleness cue | ✅ |
| Settings integrations | n/a | n/a | ✅ error card w/ retry | ❌ **permanently wrong rows** | **D-1** |
| 2FA setup / account / password | password gates + honest logout-on-change | n/a | ✅ inline + rotate-flow recovery | ✅ | ✅ |
| Alerts inbox | ✅ all 3 delete paths confirm | n/a | ✅ **optimistic updates WITH rollback** (alerts.tsx:146-240) | ✅ hasMore envelope | ✅ |

---

## Findings

### D-1 · P3 — CONFIRMED (N-4 cross-ref): settings «التكاملات» TELEGRAM rows permanently show «غير موجود» even when configured

- **What this is:** the operator-facing confirmation of lane N's N-4, verified
  end-to-end on the UI side at HEAD.
- **Chain (all lines at a9f5e83):**
  `pages/admin/settings.tsx:149-160` — `fetchJsonOrNull` is a **raw
  `fetch`** (line 150), not the generated `useGetAdminSettings` and not
  `adminFetchJson`; `:169` then casts
  `sysSettings as unknown as TelegramSettings` into a legacy local type
  (`components/admin/settings-page/settings-page-meta.ts:18-23`) whose
  `telegram_chat_set` (required!) and `telegram_bot_set` (optional) fields the
  backend has **never emitted** — `backend/src/routes/admin/settings.ts:16-21`
  answers exactly `{telegram_configured, platform_name, currency,
  maintenance_mode}`.
- **Concrete case:** an operator with TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
  correctly configured opens الإعدادات → التكاملات. Row 1 («الحالة العامة»)
  reads «مفعّل ويعمل» (green) — `telegram_configured` is real — while rows 2
  and 3 (`TelegramStatusRows.tsx:24` reads `settings?.telegram_bot_set`,
  `:31` reads `settings?.telegram_chat_set`) both read `undefined` → render
  the red XCircle «غير موجود» («not set»). The operator concludes the token
  is missing and re-configures / redeploys against a healthy integration.
  Only the raw-fetch + `as unknown as` bypass let a wrong local contract
  survive while the generated client knew the truth.
- **Minimal fix (frontend, 2 lines):** in `TelegramStatusRows.tsx`, drive both
  rows from real signals — either drop them (the «الحالة العامة» row is the
  real verdict) or derive both from `telegram_configured` / the
  `/admin/settings/auth` provider config. Or make the backend emit the two
  booleans (spec+handler+codegen — bigger). While there, swap
  `fetchJsonOrNull`'s raw `fetch` for `adminFetchJson` so the page matches its
  own header comment («the seven raw fetches ride the session-aware
  wrappers» — this one didn't).
- **If we skip it:** every settings visit shows two confidently-wrong red rows
  on the one panel operators trust for integration health.
- **Missing test:** no suite covers the integrations tab at all — this is the
  exact class a one-test pin (`render TelegramStatusRows with the real
  4-field AdminSettings shape`) would have caught (see missing-test #2).

### D-2 · P3 — a failed credentials fetch is sticky forever AND the toast tells the operator to retry what the code makes a no-op

- **Where:** `pages/admin/orders.tsx:112-149` (ensureOrderCredentials),
  consumed by the expand effect `:216-223`; failed branch rendered at
  `components/admin/orders/DesktopOrderRow.tsx:164-166` (and the mobile twin).
- **Concrete case:** operator expands order #1024 to read delivery
  credentials; the audited GET `/api/admin/orders/1024/credentials` hits a
  transient 502. The catch adds the id to `failedCredentialIds` (:137-138) and
  toasts «تعذّر تحميل بيانات التسليم — **حاول فتح الطلب مرة أخرى**»
  (:139-143). The operator collapses the row and expands it again — exactly
  what the toast says — but `ensureOrderCredentials` early-returns on
  `failedCredentialIds.has(orderId)` (:120-124), so **no request ever fires
  again for that order for the rest of the page's life**. The expanded row
  shows a bare red «تعذّر تحميل بيانات التسليم» with no retry affordance
  (DesktopOrderRow.tsx:164-166); the only recovery is a full page reload,
  which nothing discloses. The B6-03 comment documents the deliberate
  retry-spam guard («a failure is remembered too»), but the guard's lifetime
  (page) contradicts both the toast copy and the operator's expectation.
- **Minimal fix:** on row collapse (or on re-expand), clear the id from
  `failedCredentialIds` — e.g. in the expand effect, when `expandedRow`
  changes away, `setFailedCredentialIds(prev => {next=new Set(prev);
  next.delete(prevId); return next})` — or render a real retry button in the
  failed branch that deletes the id and re-fires. One of the two, plus align
  the toast copy with whichever you pick.
- **If we skip it:** after any single transient failure, that order's
  credentials are unreachable until reload — on the support/fraud workflow
  that needs them.

### D-3 · P3 — hand-rolled operator mutations ride raw `fetch` with NO timeout — the app-wide 20 s customFetch contract does not cover the admin's money buttons (G-1 class, operator side)

- **Where (every site, non-test):**
  `pages/admin/users.tsx:427` (wallet/points PATCH — money),
  `pages/admin/orders.tsx:354` (bulk-status PATCH — bulk refund, money),
  `pages/admin/orders.tsx:129` (credentials GET),
  `pages/admin/products.tsx:530` (bulk DELETE) and `:585` (bulk PATCH),
  `pages/admin/promotions.tsx:214` (flash-sale PATCH),
  `pages/admin/settings.tsx:150` (settings GET),
  `pages/admin/system.tsx:91,116` (healthz GETs),
  `pages/admin/login.tsx:65,151` (probe + verify-2fa).
  The two shared wrappers themselves are unbounded:
  `lib/admin-session.ts:208-214` (`adminFetch` = plain `fetch`) and
  `adminFetchJson` on top of it.
- **Concrete case (the money one):** operator taps «تنفيذ التعديل» on a
  wallet adjustment over a dead NAT/cold-start link. The raw `fetch` never
  settles on the app's clock; `setSaving(true)` (users.tsx:393) stays armed,
  the UserEditDialog's `dismissable={!saving}` + disabled buttons leave the
  operator **trapped inside the money modal** until the browser's ~300 s
  timeout or a manual reload — the intent key keeps the money safe (a retry
  replays), but the documented retry UX is unreachable in exactly the failure
  mode it exists for. Same shape for the bulk-refund button
  (`bulkUpdating` arms, orders.tsx:343) and every other site above. Lane G
  filed this exact class as **G-1 (P2)** for the storefront loyalty CTA; the
  topup approve/reject paths are safe (generated fetchers ride customFetch's
  20 s abort) — it's the hand-rolled mutations that escape the contract.
- **Minimal fix (one shared guard, deletes the class):** add
  `signal: init?.signal ?? AbortSignal.timeout(20_000)` inside
  `adminFetch` (lib/admin-session.ts:208) — every adminFetchJson call site
  inherits it; then thread `AbortSignal.timeout(20_000)` into the ~8 bare
  `fetch(` call sites listed above (or migrate them to adminFetchJson where
  the shape allows). Zero behavior change on healthy links.
- **If we skip it:** every hand-rolled admin mutation keeps a 300 s worst-case
  lockup window on flaky links — the exact links Libyan operators use.

### D-4 · P4 — products editor: the ⌘S synthetic submit bypasses native validation and handleSubmit has no numeric guard (the users.tsx guard exists for exactly this)

- **Where:** `pages/admin/products.tsx:310-318` (⌘S dispatches a synthetic
  `submit` event — `dispatchEvent` does NOT run the browser's constraint
  validation, unlike `requestSubmit()`) + `:399-427` (`handleSubmit` sends
  `parseFloat(form.price)` with no `Number.isFinite` guard).
- **Concrete case:** operator clears the price field (or the form never had
  one on a rushed edit) and hits ⌘S. `handleSubmit` runs with
  `price: NaN` → JSON serializes to `null` → the backend zod 400s → the
  operator gets the generic «خطأ» toast with the server message instead of
  the honest client-side guard. No wrong data lands (server validates), so
  this is UX + idiom drift: users.tsx:297-306 added exactly this guard
  («A non-numeric value now blocks the submit outright») after the round-93
  silent-drop bug; the products editor never got the twin. The click path is
  safe (native `required`/`min=0` block it); only the shortcut path leaks.
- **Minimal fix:** mirror the users.tsx guard at the top of `handleSubmit`
  (3 lines: parse → `!Number.isFinite || < 0` → destructive toast + return).
- **If we skip it:** occasional raw 400 toasts on the shortcut path.

### D-5 · P4 (D-side confirmation of J-1, P2) — destructive-confirm family rides the raw `--destructive` channel in two admin spots

- **Where:** `hooks/use-confirm.tsx:132-135` — the shared confirm's
  destructive branch hand-rolls `bg-destructive` (raw channel, 4.00:1 — AA
  fail per lane J's computation) instead of
  `buttonVariants({ variant: "destructive" })` (which uses the AA
  `--destructive-surface`); this is the confirm behind **13 admin pages'**
  destructive actions. And `components/admin/topups/RejectModal.tsx:95` —
  same raw `bg-destructive` at `h-9` (36 px, under the money-path 44 px
  floor) while its own sibling `BulkConfirmModal.tsx:78-82` already uses the
  correct `bg-destructive-surface` — two recipes inside one dialog family,
  one money surface.
- **Concrete case / fix / evidence:** see J-1 (lane J) — verified from the
  operator-surface side here: the topups reject confirm is the single-reject
  money gate and is the one dialog in the family off-token. Fix is J-1's
  one-liner (use-confirm → `cn(buttonVariants({variant:"destructive"}))`;
  RejectModal → `variant="destructive"` + `min-h-11`).

### D-6 · P4 — the dashboard's two CSV exports never adopted the shared `csvCell` (RFC-4180 + formula-injection guard)

- **Where:** `components/admin/dashboard/chart-csv.ts:29-37`
  (`r.join(",")` on raw cells) and `pages/admin/dashboard.tsx:262-274`
  (`handleExportUsersChart` — same raw join). The shared `csvCell`
  (lib/csv.ts) was adopted by users (:625), security (both arms,
  security.tsx:262-263/296-297) and orders (orders-csv) in R128 (B3-F2);
  users.tsx:610-614 even documents the dashboard divergence as deferred.
- **Concrete failure case:** **none today** — the chart cells are ISO dates /
  `ar-LY-u-nu-latn` month keys («أكتوبر 2026», no ASCII comma) and the money
  columns ride the grouping-off 2-decimal formatter (chart-csv.ts:14-18,
  which is itself the A5-F13 fix), and no cell starts with `=/+/-/@`. So this
  is a lean/consistency finding: two exports outside the one escaper the repo
  already ships, one line each to wrap.
- **Minimal fix:** `row.map(csvCell).join(",")` in both places.

---

## Missing tests — the 5 riskiest admin mutations without a failing test

1. **admins.tsx (RBAC surface) — ZERO page tests.** Creating operator
   accounts, editing permission scopes (incl. the super-admin `["all"]`
   preservation at admins.tsx:315), and disable/enable (which kills live
   sessions) are entirely unpinned. A regression that drops the finance scope
   off every created admin — or sends `[]` — ships green.
2. **Settings integrations tab (D-1's class).** No suite renders
   TelegramStatusRows against the real 4-field `GET /api/admin/settings`
   shape; the permanently-wrong rows survived every round because nothing
   pins them.
3. **users.tsx 99-M3 intent-key retry semantics.** users-wallet-confirm pins
   ONE PATCH-with-key, but no test drives failure→re-click asserting the SAME
   Idempotency-Key replays (and is kept on 409 IDEMPOTENCY_IN_FLIGHT) — the
   frontend half of the wallet double-apply guard.
4. **enrichment.tsx (zero page tests).** Publish REPLACES live catalog
   content (confirm exists at enrichment.tsx:296-307, edited-path included);
   nothing pins that the confirm fires before the POST or that reject threads
   the reason.
5. **orders.tsx credentials-on-demand failure path (D-2).** Nothing covers
   `failedCredentialIds` behavior — the current stickiness (and its
   contradictory toast) is unpinned; whichever fix lands needs the pin.

---

## Hunt results (verified clean — evidence, not assurance)

- **Dead admin code:** symbol-level consumer check over all 217 non-test
  inventory files — **0 unreferenced modules** (16 path-alias false
  positives re-verified by exported symbol: all consumed). Every route in
  routes.tsx maps to a live page; no orphan admin routes (the historical
  /admin/security orphan was fixed into NAV_SECTIONS:96).
- **Duplicated table/form logic:** the R137 decomposition is disciplined —
  orders/TableSkeleton.tsx *wraps* the shared TableSkeleton (rows/cells
  params), not a copy; per-page skeletons are page-shaped (card vs table) by
  documented design; every dialog family (AppDialog/useConfirm) is
  single-sourced; money mutations stay page-owned with extracts taking
  values+callbacks only (verified in TopupCard/ProductEditorCard/
  CreateAdminDialog wiring).
- **Mutations without invalidation:** none found — every mutation either
  invalidates the generated base key (topups/orders/users/products/referrals/
  pricing/variants/risk-event/tickets) or refetches its own local state
  (coupons/promotions/whatsapp/admins — self-consistent local-state pages);
  stats co-invalidation is present on every stats-feeding write
  (products/users/tickets/risk-event) and socket `admin-stats-update` covers
  other tabs.
- **SSR/window safety:** CSR SPA confirmed; `window.location.search` reads
  all live in useState initializers / effects (topups.tsx:75-78,
  orders.tsx:80-94, users.tsx:75-95, settings.tsx:102-105); global keydown
  listeners all have cleanup; no top-level window access outside component
  bodies — no fresh-load null crash found.
- **Races on rapid operator actions:** the money surfaces are covered —
  debounced searches enter the query key (aborting predecessors), approveAll
  has the re-click guard + progress, tickets `statusBusy` in-flight guard
  (:298), login has the same-tick `verifyingRef` (login.tsx:46,129,141),
  GlobalSearch aborts per keystroke (GlobalSearch.tsx:131-197), alerts does
  cancelQueries + rollback before optimistic writes. The one race-shaped
  residual is D-3's unbounded fetches (no timeout = the ultimate stale
  in-flight).
- **Permission dead-ends:** none (see the route/permission map — every UI
  gate mirrors its backend requirePermission, most pinned by tests).

## Not checked / limits

- The ~160 presentational extracts (badges, headers, meta modules, chart
  sections, system sections, ticket cards, user rows, etc.) were verified
  **structurally** (symbol consumers, mutation-ownership via page reads,
  state/mutation greps), not line-read end-to-end — their state contracts are
  pinned by the R137 decomposition comments and the page reads that consume
  them.
- 59 of the 62 test suites were verified structurally (imports resolve — 0
  unresolved; subjects exist); 3 representative suites re-run green at HEAD
  (topups-approve-confirm 4/4; orders-bulk-status + users-wallet-confirm
  23/23). The full 62-suite run was not repeated this round.
- No production admin login was attempted (charter); all operator-journey
  conclusions are code-level. Lane G owns the backend money services, lane H
  the auth/RBAC middleware, lane N the contract machinery — cross-referenced,
  not re-audited.
- CopilotPanel's 795 lines were read at the state/mutation core
  (store/persistence, submit/draft/ask/SSE/confirm flows) plus the module
  graph; the pure render extracts (TurnView, MarkdownLite, PreviewCard…) were
  structural only.
