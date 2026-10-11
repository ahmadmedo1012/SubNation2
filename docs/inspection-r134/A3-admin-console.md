# R134-A3 — Admin Console: Carried-Items Verification + Fresh Sweep

**Repo:** `5d5227c` (R133, deployed; clean tree). **Agent:** A3 (read-only —
this report + one worklog entry only; no builds, no tests run, no requests).

**Method:** Read `docs/inspection-r130/A3-admin-journeys.md` FIRST (R133 FIXED
stamps honored — risk-dashboard triad / system gate / risk-event gate / login
redirect / provider-card+bell a11y are NOT re-reported), then
`docs/inspection-r126/{A1,A2,A3}` + `docs/inspection-r127/B15` for each carried
item's original detail, then verified every item against current source with
file:line evidence. Fresh sweep: enrichment.tsx, copilot
(CopilotPanel.tsx + CopilotHistoryView.tsx), diagnostics family (system.tsx
observability + whatsapp.tsx), InventoryUploadDialog.tsx, settings siblings
(account-tab.tsx, two-factor-setup.tsx, provider-card.tsx), admins.tsx,
security.tsx; backend mount map `routes/admin/index.ts` + emit census for the
socket-push items. Arabic copy checked character-level (python unicodedata) —
no false-positive typos reported.

**Exclusions honored:** A5-F4 bell↔read-state (by design), Embronic, operator
items (inventory loading, Cloudflare, SEO re-key) — untouched. A4 accepted
residues F3/F4/F5/F10 + light-theme tails enumerated in §C (status only, no
re-litigation).

---

## Part A — Carried-items verification (the R130 STILL-OPEN list, item by item)

**Ledger: 16 fully OPEN · 2 PARTIAL (open core) · 0 newly closed.** Two items
(A1-1, A1-26) evolved structurally — their fix is now dramatically cheaper than
the recorded sketch.

### A. Topups / money pages

**R126-A1-11 — «موافقة الكل» approves only the loaded window, no cap hint —
STILL OPEN.**
`topups.tsx:1090-1092`: `approveAll` filters `allTopups` (accumulated pages of
the ACTIVE tab's server-filtered window) and iterates them; the button at
`:1375` still reads `` `موافقة الكل (${pendingCount})` `` with no
`hasNextPage` disclosure anywhere near it (the only hasNextPage hints on the
page are the search-scope banner `:1435-1437` and the load-more `:1573`). When
`hasNextPage` is true the word «الكل» over-promises and pending rows beyond the
window survive to a second click. **Recorded fix sketch still applies (S):**
label «موافقة المعروض (N)» while `hasNextPage`, or disable + honest hint.

**R126-A1-13 — bulk money-dialog count copy + residuals — STILL OPEN (partially
improved).**
Verified open at HEAD: `:521` `` description={`${count} طلب سيتم معالجته`} ``
(BulkConfirmModal — the money confirm; «2/3 طلب» grammar), `:1147`
`` `تمت الموافقة على ${approvedCount} طلب` `` (approveAll success toast —
bare, though the bulk-summary toast at `:1067` DID get
`formatCount(…, TOPUP_COUNT_FORMS)`), `:1223` `{pendingCount} قيد الانتظار`
(header chip, bare), `:274` «المُرسل:» (damma) vs bare siblings `:265`
«المستخدم:» / `:282` «رمز التحويل:», `:1419` identical-ternary dead class
`` ${active ? "text-muted-foreground" : "text-muted-foreground"} `` (twin at
orders.tsx:1396), `:784` vs `:828` approve toast «لـ ${t.user_phone}» vs reject
toast «من ${t.user_phone}» for the same actor-action pair. **Fix sketch
unchanged (S, one mechanical commit; the forms object exists in-file at
`:135`).**

**Adjacent (not on the carried list, one line for the tracker):** A1-12's
رمز/مرجع/رقم drift is now ⅔ unified — card `:282` and confirm `:921` both say
«رمز التحويل»; only the search placeholder `:1287` still says «رقم التحويل».

### B. Products / catalog

**R126-A2-9 — dead bulk lookup counts skipped rows as successes — STILL OPEN.**
`products.tsx:994-995`: `const p = products.find((pr) => pr.id === id); if
(!p) continue;` inside `bulkToggleActive` — `p` is never used again (the PATCH
body at `:1001` is `{is_active: active}` keyed by id alone); rows selected
under one window and toggled after it changed are silently skipped, then
`summarizeBulk(…, selectedIds.size, failures)` at `:1026` computes
`successCount = total − failures` — skipped ids count as succeeded («تم
التفعيل 10 منتجات» after 7 PATCHes). **Fix sketch unchanged (S): delete the
two lookup lines (pure deletion), or record skips as failures.**

### C. Settings / system / risk (R126-A3 lane)

**R126-A3-9 — ProviderCard dead-code batch — PARTIAL: error-span half FIXED
(R127-L11/B14-14), placeholder + prop halves STILL OPEN.**
Fixed: the catch now feeds `setError(message)` (`provider-card.tsx:152-161`,
rendered `:349`) — the dead error state is alive and test-pinned
(`settings-provider-card-error-span.test.tsx`). Still open: (a) the
«•••••••••••• (مُعيَّن)» placeholder branch `:258-262` is still unreachable by
construction (a placeholder only renders on an EMPTY input; the branch is
chosen exactly when `config[key] === "[SET]"`, i.e. the value is non-empty);
(b) the unused `adminToken: _adminToken` prop `:99` (same dead prop on both
siblings: `account-tab.tsx:66`, `two-factor-setup.tsx:16`). **Fix sketch
applies to both remainders (S).**

**R126-A3-10 — ProviderCard config edits have no unsaved-changes protection —
STILL OPEN.**
Full read of `provider-card.tsx` (355 lines): no `useDirtyGuard` import; the
highest-stakes fields on the page (bot tokens, private keys, `:251-265`) are
silently discarded on tab close/navigation, no per-card dirty indicator. The
account tab guards (`account-tab.tsx:152-160`); the provider cards don't.
**Fix sketch applies (S): per-card `useDirtyGuard(config !== provider.config)`
+ «غير محفوظ» tag.**

**R126-A3-11 — clearing a non-secret field surfaces a misleading 400 — STILL
OPEN.**
No client-side min(1) validation anywhere in `provider-card.tsx` (the save at
`:122-137` sends the config as-typed); the backend schema is unchanged
(`auth-settings.ts:575` `z.string().trim().min(1).max(max)`) — clearing
`bot_username` and saving still 400s with the generic
«قيمة غير صالحة لإعدادات المزوّد…» which reads like a type error, not "you
emptied a required field". **Fix sketch applies (S): client-side min(1) + field
marking, or map the 400 to «لا يمكن ترك حقل X فارغاً».**

**R126-A3-12 — system.tsx jobs panel: silent top-8 truncation + English status
tokens — STILL OPEN.**
`system.tsx:1496-1498`: `Object.entries(…).sort(…).slice(0, 8)` with no
«عرض 8 من N» disclosure (the honest-counts contract every list honors);
`:1519` renders the raw `{status}` segment — literal English `failed` /
`success` — as the row's status word inside the Arabic «المهام الخلفية»
panel, no `JOB_STATUS_LABELS` map. (Also `:1495` `max-h-44 overflow-y-auto`
is dead weight given the slice caps at 8 rows.) The R133 settings-gate fix
(`:445` `canViewSystem`) correctly covers this panel — the finding is
copy/count-honesty, not gating. **Fix sketch applies (S).**

**R126-A3-13 — risk.tsx filter-chip counters are loaded-window counts with a
silent fallback — STILL OPEN.**
`risk.tsx:175-183`: `allEventsQuery` fetches the unfiltered first-100 window
only while a filter is active, and `countSource = … ?? events` at `:183`
resurrects the filtered-subset counters whenever that background query errors
(the 94-C2 A2 P3-1 class) with no error surface of its own; the chips at
`:356` `({counts[f.value]})` don't disclose "loaded so far" semantics. The
server-truth `dashboard.data.by_level` sits 60px above in the DashCards
(`:299-305`) — a filter-active chip count (client window) can disagree with
the tile above it. **Fix sketch applies (S): render chip counters from
`by_level` (same source as the DashCards) or disclose the window.**

### D. R127-B15 lane

**B15-4 — ticket threads show a generic admin identity — STILL OPEN (schema
work).**
`tickets.tsx:751-775`: every admin reply renders one shield avatar, no
username; `shared/db/src/schema/ticket_replies.ts:11` still carries
`authorType` only (no adminId column). Contrast `topups.tsx` reviewed_by and
`risk-event.tsx` labeled_by_username. **M effort; pairs with the audit-log
reader (which DID land — `security.tsx` audit tab verified, B15-1 closed).**

**B15-5 — filter-state-in-URL stops at the five big lists — STILL OPEN.**
`risk.tsx:342` (`onClick={() => setFilter(f.value)}`, no URL write — the
events drill-in IS deep-linkable, the level chip is not), `alerts.tsx:223`
(local `useState<FilterType>`, no sync), `referrals.tsx` (zero
`URLSearchParams` occurrences — search/status both die on refresh).
products.tsx is HALF-evolved: search is now URL-READ (`:542-544` seeds the box
from `?search=`, `:586-589` follows external changes — the GlobalSearch
deep-link lane) but never written back on typing, and categoryFilter
(`:551`) has no URL presence at all. **Fix sketch applies (S per page,
`syncFilterParams` idiom).**

**B15-6 — the `/` search-focus shortcut exists only on orders — STILL OPEN.**
`orders.tsx:896` remains the sole `e.key === "/"` handler across
`pages/admin/` (grep). topups/users/products/referrals/coupons still ship
search boxes with no `/` handler; no shared hook exists
(`use-keyboard-visibility.ts` is the mobile-keyboard hook, not this).
**Fix sketch applies (S).**

**B15-7 — WhatsApp pairing surface has no dismiss path — STILL OPEN.**
`whatsapp.tsx:557-618`: once «ربط برمز الهاتف» is tapped the inline form pins
to the session (collapse = tap pair on a DIFFERENT session or delete);
`:635-646`: the fetched QR block persists with no ✕. No dismiss affordance
added since R127. **Fix sketch applies (S: icon-button clearing
pairTarget/qrImage).**

**B15-8 — formatCount stragglers — PARTIAL: 1 of 5 FIXED.**
FIXED: `dashboard.tsx:733` (the urgent-banner pending-topups count now rides
`formatCount`). STILL OPEN: `orders.tsx:1445` `{filtered.length} نتيجة`,
`orders.tsx:1124` `{couponOrders.length} طلب بكوبون`, `layout.tsx:727`
`{u.order_count} طلب` (GlobalSearch user row), `layout.tsx:775`
`{p.stock_count} وحدة` (GlobalSearch product row). **One mechanical commit
(S).**

**B15-9 — bulk live-progress is a topups-only luxury — STILL OPEN.**
`products.tsx:1120` `{bulkProcessing ? "جارٍ…" : "أرشفة"}` — the sequential
bulk loops still surface only the label swap; no `جاري done/total` line, no
per-item progress (per-item FAILURE visibility is landed, R126-L3 — that part
holds). **Fix sketch applies (S/M).**

**B15-11 — icon-button naming micro-batch — STILL OPEN.**
`layout.tsx:1450-1453`: theme toggle still carries two different accessible
names (`title` «وضع نهاري/ليلي» vs `aria-label` «تبديل المظهر (…)»);
`:1458-1466`: the top-bar refresh button still names itself with
`title="تحديث البيانات"` only, no `aria-label`, while every sibling icon
button has one. **Fix sketch applies (S).**

### E. Socket-push freshness (R126-A1-1 / A1-26)

**A1-1 — charts don't refresh on `admin-stats-update` — STILL OPEN, but the
fix collapsed from M to ONE LINE.**
The chart series moved off raw-fetch onto react-query in R127-L1
(`dashboard.tsx:486-508`, `useGetAdminChartData`, key
`["/api/admin/chart-data", {days}]` per api.ts:9892, no `refetchInterval` —
mount/days-flip/manual-refresh only). The socket key-set
(`lib/socket-resync.ts:83-92`, shared by the push handler, the reconnect
resync, AND the visibility resync) still carries exactly 8 families — stats /
orders / topups / users / tickets / risk-events / risk-dashboard / products —
**not** the chart-data prefix. Net effect unchanged from R126: another
operator's approve ticks the KPI tiles (stats key invalidated) while the
revenue chart below keeps the pre-approve series until manual refresh. **Fix:
add `["/api/admin/chart-data"]` to `invalidateAdminRealtimeFamilies` (one
line; prefix-matches every days-variant). Effort S.**

**A1-26 — coupons/pricing/referrals have no push path — PARTIAL (evolved).**
Referrals is now react-query (`referrals.tsx:268`,
`getListAdminReferralsQueryKey` = `["/api/admin/referrals", …]` per
api.ts:10455) and pricing-config is react-query (`pricing.tsx:334`) — both
keys missing from the socket set (**one line each**, same fix as A1-1).
Coupons is still raw local-state (`coupons.tsx:158` raw `adminFetchJson` into
`useState`) — needs the fold-into-react-query half of the original sketch
(M). Backend half unchanged: `admin-stats-update` emits exist for
topups/orders/users/tickets/risk/products-family only — zero emits in
`routes/admin/referrals.ts`, `routes/coupons.ts`, `routes/admin/pricing-*`
(grep census) — so a coupon/pricing-config write by admin B still never
reaches admin A's tab at all. **Original fix sketch applies; the referrals +
pricing-config keys can land in the same one-line commit as A1-1.**

### F. selection-not-pruned — STILL OPEN (deliberate, disclosed in code)

The membership-based select-all landed everywhere (orders.tsx:1011-1028,
products.tsx:874-895 — both fixed and comment-documented), but selections are
still never pruned on filter flip on any of the three selecting pages:
`orders.tsx:1015-1022` (comment: "The selection legitimately carries ids
OUTSIDE the current filter"), `products.tsx:880-881`, `topups.tsx:1395`
(`setStatusFilter` with no selection reset). Consequence remains the
hidden-selected-ids class: bulk actions can act on rows the operator cannot
see (the bulk bar count `orders.tsx:1093`/`products.tsx:1093` is the only
tell). **Fix sketch (prune on filter flip, or surface "N محدد — M خارج
الفلتر") unchanged.**

### G. Carried-item ledger table

| Item | Verdict @ 5d5227c | Evidence |
|---|---|---|
| R126-A1-11 موافقة الكل cap | **OPEN** | topups.tsx:1090-1092, :1375 |
| R126-A1-13 count copy + residuals | **OPEN** | topups.tsx:521, :1147, :1223, :274, :1419, :784/:828 |
| R126-A2-9 dead bulk lookup | **OPEN** | products.tsx:994-995, :1026 |
| R126-A3-9 dead code | **PARTIAL** (error span fixed R127-L11) | provider-card.tsx:258-262, :99 |
| R126-A3-10 no dirty guard | **OPEN** | provider-card.tsx (full read, no useDirtyGuard) |
| R126-A3-11 cleared-field 400 | **OPEN** | provider-card.tsx:122-137 + auth-settings.ts:575 |
| R126-A3-12 jobs slice + EN tokens | **OPEN** | system.tsx:1496-1498, :1519 |
| R126-A3-13 risk chip counters | **OPEN** | risk.tsx:175-183, :356 vs :299-305 |
| R127-B15-4 ticket attribution | **OPEN** | tickets.tsx:751-775 + ticket_replies.ts:11 |
| R127-B15-5 filters-in-URL | **OPEN** | risk.tsx:342, alerts.tsx:223, referrals.tsx (none), products.tsx:551 |
| R127-B15-6 `/` shortcut | **OPEN** | orders.tsx:896 (sole hit) |
| R127-B15-7 pairing dismiss | **OPEN** | whatsapp.tsx:557-618, :635-646 |
| R127-B15-8 formatCount ×5 | **PARTIAL** (dashboard.tsx:733 fixed) | orders.tsx:1445/:1124, layout.tsx:727/:775 |
| R127-B15-9 bulk progress | **OPEN** | products.tsx:1120 |
| R127-B15-11 icon naming | **OPEN** | layout.tsx:1450-1453, :1458-1466 |
| R126-A1-1 chart push | **OPEN** (fix now 1 line) | socket-resync.ts:83-92 + dashboard.tsx:486-508 |
| R126-A1-26 coupons/pricing/referrals push | **PARTIAL** (referrals+config now RQ; coupons raw; no emits) | referrals.tsx:268, pricing.tsx:334, coupons.tsx:158 |
| selection-not-pruned | **OPEN** (disclosed) | orders.tsx:1015-1022, products.tsx:880-881, topups.tsx:1395 |

Verified CLOSED en route (stamps hold, no re-report): R130-A3-F1 login
redirect (`login.tsx:23-29` honors `?redirect=`), R133 risk/system/risk-event
gates (risk.tsx:107/161/179/201, system.tsx:445, risk-event.tsx:103), R133
a11y batch (provider-card:236-240/280, login.tsx:242-260, the 4 textarea
aria-labels — enrichment.tsx:325, InventoryUploadDialog.tsx:317,
CopilotPanel.tsx:1174 — all present), R126-A1-5/R127-B2 select-all membership
(orders.tsx:1023-1028, products.tsx:890-895), B15-1 audit-log reader
(security.tsx audit tab with error card, no false-empty, CSV export,
`audit-logs.ts` + admin/index.ts:120-124 mount), B15-2 SessionManager (out of
lane — not re-walked).

---

## Part B — Fresh-sweep findings (R134-A3-F*)

### A3-F1. [P3] The R133 scope-gate pattern never propagated: ~13 scope-gated pages still fire queries on scope-less deep links — whatsapp.tsx is the settings-scoped sibling the mandate asked about
**Evidence:** R133 fixed exactly three pages (system.tsx:445
`canViewSystem`, risk.tsx:107 `canViewRisk`, risk-event.tsx:103 users gate —
banner + `enabled:false`, fetch-free mounts, test-pinned). The backend mount
map (`routes/admin/index.ts:49-142`) scopes EVERY family: whatsapp rides the
diagnostics mount `index.ts:136` `requirePermission("settings")` — yet
`whatsapp.tsx` has no gate and fires `loadSessions()` on mount
(`whatsapp.tsx:157-159` → `:143`). Same shape, per page, with `enabled:
!!adminToken` only (or a raw mount fetch) and NO `hasAdminPermission` gate
anywhere in the file: `admins.tsx:84-121` (three parallel fetches, admins
scope), `security.tsx` (admins), `alerts.tsx:261` (support), `tickets.tsx`
(support), `products.tsx:629` (inventory), `pricing.tsx:335` (inventory),
`promotions.tsx` (inventory), `enrichment.tsx:104-115` (inventory — the
mandate's enrichment surface), `topups.tsx:720` (finance), `coupons.tsx`
(finance), `referrals.tsx`/`orders.tsx:653`/`users.tsx` (users/orders scopes).
The nav hides all of these correctly (`layout.tsx:108-137` scope filter), so
the only entry is a deep link — exactly the R133 A3-F4/F5 scenario. Blast
radius: a synchronized 403 burst per mount (+poll cycle on the polling pages)
and a FetchErrorCard whose Arabic 403 body reads as a load failure with a
retry that can never succeed — an authorization outcome dressed as an outage.
**Why whatsapp is the headline:** it is settings-scoped (the mandate's
"settings siblings" question), it is also the page a support-tier operator
would most plausibly bookmark thinking it's theirs (it's about WhatsApp
sessions, not "settings"), and the R133 gate idiom is 15 lines away in the
sibling file family. **Fix (S per page, M for the batch): replicate the
risk.tsx:107 pattern — `const canView = hasAdminPermission(scope)` + honest
banner (`:201-209`) + `enabled: !!adminToken && canView` on every query.
Cheapest complete fix: a tiny shared wrapper/hook so pages declare scope once.
Tests: mirror `system-settings-gate.test.tsx` / `risk-rbac-gate.test.tsx`.**

### A3-F2. [P3] The Copilot overlay is the last admin modal without dialog semantics or a focus trap — the exact A4-F7 class R133 fixed on NotificationBell
**Evidence:** `CopilotPanel.tsx:997-1005`: the open panel renders a scrim div
(`:999-1002`, click-to-close) + `<aside className="fixed …">` with NO
`role="dialog"`, NO `aria-modal`, NO Tab containment, and no focus return on
close (focus IS placed into the composer on open, `:576-578` — that half is
good). Tab walks out of the panel into the occluded page behind the scrim;
screen readers get no dialog announcement for what is functionally the
console's most powerful modal (it can execute catalog writes). Contrast the
three fixed siblings: NotificationBell (R133 A4-F7: aria-modal + trapTabKey +
returnFocusRef), the ⌘K palette (`layout.tsx:567-568` role=dialog +
aria-modal + focus helpers `:308-330`), the mobile drawer (`layout.tsx:1314-1315`).
ESC layering (`:561-570`) is already correct. **Fix (S): role="dialog" +
aria-modal + `aria-label="المساعد الذكي"` on the aside, the
NotificationBell trapTabKey/returnFocus idiom (its third→fourth local copy —
consider finally extracting `layout.tsx:308-330` into a shared helper), keep
the layer-peel ESC as-is.**

### A3-F3. [P3] InventoryUploadDialog's dedup-probe soft-fail is silent — the pre-commit counts over-promise with no cue
**Evidence:** `InventoryUploadDialog.tsx:69-109`: the mount fetch of existing
inventory (for DB-dedup flagging) fails soft on ANY non-ok (`:76-80` — "dedup
against DB just won't be available"), and the catch (`:99-101`) does the same.
Nothing in the UI discloses that state: the preview table still renders
«جاهز للإضافة: N» / «رفع N عنصر» (`:250-252`, `:369`) computed from
`parseInventoryText(text, existingKeys)` with an EMPTY `existingKeys` set —
entries that ARE duplicates in the DB render «جديد», `willInsert` over-counts,
and the operator only discovers the truth AFTER submit (the server dedups;
the toast then shows the server's smaller number — `:179-182`). This is the
stale-keep-without-cue / silent-degradation class the console killed
everywhere else: the honest information exists (the probe failed), the
component throws it away. **Fix (S): track `dedupAvailable` (false on either
soft-fail path) and render a muted status line when false — e.g.
«لم يُمكن جلب المخزون الحالي — لن تُوسم العناصر المكررة قبل الرفع (يظل الفحص عند الخادم)»
— and/or annotate the «مكرر» column header. No behavior change to the submit
contract.**

### A3-F4. [P4] The account-tab password reveal is a ~14px icon-only button — the A4-F6 class R133 fixed on login + provider-card, this twin was missed
**Evidence:** `account-tab.tsx:408-415`: the new-password reveal in the
settings account tab is a bare `absolute left-2 … text-muted-foreground`
button wrapping a `w-3.5 h-3.5` icon — hit box ≈14×20px, no `h-11 w-11` /
`touch-target` (the repo 44px idiom the R133 commit cf94a76 landed at
`login.tsx:247-260` and `provider-card.tsx:267-292`), and the input reserves
no padding on the button side (`:403` `pr-9` pads the START side; the button
sits at the physical left). Same-family smaller instances (one line each):
`orders.tsx:190-198` MaskedCredential eye `p-2 -m-1` ≈30px effective (the
comment beside it claims "the canonical 44px component" — that's the COPY
button, not the eye), `CopilotPanel.tsx:1053-1062` hover-only 16px
conversation-delete, `:1073-1127` header icon buttons ≈26px ×5,
`ProductVariantsDialog.tsx:743-780` `h-8` (32px) row icon buttons.
**Fix (S): the F6 treatment — `flex h-11 w-11 items-center justify-center
touch-target` + a matching input padding reservation; fold the smaller
instances into the same pass where cheap.**

### A3-F5. [P4] Admin copy micro-batch: retry-verb drift, English alt, dual naming, risk-tier label split
**Evidence (one-concept-one-word violations, all verified character-level):**
(a) retry verb: the copilot error-turn button says «إعادة» with
`title="حاول مجدداً"` (`CopilotPanel.tsx:1305-1311`) while the console's
canonical retry label is «إعادة المحاولة» (`fetch-error-card.tsx:147` —
three words for one concept across two adjacent surfaces);
(b) the copilot trigger carries two different accessible names —
`title="المساعد الذكي (Ctrl/Cmd+J)"` vs `aria-label="فتح المساعد الذكي"`
(`CopilotPanel.tsx:986-987`) — the exact B15-11 class, still open on layout's
own toggles too (Part A);
(c) `two-factor-setup.tsx:152` `alt="QR Code"` — English alt text on the
2FA QR inside an otherwise-Arabic flow (the heading right below reads «امسح
رمز الاستجابة السريعة»);
(d) risk-tier wording splits: CopilotHistoryView `:139` «عالي» vs
CopilotPanel `:1513` «عالية الخطورة» for the same risk_tier=high concept;
(e) nav label «جلسة واتساب» (`layout.tsx:137`) vs page h1 «إدارة جلسة
واتساب» (`whatsapp.tsx:359`) — cosmetic seam, fold into any copy pass.
**Fix (S): one mechanical copy commit.**

### A3-F6. [P4] processingId single-slot family (R126-A1-14) — ALL instances verified still single-slot
**Evidence (mandate verification):** topups `processingId`
(`topups.tsx:627`, consumed `:1558-1559`), referrals `crediting`
(`referrals.tsx:247`, cleared `:346`), coupons `toggling`/`archiving`
(`coupons.tsx:128/:132`, consumed `:740/:750/:764/:769`), whatsapp `busy:
string | null` (`whatsapp.tsx:121` — one global slot shared by create/start/
pair/QR/delete per session), tickets `statusBusy` (`tickets.tsx:126`). The
class: confirm row A → in-flight → open+confirm row B → the single slot flips
to B and row A's action buttons re-enable while A's POST is still running
(idempotency + server status guards prevent double-COMMIT; the broken promise
is the disabled-state honesty). Note A1-14 was dropped from R130's condensed
carried list — this round re-verifies it as open on every instance. **Fix
sketch unchanged (S): `Set<number>` of in-flight ids (or disable all sibling
row actions while any is pending).**

### A3-F7. [P4] Enrichment lane residuals re-verified (documented R126-A2 §C — status only, not re-litigated)
`enrichment.tsx:239` — one `useConfirm` provider mount PER DraftCard (25
cards = 25 dialog trees; the ConfirmDialog-per-card is the R125-A2 F19
family); `:317-327` — the edit textarea has no dirty guard (typing + tab
close = silent loss; the R133 aria-label at `:325` fixed naming, not
guarding). Both remain the lane's documented UX-debt cluster; the rest of the
page (cursor pagination + honest cap `:143-148`, triad `:168-186`, both
publish paths confirmed `:278-289`) verified HELD.

### A3-F8. [P4] One-liner residuals noticed en route (not filed as findings, for the next mechanical pass)
(a) `alerts.tsx:259` — the 20s poll still carries no inline why-this-cadence
comment (R126-A3-14, doc-only, dropped from the R130 carried list);
(b) `account-tab.tsx:221-229` — a failed session fetch renders
«تعذّر تحميل بيانات الحساب. حاول إعادة تسجيل الدخول.» with no retry
affordance — the advice is wrong for a 5xx (re-login fixes nothing) and the
page's own header refresh is the only path (the sibling two-factor probe
`two-factor-setup.tsx:42-61` degrades gracefully by design and discloses the
fallback in comments — fine);
(c) `CopilotHistoryView.tsx:111-115` — the error banner has no inline retry
(the header refresh button at `:89-96` serves, 40px above) — consistent enough;
no action.

---

## Part C — Appendix: A4 accepted residues, current status (for R134's keep/fix decision — NOT re-reported)

All verified still present at HEAD (line drift noted):
- **A4-F3** crash-dump ink: `components/ErrorBoundary.tsx:128`
  `text-status-error/75` — unchanged, accepted (bold headline above carries
  the state).
- **A4-F4** destructive tints in the two dialogs:
  `InventoryUploadDialog.tsx:448` `text-destructive/70` mono 11px (was :445,
  +3 drift from the R133 aria-label insert); `ProductVariantsDialog.tsx:777`
  `text-destructive/60` trash icon (hover restores; button properly
  aria-labeled) — both unchanged, accepted.
- **A4-F5** decorative icon hygiene: `pages/home.tsx:569` WifiOff
  `text-status-error/60`; `pages/not-found.tsx:30` Compass
  `text-primary/40` — both unchanged, accepted (beside bold Arabic text).
- **A4-F10** hover-only ink dips: `pages/home.tsx:597`
  `hover:text-primary-text/75`, `:759` `/80` — unchanged, accepted.
- **A4-F2's remaining light-only P4 tail** (sub-opacity ink, light theme):
  `referrals.tsx:190` `text-status-success/70` 11px;
  `pricing.tsx:293` `opacity-75`, `:1146`/`:1183` `opacity-80`;
  `pages/order-detail.tsx:581` `text-muted-foreground/75` 11px — all
  unchanged at the same lines.

None regressed; none fixed. All remain one-class XS fixes "when touched."

---

## Part D — Summary

| Severity | Count | Items |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 0 | — |
| P3 | 3 | A3-F1 (ungated scope mounts, whatsapp headline), A3-F2 (copilot dialog a11y), A3-F3 (inventory dedup silent soft-fail) |
| P4 | 5 | A3-F4 (44px tail, account-tab reveal), A3-F5 (copy micro-batch), A3-F6 (processingId single-slot family), A3-F7 (enrichment residuals — status), A3-F8 (one-liners) |

**Carried items:** 16 open, 2 partial (A3-9 error-span half fixed R127-L11;
B15-8 dashboard site fixed), 0 closed. Two items (A1-1, A1-26-referrals/
pricing-config) collapsed to one-line socket-resync key adds — recommend one
commit adding `["/api/admin/chart-data"]`, `["/api/admin/referrals"]`, and
`getGetAdminPricingConfigQueryKey()`'s prefix to `invalidateAdminRealtimeFamilies`
(socket-resync.ts:83-92), which closes A1-1 outright and the react-query half
of A1-26 (coupons' raw-state + the backend emits remain).

**Prioritized fix order (operator value / effort):**
1. **A3-F1** (S/page) — the settings-gate idiom onto whatsapp + the ungated
   dozen; each page is a copy of a pinned pattern.
2. **Socket-resync one-liner commit** (S) — A1-1 + half of A1-26.
3. **A1-11 + A1-13 + B15-8 + A3-F5 + A3-F6** — one "topups/products/labels
   mechanical" commit (counts, dead branches, honest cap label, in-flight
   Sets).
4. **A3-F2** (S) — copilot dialog semantics (extract the focus-trap helper
   while there — its 4th consumer).
5. **A3-F3** (S) — one honest status line in the upload dialog.
6. **A2-9 + B15-9** (S) — products bulk honesty pair (dead lookup deletion +
   live progress).
7. **A3-9/10/11 remnants + A3-12 + A3-13 + B15-4/5/6/7/11** — the standing
   carried list, unchanged estimates.

**Verdict: SHIP-WORTHY.** No P0/P1/P2: the money-mutation core and the
state-truth triads re-verified clean on every surface walked this round; the
three P3s are a consistency-propagation gap (the gate pattern exists and is
pinned, just not everywhere), a modal-semantics gap (the idiom exists 40 lines
away), and a missing one-line honesty cue. The carried list is aging but
tracked and none of it is money-unsafe.
