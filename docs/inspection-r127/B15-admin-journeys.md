# R127-B15 — Admin Panel Full-Journey Audit (لوحة التحكم بكل تفاصيلها)

**Agent:** R127-B15 (read-only auditor — only this report + one worklog entry). **Repo:** `f53a886` (= production, clean tree).
**Scope:** operator-journey walk of every admin surface, page by page: dashboard, orders, products, topups, users, referrals, tickets, whatsapp, alerts, security, risk, risk-event, settings (post-split shell + `settings/{account-tab,two-factor-setup,provider-card}`), login, the admin layout shell, and profile/SessionManager (+ SessionActivityManager) — 19 surfaces, ~21k lines code-walked.
**Lens (the journeys R126 A1–A4 did NOT walk):** interaction-state truth (initial/empty/error/success/offline), keyboard + focus (R96 heritage re-check), tables/lists consistency (pagination model, URL state, 390px columns, row-action discoverability), forms (dirty-guard coverage, double-fire, validation timing, server-error mapping), operator workflows (confirm-consequence copy, bulk progress feedback, **audit-trail visibility**), destructive actions (useConfirm coverage, undo, type-to-confirm), and cross-page coherence (terminology, tokens, iconography, date/number formats).
**Exclusions honored:** R126 A1 (money pages), A2 (catalog/customers), A3 (ops/settings/security), A4 (data contracts) held-open items are **not** re-reported — they are re-verified and carried in §G's pointer table. R127-B2's products select-all (products.tsx:867-870), B6's socket-staleness family, B3's storefront polish, B5's PWA surface — excluded by scope.

**Method:** full reads of every page + shared surfaces (`layout.tsx`, `hooks/use-confirm.tsx`, `hooks/use-dirty-guard.ts`, `lib/utils.ts`, `SessionManager.tsx`, `SessionActivityManager.tsx`, `no-native-confirm.test.ts` guard list), schema reads (`audit_logs`, `wallet_ledger`, `points_ledger`, `ticket_replies`), backend route greps for the audit-trail question, R126-L3/L5/L9 landed-fix verification (commits `70489a2`, `0d8980d`, `b0a9267`, `e8088fd`). Static only; no builds, no test runs, no production requests beyond zero (read-only).

---

## A. Journey matrix — one verdict row per surface

| Page | Initial | Empty | Error | Success | Keyboard | List model | URL state | Money/destructive |
|---|---|---|---|---|---|---|---|---|
| dashboard | skeleton ✓ (6→3 CLS = known A1-4) | honest chart-empty w/ pickers ✓ | chart banner+retry ✓, recent-orders triad ✓ | single-fire refresh ✓ | chips aria-pressed ✓ | n/a (tiles + 8-row stream) | chart days local | — |
| orders | TableSkeleton ✓ | partial-empty guard ✓ + clear CTA | full triad ✓ | bulk 207 parse + counts ✓ | `/`+Esc, menu ↑↓↵+Esc-focus-return ✓ | infinite load-more, «عرض N/إجمالاً» honest ✓ | `?status&days&search` ✓ | refund confirm w/ total LYD ✓; no per-row attribution (B15-4) |
| products | skeleton ✓ | capped-window hints ✓ | triad ✓ | per-item bulk failures ✓ (R126-L3) | Esc→cancelForm (leak = known F14) | infinite + 60s poll | `#new` only — search/category NOT in URL (B15-5) | archive one-way-door confirm ✓; bulk hide unconfirmed (reversible, OK) |
| topups | TopupCardSkeleton ✓ | per-tab server-verified ✓ (A1-10 fixed) | triad ✓ | per-item failure reasons ✓ + live done/total ✓ | Esc guarded vs in-flight ✓ | per-tab `?status=` infinite ✓ | `?status` ✓ | confirm states amount+user+ref ✓; reviewed_by attribution ✓ |
| users | skeleton ✓ | tier partial-empty ✓ | triad ✓ | success toast + co-invalidation ✓ | wallet chips aria-pressed ✓ | infinite + sort | `?tier&sort&filters&search` ✓ | points confirm w/ 100:1 LYD preview ✓ (R126-L3); dirty-guard on dialog ✓ |
| referrals | skeleton (hidden-until-data) ✓ | empty w/ escape for filters | triad ✓ (401 fixed R126-L3) | ✓ | status chips **no aria-pressed** (known A2#8) | raw fetch, 200-cap hint ✓ | search/status NOT in URL (known A1-23 + B15-5) | credit confirm ✓ but no LYD equivalent (B15-3) |
| tickets | TableSkeleton ✓ | category partial-empty ✓ (R126-L3) | triad ✓ | ✓ | chips aria-pressed ✓ | infinite, no poll (socket covers, B6 known) | `?status&category` ✓ | close/reopen one-tap (additive, OK); reply dirty-guard ✓ |
| whatsapp | page-shaped skeleton ✓ | honest empty + CTA copy | first-load FetchErrorCard ✓ (R126-L3) | toasts ✓ | aria-labels ✓ | plain list (ops page) | — | delete confirm w/ pairing-wipe consequence ✓; pairing panel no dismiss (B15-7) |
| alerts | page-shaped skeleton ✓ | per-filter honest ✓ | triad ✓ | optimistic + rollback ✓ (best-in-class) | aria-pressed chips ✓ | infinite + hasMore envelope ✓ | filter NOT in URL (B15-5) | 3 count-named destructive confirms ✓; no undo/type-to-confirm (B15-10) |
| security | page-shaped skeleton ✓ | honest empty | both queries error+retry ✓ | ✓ | labeled selects ✓ | ≤100 window, cap disclosed ✓ | filters NOT in URL (B15-5) | — |
| risk | TableSkeleton ✓ | honest empty + pipeline hint | triad ✓ | ✓ | aria-pressed ✓ | infinite cursor ✓ | filter NOT in URL (B15-5) | — |
| risk-event | **bare-text loader (known A3-6)** | n/a | **no retry (known A3-8)** | inline emerald line (known A3-5) | notes textarea placeholder-only (known) | detail page | — | label buttons one-tap (additive — fine) |
| settings shell + 3 modules | skeleton ✓ | providers error-card ✓ | retry ✓ | tab ARIA tablist/panel ✓ | `?tab=` ✓ | — | `?tab` ✓ | 2FA rotate re-auth gate ✓; password promise FIXED (e8088fd verified: account-tab.tsx:360); ProviderCard still no dirty guard (known A3-10) |
| login | n/a | n/a | inline `role=alert` Arabic (R126-L2 verified) | cookie-probe bootstrap ✓ | Enter double-fire guard ✓ | — | no `?next=` (known A3-15) | — |
| layout shell | — | — | badge pill error state ✓ | — | ⌘K palette trap+return ✓; drawer Esc/trap/return ✓; skip-link covers admin ✓ (App.tsx:785-800) | — | — | logout one-tap (session-only, fine) |
| profile/SessionManager | skeleton ✓ | **false-empty on failure (B15-2)** | **silent (B15-2)** | logout-all **silent failure (B15-2)** | confirm dialog a11y ✓ | plain list | — | destructive confirm w/ consequence ✓ |

**State-truth verdict:** the admin console's interaction-state discipline is now genuinely uniform — skeleton → honest error card with Arabic reason + retry → guarded empty → optimistic/invalidated success — on every page except the three known risk-event residuals and the one storefront SessionManager straggler (B15-2).

---

## B. Findings

### B15-1. [P2] The admin audit trail exists only server-side — the operator has NO console view of WHO did WHAT WHEN for money actions (topups cards are the sole exception)
**Evidence:** `audit_logs` carries the full story — `shared/db/src/schema/audit_logs.ts:12-20`: `actorId`, `actorType: "user" | "admin" | "system"`, `action`, `targetType/targetId`, `metadata`, `ip`, `createdAt` — and the backend writes it on every consequential admin action (orders-credentials reveals `admin-orders-credentials.test.ts:258`, copilot settings `routes/admin/copilot/settings.ts:157`, risk labels `routes/admin/risk.ts:422`, ticket reply/status (R126 `e0fd793`), alerts test-dispatch, inventory upload). But **no admin route reads it back** (rg `auditLogs|audit_logs` over `backend/src/routes`: writers + tests only, zero GET) and **no frontend page renders it** (rg over `frontend/src`: zero hits). The console's only attribution surfaces are topup cards — `topups.tsx:283` `{t.reviewed_by ? `أُقرّ بواسطة ${t.reviewed_by}` : "تمت المراجعة"}` — and risk labels — `risk-event.tsx:248` `{l.labeled_by_username ?? `admin#${l.labeled_by}`}`. Everything else is anonymous in the UI: the orders bulk-refund confirm says «سيتم استرداد المبالغ للمستخدمين» (orders.tsx:792) and the row that lands shows no who/when; a wallet adjustment's ledger row (`wallet_ledger.ts:20-33`) carries the note but **no actor column**; a ticket thread renders every admin reply behind one generic shield avatar — `tickets.tsx:742` `const isAdmin = r.author_type === "admin";` + `:749-755` (schema `ticket_replies.ts:11` stores `authorType` only).
**Why it matters (the mandate's human-factors question):** with ≥2 admins the operator cannot answer "who approved/rejected/overwrote/refunded this?" without DB access — the accountability data is captured and then hidden from the only people it exists for. `security.tsx` (the natural home) currently reads **user auth activity only** (`/api/admin/auth-stats/summary` + `/api/admin/auth-activity`).
**Fix directive (M):** `GET /api/admin/audit-logs?action=&actor=&target=&limit=` (admins scope, capped + cursor, reusing the risk-events route shape) + a «إجراءات المسؤولين» tab/section on security.tsx riding the existing timeline/CSV idioms (actionLabel-style Arabic action map). Optional deeper pass: actor stamps on wallet_ledger adjustments + ticket replies (schema work, separate lane). **Confidence: 5.**

### B15-2. [P2] SessionManager (/profile) renders a false «لا توجد جلسات نشطة» during an outage and silently swallows logout-all failures
**Evidence:** `components/SessionManager.tsx:45-49`:
```ts
const response = await fetch("/api/auth/sessions", { headers: { Authorization: `Bearer ${token}` } });
const data = await response.json().catch(() => ({}));
if (!cancelled) setSessions(data.sessions ?? []);
```
no `r.ok` check — a 401/500/502 envelope parses to `{}` → `sessions=[]` → `:103-104` renders `«لا توجد جلسات نشطة لعرضها.»` — the exact B5-04 false-empty class the admin console systematically killed. And `:82-84`:
```ts
if (response.ok) { window.location.href = "/login"; }
```
a FAILED logout-all is a silent no-op: the button clicks, nothing happens, the user still believes all devices were revoked (the file's own header admits «Failures are silent in the UI — Sentry's network instrumentation captures the actual error» — Sentry is not an operator affordance).
**Fix (S):** ok-guard the sessions fetch → honest inline error line (keep the card); on logout-all failure toast the destructive Arabic line (the console's `getErrorMessage` idiom); keep the confirm dialog as-is. **Confidence: 5.**

### B15-3. [P3] The points→LYD (100:1) confirm preview landed for users wallet edits but NOT for the other points-minting action — referrals credit
**Evidence:** the pattern the mandate asks to be universal exists at `users.tsx:606`: `سيتم تحديد نقاط ولاء … — القيمة بالدينار عند التحويل: ${formatCurrency(nextPoints / 100)} (كل 100 نقطة = 1 د.ل).` The referral credit — the same LYD-convertible points mint — confirms with points only, `referrals.tsx:374-378`:
```ts
description: `سيتم قيد ${row.points_earned} نقطة ولاء للمُحيل ${row.referrer_phone} (إحالة ${row.referee_phone}).`,
```
An operator approving commissions never sees the dinar liability they are creating (e.g. 50 referrals × 50 points = 25.00 د.ل outstanding) while the adjacent surface shows it. **Fix (S):** append the same `formatCurrency(points/100)` sentence. **Confidence: 5.**

### B15-4. [P3] Ticket threads show a generic admin identity — which admin replied is invisible (the attribution pattern topups/risk already ship is absent here)
**Evidence:** `tickets.tsx:742-755` — every admin reply renders one shield avatar; `ticket_replies.ts:11` `authorType: varchar("author_type", { length: 10 }).notNull().default("user")` — no admin id/username column. Contrast the two in-repo precedents: `topups.tsx:280-286` (reviewed_by + reviewed_at on the card) and `risk-event.tsx:243-253` (`labeled_by_username` + `labeled_at` per label). Multi-admin support queues cannot attribute words to people; escalation/dispute review has to fall back to the (now unwritable-from-UI, B15-1) audit log. **Fix (M):** add `adminId` (+ join username in the detail projection) to ticket_replies, render `بواسطة @username` on admin bubbles. **Confidence: 4** (single-operator today softens the blast radius; the schema gap is certain).

### B15-5. [P3] Filter-state-in-URL stops at the five big lists — risk, alerts, products-search and referrals filters die on refresh
**Evidence:** the shareable/refreshable filter contract exists on orders (`orders.tsx:932-938` `syncFilterParams`), topups (`topups.tsx:1373-1376`), users (`users.tsx:414-424`), tickets (`tickets.tsx:286-292`), settings (`?tab=`). It is absent on: risk level chips (`risk.tsx:297-299` — `onClick={() => setFilter(f.value)}`, no URL write; the events drill-in IS deep-linkable, so a shared «critical events» link must re-pick the chip by hand), alerts filter (`alerts.tsx:222` local `useState<FilterType>` — an operator filtering «نفاد مخزون» loses it on every deploy-refresh; admin tabs live for days per the console's own design comments), products search/category (only the `#new` hash is URL-aware, products.tsx:565), referrals search/status (known A1-23 half). **Fix (S):** copy the `syncFilterParams` idiom per page (`?level=`, `?filter=`, `?search=&category=`). **Confidence: 4.**

### B15-6. [P3] The `/` search-focus shortcut exists only on orders — four other searchable pages ignore it
**Evidence:** `orders.tsx:894` `if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(...))` focuses `#orders-search`. topups (`topups.tsx:617` — its `useKeyboardShortcuts` mounts Escape only), users, products, referrals, coupons ship search boxes with no `/` handler (rg over `pages/`: the orders hit is the only one). The console's own shortcut vocabulary (⌘K global, `/` search, Esc close, ⌘↵ submit) is otherwise consistent — this is the one place it silently doesn't apply, and an operator who learned `/` on orders will type it everywhere. **Fix (S):** extract the shortcut into `useKeyboardShortcuts` (it already exists as the shared hook) with a `searchRef`/id param; wire the five pages. **Confidence: 5.**

### B15-7. [P3] The WhatsApp pairing surface has no dismiss path — the inline form + QR block lock open until another action moves them
**Evidence:** once «ربط برمز الهاتف» is tapped, `pairTarget` pins the inline form to that session (`whatsapp.tsx:557`); the only way to collapse it is tapping ربط/QR on a *different* session (`:620-632` renders the open-button only for `pairTarget !== session.id`) or deleting the session. The fetched QR block likewise persists with no ✕ (`:635-646` — `qrImage` survives until another action). On a 390px phone the 256px QR panel + phone form own the screen with no escape, mid-investigation of another session. **Fix (S):** an icon-button (aria-label «إغلاق الربط») on the form header that clears `pairTarget`/`qrImage`. **Confidence: 4.**

### B15-8. [P3] formatCount stragglers — five newly-enumerated raw-count sites beyond the documented R125/R126 batch
**Evidence (all bare counts, no `formatCount`, while sibling lines on the same surfaces use it):** `orders.tsx:1443` `{filtered.length} نتيجة`; `orders.tsx:1122` `{couponOrders.length} طلب بكوبون · خصم {formatCurrency(totalDiscounts)}`; `layout.tsx:680` `{u.order_count} طلب` (GlobalSearch user row); `layout.tsx:728` `{p.stock_count} وحدة` (GlobalSearch product row); `dashboard.tsx:737` `{stats!.pending_topups} طلب شحن بانتظار المراجعة` (the urgent banner — the money-queue number). «2 نتيجة/طلب/وحدة» should read «نتيجتان/طلبان/وحدتان». This extends the held-open count batch (R125-A1 #11 + R126-A1-6/13/24) with sites none of those lists enumerated. **Fix (S):** one mechanical commit; the forms objects already exist in-file (`ORDER_COUNT_FORMS`) or are one-liners. **Confidence: 5.**

### B15-9. [P4] Bulk live-progress is a topups-only luxury — products' sequential bulk loop runs blind
**Evidence:** topups' BulkConfirmModal carries a live `جاري done/total` counter + `role="status"` announce (`topups.tsx:513-514`, `:556-562`). products' bulk archive/hide loops N sequential DELETE/PATCH calls with only the triggering button's label swap — `products.tsx:1097` `{bulkProcessing ? "جارٍ…" : "أرشفة"}` — no per-item progress, no cancel. Per-item failure visibility IS landed there (R126-L3, verified `products.tsx:913-953`); this is only the progress affordance. **Fix (S/M):** lift the BulkConfirmModal progress pattern or a simple `جاري X/Y` status line on the bulk bar. **Confidence: 5.**

### B15-10. [P4] No type-to-confirm anywhere; delete-all-alerts is the only console-wide "catastrophic" candidate
**Evidence:** every destructive action rides the count-named `useConfirm` dialog (full list §E) — good. The single action whose blast radius is unbounded (wipes the ENTIRE alert inbox, read+unread — `alerts.tsx:410-420` `سيتم حذف ${formatCount(count, ALERT_COUNT_FORMS)} نهائياً — المقروءة وغير المقروءة`) confirms with one tap on «حذف الكل». No undo exists console-wide (all confirms disclose «لا يمكن التراجع»). **Directive (S, optional):** for delete-all-alerts only, require typing the count (the type-to-confirm idiom) or ship a 10s undo toast riding the optimistic cache already present. **Confidence: 3** (judgment call — 1-3 operators, bounded blast radius).

### B15-11. [P4] Icon-button naming micro-batch: theme toggle carries two different accessible names; the top-bar refresh rides title-only
**Evidence:** `layout.tsx:1396-1399` — `title={theme === "dark" ? "وضع نهاري" : "وضع ليلي"}` while `aria-label={theme === "dark" ? "تبديل المظهر (داكن/فاتح)" : "تبديل المظهر (فاتح/داكن)"}` (AT reads the aria-label, tooltip shows the title — two names for one control); `layout.tsx:1405-1413` — the onRefresh button names itself with `title="تحديث البيانات"` only, while every sibling icon button (theme :1397, hamburger :1296, search :1330) uses `aria-label`. **Fix (S):** align the two strings; add `aria-label` to the refresh button. **Confidence: 5.**

---

## C. Cross-page coherence verdicts (mandate dimension 7)

| Dimension | Verdict | Evidence |
|---|---|---|
| **One status, one word** | **PASS** | `statusLabel` (utils.ts:165-192) feeds tabs + badges + bulk menus on orders/topups/tickets/users/whatsapp; the R124-C2 «معلق»-family sweep held everywhere I walked. Remaining drift is per-field, not per-status: topups «رمز/مرجع/رقم التحويل» (known A1-12 — verified still divergent at topups.tsx:255 vs :891 vs :1259). |
| **تنبيه vs إشعار** | **PASS (bounded)** | «التنبيهات» = the system-alerts inbox (nav layout.tsx:93, alerts.tsx, system.tsx); «إشعارات» = Telegram notifications (settings.tsx:378, 589-596) — a real concept split, consistently applied. One cosmetic seam: the layout toast labels type=system alerts «إشعار النظام» (layout.tsx:1042) while the inbox filter says «نظام» (alerts.tsx:130) — both describe the same row type. P4-level; fold into any copy pass. |
| **Status tokens** | **PASS on the swept pages** | `--status-*`/StatusBadge rides orders/topups/users/tickets/whatsapp/risk/alerts/dashboard. Raw-hue survivors are the documented tail (users stat strip, tickets close/reopen, products stock, promotions pills, referrals status chips, settings residuals — all in §G). |
| **Date/time** | **PASS, with one deliberate seam** | `formatDate` (absolute, ar-LY-u-nu-latn) on detail rows; `formatRelativeTime` on queue lists; dashboard chart ticks pin `timeZone:"UTC"` over backend calendar-date keys (dashboard.tsx:256-264) while bucketing is server-anchored on Tripoli today — correct. **Nothing pins Africa/Tripoli client-side**: all wall-clock rendering rides the browser zone (self-consistent; a non-Libya-zone operator sees uniformly shifted times — acceptable today, worth one line in docs if remote admins appear). |
| **Number format** | **PASS** | `formatCurrency` (en-US grouping + د.ل) is the single money formatter on every page I walked, incl. confirms and toasts; counts increasingly ride `formatCount` (stragglers = B15-8); CSV shape splits remain known (A1-8). |
| **Iconography** | **PASS** | lucide vocabulary consistent (Search/RefreshCw/Clock/Wallet/Shield…); Send icon manually mirrored for RTL (tickets.tsx:808); ArrowUpLeft = "go-to" per the unified direction decision (dashboard.tsx:782). |
| **List model** | **PASS** | every long list is the accumulating infinite query + LoadMoreButton + honest «عرض N/إجمالاً» + partial-empty guards; cursor pages (alerts/risk/enrichment) honor their envelopes; no pagination UI anywhere (right call). |

---

## D. Verified-good (no finding)

- **Confirm-consequence coverage is COMPLETE**: every money/destructive action I could fire names its consequence in the dialog — topups approve (amount+user+ref, topups.tsx:891), orders bulk refund (count + **total LYD**, orders.tsx:792), users wallet/points (mode-aware preview + negative-balance warning + points→LYD, users.tsx:606-632), referrals credit, coupons archive (one-way-door), promotions delete, products archive (permanence disclosure), enrichment publish (names the live field it overwrites), whatsapp delete (pairing-wipe), admins disable (**session-revocation consequence**, admins.tsx:158), alerts ×3 (count-named), pricing recompute. The idempotency discipline (per-click / per-intent / per-iteration keys) held at every site re-walked.
- **useConfirm/no-native-confirm gate**: 14 consumers; `no-native-confirm.test.ts:20-43` owns 22 files and was correctly widened for the R126-L9 settings split (all three new module paths present). Focus return (A4-F3) intact in the hook (use-confirm.tsx:86-90, :115-118).
- **R96 keyboard heritage not regressed by R126 edits**: focus-trap helper shared by palette + drawer (layout.tsx:308-330); ⌘K scope-gated; drawer focus in/out (layout.tsx:1015-1021); orders bulk-menu ARIA menu + Esc focus-return (orders.tsx:1300-1319); skip-to-content now covers admin (App.tsx:785-800, R125 fix verified held); `#main-content` route-focus contract pinned.
- **Dirty guards**: 9 surfaces guarded (admins ×2, account-tab, coupons, products editor, pricing, tickets reply, users dialog, promotions); SPA-route-leave interception remains the documented deferred gap (use-dirty-guard.ts:15-20) — correctly disclosed, not silently claimed.
- **R126 landed fixes re-verified HELD at f53a886**: topups `?status=` per-tab query + server-verified tab empties (topups.tsx:660-696, :1483-1519); points confirm w/ LYD preview (users.tsx:601-639); tickets category partial-empty (tickets.tsx:393, :514-544); whatsapp first-load FetchErrorCard (whatsapp.tsx:472-487); referrals 401 redirect (referrals.tsx:284); bulk getErrorMessage sweep (products.tsx:937-949, topups.tsx:994-1010); password-change session-revocation truth (account-tab.tsx:355-360); login Arabic error mapping (login.tsx:94-104); orders select-all membership (orders.tsx:1009-1020).
- **Offline/stale**: per-query fallback polls (300s) + socket invalidation + the layout badge pill's honest gray/amber/green states (layout.tsx:1351-1386) — the only global freshness signal; list staleness during outage is surfaced per-page (stale-keep banners everywhere).

---

## E. Destructive-action inventory (useConfirm gate — complete list walked)

| Action | Page | Confirm | Consequence copy | Destructive style |
|---|---|---|---|---|
| topup approve (money-create) | topups | ✓ | amount+user+ref | — |
| topup reject (bulk/single) | topups | ✓ modal | amount+user | destructive |
| approve-all / bulk approve | topups | ✓ modal | count + note | — |
| orders bulk refund | orders | ✓ | count + total LYD | destructive |
| orders bulk status change | orders | ✓ | count | — |
| users wallet/points save | users | ✓ | preview + LYD equiv | conditional |
| referrals credit | referrals | ✓ | points (see B15-3) | — |
| coupon archive / delete | coupons | ✓ | permanent-hide copy | destructive |
| promotion delete | promotions | ✓ | «حذف نهائي» | destructive |
| product archive (single/bulk) | products | ✓ | one-way-door + restore-needs-DB | destructive |
| enrichment publish (overwrites live) | enrichment | ✓ | names field + product | — |
| enrichment reject (reason) | enrichment | ✓ dialog | reason required | — |
| whatsapp session delete | whatsapp | ✓ | pairing-wipe | destructive |
| admin disable/enable | admins | ✓ | session-kill on disable | conditional |
| alert delete / delete-read / delete-all | alerts | ✓ ×3 | count + no-undo | destructive |
| pricing recompute (catalog-wide) | pricing | ✓ | scope disclosure | — |
| logout-all-devices (profile) | SessionManager | ✓ | re-login consequence | destructive |

Zero native `window.confirm/prompt/alert` on any walked surface (guard test owns the files).

---

## F. Fix order (operator-value ranked)

1. **B15-2 (P2, S)** — SessionManager honesty: the only remaining false-empty + silent-failure pair in the walked set.
2. **B15-1 (P2, M)** — audit-log reader (security.tsx tab): the accountability answer for every money action; data + indexes already exist.
3. **B15-3 (P3, S)** — one sentence on the referrals credit confirm.
4. **B15-6 + B15-5 (P3, S/M)** — one "console consistency" commit: `/` shortcut on the five search pages + URL mirrors on risk/alerts/products-search.
5. **B15-7 (P3, S)** + **B15-11 (P4, S)** — whatsapp dismiss affordance + icon-naming micro-batch.
6. **B15-8 (P3, S)** — fold the five new count sites into the standing formatCount batch.
7. **B15-4 (P3, M)** — ticket reply attribution (schema + projection + render; pairs naturally with B15-1's lane).
8. **B15-9 / B15-10 (P4)** — bulk progress lift; delete-all type-to-confirm (optional, judgment).

---

## G. Known-items pointer table — held-open, re-verified at f53a886 (NOT re-reported)

| Known item | Owner | Status @ f53a886 |
|---|---|---|
| products select-all size-vs-membership | R127-B2 §A | OPEN (products.tsx:867-870) |
| topups «موافقة الكل» loaded-window over-promise | R126-A1-11 | OPEN (approveAll over allTopups, topups.tsx:1058-1061) |
| topups tab-empty no «عرض الكل» CTA | R126-A1-15 | OPEN (topups.tsx:1499-1504) |
| topups رمز/مرجع/رقم التحويل drift | R126-A1-12 | OPEN (:255 vs :891 vs :1259) |
| BulkConfirmModal bare `${count} طلب سيتم معالجته` | R126-A1-13 | OPEN (topups.tsx:491) |
| dashboard «آخر {chartDays} يوم»/collapsible branches/raw counts/emerald-400 cluster/6-block skeleton | R126-A1-2/4 | OPEN (dashboard.tsx:595-596, :617, :653-655) |
| orders «30 يوم»/identical-ternary/coupon emerald cluster/CSV shape/clear-filters triplication | R126-A1-6/7/8/9 | OPEN |
| referrals no ✕ clear / status chips no aria-pressed / raw-hue pills | R126-A1-23, A2#8 | OPEN (referrals.tsx:554-559, :562-569) |
| coupons no search / stat raw hues / footer counts | R126-A1-20/21/22 | OPEN |
| pricing picker error + configDirty snapshot | R126-A1-17/19 | OPEN |
| whatsapp QR staleness + transitional-status no-poll | R126-A2-6/7 | OPEN (qrImage no TTL cue, whatsapp.tsx:635-646) |
| products Esc-discards-dirty-editor + `#new` reset; enrichment no success-toast/no dirty-guard/one-confirm-per-card; promotions F12 refresh-blank + F21 busy guards | R126-A2 §C (F12/F14/F15/F19/F21) | OPEN (products.tsx:750; enrichment.tsx:248-263) |
| products dead bulk lookup (skips counted as successes) | R126-A2-9 | OPEN (products.tsx:969-970) |
| risk-event bare loader / no retry / no RBAC card / inline success / placeholder-only notes | R126-A3-5/6/7/8 | OPEN (risk-event.tsx:131-154, :265-271, :304) |
| system jobs slice(0,8) + English status tokens; risk chip loaded-window counters; alerts 20s poll comment; login no `?next=`; login back-focus | R126-A3-12/13/14/15/16 | OPEN |
| settings ProviderCard no dirty guard / dead error state / min(1) validation / cleared-field 400 copy | R126-A3-9/10/11 | OPEN (provider-card.tsx — verified no useDirtyGuard post-split) |
| raw-hue tails (users stat strip, tickets close/reopen, products stock, promotions pills, settings/admins 13 sites, system/alerts TYPE_META) | R125-A6 B-4 + R126 sweeps | OPEN (documented enumerations) |
| socket staleness: tickets/risk park-resync, wallet/order-detail blip recovery, admin connectivity signal, setAdminToken disconnect | R127-B6 | OPEN (B15 did not re-walk) |
| charts/coupons/pricing/referrals socket-push absence | R126-A1-1/26 | OPEN |
| orders/topups/… formatCount standing batch | R125-A1 #11 + R126-A1 | OPEN — extended by B15-8 |

**Counts: P0 0 · P1 0 · P2 2 (B15-1, B15-2) · P3 6 (B15-3..8) · P4 3 (B15-9..11).**

**Verdict: SHIP-WORTHY.** The console's journey layer — states, keyboard, confirms, honesty guards — is the most consistent surface I have walked in this repo; the two P2s are an accountability readout (data exists, no reader) and a storefront straggler, neither blocking deploy.
