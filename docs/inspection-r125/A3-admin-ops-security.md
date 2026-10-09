# R125-A3 — Admin Ops / Support / Security / System Pages Deep Audit

**Scope:** `frontend/src/pages/admin/{tickets, alerts, security, settings, admins, whatsapp, risk, risk-event, system}.tsx` (8,078 lines total) + the `__tests__` files that pin them + the shared components they ride (`FetchErrorCard`, `LoadMoreButton`, `EmptyState`, `TableSkeleton`, `StatusBadge`/`statusLabel`, `use-confirm`, `use-toast`, `use-dirty-guard`, `admin-session`, `AdminLayout` nav/badges) + the backing admin routes read for contract verification (`backend/src/routes/admin/{security,auth,tickets,admins}.ts`). `login.tsx` is A1's; alerts/risk/risk-event/system get their **first full audit** here (R124-A6 only cited alerts; risk/risk-event/system were never audited).

**Method:** full line-by-line read of all 9 pages at `main @ 09857fc` (clean tree), state-machine walkthrough per page (first-load / error / stale-refresh / empty / boundary), backend route reads to verify truncation + 2FA-gate contracts, quantified greps for every divergence claim (counts cited inline), typo claims verified at byte level (one withdrawn — see §B note under #9). Static analysis only; production NOT touched; no builds/tests run; nothing committed. Rubrics: impeccable `audit.md` + `craft-floor.md` + `clarify.md`; predecessor `docs/inspection-r124/A6-admin.md`.

---

## A. Verified HELD from R124 (on my pages) — the baseline is still strong

| R124 fix | Verdict | Evidence @ 09857fc |
|---|---|---|
| Success-toast variants (A6 F1) | **HELD** — every action-success toast on my set is green | tickets.tsx:329, settings.tsx:590/651, admins.tsx:151/384/538, whatsapp.tsx:134/154-158/186-190/245 |
| statusLabel-derived filter labels (A6 F2) | **HELD** | tickets.tsx:63-66 (`STATUS_FILTERS` maps `TICKET_STATUSES` through `statusLabel`); row badges 508-515/564-571 share the map |
| Settings tab-bar ARIA (A6 F10, R124-I5) | **HELD** — `role="tablist"` + `role="tab"` + `aria-selected` + tabpanels with `aria-labelledby` | settings.tsx:1052-1071, 1085, 1092, 1177, 1383-1385, 1420 |
| Chip-bar `aria-pressed` (A6 F10, R124-C2) | **HELD on tickets** (status tabs + category chips) | tickets.tsx:389, 410. Residual: alerts + risk have **zero** `aria-pressed` (finding 6) |
| EmptyState adoption (A6 F13, R124-I5) | **HELD** — admins' bare-text line is now the shared card | admins.tsx:196-201, security.tsx:331, whatsapp.tsx:366. Residual: tickets hand-rolls 2 (finding 4/9 family) |
| Shared list-state extraction (A6 F6, R124-I8) | **HELD** — `FetchErrorCard`/`LoadMoreButton` ride on my set | tickets.tsx:456/536, alerts.tsx:583/735, admins.tsx:189, system.tsx error card 1065-1082 |
| Nav IA: group rename + title drift (A6 F16, R124-I5) | **HELD — fully fixed** | layout.tsx:104 «الكتالوج والعملاء»; PAGE_TITLES now **derived** from NAV_SECTIONS (layout.tsx:226-228) so drift is impossible by construction |
| Error ≠ empty contract | **HELD on 8 of 9 pages** (pinned by tests) | tickets 445-462, alerts 560-589, security 211-229/311-329, settings 1124-1138/1205-1226, admins 186-195, whatsapp 312-317, system 963-969/1065-1082. **Broken on risk.tsx — finding 2** |
| Honest counts | **HELD** | tickets.tsx:221/372-374 («إجمالاً» only on a provable single short page + Arabic plurals 83-90), alerts.tsx:715-727 («عرض N من M · K غير مقروء» with server `total`) |
| Confirm-pattern uniformity | **HELD** (one outlier) | alerts single-delete 366-376 + deleteRead 384-393 via `useConfirm`; whatsapp 225-231; admins toggle 131-141 (names the session-termination consequence). Outlier: alerts `deleteAll` inline نعم/لا — finding 6 |
| RBAC honesty | **HELD** | settings.tsx:93-95/1077-1081 (auth/integrations tabs hidden for scope-less admins + honest-reason fallback). Residual on risk/system deep-links — finding 11 |
| Dirty guards | **HELD** | tickets reply draft 140, settings account tab 609-623, admins dialogs 349-354/505-510 |
| Last-admin protection (deepened) | **HELD — backend-guarded on both axes**, UI surfaces the Arabic reason via toast | backend admins.ts:305 (can't strip admins-scope from last holder), :376 (can't deactivate last account-manager); UI additionally hides self-actions (`isMe`, admins.tsx:248) |
| System-page polling hygiene | **HELD** — every cadence carries an inline rationale comment | system.tsx:448-450/460/471-472/488-489/515-517/526-528; all `refetchIntervalInBackground: false`; `enabled: !!adminToken` everywhere |

Known-open items from the brief, verified: **(1)** security.tsx:189-192 bare «جارٍ التحميل…» + admins.tsx:181-185 spinner row + whatsapp.tsx:361-364 spinner — **all still open** (finding 4). **(2)** security timeline unpaged/unbounded — **still open, deepened with backend evidence** (finding 5). **(3)** admins bare empty state — **FIXED**; tickets' two hand-rolled empties — **still open** (folded into 4/9). **(4)** settings tab ARIA — **FIXED**; tickets/users chips — **FIXED**; alerts/risk residual in finding 6. **(5)** Nav IA — **FIXED** (both group label and title derivation). **(6)** alerts 20s vs badge 300s — **partially explained** by the socket push (SocketInitializer.tsx:90-91 invalidates both keys on `ADMIN_ALERT_NEW_EVENT`); residual = socket-dropout divergence + zero freshness on tickets (finding 7).

---

## B. Findings

### 1. [P2] 2FA re-enrollment is a guaranteed dead end for already-enrolled admins
**Location:** `frontend/src/pages/admin/settings.tsx:380-403, 435-513, 1433` vs `backend/src/routes/admin/auth.ts:824-836`
**Why:** The backend (93-A1 S5 gate) requires `current_password` on `POST /api/admin/2fa/setup` whenever TOTP is already enabled — rotating an enabled secret **disables 2FA** until re-verified (auth.ts:888), so re-setup is treated like a disable. The frontend `TwoFactorSetup.startSetup` sends **no body at all** (settings.tsx:387-390) and the component has no password input — the backend comment at auth.ts:861 even acknowledges "the admin UI sends no body". Consequence: an admin with 2FA on sees the same «إعداد المصادقة الثنائية» CTA as a fresh admin (the component is mounted unconditionally at 1433, never told `session.totp_enabled`), clicks it, and gets a guaranteed 400 («كلمة المرور الحالية مطلوبة لإعادة إعداد المصادقة الثنائية») with no path forward — no rotate, no disable, no password field. The security-management surface is unmanageable after first enrollment.
**Fix sketch:** pass `totp_enabled` into `TwoFactorSetup`; when enabled, render a status line («مفعّلة») + a rotate flow with a current-password field (honoring the S5 gate + its lockout), keeping the success state honest. Effort **M**.

### 2. [P2] risk.tsx renders the error banner AND the false empty state simultaneously — the B5-04 contract is broken on a fraud queue
**Location:** `frontend/src/pages/admin/risk.tsx:262-273`
**Why:** `{query.isError && (…فشل تحميل الأحداث…)}` at 262 is followed by `{!query.isLoading && events.length === 0 && <EmptyState …/>}` at 267 — on a failed load, `events` is `[]` and `isLoading` is false, so the EmptyState («لا توجد أحداث في النطاق المحدد» + a hint implying you should enable `RISK_PIPELINE_ENABLED`) renders **below** the error banner. An operator skimming past the banner reads "no fraud events" during an outage — exactly the false-empty class every other list page killed (and the one risk.tsx, first-audited here, was never brought into). The error banner also has no retry action (only the header refresh button).
**Fix sketch:** gate the empty state on `!query.isError` (the tickets.tsx:445-463 chain is the recipe), add an inline retry to the banner. Effort **S**.

### 3. [P2] tickets: the unread signal is computed, shipped, and never rendered
**Location:** `frontend/src/pages/admin/tickets.tsx:108` (interface) vs `backend/src/routes/admin/tickets.ts:145`
**Why:** The backend computes `has_unread_admin` (last reply came from the **user** — a customer reply awaiting response) on every row; the frontend declares it in `TicketSummary` and renders it **nowhere** (grep: interface + test fixture only). The queue's only unread-ish cue is a pulse dot on `status === "open"` (tickets.tsx:482-484), which misses every `in_progress` ticket with a fresh customer reply — the exact tickets that need a response (SLA/response-time visibility: the queue otherwise offers only relative time, no aging or awaiting-response signal, and no polling/socket push at all — see 7).
**Fix sketch:** render a dot/badge on rows with `has_unread_admin` (and optionally an «بانتظار ردك» count chip next to the existing «نشطة» chip at 360-364). Effort **S**.

### 4. [P3] Loading-state taxonomy residuals — four surfaces, plus whatsapp re-blanks its list after every action
**Location:** security.tsx:189-192, admins.tsx:181-185, whatsapp.tsx:361-364 + 103-118, risk-event.tsx:113-118
**Why:** (a) security's bare centered «جارٍ التحميل…» (has `role="status"`, at least) also **hides the entire page including the header and CSV button** during first load — the only list surface left with no skeleton and no layout preservation. (b) admins is a spinner+text row. (c) whatsapp shows a bare centered spinner — and because every mutation handler ends with `await loadSessions()` (135, 159, 191, 246) and `loadSessions` unconditionally sets `loading=true` (104), **every create/start/pair/delete collapses the whole session list into a spinner**, losing scroll position and context mid-task; the refresh affordance already exists (header button spins at 357). (d) risk-event is bare text. All 13 other list pages use `TableSkeleton` or page-shaped shimmer cards.
**Fix sketch:** page-shaped skeletons (the alerts.tsx:577-581 card recipe fits whatsapp/security; `TableSkeleton` fits admins); whatsapp should keep prior rows visible during a refresh (only first load shows the spinner). Effort **S**.

### 5. [P3] security timeline: silent 100-row truncation with no honest count, no race guard — and the CSV exports the same truncated window
**Location:** frontend security.tsx:108-136, 306-366, 138-177; backend `admin/security.ts:60-67`
**Why (deepened from A6#17):** the backend hard-caps `auth-activity` at `.limit(100)` with no `page` param and no `total` (security.ts:65); the UI renders whatever arrives under a bare «سجل النشاط» heading (307) with no «عرض N», no cap hint, no load-more — an audit log presented as complete. The CSV export (138-177) exports the same ≤100-row window under a `auth-activity-DATE.csv` name with no disclosure. Additionally: `fetchActivities` has **no abort/sequence token** — rapid filter flips can land a stale response last and render filter A's data under filter B's selects (the class fixed in GlobalSearch/layout and referrals); and the backend's `startDate`/`endDate` filters (security.ts:50-55) are never exposed in the UI.
**Fix sketch:** «عرض أحدث 100 حدث» disclosure header (risk.tsx:279-284 wording), a seq-token or AbortController on filter changes, a `partial export` note in the CSV, and optionally surface the date-range filter the API already supports. Effort **S/M**.

### 6. [P3] alerts: last two chip bars without toggle semantics; incomplete type filters; deleteAll is the page's only non-dialog destructive confirm with Yes/No buttons
**Location:** alerts.tsx:519-553 (filter tabs), 483-516 (stats chips), 450-478 (deleteAll), 95/151-158
**Why:** (a) The filter tabs and stats-row chips carry no `aria-pressed`/`aria-selected` — after R124-C2 fixed orders/topups/users/tickets/products, alerts (+ risk, finding 10's page) are the last chip bars where the active state is purely visual. (b) `TYPE_META` renders six alert types, but `FILTERS` (95) and the stats row only cover four — `system` and `forecast_stockout` rows (79-92) cannot be filtered. (c) `deleteAll` uses an inline «تأكيد حذف الكل؟ نعم / لا» block — the only destructive action on the page not riding the shared `useConfirm` dialog its two siblings use, and bare نعم/لا button names are the exact anti-pattern the clarify rule names ("name the action on the message and button"). (d) Minor: tab counters mix semantics — the «غير مقروء» chip shows the server-wide `unreadCount` (527, 358) while «الكل» shows the loaded-window length, so the numbers don't reconcile without load-more.
**Fix sketch:** `aria-pressed` on both bars; add the two missing type filters (or a deliberate comment); migrate deleteAll to `useConfirm` with a destructive confirm naming the count. Effort **S**.

### 7. [P3] Freshness policy: alerts 20s vs badge 300s fallback divergence stands; tickets has NO freshness mechanism at all
**Location:** alerts.tsx:228 (20s, no rationale comment), layout.tsx:723 (300s badge fallback), SocketInitializer.tsx:90-91; tickets.tsx (no `refetchInterval`, no socket invalidation)
**Why:** With the socket healthy, `ADMIN_ALERT_NEW_EVENT` invalidates both the inbox and the unread-count badge simultaneously — so A6#7's "badge lags inbox" is now true **only on socket dropout**, where the inbox recovers in ≤20s but the badge can sit stale up to 5 minutes (and during that window the two surfaces visibly disagree). The 20s number itself carries no inline rationale (system.tsx documents every cadence; alerts doesn't). Meanwhile the support queue — the one surface where a human is waiting — polls never and receives no socket push: an admin with the page open sees new tickets only on manual refresh.
**Fix sketch:** one "list contracts" table in the admin docs (or align the badge fallback to 60s); consider a socket event → tickets query invalidation (the socket already exists; this is an invalidation, not new infra). Effort **S** (doc) / **M** (tickets push).

### 8. [P3] Status-token discipline drift is concentrated on this set — and 3 of 6 alert types are near-identical yellows
**Location:** alerts.tsx TYPE_META 51-71 (19 raw-hue sites; `coupon_maxed`=amber, `coupon_expiring`=orange, `low_stock`=yellow — three visually indistinguishable hues for semantically different types), system.tsx (84 raw-hue sites: STATUS_META 157-182 + every MetricCard), settings.tsx:427-430/1261, tickets.tsx:584/597/670, risk.tsx DashCard 408-416, risk-event.tsx:286, admins.tsx:260-261
**Why:** `status-badge.tsx` enforces the `--status-*` tokens console-wide, and whatsapp/security/risk-list already migrated (comments attest) — but the pages in this set still hand-roll raw Tailwind hues for status-bearing surfaces, so a future theme/contrast pass must chase ~120 sites. The three-yellow collision on alerts is a genuine legibility failure (the label chip is the only reliable differentiator).
**Fix sketch:** map semantically-equal surfaces onto `--status-*` tokens; give the three yellow alert types distinct hues (or collapse to two). Biggest bang on alerts + system. Effort **M**.

### 9. [P3] Copy/diacritic/label batch (9 one-liners)
**Location & evidence:**
- «تعذر» (no shadda) vs the A2-F21 standard «تعذّر»: **whatsapp.tsx ×6** (114, 138, 162, 194, 218, 249) — inconsistent with its own «تعذّر نسخ الرمز» at 263 — plus **admins.tsx:656**.
- settings 2FA verify input (468-481) has **no programmatic label** — placeholder «000000» only; the r103 label pass covered the account forms but missed this one (h3 «2. أدخل رمز التحقق» is not associated).
- settings identity card renders the raw English role token (`session.role` is a free varchar defaulting `"admin"`, schema admin_users.ts:9) uppercased in an Arabic card — settings.tsx:696-698; no Arabic role mapping exists anywhere (the admins page shows permission chips instead).
- «N طريقة مفعّلة» (settings.tsx:1108) has no plural handling — `formatCount` exists and is used two pages over; count=2 renders «2 طريقة» instead of «طريقتان».
- admins ScopeCheckboxGrid scopes-load failure (admins.tsx:652-659): bare inline «تعذر تحميل قائمة الصلاحيات» inside the create/edit dialog — **no retry**, a dead end for granting any scope (the header FetchErrorCard is outside the dialog).
- risk-event mutation feedback uses an inline emerald line «تم حفظ التصنيف.» (286) instead of the console toast idiom every sibling page uses.
- system diag error copy asserts a cause it can't know («يتطلب صلاحيات إدارية», system.tsx:967) — could equally be network.
- AccountTab's null-session state is a bare text line (settings.tsx:674-681) while every sibling failure uses the error-card idiom.
- tickets empty state doesn't distinguish filter-no-results from a genuinely empty queue — with a category filter active it still says «ستظهر تذاكر الدعم هنا» (tickets.tsx:463-468) and offers no «مسح الفلاتر» CTA (orders/users have one). *(Withdrawn during verification: the suspected «تحديث»/«يعمل» typos in system.tsx:685/703/723 — byte-level check showed both are correctly spelled.)*
**Fix sketch:** one mechanical copy commit. Effort **S**.

### 10. [P3] risk list: desktop rows aren't clickable despite the docblock saying so — only the date cell is a link
**Location:** risk.tsx:4-5 (docblock "Click a row to drill into") vs 347-353 (only `formatDate(e.created_at)` is a `<Link>`), 363-389 (mobile cards ARE fully linked ✓)
**Why:** The drill-in affordance on desktop is a small date link in the last column — undiscoverable; the file's own docblock describes behavior the desktop table doesn't have. Also folded here: risk's filter chips (238-247) have no `aria-pressed` (same class as finding 6).
**Fix sketch:** row-level Link (or onClick navigate) on desktop rows; fix the docblock. Effort **S**.

### 11. [P3] RBAC deep-link honesty: risk and system rely on nav-hiding + a generic 403 banner
**Location:** layout.tsx:129 (risk scope "users") / :134 (system scope "settings"); risk.tsx:262-265, system.tsx:963-969
**Why:** Both pages gate via the nav only. A scope-less admin who deep-links (or follows a shared URL) fires the queries, eats 403s, and lands on generic banners («فشل تحميل الأحداث» / «تعذّر جلب تشخيص وقت التشغيل») — while the console's established pattern (settings.tsx:1077-1081, orders, users, referrals) shows the honest reason up front.
**Fix sketch:** `hasAdminPermission` gate + honest-reason card (the settings `tabAllowed` idiom). Effort **S**.

### 12. [P3] whatsapp display honesty (⚠ display-only — no session/pairing/restart logic proposed)
**Location:** whatsapp.tsx:186-190 vs 460-477; 312-317
**Why:** The pair-code success toast promises «أدخله في واتساب خلال دقيقتين تقريباً», but the code block never expires, dims, or counts down — an operator returning later can copy a stale code with no signal. Action **errors** render only in the top-of-page banner (312-317), far from the pressed button and possibly off-screen, while successes toast — a mixed idiom on one page. (Status honesty itself is good: canonical `StatusBadge` with a neutral fallback for unknown statuses, whatsapp.tsx:68-80.)
**Fix sketch:** a staleness cue on the code block (dim + «انتهت صلاحية الرمز على الأرجح — أعد الإصدار» after ~2 min); consider toasting action errors (or an inline per-row error) to match the rest of the console. Effort **S**.

### 13. [P3] settings.tsx is a 1,493-line / 5-tab monolith — the R123-deferred auth-settings split remains the right seam
**Location:** settings.tsx (whole file; ProviderCard 138-363, integrations 1176-1379 ≈ 500 lines)
**Why:** Account + security tabs are self-service (every admin), while auth-providers + integrations are settings-scoped server config — two different audiences in one page, with the scope gate threading through tab visibility, URL sync, and deep-link fallback (93-95, 1009-1018). The deferred split would move the provider/integrations half to its own route, shrinking settings to ~800 lines of genuinely self-service surface and simplifying the scope logic. Not urgent — the page is coherent and tested — but it's the structural answer to the scope-gate complexity this audit keeps re-tracing.
**Fix sketch:** extract `/admin/settings/auth-providers` (settings-scoped route) next round. Effort **M**.

---

## C. Priority counts

**P0: 0 · P1: 0 · P2: 3 · P3: 10** (13 findings; #9 is a 9-item copy batch). No money-path, session-logic, or RBAC-enforcement defects — all three P2s are honesty/manageability dead-ends on first-audit or security surfaces.

## D. Suggested fix order (ponytail)

1. **#2** risk error+empty gate + retry (S) — restores the console's core honesty contract on a fraud queue; 3 lines.
2. **#3** render `has_unread_admin` (S) — the support queue's most important signal is already on the wire.
3. **#1** 2FA re-enrollment flow (M) — the only security surface that dead-ends its owner.
4. **#4** loading-taxonomy batch (S) — security/admins/whatsapp/risk-event skeletons + whatsapp stop-blanking-on-action.
5. **#5** security timeline honest count + race guard (S/M).
6. **#9** copy batch (S) — تعذر unification, 2FA label, role badge, scopes retry, filter-aware tickets empty.
7. **#6 + #10** alerts/risk a11y + deleteAll→useConfirm + row affordance (S).
8. **#11** risk/system deep-link RBAC cards (S).
9. **#8** token discipline, alerts-first (M).
10. **#7** freshness policy doc + tickets socket invalidation (S/M).
11. **#12** whatsapp pair-code staleness cue (S, display-only).
12. **#13** settings auth-split (M, structural — schedule, don't rush).
